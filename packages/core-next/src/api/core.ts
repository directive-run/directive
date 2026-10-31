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
import { createClock } from "../clock.js";
import { Flags, Link, type ReactiveNode } from "../graph.js";
import {
  type Kernel,
  type KernelEvent,
  type KernelOptions,
  createKernel,
} from "../kernel.js";
import {
  type Allow,
  BLOCKED_PROPS,
  DERIVATION_DEP_PREFIX,
  LOCKED,
  type Listeners,
  type Tracker,
  type Writer,
  type Writers,
  createFactsProxy,
  createFactsStore,
  describeDep,
  isPrototypeSafe,
  listen,
  view,
  withTracking,
} from "./facts.js";
import type { RequirementWithId } from "./requirements.js";
import type {
  FactChange,
  Facts,
  FactsStore,
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

export { createModule } from "./module.js";

/** What happens after an error (1.35's RecoveryStrategy). */
export type Strategy = "skip" | "retry" | "retry-later" | "disable" | "throw";

/**
 * The error boundary's decision (errors.ts): called after the `error` record,
 * before `error.recovery`. `warn` gives the development warning for an error
 * nothing handles.
 */
export type Decide = (
  source: ErrorSource,
  sourceId: string,
  error: unknown,
  wrapped: DirectiveError,
  context: unknown,
  warn: () => void,
) => Strategy;

/** Where records go once the kernel is gone: the plugins part. */
interface Tail {
  deliver_(event: KernelEvent): void;
  wants_(at: string): boolean;
}

interface Derivation {
  id_: string;
  node_: ReactiveNode;
  /** 1.35's stale flag: set by an invalidation, cleared by a compute. */
  stale_: boolean;
  /** Has computed at least once (1.35 creates its state on first read). */
  live_: boolean;
  /** What it read when it last computed (the tracker's set, kept). */
  deps_?: Set<string>;
  /**
   * What a membership test (`"id" in derived`) reads: made on the first test,
   * never written. It is the edge a read would leave, without the read that
   * runs the derivation. See `invalidate`.
   */
  asked_: ReactiveNode | null;
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
  /**
   * Report an error from `source`: returns the strategy for the caller to
   * act on (skip without an error boundary). Under "throw" it throws the
   * DirectiveError instead, after the records, as 1.35 does.
   */
  reportError(
    source: ErrorSource,
    sourceId: string,
    error: unknown,
    context?: unknown,
    /** A run that failed after its own write satisfied its requirement. */
    satisfied?: boolean,
  ): Strategy;
  /** Set by the error boundary part (errors.ts); absent, everything skips. */
  decide_?: Decide;
  /** Ask for a reconcile pass, through the kernel's scheduler. */
  schedule(): void;
  /**
   * Watch a derivation named in declared deps: every invalidation upstream
   * of it wakes the reader, even while it stays stale (nothing computes it
   * for the reader). 1.35's observed set, for declared deps.
   */
  watch(id: string): void;
  /** Tell settle listeners that `isSettled` may have changed. */
  settled(): void;
  /** The store reports each changing write and its stamp here (reconcile). */
  readonly writers: Writers;
  /**
   * A facts view whose writes carry `writer`'s stamp (a resolver run), each
   * asked of `allow` first when the run is bound (RFC-0003).
   */
  factsFor(writer: Writer, allow?: Allow): Facts<Schema>;
  /**
   * What a derivation read when it last computed: fact keys and prefixed
   * derivation ids (own-write satisfaction follows them to the facts).
   */
  derivationDeps(id: string): ReadonlySet<string> | undefined;
}

/** An opt-in part: wires itself in through the kernel's feature registry. */
export type SystemPart = (context: SystemContext) => void;

/** The effects feature as the reconcile pass drives it. */
export interface EffectsFeature {
  runEffectsFast(changedKeys: Set<string>): Promise<void> | undefined;
  cleanupAll(): void;
  /** An effect waits to run again (the "retry" strategy): pass again. */
  reruns_(): boolean;
  /** A pass from an ordinary write: failing effects get their retries back. */
  fresh_(): void;
}

/** The error boundary (errors.ts) as the lifecycle drives it. */
export interface ErrorsFeature {
  start_(): void;
  /** Ends retry-later polling and drops the waiting entries (1.35). */
  stop_(): void;
  /** A resolver completed: its retry-later budget and entry go. */
  clear_(resolverId: string): void;
}

/** The L2 reconcile feature (reconcile.ts) as the pass drives it. */
export interface ReconcileFeature {
  /** Pass start, before effects. */
  begin_(): void;
  /** After effects: the requirements now (a promise only when it must wait). */
  evaluate_(
    passKeys: Set<string>,
  ): RequirementWithId[] | Promise<RequirementWithId[]>;
  /** Diff, cancel, dispatch; answers the `onReconcileEnd` result. */
  commit_(
    current: RequirementWithId[],
    passKeys: Set<string>,
  ): Record<string, unknown>;
  /** A run is in flight: not settled. */
  busy_(): boolean;
  start_(): void;
  stop_(): void;
  /** A due retry-later constraint is asked again in the next pass. */
  dirty_(id: string): void;
  /** The settle-timeout details, around the core's own. */
  details_(core: string[]): string[];
  /** inspect()'s L2 sections, as 1.35 reports them. */
  inspect_(): {
    unmet: RequirementWithId[];
    inflight: { id: string; resolverId: string; startedAt: number }[];
    constraints: Record<string, unknown>[];
    resolvers: Record<string, Record<string, unknown>>;
  };
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

/** A module's lifecycle hooks (1.35's `ModuleHooks`, the L3 subset). */
type Hooks = {
  [K in "onInit" | "onStart" | "onStop"]?: (system: unknown) => void;
};

/**
 * What the namespaced form (namespaced.ts) adds to the one flat module it
 * hands the core: each module's init and hooks in init order, how its
 * nested `initialFacts` are applied, and the event `tickMs` dispatches.
 */
interface Flat {
  inits_?: Fn[];
  hooks_?: Hooks[];
  load_?: Load;
  tick_?: string;
}

/** Applies loaded facts (`initialFacts`, then `hydrate`'s) through `set`. */
type Load = (
  src: Record<string, unknown>,
  set: (key: string, value: unknown) => void,
  hydrated?: boolean,
) => void;

/** The single-module form's loader (1.35 system.ts:1163–1188). */
const loadFlat: Load = (src, set, hydrated) => {
  if (hydrated && !isPrototypeSafe(src)) {
    if (isDevelopment) {
      console.warn(
        "[Directive] hydrate() data contains potentially dangerous keys. Skipping.",
      );
    }

    return;
  }
  for (const [key, value] of Object.entries(src)) {
    if (!BLOCKED_PROPS.has(key)) {
      set(key, value);
    }
  }
};

/** 1.35 refuses a zero or negative `tickMs` when the system is created. */
export const checkTick = (ms: number | undefined): void => {
  if (ms !== undefined && ms <= 0) {
    throw new Error("[Directive] tickMs must be a positive number");
  }
};

/** A module's definitions by id, each as its function (`fn` or `{ [key]: fn }`). */
const defsOf = (
  src: Record<string, unknown> | undefined,
  key: string,
): Record<string, Fn> => {
  const out: Record<string, Fn> = {};
  for (const [id, raw] of Object.entries(src ?? {})) {
    const fn = typeof raw === "function" ? raw : (raw as any)?.[key];
    if (
      key === "compute" &&
      typeof raw === "object" &&
      fn !== undefined &&
      typeof fn !== "function" &&
      (typeof fn !== "object" || fn === null)
    ) {
      // 1.35's message: a data form must be a predicate or template object.
      throw new Error(
        `[Directive] memoizePredicate: predicate must be a plain object or array; got ${typeof fn}`,
      );
    }
    out[id] = fn as Fn;
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
  const module = options.module as ModuleDefinition<ModuleSchema> & Flat;
  if (!module) {
    throw new Error(
      `[Directive] createSystem requires a module. Got: ${typeof module}`,
    );
  }
  const tickMs = options.tickMs;
  if (!module.load_) {
    // The namespaced form checks it in createSystem, before its module
    // checks (1.35's order), so a flattened module is not checked twice.
    checkTick(tickMs);
  }
  const load = module.load_ ?? loadFlat;
  if (
    !module.load_ &&
    options.initialFacts &&
    !isPrototypeSafe(options.initialFacts)
  ) {
    throw new Error(
      "[Directive] initialFacts contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
    );
  }
  const hooks_ = module.hooks_ ?? (module.hooks ? [module.hooks as Hooks] : []);
  const schema = (module.schema?.facts ?? {}) as Record<string, unknown>;
  // A security boundary (1.35): runs in every environment.
  for (const [section, obj] of [
    ["schema", schema],
    ["events", module.events],
    ["derive", module.derive],
    ["effects", module.effects],
    ["sources", module.sources],
    ["constraints", module.constraints],
    ["resolvers", module.resolvers],
  ] as const) {
    for (const key of Object.keys(obj ?? {})) {
      if (BLOCKED_PROPS.has(key)) {
        throw new Error(
          `[Directive] Security: Module "${module.id}" has dangerous key "${key}" in ${section}. This could indicate a prototype pollution attempt.`,
        );
      }
      if (section === "schema" && key.startsWith("$")) {
        throw new Error(
          `[Directive] Module "${module.id}" has schema key "${key}" starting with "$". Keys starting with $ are reserved for internal accessors ($store, $snapshot).`,
        );
      }
    }
  }
  if (isDevelopment) {
    if (Object.keys(module.crossModuleDeps ?? {}).length > 0) {
      console.warn(
        "[Directive] Single module mode ignores crossModuleDeps. Use multiple modules if cross-module access is needed: createSystem({ modules: { ... } })",
      );
    }
    for (const key in schema) {
      if (module.derive && Object.hasOwn(module.derive, key)) {
        console.warn(
          `[Directive] "${key}" exists as both a fact and a derivation. They are tracked separately and will not invalidate each other, but two things one name apart are hard to read — consider renaming one.`,
        );
      }
    }
  }
  const deriveDefs = defsOf(module.derive, "compute");
  const eventDefs = defsOf(module.events, "handler");
  // The event `tickMs` dispatches: the first module's with a `tick` event.
  // (`load_` marks the namespaced form; a quoted "tick_" would not be mangled.)
  const tickKey = module.load_
    ? module.tick_
    : "tick" in eventDefs
      ? "tick"
      : undefined;
  if (isDevelopment && tickMs && !tickKey) {
    console.warn(
      module.load_
        ? `[Directive] tickMs is set to ${tickMs}ms but no module defines a "tick" event handler.`
        : `[Directive] tickMs is set to ${tickMs}ms but module has no "tick" event handler.`,
    );
  }

  // 1.35 reports wall-clock times (a run's startedAt, a constraint's
  // lastActiveAt): a system's own real clock reads Date.now, as the timer
  // facts' default clock does (api/clock.ts).
  const kernel = createKernel(
    kernelOptions?.clock || kernelOptions?.parent
      ? kernelOptions
      : { ...kernelOptions, clock: createClock({ now: () => Date.now() }) },
  );
  const { graph, hooks, clock } = kernel;
  const features = kernel.features as {
    effects?: EffectsFeature;
    reconcile?: ReconcileFeature;
    validate?: (key: string, value: unknown) => void;
    plugins?: Tail;
    errors?: ErrorsFeature;
  };
  const tracker: Tracker = { deps: null };
  /**
   * After destroy the kernel's stream is gone, but as in 1.35 plugins and
   * observers still hear writes: records go straight to the plugins.
   */
  let tail: Tail | null = null;
  /**
   * True when a record of kind `at` has a reader now (P3): every emitter on
   * a hot path asks first, so a record (and its closure) nobody's hook
   * reads is never built.
   */
  const wants = (at: string) => (tail ? tail.wants_(at) : hooks.wants(at));
  /** One record on the kernel's stream, for plugins and observers alike. */
  const emit = (at: string, data?: Record<string, unknown>) =>
    tail
      ? tail.deliver_({ ...data, t: clock.now(), seq: 0, sys: kernel.id, at })
      : hooks.emit(at, data);

  let running = false;
  let initializing = false;
  let initialized = false;
  let destroyed = false;
  /** Set where the first completed pass ends (1.35 engine.ts:2201–2207). */
  let ready = false;
  let readyPromise: Promise<void> | null = null;
  let readyResolve: (() => void) | null = null;
  /** What `hydrate()` loaded, applied by the next initialize. */
  let hydrated: Record<string, unknown> | null = null;
  /** The pending `tickMs` timer on the kernel clock; 0 when none. */
  let tickTimer = 0;
  let scheduled = false;
  let reconciling = false;
  // 1.35's effect-chain cut: passes started only by writes made while
  // effects ran are an effect waking itself; after 100 the chain is cut.
  // Writes since the last pass: from an effect, or from elsewhere. The
  // effects phase stays open while the pass awaits its async effects, so a
  // write landing then (a caller's, while an effect awaits) counts as made
  // while effects ran, as in 1.35.
  let effectsOpen = false;
  let writtenByEffect = false;
  let writtenElsewhere = false;
  let chain = 0;
  /** 1.35 starts a chain over on start() and stop(). */
  const resetChain = () => {
    chain = 0;
    chainKeys = null;
    writtenByEffect = writtenElsewhere = false;
  };
  /** The keys the chain's previous pass started with; null outside a chain. */
  let chainKeys: Set<string> | null = null;
  /** In this system's settle: a follow-up pass waits for the next microtask. */
  let inSettle = false;
  let followUpQueued = false;
  /**
   * A part asked for a pass while one ran (a run ended, `enable()`), on a
   * lane other than `micro`. On `micro` the ask is 1.35's scheduleReconcile:
   * dropped if its microtask finds the pass still open.
   */
  let again = false;
  let changedKeys = new Set<string>();
  const settleListeners = new Set<() => void>();
  const notifySettle = () => settleListeners.forEach((fn) => fn());

  // --- derivations -------------------------------------------------------
  const derivations = new Map<string, Derivation>();
  const byNode = new Map<ReactiveNode, Derivation>();
  const listeners: Listeners = new Map();
  const pending = new Set<string>();
  /** Derivations named in declared deps (SystemContext.watch). */
  const watched = new Set<string>();
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
   * fact's subscriber in link order, depth first. A fact nothing in the graph
   * reads allocates nothing here.
   */
  function invalidate(keys: readonly string[]): void {
    holdDepth++;
    let seen: Set<ReactiveNode> | undefined;
    try {
      for (const key of keys) {
        for (let l = factNodes.get(key)?.subs; l; l = l.nextSub) {
          const stack = [l.target];
          seen ??= new Set();
          while (stack.length > 0) {
            const node = stack.pop()!;
            const d = byNode.get(node);
            if (!d || seen.has(node)) {
              continue;
            }
            seen.add(node);
            if (!d.live_ || d.stale_) {
              if (d.stale_ && watched.has(d.id_)) {
                // Still stale, so nothing below it moves, but a body that
                // named it in its deps hears every change upstream (1.35).
                changedKeys.add(DERIVATION_DEP_PREFIX + d.id_);
              }
              continue;
            }
            d.stale_ = true;
            // Dirty, not just checked: like 1.35, the next read runs this
            // derivation first and computes what it reads on demand.
            node.flags |= Flags.Dirty;
            if (wants("derivation.invalidate")) {
              emit("derivation.invalidate", { id: d.id_ });
            }
            pending.add(d.id_);
            // Wakes an effect that read this derivation (and maybe no fact).
            changedKeys.add(DERIVATION_DEP_PREFIX + d.id_);
            for (let s = node.subs; s; s = s.nextSub) {
              stack.push(s.target);
            }
            // As in 1.35, whoever asked whether it exists goes stale with it.
            for (let s = d.asked_?.subs; s; s = s.nextSub) {
              stack.push(s.target);
            }
          }
        }
      }
      // A watched derivation that stays stale is behind the frontier the
      // walk stops at, yet a body that named it hears every change to what
      // it reads, through any depth (1.35's closure). Only watched ones pay.
      if (watched.size > 0) {
        for (const id of watched) {
          const d = derivations.get(id);
          if (d?.stale_) {
            const reads = closureOf(d);
            if (keys.some((key) => reads.has(factNodes.get(key)!))) {
              changedKeys.add(DERIVATION_DEP_PREFIX + id);
            }
          }
        }
      }
    } finally {
      release();
    }
  }

  /**
   * The fact nodes a watched derivation reads, directly or through other
   * derivations. Kept until any derivation computes (only a compute moves
   * an edge).
   */
  let closures = new Map<string, Set<ReactiveNode>>();
  function closureOf(d: Derivation): Set<ReactiveNode> {
    let reads = closures.get(d.id_);
    if (!reads) {
      closures.set(d.id_, (reads = new Set()));
      const seen = new Set<ReactiveNode>();
      const stack: ReactiveNode[] = [d.node_];
      while (stack.length > 0) {
        for (let l = stack.pop()!.deps; l; l = l.nextDep) {
          const source = l.source;
          if (!seen.has(source)) {
            seen.add(source);
            byNode.has(source) ? stack.push(source) : reads.add(source);
          }
        }
      }
    }

    return reads;
  }
  function compute(d: Derivation): unknown {
    if (closures.size > 0) {
      closures = new Map();
    }
    try {
      const { value, deps } = withTracking(tracker, () =>
        deriveDefs[d.id_]!(facts, derive),
      );
      d.live_ = true;
      d.stale_ = false;
      d.deps_ = deps;
      if (wants("derivation.compute")) {
        emit("derivation.compute", {
          id: d.id_,
          value,
          deps: Array.from(deps, describeDep),
        });
      }

      return value;
    } catch (error) {
      d.live_ = true;
      // 1.35 keeps a throwing derivation stale: the next read runs it again,
      // which is also all "retry" asks. Marked first: "throw" leaves here.
      d.node_.flags |= Flags.Dirty;
      context.reportError("derivation", d.id_, error);
      throw error;
    }
  }
  /**
   * 1.35 keeps a derivation's state for the life of the system: its value and
   * the facts it reads stay put until it computes again. The graph releases a
   * computed that loses its last reader (it goes dirty and drops its own
   * edges), which for a derivation is wrong twice over: the next read runs it
   * again for nothing, and a write to a fact it reads no longer reaches it, so
   * its subscribers are never told. A reader loses a derivation by reading
   * something else (a branch) or by throwing before it gets there.
   *
   * So every derivation keeps one reader that never runs: the edge a read
   * would leave, without the read.
   */
  const keep = graph.computed(() => 0);
  for (const id in deriveDefs) {
    const d = {
      id_: id,
      stale_: true,
      live_: false,
      asked_: null,
    } as Derivation;
    const node = (d.node_ = graph.computed(() => compute(d), {
      equals: false,
    }));
    const link = new Link(node, keep, keep.deps, node.subsTail);
    keep.deps = link;
    node.subsTail ? (node.subsTail.nextSub = link) : (node.subs = link);
    node.subsTail = link;
    derivations.set(id, d);
    byNode.set(node, d);
  }
  function read(id: string): unknown {
    const d = derivations.get(id);
    if (!d) {
      throw new Error(`[Directive] Unknown derivation: ${id}`);
    }
    tracker.deps?.add(DERIVATION_DEP_PREFIX + id);
    if (d.node_.flags & Flags.Running) {
      // 1.35's text (derivations.ts:514–517), not the graph's.
      throw new Error(
        `[Directive] Circular dependency detected in derivation: ${id}`,
      );
    }

    return graph.read(d.node_);
  }
  const no = () => false;
  const derive = view(
    (id) => derivations.has(id),
    () => [...derivations.keys()],
    (id) => (BLOCKED_PROPS.has(id) ? undefined : read(id)),
    {
      ...LOCKED,
      set: no,
      deleteProperty: no,
      // As in 1.35, a membership test is a read that only follows its target:
      // the asker is tracked and goes stale with it, and the target is left
      // for whoever reads its value (a read would run it, and report its
      // throw, for a question about whether it exists).
      has: (_, id) => {
        const d = typeof id === "string" ? derivations.get(id) : undefined;
        if (!d) {
          return false;
        }
        tracker.deps?.add(DERIVATION_DEP_PREFIX + d.id_);
        graph.read((d.asked_ ??= graph.signal(0)));

        return true;
      },
      // As in 1.35, a derivation reads like a getter under reflection.
      getOwnPropertyDescriptor: (_, id) =>
        typeof id === "string" && derivations.has(id)
          ? { configurable: true, enumerable: true, get: () => read(id) }
          : undefined,
    },
  );

  // --- errors ------------------------------------------------------------
  // Each error reaches onError, then onErrorRecovery with its strategy:
  // skip, unless an error boundary part decides. Dev warns once per source
  // when nothing handles it.
  const warned = new Set<string>();
  function reportError(
    source: ErrorSource,
    sourceId: string,
    error: unknown,
    info?: unknown,
    satisfied = false,
  ): Strategy {
    const wrapped =
      error instanceof DirectiveError
        ? error
        : new DirectiveError(
            messageOf(error),
            source,
            sourceId,
            info,
            source !== "system",
          );
    if (wants("error")) {
      // The v1 record fields; the hook still gets only the error.
      emit("error", {
        error: wrapped,
        code: `E_${source.toUpperCase()}`,
        phase: source,
        nodeId: sourceId,
        cause: error,
      });
    }
    const warn = () => {
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
          // As 1.35: the first 1000 sources are remembered, then the oldest goes.
          if (warned.size > 1000) {
            warned.delete(warned.values().next().value!);
          }
          const type = (
            info as { requirement?: { type?: unknown } } | undefined
          )?.requirement?.type;
          const consequence =
            source === "resolver" && typeof type === "string" && !satisfied
              ? ` Requirement "${type}" stays unmet.`
              : "";
          console.warn(
            `[Directive] ${source} "${sourceId}" threw: ${messageOf(error).replace(/[.!?]+\s*$/, "")}.${consequence} The default error strategy skips it silently. Configure errorBoundary.${option} (or errorBoundary.onError) to handle it; this warning shows once per source and only in development.`,
          );
        }
      }
    };
    const decide = context.decide_;
    let strategy: Strategy = "skip";
    if (decide) {
      strategy = decide(source, sourceId, error, wrapped, info, warn);
    } else {
      warn();
    }
    emit("error.recovery", { error: wrapped, strategy });
    if (strategy === "throw") {
      // 1.35 throws before the caller's next line, so no source hook runs.
      throw wrapped;
    }

    return strategy;
  }

  // --- facts ---------------------------------------------------------------
  const factNodes = new Map<string, ReactiveNode>();
  /**
   * Open batch holds, innermost last: whether each was released yet. As in
   * 1.35 (engine.ts:631–697), a plugin writing from `onFactsBatch` opens a
   * batch inside its parent's announcement window; with one flag the nested
   * batch took the parent's release, and every derivation notification was
   * held from then on.
   */
  const holds: boolean[] = [];
  /** Release the innermost hold, once (from `onBatch`). */
  const releaseHold = () => {
    const top = holds.length - 1;
    if (top >= 0 && !holds[top]) {
      holds[top] = true;
      release();
    }
  };
  /**
   * One write's key list, reused so a write allocates none. Safe to reuse:
   * each loop over it reads its one key first, and a nested write that
   * refills it (a listener's batch) is done before the loop looks for a next
   * key, of which there is none. Refilled before each use.
   */
  const one = [""];
  /** Changed keys feed the next reconcile pass. */
  const changed = (keys: readonly string[]) => {
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
  const writers: Writers = { record: null };
  /** Where a write comes from: 1.35 files loaded facts as "hydrate". */
  let origin = "authored";
  const store = createFactsStore({
    schema,
    originOf: () => origin,
    graph,
    tracker,
    writers,
    nodes: factNodes,
    validator: isDevelopment
      ? (key, value) => features.validate?.(key, value)
      : undefined,
    onChange(key, value, prev, by) {
      holdDepth++;
      try {
        one[0] = key;
        invalidate(one);
        if (wants("fact.set")) {
          emit(
            "fact.set",
            by ? { key, value, prev, by } : { key, value, prev },
          );
        }
      } finally {
        release();
      }
      one[0] = key;
      changed(one);
    },
    onWrite(key) {
      one[0] = key;
      invalidate(one);
    },
    onBatchStart() {
      holdDepth++;
      holds.push(false);
    },
    onBatch(changes: FactChange[], by) {
      if (wants("fact.batch")) {
        emit("fact.batch", by ? { changes, by } : { changes });
      }
      const keys = changes.map((c) => c.key);
      invalidate(keys);
      releaseHold();
      changed(keys);
    },
    // Unwinds this batch's frame: the batch that wrote nothing (no
    // `onBatch`) and the one that threw still give their hold back.
    onBatchEnd() {
      if (holds.pop() === false) {
        release();
      }
    },
  });
  /** Non-JSON warnings already given, shared by every facts view. */
  const nonJson = new Set<string>();
  const facts = createFactsProxy(store, schema, tracker, nonJson);

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
    if (writtenElsewhere) {
      features.effects?.fresh_();
    }
    writtenByEffect = writtenElsewhere = false;
    if (chain > 100) {
      if (isDevelopment) {
        console.warn(
          `[Directive] Effects kept waking each other for 100 passes in a row, so the chain was stopped. An effect is dispatching an event (or writing through a captured system) that changes something an effect reads. Move that change into the event handler or resolver that causes it. Changed: ${[...changedKeys].slice(0, 5).join(", ")}`,
        );
      }
      // As in 1.35, drop what the chain carried: its derivation changes and
      // the keys its previous pass started with. A fact written for the first
      // time is someone else's write: it is kept, and its pass is not part of
      // a chain, so the chain does not start again.
      const kept: string[] = [];
      for (const key of changedKeys) {
        if (!key.startsWith(DERIVATION_DEP_PREFIX) && !chainKeys?.has(key)) {
          kept.push(key);
        }
      }
      changedKeys.clear();
      chain = 0;
      chainKeys = null;
      if (kept.length > 0) {
        for (const key of kept) {
          changedKeys.add(key);
        }
        writtenElsewhere = true;
        scheduleReconcile();
      }
      notifySettle();

      return;
    }
    reconciling = true;
    again = false;
    notifySettle();
    const passKeys = changedKeys;
    changedKeys = new Set();
    chainKeys = chain > 0 ? passKeys : null;
    const l2 = features.reconcile;
    l2?.begin_();
    try {
      if (wants("reconcile.start")) {
        emit("reconcile.start", { snapshot: facts.$snapshot() });
      }
      effectsOpen = true;
      try {
        const done = features.effects?.runEffectsFast(passKeys);
        if (done) {
          await done;
        }
      } finally {
        effectsOpen = false;
      }
      let result: Record<string, unknown> | undefined;
      if (l2) {
        // 1.35 awaits constraint evaluation only when it must; the diff,
        // the dispatch and the pass end then share one continuation.
        const asked = l2.evaluate_(passKeys);
        result = l2.commit_(
          asked instanceof Promise ? await asked : asked,
          passKeys,
        );
      }
      if (wants("reconcile.end")) {
        emit("reconcile.end", {
          result: result ?? {
            unmet: [],
            inflight: [],
            completed: [],
            canceled: [],
          },
        });
      }
      if (!ready) {
        ready = true;
        readyResolve?.();
        readyResolve = null;
      }
    } finally {
      reconciling = false;
      if (changedKeys.size > 0 || again || features.effects?.reruns_()) {
        scheduleReconcile();
      }
      notifySettle();
    }
  }

  // --- the system ----------------------------------------------------------
  const isSettled = () =>
    !scheduled && !reconciling && !features.reconcile?.busy_();
  const warnUnknown = (method: string, id: string) =>
    console.warn(`[Directive] ${method}: unknown key "${id}"`);
  /** A clock timer owned by this system; returns its canceller. */
  const after = (ms: number, fn: () => void) => {
    const id = clock.setTimeout(fn, ms, { owner: kernel.owner });

    return () => clock.clearTimeout(id);
  };
  // A stop in 1.35's two halves. `halt` ends the run (tick timer, running
  // flag, in-flight runs aborted); `stopped` runs the effect cleanups, onStop
  // and the stop event. stop() runs both at once; stopAsync() awaits between
  // them, so its cleanups run a microtask after the caller's next line.
  /** Ends the run; false when it was not running. */
  const halt = (): boolean => {
    if (tickTimer) {
      clock.clearTimeout(tickTimer);
      tickTimer = 0;
    }
    if (!running) {
      return false;
    }
    running = false;
    resetChain();
    features.errors?.stop_();
    features.reconcile?.stop_();

    return true;
  };
  const stopped = () => {
    features.effects?.cleanupAll();
    for (const hooks of hooks_) {
      hooks.onStop?.(system);
    }
    emit("system.stop", { system });
    // A settle() waiting on the runs just ended hears that they did.
    notifySettle();
  };
  /** 1.35's engine stopAsync: the sync half, one await, then the rest. */
  const stopEngineAsync = async () => {
    if (halt()) {
      // L5: the source unsubscribes are awaited here (1.35's cleanupAllAsync).
      await Promise.resolve();
      stopped();
    }
  };
  /** 1.35's engine destroyAsync: awaits its own stopAsync, then tears down. */
  const destroyEngineAsync = async () => {
    if (destroyed) {
      return;
    }
    await stopEngineAsync();
    system.destroy();
  };
  const system = {
    _mode: "single",
    facts,
    derive,
    // Locked like facts and derive (1.35 parity): no prototype-chain names,
    // no symbols, and no write, delete, redefine or re-parent.
    events: view(
      (name) => !BLOCKED_PROPS.has(name) && name in eventDefs,
      () => Object.keys(eventDefs),
      (name) => (payload?: Record<string, unknown>) =>
        system.dispatch({ type: name, ...payload }),
      { ...LOCKED, set: no, deleteProperty: no },
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
      return ready;
    },
    // The L9 slots, here so the system has 1.35's shape from L3 on: trace
    // reads null (no trace configured) and meta is the meta object.
    get trace() {
      return null;
    },
    meta: {},
    whenReady(): Promise<void> {
      return ready
        ? Promise.resolve()
        : running
          ? (readyPromise ??= new Promise<void>((resolve) => {
              readyResolve = resolve;
            }))
          : Promise.reject(
              new Error(
                "[Directive] whenReady() called before start(). Call system.start() first, then await system.whenReady().",
              ),
            );
    },
    async hydrate(loader: () => unknown) {
      if (running) {
        throw new Error(
          "[Directive] hydrate() must be called before start(). The system is already running.",
        );
      }
      const result = await loader();
      if (result && typeof result === "object") {
        hydrated = result as Record<string, unknown>;
      }
    },
    initialize() {
      if (initialized) {
        return;
      }
      initializing = true;
      // A namespaced system runs each module's init in its own batch (1.35).
      for (const init of (module as { inits_?: Fn[] }).inits_ ??
        (module.init ? [module.init] : [])) {
        store.batch(() => init(facts));
      }
      // 1.35 applies initialFacts, then hydrate's facts, after the inits
      // and before the first pass, in one batch.
      const initial = options.initialFacts as
        | Record<string, unknown>
        | undefined;
      if (initial || hydrated) {
        const set = (key: string, value: unknown) => {
          (facts as Record<string, unknown>)[key] = value;
        };
        // Filed as "hydrate", per write: loaded, not decided by this run.
        store.batch(() => {
          origin = "hydrate";
          try {
            if (initial) {
              load(initial, set);
            }
            if (hydrated) {
              load(hydrated, set, true);
              hydrated = null;
            }
          } finally {
            origin = "authored";
          }
        });
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
      resetChain();
      for (const hooks of hooks_) {
        hooks.onStart?.(system);
      }
      features.reconcile?.start_();
      emit("system.start", { system });
      features.errors?.start_();
      scheduleReconcile();
      if (tickKey && tickMs) {
        // 1.35's setInterval: a repeating timer on the kernel clock, owned by
        // the system so destroy() clears it. Re-armed before the dispatch, so
        // a throwing tick handler does not end the interval.
        const arm = () => {
          tickTimer = clock.setTimeout(
            () => {
              arm();
              system.dispatch({ type: tickKey });
            },
            tickMs,
            { owner: kernel.owner, kind: "tick" },
          );
        };
        arm();
      }
    },
    stop() {
      if (halt()) {
        stopped();
      }
    },
    /**
     * 1.35's async stop (RFC 0009): the system wrapper awaits the engine's,
     * so it resolves two microtasks after the cleanups run.
     */
    async stopAsync() {
      await stopEngineAsync();
    },
    /**
     * 1.35's async destroy (RFC 0009): stopAsync, then the engine's async
     * destroy (which awaits its own no-op stopAsync before tearing down).
     */
    async destroyAsync() {
      await system.stopAsync();
      await destroyEngineAsync();
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
        tail = plugins;
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
          const details: string[] = [];
          if (reconciling) {
            details.push("reconciliation in progress");
          }
          if (scheduled) {
            details.push("reconcile scheduled");
          }
          finish();
          reject(
            new Error(
              `[Directive] settle() timed out after ${maxWait}ms. ${(features.reconcile?.details_(details) ?? details).join("; ")}`,
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
  const context: SystemContext = {
    kernel,
    module,
    system,
    facts: facts as Facts<Schema>,
    store,
    derived: derive,
    tracker,
    reportError,
    schedule() {
      again = kernel.lane !== "micro";
      scheduleReconcile();
    },
    settled: notifySettle,
    watch: (id) => watched.add(id),
    writers,
    factsFor: (writer, allow) =>
      createFactsProxy(
        store,
        schema,
        tracker,
        nonJson,
        writer,
        allow,
      ) as Facts<Schema>,
    derivationDeps: (id) => derivations.get(id)?.deps_,
  };
  for (const part of parts) {
    part(context);
  }
  // After the plugins' onInit has begun, as in 1.35 (engine.ts:4906–4909).
  for (const hooks of hooks_) {
    hooks.onInit?.(system);
  }
  if (isDevelopment) {
    // 1.35's never-started warning (system.ts:1040–1056), on the kernel
    // clock. Unowned (owner 0), so destroy() leaves it to fire, as 1.35 does.
    const env = typeof process === "undefined" ? undefined : process.env;
    if (env === undefined || env.NODE_ENV !== "test") {
      clock.setTimeout(
        () => {
          if (!running && !initialized) {
            console.warn(
              "[Directive] System created but start() was never called. Constraints, resolvers, and effects will not run until you call system.start().",
            );
          }
        },
        0,
        { kind: "dev" },
      );
    }
  }

  return system as unknown as System<M>;
}
