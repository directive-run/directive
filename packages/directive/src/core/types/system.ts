/**
 * System Types - Type definitions for the system
 */

import type {
	ModuleSchema,
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
 * Derivation keys from module schema.
 */
export type DerivationKeys<M extends ModuleSchema> = keyof M["derivations"] & string;

/**
 * Get derivation return type from module schema.
 */
export type DerivationReturnType<M extends ModuleSchema, K extends keyof M["derivations"]> =
	InferSchemaType<M["derivations"][K]>;

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

/** Debug configuration */
export interface DebugConfig {
	timeTravel?: boolean;
	maxSnapshots?: number;
}

/** Time-travel API */
export interface TimeTravelAPI {
	readonly snapshots: Snapshot[];
	readonly currentIndex: number;
	goBack(steps?: number): void;
	goForward(steps?: number): void;
	goTo(snapshotId: number): void;
	replay(): void;
	export(): string;
	import(json: string): void;
}

// ============================================================================
// System Inspection Types
// ============================================================================

/** System inspection result */
export interface SystemInspection {
	unmet: RequirementWithId[];
	inflight: Array<{ id: string; resolverId: string; startedAt: number }>;
	constraints: Array<{ id: string; active: boolean; priority: number }>;
	resolvers: Record<string, ResolverStatus>;
}

/** Explanation of why a requirement exists */
export interface RequirementExplanation {
	requirementId: string;
	requirementType: string;
	constraintId: string;
	constraintPriority: number;
	relevantFacts: Record<string, unknown>;
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
export interface System<M extends ModuleSchema = ModuleSchema> {
	readonly facts: Facts<M["facts"]>;
	readonly debug: TimeTravelAPI | null;
	readonly derive: InferDerivations<M>;
	readonly events: EventsAccessorFromSchema<M>;

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

	batch(fn: () => void): void;

	read<K extends DerivationKeys<M>>(derivationId: K): DerivationReturnType<M, K>;
	read<T = unknown>(derivationId: string): T;
	subscribe(derivationIds: string[], listener: () => void): () => void;

	watch<K extends DerivationKeys<M>>(
		derivationId: K,
		callback: (newValue: DerivationReturnType<M, K>, previousValue: DerivationReturnType<M, K> | undefined) => void,
	): () => void;
	watch<T = unknown>(
		derivationId: string,
		callback: (newValue: T, previousValue: T | undefined) => void,
	): () => void;

	inspect(): SystemInspection;
	settle(maxWait?: number): Promise<void>;
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
