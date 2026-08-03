/**
 * Effect Types - Type definitions for effects
 */

import type { Facts } from "./facts.js";
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
 */
export interface EffectDef<
  S extends Schema,
  DerivationIds extends string = never,
> {
  run(
    facts: Facts<S>,
    prev: InferSchema<S> | null,
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
  /** Optional metadata for debugging and devtools (never read on hot path). */
  meta?: DefinitionMeta;
}

/** Map of effect definitions */
export type EffectsDef<
  S extends Schema,
  DerivationIds extends string = never,
> = Record<string, EffectDef<S, DerivationIds>>;
