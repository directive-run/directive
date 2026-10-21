/**
 * createModule and createSystem with the 1.35 observable behaviour, built on
 * the new reactive graph.
 *
 * - Facts are graph signals (facts.ts); derivations are graph computeds. A
 *   derivation reading a fact or another derivation is linked by the graph,
 *   and a read pulls exactly what is stale.
 * - 1.35 announces a change before anything recomputes: each derivation that
 *   a write makes stale is reported (`onDerivationInvalidate`) and its
 *   subscribers are notified, then reads recompute lazily. The walk that finds
 *   them follows the graph's own subscriber links.
 * - Effects run in a reconcile pass scheduled on a microtask after a change.
 *
 * Every piece of state belongs to one system: its graph, tracker, plugin
 * list and warning caches. Two systems in one process never share any.
 */

import isDevelopment from "#is-development";
import { Flags, type ReactiveNode } from "../graph.js";
import { type Kernel, type KernelOptions, createKernel } from "../kernel.js";
import {
  BLOCKED_PROPS,
  DERIVATION_DEP_PREFIX,
  type Tracker,
  createFactsProxy,
  createFactsStore,
  describeDep,
  withTracking,
} from "./facts.js";
import type {
  FactChange,
  Facts,
  FactsStore,
  ModuleDef,
  ModuleDefinition,
  ModuleSchema,
  Schema,
  System,
  SystemEvent,
  SystemOptions,
} from "./types.js";

/** Which subsystem produced an error (same union as 1.35). */
export type ErrorSource =
  | "constraint"
  | "resolver"
  | "effect"
  | "derivation"
  | "system";

export class DirectiveError extends Error {
  constructor(
    message: string,
    public readonly source: ErrorSource,
    public readonly sourceId: string,
    public readonly context?: unknown,
    public readonly recoverable = true,
  ) {
    super(message);
    this.name = "DirectiveError";
  }
}

export function createModule<const M extends ModuleSchema>(
  id: string,
  definition: ModuleDef<M>,
): ModuleDefinition<M> {
  return { ...definition, id } as unknown as ModuleDefinition<M>;
}

interface Derivation {
  id: string;
  node: ReactiveNode;
  /** 1.35's stale flag: set by an invalidation, cleared by a compute. */
  stale: boolean;
  /** Has computed at least once (1.35 creates its state on first read). */
  live: boolean;
}

/**
 * What a part (an opt-in module: effects, plugins, observe, inspect,
 * validation) is handed. Build-private to core-next.
 */
export interface SystemContext {
  readonly kernel: Kernel;
  readonly module: ModuleDefinition<ModuleSchema>;
  readonly system: Record<string, unknown>;
  readonly facts: Facts<Schema>;
  readonly store: FactsStore<any>;
  readonly derived: Record<string, unknown>;
  readonly tracker: Tracker;
  /** Report an error from `source` (the default strategy: skip). */
  reportError(source: ErrorSource, sourceId: string, error: unknown): void;
}

/** An opt-in part: wires itself in through the kernel's feature registry. */
export type SystemPart = (ctx: SystemContext) => void;

/** The effects feature as the reconcile pass drives it. */
export interface EffectsFeature {
  runEffectsFast(changedKeys: Set<string>): Promise<void> | undefined;
  cleanupAll(): void;
}

declare module "../kernel.js" {
  interface KernelFeatures {
    /** Added by `withEffects` (effects.ts). */
    effects: EffectsFeature;
    /** Added by `withValidation` (validate.ts); development only. */
    validate: (key: string, value: unknown) => void;
  }
}

/**
 * A system on its own kernel (a new one per system; `kernel` options can
 * share a scheduler or clock). Without parts it has facts, derivations,
 * events, subscriptions and the reconcile pass; each part adds a feature.
 * The 1.35 `createSystem` (system.ts) passes them all.
 */
export function createSystemCore<const M extends ModuleSchema>(
  options: SystemOptions<M>,
  parts: readonly SystemPart[] = [],
  kernelOptions?: KernelOptions,
): System<M> {
  if (!options.module) {
    throw new Error(
      "[Directive] core-next builds single-module systems so far (createSystem({ module })); `modules` arrives at L1.",
    );
  }
  const module = options.module as ModuleDefinition<ModuleSchema>;
  const schema = (module.schema?.facts ?? {}) as Record<string, unknown>;
  const deriveDefs: Record<
    string,
    (facts: unknown, derived: unknown) => unknown
  > = {};
  for (const [id, raw] of Object.entries(module.derive ?? {})) {
    deriveDefs[id] =
      typeof raw === "function"
        ? (raw as (f: unknown, d: unknown) => unknown)
        : (raw as { compute: (f: unknown, d: unknown) => unknown }).compute;
  }
  const eventDefs: Record<string, (facts: unknown, event: unknown) => void> =
    {};
  for (const [name, raw] of Object.entries(module.events ?? {})) {
    eventDefs[name] =
      typeof raw === "function"
        ? (raw as (f: unknown, e: unknown) => void)
        : (raw as { handler: (f: unknown, e: unknown) => void }).handler;
  }

  const kernel = createKernel(kernelOptions);
  const { graph, hooks } = kernel;
  const features = kernel.features as {
    effects?: EffectsFeature;
    validate?: (key: string, value: unknown) => void;
  };
  const tracker: Tracker = { deps: null };
  /** One record on the kernel's stream, for plugins and observers alike. */
  const emit = (at: string, data?: Record<string, unknown>) =>
    hooks.emit(at, data);

  const state = {
    running: false,
    initializing: false,
    initialized: false,
    destroyed: false,
    scheduled: false,
    reconciling: false,
  };
  let changedKeys = new Set<string>();
  const settleListeners = new Set<() => void>();
  const notifySettle = () => {
    for (const listener of settleListeners) {
      listener();
    }
  };

  // --- derivations -------------------------------------------------------
  const derivations = new Map<string, Derivation>();
  const byNode = new Map<ReactiveNode, Derivation>();
  const listeners = new Map<string, Set<() => void>>();
  const pending = new Set<string>();
  let holdDepth = 0;

  /** Notify subscribers of the pending derivations (in a sync settle). */
  function notifyDerivations(): void {
    const ids = [...pending];
    pending.clear();
    for (const id of ids) {
      for (const listener of listeners.get(id) ?? []) {
        try {
          listener();
        } catch (error) {
          console.error("[Directive] Derivation subscriber error:", {
            derivation: id,
            error,
          });
        }
      }
    }
  }
  /**
   * Notifications run on the kernel's `sync` lane: before the write returns,
   * and a listener's own writes get another pass (up to the scheduler's
   * pass limit, 1.35's 100 iterations).
   */
  const release = () => {
    if (--holdDepth > 0 || pending.size === 0) {
      return;
    }
    try {
      kernel.request("sync");
    } catch (error) {
      if (pending.size === 0) {
        throw error;
      }
      const remaining = [...pending];
      pending.clear();
      throw new Error(
        `[Directive] Infinite derivation notification loop detected after 100 iterations. Remaining: ${remaining.join(", ")}. This usually means a derivation listener is mutating facts that re-trigger the same derivation.`,
      );
    }
  };
  const hold = () => {
    holdDepth++;
  };

  /** Mark stale every live derivation downstream of `start`, depth first. */
  function invalidateFrom(start: Derivation, visited: Set<Derivation>): void {
    const stack = [start];
    while (stack.length > 0) {
      const d = stack.pop()!;
      if (visited.has(d)) {
        continue;
      }
      visited.add(d);
      if (!d.live || d.stale) {
        continue;
      }
      d.stale = true;
      // Dirty, not just checked: like 1.35, the next read runs this
      // derivation first and computes what it reads on demand.
      d.node.flags |= Flags.Dirty;
      if (hooks.live) {
        emit("derivation.invalidate", { id: d.id });
      }
      pending.add(d.id);
      for (let l = d.node.subs; l; l = l.nextSub) {
        const next = byNode.get(l.target);
        if (next) {
          stack.push(next);
        }
      }
    }
  }
  function invalidateKeys(keys: Iterable<string>): void {
    holdDepth++;
    const visited = new Set<Derivation>();
    try {
      for (const key of keys) {
        const factNode = factNodes.get(key);
        if (!factNode) {
          continue;
        }
        for (let l = factNode.subs; l; l = l.nextSub) {
          const d = byNode.get(l.target);
          if (d) {
            invalidateFrom(d, visited);
          }
        }
      }
    } finally {
      release();
    }
  }

  function compute(d: Derivation): unknown {
    const def = deriveDefs[d.id]!;
    try {
      const { value, deps } = withTracking(tracker, () =>
        def(facts, derivedProxy),
      );
      d.live = true;
      d.stale = false;
      if (hooks.live) {
        emit("derivation.compute", {
          id: d.id,
          value,
          deps: Array.from(deps, describeDep),
        });
      }

      return value;
    } catch (error) {
      d.live = true;
      reportError("derivation", d.id, error);
      // 1.35 keeps a throwing derivation stale: the next read runs it again.
      d.node.flags |= Flags.Dirty;
      throw error;
    }
  }
  for (const id of Object.keys(deriveDefs)) {
    const d: Derivation = { id, stale: true, live: false } as Derivation;
    d.node = graph.computed(() => compute(d), { equals: false });
    derivations.set(id, d);
    byNode.set(d.node, d);
  }
  function readDerivation(id: string): unknown {
    const d = derivations.get(id);
    if (!d) {
      throw new Error(`[Directive] Unknown derivation: ${id}`);
    }
    tracker.deps?.add(DERIVATION_DEP_PREFIX + id);

    return graph.read(d.node);
  }
  const derivedProxy = new Proxy({} as Record<string, unknown>, {
    get(_, prop) {
      if (typeof prop === "symbol" || BLOCKED_PROPS.has(prop)) {
        return undefined;
      }
      if (!derivations.has(prop)) {
        return undefined;
      }

      return readDerivation(prop);
    },
    has: (_, prop) => typeof prop === "string" && derivations.has(prop),
    ownKeys: () => [...derivations.keys()],
    getOwnPropertyDescriptor: (_, prop) =>
      typeof prop === "string" && derivations.has(prop)
        ? { configurable: true, enumerable: true, writable: false }
        : undefined,
    set: () => false,
    deleteProperty: () => false,
    defineProperty: () => false,
    getPrototypeOf: () => null,
    setPrototypeOf: () => false,
  });

  // --- errors ------------------------------------------------------------
  // The default strategy (skip) for every source an L0 system has. Each
  // error reaches onError, then onErrorRecovery; dev warns once per source.
  const warnedUnhandled = new Set<string>();
  function reportError(
    source: ErrorSource,
    sourceId: string,
    error: unknown,
  ): void {
    const wrapped =
      error instanceof DirectiveError
        ? error
        : new DirectiveError(
            error instanceof Error ? error.message : String(error),
            source,
            sourceId,
            undefined,
            source !== "system",
          );
    emit("error", { error: wrapped });
    const option =
      source === "derivation"
        ? "onDerivationError"
        : source === "constraint"
          ? "onConstraintError"
          : source === "resolver"
            ? "onResolverError"
            : null;
    if (
      isDevelopment &&
      option &&
      !warnedUnhandled.has(`${source}:${sourceId}`)
    ) {
      warnedUnhandled.add(`${source}:${sourceId}`);
      const message = (
        error instanceof Error ? error.message : String(error)
      ).replace(/[.!?]+\s*$/, "");
      console.warn(
        `[Directive] ${source} "${sourceId}" threw: ${message}. The default error strategy skips it silently. Configure errorBoundary.${option} (or errorBoundary.onError) to handle it; this warning shows once per source and only in development.`,
      );
    }
    emit("error.recovery", { error: wrapped, strategy: "skip" });
  }

  // --- facts ---------------------------------------------------------------
  const factNodes = new Map<string, ReactiveNode>();
  let batchHeld = false;
  const store = createFactsStore({
    schema,
    graph,
    tracker,
    nodes: factNodes,
    validator: isDevelopment
      ? (key, value) => features.validate?.(key, value)
      : undefined,
    onChange(key, value, prev) {
      hold();
      try {
        invalidateKeys([key]);
        if (hooks.live) {
          emit("fact.set", { key, value, prev });
        }
      } finally {
        release();
      }
      changedKeys.add(key);
      scheduleReconcile();
    },
    onWrite(key) {
      invalidateKeys([key]);
    },
    onBatchStart() {
      hold();
      batchHeld = true;
    },
    onBatch(changes: FactChange[]) {
      if (hooks.live) {
        emit("fact.batch", { changes });
      }
      invalidateKeys(changes.map((c) => c.key));
      if (batchHeld) {
        batchHeld = false;
        release();
      }
      for (const change of changes) {
        changedKeys.add(change.key);
      }
      scheduleReconcile();
    },
    onBatchEnd() {
      if (batchHeld) {
        batchHeld = false;
        release();
      }
    },
  });
  const facts = createFactsProxy(store, schema, tracker, new Set());

  // --- reconcile -------------------------------------------------------------
  function scheduleReconcile(): void {
    if (!state.running || state.scheduled || state.initializing) {
      return;
    }
    state.scheduled = true;
    notifySettle();
    kernel.request();
  }
  // The reconcile pass runs in the kernel's settle on its own lane (`micro`
  // unless the kernel options say otherwise): one host callback per tick
  // for every system sharing the scheduler.
  kernel.onSettle((lane) => {
    if (holdDepth === 0 && pending.size > 0) {
      notifyDerivations();
    }
    if (lane !== kernel.lane || !state.scheduled) {
      return;
    }
    state.scheduled = false;
    if (state.running && !state.initializing) {
      reconcile().catch((error) => {
        if (isDevelopment) {
          console.error("[Directive] Unexpected error in reconcile:", error);
        }
      });
    }
  });

  async function reconcile(): Promise<void> {
    if (state.reconciling) {
      return;
    }
    state.reconciling = true;
    notifySettle();
    const passKeys = changedKeys;
    changedKeys = new Set();
    try {
      if (hooks.live) {
        emit("reconcile.start", { snapshot: facts.$snapshot() });
      }
      const done = features.effects?.runEffectsFast(passKeys);
      if (done) {
        await done;
      }
      if (hooks.live) {
        emit("reconcile.end", {
          result: { unmet: [], inflight: [], completed: [], canceled: [] },
        });
      }
    } finally {
      state.reconciling = false;
      if (changedKeys.size > 0) {
        scheduleReconcile();
      }
      notifySettle();
    }
  }

  // --- the system ----------------------------------------------------------
  const system = {
    facts,
    derive: derivedProxy,
    events: new Proxy({} as Record<string, unknown>, {
      get(_, prop) {
        if (typeof prop !== "string" || !(prop in eventDefs)) {
          return undefined;
        }

        return (payload?: Record<string, unknown>) =>
          system.dispatch({ type: prop, ...payload });
      },
      has: (_, prop) => typeof prop === "string" && prop in eventDefs,
      ownKeys: () => Object.keys(eventDefs),
      getOwnPropertyDescriptor: (_, prop) =>
        typeof prop === "string" && prop in eventDefs
          ? { configurable: true, enumerable: true, writable: false }
          : undefined,
    }),
    get isRunning() {
      return state.running;
    },
    get isSettled() {
      return !state.scheduled && !state.reconciling;
    },
    get isInitialized() {
      return state.initialized;
    },
    get isReady() {
      return state.initialized;
    },
    initialize() {
      if (state.initialized) {
        return;
      }
      state.initializing = true;
      if (module.init) {
        store.batch(() => module.init!(facts));
      }
      state.initializing = false;
      state.initialized = true;
      for (const id of derivations.keys()) {
        try {
          readDerivation(id);
        } catch {
          // Reported through onError; the derivation stays stale.
        }
      }
    },
    start() {
      if (state.running) {
        return;
      }
      if (state.destroyed) {
        if (isDevelopment) {
          console.warn(
            "[Directive] system.start() called after destroy — ignored. Systems are not reusable; create a new one.",
          );
        }

        return;
      }
      if (!state.initialized) {
        system.initialize();
      }
      state.running = true;
      emit("system.start", { system });
      scheduleReconcile();
    },
    stop() {
      if (!state.running) {
        return;
      }
      state.running = false;
      features.effects?.cleanupAll();
      emit("system.stop", { system });
    },
    destroy() {
      if (state.destroyed) {
        return;
      }
      system.stop();
      state.destroyed = true;
      (store as unknown as { destroy(): void }).destroy();
      settleListeners.clear();
      emit("system.destroy", { system });
      kernel.dispose();
    },
    dispatch(event: SystemEvent) {
      if (BLOCKED_PROPS.has(event.type)) {
        return;
      }
      const handler = Object.hasOwn(eventDefs, event.type)
        ? eventDefs[event.type]
        : undefined;
      if (!handler) {
        if (isDevelopment) {
          console.warn(`[Directive] Unknown event type: "${event.type}"`);
        }

        return;
      }
      store.batch(() => handler(facts, event));
    },
    batch(fn: () => void) {
      store.batch(fn);
    },
    read(id: string) {
      return readDerivation(id);
    },
    subscribe(ids: string[], listener: () => void) {
      const derived: string[] = [];
      const keys: string[] = [];
      for (const id of ids) {
        if (derivations.has(id)) {
          derived.push(id);
        } else if (id in schema) {
          keys.push(id);
        } else if (isDevelopment) {
          console.warn(`[Directive] subscribe: unknown key "${id}"`);
        }
      }
      const offs: Array<() => void> = [];
      if (derived.length > 0) {
        for (const id of derived) {
          let set = listeners.get(id);
          if (!set) {
            listeners.set(id, (set = new Set()));
          }
          set.add(listener);
        }
        offs.push(() => {
          for (const id of derived) {
            const set = listeners.get(id);
            set?.delete(listener);
            if (set?.size === 0) {
              listeners.delete(id);
            }
          }
        });
      }
      if (keys.length > 0) {
        offs.push(store.subscribe(keys as never[], listener));
      }

      return () => {
        for (const off of offs) {
          off();
        }
      };
    },
    watch(
      id: string,
      callback: (next: unknown, prev: unknown) => void,
      opts?: { equalityFn?: (a: unknown, b: unknown) => boolean },
    ) {
      const equal = opts?.equalityFn ?? Object.is;
      const isDerived = derivations.has(id);
      if (!isDerived && isDevelopment && !(id in schema)) {
        console.warn(`[Directive] watch: unknown key "${id}"`);
      }
      const get = () =>
        isDerived ? readDerivation(id) : store.get(id as never);
      let prev = get();

      return system.subscribe([id], () => {
        const next = get();
        if (!equal(next, prev)) {
          const old = prev;
          prev = next;
          callback(next, old);
        }
      });
    },
    when(
      predicate: (facts: Record<string, unknown>) => boolean,
      opts?: { timeout?: number },
    ) {
      return new Promise<void>((resolve, reject) => {
        if (predicate(store.toObject())) {
          resolve();

          return;
        }
        let timer: number | undefined;
        const off = store.subscribeAll(() => {
          if (predicate(store.toObject())) {
            off();
            if (timer !== undefined) {
              kernel.clock.clearTimeout(timer);
            }
            resolve();
          }
        });
        if (opts?.timeout !== undefined && opts.timeout > 0) {
          timer = kernel.clock.setTimeout(() => {
            off();
            reject(
              new Error(`[Directive] when: timed out after ${opts.timeout}ms`),
            );
          }, opts.timeout);
        }
      });
    },
    async settle(maxWait = 5000) {
      const settled = () => !state.reconciling && !state.scheduled;
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      if (settled()) {
        return;
      }

      return new Promise<void>((resolve, reject) => {
        let done = false;
        const finish = () => {
          done = true;
          kernel.clock.clearTimeout(timeout);
          off();
        };
        const timeout = kernel.clock.setTimeout(() => {
          finish();
          const details: string[] = [];
          if (state.reconciling) {
            details.push("reconciliation in progress");
          }
          if (state.scheduled) {
            details.push("reconcile scheduled");
          }
          reject(
            new Error(
              `[Directive] settle() timed out after ${maxWait}ms. ${details.join("; ")}`,
            ),
          );
        }, maxWait);
        const off = system.onSettledChange(() => {
          queueMicrotask(() => {
            if (!done && settled()) {
              finish();
              resolve();
            }
          });
        });
      });
    },
    getSnapshot() {
      return { facts: store.toObject(), version: 1 };
    },
    onSettledChange(listener: () => void) {
      settleListeners.add(listener);

      return () => {
        settleListeners.delete(listener);
      };
    },
  };
  const ctx: SystemContext = {
    kernel,
    module,
    system,
    facts: facts as Facts<Schema>,
    store,
    derived: derivedProxy,
    tracker,
    reportError,
  };
  for (const part of parts) {
    part(ctx);
  }

  return system as unknown as System<M>;
}
