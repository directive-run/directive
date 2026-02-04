// @ts-nocheck - TODO: Update adapter for consolidated schema API
/**
 * Solid Adapter - SolidJS primitives for Directive
 *
 * Features:
 * - createDerivationSignal for reactive derived values
 * - createFactSignal for reactive fact values
 * - Context provider for system
 */

import {
	createContext,
	useContext,
	createSignal,
	onCleanup,
	type Accessor,
	type JSX,
} from "solid-js";
import { createSystem, type CreateSystemOptions } from "../core/system.js";
import type { DerivationsDef, Facts, ModuleDef, Schema, System, SystemInspection } from "../core/types.js";

// ============================================================================
// Context
// ============================================================================

const DirectiveContext = createContext<System<Schema>>();

/**
 * Props for DirectiveProvider
 */
export interface DirectiveProviderProps<S extends Schema> {
	system: System<S>;
	children: JSX.Element;
}

/**
 * Provider component for Directive system.
 *
 * @example
 * ```tsx
 * import { DirectiveProvider } from 'directive/solid';
 *
 * const system = createSystem({ modules: [myModule] });
 *
 * function App() {
 *   return (
 *     <DirectiveProvider system={system}>
 *       <MyComponent />
 *     </DirectiveProvider>
 *   );
 * }
 * ```
 */
export function DirectiveProvider<S extends Schema>(
	props: DirectiveProviderProps<S>,
): JSX.Element {
	// Use the Provider property directly to avoid JSX compilation issues
	return DirectiveContext.Provider({
		value: props.system as System<Schema>,
		children: props.children,
	});
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Get the Directive system from context.
 *
 * @throws If used outside of DirectiveProvider
 */
export function useSystem<S extends Schema>(): System<S> {
	const system = useContext(DirectiveContext);
	if (!system) {
		throw new Error(
			"[Directive] useSystem must be used within a DirectiveProvider",
		);
	}
	return system as System<S>;
}

/**
 * Subscribe to a derived value as a signal.
 *
 * @example
 * ```tsx
 * import { useDerivation } from 'directive/solid';
 *
 * function StatusDisplay() {
 *   const isRed = useDerivation<boolean>('isRed');
 *   return <div>{isRed() ? 'Red' : 'Not Red'}</div>;
 * }
 * ```
 */
export function useDerivation<T>(derivationId: string): Accessor<T> {
	const system = useSystem();

	// Dev warning for invalid derivation IDs
	if (process.env.NODE_ENV !== "production") {
		const initialValue = system.read(derivationId);
		if (initialValue === undefined) {
			console.warn(
				`[Directive] useDerivation("${derivationId}") returned undefined. ` +
					`Check that "${derivationId}" is defined in your module's derive property.`,
			);
		}
	}

	const [value, setValue] = createSignal<T>(system.read(derivationId) as T);

	const unsubscribe = system.subscribe([derivationId], () => {
		setValue(() => system.read(derivationId) as T);
	});

	onCleanup(unsubscribe);

	return value;
}

/**
 * Subscribe to multiple derived values as a signal.
 *
 * @example
 * ```tsx
 * import { useDerivations } from 'directive/solid';
 *
 * function StatusDisplay() {
 *   const state = useDerivations<{ isRed: boolean; elapsed: number }>(['isRed', 'elapsed']);
 *   return <div>{state().isRed ? `Red for ${state().elapsed}s` : 'Not Red'}</div>;
 * }
 * ```
 */
export function useDerivations<T extends Record<string, unknown>>(
	derivationIds: string[],
): Accessor<T> {
	const system = useSystem();

	const getValues = (): T => {
		const result: Record<string, unknown> = {};
		for (const id of derivationIds) {
			result[id] = system.read(id);
		}
		return result as T;
	};

	const [state, setState] = createSignal<T>(getValues());

	const unsubscribe = system.subscribe(derivationIds, () => {
		setState(getValues);
	});

	onCleanup(unsubscribe);

	return state;
}

/**
 * Get direct access to facts for mutations.
 *
 * WARNING: The returned facts object is NOT reactive. Use this for event handlers,
 * not for rendering. Use `useDerivation` for reactive values.
 *
 * @example
 * ```tsx
 * import { useFacts } from 'directive/solid';
 *
 * function Controls() {
 *   const facts = useFacts();
 *
 *   function increment() {
 *     facts.count = (facts.count ?? 0) + 1;
 *   }
 *
 *   return <button onClick={increment}>Increment</button>;
 * }
 * ```
 */
export function useFacts<S extends Schema>(): Facts<S> {
	const system = useSystem<S>();
	return system.facts;
}

/**
 * Subscribe to a single fact value as a signal.
 *
 * @example
 * ```tsx
 * import { useFact } from 'directive/solid';
 *
 * function PhaseDisplay() {
 *   const phase = useFact<string>('phase');
 *   return <div>Current phase: {phase()}</div>;
 * }
 * ```
 */
export function useFact<T>(factKey: string): Accessor<T | undefined> {
	const system = useSystem();
	const [value, setValue] = createSignal<T | undefined>(
		system.facts.$store.get(factKey) as T | undefined,
	);

	const unsubscribe = system.facts.$store.subscribe([factKey], () => {
		setValue(() => system.facts.$store.get(factKey) as T | undefined);
	});

	onCleanup(unsubscribe);

	return value;
}

/**
 * Get a dispatch function for sending events.
 *
 * @example
 * ```tsx
 * import { useDispatch } from 'directive/solid';
 *
 * function Controls() {
 *   const dispatch = useDispatch();
 *   return <button onClick={() => dispatch({ type: 'tick' })}>Tick</button>;
 * }
 * ```
 */
export function useDispatch() {
	const system = useSystem();
	return (event: { type: string; [key: string]: unknown }) => {
		system.dispatch(event);
	};
}

/**
 * Get system inspection data as a signal.
 *
 * NOTE: This updates on every fact change. Use sparingly in production.
 *
 * @example
 * ```tsx
 * import { useInspection } from 'directive/solid';
 *
 * function Inspector() {
 *   const inspection = useInspection();
 *   return <div>Unmet: {inspection().unmet.length}</div>;
 * }
 * ```
 */
export function useInspection(): Accessor<SystemInspection> {
	const system = useSystem();
	const [inspection, setInspection] = createSignal<SystemInspection>(
		system.inspect(),
	);

	const unsubscribe = system.facts.$store.subscribeAll(() => {
		setInspection(system.inspect());
	});

	onCleanup(unsubscribe);

	return inspection;
}

/**
 * Get time-travel debug API (if enabled).
 */
export function useTimeTravel() {
	const system = useSystem();
	return system.debug;
}

/**
 * Watch a derivation and call a callback when its value changes.
 * Automatically cleans up on component unmount.
 *
 * @example
 * ```tsx
 * import { useWatch } from 'directive/solid';
 *
 * function PhaseWatcher() {
 *   useWatch<string>('phase', (newPhase, oldPhase) => {
 *     console.log(`Phase changed from ${oldPhase} to ${newPhase}`);
 *   });
 *
 *   return <div>Watching phase changes...</div>;
 * }
 * ```
 */
export function useWatch<T>(
	derivationId: string,
	callback: (newValue: T, previousValue: T | undefined) => void,
): void {
	const system = useSystem();
	const unsubscribe = system.watch<T>(derivationId, callback);
	onCleanup(unsubscribe);
}

// ============================================================================
// Signal Factories (for use outside components)
// ============================================================================

/**
 * Create a derivation signal outside of a component.
 * Useful for stores or other reactive contexts.
 *
 * @example
 * ```ts
 * import { createDerivationSignal } from 'directive/solid';
 *
 * const system = createSystem({ modules: [myModule] });
 * const [isRed, cleanup] = createDerivationSignal(system, 'isRed');
 *
 * // Later, when done:
 * cleanup();
 * ```
 */
export function createDerivationSignal<T>(
	system: System<Schema>,
	derivationId: string,
): [Accessor<T>, () => void] {
	const [value, setValue] = createSignal<T>(system.read(derivationId) as T);

	const unsubscribe = system.subscribe([derivationId], () => {
		setValue(() => system.read(derivationId) as T);
	});

	return [value, unsubscribe];
}

/**
 * Create a fact signal outside of a component.
 *
 * @example
 * ```ts
 * import { createFactSignal } from 'directive/solid';
 *
 * const system = createSystem({ modules: [myModule] });
 * const [phase, cleanup] = createFactSignal(system, 'phase');
 *
 * // Later, when done:
 * cleanup();
 * ```
 */
export function createFactSignal<T>(
	system: System<Schema>,
	factKey: string,
): [Accessor<T | undefined>, () => void] {
	const [value, setValue] = createSignal<T | undefined>(
		system.facts.$store.get(factKey) as T | undefined,
	);

	const unsubscribe = system.facts.$store.subscribe([factKey], () => {
		setValue(() => system.facts.$store.get(factKey) as T | undefined);
	});

	return [value, unsubscribe];
}

// ============================================================================
// Scoped System (like XState's useActorRef)
// ============================================================================

/** Options for createDirective/useDirective */
export type CreateDirectiveOptions<S extends Schema> =
	| ModuleDef<S, DerivationsDef<S>>
	| CreateSystemOptions<S>;

// Cache for memoization - prevents re-creation in reactive contexts
const systemCache = new WeakMap<object, System<Schema>>();

/**
 * Create a scoped Directive system with automatic lifecycle management.
 * The system is automatically started and cleaned up when the reactive scope ends.
 *
 * @param options - Either a single module or full system options
 * @returns The system instance
 *
 * @see {@link useDerivation} for reading derived values
 * @see {@link useFacts} for direct fact access
 *
 * @example
 * ```tsx
 * import { createDirective, DirectiveProvider } from 'directive/solid';
 *
 * function Counter() {
 *   const system = createDirective(counterModule);
 *   return (
 *     <DirectiveProvider system={system}>
 *       <CounterDisplay />
 *     </DirectiveProvider>
 *   );
 * }
 * ```
 */
export function createDirective<S extends Schema>(
	options: CreateDirectiveOptions<S>,
): System<S> {
	// Check cache to prevent re-creation in reactive contexts
	const cached = systemCache.get(options as object);
	if (cached) {
		return cached as System<S>;
	}

	// Check if options is a module or system options
	const isModule = "id" in options && "schema" in options;

	const system = isModule
		? createSystem({ modules: [options as ModuleDef<S, DerivationsDef<S>>] })
		: createSystem(options as CreateSystemOptions<S>);

	// Cache the system
	systemCache.set(options as object, system as System<Schema>);

	system.start();

	onCleanup(() => {
		system.destroy();
		systemCache.delete(options as object);
	});

	return system;
}

/**
 * Alias for createDirective for consistency with other adapters.
 * @see {@link createDirective}
 */
export const useDirective = createDirective;
