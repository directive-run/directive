/**
 * Vue Adapter - Vue 3 composables for Directive
 *
 * Features:
 * - useDerivation for reactive computed values
 * - useFacts for direct fact access
 * - provide/inject for system context
 * - useRequirementStatus for loading/error states
 * - createTypedHooks for schema-specific hooks
 */

import {
	inject,
	onUnmounted,
	provide,
	ref,
	shallowRef,
	type App,
	type InjectionKey,
	type Ref,
	type ShallowRef,
} from "vue";
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
const DirectiveKey: InjectionKey<System<any>> = Symbol("directive");

/** Injection key for the requirement status plugin */
const StatusPluginKey: InjectionKey<StatusPlugin | null> = Symbol("directive-status");

/**
 * Vue plugin to provide the Directive system globally.
 *
 * @example
 * ```ts
 * import { createApp } from 'vue';
 * import { createDirectivePlugin } from 'directive/vue';
 *
 * const system = createSystem({ modules: [myModule] });
 * const app = createApp(App);
 *
 * app.use(createDirectivePlugin(system));
 * app.mount('#app');
 * ```
 */
export function createDirectivePlugin<M extends ModuleSchema>(
	system: System<M>,
	statusPlugin?: StatusPlugin
) {
	return {
		install(app: App) {
			// biome-ignore lint/suspicious/noExplicitAny: System type varies
			app.provide(DirectiveKey, system as System<any>);
			app.provide(StatusPluginKey, statusPlugin ?? null);
		},
	};
}

/**
 * Provide Directive system to child components (alternative to plugin).
 *
 * @example
 * ```vue
 * <script setup>
 * import { provideSystem } from 'directive/vue';
 *
 * const system = createSystem({ modules: [myModule] });
 * provideSystem(system);
 * </script>
 * ```
 */
export function provideSystem<M extends ModuleSchema>(
	system: System<M>,
	statusPlugin?: StatusPlugin
): void {
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	provide(DirectiveKey, system as System<any>);
	provide(StatusPluginKey, statusPlugin ?? null);
}

// ============================================================================
// Composables
// ============================================================================

/**
 * Get the Directive system from context.
 *
 * @throws If system is not provided
 */
export function useSystem<M extends ModuleSchema = ModuleSchema>(): System<M> {
	const system = inject(DirectiveKey);
	if (!system) {
		throw new Error(
			"[Directive] useSystem must be used within a component tree that has a Directive system provided. " +
			"Use createDirectivePlugin() or provideSystem() in a parent component.",
		);
	}
	return system as System<M>;
}

/**
 * Subscribe to a derived value as a reactive ref.
 *
 * @example
 * ```vue
 * <script setup>
 * import { useDerivation } from 'directive/vue';
 *
 * const isRed = useDerivation<boolean>('isRed');
 * </script>
 *
 * <template>
 *   <div>{{ isRed ? 'Red' : 'Not Red' }}</div>
 * </template>
 * ```
 */
export function useDerivation<T>(derivationId: string): Ref<T> {
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

	const value = ref<T>(system.read(derivationId) as T) as Ref<T>;

	const unsubscribe = system.subscribe([derivationId], () => {
		value.value = system.read(derivationId) as T;
	});

	onUnmounted(unsubscribe);

	return value;
}

/**
 * Subscribe to multiple derived values as a reactive object.
 *
 * @example
 * ```vue
 * <script setup>
 * import { useDerivations } from 'directive/vue';
 *
 * const state = useDerivations<{ isRed: boolean; elapsed: number }>(['isRed', 'elapsed']);
 * </script>
 *
 * <template>
 *   <div>{{ state.isRed ? `Red for ${state.elapsed}s` : 'Not Red' }}</div>
 * </template>
 * ```
 */
export function useDerivations<T extends Record<string, unknown>>(
	derivationIds: string[],
): ShallowRef<T> {
	const system = useSystem();

	const getValues = (): T => {
		const result: Record<string, unknown> = {};
		for (const id of derivationIds) {
			result[id] = system.read(id);
		}
		return result as T;
	};

	const state: ShallowRef<T> = shallowRef(getValues()) as ShallowRef<T>;

	const unsubscribe = system.subscribe(derivationIds, () => {
		state.value = getValues();
	});

	onUnmounted(unsubscribe);

	return state;
}

/**
 * Get direct access to facts for mutations.
 *
 * WARNING: The returned facts object is NOT reactive. Use this for event handlers
 * and imperative code, not for rendering. Use `useDerivation` for reactive values.
 *
 * @example
 * ```vue
 * <script setup>
 * import { useFacts } from 'directive/vue';
 *
 * const facts = useFacts();
 *
 * function increment() {
 *   facts.count = (facts.count ?? 0) + 1;
 * }
 * </script>
 * ```
 */
export function useFacts<M extends ModuleSchema>(): System<M>["facts"] {
	const system = useSystem<M>();
	return system.facts;
}

/**
 * Subscribe to a single fact value as a reactive ref.
 *
 * @example
 * ```vue
 * <script setup>
 * import { useFact } from 'directive/vue';
 *
 * const phase = useFact<string>('phase');
 * </script>
 *
 * <template>
 *   <div>Current phase: {{ phase }}</div>
 * </template>
 * ```
 */
export function useFact<T>(factKey: string): Ref<T | undefined> {
	const system = useSystem();
	const value: Ref<T | undefined> = ref(system.facts.$store.get(factKey) as T | undefined) as Ref<T | undefined>;

	const unsubscribe = system.facts.$store.subscribe([factKey], () => {
		value.value = system.facts.$store.get(factKey) as T | undefined;
	});

	onUnmounted(unsubscribe);

	return value;
}

/**
 * Get a dispatch function for sending events.
 *
 * @example
 * ```vue
 * <script setup>
 * import { useDispatch } from 'directive/vue';
 *
 * const dispatch = useDispatch();
 * </script>
 *
 * <template>
 *   <button @click="dispatch({ type: 'tick' })">Tick</button>
 * </template>
 * ```
 */
export function useDispatch() {
	const system = useSystem();
	return (event: { type: string; [key: string]: unknown }) => {
		system.dispatch(event);
	};
}

/**
 * Get system inspection data as a reactive ref.
 *
 * NOTE: This re-renders on every fact change. Use sparingly in production.
 *
 * @example
 * ```vue
 * <script setup>
 * import { useInspect } from 'directive/vue';
 *
 * const inspection = useInspect();
 * </script>
 *
 * <template>
 *   <div>Unmet: {{ inspection.unmet.length }}</div>
 * </template>
 * ```
 */
export function useInspect(): ShallowRef<SystemInspection> {
	const system = useSystem();
	const inspection = shallowRef<SystemInspection>(system.inspect());

	const unsubscribe = system.facts.$store.subscribeAll(() => {
		inspection.value = system.inspect();
	});

	onUnmounted(unsubscribe);

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
 * Get current requirements state as a reactive ref.
 *
 * Provides a focused view of just requirements without full inspection overhead.
 *
 * @returns Reactive ref with the current requirements state
 *
 * @example
 * ```vue
 * <script setup>
 * import { useRequirements } from 'directive/vue';
 *
 * const requirements = useRequirements();
 * </script>
 *
 * <template>
 *   <Spinner v-if="requirements.isWorking" />
 * </template>
 * ```
 */
export function useRequirements(): ShallowRef<RequirementsState> {
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

	const state = shallowRef<RequirementsState>(getState());

	const unsubscribe = system.facts.$store.subscribeAll(() => {
		state.value = getState();
	});

	onUnmounted(unsubscribe);

	return state;
}

/**
 * Get requirement status as a reactive ref.
 *
 * Requires a statusPlugin to be provided via createDirectivePlugin() or provideSystem().
 *
 * @param type - The requirement type to get status for
 * @returns Reactive ref with the current status
 *
 * @example
 * ```vue
 * <script setup>
 * import { useRequirementStatus } from 'directive/vue';
 *
 * const status = useRequirementStatus('FETCH_USER');
 * </script>
 *
 * <template>
 *   <Spinner v-if="status.isLoading" />
 *   <Error v-else-if="status.hasError" :message="status.lastError?.message" />
 *   <UserContent v-else />
 * </template>
 * ```
 */
export function useRequirementStatus(type: string): ShallowRef<RequirementTypeStatus> {
	const statusPlugin = inject(StatusPluginKey);
	if (!statusPlugin) {
		throw new Error(
			"[Directive] useRequirementStatus requires a statusPlugin. " +
				"Pass statusPlugin to createDirectivePlugin() or provideSystem().",
		);
	}

	const status = shallowRef<RequirementTypeStatus>(statusPlugin.getStatus(type));

	const unsubscribe = statusPlugin.subscribe(() => {
		status.value = statusPlugin.getStatus(type);
	});

	onUnmounted(unsubscribe);

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
 *
 * @example
 * ```vue
 * <script setup>
 * import { useWatch } from 'directive/vue';
 *
 * useWatch<string>('phase', (newPhase, oldPhase) => {
 *   console.log(`Phase changed from ${oldPhase} to ${newPhase}`);
 * });
 * </script>
 * ```
 */
export function useWatch<T>(
	derivationId: string,
	callback: (newValue: T, previousValue: T | undefined) => void,
): void {
	const system = useSystem();

	const unsubscribe = system.watch<T>(derivationId, callback);

	onUnmounted(unsubscribe);
}

// ============================================================================
// Scoped System Composable (like XState's useActorRef)
// ============================================================================

/** Options for useDirective composable */
export type UseDirectiveOptions<M extends ModuleSchema> =
	| ModuleDef<M>
	| CreateSystemOptionsSingle<M>;

// Cache for memoization - prevents re-creation in reactive contexts
// biome-ignore lint/suspicious/noExplicitAny: Cache needs to work with any schema
const systemCache = new WeakMap<object, System<any>>();

/**
 * Create a scoped Directive system with automatic lifecycle management.
 * The system is automatically started on mount and destroyed on unmount.
 *
 * @param options - Either a single module or full system options
 * @returns The system instance
 *
 * @see {@link useDerivation} for reading derived values
 * @see {@link useFacts} for direct fact access
 *
 * @example
 * ```vue
 * <script setup>
 * import { useDirective, useDerivation } from 'directive/vue';
 *
 * // With a single module
 * const system = useDirective(counterModule);
 * provideSystem(system); // Make available to children
 *
 * const count = useDerivation('count');
 * </script>
 * ```
 */
export function useDirective<M extends ModuleSchema>(
	options: UseDirectiveOptions<M>,
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

	onUnmounted(() => {
		system.destroy();
		systemCache.delete(options as object);
	});

	// Return as System<M> - the underlying type matches
	return system as unknown as System<M>;
}

// ============================================================================
// Typed Hooks Factory
// ============================================================================

/**
 * Create typed composables for a specific system schema.
 *
 * This provides better type inference than the generic composables.
 *
 * @example
 * ```ts
 * import { createTypedHooks } from 'directive/vue';
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
 * // In your component:
 * const count = useFact("count"); // Type: Ref<number>
 * const doubled = useDerivation("doubled"); // Type: Ref<number>
 * ```
 */
export function createTypedHooks<M extends ModuleSchema>(): {
	useDerivation: <K extends keyof InferDerivations<M>>(
		derivationId: K,
	) => Ref<InferDerivations<M>[K]>;
	useFact: <K extends keyof InferFacts<M>>(factKey: K) => Ref<InferFacts<M>[K] | undefined>;
	useFacts: () => System<M>["facts"];
	useDispatch: () => (event: InferEvents<M>) => void;
	useSystem: () => System<M>;
} {
	return {
		useDerivation: <K extends keyof InferDerivations<M>>(derivationId: K) =>
			useDerivation<InferDerivations<M>[K]>(derivationId as string),
		useFact: <K extends keyof InferFacts<M>>(factKey: K) =>
			useFact<InferFacts<M>[K]>(factKey as string),
		useFacts: () => useFacts<M>(),
		useDispatch: () => {
			const system = useSystem<M>();
			return (event: InferEvents<M>) => {
				system.dispatch(event);
			};
		},
		useSystem: () => useSystem<M>(),
	};
}
