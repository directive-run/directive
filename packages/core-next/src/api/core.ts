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
 *
 * Written for size (L0e): system state lives in closure variables (which a
 * minifier shortens) rather than object fields, build-private fields end in
 * `_` (mangled by the build), and the listener and view patterns are the
 * shared helpers in facts.ts. Development-only text sits behind the dev flag.
 */

import isDevelopment from "#is-development";
import { Flags, type ReactiveNode } from "../graph.js";
import {
  type Kernel,
  type KernelEvent,
  type KernelOptions,
  createKernel,
} from "../kernel.js";
import {
  BLOCKED_PROPS,
  DERIVATION_DEP_PREFIX,
  LOCKED,
  type Listeners,
  type Tracker,
  createFactsProxy,
  createFactsStore,
  describeDep,
  listen,
  view,
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
  declare readonly source: ErrorSource;
  declare readonly sourceId: string;
  declare readonly context?: unknown;
  declare readonly recoverable: boolean;
  constructor(
    message: string,
    source: ErrorSource,
    sourceId: string,
    context?: unknown,
    recoverable = true,
  ) {
    super(message);
    // Own fields in the order 1.35 defines them, `name` last.
    Object.assign(this, {
      source,
      sourceId,
      context,
      recoverable,
      name: "DirectiveError",
    });
  }
}

export function createModule<const M extends ModuleSchema>(
  id: string,
  definition: ModuleDef<M>,
): ModuleDefinition<M> {
  return { ...definition, id } as unknown as ModuleDefinition<M>;
}

interface Derivation {
  id_: string;
  node_: ReactiveNode;
  /** 1.35's stale flag: set by an invalidation, cleared by a compute. */
  stale_: boolean;
  /** Has computed at least once (1.35 creates its state on first read). */
  live_: boolean;
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

type Fn = (...args: any[]) => any;

/** A module's definitions by id, each as its function (`fn` or `{ [key]: fn }`). */
const defsOf = (
  src: Record<string, unknown> | undefined,
  key: string,
): Record<string, Fn> => {
  const out: Record<string, Fn> = {};
  for (const [id, raw] of Object.entries(src ?? {})) {
    out[id] = typeof raw === "function" ? (raw as Fn) : (raw as any)?.[key];
  }

  return out;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A promise that settles after one microtask. */
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

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
  const module = options.module as ModuleDefinition<ModuleSchema>;
  if (!module) {
    throw new Error(
      "[Directive] createSystem needs a `module` (`modules` arrives at L1)",
    );
  }
  const schema = (module.schema?.facts ?? {}) as Record<string, unknown>;
  const deriveDefs = defsOf(module.derive, "compute");
  const eventDefs = defsOf(module.events, "handler");

  const kernel = createKernel(kernelOptions);
  const { graph, hooks, clock } = kernel;
  const features = kernel.features as {
    effects?: EffectsFeature;
    validate?: (key: string, value: unknown) => void;
    plugins?: { deliver_(event: KernelEvent): void };
  };
  const tracker: Tracker = { deps: null };
  /**
   * After destroy the kernel's stream is gone, but as in 1.35 plugins and
   * observers still hear writes: records go straight to the plugins.
   */
  let tail: ((event: KernelEvent) => void) | null = null;
  const live = () => tail !== null || hooks.live;
  /** One record on the kernel's stream, for plugins and observers alike. */
  const emit = (at: string, data?: Record<string, unknown>) =>
    tail
      ? tail({ ...data, t: clock.now(), seq: 0, sys: kernel.id, at })
      : hooks.emit(at, data);
  /** Emit only when someone listens: the record is not even built otherwise. */
  const report = (at: string, data: () => Record<string, unknown>) => {
    if (live()) {
      emit(at, data());
    }
  };

  let running = false;
  let initializing = false;
  let initialized = false;
  let destroyed = false;
  let scheduled = false;
  let reconciling = false;
  // 1.35's effect-chain cut: passes started only by writes made while
  // effects ran are an effect waking itself; after 100 the chain is cut.
  // Writes since the last pass: from an effect, or from elsewhere.
  let effectsOpen = false;
  let writtenByEffect = false;
  let writtenElsewhere = false;
  let chain = 0;
  /** In this system's settle: a follow-up pass waits for the next microtask. */
  let inSettle = false;
  let followUpQueued = false;
  let changedKeys = new Set<string>();
  const settleListeners = new Set<() => void>();
  const notifySettle = () => settleListeners.forEach((fn) => fn());

  // --- derivations -------------------------------------------------------
  const derivations = new Map<string, Derivation>();
  const byNode = new Map<ReactiveNode, Derivation>();
  const listeners: Listeners = new Map();
  const pending = new Set<string>();
  let holdDepth = 0;

  /** Tell the subscribers of every derivation that went stale. */
  const notifyPending = () => {
    if (pending.size === 0) {
      return;
    }
    const ids = [...pending];
    pending.clear();
    for (const id of ids) {
      listeners.get(id)?.forEach((fn) => {
        try {
          fn();
        } catch (error) {
          console.error("[Directive] Derivation subscriber error:", {
            derivation: id,
            error,
          });
        }
      });
    }
  };

  /**
   * Notifications run on the kernel's `sync` lane: before the write returns,
   * and a listener's own writes get another pass (up to the scheduler's
   * pass limit, 1.35's 100 iterations).
   */
  const release = () => {
    if (--holdDepth > 0 || pending.size === 0) {
      return;
    }
    if (destroyed) {
      // The kernel is gone, so no settle will come: as in 1.35, writes still
      // reach derivation subscribers, right here.
      notifyPending();

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
        `[Directive] Infinite derivation notification loop detected after 100 iterations. Remaining: ${remaining.join(", ")}.${isDevelopment ? " This usually means a derivation listener is mutating facts that re-trigger the same derivation." : ""}`,
      );
    }
  };

  /**
   * Mark stale every live derivation downstream of the written keys: for each
   * fact's subscriber in link order, depth first.
   */
  function invalidate(keys: Iterable<string>): void {
    holdDepth++;
    const seen = new Set<ReactiveNode>();
    try {
      for (const key of keys) {
        for (let l = factNodes.get(key)?.subs; l; l = l.nextSub) {
          const stack = [l.target];
          while (stack.length > 0) {
            const node = stack.pop()!;
            const d = byNode.get(node);
            if (!d || seen.has(node)) {
              continue;
            }
            seen.add(node);
            if (!d.live_ || d.stale_) {
              continue;
            }
            d.stale_ = true;
            // Dirty, not just checked: like 1.35, the next read runs this
            // derivation first and computes what it reads on demand.
            node.flags |= Flags.Dirty;
            report("derivation.invalidate", () => ({ id: d.id_ }));
            pending.add(d.id_);
            // Wakes an effect that read this derivation (and maybe no fact).
            changedKeys.add(DERIVATION_DEP_PREFIX + d.id_);
            for (let s = node.subs; s; s = s.nextSub) {
              stack.push(s.target);
            }
          }
        }
      }
    } finally {
      release();
    }
  }

  function compute(d: Derivation): unknown {
    try {
      const { value, deps } = withTracking(tracker, () =>
        deriveDefs[d.id_]!(facts, derive),
      );
      d.live_ = true;
      d.stale_ = false;
      report("derivation.compute", () => ({
        id: d.id_,
        value,
        deps: Array.from(deps, describeDep),
      }));

      return value;
    } catch (error) {
      d.live_ = true;
      reportError("derivation", d.id_, error);
      // 1.35 keeps a throwing derivation stale: the next read runs it again.
      d.node_.flags |= Flags.Dirty;
      throw error;
    }
  }
  for (const id in deriveDefs) {
    const d = { id_: id, stale_: true, live_: false } as Derivation;
    d.node_ = graph.computed(() => compute(d), { equals: false });
    derivations.set(id, d);
    byNode.set(d.node_, d);
  }
  function read(id: string): unknown {
    const d = derivations.get(id);
    if (!d) {
      throw new Error(`[Directive] Unknown derivation: ${id}`);
    }
    tracker.deps?.add(DERIVATION_DEP_PREFIX + id);

    return graph.read(d.node_);
  }
  const no = () => false;
  const derive = view(
    (id) => derivations.has(id),
    () => [...derivations.keys()],
    (id) => (BLOCKED_PROPS.has(id) ? undefined : read(id)),
    { ...LOCKED, set: no, deleteProperty: no },
  );

  // --- errors ------------------------------------------------------------
  // The default strategy (skip) for every source an L0 system has. Each
  // error reaches onError, then onErrorRecovery; dev warns once per source.
  const warned = new Set<string>();
  function reportError(
    source: ErrorSource,
    sourceId: string,
    error: unknown,
  ): void {
    const wrapped =
      error instanceof DirectiveError
        ? error
        : new DirectiveError(
            messageOf(error),
            source,
            sourceId,
            undefined,
            source !== "system",
          );
    emit("error", { error: wrapped });
    if (isDevelopment) {
      const option =
        source === "derivation"
          ? "onDerivationError"
          : source === "constraint"
            ? "onConstraintError"
            : source === "resolver"
              ? "onResolverError"
              : null;
      const key = `${source}:${sourceId}`;
      if (option && !warned.has(key)) {
        warned.add(key);
        console.warn(
          `[Directive] ${source} "${sourceId}" threw: ${messageOf(error).replace(/[.!?]+\s*$/, "")}. The default error strategy skips it silently. Configure errorBoundary.${option} (or errorBoundary.onError) to handle it; this warning shows once per source and only in development.`,
        );
      }
    }
    emit("error.recovery", { error: wrapped, strategy: "skip" });
  }

  // --- facts ---------------------------------------------------------------
  const factNodes = new Map<string, ReactiveNode>();
  let batchHeld = false;
  const endBatch = () => {
    if (batchHeld) {
      batchHeld = false;
      release();
    }
  };
  /** Changed keys feed the next reconcile pass. */
  const changed = (keys: string[]) => {
    for (const key of keys) {
      changedKeys.add(key);
    }
    if (effectsOpen) {
      writtenByEffect = true;
    } else {
      writtenElsewhere = true;
    }
    scheduleReconcile();
  };
  const store = createFactsStore({
    schema,
    graph,
    tracker,
    nodes: factNodes,
    validator: isDevelopment
      ? (key, value) => features.validate?.(key, value)
      : undefined,
    onChange(key, value, prev) {
      holdDepth++;
      try {
        invalidate([key]);
        report("fact.set", () => ({ key, value, prev }));
      } finally {
        release();
      }
      changed([key]);
    },
    onWrite: (key) => invalidate([key]),
    onBatchStart() {
      holdDepth++;
      batchHeld = true;
    },
    onBatch(changes: FactChange[]) {
      report("fact.batch", () => ({ changes }));
      const keys = changes.map((c) => c.key);
      invalidate(keys);
      endBatch();
      changed(keys);
    },
    onBatchEnd: endBatch,
  });
  const facts = createFactsProxy(store, schema, tracker, new Set());

  // --- reconcile -------------------------------------------------------------
  function scheduleReconcile(): void {
    if (!running || initializing) {
      return;
    }
    if (!scheduled) {
      scheduled = true;
      notifySettle();
    } else if (inSettle || followUpQueued) {
      return;
    }
    if (inSettle && kernel.lane === "micro") {
      // As in 1.35, each follow-up pass runs on its own microtask rather
      // than in the running lane's next pass.
      followUpQueued = true;
      queueMicrotask(followUp);
    } else {
      // Asked again even when scheduled: a lane that failed to settle drops
      // its waiters, and this re-queues the pass, so the system stays live.
      kernel.request();
    }
  }
  const unexpected = (error: unknown) =>
    console.error("[Directive] Unexpected error in reconcile:", error);
  function followUp(): void {
    followUpQueued = false;
    if (!scheduled || kernel.disposed) {
      return;
    }
    kernel.request();
    try {
      kernel.flush(kernel.lane);
    } catch (error) {
      unexpected(error);
    }
  }
  // The reconcile pass runs in the kernel's settle on its own lane (`micro`
  // unless the kernel options say otherwise): one host callback per tick
  // for every system sharing the scheduler.
  kernel.onSettle((lane) => {
    if (holdDepth === 0) {
      notifyPending();
    }
    if (lane !== kernel.lane || !scheduled) {
      return;
    }
    scheduled = false;
    if (running && !initializing) {
      inSettle = true;
      try {
        reconcile().catch((error) => {
          if (isDevelopment) {
            unexpected(error);
          }
        });
      } finally {
        inSettle = false;
      }
    }
  });

  async function reconcile(): Promise<void> {
    if (reconciling) {
      return;
    }
    chain = writtenByEffect && !writtenElsewhere ? chain + 1 : 0;
    writtenByEffect = writtenElsewhere = false;
    if (chain > 100) {
      if (isDevelopment) {
        console.warn(
          `[Directive] Effects kept waking each other for 100 passes in a row, so the chain was stopped. An effect is dispatching an event (or writing through a captured system) that changes something an effect reads. Move that change into the event handler or resolver that causes it. Changed: ${[...changedKeys].slice(0, 5).join(", ")}`,
        );
      }
      changedKeys.clear();
      chain = 0;
      notifySettle();

      return;
    }
    reconciling = true;
    notifySettle();
    const passKeys = changedKeys;
    changedKeys = new Set();
    try {
      report("reconcile.start", () => ({ snapshot: facts.$snapshot() }));
      effectsOpen = true;
      let done: Promise<void> | undefined;
      try {
        done = features.effects?.runEffectsFast(passKeys);
      } finally {
        effectsOpen = false;
      }
      if (done) {
        await done;
      }
      report("reconcile.end", () => ({
        result: { unmet: [], inflight: [], completed: [], canceled: [] },
      }));
    } finally {
      reconciling = false;
      if (changedKeys.size > 0) {
        scheduleReconcile();
      }
      notifySettle();
    }
  }

  // --- the system ----------------------------------------------------------
  const isSettled = () => !scheduled && !reconciling;
  const warnUnknown = (method: string, id: string) =>
    console.warn(`[Directive] ${method}: unknown key "${id}"`);
  /** A clock timer owned by this system; returns its canceller. */
  const after = (ms: number, fn: () => void) => {
    const id = clock.setTimeout(fn, ms, { owner: kernel.owner });

    return () => clock.clearTimeout(id);
  };
  const system = {
    facts,
    derive,
    events: view(
      (name) => name in eventDefs,
      () => Object.keys(eventDefs),
      (name) => (payload?: Record<string, unknown>) =>
        system.dispatch({ type: name, ...payload }),
    ),
    get isRunning() {
      return running;
    },
    get isSettled() {
      return isSettled();
    },
    get isInitialized() {
      return initialized;
    },
    get isReady() {
      return initialized;
    },
    initialize() {
      if (initialized) {
        return;
      }
      initializing = true;
      if (module.init) {
        store.batch(() => module.init!(facts));
      }
      initializing = false;
      initialized = true;
      for (const id of derivations.keys()) {
        try {
          read(id);
        } catch {
          // Reported through onError; the derivation stays stale.
        }
      }
    },
    start() {
      if (running) {
        return;
      }
      if (destroyed) {
        if (isDevelopment) {
          console.warn(
            "[Directive] system.start() called after destroy — ignored. Systems are not reusable; create a new one.",
          );
        }

        return;
      }
      system.initialize();
      running = true;
      emit("system.start", { system });
      scheduleReconcile();
    },
    stop() {
      if (running) {
        running = false;
        features.effects?.cleanupAll();
        emit("system.stop", { system });
      }
    },
    destroy() {
      if (destroyed) {
        return;
      }
      system.stop();
      destroyed = true;
      (store as unknown as { destroy(): void }).destroy();
      settleListeners.clear();
      emit("system.destroy", { system });
      const plugins = features.plugins;
      kernel.dispose();
      if (plugins) {
        tail = plugins.deliver_;
      }
    },
    dispatch(event: SystemEvent) {
      const type = event.type;
      if (BLOCKED_PROPS.has(type)) {
        return;
      }
      const handler = Object.hasOwn(eventDefs, type)
        ? eventDefs[type]
        : undefined;
      if (handler) {
        store.batch(() => handler(facts, event));
      } else if (isDevelopment) {
        console.warn(
          `[Directive] Unknown event type "${type}". No handler is registered for this event. Available events: ${Object.keys(eventDefs).join(", ") || "(none)"}`,
        );
      }
    },
    batch(fn: () => void) {
      store.batch(fn);
    },
    read,
    subscribe(ids: string[], listener: () => void) {
      const derived: string[] = [];
      const keys: string[] = [];
      for (const id of ids) {
        if (derivations.has(id)) {
          derived.push(id);
        } else if (id in schema) {
          keys.push(id);
        } else if (isDevelopment) {
          warnUnknown("subscribe", id);
        }
      }
      const offDerived = listen(listeners, derived, listener);
      const offKeys = store.subscribe(keys, listener);

      return () => {
        offDerived();
        offKeys();
      };
    },
    watch(
      id: string,
      callback: (next: unknown, prev: unknown) => void,
      opts?: { equalityFn?: (a: unknown, b: unknown) => boolean },
    ) {
      const equal = opts?.equalityFn ?? Object.is;
      const isDerived = derivations.has(id);
      if (isDevelopment && !isDerived && !(id in schema)) {
        warnUnknown("watch", id);
      }
      const get = () => (isDerived ? read(id) : store.get(id));
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
        let cancel: (() => void) | undefined;
        const off = store.subscribeAll(() => {
          if (predicate(store.toObject())) {
            off();
            cancel?.();
            resolve();
          }
        });
        const ms = opts?.timeout;
        if (ms !== undefined && ms > 0) {
          cancel = after(ms, () => {
            off();
            reject(new Error(`[Directive] when: timed out after ${ms}ms`));
          });
        }
      });
    },
    async settle(maxWait = 5000) {
      await tick();
      if (isSettled()) {
        return;
      }

      return new Promise<void>((resolve, reject) => {
        let done = false;
        const finish = () => {
          done = true;
          cancel();
          off();
        };
        const cancel = after(maxWait, () => {
          // Read before finish(): its state is what timed out.
          const details = [
            reconciling && "reconciliation in progress",
            scheduled && "reconcile scheduled",
          ].filter(Boolean);
          finish();
          reject(
            new Error(
              `[Directive] settle() timed out after ${maxWait}ms. ${details.join("; ")}`,
            ),
          );
        });
        const off = system.onSettledChange(() => {
          queueMicrotask(() => {
            if (!done && isSettled()) {
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
    derived: derive,
    tracker,
    reportError,
  };
  for (const part of parts) {
    part(ctx);
  }

  return system as unknown as System<M>;
}
