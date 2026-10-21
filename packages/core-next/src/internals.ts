/**
 * `@directive-run/core/internals`: the managers behind the public API, as far
 * as core-next builds them. No semver promise, as in 1.35.
 */

export {
  BLOCKED_PROPS,
  createFactsProxy,
  isRunawayError,
} from "./api/facts.js";
export type { CreateFactsStoreOptions, Tracker } from "./api/facts.js";
export { createFacts, createFactsStore } from "./api/validate.js";
export type { StoreOptions, ValidatorOptions } from "./api/validate.js";
export { createEffectsManager } from "./api/effects.js";
export type { CreateEffectsOptions, EffectsManager } from "./api/effects.js";
