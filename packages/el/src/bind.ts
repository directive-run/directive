/**
 * Reactive DOM bindings for Directive systems.
 *
 * Subscribe to system state changes and update DOM elements automatically.
 * Uses the same subscription patterns as the Lit adapter (store.subscribeAll).
 */

import type {
  ModuleSchema,
  SingleModuleSystem,
  SystemDerived,
  SystemFacts,
} from "@directive-run/core";
import { assertSystem } from "@directive-run/core/adapter-utils";

type AnySystem = SingleModuleSystem<any>;

// ============================================================================
// Helpers
// ============================================================================

function getState(system: AnySystem): {
  facts: Record<string, unknown>;
  derived: Record<string, unknown>;
} {
  const facts = system.facts.$store.toObject();
  const derived: Record<string, unknown> = {};

  if (system.derive) {
    for (const key of Object.keys(system.derive)) {
      derived[key] = system.read(key);
    }
  }

  return { facts, derived };
}

// ============================================================================
// bind()
// ============================================================================

/**
 * Subscribe to a Directive system and update an element on every state change.
 * Calls the updater immediately with current state, then on every change.
 * Returns a cleanup function that unsubscribes.
 *
 * @example
 * ```typescript
 * const cleanup = bind(system, spanEl, (el, facts, derived) => {
 *   el.textContent = `Phase: ${facts.phase}`;
 *   el.className = derived.isRed ? "danger" : "safe";
 * });
 * ```
 */
export function bind<E extends HTMLElement, S extends ModuleSchema>(
  system: SingleModuleSystem<S>,
  element: E,
  updater: (
    el: E,
    facts: SystemFacts<SingleModuleSystem<S>>,
    derived: SystemDerived<SingleModuleSystem<S>>,
  ) => void,
): () => void {
  assertSystem("bind", system);

  type Facts = SystemFacts<SingleModuleSystem<S>>;
  type Derived = SystemDerived<SingleModuleSystem<S>>;

  // Initial render
  const { facts, derived } = getState(system);
  updater(element, facts as Facts, derived as Derived);

  // Subscribe to all fact changes
  const unsubscribe = system.facts.$store.subscribeAll(() => {
    const { facts, derived } = getState(system);
    updater(element, facts as Facts, derived as Derived);
  });

  return unsubscribe;
}

// ============================================================================
// bindText()
// ============================================================================

/**
 * Shorthand for binding text content to an element.
 * The selector receives facts and derived values and returns a string.
 *
 * @example
 * ```typescript
 * const cleanup = bindText(system, fuelSpan, (facts) => {
 *   return `${Math.round(facts.fuel as number)}%`;
 * });
 * ```
 */
export function bindText<S extends ModuleSchema>(
  system: SingleModuleSystem<S>,
  element: HTMLElement,
  selector: (
    facts: SystemFacts<SingleModuleSystem<S>>,
    derived: SystemDerived<SingleModuleSystem<S>>,
  ) => string,
): () => void {
  return bind(system, element, (el, facts, derived) => {
    el.textContent = selector(facts, derived);
  });
}

// ============================================================================
// mount()
// ============================================================================

/**
 * Replace an element's children on every state change.
 * Uses `container.replaceChildren(...)` for a single DOM op per update.
 * Ideal for lists and conditional rendering.
 *
 * @example
 * ```typescript
 * const cleanup = mount(system, listEl, (facts) => {
 *   const items = facts.items as string[];
 *   return items.map(item => el("li", {}, item));
 * });
 * ```
 */
export function mount<S extends ModuleSchema>(
  system: SingleModuleSystem<S>,
  container: HTMLElement,
  renderer: (
    facts: SystemFacts<SingleModuleSystem<S>>,
    derived: SystemDerived<SingleModuleSystem<S>>,
  ) => Node | Node[],
): () => void {
  assertSystem("mount", system);

  type Facts = SystemFacts<SingleModuleSystem<S>>;
  type Derived = SystemDerived<SingleModuleSystem<S>>;

  const normalize = (result: Node | Node[]): Node[] =>
    Array.isArray(result) ? result : [result];

  // Initial render
  const { facts, derived } = getState(system);
  container.replaceChildren(
    ...normalize(renderer(facts as Facts, derived as Derived)),
  );

  // Subscribe to changes
  const unsubscribe = system.facts.$store.subscribeAll(() => {
    const { facts, derived } = getState(system);
    container.replaceChildren(
      ...normalize(renderer(facts as Facts, derived as Derived)),
    );
  });

  return unsubscribe;
}
