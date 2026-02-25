/**
 * Effect Types - Type definitions for effects
 */

import type { Schema, InferSchema } from "./schema.js";
import type { Facts } from "./facts.js";

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
export interface EffectDef<S extends Schema> {
	run(facts: Facts<S>, prev: InferSchema<S> | null): void | EffectCleanup | Promise<void | EffectCleanup>;
	/** Optional explicit dependencies for optimization */
	deps?: Array<keyof InferSchema<S>>;
}

/** Map of effect definitions */
export type EffectsDef<S extends Schema> = Record<string, EffectDef<S>>;
