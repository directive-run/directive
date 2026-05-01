/**
 * @directive-run/mutator
 *
 * Discriminated mutation helper. Collapses the manual `pendingAction`
 * ceremony — fact + event + constraint + resolver — into a typed handler
 * map.
 *
 * Background: across the 55-cycle Minglingo migration, 12 modules ended
 * up with the same shape:
 *   - a nullable `pendingAction` fact holding a discriminated union
 *   - an event that sets it
 *   - a constraint that fires on non-null
 *   - a resolver that switches on the discriminator and clears the fact
 *
 * That's ~50 lines of boilerplate per module times 12 modules. The
 * `defineMutator` helper below contributes all four pieces from a single
 * typed declaration, so a module that uses it spreads the fragments
 * into its `createModule` config and writes only the per-variant handler
 * bodies.
 *
 * @see ../README.md for the full API and a worked example.
 */

import { t } from "@directive-run/core";

/**
 * A keyed map of variant payloads. Each key becomes a discriminator value
 * for the mutation, each value is the payload type for that variant.
 *
 * @example
 * ```ts
 * type MyMutations = {
 *   submit: { values: FormValues };
 *   cancel: {};
 *   retry: { reason: string };
 * };
 * ```
 */
export type MutationMap = Record<string, Record<string, unknown>>;

/**
 * The shape of a `pendingMutation` fact while a mutation is queued or
 * running.
 */
export type PendingMutation<M extends MutationMap> = {
  [K in keyof M]: {
    kind: K;
    payload: M[K];
    /**
     * `pending` — queued, constraint hasn't fired yet.
     * `running` — handler is in flight.
     * `failed` — handler threw; constraint stops firing. Caller can
     *            inspect `error` and dispatch a fresh MUTATE to retry.
     */
    status: "pending" | "running" | "failed";
    /**
     * Error message from the previous run, if any. Plaintext only —
     * NEVER render this directly via `dangerouslySetInnerHTML` or
     * markdown. Truncated to 500 chars to bound XSS surface from
     * thrown messages that may echo user input.
     */
    error: string | null;
  };
}[keyof M];

/** Maximum length of a captured error message — bounded to limit XSS surface. */
const MAX_ERROR_LEN = 500;

/**
 * Coerce a thrown value to a bounded plaintext string for storage on
 * `pendingMutation.error`. Defends against:
 *   - non-Error throws (`throw "string"`, `throw 42`, `throw {}`)
 *   - Errors with non-string `.message` (overridden numeric / Symbol /
 *     buffer); naive `.length` / `.slice` would `TypeError` otherwise
 *   - extremely long messages with attacker-influenced input
 *
 * Returns at most {@link MAX_ERROR_LEN} characters of plaintext.
 * Plaintext rendering is still the only supported path on the
 * consumer side; this is defense in depth, not an XSS sanitizer.
 *
 * (R2 sec M-R2-1.)
 */
function truncateError(input: unknown): string {
  let str: string;
  if (input instanceof Error) {
    // Reading `.message` is wrapped in try/catch because a maliciously
    // constructed Error subclass may install a throwing getter on
    // `message`. Without this guard the throw escapes truncateError →
    // escapes the resolver's catch → propagates uncaught. (R4 backlog.)
    let raw: unknown;
    try {
      raw = input.message;
    } catch {
      raw = "[mutator: error.message getter threw]";
    }
    str = typeof raw === "string" ? raw : safeStringCoerce(raw);
  } else if (typeof input === "string") {
    str = input;
  } else {
    str = safeStringCoerce(input);
  }
  if (str.length <= MAX_ERROR_LEN) return str;
  return `${str.slice(0, MAX_ERROR_LEN - 1)}…`;
}

/** String() may throw for some Symbols + objects with hostile toString. */
function safeStringCoerce(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "[mutator: unstringifiable error]";
  }
}

/**
 * Handler context passed to each variant handler.
 *
 * Note: `deps` is NOT in the context. This matches the Directive resolver
 * idiom — close over deps from the outer module-factory scope:
 *
 * ```ts
 * function createFormModule(deps: FormDeps) {
 *   const mut = defineMutator<FormMutations, FormFacts>({
 *     submit: async ({ payload, facts }) => {
 *       facts.values = await deps.submit(payload.values); // ← closure
 *     },
 *   });
 *   return createModule('form', { ... });
 * }
 * ```
 */
export interface MutatorHandlerContext<F> {
  /** Live facts proxy. Reads are cache-tracked; writes invalidate. */
  facts: F;
  /**
   * Trigger a same-constraint re-fire after this handler returns. Useful
   * when one mutation cascades into another — without `requeue`, the next
   * mutation would stall behind same-flush suppression.
   *
   * @see https://docs.directive.run/testing/chained-pipelines
   */
  requeue: () => void;
}

/**
 * Variant handler body. Receives the typed payload + a context; returns
 * void or a Promise. Throwing is fine — the runtime captures into
 * `pendingMutation.error` before clearing the fact.
 */
export type MutationHandler<
  M extends MutationMap,
  K extends keyof M,
  F,
> = keyof M[K] extends never
  ? (ctx: MutatorHandlerContext<F>) => void | Promise<void>
  : (
      ctx: MutatorHandlerContext<F> & { payload: M[K] },
    ) => void | Promise<void>;

/**
 * The full handler map. Every variant in `M` MUST have a handler.
 */
export type MutationHandlers<M extends MutationMap, F> = {
  [K in keyof M]: MutationHandler<M, K, F>;
};

/**
 * The fragments returned by `defineMutator`. Spread each fragment into
 * the matching position of your `createModule` config.
 *
 * @internal Shape documented for type clarity; users typically just
 * spread.
 */
export interface MutatorFragments<M extends MutationMap, F> {
  /** Spread into `schema.facts`. Adds `pendingMutation`. */
  facts: {
    pendingMutation: ReturnType<typeof t.object>;
  };
  /** Spread into `schema.events`. Adds the `MUTATE` event. */
  events: {
    MUTATE: PendingMutation<M>;
  };
  /** Spread into `schema.requirements`. Adds `PROCESS_MUTATION`. */
  requirements: {
    PROCESS_MUTATION: Record<string, never>;
  };
  /** Spread into the `events` field. Sets pendingMutation on MUTATE. */
  eventHandlers: {
    MUTATE: (facts: F, payload: PendingMutation<M>) => void;
  };
  /** Spread into the `constraints` field. */
  constraints: {
    pendingMutation: {
      when: (facts: F) => boolean;
      require: { type: "PROCESS_MUTATION" };
    };
  };
  /** Spread into the `resolvers` field. */
  resolvers: {
    mutationResolver: {
      requirement: "PROCESS_MUTATION";
      resolve: (
        req: { type: "PROCESS_MUTATION" },
        ctx: { facts: F },
      ) => Promise<void>;
    };
  };
  /**
   * Convenience: the initial value for `pendingMutation`. Set this in
   * your module's `init` if you don't use `t.X().default(...)` defaults.
   */
  initialPendingMutation: null;
}

/**
 * Define a mutator fragment-set for a given variant map and handlers.
 *
 * @example
 * ```ts
 * type FormMutations = {
 *   submit: { values: FormValues };
 *   cancel: {};
 * };
 *
 * // The second generic is the FACTS type (not deps). Deps are
 * // captured in closure from the surrounding scope, not passed in
 * // through the handler ctx.
 * const formMutator = defineMutator<FormMutations, FormFacts>({
 *   submit: async ({ payload, facts }) => {
 *     facts.values = await deps.submit(payload.values); // deps closes over outer scope
 *   },
 *   cancel: ({ facts }) => { facts.values = []; },
 * });
 *
 * createModule('form', {
 *   schema: {
 *     facts: { ...formMutator.facts, values: t.array<FormValues>() },
 *     events: { ...formMutator.events, REFRESH: {} },
 *     requirements: { ...formMutator.requirements },
 *   },
 *   init: (f) => { f.pendingMutation = null; f.values = []; },
 *   events: {
 *     ...formMutator.eventHandlers,
 *     REFRESH: (f) => { f.values = []; },
 *   },
 *   constraints: { ...formMutator.constraints },
 *   resolvers: { ...formMutator.resolvers },
 * });
 *
 * // Usage:
 * sys.events.MUTATE(mutate<FormMutations>('submit', { values: ... }));
 *
 * // Or, if constructing the payload manually, the discriminator is
 * // `kind` (NOT `type` — `type` collides with Directive's event-name
 * // dispatch convention):
 * sys.events.MUTATE({
 *   kind: 'submit',
 *   payload: { values: ... },
 *   status: 'pending',
 *   error: null,
 * });
 * ```
 *
 * The handler-bound deps are captured at `defineMutator` call time. To
 * inject deps from the caller, wrap `defineMutator` in your module
 * factory:
 *
 * ```ts
 * export function createFormModule(deps: FormDeps) {
 *   const mut = defineMutator<FormMutations, FormFacts>({
 *     submit: async ({ payload, facts }) => {
 *       facts.values = await deps.submit(payload.values);
 *     },
 *     cancel: ({ facts }) => { facts.values = []; },
 *   });
 *   return createModule('form', { ... });
 * }
 * ```
 */
export function defineMutator<
  M extends MutationMap,
  F = Record<string, unknown>,
>(handlers: MutationHandlers<M, F>): MutatorFragments<M, F> {
  type Pending = PendingMutation<M>;

  const facts = {
    pendingMutation: t.object<Pending>().nullable() as ReturnType<
      typeof t.object
    >,
  } as MutatorFragments<M, F>["facts"];

  // Schema event marker — the runtime uses this for typing and devtools.
  // Payload validation happens at dispatch time via t-schema check.
  const events = {
    MUTATE: undefined as unknown as Pending,
  } as MutatorFragments<M, F>["events"];

  const requirements = {
    PROCESS_MUTATION: {} as Record<string, never>,
  } as MutatorFragments<M, F>["requirements"];

  const eventHandlers = {
    MUTATE: (facts: F, payload: Pending) => {
      // Overwrite is intentional — caller is responsible for ordering.
      // If a previous mutation is mid-flight, the new one queues by
      // overwriting; the in-flight handler will null the fact when it
      // completes, then the constraint re-fires for the new one.
      // (Same as the manual pattern across all 12 audited modules.)
      (facts as { pendingMutation: Pending | null }).pendingMutation = {
        ...payload,
        status: "pending",
        error: null,
      };
    },
  } as MutatorFragments<M, F>["eventHandlers"];

  const constraints = {
    pendingMutation: {
      when: (facts: F) =>
        (facts as { pendingMutation: Pending | null }).pendingMutation !==
          null &&
        (facts as { pendingMutation: Pending | null }).pendingMutation
          ?.status === "pending",
      require: { type: "PROCESS_MUTATION" } as const,
    },
  } as MutatorFragments<M, F>["constraints"];

  const resolvers = {
    mutationResolver: {
      requirement: "PROCESS_MUTATION" as const,
      resolve: async (
        _req: { type: "PROCESS_MUTATION" },
        ctx: {
          facts: F;
          requeue?: () => void;
        },
      ) => {
        const factsRef = ctx.facts as { pendingMutation: Pending | null };
        const pending = factsRef.pendingMutation;
        if (pending === null) return;

        // Stamp the in-flight transition with the running status. The
        // status itself is the supersession marker: only this resolver
        // ever writes 'running'; the eventHandler always writes
        // 'pending'. So if a fresh MUTATE arrives mid-flight, the
        // post-handler check sees status: 'pending' instead of
        // 'running' and knows to leave the new dispatch alone.
        // (Sec M5 / DX M2.)
        factsRef.pendingMutation = { ...pending, status: "running" };

        // Prototype-pollution defense: only accept handlers OWNED by
        // the user-provided map. Without this, dispatching with kind:
        // 'constructor' / 'toString' / '__proto__' would resolve via
        // the prototype chain and either crash or invoke an inherited
        // function with arbitrary payload. (Sec C1.)
        const ownsHandler = Object.prototype.hasOwnProperty.call(
          handlers,
          pending.kind as PropertyKey,
        );
        const handler = ownsHandler
          ? (handlers as Record<string, unknown>)[pending.kind as string]
          : undefined;

        if (typeof handler !== "function") {
          factsRef.pendingMutation = {
            ...pending,
            status: "failed",
            error: truncateError(
              `[mutator] no handler registered for variant: ${String(
                pending.kind,
              )}`,
            ),
          };
          return;
        }

        const handlerCtx = {
          facts: ctx.facts,
          payload: pending.payload,
          requeue: ctx.requeue ?? (() => {}),
        };

        try {
          await (handler as (c: typeof handlerCtx) => Promise<void> | void)(
            handlerCtx,
          );
          // Success: clear the fact ONLY if this resolver's `running`
          // marker is still live (status === 'running'). If a fresh
          // MUTATE arrived mid-flight via the eventHandler, the fact
          // now has status: 'pending' — leave it alone so the next
          // constraint fire picks it up. (Sec M5 / DX M2.)
          if (factsRef.pendingMutation?.status === "running") {
            factsRef.pendingMutation = null;
          }
        } catch (err) {
          // Failure: only stamp the error if our running marker is
          // still live. If a fresh MUTATE arrived mid-flight, the new
          // dispatch wins; the failed mutation's error is dropped on
          // the floor (caller wanted to move on anyway). (Sec M5.)
          if (factsRef.pendingMutation?.status !== "running") return;
          factsRef.pendingMutation = {
            ...pending,
            // 'failed' is a distinct status (Sec M6 / Arch C2) — UI can
            // disambiguate "still in flight" from "stopped on error".
            status: "failed",
            // truncateError handles the unknown shape safely — non-Error
            // throws, non-string Error.message, hostile toString. (R2
            // sec M-R2-1.)
            error: truncateError(err),
          };
        }
      },
    },
  } as MutatorFragments<M, F>["resolvers"];

  return {
    facts,
    events,
    requirements,
    eventHandlers,
    constraints,
    resolvers,
    initialPendingMutation: null,
  };
}

/**
 * Helper for typed dispatch. Lets the caller construct a mutation payload
 * with full type narrowing — the `kind` field auto-restricts the
 * `payload` shape.
 *
 * @example
 * ```ts
 * sys.events.MUTATE(mutate<FormMutations>('submit', { values: ... }));
 * sys.events.MUTATE(mutate<FormMutations>('cancel'));
 * ```
 */
// Single type parameter (M) so callers can specialize with
// `mutate<FormMutations>(...)` without TypeScript demanding the
// inferred K. TS's strict type-argument rules treat <M, K> as
// "supply both or supply neither" — single-arg call sites failed
// with "Expected 2 type arguments, but got 1." Single-M form sidesteps
// that while keeping payload typing tight via the `kind` lookup.
export function mutate<M extends MutationMap>(
  kind: keyof M & string,
  payload: M[typeof kind],
): PendingMutation<M>;
export function mutate<M extends MutationMap>(
  kind: keyof M & string,
): PendingMutation<M>;
export function mutate<M extends MutationMap>(
  kind: keyof M & string,
  payload?: M[typeof kind],
): PendingMutation<M> {
  return {
    kind,
    payload: (payload ?? {}) as M[typeof kind],
    status: "pending",
    error: null,
  } as PendingMutation<M>;
}

// ============================================================================
// cancellable() — auto-cancel-on-supersede (R1.C v0.1)
// ============================================================================

/**
 * Options for {@link cancellable}.
 */
export interface CancellableOptions {
  /**
   * When to fire the AbortSignal that the wrapped handler receives.
   *
   * - `'self'` (default): a new dispatch of the SAME handler aborts the
   *   prior in-flight invocation. The classic "cancel previous on new
   *   keystroke" pattern.
   * - `'never'`: only the timeout fires the signal; new dispatches do
   *   NOT abort prior ones. Useful when you want a hard timeout but
   *   parallel runs are fine.
   */
  supersedeOn?: "self" | "never";

  /**
   * Maximum ms a handler may run before its signal is aborted. Counted
   * from the start of THIS invocation. Combine with `realClock` for
   * production or pass a `setTimeout` shim for deterministic testing.
   */
  timeoutMs?: number;

  /**
   * Optional `setTimeout` injection. Defaults to `globalThis.setTimeout`.
   * For deterministic tests, pass `virtualClock.setTimeout` from
   * `@directive-run/core` so the timeout fires under
   * `clock.advanceBy()` instead of wall-clock real time.
   *
   * @example
   * ```ts
   * import { virtualClock } from '@directive-run/core';
   * const clock = virtualClock(0);
   * cancellable({ timeoutMs: 1_000, setTimeout: clock.setTimeout }, handler);
   * ```
   */
  setTimeout?: (cb: () => void, ms: number) => () => void;
}

/**
 * Handler context augmented with a cancellation signal.
 */
export interface CancellableHandlerContext<F, P> {
  facts: F;
  payload: P;
  /** Aborts when a new dispatch supersedes this one OR the timeout fires. */
  signal: AbortSignal;
  requeue: () => void;
}

/**
 * Reason a cancellable handler's signal aborted. Stamped on
 * `signal.reason` so the handler can disambiguate.
 */
export type CancelReason =
  | { kind: "superseded" }
  | { kind: "timeout"; afterMs: number };

/**
 * Wrap a mutator handler with auto-cancellation. The wrapped handler
 * receives an extra `signal: AbortSignal` in its context. Use the
 * signal to short-circuit awaitable work — pass it to `fetch(url, {
 * signal })`, watch it inside long-running loops, etc.
 *
 * Two cancellation triggers, both opt-in via {@link CancellableOptions}:
 *
 *   1. **Supersession** (default `supersedeOn: 'self'`): when a new
 *      dispatch of the same wrapped handler arrives while a prior
 *      invocation is still running, the prior signal aborts.
 *   2. **Timeout** (default `timeoutMs: undefined`, meaning no timeout):
 *      after `timeoutMs` ms from invocation start, the signal aborts.
 *
 * If a handler's signal aborts, the handler should observe the abort
 * (via `signal.aborted` or the AbortError-throwing helpers) and
 * return promptly. The signal's `reason` carries a {@link CancelReason}
 * disambiguating which trigger fired.
 *
 * Compose with {@link defineMutator} by using `cancellable()` directly
 * in the handler map:
 *
 * @example
 * ```ts
 * import { defineMutator, cancellable } from '@directive-run/mutator';
 *
 * const formMutator = defineMutator<MyMutations, MyFacts>({
 *   search: cancellable(
 *     { supersedeOn: 'self', timeoutMs: 3_000 },
 *     async ({ payload, facts, signal }) => {
 *       const res = await fetch(`/q?${payload.q}`, { signal });
 *       facts.results = await res.json();
 *     },
 *   ),
 *   submit: async ({ payload, facts }) => {
 *     // No cancellation needed for submit — plain handler.
 *     facts.values = await deps.submit(payload.values);
 *   },
 * });
 * ```
 *
 * **Idempotency note.** The wrapped handler stays a regular
 * `MutationHandler<M, K, F>` from the mutator's perspective. The
 * supersession registry is closure-scoped per `cancellable()` call —
 * two separate `cancellable(...)` HOCs around different handlers do
 * NOT cancel each other.
 *
 * **Test ergonomics.** Pass `virtualClock.setTimeout` via the
 * `setTimeout` option to make timeouts deterministic under
 * `clock.advanceBy(ms)`. Without that, timeouts use wall-clock
 * `globalThis.setTimeout` and are real-time.
 */
export function cancellable<F, P>(
  opts: CancellableOptions,
  handler: (ctx: CancellableHandlerContext<F, P>) => Promise<void> | void,
): (ctx: { facts: F; payload: P; requeue: () => void }) => Promise<void> {
  const supersedeOn = opts.supersedeOn ?? "self";
  const timeoutMs = opts.timeoutMs;
  const scheduleTimeout = opts.setTimeout ?? defaultSetTimeout;

  // Closure-scoped supersession slot — one entry for the wrapped
  // handler. When a new invocation arrives, the prior entry's
  // controller aborts before the new one starts.
  let priorController: AbortController | undefined;

  return async (ctx: { facts: F; payload: P; requeue: () => void }) => {
    // Supersession: abort the prior in-flight invocation, if any.
    if (supersedeOn === "self" && priorController !== undefined) {
      priorController.abort({ kind: "superseded" } satisfies CancelReason);
    }

    const controller = new AbortController();
    priorController = controller;

    // Timeout: schedule an abort after `timeoutMs`. The cancel handle
    // returned by `scheduleTimeout` lets us clear the timer if the
    // handler completes first (saves leaking timers under a barrage
    // of dispatches).
    let cancelTimeout: (() => void) | undefined;
    if (typeof timeoutMs === "number" && timeoutMs > 0) {
      cancelTimeout = scheduleTimeout(() => {
        controller.abort({ kind: "timeout", afterMs: timeoutMs } satisfies CancelReason);
      }, timeoutMs);
    }

    try {
      await handler({
        facts: ctx.facts,
        payload: ctx.payload,
        requeue: ctx.requeue,
        signal: controller.signal,
      });
    } finally {
      // Clean up: clear the timeout (if it hasn't fired) and release
      // the supersession slot if it still belongs to this invocation.
      cancelTimeout?.();
      if (priorController === controller) {
        priorController = undefined;
      }
    }
  };
}

/**
 * Default `setTimeout` shim — wraps `globalThis.setTimeout` to match
 * the cancel-handle signature `cancellable()` expects.
 */
function defaultSetTimeout(cb: () => void, ms: number): () => void {
  const handle = globalThis.setTimeout(cb, ms);
  return () => globalThis.clearTimeout(handle);
}
