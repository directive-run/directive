/**
 * Solid Adapter - SolidJS primitives for Directive
 *
 * Features:
 * - createDerivationSignal for reactive derived values
 * - createFactSignal for reactive fact values
 * - Context provider for system
 * - useRequirementStatus for loading/error states
 * - createTypedHooks for schema-specific hooks
 */

import {
	createContext,
	useContext,
	createSignal,
	onCleanup,
	type Accessor,
	type JSX,
} from "solid-js";
import { createSystem } from "../core/system.js";
import type { CreateSystemOptionsSingle, ModuleSchema, InferFacts, InferDerivations, InferEvents } from "../core/types.js";
import type { ModuleDef, System, SystemInspection } from "../core/types.js";
import {
	createRequirementStatusPlugin,
	type RequirementTypeStatus,
} from "../utils/requirement-status.js";

// Re-export for convenience
export type { RequirementTypeStatus };

/** Type for the requirement status plugin return value */
type StatusPlugin = ReturnType<typeof createRequirementStatusPlugin>;

// ============================================================================
// Context
// ============================================================================

// biome-ignore lint/suspicious/noExplicitAny: Context needs to work with any schema
const DirectiveContext = createContext<System<any>>();

/** Context for the requirement status plugin */
const StatusPluginContext = createContext<StatusPlugin | null>();

/**
 * Props for DirectiveProvider
 */
export interface DirectiveProviderProps<M extends ModuleSchema> {
	system: System<M>;
	children: JSX.Element;
	/** Optional requirement status plugin for useRequirementStatus hook */
	statusPlugin?: StatusPlugin;
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
export function DirectiveProvider<M extends ModuleSchema>(
	props: DirectiveProviderProps<M>,
): JSX.Element {
	// Use the Provider property directly to avoid JSX compilation issues
	return DirectiveContext.Provider({
		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		value: props.system as System<any>,
		children: StatusPluginContext.Provider({
			value: props.statusPlugin ?? null,
			children: props.children,
		}),
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
export function useSystem<M extends ModuleSchema = ModuleSchema>(): System<M> {
	const system = useContext(DirectiveContext);
	if (!system) {
		throw new Error(
			"[Directive] useSystem must be used within a DirectiveProvider. " +
				"Wrap your component tree with <DirectiveProvider system={system}>.",
		);
	}
	return system as System<M>;
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
export function useFacts<M extends ModuleSchema>(): System<M>["facts"] {
	const system = useSystem<M>();
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
 * import { useInspect } from 'directive/solid';
 *
 * function Inspector() {
 *   const inspection = useInspect();
 *   return <div>Unmet: {inspection().unmet.length}</div>;
 * }
 * ```
 */
export function useInspect(): Accessor<SystemInspection> {
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

/** Requirements state returned by useRequirements */
export interface RequirementsState {
	/** Array of unmet requirements waiting to be resolved */
	unmet: Array<{ id: string; requirement: { type: string; [key: string]: unknown }; fromConstraint: string }>;
	/** Array of requirements currently being resolved */
	inflight: Array<{ id: string; resolverId: string; startedAt: number }>;
	/** Whether there are any unmet requirements */
	hasUnmet: boolean;
	/** Whether there are any inflight requirements */
	hasInflight: boolean;
	/** Whether the system is actively working (has unmet or inflight requirements) */
	isWorking: boolean;
}

/**
 * Get current requirements state as a signal.
 *
 * Provides a focused view of just requirements without full inspection overhead.
 *
 * @returns Accessor with the current requirements state
 *
 * @example
 * ```tsx
 * import { useRequirements } from 'directive/solid';
 *
 * function LoadingIndicator() {
 *   const requirements = useRequirements();
 *   return (
 *     <Show when={requirements().isWorking}>
 *       <Spinner />
 *     </Show>
 *   );
 * }
 * ```
 */
export function useRequirements(): Accessor<RequirementsState> {
	const system = useSystem();

	const getState = (): RequirementsState => {
		const inspection = system.inspect();
		return {
			unmet: inspection.unmet,
			inflight: inspection.inflight,
			hasUnmet: inspection.unmet.length > 0,
			hasInflight: inspection.inflight.length > 0,
			isWorking: inspection.unmet.length > 0 || inspection.inflight.length > 0,
		};
	};

	const [state, setState] = createSignal<RequirementsState>(getState());

	const unsubscribe = system.facts.$store.subscribeAll(() => {
		setState(getState);
	});

	onCleanup(unsubscribe);

	return state;
}

/**
 * Get requirement status as a signal.
 *
 * Requires a statusPlugin to be passed to DirectiveProvider.
 *
 * @param type - The requirement type to get status for
 * @returns Accessor with the current status
 *
 * @example
 * ```tsx
 * import { useRequirementStatus } from 'directive/solid';
 *
 * function UserLoader() {
 *   const status = useRequirementStatus('FETCH_USER');
 *   return (
 *     <Show when={!status().isLoading} fallback={<Spinner />}>
 *       <Show when={!status().hasError} fallback={<Error message={status().lastError?.message} />}>
 *         <UserContent />
 *       </Show>
 *     </Show>
 *   );
 * }
 * ```
 */
export function useRequirementStatus(type: string): Accessor<RequirementTypeStatus> {
	const statusPlugin = useContext(StatusPluginContext);
	if (!statusPlugin) {
		throw new Error(
			"[Directive] useRequirementStatus requires a statusPlugin. " +
				"Pass statusPlugin to <DirectiveProvider statusPlugin={statusPlugin}>.",
		);
	}

	const [status, setStatus] = createSignal<RequirementTypeStatus>(
		statusPlugin.getStatus(type),
	);

	const unsubscribe = statusPlugin.subscribe(() => {
		setStatus(statusPlugin.getStatus(type));
	});

	onCleanup(unsubscribe);

	return status;
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
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
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
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
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
export type CreateDirectiveOptions<M extends ModuleSchema> =
	| ModuleDef<M>
	| CreateSystemOptionsSingle<M>;

// Cache for memoization - prevents re-creation in reactive contexts
// biome-ignore lint/suspicious/noExplicitAny: Cache needs to work with any schema
const systemCache = new WeakMap<object, System<any>>();

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
export function createDirective<M extends ModuleSchema>(
	options: CreateDirectiveOptions<M>,
): System<M> {
	// Check cache to prevent re-creation in reactive contexts
	const cached = systemCache.get(options as object);
	if (cached) {
		return cached as System<M>;
	}

	// Check if options is a module or system options
	const isModule = "id" in options && "schema" in options;

	const system = isModule
		? createSystem({ module: options as ModuleDef<M> })
		: createSystem(options as CreateSystemOptionsSingle<M>);

	// Cache the system
	// biome-ignore lint/suspicious/noExplicitAny: Cache needs to work with any schema
	systemCache.set(options as object, system as System<any>);

	system.start();

	onCleanup(() => {
		system.destroy();
		systemCache.delete(options as object);
	});

	// Return as System<M> - the underlying type matches
	return system as unknown as System<M>;
}

/**
 * Alias for createDirective for consistency with other adapters.
 * @see {@link createDirective}
 */
export const useDirective = createDirective;

// ============================================================================
// Typed Hooks Factory
// ============================================================================

/**
 * Create typed hooks for a specific system schema.
 *
 * This provides better type inference than the generic hooks.
 *
 * @example
 * ```ts
 * import { createTypedHooks } from 'directive/solid';
 *
 * // Define your schema
 * const schema = {
 *   facts: { count: t.number(), user: t.any<User | null>() },
 *   derivations: { doubled: t.number() },
 *   events: { increment: {}, setUser: { user: t.any<User>() } },
 *   requirements: {},
 * } satisfies ModuleSchema;
 *
 * // Create typed hooks
 * const { useDerivation, useFact, useDispatch } = createTypedHooks<typeof schema>();
 *
 * function Counter() {
 *   const count = useFact("count"); // Type: Accessor<number>
 *   const doubled = useDerivation("doubled"); // Type: Accessor<number>
 * }
 * ```
 */
export function createTypedHooks<M extends ModuleSchema>(): {
	useDerivation: <K extends keyof InferDerivations<M>>(
		derivationId: K,
	) => Accessor<InferDerivations<M>[K]>;
	useFact: <K extends keyof InferFacts<M>>(factKey: K) => Accessor<InferFacts<M>[K] | undefined>;
	useDispatch: () => (event: InferEvents<M>) => void;
	useSystem: () => System<M>;
} {
	return {
		useDerivation: <K extends keyof InferDerivations<M>>(derivationId: K) =>
			useDerivation<InferDerivations<M>[K]>(derivationId as string),
		useFact: <K extends keyof InferFacts<M>>(factKey: K) =>
			useFact<InferFacts<M>[K]>(factKey as string),
		useDispatch: () => {
			const system = useSystem<M>();
			return (event: InferEvents<M>) => {
				system.dispatch(event);
			};
		},
		useSystem: () => useSystem<M>(),
	};
}
