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
// biome-ignore lint/suspicious/noExplicitAny: a user handler
type Fn = (...args: any[]) => any;

interface Queue {
  id_: string;
  reqs_: RequirementWithId[];
  bases_: Baseline[];
  /** The window's timer, 0 when the queue is empty. */
  timer_: number;
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
  const flushAll = () => {
    for (const id of queues.keys()) {
      flush(id);
    }
  };
  // 1.35's settle() runs the queues at its start, and again at each
  // settled change while it waits.
  const settle = system.settle as (maxWait?: number) => Promise<void>;
  system.settle = (maxWait?: number) => {
    flushAll();
    const off = (system.onSettledChange as (fn: () => void) => () => void)(
      flushAll,
    );
    const done = settle(maxWait);
    done.then(off, off);

    return done;
  };

  /**
   * 1.35's executeAllOrNothing and executeWithResults: the handler's sync
   * start in one store batch, then the outcomes. Each requirement is one;
   * the run's mark is set first, so a stop() from a hook cancels nothing
   * more (row t). Async at 1.35's depth, so a batch's ticks are 1.35's.
   */
  async function finish(def: ResolverDef, run: Run, ctx: object, fn: Fn) {
    const reqs = run.reqs_!;
    const name = run.resolver_;
    const many = def.resolveBatchWithResults;
    const ms = def.batch!.timeoutMs ?? def.timeout;
    let pending: unknown;
    store.batch(() => {
      pending = fn(
        reqs.map((req) => req.requirement),
        ctx,
      );
    });
    const results = (await (async () =>
      ms && ms > 0
        ? withTimeout(
            clock,
            pending,
            ms,
            `Batch resolver "${name}" timed out after ${ms}ms`,
          )
        : pending)()) as Array<{ success: boolean; error?: Error }>;
    // Canceled or superseded: that was its one outcome.
    if (run.controller_.signal.aborted) {
      return;
    }
    if (many && results.length !== reqs.length) {
      throw new Error(
        `[Directive] Batch resolver "${name}" returned ${results.length} results but expected ${reqs.length}. Results array must match input order.`,
      );
    }
    run.done_ = true;
    reqs.forEach((req, i) => {
      host.tell_(
        run,
        req,
        !many || results[i]!.success
          ? undefined
          : (results[i]!.error ?? new Error("Batch item failed")),
      );
    });
  }
  /** 1.35's executeBatchAttempt: the handler in place of `resolve()`. */
  async function call(def: ResolverDef, run: Run, ctx: object) {
    const many = def.resolveBatchWithResults;
    if (many) {
      return finish(def, run, ctx, many);
    }
    await finish(def, run, ctx, def.resolveBatch!);
  }

  /** End a queue's window and put an empty one in its place; returns it. */
  const take = (queue: Queue) => {
    clock.clearTimeout(queue.timer_);
    queues.set(queue.id_, { id_: queue.id_, reqs_: [], bases_: [], timer_: 0 });

    return queue;
  };

  function flush(id: string) {
    const queue = queues.get(id)!;
    if (queue.reqs_.length === 0) {
      return;
    }
    const { reqs_: reqs, bases_: bases } = take(queue);
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
        host.leave_(run);
      }
    })().then(() => {
      context.settled();
      context.schedule();
    });
  }

  const batcher: Batcher = {
    add_(id, def, req, baseline) {
      if (!queues.has(id)) {
        take({ id_: id, reqs_: [], bases_: [], timer_: 0 });
      }
      // 1.35's defaults, read at each add.
      const { windowMs, maxSize } = { windowMs: 50, ...def.batch };
      if (queues.get(id)!.reqs_.length >= (maxSize || 10_000)) {
        flush(id);
      }
      // A flush leaves a fresh queue in its place.
      const queue = queues.get(id)!;
      queue.reqs_.push(req);
      queue.bases_.push(baseline);
      if (maxSize && queue.reqs_.length >= maxSize) {
        flush(id);
      } else if (!queue.timer_) {
        // (ap): from the first add to an empty queue, not moved by later ones.
        queue.timer_ = clock.setTimeout(() => flush(id), windowMs, {
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
            take(queue);
          }
          host.canceled_(id, req!);

          return;
        }
      }
    },
    clear_(ids) {
      for (const [id, queue] of queues) {
        for (const req of take(queue).reqs_) {
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
