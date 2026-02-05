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
	computed,
	inject,
	onUnmounted,
	provide,
	ref,
	shallowRef,
	type App,
	type ComputedRef,
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
import {
	type RequirementsState,
	type ThrottledHookOptions,
	computeRequirementsState,
	createThrottle,
} from "./shared.js";

// Re-export for convenience
export type { RequirementTypeStatus, RequirementsState, ThrottledHookOptions };

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
 * @returns A dispatch function typed to the system's event schema
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
export function useDispatch<M extends ModuleSchema = ModuleSchema>(): (
	event: InferEvents<M>,
) => void {
	const system = useSystem<M>();
	return (event: InferEvents<M>) => {
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

/**
 * Get system inspection data with throttled updates.
 *
 * Use this instead of useInspect when updates are too frequent.
 *
 * @param options - Throttling options
 * @returns Reactive ref with the current system inspection
 *
 * @example
 * ```vue
 * <script setup>
 * import { useInspectThrottled } from 'directive/vue';
 *
 * const inspection = useInspectThrottled({ throttleMs: 200 });
 * </script>
 * ```
 */
export function useInspectThrottled(
	options: ThrottledHookOptions = {},
): ShallowRef<SystemInspection> {
	const { throttleMs = 100 } = options;
	const system = useSystem();
	const inspection = shallowRef<SystemInspection>(system.inspect());

	const { throttled, cleanup } = createThrottle(() => {
		inspection.value = system.inspect();
	}, throttleMs);

	const unsubscribe = system.facts.$store.subscribeAll(throttled);

	onUnmounted(() => {
		cleanup();
		unsubscribe();
	});

	return inspection;
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

	const state = shallowRef<RequirementsState>(
		computeRequirementsState(system.inspect()),
	);

	const unsubscribe = system.facts.$store.subscribeAll(() => {
		state.value = computeRequirementsState(system.inspect());
	});

	onUnmounted(unsubscribe);

	return state;
}

/**
 * Get current requirements state with throttled updates.
 *
 * Use this instead of useRequirements when updates are too frequent.
 *
 * @param options - Throttling options
 * @returns Reactive ref with the current requirements state
 *
 * @example
 * ```vue
 * <script setup>
 * import { useRequirementsThrottled } from 'directive/vue';
 *
 * const requirements = useRequirementsThrottled({ throttleMs: 200 });
 * </script>
 * ```
 */
export function useRequirementsThrottled(
	options: ThrottledHookOptions = {},
): ShallowRef<RequirementsState> {
	const { throttleMs = 100 } = options;
	const system = useSystem();

	const state = shallowRef<RequirementsState>(
		computeRequirementsState(system.inspect()),
	);

	const { throttled, cleanup } = createThrottle(() => {
		state.value = computeRequirementsState(system.inspect());
	}, throttleMs);

	const unsubscribe = system.facts.$store.subscribeAll(throttled);

	onUnmounted(() => {
		cleanup();
		unsubscribe();
	});

	return state;
}

/**
 * Check if the system has settled (no pending operations) as a reactive ref.
 *
 * @returns Reactive ref with boolean indicating whether the system is settled
 *
 * @example
 * ```vue
 * <script setup>
 * import { useIsSettled } from 'directive/vue';
 *
 * const isSettled = useIsSettled();
 * </script>
 *
 * <template>
 *   <Spinner v-if="!isSettled" />
 *   <Content v-else />
 * </template>
 * ```
 */
export function useIsSettled(): Ref<boolean> {
	const system = useSystem();
	const isSettled = ref(system.isSettled);

	const unsubscribe = system.facts.$store.subscribeAll(() => {
		isSettled.value = system.isSettled;
	});

	onUnmounted(unsubscribe);

	return isSettled;
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
 * Check if a requirement type is currently being resolved.
 *
 * Simplified version of useRequirementStatus that returns only the resolving state.
 * Requires a statusPlugin to be provided.
 *
 * @param type - The requirement type to check
 * @returns Reactive ref with boolean indicating if the type is being resolved
 *
 * @example
 * ```vue
 * <script setup>
 * import { useIsResolving } from 'directive/vue';
 *
 * const isSaving = useIsResolving('SAVE_DATA');
 * </script>
 *
 * <template>
 *   <button :disabled="isSaving">{{ isSaving ? 'Saving...' : 'Save' }}</button>
 * </template>
 * ```
 */
export function useIsResolving(type: string): ComputedRef<boolean> {
	const status = useRequirementStatus(type);
	return computed(() => status.value.inflight > 0);
}

/**
 * Get the last error for a requirement type.
 *
 * Simplified version of useRequirementStatus that returns only the error.
 * Requires a statusPlugin to be provided.
 *
 * @param type - The requirement type to get error for
 * @returns Reactive ref with the last error, or null if no error
 *
 * @example
 * ```vue
 * <script setup>
 * import { useLatestError } from 'directive/vue';
 *
 * const error = useLatestError('FETCH_USER');
 * </script>
 *
 * <template>
 *   <div v-if="error" class="error">{{ error.message }}</div>
 * </template>
 * ```
 */
export function useLatestError(type: string): ComputedRef<Error | null> {
	const status = useRequirementStatus(type);
	return computed(() => status.value.lastError);
}

/**
 * Get status for all tracked requirement types.
 *
 * Returns a reactive ref containing a Map of all requirement types that have
 * been tracked, with their current status. Useful for dashboard/admin UIs.
 *
 * Requires a statusPlugin to be provided.
 *
 * @returns Reactive ref with Map of requirement type to status
 *
 * @example
 * ```vue
 * <script setup>
 * import { useAllRequirementStatuses } from 'directive/vue';
 *
 * const allStatuses = useAllRequirementStatuses();
 * </script>
 *
 * <template>
 *   <ul>
 *     <li v-for="[type, status] in allStatuses" :key="type">
 *       {{ type }}: {{ status.isLoading ? 'Loading' : status.hasError ? 'Error' : 'Ready' }}
 *     </li>
 *   </ul>
 * </template>
 * ```
 */
export function useAllRequirementStatuses(): Ref<Map<string, RequirementTypeStatus>> {
	const statusPlugin = inject(StatusPluginKey);
	if (!statusPlugin) {
		throw new Error(
			"[Directive] useAllRequirementStatuses requires a statusPlugin. " +
				"Pass statusPlugin to createDirectivePlugin() or provideSystem().",
		);
	}

	const allStatuses = ref<Map<string, RequirementTypeStatus>>(statusPlugin.getAllStatus());

	const unsubscribe = statusPlugin.subscribe(() => {
		allStatuses.value = statusPlugin.getAllStatus();
	});

	onUnmounted(unsubscribe);

	return allStatuses;
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

// Track options we've warned about to avoid duplicate warnings
const warnedOptions = new WeakSet<object>();

/**
 * Create a scoped Directive system with automatic lifecycle management.
 * The system is automatically started on mount and destroyed on unmount.
 *
 * **IMPORTANT: Stability Requirements**
 *
 * The `options` parameter must be a stable reference (defined outside the component
 * or memoized) for the system to persist across re-renders. If you pass an inline
 * object, a new system will be created on each reactive update.
 *
 * @param options - Either a single module or full system options (must be stable reference)
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
 * // CORRECT: Define module outside component for stable reference
 * import { counterModule } from './counterModule';
 *
 * const system = useDirective(counterModule);
 * provideSystem(system); // Make available to children
 *
 * // INCORRECT: Inline options will create new system on each reactive update
 * // const system = useDirective({ module: counterModule }); // Don't do this!
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

	// Dev warning for unstable options (new object not seen before in this session)
	if (process.env.NODE_ENV !== "production") {
		if (!warnedOptions.has(options as object)) {
			warnedOptions.add(options as object);
			// Only warn if this looks like it might be an inline object (not a module)
			const isInlineOptions = !("id" in options && "schema" in options);
			if (isInlineOptions) {
				console.warn(
					"[Directive] useDirective received options that may not be stable. " +
						"If you see this warning repeatedly, ensure your options object is defined " +
						"outside the component or memoized. Inline options create a new system on each render.",
				);
			}
		}
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

// ============================================================================
// Selector Hooks (like XState's useSelector)
// ============================================================================

/** Default equality function for selectors (uses Object.is for consistency with React) */
function defaultEquality<T>(a: T, b: T): boolean {
	return Object.is(a, b);
}

/**
 * Subscribe to a fact with a selector function.
 *
 * This allows fine-grained subscriptions - the component only re-renders when
 * the selected value changes (according to the equality function).
 *
 * @param factKey - The fact key to subscribe to
 * @param selector - Function to transform the fact value
 * @param equalityFn - Optional equality function (default: ===)
 * @returns Reactive ref with the selected value
 *
 * @example
 * ```vue
 * <script setup>
 * import { useFactSelector } from 'directive/vue';
 *
 * // Only re-render when user's name changes, not other user properties
 * const userName = useFactSelector('user', (u) => u?.name ?? 'Guest');
 *
 * // With custom equality for objects
 * const coords = useFactSelector('position', (p) => ({ x: p?.x, y: p?.y }),
 *   (a, b) => a.x === b.x && a.y === b.y
 * );
 * </script>
 * ```
 */
export function useFactSelector<T, R>(
	factKey: string,
	selector: (value: T | undefined) => R,
	equalityFn: (a: R, b: R) => boolean = defaultEquality,
): Ref<R> {
	const system = useSystem();
	const initialValue = system.facts.$store.get(factKey) as T | undefined;
	const selected = ref<R>(selector(initialValue)) as Ref<R>;

	const unsubscribe = system.facts.$store.subscribe([factKey], () => {
		const newValue = system.facts.$store.get(factKey) as T | undefined;
		const newSelected = selector(newValue);
		if (!equalityFn(selected.value, newSelected)) {
			selected.value = newSelected;
		}
	});

	onUnmounted(unsubscribe);

	return selected;
}

/**
 * Subscribe to a derivation with a selector function.
 *
 * This allows fine-grained subscriptions - the component only re-renders when
 * the selected value changes (according to the equality function).
 *
 * @param derivationId - The derivation ID to subscribe to
 * @param selector - Function to transform the derivation value
 * @param equalityFn - Optional equality function (default: ===)
 * @returns Reactive ref with the selected value
 *
 * @example
 * ```vue
 * <script setup>
 * import { useDerivationSelector } from 'directive/vue';
 *
 * // Only re-render when status text changes
 * const statusText = useDerivationSelector('status', (s) => s?.label ?? 'Unknown');
 *
 * // With custom equality for arrays
 * const todoIds = useDerivationSelector('todos', (todos) => todos.map(t => t.id),
 *   (a, b) => a.length === b.length && a.every((id, i) => id === b[i])
 * );
 * </script>
 * ```
 */
export function useDerivationSelector<T, R>(
	derivationId: string,
	selector: (value: T) => R,
	equalityFn: (a: R, b: R) => boolean = defaultEquality,
): Ref<R> {
	const system = useSystem();
	const initialValue = system.read(derivationId) as T;
	const selected = ref<R>(selector(initialValue)) as Ref<R>;

	const unsubscribe = system.subscribe([derivationId], () => {
		const newValue = system.read(derivationId) as T;
		const newSelected = selector(newValue);
		if (!equalityFn(selected.value, newSelected)) {
			selected.value = newSelected;
		}
	});

	onUnmounted(unsubscribe);

	return selected;
}

/**
 * Subscribe to all facts with a selector function.
 *
 * This allows selecting derived values across multiple facts with fine-grained
 * re-rendering control.
 *
 * @param selector - Function that receives all facts and returns selected value
 * @param equalityFn - Optional equality function (default: ===)
 * @returns Reactive ref with the selected value
 *
 * @example
 * ```vue
 * <script setup>
 * import { useDirectiveSelector } from 'directive/vue';
 *
 * // Select derived state from multiple facts
 * const summary = useDirectiveSelector((facts) => ({
 *   count: facts.items?.length ?? 0,
 *   isLoading: facts.loading ?? false,
 * }), (a, b) => a.count === b.count && a.isLoading === b.isLoading);
 * </script>
 * ```
 */
export function useDirectiveSelector<R>(
	selector: (facts: Record<string, unknown>) => R,
	equalityFn: (a: R, b: R) => boolean = defaultEquality,
): Ref<R> {
	const system = useSystem();

	const getFacts = (): Record<string, unknown> => {
		return system.facts.$store.toObject();
	};

	const selected = ref<R>(selector(getFacts())) as Ref<R>;

	const unsubscribe = system.facts.$store.subscribeAll(() => {
		const newSelected = selector(getFacts());
		if (!equalityFn(selected.value, newSelected)) {
			selected.value = newSelected;
		}
	});

	onUnmounted(unsubscribe);

	return selected;
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
