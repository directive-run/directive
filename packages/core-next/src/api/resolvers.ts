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
 *   "timeout"; a canceled or clobbered run is never retried (1.35: an
 *   aborted run ends before its retry policy is asked, so a single run's
 *   `shouldRetry` never hears "clobbered" either).
 * - `context.requeue()` asks for the requirement to be dispatched again;
 *   the pass applies it once this run is out of flight.
 * - Constraint binding (RFC-0003): a run whose constraint lists `abortOn`
 *   keys is bound to them. Each attempt compares, by value, the key's value
 *   with the one it expects: the dispatch pass's baseline, then its own
 *   last write that landed. If something else changed it, the write is
 *   dropped, every later write to that key by the attempt is dropped too,
 *   the run's signal aborts with `{ kind: "clobbered", fact, expected,
 *   actual }`, and `resolver.write.rejected` reports it (ten per attempt,
 *   then one summary). Writes to other keys land. An aborted run reports
 *   no outcome, as 1.35. Only the run's own writes are checked: binding
 *   never stops another writer.
 * - Detach: a bound run whose requirement is retracted leaves flight but is
 *   not aborted. It runs to the end, retries included, and reports its
 *   outcome; the requirement can be dispatched again meanwhile.
 *
 * Not here yet: batch resolvers (L7), and binding for them (quirk k).
 */

import isDevelopment from "#is-development";
import type { Clock } from "../clock.js";
import type { Allow, Writer } from "./facts.js";
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
  /** Out of flight but not aborted (RFC-0003): it still reports its outcome. */
  detached_: boolean;
}

/** 1.35's per-attempt cap on clobber reports, then one summary. */
const CLOBBER_EMIT_CAP = 10;

export interface ResolversOptions {
  defs: Record<string, ResolverDef>;
  /** Read-only uses (`snapshot`) and the store a run batches its start in. */
  store: { batch(fn: () => void): void };
  /** A facts view whose writes carry the run's stamp, each asked of `allow`. */
  factsFor: (writer: Writer, allow?: Allow) => Facts<any>;
  /** A fact's current value. */
  peek: (key: string) => unknown;
  /** The keys a requirement's constraint binds (`abortOn`), if any. */
  bindingOf: (req: RequirementWithId) => readonly string[] | undefined;
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
  /** `baseline`: the bound keys' values before this pass dispatched anything. */
  resolve(
    req: RequirementWithId,
    baseline?: Readonly<Record<string, unknown>>,
  ): void;
  abort(requirementId: string): void;
  /** Take a run out of flight without aborting it (RFC-0003). */
  detach(requirementId: string): void;
  /** Detached runs still going. */
  detached: ReadonlySet<Run>;
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
  const detached = new Set<Run>();
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
    if (run.detached_) {
      // Its slot went at the detach; 1.35 asks for no pass after it.
      detached.delete(run);
    } else if (inflight.get(run.req_.id) === run) {
      inflight.delete(run.req_.id);
      options.onEnd(run);
    } else {
      return;
    }
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

  /**
   * One attempt's binding (1.35's createBoundFacts): what it expects each
   * bound key to hold, seeded from the dispatch pass's baseline. A write
   * lands while the key still holds that value; the expected value moves to
   * the write before it lands, so a listener that changes the key during
   * the write is caught at the next one.
   */
  function bind(
    run: Run,
    keys: readonly string[],
    baseline: Readonly<Record<string, unknown>> | undefined,
  ): Allow {
    const expected = new Map<string, unknown>();
    for (const key of keys) {
      expected.set(key, baseline ? baseline[key] : options.peek(key));
    }
    /** Keys it lost to another writer: one-shot, later writes drop too. */
    let lost: Set<string> | null = null;
    let clobbers = 0;

    return (key, value) => {
      if (!expected.has(key)) {
        return true;
      }
      if (lost?.has(key)) {
        return false;
      }
      const want = expected.get(key);
      const actual = options.peek(key);
      if (Object.is(actual, want)) {
        expected.set(key, value);

        return true;
      }
      (lost ??= new Set()).add(key);
      const detail = { fact: key, expected: want, actual };
      // Ten reports, then one summary; each before the abort, so a
      // listener sees the run unaborted.
      if (++clobbers <= CLOBBER_EMIT_CAP + 1) {
        const capped = clobbers > CLOBBER_EMIT_CAP;
        emit("resolver.write.rejected", () => ({
          event: {
            kind: capped ? "summary" : "rejection",
            resolver: run.resolver_,
            req: run.req_,
            reason: "clobbered",
            // 1.35 sends its summary at the first report past the cap.
            ...(capped ? { dropped: 1 } : detail),
          },
        }));
      }
      run.controller_.abort({ kind: "clobbered", ...detail });

      return false;
    };
  }

  /** 1.35's executeResolve: the retry loop, ending in `end` exactly once. */
  async function execute(
    def: ResolverDef,
    run: Run,
    baseline: Readonly<Record<string, unknown>> | undefined,
  ): Promise<void> {
    const policy = def.retry;
    const attempts = policy?.attempts ?? 1;
    const { signal } = run.controller_;
    const contextOf = (facts: Facts<any>) => ({
      facts,
      signal,
      snapshot: () => facts.$snapshot(),
      requeue: () => options.onRequeue(run.req_.id),
    });
    /** Unbound: one view for every attempt. Bound: one per attempt, as 1.35. */
    let shared: object | null = null;
    let last: Error | undefined;
    /** The failure ends the body too: abort its signal with the error. */
    let abort = false;
    /** Aborted while it ran (canceled, superseded, clobbered): no outcome. */
    let quiet = false;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      // Satisfied while it waited to retry: nothing is left to retry for.
      // The last failure is reported once; the body had ended already.
      if (attempt > 1 && run.satisfied_) {
        break;
      }
      // Asked each attempt, as 1.35: a constraint found async since loses it.
      const keys = options.bindingOf(run.req_);
      const context = keys
        ? contextOf(options.factsFor(run, bind(run, keys, baseline)))
        : (shared ??= contextOf(options.factsFor(run)));
      try {
        await invoke(def, run, context);
        last = undefined;
        // Aborted while it ran: that was its one outcome (1.35). For a
        // clobbered run it is no outcome at all; it just leaves flight.
        quiet = signal.aborted;
        break;
      } catch (error) {
        last = toError(error);
        const timedOut = isTimeout(error);
        // It failed after satisfying its requirement (1.35, checked before
        // the abort), or a timeout ends its last attempt (L2a): its body
        // still runs, so abort it. A superseded run has no outcome.
        abort = run.satisfied_ || timedOut;
        if (run.satisfied_ && !run.dropped_) {
          break;
        }
        // Canceled, superseded or clobbered while it ran: no outcome here.
        if (signal.aborted) {
          quiet = true;
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
            quiet = true;
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
    if (!quiet) {
      end(run, last, abort);
    }
  }

  return {
    inflight,
    detached,
    resolve(req, baseline) {
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
        detached_: false,
      };
      inflight.set(req.id, run);
      emit("resolver.start", () => ({ resolver: resolverId, req }));
      execute(def, run, baseline).finally(() => {
        // `end` or a cancel has emptied the slot already, unless the run
        // was aborted while it ran (no outcome) or failed before `end`.
        detached.delete(run);
        if (inflight.get(req.id) === run) {
          inflight.delete(req.id);
          options.onEnd(run);
        }
      });
    },
    detach(requirementId) {
      const run = inflight.get(requirementId);
      if (run) {
        inflight.delete(requirementId);
        run.detached_ = true;
        detached.add(run);
      }
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
