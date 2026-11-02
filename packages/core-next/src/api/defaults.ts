/**
 * `.default()` applied, as a system part ((al), L6c, owner-approved for 2.0).
 * 1.35 stores a builder's default and never applies it (RFC T4, U11), though
 * its docs say "Module init seeds these automatically".
 *
 * As the last step of `initialize()` (core.ts `fill_`), after the module
 * inits, the persistence plugin's turn, `initialFacts` and hydrate, each fact
 * that declares a default and still reads `undefined` gets it, so a default
 * never overwrites a value that was initialised or loaded, and a `??=` init
 * still runs (seeding before the inits would make it a no-op). A default
 * that is a function is called for its value. The writes are one store
 * batch, filed like an init's writes; a system with no default writes
 * nothing and emits nothing. `createSystem` wires it on every system, flat
 * and namespaced (whose schema has the flat `ns::key` keys); the floor goes
 * without it.
 */

import type { SystemPart } from "./core.js";

export const withDefaults: SystemPart = (context) => {
  const { module, store } = context;
  context.fill_ = () => {
    const facts = (module.schema?.facts ?? {}) as Record<
      string,
      { _default?: unknown } | undefined
    >;
    store.batch(() => {
      for (const key of Object.keys(facts)) {
        const value = facts[key]?._default;
        if (value !== undefined && store.get(key) === undefined) {
          store.set(key, typeof value === "function" ? value() : value);
        }
      }
    });
  };
};
