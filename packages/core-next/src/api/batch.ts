/**
 * Batch resolvers (L7a), as a system part: 1.35's `batch:` option on a
 * resolver, with no import. `createSystem` wires it on every system (A1,
 * O1); `createSystemCore` and the floor go without it, and their resolvers
 * leave a batched requirement unmet. A system with no batched resolver gets
 * nothing from it: no queue, no timer, no listener.
 *
 * - The window: one queue per definition. `windowMs` (default 50) runs it,
 *   so does reaching `maxSize`, or 10,000 with none (1.35's cap), and so
 *   does `settle()`, at its start and at each settled change while it
 *   waits (1.35's processBatches). The timer is on the kernel clock.
 * - A batch run is the resolvers' Run with `reqs_`: one stamp (own-write
 *   satisfaction and binding work on it as on a single run), L2's retry
 *   loop, timeout, abort and outcome mark. The handler's sync start runs in
 *   one store batch. `resolveBatch` completes each requirement on return;
 *   `resolveBatchWithResults` reports each item on its own, with 1.35's
 *   count check and "Batch item failed". The binding is the last
 *   non-undefined baseline of the queued requirements (W5).
 * - Retracting a queued requirement takes it out of the queue and cancels
 *   it; one of a running batch cancels the whole batch, as 1.35 (quirk g is
 *   L7b). stop() cancels the queued ones, then the running batches.
 *
 * Three owner-approved changes from 1.35 (L7 RFC, 2026-11-05):
 * - (ap) the window starts at the first add to an empty queue and does not
 *   move (1.35 restarts it on every add);
 * - (as) a running batch is in flight: `settle()`, the settled notification
 *   and `inspect()` count it (1.35's settle() resolves while it runs);
 * - (at) with only `resolve()`, each requirement starts as an ordinary
 *   single run when the window closes (1.35 runs it on a private
 *   controller that retraction, stop() and settle() cannot reach).
 */

import type { SystemPart } from "./core.js";
import type { RequirementWithId } from "./requirements.js";
import type { BatchHost, Batcher, ResolverDef, Run } from "./resolvers.js";
import { withTimeout } from "./timeout.js";

type Baseline = ReadonlyMap<string, unknown> | undefined;

interface Queue {
  reqs_: RequirementWithId[];
  bases_: Baseline[];
  /** The window's timer, 0 when the queue is empty. */
  timer_: number;
  ms_: number;
  max_: number | undefined;
}

export const withBatch: SystemPart = (context) => {
  const { module, system, kernel, store } = context;
  const defs = (module.resolvers ?? {}) as Record<string, ResolverDef>;
  if (!Object.values(defs).some((def) => def?.batch?.enabled)) {
    return;
  }
  const { clock } = kernel;
  const queues = new Map<string, Queue>();
  let host: BatchHost;
  /** settle() calls still waiting: they flush the queues on each change. */
  let waiting = 0;
  const flushAll = () => {
    for (const id of queues.keys()) {
      flush(id);
    }
  };
  const settle = system.settle as (maxWait?: number) => Promise<void>;
  system.settle = (maxWait?: number) => {
    flushAll();
    waiting++;
    const done = settle(maxWait);
    const off = () => {
      waiting--;
    };
    done.then(off, off);

    return done;
  };
  (system.onSettledChange as (fn: () => void) => void)(() => {
    if (waiting > 0) {
      flushAll();
    }
  });

  /** 1.35's awaitWithTimeout: async, so a batch's ticks are 1.35's. */
  const within = async (def: ResolverDef, run: Run, pending: unknown) => {
    const ms = def.batch!.timeoutMs ?? def.timeout;

    return ms && ms > 0
      ? withTimeout(
          clock,
          pending,
          ms,
          `Batch resolver "${run.resolver_}" timed out after ${ms}ms`,
        )
      : pending;
  };
  /** The handler's sync start, in one store batch. */
  const begin = (fn: Function, run: Run, ctx: object) => {
    let pending: unknown;
    store.batch(() => {
      pending = fn(
        run.reqs_!.map((req) => req.requirement),
        ctx,
      );
    });

    return pending;
  };
  /** 1.35's executeAllOrNothing: every requirement completes on return. */
  async function all(def: ResolverDef, run: Run, ctx: object) {
    await within(def, run, begin(def.resolveBatch!, run, ctx));
    // Canceled or superseded: that was its one outcome.
    if (!run.controller_.signal.aborted) {
      host.report_(run);
    }
  }
  /** 1.35's executeWithResults: each item reports on its own. */
  async function each(def: ResolverDef, run: Run, ctx: object) {
    const reqs = run.reqs_!;
    const results = (await within(
      def,
      run,
      begin(def.resolveBatchWithResults!, run, ctx),
    )) as Array<{ success: boolean; error?: Error }>;
    if (run.controller_.signal.aborted) {
      return;
    }
    if (results.length !== reqs.length) {
      throw new Error(
        `[Directive] Batch resolver "${run.resolver_}" returned ${results.length} results but expected ${reqs.length}. Results array must match input order.`,
      );
    }
    // The run's mark first: a stop() from a hook cancels nothing (row t).
    run.done_ = true;
    reqs.forEach((req, i) => {
      const result = results[i]!;
      host.tell_(
        run,
        req,
        result.success
          ? undefined
          : (result.error ?? new Error("Batch item failed")),
      );
    });
  }
  /** 1.35's executeBatchAttempt: the handler in place of `resolve()`. */
  async function call(def: ResolverDef, run: Run, ctx: object) {
    if (def.resolveBatchWithResults) {
      return each(def, run, ctx);
    }
    await all(def, run, ctx);
  }

  function flush(id: string) {
    const queue = queues.get(id)!;
    const { reqs_: reqs, bases_: bases } = queue;
    if (reqs.length === 0) {
      return;
    }
    clock.clearTimeout(queue.timer_);
    queue.timer_ = 0;
    queue.reqs_ = [];
    queue.bases_ = [];
    const def = defs[id]!;
    if (!def.resolveBatch && !def.resolveBatchWithResults) {
      // (at): each one an ordinary single run, as 1.35 runs it unbound.
      for (const req of reqs) {
        host.start_(def, id, req);
      }

      return;
    }
    // W5: the last baseline a dispatch gave.
    let baseline: Baseline;
    for (let i = bases.length; baseline === undefined && i-- > 0; ) {
      baseline = bases[i];
    }
    const run = host.run_(id, reqs[0]!, reqs);
    for (const req of reqs) {
      host.inflight.set(req.id, run);
    }
    // 1.35's executeBatch, then its onResolutionComplete after every batch.
    (async () => {
      try {
        await host.execute_(def, run, baseline, call);
      } finally {
        host.detached.delete(run);
        for (const req of reqs) {
          if (host.inflight.get(req.id) === run) {
            host.inflight.delete(req.id);
          }
        }
      }
    })().then(() => {
      context.settled();
      context.schedule();
    });
  }

  const batcher: Batcher = {
    add_(id, def, req, baseline) {
      let queue = queues.get(id);
      if (!queue) {
        // Read once per definition, with 1.35's default window.
        const { windowMs, maxSize } = { windowMs: 50, ...def.batch };
        queue = {
          reqs_: [],
          bases_: [],
          timer_: 0,
          ms_: windowMs,
          max_: maxSize,
        };
        queues.set(id, queue);
      }
      if (queue.reqs_.length >= (queue.max_ || 10_000)) {
        flush(id);
      }
      queue.reqs_.push(req);
      queue.bases_.push(baseline);
      if (queue.max_ && queue.reqs_.length >= queue.max_) {
        flush(id);
      } else if (!queue.timer_) {
        // (ap): from the first add to an empty queue, not moved by later ones.
        queue.timer_ = clock.setTimeout(() => flush(id), queue.ms_, {
          owner: kernel.owner,
          kind: "batch",
        });
      }
    },
    drop_(requirementId) {
      for (const [id, queue] of queues) {
        const i = queue.reqs_.findIndex((req) => req.id === requirementId);
        if (i >= 0) {
          const [req] = queue.reqs_.splice(i, 1);
          queue.bases_.splice(i, 1);
          if (queue.reqs_.length === 0) {
            // An empty queue keeps no timer: the next add opens a window.
            clock.clearTimeout(queue.timer_);
            queue.timer_ = 0;
          }
          host.canceled_(id, req!);

          return;
        }
      }
    },
    clear_(ids) {
      for (const [id, queue] of queues) {
        clock.clearTimeout(queue.timer_);
        queue.timer_ = 0;
        const reqs = queue.reqs_;
        queue.reqs_ = [];
        queue.bases_ = [];
        for (const req of reqs) {
          ids.push(req.id);
          host.canceled_(id, req);
        }
      }
    },
    queued_() {
      for (const queue of queues.values()) {
        if (queue.reqs_.length > 0) {
          return true;
        }
      }

      return false;
    },
  };
  context.batch_ = (given) => {
    host = given;

    return batcher;
  };
};
