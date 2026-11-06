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
 *   count check and "Batch item failed". The binding compares each key with
 *   the last baseline that read it (W5).
 * - Retracting a queued requirement takes it out of the queue and cancels
 *   it. stop() cancels the queued ones, then the running batches.
 *
 * Three owner-approved changes from 1.35 (L7 RFC, 2026-11-05):
 * - (ap) the window starts at the first add to an empty queue and does not
 *   move (1.35 restarts it on every add);
 * - (as) a running batch is in flight: `settle()`, the settled notification
 *   and `inspect()` count it (1.35's settle() resolves while it runs);
 * - (at) with only `resolve()`, each requirement starts as an ordinary
 *   single run when the window closes (1.35 runs it on a private
 *   controller that retraction, stop() and settle() cannot reach).
 *
 * L7b, approved at GATE-1 (quirks g, h, i, k) and on 2026-11-05 ((aq), (ar)):
 * - quirk g, (aq): retracting one requirement of a running batch cancels it
 *   alone, the hook given the whole requirement (resolvers.ts);
 * - quirks h and i, (ar): failed with-results items retry under the batch's
 *   policy, as a smaller call holding only them, and each reports its error
 *   once, after its last attempt; the ones that succeeded complete at once
 *   (1.35 reruns an all-failed batch at once, erroring each item on every
 *   attempt, and never retries a partly failed one);
 * - quirk k: a mixed-source batch is bound to the union of its
 *   requirements' `abortOn` keys (resolvers.ts; 1.35 binds it to none).
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
}

export const withBatch: SystemPart = (context) => {
  const { module, kernel, store } = context;
  const defs = (module.resolvers ?? {}) as Record<string, ResolverDef>;
  if (!Object.values(defs).some((def) => def?.batch?.enabled)) {
    return;
  }
  const { clock } = kernel;
  const queues = new Map<string, Queue>();
  let host: BatchHost;
  // settle() runs every queue at its start, and again at each settled
  // change while it waits (1.35's processBatches).
  kernel.define("batch", () => {
    for (const id of queues.keys()) {
      flush(id);
    }
  });

  /**
   * 1.35's executeBatchAttempt, with executeAllOrNothing or
   * executeWithResults: the handler's sync start in one store batch, then
   * the outcomes. Each requirement is one; the run's mark is set first, so
   * a stop() from a hook cancels nothing more (row t). Failed items throw
   * (quirks h and i). At 1.35's depth, so a batch's ticks are 1.35's:
   * executeBatchAttempt hands back executeWithResults' promise (two ticks
   * more) and awaits executeAllOrNothing's (one more), on every exit.
   */
  async function call(def: ResolverDef, run: Run, ctx: object) {
    const reqs = run.reqs_!;
    const name = run.resolver_;
    const many = def.resolveBatchWithResults;
    const ms = def.batch!.timeoutMs ?? def.timeout;
    // This attempt's item errors, for the run's one report.
    const errors = (run.errors_ = new Map());
    try {
      let pending: unknown;
      store.batch(() => {
        pending = (many ?? def.resolveBatch!)(
          reqs.map((req) => req.requirement),
          ctx,
        );
      });
      const results = (await (async () =>
        (ms as number) > 0
          ? withTimeout(
              clock,
              pending,
              ms!,
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
      // One retracted or superseded meanwhile reported its cancel (g, au).
      const done = reqs.filter(
        (req, i) =>
          run.reqs_!.includes(req) &&
          (!many ||
            results[i]!.success ||
            !errors.set(
              req,
              results[i]!.error ?? new Error("Batch item failed"),
            )),
      );
      const [first] = errors.values();
      if (first) {
        // Quirk i: the rest leave flight; the failed ones are the batch now,
        // and a sibling's write that satisfied its own requirement does not
        // end their retries.
        run.reqs_ = [...errors.keys()];
        run.satisfied_ &&= !done[0];
        host.leave_(run, done);
      } else {
        run.done_ = true;
      }
      for (const req of done) {
        host.tell_(run, req);
      }
      if (first) {
        throw first;
      }
    } finally {
      if (many) {
        await 0;
      }
      await 0;
    }
  }

  /** End a queue's window and put an empty one in its place; returns it. */
  const take = (id: string) => {
    const queue = queues.get(id);
    clock.clearTimeout(queue?.timer_ as number);
    queues.set(id, { reqs_: [], bases_: [], timer_: 0 });

    return queue!;
  };

  function flush(id: string) {
    if (queues.get(id)!.reqs_.length === 0) {
      return;
    }
    const { reqs_: reqs, bases_: bases } = take(id);
    const def = defs[id]!;
    if (!def.resolveBatch && !def.resolveBatchWithResults) {
      // (at): each one an ordinary single run, as 1.35 runs it unbound.
      for (const req of reqs) {
        host.start_(def, id, req);
      }

      return;
    }
    // W5: each key's last baseline; a mixed batch's span its passes (k).
    const baseline = bases.reduce<Baseline>(
      (all, base) => (base && new Map([...(all ?? []), ...base])) || all,
      undefined,
    );
    const run = host.run_(id, reqs[0]!, reqs);
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
        take(id);
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
      } else {
        // (ap): from the first add to an empty queue, not moved by later ones.
        queue.timer_ ||= clock.setTimeout(() => flush(id), windowMs, {
          owner: kernel.owner,
          kind: "batch",
        });
      }
    },
    drop_(ids, only) {
      for (const [id, { reqs_: reqs, bases_: bases }] of queues) {
        for (let i = 0; i < reqs.length; ) {
          const req = reqs[i]!;
          if (only && req.id !== only) {
            i++;
          } else {
            reqs.splice(i, 1);
            bases.splice(i, 1);
            ids.push(req.id);
            host.canceled_(id, req);
          }
        }
        // An empty queue keeps no timer: the next add opens a window.
        if (reqs.length === 0) {
          take(id);
        }
      }
    },
    queued_: () => [...queues.values()].some((queue) => queue.reqs_.length > 0),
  };
  context.batch_ = (given) => {
    host = given;

    return batcher;
  };
};
