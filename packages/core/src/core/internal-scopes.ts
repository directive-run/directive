/**
 * Scopes the runtime hands to first-party plugins and nothing else.
 *
 * Keyed by symbols that this package does not re-export, so the capability is
 * reachable from inside the package and not from a consumer's code. That
 * matters here because the thing being handed out is the ability to say where
 * a write came from: a durable record files writes by that answer, and an
 * answer anyone can set is not worth filing by.
 */

/**
 * Runs a function with its fact writes marked as hydration rather than as
 * something the program decided — for a plugin that loads stored state back
 * into a fresh system.
 */
export const HYDRATION_SCOPE: unique symbol = Symbol(
  "directive.hydrationScope",
);

/** The shape the engine attaches it to. */
export interface HydrationScopeCarrier {
  [HYDRATION_SCOPE]?: (fn: () => void) => void;
}
