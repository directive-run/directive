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
import { Flags, Graph, type ReactiveNode } from "../graph.js";
import { createEffectsManager } from "./effects.js";
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
  ModuleDef,
  ModuleDefinition,
  ModuleSchema,
  Plugin,
  System,
  SystemEvent,
  SystemOptions,
} from "./types.js";

/** An error from a definition, as plugins and observers see it. */
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

/** The tick structure matches 1.35's, so onInit lands on the same microtask. */
async function safeAsync(plugin: Plugin, fn: () => unknown): Promise<unknown> {
  try {
    return await (fn() ?? Promise.resolve());
  } catch (error) {
    console.error("[Directive] Plugin error:", {
      plugin: plugin.name,
      hook: "onInit",
      error,
    });

    return undefined;
  }
}

/** The 1.35 plugin manager: hooks called in registration order, errors logged. */
function createPlugins() {
  const plugins: Plugin[] = [];
  const call = (plugin: Plugin, hook: string, args: unknown[]) => {
    try {
      return (plugin[hook] as ((...a: unknown[]) => unknown) | undefined)?.(
        ...args,
      );
    } catch (error) {
      console.error("[Directive] Plugin error:", {
        plugin: plugin.name,
        hook,
        error,
      });

      return undefined;
    }
  };

  return {
    list: plugins,
    register(plugin: Plugin) {
      const index = plugins.findIndex((p) => p.name === plugin.name);
      if (index !== -1) {
        console.warn(
          `[Directive] Plugin "${plugin.name}" is already registered, replacing...`,
        );
        plugins.splice(index, 1);
      }
      plugins.push(plugin);
    },
    unregister(name: string) {
      const index = plugins.findIndex((p) => p.name === name);
      if (index !== -1) {
        plugins.splice(index, 1);
      }
    },
    emit(hook: string, ...args: unknown[]) {
      for (const plugin of [...plugins]) {
        call(plugin, hook, args);
      }
    },
    /** onInit may be async; plugins added while it runs are initialised too. */
    async init(system: unknown) {
      const done = new WeakSet<Plugin>();
      for (let pass = 0; pass < 100; pass++) {
        const todo = plugins.filter((p) => !done.has(p));
        if (todo.length === 0) {
          break;
        }
        for (const plugin of todo) {
          done.add(plugin);
          await safeAsync(plugin, () =>
            plugin.onInit
              ? (plugin.onInit as (s: unknown) => unknown)(system)
              : undefined,
          );
        }
      }
    },
  };
}

interface Derivation {
  id: string;
  node: ReactiveNode;
  /** 1.35's stale flag: set by an invalidation, cleared by a compute. */
  stale: boolean;
  /** Has computed at least once (1.35 creates its state on first read). */
  live: boolean;
}

export function createSystem<const M extends ModuleSchema>(
  options: SystemOptions<M>,
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
  const effectDefs = (module.effects ?? {}) as Record<string, any>;

  const graph = new Graph();
  const tracker: Tracker = { deps: null };
  const plugins = createPlugins();
  for (const plugin of options.plugins ?? []) {
    plugins.register(plugin);
  }
  const hasPlugins = () => plugins.list.length > 0;

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
  let flushing = false;

  function notifyDerivations(): void {
    if (holdDepth > 0 || flushing) {
      return;
    }
    flushing = true;
    try {
      let iterations = 0;
      while (pending.size > 0) {
        if (++iterations > 100) {
          const remaining = [...pending];
          pending.clear();
          throw new Error(
            `[Directive] Infinite derivation notification loop detected after 100 iterations. Remaining: ${remaining.join(", ")}. This usually means a derivation listener is mutating facts that re-trigger the same derivation.`,
          );
        }
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
    } finally {
      flushing = false;
    }
  }
  const hold = () => {
    holdDepth++;
  };
  const release = () => {
    holdDepth--;
    notifyDerivations();
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
      if (hasPlugins()) {
        plugins.emit("onDerivationInvalidate", d.id);
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
      if (hasPlugins()) {
        plugins.emit(
          "onDerivationCompute",
          d.id,
          value,
          Array.from(deps, describeDep),
        );
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
    plugins.emit("onError", wrapped);
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
    plugins.emit("onErrorRecovery", wrapped, "skip");
  }

  // --- facts ---------------------------------------------------------------
  let dispatchDepth = 0;
  const factNodes = new Map<string, ReactiveNode>();
  let batchHeld = false;
  const store = createFactsStore({
    schema,
    graph,
    tracker,
    nodes: factNodes,
    onChange(key, value, prev) {
      hold();
      try {
        invalidateKeys([key]);
        if (hasPlugins()) {
          plugins.emit("onFactSet", key, value, prev);
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
      if (hasPlugins()) {
        plugins.emit("onFactsBatch", changes);
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

  // --- effects -------------------------------------------------------------
  const effects = createEffectsManager({
    definitions: effectDefs,
    facts,
    store,
    derived: derivedProxy,
    tracker,
    onRun(id) {
      if (hasPlugins()) {
        plugins.emit("onEffectRun", id);
      }
    },
    onError(id, error) {
      if (hasPlugins()) {
        plugins.emit("onEffectError", id, error);
      }
      reportError("effect", id, error);
    },
    onWriteBlocked(id, key) {
      if (hasPlugins()) {
        plugins.emit("onEffectWriteBlocked", id, key);
      }
    },
  });

  // --- reconcile -------------------------------------------------------------
  function scheduleReconcile(): void {
    if (!state.running || state.scheduled || state.initializing) {
      return;
    }
    state.scheduled = true;
    notifySettle();
    queueMicrotask(() => {
      state.scheduled = false;
      if (state.running && !state.initializing) {
        reconcile().catch((error) => {
          if (isDevelopment) {
            console.error("[Directive] Unexpected error in reconcile:", error);
          }
        });
      }
    });
  }

  async function reconcile(): Promise<void> {
    if (state.reconciling) {
      return;
    }
    state.reconciling = true;
    notifySettle();
    const passKeys = changedKeys;
    changedKeys = new Set();
    try {
      if (hasPlugins()) {
        plugins.emit("onReconcileStart", facts.$snapshot());
      }
      const done = effects.runEffectsFast(passKeys);
      if (done) {
        await done;
      }
      if (hasPlugins()) {
        plugins.emit("onReconcileEnd", {
          unmet: [],
          inflight: [],
          completed: [],
          canceled: [],
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
  let observers = 0;
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
      plugins.emit("onStart", system);
      scheduleReconcile();
    },
    stop() {
      if (!state.running) {
        return;
      }
      state.running = false;
      effects.cleanupAll();
      plugins.emit("onStop", system);
    },
    destroy() {
      if (state.destroyed) {
        return;
      }
      system.stop();
      state.destroyed = true;
      (store as unknown as { destroy(): void }).destroy();
      settleListeners.clear();
      plugins.emit("onDestroy", system);
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
      dispatchDepth++;
      try {
        store.batch(() => handler(facts, event));
      } finally {
        dispatchDepth--;
      }
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
        let timer: ReturnType<typeof setTimeout> | undefined;
        const off = store.subscribeAll(() => {
          if (predicate(store.toObject())) {
            off();
            if (timer !== undefined) {
              clearTimeout(timer);
            }
            resolve();
          }
        });
        if (opts?.timeout !== undefined && opts.timeout > 0) {
          timer = setTimeout(() => {
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
          clearTimeout(timeout);
          off();
        };
        const timeout = setTimeout(() => {
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
    observe(observer: (event: Record<string, unknown>) => void) {
      const name = `__observer_${++observers}`;
      const emit = (event: Record<string, unknown>) => observer(event);
      const plugin: Plugin = {
        name,
        onInit: () => emit({ type: "system.init" }),
        onStart: () => emit({ type: "system.start" }),
        onStop: () => emit({ type: "system.stop" }),
        onDestroy: () => emit({ type: "system.destroy" }),
        onFactSet: (key: string, value: unknown, prev: unknown) =>
          emit({
            type: "fact.change",
            key,
            prev,
            next: value,
            origin: "authored",
          }),
        onFactsBatch: (changes: FactChange[]) => {
          const out: Array<Record<string, unknown>> = [];
          const open = new Map<string, Record<string, unknown>>();
          for (const change of changes) {
            const next = change.type === "delete" ? undefined : change.value;
            const entry = open.get(change.key);
            if (entry && entry.origin === change.origin) {
              entry.next = next;
              continue;
            }
            const fresh = {
              key: change.key,
              prev: change.prev,
              next,
              origin: change.origin,
            };
            out.push(fresh);
            open.set(change.key, fresh);
          }
          for (const e of out) {
            emit({ type: "fact.change", ...e });
          }
        },
        onDerivationCompute: (id: string, value: unknown) =>
          emit({ type: "derivation.compute", id, value }),
        onReconcileStart: () => emit({ type: "reconcile.start" }),
        onReconcileEnd: () =>
          emit({
            type: "reconcile.end",
            resolversCompleted: 0,
            resolversCanceled: 0,
          }),
        onEffectRun: (id: string) => emit({ type: "effect.run", id }),
        onEffectError: (id: string, error: unknown) =>
          emit({ type: "effect.error", id, error }),
        onEffectWriteBlocked: (id: string, key: string) =>
          emit({ type: "effect.write-blocked", id, key }),
      };
      plugins.register(plugin);

      return () => plugins.unregister(name);
    },
    inspect() {
      return {
        unmet: [],
        inflight: [],
        pendingInvalidations: 0,
        observedDerivations: 0,
        facts: Object.keys(schema).map((key) => ({
          key,
          meta: (schema[key] as { _meta?: unknown } | undefined)?._meta,
        })),
        events: Object.keys(eventDefs).map((name) => ({
          name,
          meta: (module.events?.[name] as { meta?: unknown } | undefined)?.meta,
        })),
        constraints: [],
        resolvers: {},
        resolverDefs: [],
        effects: Object.keys(effectDefs).map((id) => ({
          id,
          meta: effectDefs[id]?.meta,
        })),
        sources: [],
        attachedSourceCount: 0,
        derivations: [...derivations.keys()].map((id) => ({
          id,
          meta: (module.derive?.[id] as { meta?: unknown } | undefined)?.meta,
        })),
        modules: [{ id: module.id, meta: module.meta }],
        traceEnabled: false,
      };
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
  void dispatchDepth;

  plugins.init(system).catch(() => {});

  return system as unknown as System<M>;
}
