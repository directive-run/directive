/**
 * Zustand Adapter - Middleware that enforces Directive constraints on Zustand stores
 *
 * Philosophy: "Use Directive WITH Zustand to add constraint-driven orchestration"
 * - Zustand handles simple state management
 * - Directive adds constraint validation, requirement coordination
 *
 * @example
 * ```typescript
 * import { create } from 'zustand'
 * import { directiveMiddleware } from 'directive/zustand'
 *
 * const useStore = create(
 *   directiveMiddleware(
 *     (set) => ({
 *       count: 0,
 *       increment: () => set(s => ({ count: s.count + 1 }))
 *     }),
 *     {
 *       constraints: {
 *         maxCount: {
 *           when: (state) => state.count > 100,
 *           require: { type: 'RESET_COUNT' }
 *         }
 *       },
 *       resolvers: {
 *         reset: {
 *           handles: (req) => req.type === 'RESET_COUNT',
 *           resolve: (req, { setState }) => setState({ count: 0 })
 *         }
 *       }
 *     }
 *   )
 * )
 * ```
 */

import type {
  Requirement,
  Schema,
  Plugin,
  System,
} from "../core/types.js";
import { createModule } from "../core/module.js";
import { createSystem } from "../core/system.js";
import { t } from "../core/facts.js";

// ============================================================================
// Types
// ============================================================================

/** Zustand StateCreator type (simplified for compatibility) */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type StateCreator<T, _Mps = [], _Ms = []> = (
  set: (partial: Partial<T> | ((state: T) => Partial<T>), replace?: boolean) => void,
  get: () => T,
  api: StoreApi<T>
) => T;

/** Zustand StoreApi type (simplified) */
interface StoreApi<T> {
  getState: () => T;
  setState: (partial: Partial<T> | ((state: T) => Partial<T>), replace?: boolean) => void;
  subscribe: (listener: (state: T, prevState: T) => void) => () => void;
  destroy?: () => void;
}

/** Constraint definition for Zustand adapter */
export interface ZustandConstraint<T> {
  /** Condition that activates this constraint */
  when: (state: T) => boolean | Promise<boolean>;
  /** Requirement to produce when condition is met */
  require: Requirement | ((state: T) => Requirement);
  /** Priority for ordering (higher runs first) */
  priority?: number;
}

/** Resolver definition for Zustand adapter */
export interface ZustandResolver<T, R extends Requirement = Requirement> {
  /** Predicate to match requirements */
  handles: (req: Requirement) => req is R;
  /** Custom key for deduplication */
  key?: (req: R) => string;
  /** Resolution function */
  resolve: (req: R, ctx: ZustandResolverContext<T>) => void | Promise<void>;
}

/** Context passed to Zustand resolvers */
export interface ZustandResolverContext<T> {
  /** Get current state */
  getState: () => T;
  /** Set state (merged) */
  setState: (partial: Partial<T> | ((state: T) => Partial<T>)) => void;
  /** Replace entire state */
  replaceState: (state: T) => void;
  /** Abort signal for cancellation */
  signal: AbortSignal;
}

/** Options for Directive middleware */
export interface DirectiveMiddlewareOptions<T> {
  /** Constraints that produce requirements based on state */
  constraints?: Record<string, ZustandConstraint<T>>;
  /** Resolvers that fulfill requirements */
  resolvers?: Record<string, ZustandResolver<T, Requirement>>;
  /** Callback when a requirement is created */
  onRequirementCreated?: (req: Requirement) => void;
  /** Callback when a requirement is resolved */
  onRequirementResolved?: (req: Requirement) => void;
  /** Whether to start the Directive system automatically (default: true) */
  autoStart?: boolean;
  /** Plugins to add to the Directive system */
  plugins?: Array<Plugin<Schema>>;
  /** Enable time-travel debugging */
  debug?: boolean;
}

/** Extended store API with Directive system access */
export interface DirectiveStoreApi<T> extends StoreApi<T> {
  /** Access to the underlying Directive system */
  directive: System<Schema>;
  /** Manually trigger constraint evaluation */
  evaluate: () => Promise<void>;
}

// ============================================================================
// Middleware Implementation
// ============================================================================

/**
 * Zustand middleware that enforces Directive constraints.
 *
 * Wraps setState to trigger constraint evaluation after each state change.
 * Bi-directional sync: Zustand changes → Directive facts, Directive resolutions → Zustand state.
 */
export function directiveMiddleware<T extends object>(
  initializer: StateCreator<T>,
  options: DirectiveMiddlewareOptions<T> = {}
): StateCreator<T & { __directive?: System<Schema> }, [], []> {
  const {
    constraints = {},
    resolvers = {},
    onRequirementCreated,
    onRequirementResolved,
    autoStart = true,
    plugins = [],
    debug = false,
  } = options;

  return (set, get, api) => {
    // Create a schema that mirrors the Zustand state shape
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stateSchema: any = { __zustandState: t.object<Record<string, unknown>>() };

    // Convert Zustand constraints to Directive format
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const directiveConstraints: Record<string, any> = {};
    for (const [id, constraint] of Object.entries(constraints)) {
      directiveConstraints[id] = {
        priority: constraint.priority ?? 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when: (facts: any) => {
          const state = facts.__zustandState as T;
          return constraint.when(state);
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        require: (facts: any) => {
          const state = facts.__zustandState as T;
          return typeof constraint.require === "function"
            ? constraint.require(state)
            : constraint.require;
        },
      };
    }

    // Convert Zustand resolvers to Directive format
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const directiveResolvers: Record<string, any> = {};
    for (const [id, resolver] of Object.entries(resolvers)) {
      directiveResolvers[id] = {
        handles: resolver.handles,
        key: resolver.key,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resolve: async (req: Requirement, ctx: any) => {
          const zustandCtx: ZustandResolverContext<T> = {
            getState: get,
            setState: (partial) => {
              const newState =
                typeof partial === "function" ? partial(get()) : partial;
              // Update Zustand state
              set(newState as Partial<T>);
              // Sync to Directive facts
              ctx.facts.__zustandState = get() as T;
            },
            replaceState: (state) => {
              set(state as T, true);
              ctx.facts.__zustandState = state;
            },
            signal: ctx.signal,
          };
          await resolver.resolve(req, zustandCtx);
        },
      };
    }

    // Create the Directive module
    const zustandModule = createModule("zustand-bridge", {
      schema: stateSchema,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      init: (facts: any) => {
        // Will be set when Zustand initializes
        facts.__zustandState = {} as T;
      },
      constraints: directiveConstraints as unknown as Parameters<typeof createModule>[1]["constraints"],
      resolvers: directiveResolvers as unknown as Parameters<typeof createModule>[1]["resolvers"],
    });

    // Create callback plugins for events
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callbackPlugin: Plugin<any> = {
      name: "zustand-callbacks",
      onRequirementCreated: onRequirementCreated
        ? (req) => onRequirementCreated(req.requirement)
        : undefined,
      onRequirementMet: onRequirementResolved
        ? (req) => onRequirementResolved(req.requirement)
        : undefined,
    };

    // Create the Directive system
    // Use type assertion to work around Schema generic variance issues
    const system = createSystem({
      modules: [zustandModule as unknown as Parameters<typeof createSystem>[0]["modules"][0]],
      plugins: [...plugins, callbackPlugin] as unknown as Array<Plugin<Schema>>,
      debug: debug ? { timeTravel: true } : undefined,
    });

    // Wrap setState to sync to Directive and trigger evaluation
    const originalSetState = api.setState;
    api.setState = (partial, replace) => {
      originalSetState(partial, replace);
      // Sync Zustand state to Directive facts
      system.facts.__zustandState = get() as T;
    };

    // Add Directive API to the store
    (api as DirectiveStoreApi<T>).directive = system as System<Schema>;
    (api as DirectiveStoreApi<T>).evaluate = async () => {
      await system.settle();
    };

    // Add destroy handler
    const originalDestroy = api.destroy;
    api.destroy = () => {
      system.destroy();
      originalDestroy?.();
    };

    // Initialize the underlying store
    const initialState = initializer(set, get, api);

    // Initialize Directive facts with initial state
    system.facts.__zustandState = initialState;

    // Start the system if autoStart is enabled
    if (autoStart) {
      system.start();
    }

    return initialState;
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a typed constraint helper.
 *
 * @example
 * ```typescript
 * const maxCountConstraint = createConstraint<MyState>({
 *   when: (state) => state.count > 100,
 *   require: { type: 'RESET_COUNT' }
 * });
 * ```
 */
export function createConstraint<T>(
  constraint: ZustandConstraint<T>
): ZustandConstraint<T> {
  return constraint;
}

/**
 * Create a typed resolver helper.
 *
 * @example
 * ```typescript
 * interface ResetCountReq extends Requirement { type: 'RESET_COUNT' }
 *
 * const resetResolver = createResolver<MyState, ResetCountReq>({
 *   handles: (req): req is ResetCountReq => req.type === 'RESET_COUNT',
 *   resolve: (req, { setState }) => setState({ count: 0 })
 * });
 * ```
 */
export function createResolver<T, R extends Requirement = Requirement>(
  resolver: ZustandResolver<T, R>
): ZustandResolver<T, R> {
  return resolver;
}

/**
 * Utility to extract the Directive system from a Zustand store.
 *
 * @example
 * ```typescript
 * const store = create(directiveMiddleware(...));
 * const system = getDirectiveSystem(store);
 * console.log(system.inspect());
 * ```
 */
export function getDirectiveSystem<T>(
  store: StoreApi<T>
): System<Schema> | undefined {
  return (store as DirectiveStoreApi<T>).directive;
}

/**
 * Subscribe to Directive requirements from a Zustand store.
 *
 * @example
 * ```typescript
 * subscribeToRequirements(store, (req, event) => {
 *   if (event === 'created') {
 *     console.log('New requirement:', req.type);
 *   }
 * });
 * ```
 */
export function subscribeToRequirements<T>(
  store: StoreApi<T>,
  callback: (req: Requirement, event: "created" | "resolved" | "canceled") => void
): () => void {
  const system = getDirectiveSystem(store);
  if (!system) {
    console.warn("[Directive] Store was not created with directiveMiddleware");
    return () => {};
  }

  // Subscribe to fact changes and inspect for requirement changes
  let lastUnmetIds = new Set<string>();

  const unsubscribe = system.facts.$store.subscribeAll(() => {
    const inspection = system.inspect();
    const currentUnmetIds = new Set(inspection.unmet.map((r) => r.id));

    // New requirements
    for (const req of inspection.unmet) {
      if (!lastUnmetIds.has(req.id)) {
        callback(req.requirement, "created");
      }
    }

    // Resolved/canceled requirements
    for (const id of lastUnmetIds) {
      if (!currentUnmetIds.has(id)) {
        // Find the original requirement (it's been resolved or canceled)
        const wasInflight = inspection.inflight.some((i) => i.id === id);
        callback({ type: "UNKNOWN", id }, wasInflight ? "resolved" : "canceled");
      }
    }

    lastUnmetIds = currentUnmetIds;
  });

  return unsubscribe;
}

// ============================================================================
// Sync Utilities
// ============================================================================

/**
 * Create a two-way binding between a Zustand store and a Directive system.
 *
 * This is useful when you have an existing Zustand store and want to add
 * Directive coordination without using the middleware.
 *
 * @example
 * ```typescript
 * const zustandStore = create((set) => ({ count: 0 }));
 * const directiveSystem = createSystem({ modules: [myModule] });
 *
 * const { sync, unsync } = bindZustandToDirective(zustandStore, directiveSystem, {
 *   // Map Zustand state to Directive facts
 *   toFacts: (state) => ({ count: state.count }),
 *   // Map Directive facts back to Zustand state
 *   fromFacts: (facts) => ({ count: facts.count }),
 * });
 *
 * // Start syncing
 * sync();
 *
 * // Stop syncing
 * unsync();
 * ```
 */
export function bindZustandToDirective<T extends object, S extends Schema>(
  store: StoreApi<T>,
  system: System<S>,
  mapping: {
    toFacts: (state: T) => Partial<Record<keyof S, unknown>>;
    fromFacts: (facts: Record<string, unknown>) => Partial<T>;
    /** Keys to watch in Directive (defaults to all keys from toFacts) */
    watchFacts?: Array<keyof S>;
  }
): { sync: () => void; unsync: () => void } {
  let unsubscribeZustand: (() => void) | null = null;
  let unsubscribeDirective: (() => void) | null = null;
  let isSyncing = false;

  const sync = () => {
    if (isSyncing) return;
    isSyncing = true;

    // Zustand → Directive
    unsubscribeZustand = store.subscribe((state) => {
      const facts = mapping.toFacts(state);
      system.batch(() => {
        for (const [key, value] of Object.entries(facts)) {
          (system.facts as Record<string, unknown>)[key] = value;
        }
      });
    });

    // Directive → Zustand
    const factsToWatch = mapping.watchFacts ?? Object.keys(mapping.toFacts(store.getState()));
    unsubscribeDirective = system.facts.$store.subscribe(
      factsToWatch as string[],
      () => {
        const facts = system.facts.$store.toObject();
        const stateUpdate = mapping.fromFacts(facts);
        store.setState(stateUpdate);
      }
    );

    // Initial sync: Zustand → Directive
    const initialFacts = mapping.toFacts(store.getState());
    system.batch(() => {
      for (const [key, value] of Object.entries(initialFacts)) {
        (system.facts as Record<string, unknown>)[key] = value;
      }
    });
  };

  const unsync = () => {
    isSyncing = false;
    unsubscribeZustand?.();
    unsubscribeDirective?.();
    unsubscribeZustand = null;
    unsubscribeDirective = null;
  };

  return { sync, unsync };
}
