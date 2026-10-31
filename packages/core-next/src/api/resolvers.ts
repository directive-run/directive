/**
 * Resolvers (L2): runs that fulfil requirements, with the 1.35 rules.
 *
 * - One run per requirement id in flight; a second dispatch of the same id
 *   is dropped, unless the run in flight already satisfied it with its own
 *   write. Then the requirement is back, and the new dispatch supersedes
 *   the old run: it is canceled (its one outcome) and its later writes are
 *   dropped, so it cannot overwrite the new run's result.
 * - Exactly one outcome per run: complete, cancel or error, guarded by the
 *   run's `done_` mark. So a run canceled while it waits to retry reports
 *   the cancel and nothing else (GATE-1 quirk b: 1.35 reports the cancel,
 *   then an error), and a run canceled after it reported (a pass retracts
 *   it before it leaves flight) reports nothing more.
 * - The timing is 1.35's, microtask for microtask: the retry loop has
 *   executeResolve's shape (an error is reported after processRetryError
 *   and handleRetryError resolve), and a run leaves flight, asking for a
 *   pass, in the `finally` after its outcome. The passes follow from it.
 * - Each run is a writer: its `context.facts` passes the run's id as the
 *   stamp of every write it makes (`store.set(key, value, stamp)`), so the
 *   pass can tell whether a run's own writes retracted its requirement. A
 *   write a listener makes in response carries its own stamp (0), never the
 *   run's.
 * - A satisfied run is not canceled: it stays in flight (stop aborts it,
 *   settle waits), is not retried, and reports one outcome when it ends.
 * - Each attempt has its own `context.signal`, a child of the run's: a
 *   cancel, supersede, clobber or stop() aborts the run, and so the
 *   attempt. A timeout aborts only the attempt, its reason the timeout
 *   error (candidate n, approved; 1.35 leaves the signal clean), so the next
 *   attempt starts unaborted; a satisfied run's attempt gets 1.35's plain
 *   abort instead. The outcome is still read from the run's
 *   signal: a timeout is reported as the error it is, never as a cancel, and
 *   the body's later writes land. Cancel keeps them too, so a
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
 *   never stops another writer. A dropped write that would have changed
 *   its key still counts as the run's own for own-write satisfaction, as
 *   in 1.35 (reconcile.ts).
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
  /** Batching is L7; only their presence is checked (1.35's validation). */
  resolveBatch?: Fn;
  resolveBatchWithResults?: Fn;
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
  /** The attempt running, 0 while pending (inspect()'s status). */
  attempt_: number;
  /** Its one outcome has been reported. */
  done_: boolean;
}

/** 1.35's per-attempt cap on clobber reports, then one summary. */
const CLOBBER_EMIT_CAP = 10;

export interface ResolversOptions {
  defs: Record<string, ResolverDef>;
  /** Read-only uses (`snapshot`) and the store a run batches its start in. */
  store: { batch(fn: () => void): void };
  /** A facts view whose writes carry the run's stamp, each asked of `allow`. */
  factsFor: (writer: Writer, allow?: Allow) => Facts<any>;
  /** A fact's current value, and whether it is set. */
  peek: (key: string) => unknown;
  has: (key: string) => boolean;
  /**
   * The binding dropped a write by the run with `stamp` that would have
   * changed `key`. 1.35 still counts it as the run's own write when it asks
   * whether the run satisfied its requirement (reconcile.ts).
   */
  onDrop: (key: string, stamp: number) => void;
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
  /** A run left flight on its own (not canceled), after its outcome. */
  onEnd: (run: Run) => void;
  onRequeue: (requirementId: string) => void;
}

export interface Resolvers {
  /** `baseline`: the bound keys' values before this pass dispatched anything. */
  resolve(
    req: RequirementWithId,
    baseline?: ReadonlyMap<string, unknown>,
  ): void;
  abort(requirementId: string): void;
  /** Take a run out of flight without aborting it (RFC-0003). */
  detach(requirementId: string): void;
  /** Detached runs still going. */
  detached: ReadonlySet<Run>;
  /** Cancel every run in flight; returns the ids of those with no outcome yet. */
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
  if (isDevelopment) {
    // 1.35's validateDefinitions, development only.
    for (const [id, def] of Object.entries(defs)) {
      if (!def.resolve && !def.resolveBatch && !def.resolveBatchWithResults) {
        throw new Error(
          `[Directive] Resolver "${id}" must define either resolve() or resolveBatch(). Add one of these methods to handle requirements.`,
        );
      }
      if (
        def.batch?.enabled &&
        !def.resolveBatch &&
        !def.resolveBatchWithResults
      ) {
        if (!def.resolve) {
          throw new Error(
            `[Directive] Resolver "${id}" has batch.enabled=true but no resolve(), resolveBatch(), or resolveBatchWithResults() method.`,
          );
        }
        console.warn(
          `[Directive] Resolver "${id}" has batch.enabled but no resolveBatch(). Falling back to individual resolve() calls. Add resolveBatch() for true bulk operations.`,
        );
      }
    }
  }
  const inflight = new Map<string, Run>();
  const detached = new Set<Run>();
  /** The last stamp handed out: run ids start at 1 (0 is unattributed). */
  let stamps = 0;

  const find = (req: Requirement): string | null => {
    for (const id in defs) {
      const def = defs[id];
      // As 1.35: only an object definition handles requirements.
      if (typeof def !== "object" || def === null) {
        continue;
      }
      const match = def.requirement;
      if (typeof match === "function" ? match(req) : match === req.type) {
        return id;
      }
    }

    return null;
  };

  /**
   * Take a run out of flight and abort it. The cancel is its outcome unless
   * it reported one already (1.35 would report the cancel as well).
   */
  const cancel = (run: Run) => {
    inflight.delete(run.req_.id);
    run.controller_.abort();
    if (!run.done_) {
      run.done_ = true;
      emit("resolver.cancel", () => ({
        resolver: run.resolver_,
        req: run.req_,
      }));
      emit("requirement.canceled", () => ({ req: run.req_ }));
    }
  };

  /** Complete or error: the run's one outcome. It leaves flight later. */
  const report = (run: Run, error?: Error) => {
    if (run.done_) {
      return;
    }
    run.done_ = true;
    if (error) {
      options.onError(run, error);
    } else {
      options.onComplete(run);
    }
  };

  /** Wait on the kernel clock; an abort wakes it early. */
  const wait = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      const wake = () => {
        clock.clearTimeout(timer);
        resolve();
      };
      // Each listener leaves the run's signal when its wait ends.
      const timer = clock.setTimeout(
        () => {
          signal.removeEventListener("abort", wake);
          resolve();
        },
        ms,
        { owner, kind: "retry" },
      );
      signal.addEventListener("abort", wake, { once: true });
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
    baseline: ReadonlyMap<string, unknown> | undefined,
  ): Allow {
    const expected = new Map<string, unknown>();
    for (const key of keys) {
      expected.set(key, baseline ? baseline.get(key) : options.peek(key));
    }
    /** Keys it lost to another writer: one-shot, later writes drop too. */
    let lost: Set<string> | null = null;
    let clobbers = 0;
    /**
     * 1.35's recordRunWrites sits outside the binding, so a dropped write
     * that would have changed the key (a delete: the key is set) still
     * counts as the run's own.
     */
    const drop = (key: string, actual: unknown, value: unknown, del?: true) => {
      if (del ? options.has(key) : !Object.is(actual, value)) {
        options.onDrop(key, run.stamp_);
      }
    };

    return (key, value, deleting) => {
      if (!expected.has(key)) {
        return true;
      }
      const actual = options.peek(key);
      if (lost?.has(key)) {
        drop(key, actual, value, deleting);

        return false;
      }
      const want = expected.get(key);
      if (Object.is(actual, want)) {
        expected.set(key, value);

        return true;
      }
      drop(key, actual, value, deleting);
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

  /**
   * 1.35's handleRetryError, for a run not aborted: the retry hook, then
   * the backoff wait. False ends the retries (the hook said no, or the run
   * was aborted while it waited).
   */
  async function backoff(
    policy: RetryPolicy | undefined,
    error: Error,
    attempt: number,
    signal: AbortSignal,
  ): Promise<boolean> {
    const reason = isTimeout(error) ? "timeout" : "error";
    if (
      policy?.shouldRetry &&
      !policy.shouldRetry(error, attempt, { reason })
    ) {
      return false;
    }
    // A second attempt exists only under a retry policy.
    if (policy && attempt < policy.attempts) {
      await wait(delayFor(policy, attempt, options.random), signal);

      return !signal.aborted;
    }

    return true;
  }

  /** 1.35's processRetryError: the backoff, then the retry report. */
  async function retryStep(
    run: Run,
    policy: RetryPolicy | undefined,
    error: Error,
    attempt: number,
  ): Promise<boolean> {
    const go = await backoff(policy, error, attempt, run.controller_.signal);
    if (go && policy && attempt < policy.attempts) {
      emit("resolver.retry", () => ({
        resolver: run.resolver_,
        req: run.req_,
        attempt: attempt + 1,
      }));
    }

    return go;
  }

  /** 1.35's executeResolve: the retry loop, ending in one `report` at most. */
  async function execute(
    def: ResolverDef,
    run: Run,
    baseline: ReadonlyMap<string, unknown> | undefined,
  ): Promise<void> {
    const policy = def.retry;
    const attempts = policy?.attempts ?? 1;
    /** The run's signal: every outcome below is read from it, never the attempt's. */
    const { signal } = run.controller_;
    /** Unbound: one view for every attempt. Bound: one per attempt, as 1.35. */
    let shared: Facts<any> | null = null;
    let last: Error | undefined;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      // Aborted while it waited (canceled, superseded): no outcome here.
      if (signal.aborted) {
        return;
      }
      // Satisfied while it waited to retry: nothing is left to retry for.
      // The last failure is reported once; the body had ended already.
      if (attempt > 1 && run.satisfied_) {
        break;
      }
      run.attempt_ = attempt;
      // Asked each attempt, as 1.35: a constraint found async since loses it.
      const keys = options.bindingOf(run.req_);
      const facts = keys
        ? options.factsFor(run, bind(run, keys, baseline))
        : (shared ??= options.factsFor(run));
      // The attempt's own signal (candidate n): the run's abort reaches it.
      const child = new AbortController();
      const relay = () => child.abort(signal.reason);
      signal.addEventListener("abort", relay, { once: true });
      const context = {
        facts,
        signal: child.signal,
        snapshot: () => facts.$snapshot(),
        requeue: () => options.onRequeue(run.req_.id),
      };
      // The attempt ends after its retry wait: a cancel then still reaches
      // it (as 1.35's one signal does), and its relay leaves the run's.
      try {
        await invoke(def, run, context);
        // Aborted while it ran: that was its one outcome (1.35). For a
        // clobbered run it is no outcome at all; it just leaves flight.
        if (!signal.aborted) {
          report(run);
        }

        return;
      } catch (error) {
        // Superseded: a newer run owns the requirement.
        if (run.dropped_) {
          return;
        }
        last = toError(error);
        if (run.satisfied_) {
          // It failed after satisfying its requirement: 1.35 aborts it
          // plainly (a timeout too: the attempt's reason is then the plain
          // AbortError, as 1.35's), reports the failure once, and what it
          // writes afterwards (a `finally` cleanup) still lands.
          run.controller_.abort();
          break;
        }
        if (isTimeout(last)) {
          // Only this attempt gave up: the run goes on to its retry or error.
          child.abort(last);
        }
        // Canceled or clobbered while it ran: no outcome here.
        if (signal.aborted) {
          return;
        }
        const go = await retryStep(run, policy, last, attempt);
        // Quirk b: canceled while it waited to retry; the cancel was its
        // one outcome (1.35 reports the error as well).
        if (signal.aborted) {
          return;
        }
        if (!go) {
          break;
        }
      } finally {
        signal.removeEventListener("abort", relay);
      }
    }
    report(run, last);
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
        attempt_: 0,
        done_: false,
      };
      inflight.set(req.id, run);
      emit("resolver.start", () => ({ resolver: resolverId, req }));
      execute(def, run, baseline).finally(() => {
        // 1.35 leaves flight here, a microtask after the outcome: a run
        // canceled or detached meanwhile has left already and asks for no
        // pass.
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
      const ids: string[] = [];
      for (const run of [...inflight.values()]) {
        if (!run.done_) {
          ids.push(run.req_.id);
        }
        cancel(run);
      }

      return ids;
    },
  };
}
