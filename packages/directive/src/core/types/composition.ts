/**
 * Composition Types - Type definitions for single and multi-module systems
 *
 * Single module = direct access (no namespace):
 * @example
 * ```typescript
 * const system = createSystem({ modules: counterModule });
 * system.facts.count           // Direct access
 * system.events.increment()    // Direct events
 * ```
 *
 * Multiple modules = namespaced access:
 * @example
 * ```typescript
 * const system = createSystem({
 *   modules: { auth: authModule, data: dataModule },
 * });
 * system.facts.auth.token       // Namespaced access
 * system.derive.data.userCount  // Namespaced derivations
 * system.events.auth.login()    // Namespaced events
 * ```
 */

import type {
	ModuleSchema,
	InferFacts,
	InferDerivations,
	InferEvents,
} from "./schema.js";
import type { Facts } from "./facts.js";
import type { ModuleDef } from "./module.js";
import type {
	DebugConfig,
	TimeTravelAPI,
	SystemInspection,
	SystemSnapshot,
	DistributableSnapshotOptions,
	DistributableSnapshot,
} from "./system.js";
import type { Plugin } from "./plugins.js";
import type { ErrorBoundaryConfig } from "./errors.js";

// ============================================================================
// Module Map Types
// ============================================================================

/**
 * Extract the schema type from a module definition.
 */
export type ExtractSchema<M> = M extends ModuleDef<infer S> ? S : never;

/**
 * Map of module name to module definition (object form).
 *
 * Uses `ModuleDef<any>` instead of `ModuleDef<ModuleSchema>` to preserve
 * specific schema types during inference. The actual schema types are
 * extracted via `ExtractSchema<M>` where needed.
 */
// biome-ignore lint/suspicious/noExplicitAny: Required for TypeScript to preserve specific module schema types during inference
export type ModulesMap = Record<string, ModuleDef<any>>;

// ============================================================================
// Cross-Module Facts Types (for module-level type hints)
// ============================================================================

/**
 * Map of module name to schema (for cross-module typing).
 */
export type SchemasMap = Record<string, ModuleSchema>;

/**
 * Create namespaced facts type from a map of schemas.
 * Use this to type cross-module effects and constraints within modules.
 *
 * @example
 * ```typescript
 * // types.ts - Create the combined type from schemas
 * import { authSchema } from './modules/auth';
 * import { dataSchema } from './modules/data';
 * import { uiSchema } from './modules/ui';
 * import type { CrossModuleFacts } from 'directive';
 *
 * export type AllFacts = CrossModuleFacts<{
 *   auth: typeof authSchema;
 *   data: typeof dataSchema;
 *   ui: typeof uiSchema;
 * }>;
 *
 * // modules/ui.ts - Use the combined type in effects
 * import type { AllFacts } from '../types';
 *
 * effects: {
 *   onAuthChange: {
 *     run: (facts: AllFacts, prev: AllFacts | undefined) => {
 *       facts.auth.isAuthenticated // ✅ typed!
 *       facts.data.users           // ✅ typed!
 *     }
 *   }
 * }
 * ```
 */
export type CrossModuleFacts<Schemas extends SchemasMap> = {
	[K in keyof Schemas]: InferFacts<Schemas[K]>;
};

/**
 * Create namespaced derivations type from a map of schemas.
 * Use this to type cross-module effects that read derivations.
 *
 * @example
 * ```typescript
 * import type { CrossModuleDerivations } from 'directive';
 *
 * export type AllDerivations = CrossModuleDerivations<{
 *   auth: typeof authSchema;
 *   data: typeof dataSchema;
 * }>;
 * ```
 */
export type CrossModuleDerivations<Schemas extends SchemasMap> = {
	readonly [K in keyof Schemas]: InferDerivations<Schemas[K]>;
};

// ============================================================================
// Cross-Module Dependencies Types (for module-level crossModuleDeps)
// ============================================================================

/**
 * Map of namespace to schema for cross-module dependencies.
 * Used in module config to declare type-safe access to other modules' facts.
 */
export type CrossModuleDeps = Record<string, ModuleSchema>;

/**
 * Cross-module facts type using "self" for own module.
 * Own module accessed via `facts.self.*`, dependencies via `facts.{dep}.*`.
 *
 * @example
 * ```typescript
 * // For a "data" module with crossModuleDeps: { auth: authSchema }
 * facts.self.users           // ✅ own module via "self"
 * facts.auth.isAuthenticated // ✅ cross-module via namespace
 * ```
 */
export type CrossModuleFactsWithSelf<
	OwnSchema extends ModuleSchema,
	Deps extends CrossModuleDeps,
> = { self: InferFacts<OwnSchema> } & {
	[K in keyof Deps]: InferFacts<Deps[K]>;
};

// ============================================================================
// Namespaced Facts Types
// ============================================================================

/**
 * Namespace facts under module keys.
 * `facts.auth.token` instead of `facts.auth_token`
 */
export type NamespacedFacts<Modules extends ModulesMap> = {
	readonly [K in keyof Modules]: InferFacts<ExtractSchema<Modules[K]>>;
};

/**
 * Mutable version for constraint/resolver callbacks.
 */
export type MutableNamespacedFacts<Modules extends ModulesMap> = {
	[K in keyof Modules]: InferFacts<ExtractSchema<Modules[K]>>;
};

// ============================================================================
// Namespaced Derivations Types
// ============================================================================

/**
 * Namespace derivations under module keys.
 * `derive.auth.status` instead of `derive.auth_status`
 */
export type NamespacedDerivations<Modules extends ModulesMap> = {
	readonly [K in keyof Modules]: InferDerivations<ExtractSchema<Modules[K]>>;
};

// ============================================================================
// Union Event Types
// ============================================================================

/**
 * Union of all module events (not namespaced).
 * Events stay as discriminated union for dispatch.
 */
export type UnionEvents<Modules extends ModulesMap> = {
	[K in keyof Modules]: InferEvents<ExtractSchema<Modules[K]>>;
}[keyof Modules];

// ============================================================================
// Namespaced System Options
// ============================================================================

/**
 * Options for createSystem with object modules (namespaced mode).
 */
export interface CreateSystemOptionsNamed<Modules extends ModulesMap> {
	/** Modules as object = namespaced access */
	modules: Modules;
	/** Plugins to register */
	plugins?: Array<Plugin<ModuleSchema>>;
	/** Debug configuration */
	debug?: DebugConfig;
	/** Error boundary configuration */
	errorBoundary?: ErrorBoundaryConfig;
	/**
	 * Tick interval for time-based systems (ms).
	 */
	tickMs?: number;
	/**
	 * Enable zero-config mode with sensible defaults.
	 */
	zeroConfig?: boolean;
	/**
	 * Initial facts to set after module init (namespaced format).
	 * Applied after all module `init()` functions but before reconciliation.
	 *
	 * @example
	 * ```typescript
	 * createSystem({
	 *   modules: { auth, data },
	 *   initialFacts: {
	 *     auth: { token: "restored-token", user: cachedUser },
	 *     data: { users: preloadedUsers },
	 *   },
	 * });
	 * ```
	 */
	initialFacts?: Partial<{
		[K in keyof Modules]: Partial<InferFacts<ExtractSchema<Modules[K]>>>;
	}>;
	/**
	 * Init order strategy:
	 * - "auto" (default): Sort by crossModuleDeps topology
	 * - "declaration": Use object key order (current behavior)
	 * - string[]: Explicit order by namespace
	 */
	initOrder?: "auto" | "declaration" | Array<keyof Modules & string>;
}

// ============================================================================
// Namespaced System Interface
// ============================================================================

/**
 * System interface for namespaced modules.
 * Facts and derivations are accessed via module namespaces.
 */
export interface NamespacedSystem<Modules extends ModulesMap> {
	/** System mode discriminator for type guards */
	readonly _mode: "namespaced";
	/** Namespaced facts accessor: system.facts.auth.token */
	readonly facts: MutableNamespacedFacts<Modules>;
	/** Time-travel debugging API (if enabled) */
	readonly debug: TimeTravelAPI | null;
	/** Namespaced derivations accessor: system.derive.auth.status */
	readonly derive: NamespacedDerivations<Modules>;
	/** Events accessor (union of all module events) */
	readonly events: NamespacedEventsAccessor<Modules>;

	/** Start the system (initialize modules, begin reconciliation) */
	start(): void;
	/** Stop the system (cancel resolvers, stop reconciliation) */
	stop(): void;
	/** Destroy the system (stop and cleanup) */
	destroy(): void;

	/** Whether the system is currently running */
	readonly isRunning: boolean;
	/** Whether all resolvers have completed */
	readonly isSettled: boolean;
	/** Whether all modules have completed initialization */
	readonly isInitialized: boolean;
	/** Whether system has completed first reconciliation */
	readonly isReady: boolean;

	/** Wait for system to be fully ready (after first reconciliation) */
	whenReady(): Promise<void>;

	/**
	 * Hydrate facts from async source (call before start).
	 * Useful for restoring state from localStorage, API, etc.
	 *
	 * @example
	 * ```typescript
	 * const system = createSystem({ modules: { auth, data } });
	 * await system.hydrate(async () => {
	 *   const stored = localStorage.getItem("app-state");
	 *   return stored ? JSON.parse(stored) : {};
	 * });
	 * system.start();
	 * ```
	 */
	hydrate(
		loader: () => Promise<Partial<{
			[K in keyof Modules]: Partial<InferFacts<ExtractSchema<Modules[K]>>>;
		}>> | Partial<{
			[K in keyof Modules]: Partial<InferFacts<ExtractSchema<Modules[K]>>>;
		}>,
	): Promise<void>;

	/** Dispatch an event (union of all module events) */
	dispatch(event: UnionEvents<Modules>): void;

	/** Batch multiple fact changes */
	batch(fn: () => void): void;

	/**
	 * Read a derivation value by namespaced key.
	 * Accepts "namespace.key" format (e.g., "auth.status").
	 *
	 * @example
	 * system.read("auth.status")  // → "authenticated"
	 * system.read("data.count")   // → 5
	 */
	read<T = unknown>(derivationId: string): T;

	/**
	 * Subscribe to derivation changes using namespaced keys.
	 * Accepts "namespace.key" format (e.g., "auth.status").
	 *
	 * @example
	 * system.subscribe(["auth.status", "data.count"], () => {
	 *   console.log("Auth or data changed");
	 * });
	 */
	subscribe(derivationIds: string[], listener: () => void): () => void;

	/**
	 * Watch a derivation for changes using namespaced key.
	 * Accepts "namespace.key" format (e.g., "auth.status").
	 *
	 * @example
	 * system.watch("auth.status", (newVal, oldVal) => {
	 *   console.log(`Status changed from ${oldVal} to ${newVal}`);
	 * });
	 */
	watch<T = unknown>(
		derivationId: string,
		callback: (newValue: T, previousValue: T | undefined) => void,
	): () => void;

	/** Inspect system state */
	inspect(): SystemInspection;
	/** Wait for system to settle (all resolvers complete) */
	settle(maxWait?: number): Promise<void>;
	/** Explain why a requirement exists */
	explain(requirementId: string): string | null;
	/** Get serializable snapshot of system state */
	getSnapshot(): SystemSnapshot;
	/** Restore system state from snapshot */
	restore(snapshot: SystemSnapshot): void;

	/**
	 * Get a distributable snapshot of computed derivations.
	 * Use "namespace.key" format for derivation keys.
	 *
	 * @example
	 * ```typescript
	 * const snapshot = system.getDistributableSnapshot({
	 *   includeDerivations: ['auth.effectivePlan', 'auth.canUseFeature'],
	 *   ttlSeconds: 3600,
	 * });
	 * await redis.setex(`entitlements:${userId}`, 3600, JSON.stringify(snapshot));
	 * ```
	 */
	getDistributableSnapshot<T = Record<string, unknown>>(
		options?: DistributableSnapshotOptions,
	): DistributableSnapshot<T>;

	/**
	 * Watch for changes to distributable snapshot derivations.
	 * Calls the callback whenever any of the included derivations change.
	 * Use "namespace.key" format for derivation keys.
	 * Returns an unsubscribe function.
	 *
	 * @example
	 * ```typescript
	 * const unsubscribe = system.watchDistributableSnapshot(
	 *   { includeDerivations: ['auth.effectivePlan', 'auth.canUseFeature'] },
	 *   (snapshot) => {
	 *     await redis.setex(`entitlements:${userId}`, 3600, JSON.stringify(snapshot));
	 *   }
	 * );
	 * ```
	 */
	watchDistributableSnapshot<T = Record<string, unknown>>(
		options: DistributableSnapshotOptions,
		callback: (snapshot: DistributableSnapshot<T>) => void,
	): () => void;
}

/**
 * Events accessor that groups event dispatchers by module namespace.
 */
export type NamespacedEventsAccessor<Modules extends ModulesMap> = {
	readonly [K in keyof Modules]: EventsDispatcherForModule<Modules[K]>;
};

/**
 * Event dispatcher functions for a single module.
 */
type EventsDispatcherForModule<M> = M extends ModuleDef<infer S>
	? S extends ModuleSchema
		? S["events"] extends Record<string, unknown>
			? {
					[E in keyof S["events"]]: S["events"][E] extends Record<string, unknown>
						? keyof S["events"][E] extends never
							? () => void
							: (payload: InferEventPayload<S["events"][E]>) => void
						: () => void;
				}
			: Record<string, never>
		: Record<string, never>
	: Record<string, never>;

/**
 * Infer event payload from event schema.
 */
type InferEventPayload<E> = E extends Record<string, unknown>
	? { [K in keyof E]: E[K] extends { _type: infer T } ? T : E[K] }
	: never;

// ============================================================================
// Merged Schema Type (for internal use)
// ============================================================================

/**
 * Merge multiple module schemas into a single flat schema.
 * Used internally by the engine for storage.
 *
 * @example
 * ```typescript
 * // auth: { facts: { token: string } }
 * // data: { facts: { users: User[] } }
 * // Merged: { auth_token: string, data_users: User[] }
 * ```
 */
export type MergedModuleSchema<Modules extends ModulesMap> = {
	facts: MergeFactsWithPrefix<Modules>;
	derivations: MergeDerivationsWithPrefix<Modules>;
	events: MergeEventsWithPrefix<Modules>;
	requirements: MergeRequirementsWithPrefix<Modules>;
};

type MergeFactsWithPrefix<Modules extends ModulesMap> = {
	[K in keyof Modules as `${K & string}_${keyof ExtractSchema<Modules[K]>["facts"] & string}`]: ExtractSchema<Modules[K]>["facts"][keyof ExtractSchema<Modules[K]>["facts"]];
};

type MergeDerivationsWithPrefix<Modules extends ModulesMap> = {
	[K in keyof Modules as ExtractSchema<Modules[K]>["derivations"] extends Record<string, unknown>
		? `${K & string}_${keyof ExtractSchema<Modules[K]>["derivations"] & string}`
		: never]: ExtractSchema<Modules[K]>["derivations"] extends Record<string, unknown>
		? ExtractSchema<Modules[K]>["derivations"][keyof ExtractSchema<Modules[K]>["derivations"]]
		: never;
};

type MergeEventsWithPrefix<Modules extends ModulesMap> = {
	[K in keyof Modules as ExtractSchema<Modules[K]>["events"] extends Record<string, unknown>
		? `${K & string}_${keyof ExtractSchema<Modules[K]>["events"] & string}`
		: never]: ExtractSchema<Modules[K]>["events"] extends Record<string, unknown>
		? ExtractSchema<Modules[K]>["events"][keyof ExtractSchema<Modules[K]>["events"]]
		: never;
};

type MergeRequirementsWithPrefix<Modules extends ModulesMap> = {
	[K in keyof Modules as ExtractSchema<Modules[K]>["requirements"] extends Record<string, unknown>
		? keyof ExtractSchema<Modules[K]>["requirements"] & string
		: never]: ExtractSchema<Modules[K]>["requirements"] extends Record<string, unknown>
		? ExtractSchema<Modules[K]>["requirements"][keyof ExtractSchema<Modules[K]>["requirements"]]
		: never;
};

// ============================================================================
// Single Module Types (no namespace)
// ============================================================================

/**
 * Options for createSystem with a single module (no namespacing).
 */
export interface CreateSystemOptionsSingle<S extends ModuleSchema> {
	/** Single module = direct access (use `modules` for multiple) */
	module: ModuleDef<S>;
	/** Plugins to register */
	plugins?: Array<Plugin<ModuleSchema>>;
	/** Debug configuration */
	debug?: DebugConfig;
	/** Error boundary configuration */
	errorBoundary?: ErrorBoundaryConfig;
	/** Tick interval for time-based systems (ms) */
	tickMs?: number;
	/** Enable zero-config mode with sensible defaults */
	zeroConfig?: boolean;
	/**
	 * Initial facts to set after module init.
	 * Applied after module `init()` but before reconciliation.
	 */
	initialFacts?: Partial<InferFacts<S>>;
}

/**
 * System interface for a single module (no namespace).
 * Facts, derivations, and events are accessed directly.
 */
export interface SingleModuleSystem<S extends ModuleSchema> {
	/** System mode discriminator for type guards */
	readonly _mode: "single";
	/** Direct facts accessor: system.facts.count */
	readonly facts: Facts<S["facts"]>;
	/** Time-travel debugging API (if enabled) */
	readonly debug: TimeTravelAPI | null;
	/** Direct derivations accessor: system.derive.doubled */
	readonly derive: InferDerivations<S>;
	/** Direct events accessor: system.events.increment() */
	readonly events: SingleModuleEvents<S>;

	/** Start the system (initialize modules, begin reconciliation) */
	start(): void;
	/** Stop the system (cancel resolvers, stop reconciliation) */
	stop(): void;
	/** Destroy the system (stop and cleanup) */
	destroy(): void;

	/** Whether the system is currently running */
	readonly isRunning: boolean;
	/** Whether all resolvers have completed */
	readonly isSettled: boolean;
	/** Whether module has completed initialization */
	readonly isInitialized: boolean;
	/** Whether system has completed first reconciliation */
	readonly isReady: boolean;

	/** Wait for system to be fully ready (after first reconciliation) */
	whenReady(): Promise<void>;

	/**
	 * Hydrate facts from async source (call before start).
	 */
	hydrate(
		loader: () => Promise<Partial<InferFacts<S>>> | Partial<InferFacts<S>>,
	): Promise<void>;

	/** Dispatch an event */
	dispatch(event: InferEvents<S>): void;

	/** Batch multiple fact changes */
	batch(fn: () => void): void;

	/**
	 * Read a derivation value by key.
	 * @example system.read("doubled")
	 */
	read<T = unknown>(derivationId: string): T;

	/**
	 * Subscribe to derivation changes.
	 * @example system.subscribe(["doubled", "isPositive"], () => { ... })
	 */
	subscribe(derivationIds: string[], listener: () => void): () => void;

	/**
	 * Watch a derivation for changes.
	 * @example system.watch("doubled", (newVal, oldVal) => { ... })
	 */
	watch<T = unknown>(
		derivationId: string,
		callback: (newValue: T, previousValue: T | undefined) => void,
	): () => void;

	/** Inspect system state */
	inspect(): SystemInspection;
	/** Wait for system to settle (all resolvers complete) */
	settle(maxWait?: number): Promise<void>;
	/** Explain why a requirement exists */
	explain(requirementId: string): string | null;
	/** Get serializable snapshot of system state */
	getSnapshot(): SystemSnapshot;
	/** Restore system state from snapshot */
	restore(snapshot: SystemSnapshot): void;

	/**
	 * Get a distributable snapshot of computed derivations.
	 *
	 * @example
	 * ```typescript
	 * const snapshot = system.getDistributableSnapshot({
	 *   includeDerivations: ['effectivePlan', 'canUseFeature'],
	 *   ttlSeconds: 3600,
	 * });
	 * await redis.setex(`entitlements:${userId}`, 3600, JSON.stringify(snapshot));
	 * ```
	 */
	getDistributableSnapshot<T = Record<string, unknown>>(
		options?: DistributableSnapshotOptions,
	): DistributableSnapshot<T>;

	/**
	 * Watch for changes to distributable snapshot derivations.
	 * Calls the callback whenever any of the included derivations change.
	 * Returns an unsubscribe function.
	 *
	 * @example
	 * ```typescript
	 * const unsubscribe = system.watchDistributableSnapshot(
	 *   { includeDerivations: ['effectivePlan', 'canUseFeature'] },
	 *   (snapshot) => {
	 *     await redis.setex(`entitlements:${userId}`, 3600, JSON.stringify(snapshot));
	 *   }
	 * );
	 * ```
	 */
	watchDistributableSnapshot<T = Record<string, unknown>>(
		options: DistributableSnapshotOptions,
		callback: (snapshot: DistributableSnapshot<T>) => void,
	): () => void;
}

/**
 * Events dispatcher for a single module (direct access).
 */
type SingleModuleEvents<S extends ModuleSchema> = S["events"] extends Record<
	string,
	unknown
>
	? {
			[E in keyof S["events"]]: S["events"][E] extends Record<string, unknown>
				? keyof S["events"][E] extends never
					? () => void
					: (payload: InferEventPayload<S["events"][E]>) => void
				: () => void;
		}
	: Record<string, never>;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * System mode discriminator.
 * - "single": Single module with direct access (`system.facts.count`)
 * - "namespaced": Multiple modules with namespaced access (`system.facts.auth.token`)
 */
export type SystemMode = "single" | "namespaced";

/**
 * Base system type for type guards.
 * Use this for functions that accept either system type.
 */
export interface AnySystem {
	readonly _mode: SystemMode;
	readonly isRunning: boolean;
	readonly isSettled: boolean;
	readonly isInitialized: boolean;
	readonly isReady: boolean;
	start(): void;
	stop(): void;
	destroy(): void;
}

/**
 * Check if a system is a single module system.
 * Returns true if the system was created with `module:` (singular).
 *
 * @example
 * ```typescript
 * const system = createSystem({ module: counterModule });
 *
 * if (isSingleModuleSystem(system)) {
 *   // system._mode === "single"
 *   console.log(system.facts.count);
 * }
 * ```
 */
export function isSingleModuleSystem(system: AnySystem): boolean {
	return system._mode === "single";
}

/**
 * Check if a system is a namespaced (multi-module) system.
 * Returns true if the system was created with `modules:` (plural, object).
 *
 * @example
 * ```typescript
 * const system = createSystem({ modules: { auth, data } });
 *
 * if (isNamespacedSystem(system)) {
 *   // system._mode === "namespaced"
 *   console.log(system.facts.auth.token);
 * }
 * ```
 */
export function isNamespacedSystem(system: AnySystem): boolean {
	return system._mode === "namespaced";
}
