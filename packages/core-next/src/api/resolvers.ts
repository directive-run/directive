/**
 * Resolvers (L2 spike): runs that fulfil requirements, with the 1.35 rules.
 *
 * - One run per requirement id in flight; a second dispatch of the same id
 *   is dropped, unless the run in flight already satisfied it: then the new
 *   dispatch supersedes it (aborted, its later writes dropped).
 * - Exactly one outcome per run: complete, cancel or error.
 * - Retry with backoff and jitter, and timeouts, on the kernel clock with
 *   this system as the timers' owner (dispose clears them). Jitter draws
 *   from the kernel's seeded rng when it has one.
 * - Each run is a writer: its `ctx.facts` stamps every write it makes with
 *   the run's id (A3 writer stamps). The pass reads the stamps to decide
 *   whether a run's own writes retracted its requirement.
 *
 * Batch resolvers (L7) are not in the spike.
 *
 * SPIKE: not reviewed, not for merge. See docs/rfc-l2-reconcile.md.
 */

import isDevelopment from "#is-development";
import type { Clock, Rng } from "../clock.js";
import { isTimeout, withTimeout } from "./constraints.js";
import type { Requirement, RequirementWithId } from "./requirements.js";
import type { Facts, FactsStore } from "./types.js";

type Fn = (...args: any[]) => any;

export interface RetryPolicy {
  attempts: number;
  backoff?: "none" | "linear" | "exponential";
  initialDelay?: number;
  maxDelay?: number;
  jitter?: "none" | "full" | "equal" | { maxMs: number };
  shouldRetry?: (
    error: Error,
    attempt: number,
    context: { reason: string },
  ) => boolean;
}

export interface ResolverDef {
  requirement: string | ((req: Requirement) => boolean);
  key?: (req: Requirement) => string;
  resolve?: Fn;
  retry?: RetryPolicy;
  timeout?: number;
}

/** One run: a requirement being resolved. Its id is its writer stamp. */
export interface Run {
  id_: number;
  req_: RequirementWithId;
  resolver_: string;
  controller_: AbortController;
  startedAt_: number;
  /** Its own write retracted its requirement (decided by the pass). */
  satisfied_: boolean;
  /** Superseded: a newer run owns the requirement, later writes drop. */
  discard_: boolean;
}

export interface ResolversOptions {
  defs: Record<string, ResolverDef>;
  facts: Facts<any>;
  store: FactsStore<any>;
  clock: Clock;
  owner: number;
  rng?: Rng;
  /** Emit a record when someone listens (the data is built lazily). */
  emit: (at: string, data: () => Record<string, unknown>) => void;
  onComplete: (run: Run) => void;
  onError: (run: Run, error: Error) => void;
  /** A run left flight on its own (not canceled); `satisfied` as decided. */
  onEnd: (satisfied: boolean) => void;
  onRequeue: (requirementId: string) => void;
}

export interface Resolvers {
  resolve(req: RequirementWithId): void;
  abort(requirementId: string): void;
  abortAll(): void;
  markSatisfied(requirementId: string): void;
  /** The run in flight for a requirement. */
  inflight: ReadonlyMap<string, Run>;
  /** Runs started and not yet ended or canceled (they may write). */
  live: ReadonlySet<Run>;
  /** The writer of the write in progress (0: not a run), consumed by one stamp. */
  takeWriter(): number;
}

const DEFAULT_RETRY = {
  attempts: 1,
  backoff: "none",
  initialDelay: 100,
  maxDelay: 30000,
} as const;

/** 1.35's backoff: clamp to maxDelay, then jitter, at least 1 ms. */
function delayFor(policy: RetryPolicy, attempt: number, random: () => number) {
  const { backoff, initialDelay = 100, maxDelay = 30000, jitter } = policy;
  const raw =
    backoff === "linear"
      ? initialDelay * attempt
      : backoff === "exponential"
        ? initialDelay * 2 ** (attempt - 1)
        : initialDelay;
  const d = Math.min(raw, maxDelay);
  let out = d;
  if (jitter === "full") {
    out = Math.floor(random() * d);
  } else if (jitter === "equal") {
    out = Math.floor(d / 2 + (random() * d) / 2);
  } else if (typeof jitter === "object" && jitter && "maxMs" in jitter) {
    const max =
      Number.isFinite(jitter.maxMs) && jitter.maxMs > 0 ? jitter.maxMs : 0;
    out = d + Math.floor(random() * max);
  }

  return Math.max(1, out);
}

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export function createResolvers(options: ResolversOptions): Resolvers {
  const { defs, facts, store, clock, owner, emit } = options;
  const random = options.rng ?? Math.random;
  const inflight = new Map<string, Run>();
  const live = new Set<Run>();
  let next = 0;
  let writer = 0;

  const find = (req: Requirement): string | null => {
    for (const id in defs) {
      const match = defs[id]!.requirement;
      if (typeof match === "string" ? match === req.type : match(req)) {
        return id;
      }
    }

    return null;
  };

  const cancel = (run: Run) => {
    run.controller_.abort();
    live.delete(run);
    inflight.delete(run.req_.id);
    emit("resolver.cancel", () => ({ resolver: run.resolver_, req: run.req_ }));
    emit("requirement.canceled", () => ({ req: run.req_ }));
  };

  /** `ctx.facts` for one run: stamps its writes, drops them once superseded. */
  const writesOf = (run: Run): Facts<any> => {
    const as =
      (fn: () => boolean): (() => boolean) =>
      () => {
        if (run.discard_) {
          return true;
        }
        const outer = writer;
        writer = run.id_;
        try {
          return fn();
        } finally {
          writer = outer;
        }
      };

    return new Proxy(facts, {
      set: (t, key, value) => as(() => Reflect.set(t, key, value))(),
      deleteProperty: (t, key) => as(() => Reflect.deleteProperty(t, key))(),
    });
  };

  /** Sleep on the kernel clock; an abort wakes it early. */
  const sleep = (ms: number, signal: AbortSignal) =>
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

  /** 1.35's executeResolve: the retry loop and the one outcome. */
  async function execute(def: ResolverDef, run: Run): Promise<void> {
    const policy = { ...DEFAULT_RETRY, ...def.retry } as RetryPolicy;
    const { signal } = run.controller_;
    const ctx = {
      facts: writesOf(run),
      signal,
      snapshot: () => (facts as any).$snapshot(),
      requeue: () => options.onRequeue(run.req_.id),
    };
    let last: Error | null = null;
    for (let attempt = 1; attempt <= policy.attempts; attempt++) {
      if (signal.aborted) {
        return;
      }
      // Satisfied while waiting to retry: nothing is left to retry for.
      if (attempt > 1 && run.satisfied_) {
        break;
      }
      try {
        await invoke(def, run, ctx);
        // Canceled or superseded: that was its one outcome.
        if (signal.aborted) {
          return;
        }
        options.onComplete(run);

        return;
      } catch (error) {
        if (run.discard_) {
          return;
        }
        if (run.satisfied_) {
          // Reported once; like a cancel, its later writes still land.
          run.controller_.abort();
          last = toError(error);
          break;
        }
        if (signal.aborted) {
          return;
        }
        last = toError(error);
        const reason = isTimeout(error) ? "timeout" : "error";
        if (
          policy.shouldRetry &&
          !policy.shouldRetry(last, attempt, { reason })
        ) {
          break;
        }
        if (attempt < policy.attempts) {
          await sleep(delayFor(policy, attempt, random), signal);
          // 1.35: an abort during the backoff ends the loop and reports the
          // last error (handleRetryError returns "abort").
          if (signal.aborted) {
            break;
          }
          const nextAttempt = attempt + 1;
          emit("resolver.retry", () => ({
            resolver: run.resolver_,
            req: run.req_,
            attempt: nextAttempt,
          }));
        }
      }
    }
    options.onError(run, last!);
  }

  return {
    inflight,
    live,
    resolve(req) {
      const current = inflight.get(req.id);
      if (current) {
        if (!current.satisfied_) {
          return;
        }
        // The requirement came back while a run that satisfied it is going.
        current.discard_ = true;
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
      const run: Run = {
        id_: ++next,
        req_: req,
        resolver_: resolverId,
        controller_: new AbortController(),
        startedAt_: clock.now(),
        satisfied_: false,
        discard_: false,
      };
      inflight.set(req.id, run);
      live.add(run);
      emit("resolver.start", () => ({ resolver: resolverId, req }));
      execute(def, run).finally(() => {
        live.delete(run);
        if (inflight.get(req.id) === run) {
          inflight.delete(req.id);
          options.onEnd(run.satisfied_);
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
      for (const run of [...inflight.values()]) {
        cancel(run);
      }
    },
    markSatisfied(requirementId) {
      const run = inflight.get(requirementId);
      if (run) {
        run.satisfied_ = true;
      }
    },
    takeWriter() {
      const w = writer;
      writer = 0;

      return w;
    },
  };
}
