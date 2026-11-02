/**
 * `system.restore()`, as a system part (L6, B6): 1.35's `restore`
 * (engine.ts:4298–4335). `createSystem` wires it on every system, flat and
 * namespaced (the namespaced form is the core system with its own views, so
 * it takes a snapshot's flat `ns::key` keys, as 1.35's bound engine method
 * does); `createSystemCore` and the floor go without it.
 *
 * Only `snapshot.facts` is read (S4). Its keys are written in one store
 * batch filed as "hydrate" (S3), straight to the store as 1.35 does, so
 * plugins hear one `onFactsBatch` and nothing else, and a reconcile follows
 * the flush. A blocked key is skipped.
 *
 * Two development-only changes, owner-approved for 2.0; production is 1.35:
 * - (ag) every key and value is checked before any is written, so a restore
 *   that throws writes nothing (1.35 throws after the keys before the bad
 *   one are committed);
 * - (ah) a restore made before `initialize()` warns once, since the module
 *   inits will overwrite it. Keyed on `initialize()`, not `start()`: the
 *   Aperture lab calls `initialize()`, then restores, then `start()`.
 */

import isDevelopment from "#is-development";
import type { SystemPart } from "./core.js";
import { BLOCKED_PROPS, isPrototypeSafe } from "./facts.js";

export const withRestore: SystemPart = ({
  kernel,
  module,
  system,
  store,
  load_,
}) => {
  let warned = false;
  system.restore = (snapshot: { facts?: Record<string, unknown> } | null) => {
    if (!snapshot || typeof snapshot !== "object") {
      throw new Error("[Directive] restore() requires a valid snapshot object");
    }
    if (!snapshot.facts || typeof snapshot.facts !== "object") {
      throw new Error(
        "[Directive] restore() snapshot must have a facts object",
      );
    }
    // The check is deep: a `__proto__` inside a fact's value is refused too.
    if (!isPrototypeSafe(snapshot)) {
      throw new Error(
        "[Directive] restore() rejected: snapshot contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
      );
    }
    // Read once: what (ag) checks is what is written.
    const entries = Object.entries(snapshot.facts).filter(
      ([key]) => !BLOCKED_PROPS.has(key),
    );
    if (isDevelopment) {
      if (!warned && !system.isInitialized) {
        warned = true;
        console.warn(
          "[Directive] restore() was called before initialize(), so the module inits will overwrite what it restored. Call restore() after initialize(), or load the facts with hydrate().",
        );
      }
      // (ag): the store's own write check, on every key first. An empty
      // schema only warns on an unknown key and never throws, so it is left
      // to the writes, which warn once per key as 1.35 does.
      const check = kernel.features.validate as
        | ((key: string, value: unknown) => void)
        | undefined;
      if (check && Object.keys(module.schema?.facts ?? {}).length > 0) {
        for (const [key, value] of entries) {
          check(key, value);
        }
      }
    }
    load_(() => {
      for (const [key, value] of entries) {
        store.set(key, value);
      }
    });
  };
};
