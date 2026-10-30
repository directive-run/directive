/**
 * Resolvers (L2): runs that fulfil requirements, with the 1.35 rules.
 *
 * - One run per requirement id in flight; a second dispatch of the same id
 *   is dropped.
 * - Exactly one outcome per run: complete, cancel or error. The in-flight
 *   slot is the one source of truth: `cancel` empties it and reports the
 *   cancel; `end` reports complete or error only while the slot still holds
 *   the run. So a run canceled while it waits to retry reports the cancel
 *   and nothing else (GATE-1 quirk b: 1.35 reports the cancel, then an
 *   error).
 * - Timeouts and retry waits are timers on the kernel clock, owned by this
 *   system (disposing the kernel clears them).
 *
 * Not here yet: writer stamps and own-write satisfaction, supersede,
 * requeue, backoff curves, jitter and `shouldRetry` (L2b); constraint
 * binding (L2c); batch resolvers (L7).
 */

import isDevelopment from "#is-development";
import type { Clock } from "../clock.js";
import { withTimeout } from "./constraints.js";
import type { Requirement, RequirementWithId } from "./requirements.js";
import type { Facts } from "./types.js";

type Fn = (...args: any[]) => any;

export interface RetryPolicy {
  attempts: number;
  /** The wait before each retry (backoff curves and jitter: L2b). */
  initialDelay?: number;
}

export interface ResolverDef {
  requirement: string | ((req: Requirement) => boolean);
  key?: (req: Requirement) => string;
  resolve?: Fn;
  retry?: RetryPolicy;
  timeout?: number;
  /** Batching is L7: until it is built, a batched resolver is not run. */
  batch?: { enabled?: boolean };
}

/** One run: a requirement being resolved. */
export interface Run {
  req_: RequirementWithId;
  resolver_: string;
  controller_: AbortController;
  startedAt_: number;
}

export interface ResolversOptions {
  defs: Record<string, ResolverDef>;
  facts: Facts<any>;
  store: { batch(fn: () => void): void };
  clock: Clock;
  owner: number;
  /** Emit a record when someone listens (the data is built lazily). */
  emit: (at: string, data: () => Record<string, unknown>) => void;
  onComplete: (run: Run) => void;
  onError: (run: Run, error: Error) => void;
  /** A run left flight on its own (not canceled). */
  onEnd: () => void;
}

export interface Resolvers {
  resolve(req: RequirementWithId): void;
  abort(requirementId: string): void;
  /** Cancel every run in flight; returns their requirement ids. */
  abortAll(): string[];
  /** The run in flight for a requirement. */
  inflight: ReadonlyMap<string, Run>;
}

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export function createResolvers(options: ResolversOptions): Resolvers {
  const { defs, facts, store, clock, owner, emit } = options;
  const inflight = new Map<string, Run>();

  const find = (req: Requirement): string | null => {
    for (const id in defs) {
      const match = defs[id]!.requirement;
      if (typeof match === "function" ? match(req) : match === req.type) {
        return id;
      }
    }

    return null;
  };

  /** A cancel is a run's outcome: it empties the slot, so nothing follows. */
  const cancel = (run: Run) => {
    inflight.delete(run.req_.id);
    run.controller_.abort();
    emit("resolver.cancel", () => ({ resolver: run.resolver_, req: run.req_ }));
    emit("requirement.canceled", () => ({ req: run.req_ }));
  };

  /** Complete or error: reported only while the slot still holds the run. */
  const end = (run: Run, error?: Error) => {
    if (inflight.get(run.req_.id) !== run) {
      return;
    }
    if (error) {
      options.onError(run, error);
    } else {
      options.onComplete(run);
    }
  };

  /** Wait on the kernel clock; an abort wakes it early. */
  const wait = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      const timer = clock.setTimeout(resolve, ms, { owner, kind: "retry" });
      signal.addEventListener(
        "abort",
        () => {
          clock.clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });

  /** The sync start runs in one batch (one pass for its writes), as in 1.35. */
  async function invoke(def: ResolverDef, run: Run, ctx: object) {
    if (!def.resolve) {
      return;
    }
    let pending: unknown;
    store.batch(() => {
      pending = def.resolve!(run.req_.requirement, ctx);
    });
    if (def.timeout && def.timeout > 0) {
      await withTimeout(
        clock,
        owner,
        pending,
        def.timeout,
        `Resolver "${run.resolver_}" timed out after ${def.timeout}ms`,
      );

      return;
    }
    await pending;
  }

  /** 1.35's executeResolve: the retry loop, ending in `end` exactly once. */
  async function execute(def: ResolverDef, run: Run): Promise<void> {
    const attempts = def.retry?.attempts ?? 1;
    const { signal } = run.controller_;
    const ctx = {
      facts,
      signal,
      snapshot: () => (facts as any).$snapshot(),
    };
    let last: Error | undefined;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await invoke(def, run, ctx);
        last = undefined;
        break;
      } catch (error) {
        last = toError(error);
        // Canceled while it ran or waited: no further attempt.
        if (signal.aborted) {
          break;
        }
        if (attempt < attempts) {
          await wait(def.retry?.initialDelay ?? 100, signal);
          if (signal.aborted) {
            break;
          }
          emit("resolver.retry", () => ({
            resolver: run.resolver_,
            req: run.req_,
            attempt: attempt + 1,
          }));
        }
      }
    }
    end(run, last);
  }

  return {
    inflight,
    resolve(req) {
      if (inflight.has(req.id)) {
        return;
      }
      const resolverId = find(req.requirement);
      if (!resolverId) {
        if (isDevelopment) {
          console.warn(
            `[Directive] No resolver found for requirement type "${req.requirement.type}" (id: ${req.id})`,
          );
        }

        return;
      }
      const def = defs[resolverId]!;
      if (def.batch?.enabled) {
        // L7 builds the batch window; until then the requirement waits
        // unmet, as it did before L2 (and the ratchet's L7 tests hold).
        return;
      }
      const run: Run = {
        req_: req,
        resolver_: resolverId,
        controller_: new AbortController(),
        startedAt_: clock.now(),
      };
      inflight.set(req.id, run);
      emit("resolver.start", () => ({ resolver: resolverId, req }));
      execute(def, run).finally(() => {
        // Only this run's own slot: a cancel already emptied it.
        if (inflight.get(req.id) === run) {
          inflight.delete(req.id);
          options.onEnd();
        }
      });
    },
    abort(requirementId) {
      const run = inflight.get(requirementId);
      if (run) {
        cancel(run);
      }
    },
    abortAll() {
      const ids = [...inflight.keys()];
      for (const run of [...inflight.values()]) {
        cancel(run);
      }

      return ids;
    },
  };
}
