/**
 * XState Adapter - Bridge that wraps XState machines as Directive resolvers
 *
 * Philosophy: "Use Directive WITH XState"
 * - XState handles individual state machine behavior (explicit transitions)
 * - Directive coordinates multiple machines with facts-based constraints
 *
 * @example
 * ```typescript
 * import { createActor } from 'xstate'
 * import { xstateResolver, createActorBridge } from 'directive/xstate'
 *
 * const module = createModule('checkout', {
 *   resolvers: {
 *     payment: xstateResolver({
 *       machine: paymentMachine,
 *       onDone: (output, ctx) => {
 *         ctx.facts.paymentComplete = true;
 *         ctx.facts.orderId = output.orderId;
 *       },
 *       onError: (error, ctx) => {
 *         ctx.facts.paymentError = error.message;
 *       }
 *     })
 *   }
 * })
 * ```
 */

import type {
	Requirement,
	ModuleSchema,
	Plugin,
	System,
} from "../core/types.js";
import {
	setBridgeFact,
	getBridgeFact,
} from "../core/types/adapter-utils.js";
import { createModule } from "../core/module.js";
import { createSystem } from "../core/system.js";
import { t } from "../core/facts.js";

// ============================================================================
// Types (XState compatible, without direct dependency)
// ============================================================================

/** Simplified XState machine interface */
export interface MachineLike<
	TContext = unknown,
	TEvent extends { type: string } = { type: string },
	TOutput = unknown
> {
	id: string;
	config?: { id?: string };
	/** @internal Used for type inference */
	readonly __context?: TContext;
	/** @internal Used for type inference */
	readonly __event?: TEvent;
	/** @internal Used for type inference */
	readonly __output?: TOutput;
}

/** Simplified XState actor interface */
export interface ActorLike<TSnapshot = unknown, TEvent extends { type: string } = { type: string }> {
	id: string;
	getSnapshot(): TSnapshot;
	subscribe(observer: {
		next?: (snapshot: TSnapshot) => void;
		error?: (error: unknown) => void;
		complete?: () => void;
	}): { unsubscribe(): void };
	send(event: TEvent): void;
	start(): ActorLike<TSnapshot, TEvent>;
	stop(): ActorLike<TSnapshot, TEvent>;
}

/** XState snapshot interface */
export interface SnapshotLike<TContext = unknown, TOutput = unknown> {
	value: string | object;
	context: TContext;
	status: "active" | "done" | "error" | "stopped";
	output?: TOutput;
	error?: unknown;
}

/** Function to create an actor (like XState's createActor) */
export type CreateActorFn<
	TMachine extends MachineLike,
	TSnapshot = unknown,
	TEvent extends { type: string } = { type: string }
> = (machine: TMachine, options?: ActorOptions) => ActorLike<TSnapshot, TEvent>;

interface ActorOptions {
	id?: string;
	input?: unknown;
	snapshot?: unknown;
}

// ============================================================================
// Resolver Types
// ============================================================================

/** Resolver context for XState adapter */
export interface XStateResolverContext {
	// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
	readonly facts: any;
	readonly signal: AbortSignal;
}

/** Options for xstateResolver */
export interface XStateResolverOptions<
	TContext = unknown,
	TEvent extends { type: string } = { type: string },
	TOutput = unknown,
	R extends Requirement = Requirement
> {
	/** The XState machine to use */
	machine: MachineLike<TContext, TEvent, TOutput>;

	/** Function to create an actor (e.g., XState's createActor) */
	createActor: CreateActorFn<MachineLike<TContext, TEvent, TOutput>, SnapshotLike<TContext, TOutput>, TEvent>;

	/** Type guard to match requirements */
	requirement: (req: Requirement) => req is R;

	/** Custom deduplication key */
	key?: (req: R) => string;

	/** Input to pass to the machine */
	input?: (req: R, ctx: XStateResolverContext) => unknown;

	/** Called when the machine reaches a final state */
	onDone?: (output: TOutput | undefined, ctx: XStateResolverContext, req: R) => void;

	/** Called when the machine encounters an error */
	onError?: (error: unknown, ctx: XStateResolverContext, req: R) => void;

	/** Called on each state transition */
	onTransition?: (snapshot: SnapshotLike<TContext, TOutput>, ctx: XStateResolverContext, req: R) => void;

	/** Timeout in ms */
	timeout?: number;
}

/** Actor state stored in Directive facts */
export interface ActorStateInfo {
	id: string;
	machineId: string;
	status: "active" | "done" | "error" | "stopped";
	value: string | object;
	startedAt: number;
	completedAt?: number;
	error?: string;
}

// ============================================================================
// Resolver Implementation
// ============================================================================

/** XState resolver definition */
export interface XStateResolverDef<R extends Requirement = Requirement> {
	requirement: (req: Requirement) => req is R;
	key?: (req: R) => string;
	timeout?: number;
	resolve: (req: R, ctx: XStateResolverContext) => Promise<void>;
}

/**
 * Create a Directive resolver that wraps an XState machine.
 *
 * The resolver starts an actor when the requirement is received, and completes
 * when the actor reaches a final state (done or error).
 *
 * @example
 * ```typescript
 * import { createActor } from 'xstate'
 *
 * const resolver = xstateResolver({
 *   machine: paymentMachine,
 *   createActor,
 *   requirement: forType<PaymentReq>('START_PAYMENT'),
 *   input: (req) => ({ amount: req.amount, currency: req.currency }),
 *   onDone: (output, ctx) => {
 *     ctx.facts.paymentComplete = true;
 *     ctx.facts.transactionId = output?.transactionId;
 *   },
 *   onError: (error, ctx) => {
 *     ctx.facts.paymentError = String(error);
 *   },
 * })
 * ```
 */
export function xstateResolver<
	TContext = unknown,
	TEvent extends { type: string } = { type: string },
	TOutput = unknown,
	R extends Requirement = Requirement
>(
	options: XStateResolverOptions<TContext, TEvent, TOutput, R>
): XStateResolverDef<R> {
	const {
		machine,
		createActor,
		requirement,
		key,
		input,
		onDone,
		onError,
		onTransition,
		timeout,
	} = options;

	return {
		requirement,
		key: key ?? ((req) => `xstate:${machine.id ?? machine.config?.id ?? "machine"}:${req.type}`),
		timeout,
		resolve: (req, ctx) => {
			return new Promise<void>((resolve, reject) => {
				// Create the actor
				const actor = createActor(machine, {
					input: input?.(req, ctx),
				});

				// Handle abort signal
				const abortHandler = () => {
					actor.stop();
					reject(new Error("Actor stopped due to cancellation"));
				};
				ctx.signal.addEventListener("abort", abortHandler);

				// Subscribe to state changes
				const subscription = actor.subscribe({
					next: (snapshot) => {
						const snap = snapshot as SnapshotLike<TContext, TOutput>;

						// Call transition callback
						onTransition?.(snap, ctx, req);

						// Check if done
						if (snap.status === "done") {
							ctx.signal.removeEventListener("abort", abortHandler);
							subscription.unsubscribe();
							onDone?.(snap.output, ctx, req);
							resolve();
						} else if (snap.status === "error") {
							ctx.signal.removeEventListener("abort", abortHandler);
							subscription.unsubscribe();
							onError?.(snap.error, ctx, req);
							reject(snap.error);
						} else if (snap.status === "stopped") {
							ctx.signal.removeEventListener("abort", abortHandler);
							subscription.unsubscribe();
							resolve();
						}
					},
					error: (error) => {
						ctx.signal.removeEventListener("abort", abortHandler);
						subscription.unsubscribe();
						onError?.(error, ctx, req);
						reject(error);
					},
					complete: () => {
						ctx.signal.removeEventListener("abort", abortHandler);
						subscription.unsubscribe();
						resolve();
					},
				});

				// Start the actor
				actor.start();
			});
		},
	};
}

// ============================================================================
// Actor Bridge
// ============================================================================

/** Options for creating an actor bridge */
export interface ActorBridgeOptions<
	TContext = unknown,
	TEvent extends { type: string } = { type: string },
	TOutput = unknown
> {
	/** The XState machine */
	machine: MachineLike<TContext, TEvent, TOutput>;

	/** Function to create an actor */
	createActor: CreateActorFn<MachineLike<TContext, TEvent, TOutput>, SnapshotLike<TContext, TOutput>, TEvent>;

	/** Initial input for the machine */
	input?: unknown;

	/** Plugins for the Directive system */
	plugins?: Plugin[];

	/** Enable time-travel debugging */
	debug?: boolean;

	/** Auto-start the actor (default: true) */
	autoStart?: boolean;
}

/** Actor bridge instance */
export interface ActorBridge<
	TContext = unknown,
	TEvent extends { type: string } = { type: string },
	TOutput = unknown
> {
	/** The underlying Directive system */
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>;

	/** The XState actor */
	actor: ActorLike<SnapshotLike<TContext, TOutput>, TEvent>;

	/** Current actor state exposed as Directive facts */
	facts: {
		actorStatus: "active" | "done" | "error" | "stopped";
		actorValue: string | object;
		actorContext: TContext;
		actorOutput: TOutput | undefined;
		actorError: string | null;
	};

	/** Send an event to the actor */
	send(event: TEvent): void;

	/** Start the actor and system */
	start(): void;

	/** Stop the actor and system */
	stop(): void;

	/** Destroy everything */
	destroy(): void;
}

// ============================================================================
// Bridge Schema
// ============================================================================

const ACTOR_STATUS_KEY = "actorStatus" as const;
const ACTOR_VALUE_KEY = "actorValue" as const;
const ACTOR_CONTEXT_KEY = "actorContext" as const;
const ACTOR_OUTPUT_KEY = "actorOutput" as const;
const ACTOR_ERROR_KEY = "actorError" as const;
const ACTORS_KEY = "actors" as const;

const actorBridgeSchema = {
	facts: {
		[ACTOR_STATUS_KEY]: t.string<"active" | "done" | "error" | "stopped">(),
		[ACTOR_VALUE_KEY]: t.any<string | object>(),
		[ACTOR_CONTEXT_KEY]: t.any<Record<string, unknown>>(),
		[ACTOR_OUTPUT_KEY]: t.any<Record<string, unknown> | undefined>(),
		[ACTOR_ERROR_KEY]: t.any<string | null>(),
	},
	derivations: {},
	events: {},
	requirements: {},
} satisfies ModuleSchema;

/**
 * Create a bridge between an XState actor and a Directive system.
 *
 * This bi-directionally syncs the actor's state to Directive facts, allowing
 * you to create Directive constraints that react to machine state changes.
 *
 * @example
 * ```typescript
 * import { createActor } from 'xstate'
 *
 * const bridge = createActorBridge({
 *   machine: trafficLightMachine,
 *   createActor,
 * })
 *
 * // React to machine state in Directive
 * bridge.system.watch('actorValue', (value) => {
 *   console.log('Machine transitioned to:', value)
 * })
 *
 * // Send events to the machine
 * bridge.send({ type: 'TIMER' })
 * ```
 */
export function createActorBridge<
	TContext = unknown,
	TEvent extends { type: string } = { type: string },
	TOutput = unknown
>(
	options: ActorBridgeOptions<TContext, TEvent, TOutput>
): ActorBridge<TContext, TEvent, TOutput> {
	const {
		machine,
		createActor,
		input,
		plugins = [],
		debug = false,
		autoStart = true,
	} = options;

	// Create the actor
	const actor = createActor(machine, { input });

	// Create the Directive module
	const actorModule = createModule("xstate-actor-bridge", {
		schema: actorBridgeSchema,
		init: (facts) => {
			const snapshot = actor.getSnapshot() as SnapshotLike<TContext, TOutput>;
			setBridgeFact(facts, ACTOR_STATUS_KEY, snapshot.status);
			setBridgeFact(facts, ACTOR_VALUE_KEY, snapshot.value as string | object);
			setBridgeFact(facts, ACTOR_CONTEXT_KEY, snapshot.context);
			setBridgeFact(facts, ACTOR_OUTPUT_KEY, snapshot.output);
			setBridgeFact(facts, ACTOR_ERROR_KEY, snapshot.error ? String(snapshot.error) : null);
		},
	});

	// Create the Directive system
	const system = createSystem({
		module: actorModule,
		plugins,
		debug: debug ? { timeTravel: true } : undefined,
	});

	// Subscribe to actor state changes
	let subscription: { unsubscribe(): void } | null = null;

	const startSync = () => {
		subscription = actor.subscribe({
			next: (snapshot) => {
				const snap = snapshot as SnapshotLike<TContext, TOutput>;
				system.batch(() => {
					setBridgeFact(system.facts, ACTOR_STATUS_KEY, snap.status);
					setBridgeFact(system.facts, ACTOR_VALUE_KEY, snap.value as string | object);
					setBridgeFact(system.facts, ACTOR_CONTEXT_KEY, snap.context);
					setBridgeFact(system.facts, ACTOR_OUTPUT_KEY, snap.output);
					setBridgeFact(system.facts, ACTOR_ERROR_KEY, snap.error ? String(snap.error) : null);
				});
			},
		});
	};

	const stopSync = () => {
		subscription?.unsubscribe();
		subscription = null;
	};

	const bridge: ActorBridge<TContext, TEvent, TOutput> = {
		system: system as unknown as System<any>,
		actor: actor as ActorLike<SnapshotLike<TContext, TOutput>, TEvent>,
		facts: system.facts as ActorBridge<TContext, TEvent, TOutput>["facts"],
		send: (event) => actor.send(event),
		start: () => {
			actor.start();
			startSync();
			system.start();
		},
		stop: () => {
			system.stop();
			stopSync();
			actor.stop();
		},
		destroy: () => {
			bridge.stop();
			system.destroy();
		},
	};

	if (autoStart) {
		bridge.start();
	}

	return bridge;
}

// ============================================================================
// Multi-Actor Coordination
// ============================================================================

/** Actor registration for coordination */
export interface ActorRegistration<
	TContext = unknown,
	TEvent extends { type: string } = { type: string },
	TOutput = unknown
> {
	id: string;
	machine: MachineLike<TContext, TEvent, TOutput>;
	input?: unknown;
}

/** Coordinated actors state */
export interface CoordinatedActorsState {
	actors: Record<string, ActorStateInfo>;
}

/** Options for multi-actor coordination */
export interface CoordinationOptions<F extends Record<string, unknown>> {
	/** Actors to coordinate */
	actors: Array<ActorRegistration<unknown, { type: string }, unknown>>;

	/** Function to create actors */
	createActor: CreateActorFn<MachineLike, SnapshotLike, { type: string }>;

	/** Additional facts schema */
	factsSchema?: Record<string, { _type: unknown; _validators: [] }>;

	/** Initialize additional facts */
	init?: (facts: F & CoordinatedActorsState) => void;

	/** Constraints for coordination */
	constraints?: Record<string, {
		when: (facts: F & CoordinatedActorsState) => boolean | Promise<boolean>;
		require: Requirement | ((facts: F & CoordinatedActorsState) => Requirement);
		priority?: number;
	}>;

	/** Resolvers for coordination */
	resolvers?: Record<string, {
		requirement: (req: Requirement) => boolean;
		key?: (req: Requirement) => string;
		resolve: (req: Requirement, ctx: {
			facts: F & CoordinatedActorsState;
			actors: Record<string, ActorLike>;
			signal: AbortSignal;
		}) => void | Promise<void>;
	}>;

	/** Plugins */
	plugins?: Plugin[];

	/** Enable debugging */
	debug?: boolean;
}

/** Multi-actor coordinator */
export interface ActorCoordinator<F extends Record<string, unknown>> {
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>;
	actors: Record<string, ActorLike>;
	facts: F & CoordinatedActorsState;
	send(actorId: string, event: { type: string }): void;
	start(): void;
	stop(): void;
	destroy(): void;
}

// ============================================================================
// Coordinator Schema
// ============================================================================

const coordinatorBaseSchema = {
	facts: {
		[ACTORS_KEY]: t.object<Record<string, ActorStateInfo>>(),
	},
	derivations: {},
	events: {},
	requirements: {},
} satisfies ModuleSchema;

// ============================================================================
// Constraint/Resolver Converters
// ============================================================================

// biome-ignore lint/suspicious/noExplicitAny: Constraint types are complex
function convertCoordinatorConstraints<F extends Record<string, unknown>>(
	constraints: Record<string, {
		when: (facts: F & CoordinatedActorsState) => boolean | Promise<boolean>;
		require: Requirement | ((facts: F & CoordinatedActorsState) => Requirement);
		priority?: number;
	}>,
): Record<string, any> {
	// biome-ignore lint/suspicious/noExplicitAny: Result type is complex
	const result: Record<string, any> = {};

	for (const [id, constraint] of Object.entries(constraints)) {
		result[id] = {
			priority: constraint.priority ?? 0,
			// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
			when: (facts: any) => {
				const actors = getBridgeFact<Record<string, ActorStateInfo>>(facts, ACTORS_KEY);
				return constraint.when({ ...facts, actors } as F & CoordinatedActorsState);
			},
			// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
			require: (facts: any) => {
				const actors = getBridgeFact<Record<string, ActorStateInfo>>(facts, ACTORS_KEY);
				const typedFacts = { ...facts, actors } as F & CoordinatedActorsState;
				return typeof constraint.require === "function"
					? constraint.require(typedFacts)
					: constraint.require;
			},
		};
	}

	return result;
}

/**
 * Create a coordinator for multiple XState actors.
 *
 * This is useful when you need Directive to orchestrate multiple state machines,
 * for example coordinating multiple elevators or traffic lights at an intersection.
 *
 * @example
 * ```typescript
 * const coordinator = createActorCoordinator({
 *   actors: [
 *     { id: 'elevator-1', machine: elevatorMachine, input: { floor: 1 } },
 *     { id: 'elevator-2', machine: elevatorMachine, input: { floor: 5 } },
 *   ],
 *   createActor,
 *   constraints: {
 *     dispatchNearest: {
 *       when: (facts) => facts.pendingFloorRequests.length > 0,
 *       require: (facts) => ({
 *         type: 'DISPATCH_ELEVATOR',
 *         floor: facts.pendingFloorRequests[0],
 *       }),
 *     },
 *   },
 *   resolvers: {
 *     dispatch: {
 *       requirement: (req) => req.type === 'DISPATCH_ELEVATOR',
 *       resolve: (req, { actors, facts }) => {
 *         const nearest = findNearestElevator(facts.actors, req.floor);
 *         actors[nearest].send({ type: 'GO_TO_FLOOR', floor: req.floor });
 *       },
 *     },
 *   },
 * });
 * ```
 */
export function createActorCoordinator<F extends Record<string, unknown> = Record<string, never>>(
	options: CoordinationOptions<F>
): ActorCoordinator<F> {
	const {
		actors: actorRegistrations,
		createActor,
		factsSchema = {},
		init,
		constraints = {},
		resolvers = {},
		plugins = [],
		debug = false,
	} = options;

	// Create all actors
	const actors: Record<string, ActorLike> = {};
	for (const reg of actorRegistrations) {
		actors[reg.id] = createActor(reg.machine, { id: reg.id, input: reg.input });
	}

	// Build schema
	const combinedSchema = {
		facts: {
			...coordinatorBaseSchema.facts,
			...factsSchema,
		},
		derivations: {},
		events: {},
		requirements: {},
	} satisfies ModuleSchema;

	// Convert constraints
	const directiveConstraints = convertCoordinatorConstraints<F>(constraints);

	// Convert resolvers
	// biome-ignore lint/suspicious/noExplicitAny: Resolver types are complex
	const directiveResolvers: Record<string, any> = {};
	for (const [id, resolver] of Object.entries(resolvers)) {
		directiveResolvers[id] = {
			requirement: resolver.requirement,
			key: resolver.key,
			// biome-ignore lint/suspicious/noExplicitAny: Context type varies
			resolve: async (req: Requirement, ctx: any) => {
				const actorStates = getBridgeFact<Record<string, ActorStateInfo>>(ctx.facts, ACTORS_KEY);
				await resolver.resolve(req, {
					facts: { ...ctx.facts, actors: actorStates } as F & CoordinatedActorsState,
					actors,
					signal: ctx.signal,
				});
			},
		};
	}

	// Create module
	// biome-ignore lint/suspicious/noExplicitAny: Bridge module uses dynamic constraints/resolvers
	const coordinatorModule = createModule("xstate-coordinator", {
		schema: combinedSchema,
		init: (facts) => {
			// Initialize actor states
			const actorStates: Record<string, ActorStateInfo> = {};
			for (const [id, actor] of Object.entries(actors)) {
				const snapshot = actor.getSnapshot() as SnapshotLike;
				actorStates[id] = {
					id,
					machineId: actorRegistrations.find((r) => r.id === id)?.machine.id ?? id,
					status: snapshot.status,
					value: snapshot.value,
					startedAt: Date.now(),
				};
			}
			setBridgeFact(facts, ACTORS_KEY, actorStates);
			init?.(facts as unknown as F & CoordinatedActorsState);
		},
		constraints: directiveConstraints,
		resolvers: directiveResolvers as any,
	});

	// Create system
	const system = createSystem({
		module: coordinatorModule,
		plugins,
		debug: debug ? { timeTravel: true } : undefined,
	});

	// Subscribe to all actors
	const subscriptions: Array<{ unsubscribe(): void }> = [];

	const startSync = () => {
		for (const [id, actor] of Object.entries(actors)) {
			const sub = actor.subscribe({
				next: (snapshot) => {
					const snap = snapshot as SnapshotLike;
					const currentActors = { ...getBridgeFact<Record<string, ActorStateInfo>>(system.facts, ACTORS_KEY) };
					const existing = currentActors[id];
					currentActors[id] = {
						id: existing?.id ?? id,
						machineId: existing?.machineId ?? id,
						startedAt: existing?.startedAt ?? Date.now(),
						status: snap.status,
						value: snap.value,
						completedAt: snap.status === "done" || snap.status === "error" ? Date.now() : undefined,
						error: snap.error ? String(snap.error) : undefined,
					};
					setBridgeFact(system.facts, ACTORS_KEY, currentActors);
				},
			});
			subscriptions.push(sub);
		}
	};

	const stopSync = () => {
		for (const sub of subscriptions) {
			sub.unsubscribe();
		}
		subscriptions.length = 0;
	};

	const coordinator: ActorCoordinator<F> = {
		system: system as unknown as System<any>,
		actors,
		facts: system.facts as unknown as F & CoordinatedActorsState,
		send: (actorId, event) => {
			const actor = actors[actorId];
			if (!actor) {
				throw new Error(`[Directive] Actor "${actorId}" not found`);
			}
			actor.send(event);
		},
		start: () => {
			// Start all actors
			for (const actor of Object.values(actors)) {
				actor.start();
			}
			startSync();
			system.start();
		},
		stop: () => {
			system.stop();
			stopSync();
			for (const actor of Object.values(actors)) {
				actor.stop();
			}
		},
		destroy: () => {
			coordinator.stop();
			system.destroy();
		},
	};

	return coordinator;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if an actor is in a specific state value.
 */
export function isInState(
	actorState: ActorStateInfo | undefined,
	value: string | string[]
): boolean {
	if (!actorState) return false;
	const values = Array.isArray(value) ? value : [value];
	const currentValue =
		typeof actorState.value === "string"
			? actorState.value
			: JSON.stringify(actorState.value);
	return values.some((v) => currentValue.includes(v));
}

/**
 * Check if an actor is done (final state).
 */
export function isDone(actorState: ActorStateInfo | undefined): boolean {
	return actorState?.status === "done";
}

/**
 * Check if an actor has an error.
 */
export function hasError(actorState: ActorStateInfo | undefined): boolean {
	return actorState?.status === "error";
}

/**
 * Check if an actor is active (not done or error).
 */
export function isActive(actorState: ActorStateInfo | undefined): boolean {
	return actorState?.status === "active";
}
