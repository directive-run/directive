/**
 * System Types - Type definitions for the system
 */

import type {
	ModuleSchema,
	InferFacts,
	InferDerivations,
	InferEvents,
	InferSchemaType,
} from "./schema.js";
import type { Facts } from "./facts.js";
import type {
	SystemEvent,
	EventsAccessorFromSchema,
} from "./events.js";
import type { RequirementWithId } from "./requirements.js";
import type { ResolverStatus } from "./resolvers.js";
import type { Plugin, Snapshot } from "./plugins.js";
import type { ErrorBoundaryConfig } from "./errors.js";
import type { ModuleDef } from "./module.js";

// ============================================================================
// Derive Accessor Types
// ============================================================================

/**
 * Derive accessor from module schema.
 */
export type DeriveAccessor<M extends ModuleSchema> = InferDerivations<M>;

/**
 * Fact keys from module schema.
 */
export type FactKeys<M extends ModuleSchema> = keyof M["facts"] & string;

/**
 * Get fact return type from module schema.
 */
export type FactReturnType<M extends ModuleSchema, K extends keyof M["facts"]> =
	InferSchemaType<M["facts"][K]>;

/**
 * Derivation keys from module schema.
 */
export type DerivationKeys<M extends ModuleSchema> = keyof M["derivations"] & string;

/**
 * Get derivation return type from module schema.
 */
export type DerivationReturnType<M extends ModuleSchema, K extends keyof M["derivations"]> =
	InferSchemaType<M["derivations"][K]>;

/**
 * All observable keys (facts + derivations) from module schema.
 */
export type ObservableKeys<M extends ModuleSchema> = FactKeys<M> | DerivationKeys<M>;

// ============================================================================
// Events Accessor Types
// ============================================================================

/**
 * Events accessor from module schema.
 */
export type EventsAccessor<M extends ModuleSchema> = EventsAccessorFromSchema<M>;

// ============================================================================
// Debug & Time-Travel Types
// ============================================================================

/**
 * Debug configuration passed to `createSystem()`.
 * Enables time-travel debugging with configurable snapshot limits.
 */
export interface DebugConfig {
	/** Enable time-travel debugging (default: false) */
	timeTravel?: boolean;
	/** Maximum number of snapshots to retain (default: 100) */
	maxSnapshots?: number;
}

/**
 * Time-travel debugging API. Available on `system.debug` when `debug.timeTravel` is enabled.
 * Provides snapshot-based undo/redo, export/import for session persistence,
 * and changesets for grouping related mutations.
 *
 * @example
 * ```typescript
 * const system = createSystem({
 *   module: myModule,
 *   debug: { timeTravel: true, maxSnapshots: 100 },
 * });
 * system.start();
 *
 * // Navigate history
 * system.debug.goBack();
 * system.debug.goForward();
 *
 * // Group related changes into a single undo step
 * system.debug.beginChangeset("form-edit");
 * system.facts.firstName = "Jane";
 * system.facts.lastName = "Doe";
 * system.debug.endChangeset();
 *
 * // Suppress snapshots during bulk operations
 * system.debug.pause();
 * // ... bulk mutations ...
 * system.debug.resume();
 *
 * // Export/import session for persistence
 * const json = system.debug.export();
 * system.debug.import(json);
 * ```
 */
export interface TimeTravelAPI {
	readonly snapshots: Snapshot[];
	readonly currentIndex: number;
	readonly isPaused: boolean;
	goBack(steps?: number): void;
	goForward(steps?: number): void;
	goTo(snapshotId: number): void;
	replay(): void;
	export(): string;
	import(json: string): void;
	beginChangeset(label: string): void;
	endChangeset(): void;
	pause(): void;
	resume(): void;
}

/** Lightweight snapshot metadata (no facts data – keeps re-renders cheap) */
export interface SnapshotMeta {
	/** Auto-incremented snapshot ID */
	id: number;
	/** Unix timestamp when the snapshot was taken */
	timestamp: number;
	/** Human-readable trigger description (e.g., "facts-changed:count") */
	trigger: string;
}

/**
 * Reactive time-travel state for framework adapter hooks (e.g., `useTimeTravel()`).
 * Provides all time-travel operations plus reactive properties (`canUndo`, `canRedo`)
 * that trigger re-renders when snapshot history changes.
 */
export interface TimeTravelState {
	// Existing (unchanged)
	canUndo: boolean;
	canRedo: boolean;
	undo: () => void;
	redo: () => void;
	currentIndex: number;
	totalSnapshots: number;

	// Snapshot access (metadata only — lightweight)
	snapshots: SnapshotMeta[];
	getSnapshotFacts: (id: number) => Record<string, unknown> | null;

	// Navigation
	goTo: (snapshotId: number) => void;
	goBack: (steps: number) => void;
	goForward: (steps: number) => void;
	replay: () => void;

	// Session persistence
	exportSession: () => string;
	importSession: (json: string) => void;

	// Changesets
	beginChangeset: (label: string) => void;
	endChangeset: () => void;

	// Recording control
	isPaused: boolean;
	pause: () => void;
	resume: () => void;
}

// ============================================================================
// System Inspection Types
// ============================================================================

/**
 * Runtime inspection snapshot returned by `system.inspect()`.
 * Provides a point-in-time view of the system's constraint/resolver state
 * for debugging and monitoring.
 *
 * @example
 * ```typescript
 * const inspection = system.inspect();
 * console.log(`Unmet requirements: ${inspection.unmet.length}`);
 * console.log(`Inflight resolvers: ${inspection.inflight.length}`);
 * for (const c of inspection.constraints) {
 *   console.log(`Constraint ${c.id}: active=${c.active}, priority=${c.priority}`);
 * }
 * ```
 */
export interface SystemInspection {
	/** Currently unmet requirements produced by active constraints */
	unmet: RequirementWithId[];
	/** Resolvers currently executing (with their start time for latency tracking) */
	inflight: Array<{ id: string; resolverId: string; startedAt: number }>;
	/** All constraint states (active/inactive and priority) */
	constraints: Array<{ id: string; active: boolean; priority: number }>;
	/** Resolver execution status keyed by resolver ID */
	resolvers: Record<string, ResolverStatus>;
}

/**
 * Structured explanation of why a requirement exists.
 * Returned by `system.explain()` to trace a requirement back to its
 * originating constraint and the facts that triggered it.
 */
export interface RequirementExplanation {
	/** Unique ID of the requirement */
	requirementId: string;
	/** The requirement type string (e.g., "FETCH_USER") */
	requirementType: string;
	/** ID of the constraint that produced this requirement */
	constraintId: string;
	/** Priority of the originating constraint */
	constraintPriority: number;
	/** Facts snapshot relevant to the constraint evaluation */
	relevantFacts: Record<string, unknown>;
	/** Current resolver execution status for this requirement */
	resolverStatus: ResolverStatus;
}

/** Serializable system snapshot for SSR/persistence */
export interface SystemSnapshot {
	facts: Record<string, unknown>;
	version?: number;
}

// ============================================================================
// Distributable Snapshot Types
// ============================================================================

/**
 * Options for creating a distributable snapshot.
 * Distributable snapshots contain computed derivation values that can be
 * serialized and distributed (JWT, Redis, edge KV) for use outside the runtime.
 */
export interface DistributableSnapshotOptions {
	/** Derivation keys to include (default: all) */
	includeDerivations?: string[];
	/** Derivation keys to exclude */
	excludeDerivations?: string[];
	/** Fact keys to include (default: none) */
	includeFacts?: string[];
	/** TTL in seconds */
	ttlSeconds?: number;
	/** Custom metadata */
	metadata?: Record<string, unknown>;
	/** Include version hash for cache invalidation */
	includeVersion?: boolean;
}

/**
 * A distributable snapshot containing computed state.
 * This is a serializable object that can be stored in Redis, JWT, etc.
 *
 * @example
 * ```typescript
 * const snapshot = system.getDistributableSnapshot({
 *   includeDerivations: ['effectivePlan', 'canUseFeature', 'limits'],
 *   ttlSeconds: 3600,
 * });
 * // { data: { effectivePlan: "pro", canUseFeature: {...} }, createdAt: ..., expiresAt: ... }
 *
 * // Store in Redis
 * await redis.setex(`entitlements:${userId}`, 3600, JSON.stringify(snapshot));
 *
 * // Later, in an API route (no Directive runtime needed)
 * const cached = JSON.parse(await redis.get(`entitlements:${userId}`));
 * if (!cached.data.canUseFeature.api) throw new ForbiddenError();
 * ```
 */
export interface DistributableSnapshot<T = Record<string, unknown>> {
	/** The computed derivation values and optionally included facts */
	data: T;
	/** Timestamp when this snapshot was created (ms since epoch) */
	createdAt: number;
	/** Timestamp when this snapshot expires (ms since epoch), if TTL was specified */
	expiresAt?: number;
	/** Version hash for cache invalidation, if includeVersion was true */
	version?: string;
	/** Custom metadata passed in options */
	metadata?: Record<string, unknown>;
}

// ============================================================================
// System Interface
// ============================================================================

/**
 * System interface using consolidated module schema.
 * Provides full type inference for facts, derivations, events, and dispatch.
 */
/**
 * Runtime control for enabling/disabling individual constraints.
 * Available on `system.constraints`.
 *
 * @example
 * ```typescript
 * // Disable a constraint during maintenance
 * system.constraints.disable("rateLimiter");
 *
 * // Re-enable it
 * system.constraints.enable("rateLimiter");
 * ```
 */
export interface ConstraintsControl {
	/** Disable a constraint by ID — it will be excluded from evaluation */
	disable(id: string): void;
	/** Enable a previously disabled constraint — it will be re-evaluated on the next cycle */
	enable(id: string): void;
}

/**
 * Runtime control for enabling/disabling individual effects.
 * Available on `system.effects`.
 *
 * @example
 * ```typescript
 * // Disable analytics during tests
 * system.effects.disable("trackPageView");
 *
 * // Check if an effect is active
 * if (system.effects.isEnabled("trackPageView")) {
 *   console.log("Analytics is running");
 * }
 * ```
 */
export interface EffectsControl {
	/** Disable an effect by ID — it will be skipped during reconciliation */
	disable(id: string): void;
	/** Enable a previously disabled effect */
	enable(id: string): void;
	/** Check if an effect is currently enabled */
	isEnabled(id: string): boolean;
}

export interface System<M extends ModuleSchema = ModuleSchema> {
	readonly facts: Facts<M["facts"]>;
	readonly debug: TimeTravelAPI | null;
	readonly derive: InferDerivations<M>;
	readonly events: EventsAccessorFromSchema<M>;
	readonly constraints: ConstraintsControl;
	readonly effects: EffectsControl;

	start(): void;
	stop(): void;
	destroy(): void;

	readonly isRunning: boolean;
	readonly isSettled: boolean;
	/** Whether all modules have completed initialization */
	readonly isInitialized: boolean;
	/** Whether system has completed first reconciliation */
	readonly isReady: boolean;

	/** Wait for system to be fully ready (after first reconciliation) */
	whenReady(): Promise<void>;

	dispatch(event: InferEvents<M>): void;
	dispatch(event: SystemEvent): void;

	/**
	 * Group multiple fact mutations into a single reconciliation cycle.
	 * Nested batch calls are safe – only the outermost batch triggers reconciliation.
	 *
	 * @param fn - Synchronous function containing fact mutations.
	 *
	 * @example
	 * ```typescript
	 * system.batch(() => {
	 *   system.facts.firstName = "Jane";
	 *   system.facts.lastName = "Doe";
	 *   system.facts.email = "jane@example.com";
	 * });
	 * // Single reconciliation for all three changes
	 * ```
	 */
	batch(fn: () => void): void;

	/**
	 * Subscribe to settlement state changes.
	 * Called whenever the system's settled state may have changed
	 * (resolver starts/completes, reconcile starts/ends).
	 */
	onSettledChange(listener: () => void): () => void;

	/**
	 * Subscribe to time-travel state changes.
	 * Called whenever a snapshot is taken or time-travel navigation occurs.
	 * Returns an unsubscribe function.
	 */
	onTimeTravelChange(listener: () => void): () => void;

	read<K extends DerivationKeys<M>>(derivationId: K): DerivationReturnType<M, K>;
	read<T = unknown>(derivationId: string): T;
	/**
	 * Subscribe to fact or derivation changes.
	 * Keys are auto-detected -- pass any mix of fact keys and derivation keys.
	 * @example system.subscribe(["count", "doubled"], () => { ... })
	 */
	subscribe(ids: Array<ObservableKeys<M>>, listener: () => void): () => void;

	/**
	 * Watch a fact or derivation for value changes.
	 * The key is auto-detected -- works with both fact keys and derivation keys.
	 * Pass `options.equalityFn` for custom comparison (e.g., shallow equality for objects).
	 * @example system.watch("count", (newVal, oldVal) => { ... })
	 * @example system.watch("derived", cb, { equalityFn: shallowEqual })
	 */
	watch<K extends DerivationKeys<M>>(
		id: K,
		callback: (newValue: DerivationReturnType<M, K>, previousValue: DerivationReturnType<M, K> | undefined) => void,
		options?: { equalityFn?: (a: DerivationReturnType<M, K>, b: DerivationReturnType<M, K> | undefined) => boolean },
	): () => void;
	watch<K extends FactKeys<M>>(
		id: K,
		callback: (newValue: FactReturnType<M, K>, previousValue: FactReturnType<M, K> | undefined) => void,
		options?: { equalityFn?: (a: FactReturnType<M, K>, b: FactReturnType<M, K> | undefined) => boolean },
	): () => void;
	watch<T = unknown>(
		id: string,
		callback: (newValue: T, previousValue: T | undefined) => void,
		options?: { equalityFn?: (a: T, b: T | undefined) => boolean },
	): () => void;

	/**
	 * Returns a promise that resolves when the predicate becomes true.
	 * The predicate is evaluated against current facts and re-evaluated on every change.
	 * Optionally pass a timeout in ms -- rejects with an error if exceeded.
	 *
	 * @example
	 * await system.when((facts) => facts.phase === "ready");
	 * @example
	 * await system.when((facts) => facts.count > 10, { timeout: 5000 });
	 */
	when(
		predicate: (facts: Readonly<InferFacts<M>>) => boolean,
		options?: { timeout?: number },
	): Promise<void>;

	/**
	 * Inspect the current runtime state – unmet requirements, inflight resolvers,
	 * constraint activity, and resolver statuses.
	 *
	 * @returns A point-in-time snapshot of the system's constraint/resolver state.
	 *
	 * @example
	 * ```typescript
	 * const { unmet, inflight, constraints } = system.inspect();
	 * if (inflight.length > 0) {
	 *   console.log("Resolvers still running:", inflight.map(r => r.resolverId));
	 * }
	 * ```
	 */
	inspect(): SystemInspection;

	/**
	 * Wait until all inflight resolvers complete and no reconciliation is pending.
	 * Useful in tests and scripts that need to await full system stabilization.
	 *
	 * @param maxWait - Maximum time to wait in milliseconds (default: 5000).
	 * @throws If the timeout is exceeded while resolvers are still inflight.
	 *
	 * @example
	 * ```typescript
	 * system.start();
	 * system.facts.userId = "u_123";
	 * await system.settle(); // waits for FETCH_USER resolver to finish
	 * expect(system.facts.user).toBeDefined();
	 * ```
	 */
	settle(maxWait?: number): Promise<void>;

	/**
	 * Explain why a specific requirement exists – traces it back to the
	 * originating constraint, its priority, payload, and the current resolver status.
	 *
	 * @param requirementId - The ID of the requirement to explain.
	 * @returns A human-readable multi-line explanation string, or `null` if the requirement is not found.
	 *
	 * @example
	 * ```typescript
	 * const { unmet } = system.inspect();
	 * for (const req of unmet) {
	 *   console.log(system.explain(req.id));
	 *   // Requirement "FETCH_USER" (id: req_abc123)
	 *   // ├─ Produced by constraint: needsUser
	 *   // ├─ Constraint priority: 50
	 *   // └─ Resolver status: pending
	 * }
	 * ```
	 */
	explain(requirementId: string): string | null;
	getSnapshot(): SystemSnapshot;
	restore(snapshot: SystemSnapshot): void;

	/**
	 * Get a distributable snapshot of computed derivations.
	 * This creates a serializable object that can be stored in Redis, JWT, etc.
	 * for use outside the Directive runtime.
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
	 *     // Snapshot changed - push to Redis/edge cache
	 *     await redis.setex(`entitlements:${userId}`, 3600, JSON.stringify(snapshot));
	 *   }
	 * );
	 *
	 * // Later, cleanup
	 * unsubscribe();
	 * ```
	 */
	watchDistributableSnapshot<T = Record<string, unknown>>(
		options: DistributableSnapshotOptions,
		callback: (snapshot: DistributableSnapshot<T>) => void,
	): () => void;
}

// ============================================================================
// System Configuration
// ============================================================================

/** System configuration */
export interface SystemConfig<M extends ModuleSchema = ModuleSchema> {
	modules: Array<ModuleDef<M>>;
	// biome-ignore lint/suspicious/noExplicitAny: Plugins are schema-agnostic
	plugins?: Array<Plugin<any>>;
	debug?: DebugConfig;
	errorBoundary?: ErrorBoundaryConfig;
	/**
	 * Callback invoked after module inits but before first reconcile.
	 * Used by system wrapper to apply initialFacts/hydrate at the right time.
	 * @internal
	 */
	onAfterModuleInit?: () => void;
	tickMs?: number;
}
