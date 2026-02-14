/**
 * Engine - The core reconciliation loop
 *
 * The engine orchestrates:
 * 1. Fact changes trigger reconciliation
 * 2. Constraints produce requirements
 * 3. Resolvers fulfill requirements
 * 4. Effects run after stabilization
 * 5. Derivations are invalidated and recomputed
 */

import { createConstraintsManager, type ConstraintsManager } from "./constraints.js";
import { createDerivationsManager, type DerivationsManager } from "./derivations.js";
import { createEffectsManager, type EffectsManager } from "./effects.js";
import { createErrorBoundaryManager, type ErrorBoundaryManager } from "./errors.js";
import { createFacts } from "./facts.js";
import { createPluginManager, type PluginManager } from "./plugins.js";
import { RequirementSet } from "./requirements.js";
import { createResolversManager, type ResolversManager } from "./resolvers.js";
import { createDisabledTimeTravel, createTimeTravelManager, type TimeTravelManager } from "../utils/time-travel.js";
import { isPrototypeSafe, hashObject } from "../utils/utils.js";

// Blocked properties for prototype pollution protection
const BLOCKED_PROPS = new Set(["__proto__", "constructor", "prototype"]);
import type {
	ConstraintsDef,
	DerivationsDef,
	EffectsDef,
	EventsDef,
	FactsSnapshot,
	InferSchema,
	ReconcileResult,
	ResolversDef,
	Schema,
	System,
	SystemConfig,
	SystemEvent,
	SystemInspection,
} from "./types.js";

// ============================================================================
// Engine Implementation
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface EngineState<_S extends Schema> {
	isRunning: boolean;
	isReconciling: boolean;
	reconcileScheduled: boolean;
	isInitializing: boolean;
	isInitialized: boolean;
	isReady: boolean;
	isDestroyed: boolean;
	changedKeys: Set<string>;
	previousRequirements: RequirementSet;
	readyPromise: Promise<void> | null;
	readyResolve: (() => void) | null;
}

/**
 * Create the Directive engine – the core reconciliation loop that orchestrates
 * fact changes, constraint evaluation, requirement resolution, and effects.
 *
 * This is an internal function used by `createSystem()`. Most users should use
 * `createSystem()` directly instead.
 *
 * @param config - Merged system configuration containing modules, plugins, and debug settings.
 * @returns A fully wired `System` instance ready for `start()`.
 */
// biome-ignore lint/suspicious/noExplicitAny: Engine uses flat schema internally, public API uses ModuleSchema
export function createEngine<S extends Schema>(
	config: SystemConfig<any>,
): System<any> {
	// Merge all module definitions with collision detection
	// Use Object.create(null) to prevent prototype chain traversal (e.g., "toString" in mergedEvents)
	const mergedSchema = Object.create(null) as S;
	const mergedEvents: EventsDef<S> = Object.create(null);
	const mergedDerive: DerivationsDef<S> = Object.create(null);
	const mergedEffects: EffectsDef<S> = Object.create(null);
	const mergedConstraints: ConstraintsDef<S> = Object.create(null);
	const mergedResolvers: ResolversDef<S> = Object.create(null);

	// Track which module defined each key for collision detection
	const schemaOwners = new Map<string, string>();

	for (const module of config.modules) {
		// Security: Validate module definitions for dangerous keys
		// Always run in all environments — this is a security boundary, not a dev convenience
		const validateKeys = (obj: object | undefined, section: string) => {
			if (!obj) return;
			for (const key of Object.keys(obj)) {
				if (BLOCKED_PROPS.has(key)) {
					throw new Error(
						`[Directive] Security: Module "${module.id}" has dangerous key "${key}" in ${section}. ` +
							`This could indicate a prototype pollution attempt.`,
					);
				}
			}
		};
		validateKeys(module.schema, "schema");
		validateKeys(module.events, "events");
		validateKeys(module.derive, "derive");
		validateKeys(module.effects, "effects");
		validateKeys(module.constraints, "constraints");
		validateKeys(module.resolvers, "resolvers");

		// Check for schema collisions
		if (process.env.NODE_ENV !== "production") {
			for (const key of Object.keys(module.schema)) {
				const existingOwner = schemaOwners.get(key);
				if (existingOwner) {
					throw new Error(
						`[Directive] Schema collision: Fact "${key}" is defined in both module "${existingOwner}" and "${module.id}". ` +
							`Use namespacing (e.g., "${module.id}::${key}") or merge into one module.`,
					);
				}
				schemaOwners.set(key, module.id);
			}
		}

		Object.assign(mergedSchema, module.schema);
		if (module.events) Object.assign(mergedEvents, module.events);
		if (module.derive) Object.assign(mergedDerive, module.derive);
		if (module.effects) Object.assign(mergedEffects, module.effects);
		if (module.constraints) Object.assign(mergedConstraints, module.constraints);
		if (module.resolvers) Object.assign(mergedResolvers, module.resolvers);
	}

	// Dev-mode: Warn if a fact and derivation share the same name
	if (process.env.NODE_ENV !== "production") {
		const derivationNames = new Set(Object.keys(mergedDerive));
		for (const key of Object.keys(mergedSchema)) {
			if (derivationNames.has(key)) {
				console.warn(
					`[Directive] "${key}" exists as both a fact and a derivation. ` +
					`This may cause unexpected dependency tracking behavior.`,
				);
			}
		}
	}

	// Create plugin manager
	const pluginManager: PluginManager<S> = createPluginManager();
	for (const plugin of config.plugins ?? []) {
		pluginManager.register(plugin);
	}

	// Create error boundary
	const errorBoundary: ErrorBoundaryManager = createErrorBoundaryManager({
		config: config.errorBoundary,
		onError: (error) => pluginManager.emitError(error),
		onRecovery: (error, strategy) => pluginManager.emitErrorRecovery(error, strategy),
	});

	// Create facts store and proxy
	// Note: We need to create a local invalidate function that will be set after derivationsManager is created
	let invalidateDerivation: (key: string) => void = () => {};
	let invalidateManyDerivations: (keys: string[]) => void = () => {};

	// Forward-declared so onChange/onBatch closures can check isRestoring.
	// Assigned after createTimeTravelManager() below.
	let timeTravelRef: TimeTravelManager<S> | null = null;

	const { store, facts } = createFacts<S>({
		schema: mergedSchema,
		onChange: (key, value, prev) => {
			pluginManager.emitFactSet(key, value, prev);
			// Invalidate derivations so they recompute on read
			invalidateDerivation(key);
			// During time-travel restore, skip change tracking and reconciliation.
			// The restored state is already reconciled; re-reconciling would create
			// spurious snapshots that break undo/redo.
			if (timeTravelRef?.isRestoring) return;
			state.changedKeys.add(key);
			scheduleReconcile();
		},
		onBatch: (changes) => {
			pluginManager.emitFactsBatch(changes);
			const keys: string[] = [];
			for (const change of changes) {
				keys.push(change.key);
			}
			// Invalidate all affected derivations at once — listeners fire only
			// after ALL keys are invalidated, so they see consistent state.
			invalidateManyDerivations(keys);
			// During time-travel restore, skip change tracking and reconciliation.
			if (timeTravelRef?.isRestoring) return;
			for (const change of changes) {
				state.changedKeys.add(change.key);
			}
			scheduleReconcile();
		},
	});

	// Create derivations manager
	const derivationsManager: DerivationsManager<S, DerivationsDef<S>> = createDerivationsManager({
		definitions: mergedDerive,
		facts,
		store,
		onCompute: (id, value, deps) => pluginManager.emitDerivationCompute(id, value, deps),
		onInvalidate: (id) => pluginManager.emitDerivationInvalidate(id),
		onError: (id, error) => {
			errorBoundary.handleError("derivation", id, error);
		},
	});

	// Now wire up derivation invalidation
	invalidateDerivation = (key: string) => derivationsManager.invalidate(key);
	invalidateManyDerivations = (keys: string[]) => derivationsManager.invalidateMany(keys);

	// Create effects manager
	const effectsManager: EffectsManager<S> = createEffectsManager({
		definitions: mergedEffects,
		facts,
		store,
		onRun: (id) => pluginManager.emitEffectRun(id),
		onError: (id, error) => {
			errorBoundary.handleError("effect", id, error);
			pluginManager.emitEffectError(id, error);
		},
	});

	// Create constraints manager
	const constraintsManager: ConstraintsManager<S> = createConstraintsManager({
		definitions: mergedConstraints,
		facts,
		onEvaluate: (id, active) => pluginManager.emitConstraintEvaluate(id, active),
		onError: (id, error) => {
			errorBoundary.handleError("constraint", id, error);
			pluginManager.emitConstraintError(id, error);
		},
	});

	// Create resolvers manager
	const resolversManager: ResolversManager<S> = createResolversManager({
		definitions: mergedResolvers,
		facts,
		store,
		onStart: (resolver, req) => pluginManager.emitResolverStart(resolver, req),
		onComplete: (resolver, req, duration) => {
			pluginManager.emitResolverComplete(resolver, req, duration);
			pluginManager.emitRequirementMet(req, resolver);
			// Mark the constraint as resolved for `after` ordering
			constraintsManager.markResolved(req.fromConstraint);
		},
		onError: (resolver, req, error) => {
			errorBoundary.handleError("resolver", resolver, error, req);
			pluginManager.emitResolverError(resolver, req, error);
		},
		onRetry: (resolver, req, attempt) => pluginManager.emitResolverRetry(resolver, req, attempt),
		onCancel: (resolver, req) => {
			pluginManager.emitResolverCancel(resolver, req);
			pluginManager.emitRequirementCanceled(req);
		},
		onResolutionComplete: () => {
			// After a resolver completes, schedule another reconcile
			notifySettlementChange();
			scheduleReconcile();
		},
	});

	// Time-travel listeners — notified when snapshot state changes
	const timeTravelListeners = new Set<() => void>();

	function notifyTimeTravelChange(): void {
		for (const listener of timeTravelListeners) {
			listener();
		}
	}

	// Create time-travel manager
	const timeTravelManager: TimeTravelManager<S> = config.debug?.timeTravel
		? createTimeTravelManager({
				config: config.debug,
				facts,
				store,
				onSnapshot: (snapshot) => {
					pluginManager.emitSnapshot(snapshot);
					notifyTimeTravelChange();
				},
				onTimeTravel: (from, to) => {
					pluginManager.emitTimeTravel(from, to);
					notifyTimeTravelChange();
				},
			})
		: createDisabledTimeTravel();
	timeTravelRef = timeTravelManager;

	// Settlement listeners — notified when isSettled may have changed
	const settlementListeners = new Set<() => void>();

	function notifySettlementChange(): void {
		for (const listener of settlementListeners) {
			listener();
		}
	}

	// Reconcile depth guard — prevents runaway reconcile → scheduleReconcile chains
	const MAX_RECONCILE_DEPTH = 50;
	let reconcileDepth = 0;

	// Engine state
	const state: EngineState<S> = {
		isRunning: false,
		isReconciling: false,
		reconcileScheduled: false,
		isInitializing: false,
		isInitialized: false,
		isReady: false,
		isDestroyed: false,
		changedKeys: new Set(),
		previousRequirements: new RequirementSet(),
		readyPromise: null,
		readyResolve: null,
	};

	/** Schedule a reconciliation on the next microtask */
	function scheduleReconcile(): void {
		// Suppress reconciliation during initialization phase
		if (!state.isRunning || state.reconcileScheduled || state.isInitializing) return;

		state.reconcileScheduled = true;
		notifySettlementChange();
		queueMicrotask(() => {
			state.reconcileScheduled = false;
			if (state.isRunning && !state.isInitializing) {
				// Await reconcile to prevent race conditions
				// Error is caught inside reconcile, so no need to handle here
				reconcile().catch((error) => {
					// Only log unexpected errors (reconcile handles its own errors)
					if (process.env.NODE_ENV !== "production") {
						console.error("[Directive] Unexpected error in reconcile:", error);
					}
				});
			}
		});
	}

	/** The main reconciliation loop */
	async function reconcile(): Promise<void> {
		if (state.isReconciling) return;

		reconcileDepth++;
		if (reconcileDepth > MAX_RECONCILE_DEPTH) {
			if (process.env.NODE_ENV !== "production") {
				console.warn(
					`[Directive] Reconcile loop exceeded ${MAX_RECONCILE_DEPTH} iterations. ` +
					`This usually means resolvers are creating circular requirement chains. ` +
					`Check that resolvers aren't mutating facts that re-trigger their own constraints.`,
				);
			}
			reconcileDepth = 0;
			return;
		}

		state.isReconciling = true;
		notifySettlementChange();

		try {
			// Take snapshot before reconciliation
			if (state.changedKeys.size > 0) {
				timeTravelManager.takeSnapshot(`facts-changed:${[...state.changedKeys].join(",")}`);
			}

			// Get snapshot for plugins
			const snapshot = facts.$snapshot() as FactsSnapshot<S>;
			pluginManager.emitReconcileStart(snapshot);

			// Note: Derivations are already invalidated immediately when facts change
			// (in the onChange/onBatch callbacks), so we don't need to do it here

			// Run effects for changed keys
			await effectsManager.runEffects(state.changedKeys);

			// Copy changed keys for constraint evaluation before clearing
			const keysForConstraints = new Set(state.changedKeys);

			// Clear changed keys
			state.changedKeys.clear();

			// Evaluate constraints (pass changed keys for incremental evaluation)
			const currentRequirements = await constraintsManager.evaluate(keysForConstraints);
			const currentSet = new RequirementSet();
			for (const req of currentRequirements) {
				currentSet.add(req);
				pluginManager.emitRequirementCreated(req);
			}

			// Diff with previous requirements
			const { added, removed } = currentSet.diff(state.previousRequirements);

			// Cancel resolvers for removed requirements
			for (const req of removed) {
				resolversManager.cancel(req.id);
			}

			// Start resolvers for new requirements
			for (const req of added) {
				resolversManager.resolve(req);
			}

			// Update previous requirements
			state.previousRequirements = currentSet;

			// Build reconcile result
			const inflightInfo = resolversManager.getInflightInfo();
			const result: ReconcileResult = {
				unmet: currentRequirements.filter((r) => !resolversManager.isResolving(r.id)),
				inflight: inflightInfo,
				completed: [], // Completed resolvers are tracked separately via onComplete callback
				canceled: removed.map((r) => ({
					id: r.id,
					resolverId: inflightInfo.find((i) => i.id === r.id)?.resolverId ?? "unknown",
				})),
			};

			pluginManager.emitReconcileEnd(result);

			// Mark system as ready after first successful reconcile
			if (!state.isReady) {
				state.isReady = true;
				if (state.readyResolve) {
					state.readyResolve();
					state.readyResolve = null;
				}
			}
		} finally {
			state.isReconciling = false;

			// Schedule next reconcile BEFORE notifying settlement change,
			// so listeners never see a brief isSettled=true flash when
			// more changes are pending.
			if (state.changedKeys.size > 0) {
				scheduleReconcile();
			} else if (!state.reconcileScheduled) {
				// System has settled — reset depth counter
				reconcileDepth = 0;
			}

			notifySettlementChange();
		}
	}

	// Create typed derive accessor using a Proxy
	const deriveAccessor = new Proxy({} as Record<string, unknown>, {
		get(_, prop: string | symbol) {
			if (typeof prop === "symbol") return undefined;
			// Prototype pollution protection
			if (BLOCKED_PROPS.has(prop)) return undefined;
			return derivationsManager.get(prop as keyof DerivationsDef<S>);
		},
		has(_, prop: string | symbol) {
			if (typeof prop === "symbol") return false;
			// Prototype pollution protection
			if (BLOCKED_PROPS.has(prop)) return false;
			return prop in mergedDerive;
		},
		ownKeys() {
			return Object.keys(mergedDerive);
		},
		getOwnPropertyDescriptor(_, prop: string | symbol) {
			if (typeof prop === "symbol") return undefined;
			// Prototype pollution protection
			if (BLOCKED_PROPS.has(prop)) return undefined;
			if (prop in mergedDerive) {
				return { configurable: true, enumerable: true };
			}
			return undefined;
		},
	});

	// Create typed events accessor using a Proxy
	// This provides system.events.eventName(payload) syntax
	const eventsAccessor = new Proxy({} as Record<string, (payload?: Record<string, unknown>) => void>, {
		get(_, prop: string | symbol) {
			if (typeof prop === "symbol") return undefined;
			// Prototype pollution protection
			if (BLOCKED_PROPS.has(prop)) return undefined;
			// Return a function that dispatches the event
			return (payload?: Record<string, unknown>) => {
				const handler = mergedEvents[prop];
				if (handler) {
					store.batch(() => {
						handler(facts, { type: prop, ...payload });
					});
				} else if (process.env.NODE_ENV !== "production") {
					console.warn(
						`[Directive] Unknown event type "${prop}". ` +
							`No handler is registered for this event. ` +
							`Available events: ${Object.keys(mergedEvents).join(", ") || "(none)"}`,
					);
				}
			};
		},
		has(_, prop: string | symbol) {
			if (typeof prop === "symbol") return false;
			// Prototype pollution protection
			if (BLOCKED_PROPS.has(prop)) return false;
			return prop in mergedEvents;
		},
		ownKeys() {
			return Object.keys(mergedEvents);
		},
		getOwnPropertyDescriptor(_, prop: string | symbol) {
			if (typeof prop === "symbol") return undefined;
			// Prototype pollution protection
			if (BLOCKED_PROPS.has(prop)) return undefined;
			if (prop in mergedEvents) {
				return { configurable: true, enumerable: true };
			}
			return undefined;
		},
	});

	// Create the system interface
	// biome-ignore lint/suspicious/noExplicitAny: Engine uses flat schema internally, public API uses ModuleSchema
	const system: System<any> = {
		facts,
		debug: timeTravelManager.isEnabled ? timeTravelManager : null,
		derive: deriveAccessor,
		events: eventsAccessor,
		constraints: {
			disable: (id: string) => constraintsManager.disable(id),
			enable: (id: string) => constraintsManager.enable(id),
		},
		effects: {
			disable: (id: string) => effectsManager.disable(id),
			enable: (id: string) => effectsManager.enable(id),
			isEnabled: (id: string) => effectsManager.isEnabled(id),
		},

		/** Start the engine – initializes modules, applies initial facts, and begins reconciliation. */
		start(): void {
			if (state.isRunning) return;
			state.isRunning = true;

			// Mark as initializing to suppress reconciliation during module init
			state.isInitializing = true;

			// Initialize modules (reconciliation is suppressed during this phase)
			for (const module of config.modules) {
				if (module.init) {
					store.batch(() => {
						// biome-ignore lint/suspicious/noExplicitAny: Engine internal type coercion
						module.init!(facts as any);
					});
				}

				// Call module hooks
				// biome-ignore lint/suspicious/noExplicitAny: Engine internal type coercion
				module.hooks?.onStart?.(system as any);
			}

			// Apply initialFacts/hydrate via callback (still in init phase)
			// This ensures initialFacts are applied AFTER module init but BEFORE reconcile
			if (config.onAfterModuleInit) {
				store.batch(() => {
					config.onAfterModuleInit!();
				});
			}

			// Mark initialization complete
			state.isInitializing = false;
			state.isInitialized = true;

			// Emit start event
			pluginManager.emitStart(system);

			// Initial reconcile (now that all modules are initialized)
			scheduleReconcile();
		},

		/** Stop the engine – cancels all resolvers, runs effect cleanups, and calls module onStop hooks. */
		stop(): void {
			if (!state.isRunning) return;
			state.isRunning = false;

			// Cancel all resolvers
			resolversManager.cancelAll();

			// Run all effect cleanups
			effectsManager.cleanupAll();

			// Call module hooks
			for (const module of config.modules) {
				module.hooks?.onStop?.(system);
			}

			// Emit stop event
			pluginManager.emitStop(system);
		},

		/** Permanently destroy the engine – stops it, clears all listeners, and emits the destroy event. */
		destroy(): void {
			this.stop();
			state.isDestroyed = true;
			settlementListeners.clear();
			timeTravelListeners.clear();
			pluginManager.emitDestroy(system);
		},

		/**
		 * Dispatch an event to the matching handler.
		 * Events are processed inside a batch, so multiple fact mutations in the
		 * handler trigger a single reconciliation cycle.
		 *
		 * @param event - The event object with a `type` field matching a registered handler.
		 */
		dispatch(event: SystemEvent): void {
			if (BLOCKED_PROPS.has(event.type)) return;
			const handler = mergedEvents[event.type];
			if (handler) {
				store.batch(() => {
					handler(facts, event);
				});
			} else if (process.env.NODE_ENV !== "production") {
				console.warn(
					`[Directive] Unknown event type "${event.type}". ` +
						`No handler is registered for this event. ` +
						`Available events: ${Object.keys(mergedEvents).join(", ") || "(none)"}`,
				);
			}
		},

		/**
		 * Read a derivation value by ID. Forces recomputation if the derivation is stale.
		 * Prefer `system.derive.myDerivation` for type-safe access.
		 *
		 * @param derivationId - The derivation key to read.
		 * @returns The current (possibly recomputed) derivation value.
		 */
		read<T = unknown>(derivationId: string): T {
			return derivationsManager.get(derivationId as keyof DerivationsDef<S>) as T;
		},

		/**
		 * Subscribe to changes on one or more facts or derivations.
		 * Keys are auto-detected – pass any mix of fact and derivation keys.
		 *
		 * @param ids - Array of fact or derivation keys to observe.
		 * @param listener - Callback invoked (with no arguments) when any observed key changes.
		 * @returns An unsubscribe function.
		 */
		subscribe(ids: string[], listener: () => void): () => void {
			const derivationIds: string[] = [];
			const factKeys: string[] = [];

			for (const id of ids) {
				if (id in mergedDerive) {
					derivationIds.push(id);
				} else if (id in mergedSchema) {
					factKeys.push(id);
				} else if (process.env.NODE_ENV !== "production") {
					console.warn(`[Directive] subscribe: unknown key "${id}"`);
				}
			}

			const unsubs: Array<() => void> = [];
			if (derivationIds.length > 0) {
				unsubs.push(
					derivationsManager.subscribe(
						derivationIds as Array<keyof DerivationsDef<S>>,
						listener,
					),
				);
			}
			if (factKeys.length > 0) {
				unsubs.push(store.subscribe(factKeys as Array<keyof InferSchema<S>>, listener));
			}

			return () => {
				for (const u of unsubs) u();
			};
		},

		/**
		 * Watch a single fact or derivation for value changes.
		 * Unlike `subscribe()`, the callback receives the new and previous values.
		 * Comparison uses `Object.is` by default; pass `equalityFn` for custom logic.
		 *
		 * @param id - The fact or derivation key to watch.
		 * @param callback - Called with `(newValue, previousValue)` when the value changes.
		 * @param options - Optional equality function for custom comparison.
		 * @returns An unsubscribe function.
		 */
		watch<T = unknown>(
			id: string,
			callback: (newValue: T, previousValue: T | undefined) => void,
			options?: { equalityFn?: (a: T, b: T | undefined) => boolean },
		): () => void {
			const isEqual = options?.equalityFn
				? (a: T, b: T | undefined) => options.equalityFn!(a, b)
				: (a: T, b: T | undefined) => Object.is(a, b);

			if (id in mergedDerive) {
				// Derivation path
				let previousValue: T | undefined = derivationsManager.get(
					id as keyof DerivationsDef<S>,
				) as T | undefined;

				return derivationsManager.subscribe(
					[id as keyof DerivationsDef<S>],
					() => {
						const newValue = derivationsManager.get(id as keyof DerivationsDef<S>) as T;
						if (!isEqual(newValue, previousValue)) {
							const oldValue = previousValue;
							previousValue = newValue;
							callback(newValue, oldValue);
						}
					},
				);
			}

			// Fact path
			if (process.env.NODE_ENV !== "production") {
				if (!(id in mergedSchema)) {
					console.warn(`[Directive] watch: unknown key "${id}"`);
				}
			}
			let prev = store.get(id as keyof InferSchema<S>) as T | undefined;
			return store.subscribe([id as keyof InferSchema<S>], () => {
				const next = store.get(id as keyof InferSchema<S>) as T;
				if (!isEqual(next, prev)) {
					const old = prev;
					prev = next;
					callback(next, old);
				}
			});
		},

		/**
		 * Returns a promise that resolves when the predicate becomes true.
		 * The predicate is checked immediately, then re-evaluated on every fact change.
		 *
		 * @param predicate - A function that receives all facts and returns a boolean.
		 * @param options - Optional timeout in ms. Rejects with an error if exceeded.
		 * @returns A promise that resolves when the predicate is satisfied.
		 * @throws Error if the timeout is exceeded.
		 */
		when(
			predicate: (facts: Record<string, unknown>) => boolean,
			options?: { timeout?: number },
		): Promise<void> {
			return new Promise<void>((resolve, reject) => {
				// Check immediately
				const factsObj = store.toObject();
				if (predicate(factsObj)) {
					resolve();
					return;
				}

				let unsub: (() => void) | undefined;
				let timer: ReturnType<typeof setTimeout> | undefined;

				const cleanup = () => {
					unsub?.();
					if (timer !== undefined) clearTimeout(timer);
				};

				// Subscribe to all fact changes
				unsub = store.subscribeAll(() => {
					const current = store.toObject();
					if (predicate(current)) {
						cleanup();
						resolve();
					}
				});

				// Timeout
				if (options?.timeout !== undefined && options.timeout > 0) {
					timer = setTimeout(() => {
						cleanup();
						reject(new Error(`[Directive] when: timed out after ${options.timeout}ms`));
					}, options.timeout);
				}
			});
		},

		/**
		 * Return a point-in-time snapshot of the system's runtime state.
		 *
		 * @returns An object containing unmet requirements, inflight resolver info,
		 * constraint states (active/inactive + priority), and resolver statuses.
		 */
		inspect(): SystemInspection {
			return {
				unmet: state.previousRequirements.all(),
				inflight: resolversManager.getInflightInfo(),
				constraints: constraintsManager.getAllStates().map((s) => ({
					id: s.id,
					active: s.lastResult ?? false,
					priority: s.priority,
				})),
				resolvers: Object.fromEntries(
					resolversManager.getInflight().map((id) => [id, resolversManager.getStatus(id)]),
				),
			};
		},

		/**
		 * Produce a human-readable explanation of why a specific requirement exists.
		 * Traces the requirement back to its originating constraint, priority,
		 * payload, and current resolver status.
		 *
		 * @param requirementId - The unique ID of the requirement to explain.
		 * @returns A multi-line tree-formatted string, or `null` if the requirement
		 * is not found in the current requirement set.
		 */
		explain(requirementId: string): string | null {
			// Find the requirement in current unmet requirements
			const requirements = state.previousRequirements.all();
			const req = requirements.find((r) => r.id === requirementId);

			if (!req) {
				return null;
			}

			const constraintState = constraintsManager.getState(req.fromConstraint);
			const resolverStatus = resolversManager.getStatus(requirementId);

			// Get relevant facts by looking at the constraint's last known state
			const relevantFacts: Record<string, unknown> = {};
			const factsSnapshot = store.toObject();

			// Include all facts for now (could be optimized with dependency tracking)
			for (const [key, value] of Object.entries(factsSnapshot)) {
				relevantFacts[key] = value;
			}

			const lines: string[] = [
				`Requirement "${req.requirement.type}" (id: ${req.id})`,
				`├─ Produced by constraint: ${req.fromConstraint}`,
				`├─ Constraint priority: ${constraintState?.priority ?? 0}`,
				`├─ Constraint active: ${constraintState?.lastResult ?? "unknown"}`,
				`├─ Resolver status: ${resolverStatus.state}`,
			];

			// Add requirement details
			const reqDetails = Object.entries(req.requirement)
				.filter(([k]) => k !== "type")
				.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
				.join(", ");
			if (reqDetails) {
				lines.push(`├─ Requirement payload: { ${reqDetails} }`);
			}

			// Add relevant facts (limit to prevent huge output)
			const factEntries = Object.entries(relevantFacts).slice(0, 10);
			if (factEntries.length > 0) {
				lines.push(`└─ Relevant facts:`);
				factEntries.forEach(([k, v], i) => {
					const prefix = i === factEntries.length - 1 ? "   └─" : "   ├─";
					const valueStr = typeof v === "object" ? JSON.stringify(v) : String(v);
					lines.push(`${prefix} ${k} = ${valueStr.slice(0, 50)}${valueStr.length > 50 ? "..." : ""}`);
				});
			}

			return lines.join("\n");
		},

		/**
		 * Wait until all inflight resolvers complete and no reconciliation is pending.
		 * Uses a polling loop (not recursion) with configurable timeout.
		 *
		 * @param maxWait - Maximum time to wait in milliseconds (default: 5000).
		 * @throws Error if the timeout is exceeded while work is still pending.
		 * The error message includes diagnostic details (inflight resolvers,
		 * unmet requirements, reconciliation state).
		 */
		async settle(maxWait = 5000): Promise<void> {
			const startTime = Date.now();

			// Use while loop instead of recursion to prevent stack overflow
			while (true) {
				// Wait for any pending microtasks
				await new Promise((resolve) => setTimeout(resolve, 0));

				// Check if we have inflight resolvers or unmet requirements with resolvers
				const inspection = this.inspect();
				const settled =
					inspection.inflight.length === 0 &&
					!state.isReconciling &&
					!state.reconcileScheduled;

				if (settled) {
					return;
				}

				// Check timeout
				if (Date.now() - startTime > maxWait) {
					const details: string[] = [];
					if (inspection.inflight.length > 0) {
						details.push(
							`${inspection.inflight.length} resolvers inflight: ${inspection.inflight.map((r) => r.resolverId).join(", ")}`,
						);
					}
					if (state.isReconciling) {
						details.push("reconciliation in progress");
					}
					if (state.reconcileScheduled) {
						details.push("reconcile scheduled");
					}
					// Include pending requirements for better debugging
					const unmet = state.previousRequirements.all();
					if (unmet.length > 0) {
						details.push(
							`${unmet.length} unmet requirements: ${unmet.map((r) => r.requirement.type).join(", ")}`,
						);
					}
					throw new Error(
						`[Directive] settle() timed out after ${maxWait}ms. ${details.join("; ")}`,
					);
				}

				// Wait a bit and check again
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		},

		getSnapshot() {
			return {
				facts: store.toObject(),
				version: 1,
			};
		},

		getDistributableSnapshot<T = Record<string, unknown>>(
			options: {
				includeDerivations?: string[];
				excludeDerivations?: string[];
				includeFacts?: string[];
				ttlSeconds?: number;
				metadata?: Record<string, unknown>;
				includeVersion?: boolean;
			} = {},
		): {
			data: T;
			createdAt: number;
			expiresAt?: number;
			version?: string;
			metadata?: Record<string, unknown>;
		} {
			const {
				includeDerivations,
				excludeDerivations,
				includeFacts,
				ttlSeconds,
				metadata,
				includeVersion,
			} = options;

			const data: Record<string, unknown> = {};

			// Collect derivation keys to include
			const allDerivationKeys = Object.keys(mergedDerive);
			let derivationKeys: string[];

			if (includeDerivations) {
				// Only include specified derivations
				derivationKeys = includeDerivations.filter((k) => allDerivationKeys.includes(k));

				// Warn about unknown derivation keys in dev mode
				if (process.env.NODE_ENV !== "production") {
					const unknown = includeDerivations.filter((k) => !allDerivationKeys.includes(k));
					if (unknown.length > 0) {
						console.warn(
							`[Directive] getDistributableSnapshot: Unknown derivation keys ignored: ${unknown.join(", ")}. ` +
								`Available: ${allDerivationKeys.join(", ") || "(none)"}`,
						);
					}
				}
			} else {
				// Include all derivations by default
				derivationKeys = allDerivationKeys;
			}

			// Apply exclusions
			if (excludeDerivations) {
				const excludeSet = new Set(excludeDerivations);
				derivationKeys = derivationKeys.filter((k) => !excludeSet.has(k));
			}

			// Read derivation values
			for (const key of derivationKeys) {
				try {
					data[key] = derivationsManager.get(key as keyof DerivationsDef<S>);
				} catch (error) {
					// Skip derivations that error during computation
					if (process.env.NODE_ENV !== "production") {
						console.warn(`[Directive] getDistributableSnapshot: Skipping derivation "${key}" due to error:`, error);
					}
				}
			}

			// Include specified facts
			if (includeFacts && includeFacts.length > 0) {
				const factsSnapshot = store.toObject();
				const allFactKeys = Object.keys(factsSnapshot);

				// Warn about unknown fact keys in dev mode
				if (process.env.NODE_ENV !== "production") {
					const unknown = includeFacts.filter((k) => !(k in factsSnapshot));
					if (unknown.length > 0) {
						console.warn(
							`[Directive] getDistributableSnapshot: Unknown fact keys ignored: ${unknown.join(", ")}. ` +
								`Available: ${allFactKeys.join(", ") || "(none)"}`,
						);
					}
				}

				for (const key of includeFacts) {
					if (key in factsSnapshot) {
						data[key] = factsSnapshot[key];
					}
				}
			}

			// Build the snapshot
			const createdAt = Date.now();
			const snapshot: {
				data: T;
				createdAt: number;
				expiresAt?: number;
				version?: string;
				metadata?: Record<string, unknown>;
			} = {
				data: data as T,
				createdAt,
			};

			// Add TTL
			if (ttlSeconds !== undefined && ttlSeconds > 0) {
				snapshot.expiresAt = createdAt + ttlSeconds * 1000;
			}

			// Add version hash
			if (includeVersion) {
				// Simple version hash based on data content
				snapshot.version = hashObject(data);
			}

			// Add metadata
			if (metadata) {
				snapshot.metadata = metadata;
			}

			return snapshot;
		},

		watchDistributableSnapshot<T = Record<string, unknown>>(
			options: {
				includeDerivations?: string[];
				excludeDerivations?: string[];
				includeFacts?: string[];
				ttlSeconds?: number;
				metadata?: Record<string, unknown>;
				includeVersion?: boolean;
			},
			callback: (snapshot: {
				data: T;
				createdAt: number;
				expiresAt?: number;
				version?: string;
				metadata?: Record<string, unknown>;
			}) => void,
		): () => void {
			const { includeDerivations, excludeDerivations } = options;

			// Determine which derivations to watch
			const allDerivationKeys = Object.keys(mergedDerive);
			let derivationKeys: string[];

			if (includeDerivations) {
				derivationKeys = includeDerivations.filter((k) => allDerivationKeys.includes(k));
			} else {
				derivationKeys = allDerivationKeys;
			}

			if (excludeDerivations) {
				const excludeSet = new Set(excludeDerivations);
				derivationKeys = derivationKeys.filter((k) => !excludeSet.has(k));
			}

			if (derivationKeys.length === 0) {
				// Nothing to watch, return no-op unsubscribe
				if (process.env.NODE_ENV !== "production") {
					console.warn(
						"[Directive] watchDistributableSnapshot: No derivations to watch. " +
							"Callback will never be called.",
					);
				}
				return () => {};
			}

			// Get initial snapshot to seed version and ensure derivations are computed
			// (derivations must be computed before subscribing so listeners are called on invalidation)
			const initialSnapshot = this.getDistributableSnapshot<T>({
				...options,
				includeVersion: true,
			});
			let previousVersion = initialSnapshot.version;

			// Subscribe to all watched derivations
			return derivationsManager.subscribe(
				derivationKeys as Array<keyof DerivationsDef<S>>,
				() => {
					// Generate a new snapshot
					const snapshot = this.getDistributableSnapshot<T>({
						...options,
						// Always include version for change detection
						includeVersion: true,
					});

					// Only call callback if snapshot actually changed
					if (snapshot.version !== previousVersion) {
						previousVersion = snapshot.version;
						callback(snapshot);
					}
				},
			);
		},

		restore(snapshot) {
			if (!snapshot || typeof snapshot !== "object") {
				throw new Error("[Directive] restore() requires a valid snapshot object");
			}
			if (!snapshot.facts || typeof snapshot.facts !== "object") {
				throw new Error("[Directive] restore() snapshot must have a facts object");
			}

			// Security: Validate snapshot for prototype pollution
			if (!isPrototypeSafe(snapshot)) {
				throw new Error(
					"[Directive] restore() rejected: snapshot contains potentially dangerous keys " +
						"(__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
				);
			}

			store.batch(() => {
				for (const [key, value] of Object.entries(snapshot.facts)) {
					// Skip dangerous keys (defense in depth)
					if (BLOCKED_PROPS.has(key)) continue;
					store.set(key as keyof InferSchema<S>, value as InferSchema<S>[keyof InferSchema<S>]);
				}
			});
		},

		/**
		 * Subscribe to settlement state changes.
		 * Called whenever `isSettled` may have changed (resolver start/complete,
		 * reconcile start/end). Use with `useSyncExternalStore` for React bindings.
		 *
		 * @param listener - Callback invoked when settlement state may have changed.
		 * @returns An unsubscribe function.
		 */
		onSettledChange(listener: () => void): () => void {
			settlementListeners.add(listener);
			return () => {
				settlementListeners.delete(listener);
			};
		},

		/**
		 * Subscribe to time-travel state changes.
		 * Called when a snapshot is taken or time-travel navigation occurs.
		 *
		 * @param listener - Callback invoked on time-travel state change.
		 * @returns An unsubscribe function.
		 */
		onTimeTravelChange(listener: () => void): () => void {
			timeTravelListeners.add(listener);
			return () => {
				timeTravelListeners.delete(listener);
			};
		},

		/**
		 * Group multiple fact mutations into a single reconciliation cycle.
		 * Nested batches are safe – only the outermost batch triggers reconciliation.
		 *
		 * @param fn - Synchronous function containing fact mutations.
		 */
		batch(fn: () => void): void {
			store.batch(fn);
		},

		get isSettled(): boolean {
			const inspection = this.inspect();
			return (
				inspection.inflight.length === 0 &&
				!state.isReconciling &&
				!state.reconcileScheduled
			);
		},

		get isRunning(): boolean {
			return state.isRunning;
		},

		get isInitialized(): boolean {
			return state.isInitialized;
		},

		get isReady(): boolean {
			return state.isReady;
		},

		whenReady(): Promise<void> {
			// If already ready, resolve immediately
			if (state.isReady) {
				return Promise.resolve();
			}

			// If not running, the promise would never resolve
			if (!state.isRunning) {
				return Promise.reject(
					new Error(
						"[Directive] whenReady() called before start(). " +
						"Call system.start() first, then await system.whenReady().",
					),
				);
			}

			// Create promise if not exists
			if (!state.readyPromise) {
				state.readyPromise = new Promise<void>((resolve) => {
					state.readyResolve = resolve;
				});
			}

			return state.readyPromise;
		},
	};

	/**
	 * Register a new module into a running (or stopped) engine.
	 * Merges the module's schema, events, derive, effects, constraints, and resolvers
	 * into the existing engine state, runs init, and triggers reconciliation.
	 *
	 * @param module - The module definition to register.
	 * @throws Error if called during reconciliation or on a destroyed system.
	 * @throws Error if a schema key collision is detected.
	 */
	function registerModule(module: {
		id: string;
		schema: Record<string, unknown>;
		requirements?: Record<string, unknown>;
		init?: (facts: unknown) => void;
		derive?: Record<string, (facts: unknown, derive: unknown) => unknown>;
		events?: Record<string, (facts: unknown, event: unknown) => void>;
		effects?: Record<string, unknown>;
		constraints?: Record<string, unknown>;
		resolvers?: Record<string, unknown>;
		hooks?: { onInit?: (s: unknown) => void; onStart?: (s: unknown) => void; onStop?: (s: unknown) => void; onError?: (e: unknown, ctx: unknown) => void };
	}): void {
		// Guard: cannot register during reconciliation (would corrupt iteration state)
		if (state.isReconciling) {
			throw new Error(
				`[Directive] Cannot register module "${module.id}" during reconciliation. ` +
				`Wait for the current reconciliation cycle to complete.`,
			);
		}

		// Guard: cannot register on a destroyed system
		if (state.isDestroyed) {
			throw new Error(
				`[Directive] Cannot register module "${module.id}" on a destroyed system.`,
			);
		}

		// Security: validate keys
		const validateKeys = (obj: object | undefined, section: string) => {
			if (!obj) return;
			for (const key of Object.keys(obj)) {
				if (BLOCKED_PROPS.has(key)) {
					throw new Error(
						`[Directive] Security: Module "${module.id}" has dangerous key "${key}" in ${section}.`,
					);
				}
			}
		};
		validateKeys(module.schema, "schema");
		validateKeys(module.events, "events");
		validateKeys(module.derive, "derive");
		validateKeys(module.effects, "effects");
		validateKeys(module.constraints, "constraints");
		validateKeys(module.resolvers, "resolvers");

		// Schema collision detection (unconditional — production collision would cause data corruption)
		for (const key of Object.keys(module.schema)) {
			if (key in mergedSchema) {
				throw new Error(
					`[Directive] Schema collision: Fact "${key}" already exists. Cannot register module "${module.id}".`,
				);
			}
		}
		// Fact/derivation name collision check (dev-only warning)
		if (process.env.NODE_ENV !== "production" && module.derive) {
			const existingFactKeys = new Set(Object.keys(mergedSchema));
			for (const key of Object.keys(module.derive)) {
				if (existingFactKeys.has(key)) {
					console.warn(
						`[Directive] "${key}" exists as both a fact and a derivation after registering module "${module.id}".`,
					);
				}
			}
		}

		// Merge into existing engine state
		Object.assign(mergedSchema, module.schema);
		if (module.events) Object.assign(mergedEvents, module.events);
		if (module.derive) {
			Object.assign(mergedDerive, module.derive);
			// Register new derivations with the derivations manager
			derivationsManager.registerDefinitions(module.derive as DerivationsDef<S>);
		}
		if (module.effects) {
			Object.assign(mergedEffects, module.effects);
			// biome-ignore lint/suspicious/noExplicitAny: Dynamic module registration
			effectsManager.registerDefinitions(module.effects as any);
		}
		if (module.constraints) {
			Object.assign(mergedConstraints, module.constraints);
			// biome-ignore lint/suspicious/noExplicitAny: Dynamic module registration
			constraintsManager.registerDefinitions(module.constraints as any);
		}
		if (module.resolvers) {
			Object.assign(mergedResolvers, module.resolvers);
			// biome-ignore lint/suspicious/noExplicitAny: Dynamic module registration
			resolversManager.registerDefinitions(module.resolvers as any);
		}

		// Register new schema keys with the facts store
		// biome-ignore lint/suspicious/noExplicitAny: Internal dynamic method
		(store as any).registerKeys(module.schema as Record<string, unknown>);

		// Track the new module in config.modules for hooks
		config.modules.push(module as typeof config.modules[number]);

		// Run init within a batch
		if (module.init) {
			store.batch(() => {
				// biome-ignore lint/suspicious/noExplicitAny: Dynamic module init
				module.init!(facts as any);
			});
		}

		// Call lifecycle hooks
		module.hooks?.onInit?.(system);
		if (state.isRunning) {
			module.hooks?.onStart?.(system);
			// Trigger reconciliation to evaluate new constraints
			scheduleReconcile();
		}
	}

	// Attach registerModule to system
	(system as unknown as Record<string, unknown>).registerModule = registerModule;

	// Initialize plugins
	pluginManager.emitInit(system);

	// Call module init hooks
	for (const module of config.modules) {
		module.hooks?.onInit?.(system);
	}

	return system;
}
