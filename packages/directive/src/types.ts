/**
 * Core type definitions for Directive
 */

// ============================================================================
// Schema Types
// ============================================================================

/** Primitive type definitions for schema */
export interface SchemaType<T> {
	readonly _type: T;
	readonly _validators: Array<(value: T) => boolean>;
	validate(fn: (value: T) => boolean): SchemaType<T>;
}

/** Schema definition mapping keys to types */
export type Schema = Record<string, SchemaType<unknown>>;

/** Extract the TypeScript type from a schema */
export type InferSchema<S extends Schema> = {
	[K in keyof S]: S[K]["_type"];
};

// ============================================================================
// Facts Types
// ============================================================================

/** Read-only snapshot of facts */
export interface FactsSnapshot<S extends Schema = Schema> {
	get<K extends keyof InferSchema<S>>(key: K): InferSchema<S>[K] | undefined;
	has(key: keyof InferSchema<S>): boolean;
}

/** Mutable facts store */
export interface FactsStore<S extends Schema = Schema>
	extends FactsSnapshot<S> {
	set<K extends keyof InferSchema<S>>(key: K, value: InferSchema<S>[K]): void;
	delete(key: keyof InferSchema<S>): void;
	batch(fn: () => void): void;
	subscribe(keys: Array<keyof InferSchema<S>>, listener: () => void): () => void;
	subscribeAll(listener: () => void): () => void;
	/** Get all facts as a plain object (for serialization/time-travel) */
	toObject(): Record<string, unknown>;
}

/** Proxy-based facts accessor (cleaner API) */
export type Facts<S extends Schema = Schema> = InferSchema<S> & {
	readonly $store: FactsStore<S>;
	readonly $snapshot: () => FactsSnapshot<S>;
};

// ============================================================================
// Tracking Types
// ============================================================================

/** Tracking context for auto-dependency detection */
export interface TrackingContext {
	readonly isTracking: boolean;
	track(key: string): void;
	getDependencies(): Set<string>;
}

// ============================================================================
// Derivation Types
// ============================================================================

/** Derivation definition */
export interface DerivationDef<S extends Schema, T, D extends DerivationsDef<S>> {
	(facts: Facts<S>, derive: DerivedValues<S, D>): T;
}

/** Map of derivation definitions */
export type DerivationsDef<S extends Schema> = Record<
	string,
	DerivationDef<S, unknown, DerivationsDef<S>>
>;

/** Computed derived values */
export type DerivedValues<S extends Schema, D extends DerivationsDef<S>> = {
	readonly [K in keyof D]: ReturnType<D[K]>;
};

/** Internal derivation state */
export interface DerivationState<T> {
	id: string;
	compute: () => T;
	cachedValue: T | undefined;
	dependencies: Set<string>;
	isStale: boolean;
	isComputing: boolean;
}

// ============================================================================
// Effect Types
// ============================================================================

/** Effect definition */
export interface EffectDef<S extends Schema> {
	run(facts: Facts<S>, prev: FactsSnapshot<S> | null): void | Promise<void>;
	/** Optional explicit dependencies for optimization */
	deps?: Array<keyof InferSchema<S>>;
}

/** Map of effect definitions */
export type EffectsDef<S extends Schema> = Record<string, EffectDef<S>>;

// ============================================================================
// Requirement Types
// ============================================================================

/** Base requirement structure */
export interface Requirement {
	readonly type: string;
	readonly [key: string]: unknown;
}

/** Requirement with computed identity */
export interface RequirementWithId {
	readonly requirement: Requirement;
	readonly id: string;
	readonly fromConstraint: string;
}

/** Requirement key function for custom deduplication */
export type RequirementKeyFn<R extends Requirement = Requirement> = (
	req: R,
) => string;

// ============================================================================
// Constraint Types
// ============================================================================

/** Constraint definition */
export interface ConstraintDef<S extends Schema, R extends Requirement = Requirement> {
	/** Priority for ordering (higher runs first) */
	priority?: number;
	/** Mark this constraint as async (avoids runtime detection) */
	async?: boolean;
	/** Condition function (sync or async) */
	when: (facts: Facts<S>) => boolean | Promise<boolean>;
	/** Requirement to produce when condition is met */
	require: R | ((facts: Facts<S>) => R);
	/** Timeout for async constraints (ms) */
	timeout?: number;
}

/** Map of constraint definitions */
export type ConstraintsDef<S extends Schema> = Record<
	string,
	ConstraintDef<S, Requirement>
>;

/** Internal constraint state */
export interface ConstraintState {
	id: string;
	priority: number;
	isAsync: boolean;
	lastResult: boolean | null;
	isEvaluating: boolean;
	error: Error | null;
}

// ============================================================================
// Resolver Types
// ============================================================================

/** Retry policy configuration */
export interface RetryPolicy {
	/** Maximum number of attempts */
	attempts: number;
	/** Backoff strategy */
	backoff: "none" | "linear" | "exponential";
	/** Initial delay in ms */
	initialDelay?: number;
	/** Maximum delay in ms */
	maxDelay?: number;
}

/** Batch configuration */
export interface BatchConfig {
	/** Enable batching */
	enabled: boolean;
	/** Time window to collect requirements (ms) */
	windowMs: number;
}

/** Resolver context passed to resolve function */
export interface ResolverContext<S extends Schema = Schema> {
	readonly facts: Facts<S>;
	readonly signal: AbortSignal;
	readonly snapshot: () => FactsSnapshot<S>;
}

/** Single resolver definition */
export interface ResolverDef<S extends Schema, R extends Requirement = Requirement> {
	/** Predicate to check if this resolver handles a requirement */
	handles: (req: Requirement) => req is R;
	/** Custom key function for deduplication */
	key?: RequirementKeyFn<R>;
	/** Retry policy */
	retry?: RetryPolicy;
	/** Timeout for resolver execution (ms) */
	timeout?: number;
	/** Batch configuration (mutually exclusive with regular resolve) */
	batch?: BatchConfig;
	/** Resolve function for single requirement */
	resolve?: (req: R, ctx: ResolverContext<S>) => Promise<void>;
	/** Resolve function for batched requirements */
	resolveBatch?: (reqs: R[], ctx: ResolverContext<S>) => Promise<void>;
}

/** Map of resolver definitions */
export type ResolversDef<S extends Schema> = Record<
	string,
	ResolverDef<S, Requirement>
>;

/** Resolver status */
export type ResolverStatus =
	| { state: "idle" }
	| { state: "pending"; requirementId: string; startedAt: number }
	| { state: "running"; requirementId: string; startedAt: number; attempt: number }
	| { state: "success"; requirementId: string; completedAt: number; duration: number }
	| { state: "error"; requirementId: string; error: Error; failedAt: number; attempts: number }
	| { state: "canceled"; requirementId: string; canceledAt: number };

// ============================================================================
// Plugin Types
// ============================================================================

/** Fact change record */
export interface FactChange {
	key: string;
	value: unknown;
	prev: unknown;
	type: "set" | "delete";
}

/** Reconcile result */
export interface ReconcileResult {
	unmet: RequirementWithId[];
	inflight: Array<{ id: string; resolverId: string; startedAt: number }>;
	completed: Array<{ id: string; resolverId: string; duration: number }>;
	canceled: Array<{ id: string; resolverId: string }>;
}

/** Snapshot for time-travel */
export interface Snapshot {
	id: number;
	timestamp: number;
	facts: Record<string, unknown>;
	trigger: string;
}

/** Recovery strategy for errors */
export type RecoveryStrategy = "skip" | "retry" | "disable" | "throw";

/**
 * Plugin interface for extending Directive functionality.
 *
 * Plugins receive lifecycle hooks at every stage of the system's operation.
 * All hooks except `onInit` are synchronous - use them for logging, metrics,
 * or triggering external effects, not for async operations that should block.
 */
export interface Plugin<S extends Schema = Schema> {
	/** Unique name for this plugin (used in error messages and debugging) */
	name: string;

	// ============================================================================
	// Lifecycle Hooks
	// ============================================================================

	/**
	 * Called once when the system is created, before start().
	 * This is the only async hook - use it for async initialization.
	 * @param system - The system instance
	 */
	onInit?: (system: System<S>) => void | Promise<void>;

	/**
	 * Called when system.start() is invoked.
	 * Module init functions have already run at this point.
	 * @param system - The system instance
	 */
	onStart?: (system: System<S>) => void;

	/**
	 * Called when system.stop() is invoked.
	 * All resolvers have been canceled at this point.
	 * @param system - The system instance
	 */
	onStop?: (system: System<S>) => void;

	/**
	 * Called when system.destroy() is invoked.
	 * Use for final cleanup (closing connections, etc.).
	 * @param system - The system instance
	 */
	onDestroy?: (system: System<S>) => void;

	// ============================================================================
	// Fact Hooks
	// ============================================================================

	/**
	 * Called when a single fact is set (not during batch).
	 * @param key - The fact key that changed
	 * @param value - The new value
	 * @param prev - The previous value (undefined if new)
	 */
	onFactSet?: (key: string, value: unknown, prev: unknown) => void;

	/**
	 * Called when a fact is deleted.
	 * @param key - The fact key that was deleted
	 * @param prev - The previous value
	 */
	onFactDelete?: (key: string, prev: unknown) => void;

	/**
	 * Called after a batch of fact changes completes.
	 * Use this instead of onFactSet for batched operations.
	 * @param changes - Array of all changes in the batch
	 */
	onFactsBatch?: (changes: FactChange[]) => void;

	// ============================================================================
	// Derivation Hooks
	// ============================================================================

	/**
	 * Called when a derivation is computed (or recomputed).
	 * @param id - The derivation ID
	 * @param value - The computed value
	 * @param deps - Array of fact keys this derivation depends on
	 */
	onDerivationCompute?: (id: string, value: unknown, deps: string[]) => void;

	/**
	 * Called when a derivation is invalidated (marked stale).
	 * The derivation will be recomputed on next access.
	 * @param id - The derivation ID
	 */
	onDerivationInvalidate?: (id: string) => void;

	// ============================================================================
	// Reconciliation Hooks
	// ============================================================================

	/**
	 * Called at the start of each reconciliation loop.
	 * @param snapshot - Read-only snapshot of current facts
	 */
	onReconcileStart?: (snapshot: FactsSnapshot<S>) => void;

	/**
	 * Called at the end of each reconciliation loop.
	 * @param result - Summary of what happened (unmet, inflight, completed, canceled)
	 */
	onReconcileEnd?: (result: ReconcileResult) => void;

	// ============================================================================
	// Constraint Hooks
	// ============================================================================

	/**
	 * Called after a constraint's `when` function is evaluated.
	 * @param id - The constraint ID
	 * @param active - Whether the constraint is active (when returned true)
	 */
	onConstraintEvaluate?: (id: string, active: boolean) => void;

	/**
	 * Called when a constraint's `when` function throws an error.
	 * @param id - The constraint ID
	 * @param error - The error that was thrown
	 */
	onConstraintError?: (id: string, error: unknown) => void;

	// ============================================================================
	// Requirement Hooks
	// ============================================================================

	/**
	 * Called when a new requirement is created by a constraint.
	 * @param req - The requirement with its computed ID
	 */
	onRequirementCreated?: (req: RequirementWithId) => void;

	/**
	 * Called when a requirement is fulfilled by a resolver.
	 * @param req - The requirement that was met
	 * @param byResolver - The ID of the resolver that fulfilled it
	 */
	onRequirementMet?: (req: RequirementWithId, byResolver: string) => void;

	/**
	 * Called when a requirement is canceled (constraint no longer active).
	 * @param req - The requirement that was canceled
	 */
	onRequirementCanceled?: (req: RequirementWithId) => void;

	// ============================================================================
	// Resolver Hooks
	// ============================================================================

	/**
	 * Called when a resolver starts processing a requirement.
	 * @param resolver - The resolver ID
	 * @param req - The requirement being resolved
	 */
	onResolverStart?: (resolver: string, req: RequirementWithId) => void;

	/**
	 * Called when a resolver successfully completes.
	 * @param resolver - The resolver ID
	 * @param req - The requirement that was resolved
	 * @param duration - Time in ms to complete
	 */
	onResolverComplete?: (resolver: string, req: RequirementWithId, duration: number) => void;

	/**
	 * Called when a resolver fails (after all retries exhausted).
	 * @param resolver - The resolver ID
	 * @param req - The requirement that failed
	 * @param error - The final error
	 */
	onResolverError?: (resolver: string, req: RequirementWithId, error: unknown) => void;

	/**
	 * Called when a resolver is about to retry after failure.
	 * @param resolver - The resolver ID
	 * @param req - The requirement being retried
	 * @param attempt - The attempt number (2 for first retry, etc.)
	 */
	onResolverRetry?: (resolver: string, req: RequirementWithId, attempt: number) => void;

	/**
	 * Called when a resolver is canceled (requirement no longer needed).
	 * @param resolver - The resolver ID
	 * @param req - The requirement that was canceled
	 */
	onResolverCancel?: (resolver: string, req: RequirementWithId) => void;

	// ============================================================================
	// Effect Hooks
	// ============================================================================

	/**
	 * Called when an effect runs.
	 * @param id - The effect ID
	 */
	onEffectRun?: (id: string) => void;

	/**
	 * Called when an effect throws an error.
	 * @param id - The effect ID
	 * @param error - The error that was thrown
	 */
	onEffectError?: (id: string, error: unknown) => void;

	// ============================================================================
	// Time-Travel Hooks
	// ============================================================================

	/**
	 * Called when a time-travel snapshot is taken.
	 * @param snapshot - The snapshot that was captured
	 */
	onSnapshot?: (snapshot: Snapshot) => void;

	/**
	 * Called when time-travel navigation occurs.
	 * @param from - The index we navigated from
	 * @param to - The index we navigated to
	 */
	onTimeTravel?: (from: number, to: number) => void;

	// ============================================================================
	// Error Boundary Hooks
	// ============================================================================

	/**
	 * Called when any error occurs in the system.
	 * @param error - The DirectiveError with source and context
	 */
	onError?: (error: DirectiveError) => void;

	/**
	 * Called when error recovery is attempted.
	 * @param error - The error that triggered recovery
	 * @param strategy - The recovery strategy used
	 */
	onErrorRecovery?: (error: DirectiveError, strategy: RecoveryStrategy) => void;
}

// ============================================================================
// Error Types
// ============================================================================

/** Error source types */
export type ErrorSource = "constraint" | "resolver" | "effect" | "derivation" | "system";

/** Directive error class */
export class DirectiveError extends Error {
	constructor(
		message: string,
		public readonly source: ErrorSource,
		public readonly sourceId: string,
		public readonly context?: unknown,
		public readonly recoverable: boolean = true,
	) {
		super(message);
		this.name = "DirectiveError";
	}
}

/** Error boundary configuration */
export interface ErrorBoundaryConfig {
	onConstraintError?: RecoveryStrategy | ((error: Error, constraint: string) => void);
	onResolverError?: RecoveryStrategy | ((error: Error, resolver: string) => void);
	onEffectError?: RecoveryStrategy | ((error: Error, effect: string) => void);
	onDerivationError?: RecoveryStrategy | ((error: Error, derivation: string) => void);
	onError?: (error: DirectiveError) => void;
}

// ============================================================================
// Module Types
// ============================================================================

/** Event handler function - receives facts and the full event object */
export type EventHandler<S extends Schema> = (facts: Facts<S>, event: SystemEvent) => void;

/** Events definition */
export type EventsDef<S extends Schema> = Record<string, EventHandler<S>>;

/** Lifecycle hooks for modules */
export interface ModuleHooks<S extends Schema> {
	onInit?: (system: System<S>) => void;
	onStart?: (system: System<S>) => void;
	onStop?: (system: System<S>) => void;
	onError?: (error: DirectiveError, context: unknown) => void;
}

/** Module definition */
export interface ModuleDef<
	S extends Schema,
	D extends DerivationsDef<S> = DerivationsDef<S>,
> {
	id: string;
	schema: S;
	init?: ((facts: Facts<S>) => void) | undefined;
	events?: EventsDef<S> | undefined;
	derive?: D | undefined;
	effects?: EffectsDef<S> | undefined;
	constraints?: ConstraintsDef<S> | undefined;
	resolvers?: ResolversDef<S> | undefined;
	hooks?: ModuleHooks<S> | undefined;
}

// ============================================================================
// System Types
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

/** System inspection result */
export interface SystemInspection {
	unmet: RequirementWithId[];
	inflight: Array<{ id: string; resolverId: string; startedAt: number }>;
	constraints: Array<{ id: string; active: boolean; priority: number }>;
	resolvers: Record<string, ResolverStatus>;
}

/** System event */
export interface SystemEvent {
	type: string;
	[key: string]: unknown;
}

/**
 * Typed event definition for type-safe event payloads.
 * Use with EventsDef to get compile-time validation of event payloads.
 *
 * @example
 * ```typescript
 * // Define typed events
 * type MyEvents = {
 *   tick: {};
 *   setPhase: { phase: "red" | "green" | "yellow" };
 *   updateScore: { delta: number; playerId: string };
 * };
 *
 * // Use in module
 * events: {
 *   tick: (facts) => { facts.elapsed += 1; },
 *   setPhase: (facts, event) => { facts.phase = event.phase; }, // event.phase is typed!
 *   updateScore: (facts, event) => { facts.scores[event.playerId] += event.delta; },
 * } satisfies TypedEventHandlers<MySchema, MyEvents>,
 * ```
 */
export type TypedEvent<T extends string, P extends Record<string, unknown> = Record<string, never>> = {
	type: T;
} & P;

/**
 * Event handler function with typed payload.
 * The event parameter includes both the type and the typed payload.
 */
export type TypedEventHandler<
	S extends Schema,
	E extends { type: string } & Record<string, unknown>,
> = (facts: Facts<S>, event: E) => void;

/**
 * Map of typed event handlers.
 * Use `satisfies TypedEventHandlers<S, E>` for compile-time validation.
 */
export type TypedEventHandlers<
	S extends Schema,
	E extends Record<string, Record<string, unknown>>,
> = {
	[K in keyof E]: TypedEventHandler<S, TypedEvent<K & string, E[K]>>;
};

/** System interface */
export interface System<S extends Schema = Schema> {
	readonly facts: Facts<S>;
	readonly debug: TimeTravelAPI | null;

	// Lifecycle
	start(): void;
	stop(): void;
	destroy(): void;

	// Events
	dispatch(event: SystemEvent): void;

	// Derivations
	/**
	 * Read a derived value by ID.
	 *
	 * @param derivationId - The ID of the derivation (matches key in module's `derive` property)
	 * @returns The computed value, or undefined if derivation doesn't exist
	 *
	 * @example
	 * ```typescript
	 * // If module defines: derive: { isRed: (facts) => facts.phase === "red" }
	 * const isRed = system.read("isRed"); // boolean
	 * const doubled = system.read<number>("doubled"); // type hint for complex returns
	 * ```
	 */
	read<T = unknown>(derivationId: string): T;
	subscribe(derivationIds: string[], listener: () => void): () => void;

	/**
	 * Watch a derivation and call a callback when its value changes.
	 * This is useful for reacting to computed value changes outside of React.
	 *
	 * @param derivationId - The ID of the derivation to watch
	 * @param callback - Called with (newValue, previousValue) when the derivation changes
	 * @returns Unsubscribe function
	 *
	 * @example
	 * ```typescript
	 * // Log when phase changes to red
	 * const unwatch = system.watch("isRed", (isRed, wasRed) => {
	 *   if (isRed && !wasRed) {
	 *     console.log("Light turned red!");
	 *   }
	 * });
	 *
	 * // Later: clean up
	 * unwatch();
	 * ```
	 */
	watch<T = unknown>(
		derivationId: string,
		callback: (newValue: T, previousValue: T | undefined) => void,
	): () => void;

	// Inspection
	inspect(): SystemInspection;

	/**
	 * Wait for the system to settle (no unmet requirements and no inflight resolvers).
	 * Useful for deterministic testing.
	 *
	 * @param maxWait - Maximum time to wait in ms (default: 5000)
	 * @returns Promise that resolves when system is idle
	 * @throws Error if timeout is exceeded
	 *
	 * @example
	 * ```typescript
	 * system.dispatch({ type: "fetchUser", userId: 123 });
	 * await system.settle(); // Wait for resolver to complete
	 * expect(system.facts.user).toBeDefined();
	 * ```
	 */
	settle(maxWait?: number): Promise<void>;

	/**
	 * Explain why a requirement is being produced (for debugging).
	 * Returns a human-readable explanation of the constraint chain.
	 *
	 * @param requirementId - The requirement ID to explain (from inspect().unmet)
	 * @returns Human-readable explanation or null if requirement not found
	 *
	 * @example
	 * ```typescript
	 * const inspection = system.inspect();
	 * for (const req of inspection.unmet) {
	 *   console.log(system.explain(req.id));
	 *   // Output:
	 *   // Requirement "FETCH_USER" (id: constraint:fetchUser:user-123)
	 *   // - Produced by constraint: fetchUser
	 *   // - Constraint is active because: when(facts) returned true
	 *   // - Relevant facts: userId=123, user=undefined
	 * }
	 * ```
	 */
	explain(requirementId: string): string | null;
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

/** System configuration */
export interface SystemConfig<S extends Schema> {
	modules: Array<ModuleDef<S, DerivationsDef<S>>>;
	plugins?: Array<Plugin<S>> | undefined;
	debug?: DebugConfig | undefined;
	errorBoundary?: ErrorBoundaryConfig | undefined;
	tickMs?: number | undefined;
}
