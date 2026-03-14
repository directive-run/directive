/**
 * Proxy-based accessors for the engine's derive and events surfaces.
 *
 * Extracted from engine.ts to reduce file size. Pure proxy creation —
 * all state mutation is delegated to callbacks.
 *
 * @internal
 */

import type { DefinitionsRegistry } from "./engine-definitions.js";
import { BLOCKED_PROPS } from "./tracking.js";

// ============================================================================
// Derive Accessor
// ============================================================================

/**
 * Options for creating the derive accessor proxy.
 *
 * @internal
 */
export interface CreateDeriveAccessorOptions {
  /** Merged derivation definitions (mutable reference, checked for key existence) */
  mergedDerive: Record<string, unknown>;
  /** Retrieve a computed derivation value by key */
  getDerivation: (key: string) => unknown;
  /** Definitions registry for dynamic definition methods */
  definitions: DefinitionsRegistry;
}

/**
 * Create a proxy that provides `system.derive.key` access to derivation values
 * plus dynamic definition methods (register, assign, unregister, etc.).
 *
 * @param options - Derivation definitions, getter, and dynamic registry
 * @returns A proxy combining derivation value access with definition management
 *
 * @internal
 */
export function createDeriveAccessor(
  options: CreateDeriveAccessorOptions,
): Record<string, unknown> {
  const { mergedDerive, getDerivation, definitions } = options;

  // Method properties for derive accessor (dynamic definitions API)
  const deriveMethods: Record<string, unknown> = {
    register: (id: string, fn: unknown) =>
      definitions.register("derivation", id, fn),
    assign: (id: string, fn: unknown) =>
      definitions.assign("derivation", id, fn),
    unregister: (id: string) => definitions.unregister("derivation", id),
    call: (id: string) => definitions.call("derivation", id),
    isDynamic: (id: string) => definitions.isDynamic("derivation", id),
    listDynamic: () => definitions.listDynamic("derivation"),
  };

  return new Proxy({} as Record<string, unknown>, {
    get(_, prop: string | symbol) {
      if (typeof prop === "symbol") {
        return undefined;
      }
      // Prototype pollution protection
      if (BLOCKED_PROPS.has(prop)) {
        return undefined;
      }
      // Check for method properties first (register, assign, etc.)
      if (prop in deriveMethods) {
        return deriveMethods[prop];
      }
      // Return undefined for unknown derivation keys instead of throwing.
      // React 19 dev-mode traverses objects accessing $$typeof, toJSON, then, etc.
      if (!(prop in mergedDerive)) {
        return undefined;
      }
      return getDerivation(prop);
    },
    has(_, prop: string | symbol) {
      if (typeof prop === "symbol") {
        return false;
      }
      // Prototype pollution protection
      if (BLOCKED_PROPS.has(prop)) {
        return false;
      }
      return prop in mergedDerive || prop in deriveMethods;
    },
    ownKeys() {
      return Object.keys(mergedDerive);
    },
    getOwnPropertyDescriptor(_, prop: string | symbol) {
      if (typeof prop === "symbol") {
        return undefined;
      }
      // Prototype pollution protection
      if (BLOCKED_PROPS.has(prop)) {
        return undefined;
      }
      if (prop in mergedDerive || prop in deriveMethods) {
        return { configurable: true, enumerable: true };
      }
      return undefined;
    },
    set() {
      return false;
    },
    defineProperty() {
      return false;
    },
    getPrototypeOf() {
      return null;
    },
    setPrototypeOf() {
      return false;
    },
  });
}

// ============================================================================
// Events Accessor
// ============================================================================

/**
 * Options for creating the events accessor proxy.
 *
 * @internal
 */
export interface CreateEventsAccessorOptions {
  /** Merged event definitions (mutable reference, checked for key existence) */
  mergedEvents: Record<string, unknown>;
  /** Dispatch an event by name with optional payload */
  dispatchEvent: (eventName: string, payload?: Record<string, unknown>) => void;
}

/**
 * Create a proxy that provides `system.events.eventName(payload)` syntax.
 * Dispatching is delegated to the provided callback.
 *
 * @param options - Event definitions and dispatch callback
 * @returns A proxy that returns dispatch functions per event name
 *
 * @internal
 */
export function createEventsAccessor(
  options: CreateEventsAccessorOptions,
): Record<string, (payload?: Record<string, unknown>) => void> {
  const { mergedEvents, dispatchEvent } = options;

  return new Proxy(
    {} as Record<string, (payload?: Record<string, unknown>) => void>,
    {
      get(_, prop: string | symbol) {
        if (typeof prop === "symbol") {
          return undefined;
        }
        // Prototype pollution protection
        if (BLOCKED_PROPS.has(prop)) {
          return undefined;
        }
        // Return a function that dispatches the event
        return (payload?: Record<string, unknown>) => {
          dispatchEvent(prop, payload);
        };
      },
      has(_, prop: string | symbol) {
        if (typeof prop === "symbol") {
          return false;
        }
        // Prototype pollution protection
        if (BLOCKED_PROPS.has(prop)) {
          return false;
        }
        return prop in mergedEvents;
      },
      ownKeys() {
        return Object.keys(mergedEvents);
      },
      getOwnPropertyDescriptor(_, prop: string | symbol) {
        if (typeof prop === "symbol") {
          return undefined;
        }
        // Prototype pollution protection
        if (BLOCKED_PROPS.has(prop)) {
          return undefined;
        }
        if (prop in mergedEvents) {
          return { configurable: true, enumerable: true };
        }
        return undefined;
      },
      set() {
        return false;
      },
      defineProperty() {
        return false;
      },
      getPrototypeOf() {
        return null;
      },
      setPrototypeOf() {
        return false;
      },
    },
  );
}
