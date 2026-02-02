/**
 * Vue Adapter - Vue 3 composables for Directive
 *
 * Features:
 * - useDerivation for reactive computed values
 * - useFacts for direct fact access
 * - provide/inject for system context
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
import type { Facts, Schema, System, SystemInspection } from "./types.js";

// ============================================================================
// Context
// ============================================================================

const DirectiveKey: InjectionKey<System<Schema>> = Symbol("directive");

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
export function createDirectivePlugin<S extends Schema>(system: System<S>) {
	return {
		install(app: App) {
			app.provide(DirectiveKey, system as System<Schema>);
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
export function provideSystem<S extends Schema>(system: System<S>): void {
	provide(DirectiveKey, system as System<Schema>);
}

// ============================================================================
// Composables
// ============================================================================

/**
 * Get the Directive system from context.
 *
 * @throws If system is not provided
 */
export function useSystem<S extends Schema>(): System<S> {
	const system = inject(DirectiveKey);
	if (!system) {
		throw new Error(
			"[Directive] useSystem must be used within a component tree that has a Directive system provided. " +
			"Use createDirectivePlugin() or provideSystem() in a parent component.",
		);
	}
	return system as System<S>;
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
export function useFacts<S extends Schema>(): Facts<S> {
	const system = useSystem<S>();
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
 * import { useInspection } from 'directive/vue';
 *
 * const inspection = useInspection();
 * </script>
 *
 * <template>
 *   <div>Unmet: {{ inspection.unmet.length }}</div>
 * </template>
 * ```
 */
export function useInspection(): ShallowRef<SystemInspection> {
	const system = useSystem();
	const inspection = shallowRef<SystemInspection>(system.inspect());

	const unsubscribe = system.facts.$store.subscribeAll(() => {
		inspection.value = system.inspect();
	});

	onUnmounted(unsubscribe);

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
