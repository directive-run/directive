/**
 * Effect Types - Type definitions for effects
 */

import type { EffectFacts } from "./facts.js";
import type { DefinitionMeta } from "./meta.js";
import type { FactPredicate } from "./predicate.js";
import type { InferSchema, Schema } from "./schema.js";

// ============================================================================
// Effect Types
// ============================================================================

/**
 * A cleanup function returned by an effect's `run()`.
 * Called before the effect re-runs (when deps change) or when the system stops/destroys.
 * Use for teardown: closing WebSocket connections, clearing intervals, removing DOM listeners, etc.
 */
export type EffectCleanup = () => void;

/**
 * Effect definition - side effects with optional cleanup.
 *
 * ## Effects vs Constraints
 *
 * Use **Effects** for:
 * - Logging and analytics
 * - DOM manipulation (scrolling, focus)
 * - External notifications (toasts, alerts)
 * - Syncing to localStorage/sessionStorage
 * - WebSocket connections, intervals, DOM listeners (return cleanup)
 * - Any side effect that doesn't need tracking or retry
 *
 * Use **Constraints** for:
 * - Data fetching (API calls)
 * - Async operations that may fail and need retry
 * - Operations that produce requirements to be resolved
 * - Anything that needs cancellation support
 * - Operations where you need to know completion status
 *
 * Key differences:
 * - Effects run and are forgotten - no retry, no cancellation, no status tracking
 * - Constraints produce requirements that resolvers fulfill with full lifecycle management
 * - Effects are synchronous in the reconciliation loop
 * - Constraints/resolvers can be async with timeout, retry, and batching
 *
 * ## Cleanup
 *
 * Return a cleanup function from `run()` to tear down resources:
 *
 * @example
 * ```typescript
 * effects: {
 *   websocket: {
 *     deps: ["userId"],
 *     run: (facts) => {
 *       const ws = new WebSocket(`/ws/${facts.userId}`);
 *       return () => ws.close(); // Cleanup when userId changes or system stops
 *     },
 *   },
 *   interval: {
 *     run: (facts) => {
 *       const id = setInterval(() => sync(facts), 5000);
 *       return () => clearInterval(id);
 *     },
 *   },
 * }
 * ```
 *
 * ## A fact dependency and a derivation dependency wake differently
 *
 * A fact dependency fires on a **change**. Writing `facts.userId = "u1"` when it
 * is already `"u1"` is not a change, so the effect above does not re-run and the
 * socket is not torn down and rebuilt.
 *
 * A derivation dependency fires on **possible movement**. A derivation is lazy:
 * when the facts underneath it change, all the system knows is that its value
 * may no longer be the cached one, and finding out costs running the derivation
 * — which is the one thing a lazy value is not allowed to do on its own. So the
 * effect is woken, and it is woken again on the next fact change, and the next,
 * for as long as its inputs keep moving. The derived value staying `true`
 * throughout does not quiet it. This is true whether the dependency is declared
 * in `deps` or picked up by auto-tracking from a `system.derive.x` read in the
 * body.
 *
 * That difference is invisible until an effect has a teardown. The socket below
 * is closed and reopened on every heartbeat, because every heartbeat moves the
 * facts `shouldConnect` reads even though `shouldConnect` itself never moves:
 *
 * @example
 * ```typescript
 * // Reopens on every write to `beats`.
 * derive: { shouldConnect: (facts) => facts.userId !== "" && facts.beats >= 0 },
 * effects: {
 *   socket: {
 *     deps: ["shouldConnect"],
 *     run: () => {
 *       const ws = new WebSocket("/ws");
 *       return () => ws.close();
 *     },
 *   },
 * }
 * ```
 *
 * Guard on the value when the effect owns a resource. Read the derivation, keep
 * what it was, and do nothing when it has not moved:
 *
 * @example
 * ```typescript
 * let connected: WebSocket | null = null;
 *
 * effects: {
 *   socket: {
 *     deps: ["shouldConnect"],
 *     run: () => {
 *       const shouldConnect = system.derive.shouldConnect;
 *       if (shouldConnect === (connected !== null)) {
 *         return; // The value did not move — leave the socket alone.
 *       }
 *       if (!shouldConnect) {
 *         connected?.close();
 *         connected = null;
 *         return;
 *       }
 *       connected = new WebSocket("/ws");
 *     },
 *   },
 * }
 * ```
 *
 * The guard replaces the cleanup return rather than sitting beside it: a
 * returned cleanup runs before every re-run, including the ones the guard exists
 * to make into no-ops. That trade is the whole point, and it has a cost — the
 * socket is now yours to close when the system stops, since nothing is holding a
 * cleanup for it.
 *
 * An effect that only reads — logging, analytics, a metric — needs none of this.
 */
export interface EffectDef<
  S extends Schema,
  DerivationIds extends string = never,
  Derived = Record<string, unknown>,
> {
  /**
   * The effect body.
   *
   * `derived` is the system's derived values — read it rather than reaching
   * back through `system.derive`, which is the single-module accessor and
   * resolves a namespace instead of a value once the module is composed into a
   * `createSystem({ modules })`. Third rather than second because `facts` and
   * `prevFacts` already hold the first two positions.
   *
   * Effects read facts; they never write them. `facts` is a read-only view:
   * assigning to it, deleting from it, or writing through `facts.$store`
   * throws in development and is ignored in production. That holds after an
   * `await`, inside the cleanup the body returns, and in any callback the
   * body starts, because all of them write through the same view.
   *
   * Reach for the primitive that owns the change instead:
   * - an **event handler** for a change caused by input,
   * - a **derivation** for a value computed from other facts,
   * - a **resolver** for work a constraint requires,
   * - a **source** (`publish`) or a resolver for data that comes back from
   *   async work, such as a fetch or a socket message.
   *
   * An effect wakes only for the facts its *last* run read. A short-circuit
   * such as `facts.a || facts.b` skips reading `b` while `a` is truthy, so a
   * change to `b` alone does not wake it. Read both up front, or declare
   * `deps`, when the body acts on both.
   *
   * After a history navigation (`goBack`, `goForward`, `goTo`, `replay`,
   * `import`) the effect runs again for the restored facts it depends on, so
   * what it shows the outside world matches the rewound state. Set
   * `onNavigate: "skip"` to opt out.
   */
  run(
    facts: EffectFacts<S>,
    prevFacts: Readonly<InferSchema<S>> | null,
    derived: Derived,
    // biome-ignore lint/suspicious/noConfusingVoidType: void semantics needed for implicit no-return
  ): void | EffectCleanup | Promise<void | EffectCleanup>;
  /**
   * Optional explicit dependencies for optimization.
   *
   * Fact keys **and** derivation IDs. A derivation is a legitimate thing for an
   * effect to depend on — it is what auto-tracking records when the body reads
   * one — and an async effect, whose reads happen past an `await` where
   * auto-tracking cannot see them, has this as its only way to say so.
   *
   * `DerivationIds` is supplied by the module that owns the effect; standalone
   * uses of this type get fact keys alone, which is all they have.
   *
   * A derivation named here wakes the effect on *possible* movement, not on a
   * confirmed change — see the note on {@link EffectDef} above, and guard on the
   * value if the effect owns a resource.
   */
  deps?: Array<(keyof InferSchema<S> & string) | DerivationIds>;
  /**
   * Optional declarative trigger — a {@link FactPredicate} that gates whether
   * `run()` fires: even when a dependency changes, the effect runs only if
   * the predicate currently holds. Mutually exclusive with `deps` — the
   * predicate supplies its own deps via static extraction.
   *
   * @example on: { phase: "red", elapsed: { $gte: 30 } }
   */
  on?: FactPredicate<InferSchema<S>>;
  /**
   * What the effect does when a history navigation (`goBack`, `goForward`,
   * `goTo`, `replay`, `import`) restores facts it depends on.
   *
   * - `"rerun"` (default): run again, so what the effect shows the outside
   *   world (a canvas, the DOM, a document title) matches the restored state.
   * - `"skip"`: stay quiet. Use it for effects that record acts rather than
   *   mirror state, such as analytics or an audit log, where replaying a
   *   timeline must not report it twice.
   */
  onNavigate?: "rerun" | "skip";
  /** Optional metadata for debugging and devtools (never read on hot path). */
  meta?: DefinitionMeta;
}

/** Map of effect definitions */
export type EffectsDef<
  S extends Schema,
  DerivationIds extends string = never,
  Derived = Record<string, unknown>,
> = Record<string, EffectDef<S, DerivationIds, Derived>>;
