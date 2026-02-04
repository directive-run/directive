/**
 * Effect Types - Type definitions for effects
 */

import type { Schema, InferSchema } from "./schema.js";
import type { Facts, FactsSnapshot } from "./facts.js";

// ============================================================================
// Effect Types
// ============================================================================

/**
 * Effect definition - fire-and-forget side effects.
 *
 * ## Effects vs Constraints
 *
 * Use **Effects** for:
 * - Logging and analytics
 * - DOM manipulation (scrolling, focus)
 * - External notifications (toasts, alerts)
 * - Syncing to localStorage/sessionStorage
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
 */
export interface EffectDef<S extends Schema> {
	run(facts: Facts<S>, prev: FactsSnapshot<S> | null): void | Promise<void>;
	/** Optional explicit dependencies for optimization */
	deps?: Array<keyof InferSchema<S>>;
}

/** Map of effect definitions */
export type EffectsDef<S extends Schema> = Record<string, EffectDef<S>>;
