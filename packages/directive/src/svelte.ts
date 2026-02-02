/**
 * Svelte Adapter - Svelte stores for Directive
 *
 * Features:
 * - createDerivationStore for reactive derived values
 * - createFactStore for reactive fact values
 * - Svelte context for system
 */

import { getContext, setContext, onDestroy } from "svelte";
import { readable, type Readable } from "svelte/store";
import type { Facts, Schema, System, SystemInspection } from "./types.js";

// ============================================================================
// Context
// ============================================================================

const DIRECTIVE_KEY = Symbol("directive");

/**
 * Set the Directive system in Svelte context.
 * Call this in a parent component to make the system available to children.
 *
 * @example
 * ```svelte
 * <script>
 *   import { setDirectiveContext } from 'directive/svelte';
 *   import { createSystem } from 'directive';
 *
 *   const system = createSystem({ modules: [myModule] });
 *   setDirectiveContext(system);
 * </script>
 * ```
 */
export function setDirectiveContext<S extends Schema>(system: System<S>): void {
	setContext(DIRECTIVE_KEY, system);
}

/**
 * Get the Directive system from Svelte context.
 *
 * @throws If system is not set in context
 */
export function getDirectiveContext<S extends Schema>(): System<S> {
	const system = getContext<System<Schema> | undefined>(DIRECTIVE_KEY);
	if (!system) {
		throw new Error(
			"[Directive] getDirectiveContext must be called within a component tree that has a Directive system set. " +
			"Use setDirectiveContext() in a parent component.",
		);
	}
	return system as System<S>;
}

// ============================================================================
// Store Factories
// ============================================================================

/**
 * Create a Svelte store for a derived value.
 *
 * @example
 * ```svelte
 * <script>
 *   import { getDirectiveContext, createDerivationStore } from 'directive/svelte';
 *
 *   const system = getDirectiveContext();
 *   const isRed = createDerivationStore(system, 'isRed');
 * </script>
 *
 * <div>{$isRed ? 'Red' : 'Not Red'}</div>
 * ```
 */
export function createDerivationStore<T>(
	system: System<Schema>,
	derivationId: string,
): Readable<T> {
	// Dev warning for invalid derivation IDs
	if (process.env.NODE_ENV !== "production") {
		const initialValue = system.read(derivationId);
		if (initialValue === undefined) {
			console.warn(
				`[Directive] createDerivationStore("${derivationId}") returned undefined. ` +
					`Check that "${derivationId}" is defined in your module's derive property.`,
			);
		}
	}

	return readable<T>(system.read(derivationId) as T, (set) => {
		const unsubscribe = system.subscribe([derivationId], () => {
			set(system.read(derivationId) as T);
		});
		return unsubscribe;
	});
}

/**
 * Create a Svelte store for multiple derived values.
 *
 * @example
 * ```svelte
 * <script>
 *   import { getDirectiveContext, createDerivationsStore } from 'directive/svelte';
 *
 *   const system = getDirectiveContext();
 *   const state = createDerivationsStore(system, ['isRed', 'elapsed']);
 * </script>
 *
 * <div>{$state.isRed ? `Red for ${$state.elapsed}s` : 'Not Red'}</div>
 * ```
 */
export function createDerivationsStore<T extends Record<string, unknown>>(
	system: System<Schema>,
	derivationIds: string[],
): Readable<T> {
	const getValues = (): T => {
		const result: Record<string, unknown> = {};
		for (const id of derivationIds) {
			result[id] = system.read(id);
		}
		return result as T;
	};

	return readable<T>(getValues(), (set) => {
		const unsubscribe = system.subscribe(derivationIds, () => {
			set(getValues());
		});
		return unsubscribe;
	});
}

/**
 * Create a Svelte store for a single fact value.
 *
 * @example
 * ```svelte
 * <script>
 *   import { getDirectiveContext, createFactStore } from 'directive/svelte';
 *
 *   const system = getDirectiveContext();
 *   const phase = createFactStore(system, 'phase');
 * </script>
 *
 * <div>Current phase: {$phase}</div>
 * ```
 */
export function createFactStore<T>(
	system: System<Schema>,
	factKey: string,
): Readable<T | undefined> {
	return readable<T | undefined>(
		system.facts.$store.get(factKey) as T | undefined,
		(set) => {
			const unsubscribe = system.facts.$store.subscribe([factKey], () => {
				set(system.facts.$store.get(factKey) as T | undefined);
			});
			return unsubscribe;
		},
	);
}

/**
 * Create a Svelte store for system inspection data.
 *
 * NOTE: This updates on every fact change. Use sparingly in production.
 *
 * @example
 * ```svelte
 * <script>
 *   import { getDirectiveContext, createInspectionStore } from 'directive/svelte';
 *
 *   const system = getDirectiveContext();
 *   const inspection = createInspectionStore(system);
 * </script>
 *
 * <div>Unmet: {$inspection.unmet.length}</div>
 * ```
 */
export function createInspectionStore(
	system: System<Schema>,
): Readable<SystemInspection> {
	return readable<SystemInspection>(system.inspect(), (set) => {
		const unsubscribe = system.facts.$store.subscribeAll(() => {
			set(system.inspect());
		});
		return unsubscribe;
	});
}

// ============================================================================
// Convenience Hooks (require context)
// ============================================================================

/**
 * Get a derived value store using context.
 * Shorthand for getDirectiveContext() + createDerivationStore().
 *
 * @example
 * ```svelte
 * <script>
 *   import { useDerivation } from 'directive/svelte';
 *
 *   const isRed = useDerivation('isRed');
 * </script>
 *
 * <div>{$isRed ? 'Red' : 'Not Red'}</div>
 * ```
 */
export function useDerivation<T>(derivationId: string): Readable<T> {
	const system = getDirectiveContext();
	return createDerivationStore<T>(system, derivationId);
}

/**
 * Get multiple derived values store using context.
 *
 * @example
 * ```svelte
 * <script>
 *   import { useDerivations } from 'directive/svelte';
 *
 *   const state = useDerivations(['isRed', 'elapsed']);
 * </script>
 *
 * <div>{$state.isRed ? `Red for ${$state.elapsed}s` : 'Not Red'}</div>
 * ```
 */
export function useDerivations<T extends Record<string, unknown>>(
	derivationIds: string[],
): Readable<T> {
	const system = getDirectiveContext();
	return createDerivationsStore<T>(system, derivationIds);
}

/**
 * Get facts for mutations (not reactive).
 *
 * @example
 * ```svelte
 * <script>
 *   import { useFacts, useDispatch } from 'directive/svelte';
 *
 *   const facts = useFacts();
 *   const dispatch = useDispatch();
 *
 *   function increment() {
 *     facts.count = (facts.count ?? 0) + 1;
 *   }
 * </script>
 * ```
 */
export function useFacts<S extends Schema>(): Facts<S> {
	const system = getDirectiveContext<S>();
	return system.facts;
}

/**
 * Get a fact store using context.
 *
 * @example
 * ```svelte
 * <script>
 *   import { useFact } from 'directive/svelte';
 *
 *   const phase = useFact('phase');
 * </script>
 *
 * <div>Phase: {$phase}</div>
 * ```
 */
export function useFact<T>(factKey: string): Readable<T | undefined> {
	const system = getDirectiveContext();
	return createFactStore<T>(system, factKey);
}

/**
 * Get a dispatch function using context.
 *
 * @example
 * ```svelte
 * <script>
 *   import { useDispatch } from 'directive/svelte';
 *
 *   const dispatch = useDispatch();
 * </script>
 *
 * <button on:click={() => dispatch({ type: 'tick' })}>Tick</button>
 * ```
 */
export function useDispatch() {
	const system = getDirectiveContext();
	return (event: { type: string; [key: string]: unknown }) => {
		system.dispatch(event);
	};
}

/**
 * Get inspection store using context.
 */
export function useInspection(): Readable<SystemInspection> {
	const system = getDirectiveContext();
	return createInspectionStore(system);
}

/**
 * Get time-travel debug API using context.
 */
export function useTimeTravel() {
	const system = getDirectiveContext();
	return system.debug;
}

/**
 * Watch a derivation and call a callback on change.
 * Automatically cleans up on component destroy.
 *
 * @example
 * ```svelte
 * <script>
 *   import { useWatch } from 'directive/svelte';
 *
 *   useWatch('phase', (newPhase, oldPhase) => {
 *     console.log(`Phase changed from ${oldPhase} to ${newPhase}`);
 *   });
 * </script>
 * ```
 */
export function useWatch<T>(
	derivationId: string,
	callback: (newValue: T, previousValue: T | undefined) => void,
): void {
	const system = getDirectiveContext();
	const unsubscribe = system.watch<T>(derivationId, callback);
	onDestroy(unsubscribe);
}
