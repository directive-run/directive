/**
 * Scopes the runtime hands to first-party plugins and nothing else.
 *
 * Held in a module-private `WeakMap` keyed by the system, so the capability is
 * reachable from inside this package and not from a consumer's code. That
 * matters here because the thing being handed out is the ability to say where
 * a write came from: a durable record files writes by that answer, and an
 * answer anyone can set is not worth filing by.
 *
 * An earlier version parked it on the system object under a non-enumerable
 * symbol. `Object.getOwnPropertySymbols` returns those, and every plugin is
 * handed the system — so three lines in an `onInit` were enough to label
 * arbitrary writes as hydration. A `WeakMap` in module scope has no such door:
 * reaching the value requires importing this file.
 */

/** Runs a function with its fact writes marked as hydration. */
export type HydrationScope = (fn: () => void) => void;

const hydrationScopes = new WeakMap<object, HydrationScope>();

/** Called by the engine, once, before any plugin can observe the system. */
export function installHydrationScope(
  system: object,
  scope: HydrationScope,
): void {
  hydrationScopes.set(system, scope);
}

/**
 * The scope for this system, for a plugin that loads stored state back into a
 * fresh one.
 *
 * Returns `undefined` only for a system this package did not build. A
 * first-party plugin that gets `undefined` should say so rather than carry on
 * — writing without the scope files restored values as though the program
 * decided them this time.
 */
export function hydrationScopeFor(system: object): HydrationScope | undefined {
  return hydrationScopes.get(system);
}
