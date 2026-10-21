/**
 * The kernel: what every layer and feature is written against (L0b).
 *
 * A {@link Kernel} bundles one reactive graph with the services it runs on:
 * a {@link Scheduler} (possibly shared), a {@link Clock} (real time by
 * default; pass `createVirtualClock()` for deterministic time), an optional
 * seeded {@link Rng}, one event stream ({@link Hooks}), settle and dispose
 * hooks, and a typed feature registry ({@link KernelFeatures},
 * {@link Kernel.define} / {@link Kernel.feature}). The graph's flushes go
 * through the scheduler on the kernel's lane (`micro` by default; `sync`
 * settles before the write returns).
 *
 * Opt-in pieces plug in through the registry and stay out of the default
 * bundle: `withPhases` (phases.ts: ordered phases and per-phase ctx),
 * `withSnapshot` (snapshot.ts), `createVirtualClock` and `createRng`
 * (clock.ts), `browserHosts` (scheduler.ts).
 *
 * A child kernel (`parent`) shares its parent's scheduler, clock and event
 * sink, gets its own graph and, when the parent has an rng, a child rng
 * forked purely from the parent's seed and the child's creation ordinal. It
 * is disposed with its parent.
 *
 * Nothing here is module-level state: two kernels share only what they are
 * given.
 *
 * @module
 */

import { type Clock, type Rng, createClock } from "./clock.js";
import { type Graph, type ReactiveNode, createGraph } from "./graph.js";
import type { Phases } from "./phases.js";
import {
  type Lane,
  type Scheduler,
  type SchedulerTarget,
  createScheduler,
} from "./scheduler.js";
import type { Snapshot } from "./snapshot.js";

/** Bumped when the kernel interface changes incompatibly. */
export const KERNEL_VERSION = 1;

/** Event kinds. Open: features add their own strings. */
export type EventKind = "flush" | "dispose" | (string & {});

/** One record on the event stream. */
export interface KernelEvent {
  /** Clock time when emitted. */
  t: number;
  /** Order on the sink, shared by a kernel tree. */
  seq: number;
  /** Id of the emitting kernel. */
  sys: number;
  /** What happened. */
  at: EventKind;
  [field: string]: unknown;
}

export type Listener = (event: KernelEvent) => void;

export interface Hooks {
  /** Emit a record. Fields in `data` are copied onto it. */
  emit(at: EventKind, data?: Record<string, unknown>): void;
  /**
   * Listen to every record on the sink. Returns an unsubscribe. Removed when
   * the kernel that added it is disposed.
   */
  on(fn: Listener): () => void;
  /**
   * True while anything listens on the sink: an emitter can skip building
   * an expensive record nobody reads.
   */
  readonly live: boolean;
}

/** The wire form of a record: `{...event, v: 1}` (`v` always wins). */
export function serializeEvent(event: KernelEvent): string {
  return JSON.stringify({ ...event, v: 1 });
}

/**
 * Typed feature members. A feature adds its member by merging into this
 * interface (`declare module` … `interface KernelFeatures { name: Api }`),
 * so {@link Kernel.feature} returns it typed.
 */
export interface KernelFeatures {
  /** Added by `withPhases`. */
  phases: Phases;
  /** Added by `withSnapshot`. */
  snapshot: Snapshot;
}

type FeatureOf<K extends string> = K extends keyof KernelFeatures
  ? KernelFeatures[K]
  : unknown;

export interface KernelOptions {
  /** Shared with every system it serves. Defaults to a new one. */
  scheduler?: Scheduler;
  /** Defaults to the parent's, else a real clock ({@link createClock}). */
  clock?: Clock;
  /** Defaults to a fork of the parent's rng, else none. */
  rng?: Rng;
  /** The lane graph effects flush on. Default `micro`. */
  lane?: Lane;
  /** Share scheduler, clock and event sink with this kernel. */
  parent?: Kernel;
  /** Graph write-loop limit, passed to {@link createGraph}. */
  maxRuns?: number;
}

export interface Kernel {
  /** Unique per scheduler: the registration index (tie-break rank). */
  readonly id: number;
  readonly version: number;
  readonly parent: Kernel | null;
  readonly children: readonly Kernel[];
  readonly graph: Graph;
  readonly scheduler: Scheduler;
  readonly clock: Clock;
  readonly rng: Rng | undefined;
  readonly lane: Lane;
  readonly hooks: Hooks;
  /** True once {@link dispose} ran. */
  readonly disposed: boolean;
  /** Feature members defined so far. */
  readonly features: Readonly<Record<string, unknown>>;
  /** Define a feature member. Throws if `member` is taken. */
  define<K extends string>(member: K, value: FeatureOf<K>): void;
  /** A defined feature member. Throws if it is not defined. */
  feature<K extends string>(member: K): FeatureOf<K>;
  /** True for a built-in capability or a defined member. */
  has(cap: string): boolean;
  /**
   * Run `fn` in every settle of this kernel, before the graph's effects run.
   * Graph writes made in `fn` are settled by that same graph flush. Returns
   * a remover.
   */
  onSettle(fn: (lane: Lane) => void): () => void;
  /** Run `fn` when this kernel is disposed. Returns a remover. */
  onDispose(fn: () => void): () => void;
  /**
   * Ask for a settle on `lane` (the kernel's lane when omitted). Asked during
   * a settle, it runs another one in the lane's next pass.
   */
  request(lane?: Lane): void;
  /** Flush this kernel now on `lane` (every lane when omitted). */
  flush(lane?: Lane): void;
  /**
   * Dispose children, run dispose hooks, clear this kernel's timers (its id
   * as owner), dispose its root effects, remove its listeners, leave the
   * scheduler and emit `dispose`. Idempotent. Afterwards writes never
   * schedule a flush, and request / flush do nothing.
   */
  dispose(): void;
}

/** Capabilities every kernel of this version has. */
const BUILTIN = ["graph", "scheduler", "clock", "hooks"];

interface Sink {
  seq: number;
  listeners: Listener[];
}

/** Hooks carry their sink build-privately, so a child can share it. */
type SinkHooks = Hooks & { sink_: Sink };
/** A kernel's child counter, build-private. */
type Internal = Kernel & { n_: number };

const remove = <T>(list: T[], item: T): void => {
  const i = list.indexOf(item);
  if (i >= 0) {
    list.splice(i, 1);
  }
};

const adder =
  <T>(list: T[]) =>
  (item: T): (() => void) => {
    list.push(item);

    return () => remove(list, item);
  };

/** Create a kernel. */
export function createKernel(options: KernelOptions = {}): Kernel {
  const parent = (options.parent ?? null) as Internal | null;
  const scheduler = options.scheduler ?? parent?.scheduler ?? createScheduler();
  const clock = options.clock ?? parent?.clock ?? createClock();
  const sink: Sink = parent
    ? (parent.hooks as SinkHooks).sink_
    : { seq: 0, listeners: [] };
  const lane = options.lane ?? parent?.lane ?? "micro";
  const ordinal = parent ? parent.n_++ : 0;
  const rng = options.rng ?? parent?.rng?.fork(ordinal);
  const settlers: Array<(lane: Lane) => void> = [];
  const disposers: Array<() => void> = [];
  const mine: Listener[] = [];
  const roots: ReactiveNode<any>[] = [];
  const children: Kernel[] = [];
  const features: Record<string, unknown> = Object.create(null);
  let disposed = false;
  /** In a settle: graph writes are covered by its closing graph flush. */
  let settling = false;

  const target: SchedulerTarget = {
    flush(l) {
      // The target marks "no error": user code can never throw it.
      let error: unknown = target;
      settling = true;
      try {
        hooks.emit("flush", { lane: l });
      } catch (e) {
        error = e;
      }
      for (const fn of settlers.slice()) {
        try {
          fn(l);
        } catch (e) {
          if (error === target) {
            error = e;
          }
        }
      }
      // L2: the pre-commit interceptor runs here, after the settlers and
      // before the graph's effects see the writes.
      settling = false;
      try {
        graph.flush();
      } catch (e) {
        if (error === target) {
          error = e;
        }
      }
      if (error !== target) {
        throw error;
      }
    },
  };
  const id = scheduler.register(target);
  const graph = createGraph({
    schedule: () => {
      if (!disposed && !settling) {
        scheduler.request(lane, target);
      }
    },
    maxRuns: options.maxRuns,
  });
  // Track root effects so dispose can stop them. Owned effects go with
  // their owner.
  const effect = graph.effect.bind(graph);
  graph.effect = ((fn, o) => {
    const node = effect(fn, o);
    if (!node.parent) {
      roots.push(node);
    }

    return node;
  }) as Graph["effect"];

  const hooks: SinkHooks = {
    sink_: sink,
    get live() {
      return sink.listeners.length > 0;
    },
    emit(at, data) {
      const seq = ++sink.seq;
      const listeners = sink.listeners;
      if (!listeners.length) {
        return;
      }
      const event: KernelEvent = {
        ...data,
        t: clock.now(),
        seq,
        sys: id,
        at,
      };
      let error: unknown = sink;
      for (const fn of listeners.slice()) {
        try {
          fn(event);
        } catch (e) {
          if (error === sink) {
            error = e;
          }
        }
      }
      if (error !== sink) {
        throw error;
      }
    },
    on(fn) {
      if (disposed) {
        return () => {};
      }
      sink.listeners.push(fn);
      mine.push(fn);

      return () => {
        remove(sink.listeners, fn);
        remove(mine, fn);
      };
    },
  };

  const kernel: Internal = {
    id,
    version: KERNEL_VERSION,
    parent,
    children,
    graph,
    scheduler,
    clock,
    rng,
    lane,
    hooks,
    get disposed() {
      return disposed;
    },
    features,
    n_: 0,
    define(member, value) {
      if (member in features || BUILTIN.includes(member)) {
        throw Error(`[Directive] Feature member "${member}" already defined`);
      }
      features[member] = value;
    },
    feature(member) {
      if (!(member in features)) {
        throw Error(`[Directive] Feature member "${member}" is not defined`);
      }

      return features[member] as never;
    },
    has: (cap) =>
      BUILTIN.includes(cap) || cap in features || (cap === "rng" && !!rng),
    onSettle: adder(settlers),
    onDispose: adder(disposers),
    request(l) {
      if (!disposed) {
        scheduler.request(l ?? lane, target);
      }
    },
    flush(l) {
      if (!disposed) {
        scheduler.flush(l, target);
      }
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      let error: unknown = target;
      const run = (fn: () => void): void => {
        try {
          fn();
        } catch (e) {
          if (error === target) {
            error = e;
          }
        }
      };
      for (const child of children.slice()) {
        run(() => child.dispose());
      }
      for (const fn of disposers.splice(0)) {
        run(fn);
      }
      clock.clearOwner(id);
      for (const node of roots.splice(0)) {
        run(() => graph.dispose(node));
      }
      scheduler.unregister(target);
      if (parent) {
        remove(parent.children as Kernel[], kernel);
      }
      run(() => hooks.emit("dispose"));
      for (const fn of mine.splice(0)) {
        remove(sink.listeners, fn);
      }
      if (error !== target) {
        throw error;
      }
    },
  };
  (parent?.children as Kernel[] | undefined)?.push(kernel);

  return kernel;
}
