/**
 * Lower-level APIs for advanced use cases.
 *
 * Import from `@directive-run/core/internals` when you need direct access
 * to individual manager factories, the engine, or internal tracking utilities.
 *
 * Most consumers should use `createModule` + `createSystem` from the main entry point.
 *
 * @packageDocumentation
 */

// Facts store
export {
  createFacts,
  createFactsStore,
  createFactsProxy,
} from "./core/facts.js";

// Manager factories
export { createDerivationsManager } from "./core/derivations.js";
export { createEffectsManager } from "./core/effects.js";
export { createConstraintsManager } from "./core/constraints.js";
export { createResolversManager, type InflightInfo } from "./core/resolvers.js";
export { createPluginManager } from "./core/plugins.js";
export {
  createErrorBoundaryManager,
  createRetryLaterManager,
  type PendingRetry,
} from "./core/errors.js";

// History
export {
  createHistoryManager,
  createDisabledHistory,
} from "./utils/history.js";

// Engine
export { createEngine } from "./core/engine.js";

// Tracking
export {
  getCurrentTracker,
  isTracking,
  withTracking,
  withoutTracking,
  trackAccess,
} from "./core/tracking.js";
