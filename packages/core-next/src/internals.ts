/**
 * `@directive-run/core/internals`: the managers behind the public API, as far
 * as core-next builds them. No semver promise, as in 1.35.
 */

export {
  BLOCKED_PROPS,
  createFacts,
  createFactsProxy,
  createFactsStore,
  isRunawayError,
} from "./api/facts.js";
export type { CreateFactsStoreOptions, Tracker } from "./api/facts.js";
export { createEffectsManager } from "./api/effects.js";
export type { CreateEffectsOptions, EffectsManager } from "./api/effects.js";
