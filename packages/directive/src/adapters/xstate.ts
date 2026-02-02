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
  Schema,
  ResolverDef,
  ResolverContext,
  Plugin,
  System,
  Facts,
} from "../core/types.js";
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

/** Options for xstateResolver */
export interface XStateResolverOptions<
  S extends Schema,
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
  handles: (req: Requirement) => req is R;

  /** Custom deduplication key */
  key?: (req: R) => string;

  /** Input to pass to the machine */
  input?: (req: R, ctx: ResolverContext<S>) => unknown;

  /** Called when the machine reaches a final state */
  onDone?: (output: TOutput | undefined, ctx: ResolverContext<S>, req: R) => void;

  /** Called when the machine encounters an error */
  onError?: (error: unknown, ctx: ResolverContext<S>, req: R) => void;

  /** Called on each state transition */
  onTransition?: (snapshot: SnapshotLike<TContext, TOutput>, ctx: ResolverContext<S>, req: R) => void;

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
 *   handles: forType<PaymentReq>('START_PAYMENT'),
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
  S extends Schema,
  TContext = unknown,
  TEvent extends { type: string } = { type: string },
  TOutput = unknown,
  R extends Requirement = Requirement
>(
  options: XStateResolverOptions<S, TContext, TEvent, TOutput, R>
): ResolverDef<S, R> {
  const {
    machine,
    createActor,
    handles,
    key,
    input,
    onDone,
    onError,
    onTransition,
    timeout,
  } = options;

  return {
    handles,
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
  plugins?: Array<Plugin<Schema>>;

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
  system: System<Schema>;

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

  // Create schema for actor state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schema: any = {
    actorStatus: t.string<"active" | "done" | "error" | "stopped">(),
    actorValue: t.object<Record<string, unknown>>(),
    actorContext: t.object<Record<string, unknown>>(),
    actorOutput: t.object<Record<string, unknown>>(),
    actorError: t.string(),
  };

  // Create the Directive module
  const actorModule = createModule("xstate-actor-bridge", {
    schema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    init: (facts: any) => {
      const snapshot = actor.getSnapshot() as SnapshotLike<TContext, TOutput>;
      facts.actorStatus = snapshot.status;
      facts.actorValue = snapshot.value as string | object;
      facts.actorContext = snapshot.context;
      facts.actorOutput = snapshot.output;
      facts.actorError = snapshot.error ? String(snapshot.error) : null;
    },
  });

  // Create the Directive system
  // Use type assertion to work around Schema generic variance issues
  const system = createSystem({
    modules: [actorModule as unknown as Parameters<typeof createSystem>[0]["modules"][0]],
    plugins: plugins as unknown as Array<Plugin<Schema>>,
    debug: debug ? { timeTravel: true } : undefined,
  });

  // Subscribe to actor state changes
  let subscription: { unsubscribe(): void } | null = null;

  const startSync = () => {
    subscription = actor.subscribe({
      next: (snapshot) => {
        const snap = snapshot as SnapshotLike<TContext, TOutput>;
        system.batch(() => {
          system.facts.actorStatus = snap.status;
          system.facts.actorValue = snap.value as string | object;
          system.facts.actorContext = snap.context;
          system.facts.actorOutput = snap.output;
          system.facts.actorError = snap.error ? String(snap.error) : null;
        });
      },
    });
  };

  const stopSync = () => {
    subscription?.unsubscribe();
    subscription = null;
  };

  const bridge: ActorBridge<TContext, TEvent, TOutput> = {
    system: system as System<Schema>,
    actor: actor as ActorLike<SnapshotLike<TContext, TOutput>, TEvent>,
    facts: system.facts as unknown as ActorBridge<TContext, TEvent, TOutput>["facts"],
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
    handles: (req: Requirement) => boolean;
    key?: (req: Requirement) => string;
    resolve: (req: Requirement, ctx: {
      facts: Facts<Schema> & F & CoordinatedActorsState;
      actors: Record<string, ActorLike>;
      signal: AbortSignal;
    }) => void | Promise<void>;
  }>;

  /** Plugins */
  plugins?: Array<Plugin<Schema>>;

  /** Enable debugging */
  debug?: boolean;
}

/** Multi-actor coordinator */
export interface ActorCoordinator<F extends Record<string, unknown>> {
  system: System<Schema>;
  actors: Record<string, ActorLike>;
  facts: F & CoordinatedActorsState;
  send(actorId: string, event: { type: string }): void;
  start(): void;
  stop(): void;
  destroy(): void;
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
 *       handles: (req) => req.type === 'DISPATCH_ELEVATOR',
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schema: any = {
    actors: t.object<Record<string, ActorStateInfo>>(),
    ...factsSchema,
  };

  // Convert constraints
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const directiveConstraints: Record<string, any> = {};

  for (const [id, constraint] of Object.entries(constraints)) {
    const requireFn = constraint.require;
    directiveConstraints[id] = {
      priority: constraint.priority,
      when: (facts: unknown) => constraint.when(facts as F & CoordinatedActorsState),
      require: typeof requireFn === "function"
        ? (facts: unknown) => requireFn(facts as F & CoordinatedActorsState)
        : requireFn,
    };
  }

  // Convert resolvers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const directiveResolvers: Record<string, any> = {};

  for (const [id, resolver] of Object.entries(resolvers)) {
    directiveResolvers[id] = {
      handles: resolver.handles as (req: Requirement) => boolean,
      key: resolver.key,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolve: async (req: Requirement, ctx: any) => {
        await resolver.resolve(req, {
          facts: ctx.facts as unknown as Facts<Schema> & F & CoordinatedActorsState,
          actors,
          signal: ctx.signal,
        });
      },
    };
  }

  // Create module
  const coordinatorModule = createModule("xstate-coordinator", {
    schema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    init: (facts: any) => {
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
        } as ActorStateInfo;
      }
      facts.actors = actorStates;
      init?.(facts as unknown as F & CoordinatedActorsState);
    },
    constraints: directiveConstraints as unknown as Parameters<typeof createModule>[1]["constraints"],
    resolvers: directiveResolvers as unknown as Parameters<typeof createModule>[1]["resolvers"],
  });

  // Create system
  // Use type assertion to work around Schema generic variance issues
  const system = createSystem({
    modules: [coordinatorModule as unknown as Parameters<typeof createSystem>[0]["modules"][0]],
    plugins: plugins as unknown as Array<Plugin<Schema>>,
    debug: debug ? { timeTravel: true } : undefined,
  });

  // Subscribe to all actors
  const subscriptions: Array<{ unsubscribe(): void }> = [];

  const startSync = () => {
    for (const [id, actor] of Object.entries(actors)) {
      const sub = actor.subscribe({
        next: (snapshot) => {
          const snap = snapshot as SnapshotLike;
          const currentActors = { ...((system.facts as unknown as CoordinatedActorsState).actors) };
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
          (system.facts as unknown as CoordinatedActorsState).actors = currentActors;
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
    system: system as System<Schema>,
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
