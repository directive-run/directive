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
import { isPrototypeSafe } from "../utils/utils.js";

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
	changedKeys: Set<string>;
	previousRequirements: RequirementSet;
	readyPromise: Promise<void> | null;
	readyResolve: (() => void) | null;
}

/**
 * Create the Directive engine.
 */
// biome-ignore lint/suspicious/noExplicitAny: Engine uses flat schema internally, public API uses ModuleSchema
export function createEngine<S extends Schema>(
	config: SystemConfig<any>,
): System<any> {
	// Merge all module definitions with collision detection
	const mergedSchema = {} as S;
	const mergedEvents: EventsDef<S> = {};
	const mergedDerive: DerivationsDef<S> = {};
	const mergedEffects: EffectsDef<S> = {};
	const mergedConstraints: ConstraintsDef<S> = {};
	const mergedResolvers: ResolversDef<S> = {};

	// Track which module defined each key for collision detection
	const schemaOwners = new Map<string, string>();

	for (const module of config.modules) {
		// Security: Validate module definitions for dangerous keys
		if (process.env.NODE_ENV !== "production") {
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
		}

		// Check for schema collisions
		if (process.env.NODE_ENV !== "production") {
			for (const key of Object.keys(module.schema)) {
				const existingOwner = schemaOwners.get(key);
				if (existingOwner) {
					throw new Error(
						`[Directive] Schema collision: Fact "${key}" is defined in both module "${existingOwner}" and "${module.id}". ` +
							`Use namespacing (e.g., "${module.id}_${key}") or merge into one module.`,
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

	const { store, facts } = createFacts<S>({
		schema: mergedSchema,
		onChange: (key, value, prev) => {
			pluginManager.emitFactSet(key, value, prev);
			state.changedKeys.add(key);
			// Immediately invalidate derivations when facts change
			invalidateDerivation(key);
			scheduleReconcile();
		},
		onBatch: (changes) => {
			pluginManager.emitFactsBatch(changes);
			for (const change of changes) {
				state.changedKeys.add(change.key);
				// Immediately invalidate derivations when facts change
				invalidateDerivation(change.key);
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
			scheduleReconcile();
		},
	});

	// Create time-travel manager
	const timeTravelManager: TimeTravelManager<S> = config.debug?.timeTravel
		? createTimeTravelManager({
				config: config.debug,
				facts,
				store,
				onSnapshot: (snapshot) => pluginManager.emitSnapshot(snapshot),
				onTimeTravel: (from, to) => pluginManager.emitTimeTravel(from, to),
			})
		: createDisabledTimeTravel();

	// Engine state
	const state: EngineState<S> = {
		isRunning: false,
		isReconciling: false,
		reconcileScheduled: false,
		isInitializing: false,
		isInitialized: false,
		isReady: false,
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
		state.isReconciling = true;

		try {
			// Take snapshot before reconciliation
			if (state.changedKeys.size > 0) {
				timeTravelManager.takeSnapshot("facts-changed");
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
		}

		// If more changes came in during reconciliation, run again
		if (state.changedKeys.size > 0) {
			scheduleReconcile();
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

		stop(): void {
			if (!state.isRunning) return;
			state.isRunning = false;

			// Cancel all resolvers
			resolversManager.cancelAll();

			// Call module hooks
			for (const module of config.modules) {
				module.hooks?.onStop?.(system);
			}

			// Emit stop event
			pluginManager.emitStop(system);
		},

		destroy(): void {
			this.stop();
			pluginManager.emitDestroy(system);
		},

		dispatch(event: SystemEvent): void {
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

		read<T = unknown>(derivationId: string): T {
			return derivationsManager.get(derivationId as keyof DerivationsDef<S>) as T;
		},

		subscribe(derivationIds: string[], listener: () => void): () => void {
			return derivationsManager.subscribe(
				derivationIds as Array<keyof DerivationsDef<S>>,
				listener,
			);
		},

		watch<T = unknown>(
			derivationId: string,
			callback: (newValue: T, previousValue: T | undefined) => void,
		): () => void {
			let previousValue: T | undefined = derivationsManager.get(
				derivationId as keyof DerivationsDef<S>,
			) as T | undefined;

			return derivationsManager.subscribe(
				[derivationId as keyof DerivationsDef<S>],
				() => {
					const newValue = derivationsManager.get(derivationId as keyof DerivationsDef<S>) as T;
					// Only call callback if value actually changed
					if (newValue !== previousValue) {
						const oldValue = previousValue;
						previousValue = newValue;
						callback(newValue, oldValue);
					}
				},
			);
		},

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

	// Initialize plugins
	pluginManager.emitInit(system);

	// Call module init hooks
	for (const module of config.modules) {
		module.hooks?.onInit?.(system);
	}

	return system;
}
