/**
 * Resolvers (L2): runs that fulfil requirements, with the 1.35 rules.
 *
 * - One run per requirement id in flight; a second dispatch of the same id
 *   is dropped, unless the run in flight already satisfied it with its own
 *   write. Then the requirement is back, and the new dispatch supersedes
 *   the old run: it is canceled (its one outcome) and its later writes are
 *   dropped, so it cannot overwrite the new run's result.
 * - Exactly one outcome per run: complete, cancel or error. The in-flight
 *   slot is the one source of truth, and each outcome empties it before it
 *   reports: `cancel` for a cancel (and a supersede); `end` for complete or
 *   error, only while the slot still holds the run. So a run canceled while
 *   it waits to retry reports the cancel and nothing else (GATE-1 quirk b:
 *   1.35 reports the cancel, then an error), and a pass that commits while
 *   a completion is being reported finds no run to cancel.
 * - Each run is a writer: its `context.facts` passes the run's id as the
 *   stamp of every write it makes (`store.set(key, value, stamp)`), so the
 *   pass can tell whether a run's own writes retracted its requirement. A
 *   write a listener makes in response carries its own stamp (0), never the
 *   run's.
 * - A satisfied run is not canceled: it stays in flight (stop aborts it,
 *   settle waits), is not retried, and reports one outcome when it ends.
 * - A timeout ends the run: it aborts the run's signal (the reason is the
 *   timeout error, so `isTimeout(signal.reason)`), reports one error, and
 *   keeps the run's later writes. Cancel keeps them too, so a
 *   `finally { loading = false }` lands; only a supersede drops them.
 * - Retry: backoff (none, linear, exponential), the `maxDelay` clamp, then
 *   jitter (none, full, equal, `{ maxMs }`), at least 1 ms. The waits are
 *   timers on the kernel clock owned by this system (disposing the kernel
 *   clears them), and jitter draws from the kernel's seeded rng when it has
 *   one. `shouldRetry(error, attempt, { reason })` hears "error" or
 *   "timeout"; a canceled run is never retried (1.35: the cancel is its
 *   outcome), and "clobbered" comes with constraint binding (L2c).
 * - `context.requeue()` asks for the requirement to be dispatched again;
 *   the pass applies it once this run is out of flight.
 *
 * Not here yet: constraint binding (L2c); batch resolvers (L7).
 */

import isDevelopment from "#is-development";
import type { Clock } from "../clock.js";
import type { Writer } from "./facts.js";
import type { Requirement, RequirementWithId } from "./requirements.js";
import { isTimeout, withTimeout } from "./timeout.js";
import type { Facts } from "./types.js";

type Fn = (...args: any[]) => any;

/** Why an attempt failed, as `shouldRetry` hears it. */
export type RetryReason = "error" | "timeout" | "cancelled" | "clobbered";

export interface RetryPolicy {
  attempts: number;
  backoff?: "none" | "linear" | "exponential";
  /** The first wait, in ms. */
  initialDelay?: number;
  /** The longest wait, in ms, applied before jitter. */
  maxDelay?: number;
  jitter?: "none" | "full" | "equal" | { maxMs: number };
  shouldRetry?: (
    error: Error,
    attempt: number,
    context: { reason: RetryReason },
  ) => boolean;
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

/** One run: a requirement being resolved. Its stamp is its writer id. */
export interface Run extends Writer {
  req_: RequirementWithId;
  resolver_: string;
  controller_: AbortController;
  startedAt_: number;
  /** Its own writes retracted its requirement (decided by the pass). */
  satisfied_: boolean;
  /** Superseded: a newer run owns the requirement, later writes drop. */
  dropped_: boolean;
}

export interface ResolversOptions {
  defs: Record<string, ResolverDef>;
  /** Read-only uses (`snapshot`) and the store a run batches its start in. */
  store: { batch(fn: () => void): void };
  /** A facts view whose writes carry the run's stamp. */
  factsFor: (writer: Writer) => Facts<any>;
  clock: Clock;
  owner: number;
  /** In [0, 1): the kernel's seeded rng when it has one. */
  random: () => number;
  /** Emit a record when someone listens (the data is built lazily). */
  emit: (at: string, data: () => Record<string, unknown>) => void;
  onComplete: (run: Run) => void;
  onError: (run: Run, error: Error) => void;
  /** A run left flight on its own (not canceled), before its outcome. */
  onEnd: (run: Run) => void;
  onRequeue: (requirementId: string) => void;
}

export interface Resolvers {
  resolve(req: RequirementWithId): void;
  abort(requirementId: string): void;
  /** Cancel every run in flight; returns their requirement ids. */
  abortAll(): string[];
  /** The run in flight for a requirement. */
  inflight: ReadonlyMap<string, Run>;
}

/** 1.35's defaults: a 100 ms first wait, capped at 30 s. */
const INITIAL_DELAY_MS = 100;
const MAX_DELAY_MS = 30_000;

/** 1.35's retry wait: the backoff, clamped to `maxDelay`, then jitter, at least 1 ms. */
export function delayFor(
  policy: RetryPolicy,
  attempt: number,
  random: () => number,
): number {
  const {
    backoff,
    initialDelay = INITIAL_DELAY_MS,
    maxDelay = MAX_DELAY_MS,
    jitter,
  } = policy;
  const raw =
    backoff === "linear"
      ? initialDelay * attempt
      : backoff === "exponential"
        ? initialDelay * 2 ** (attempt - 1)
        : initialDelay;
  // Clamped before jitter, so "full" and "equal" sample within maxDelay.
  const delay = Math.min(raw, maxDelay);
  let out = delay;
  if (jitter === "full") {
    out = Math.floor(random() * delay);
  } else if (jitter === "equal") {
    out = Math.floor(delay / 2 + (random() * delay) / 2);
  } else if (typeof jitter === "object" && jitter && "maxMs" in jitter) {
    const max =
      Number.isFinite(jitter.maxMs) && jitter.maxMs > 0 ? jitter.maxMs : 0;
    out = delay + Math.floor(random() * max);
  }

  return Math.max(1, out);
}

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export function createResolvers(options: ResolversOptions): Resolvers {
  const { defs, store, clock, owner, emit } = options;
  const inflight = new Map<string, Run>();
  /** The last stamp handed out: run ids start at 1 (0 is unattributed). */
  let stamps = 0;

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

  /**
   * Complete or error, only while the slot still holds the run. The run
   * leaves flight before the outcome is reported, so nothing that runs
   * meanwhile (a pass that retracts it, a stop) can report a second one.
   */
  const end = (run: Run, error?: Error, abort?: boolean) => {
    if (inflight.get(run.req_.id) !== run) {
      return;
    }
    inflight.delete(run.req_.id);
    options.onEnd(run);
    if (!error) {
      options.onComplete(run);

      return;
    }
    if (abort) {
      // The failure ends the run: its body sees the abort, and what it
      // writes afterwards (a `finally` cleanup) still lands. A timeout is
      // the reason (L2a); a run that had satisfied its requirement is
      // aborted plainly, as 1.35 does.
      run.controller_.abort(run.satisfied_ ? undefined : error);
    }
    options.onError(run, error);
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
  async function invoke(def: ResolverDef, run: Run, context: object) {
    if (!def.resolve) {
      return;
    }
    let pending: unknown;
    store.batch(() => {
      pending = def.resolve!(run.req_.requirement, context);
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
    const policy = def.retry;
    const attempts = policy?.attempts ?? 1;
    const { signal } = run.controller_;
    const facts = options.factsFor(run);
    const context = {
      facts,
      signal,
      snapshot: () => facts.$snapshot(),
      requeue: () => options.onRequeue(run.req_.id),
    };
    let last: Error | undefined;
    /** The failure ends the body too: abort its signal with the error. */
    let abort = false;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      // Satisfied while it waited to retry: nothing is left to retry for.
      // The last failure is reported once; the body had ended already.
      if (attempt > 1 && run.satisfied_) {
        break;
      }
      try {
        await invoke(def, run, context);
        last = undefined;
        break;
      } catch (error) {
        last = toError(error);
        // Canceled or superseded while it ran: that was its one outcome.
        if (signal.aborted) {
          break;
        }
        const timedOut = isTimeout(error);
        // It failed after satisfying its requirement (1.35), or a timeout
        // ends its last attempt (L2a): its body still runs, so abort it.
        abort = run.satisfied_ || timedOut;
        if (run.satisfied_) {
          break;
        }
        const reason = timedOut ? "timeout" : "error";
        if (
          policy?.shouldRetry &&
          !policy.shouldRetry(last, attempt, { reason })
        ) {
          break;
        }
        if (attempt < attempts) {
          abort = false;
          await wait(delayFor(policy!, attempt, options.random), signal);
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
    end(run, last, abort);
  }

  return {
    inflight,
    resolve(req) {
      const current = inflight.get(req.id);
      if (current) {
        if (!current.satisfied_) {
          return;
        }
        // The requirement came back while the run that satisfied it is
        // still going: a fresh run takes over, the old one's writes drop.
        current.dropped_ = true;
        cancel(current);
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
        stamp_: ++stamps,
        req_: req,
        resolver_: resolverId,
        controller_: new AbortController(),
        startedAt_: clock.now(),
        satisfied_: false,
        dropped_: false,
      };
      inflight.set(req.id, run);
      emit("resolver.start", () => ({ resolver: resolverId, req }));
      execute(def, run).finally(() => {
        // A fallback: `end` or a cancel has emptied the slot already,
        // unless the run failed before it reached `end`.
        if (inflight.get(req.id) === run) {
          inflight.delete(req.id);
          options.onEnd(run);
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
