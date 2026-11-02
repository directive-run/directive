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
 * that is a function is called for its value; any other default is copied
 * with `structuredClone` on each fill, so two systems (or two instances of a
 * module in one namespaced system) never share one object or array, and a
 * mutation of one system's value or snapshot never reaches another. A value
 * `structuredClone` refuses, or cannot copy with its prototype (a class
 * instance), is used as given: give it as a function default for a fresh one
 * per system. In development a default that fails its own validators throws
 * an error naming `.default()` and the fact; production does not check
 * writes, so it fills it. The writes are one store
 * batch, filed like an init's writes; a system with no default writes
 * nothing and emits nothing. `createSystem` wires it on every system, flat
 * and namespaced (whose schema has the flat `ns::key` keys); the floor goes
 * without it.
 */

import isDevelopment from "#is-development";
import type { SystemPart } from "./core.js";

/** A copy of `value` that keeps its prototype, else `value` itself. */
const copy = (value: unknown) => {
  if (typeof value === "object" && value) {
    try {
      const out = structuredClone(value);
      if (Object.getPrototypeOf(out) === Object.getPrototypeOf(value)) {
        return out;
      }
    } catch {
      // Not cloneable (it holds a function, say): used as given.
    }
  }

  return value;
};

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
          const fill = typeof value === "function" ? value() : copy(value);
          if (isDevelopment) {
            try {
              store.set(key, fill);
            } catch (error) {
              throw new Error(
                `[Directive] The .default() of fact "${key}" fails its own schema. ${(error as Error).message}`,
                { cause: error },
              );
            }
          } else {
            store.set(key, fill);
          }
        }
      }
    });
  };
};
