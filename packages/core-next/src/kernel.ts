/**
 * The kernel: what every layer and feature is written against (L0b).
 *
 * A {@link Kernel} bundles one reactive graph with the services it runs on:
 * a {@link Scheduler} (possibly shared), a {@link Clock}, a seeded
 * {@link Rng}, one event stream ({@link Hooks}), per-phase context
 * extenders, snapshot contributors and an open feature registry
 * ({@link Kernel.define} / {@link Kernel.has}). The graph's flushes go
 * through the scheduler on the kernel's lane (`micro` by default; `sync`
 * settles before the write returns).
 *
 * A child kernel (`parent`) shares its parent's scheduler, clock and event
 * sink, gets its own graph, and is disposed with its parent.
 *
 * Nothing here is module-level state: two kernels share only what they are
 * given.
 *
 * @module
 */

import {
  type Clock,
  type Rng,
  createRng,
  createVirtualClock,
} from "./clock.js";
import { type Graph, createGraph } from "./graph.js";
import {
  type Lane,
  PHASES,
  type Phase,
  type Scheduler,
  type SchedulerTarget,
  createScheduler,
} from "./scheduler.js";

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
  /** Listen to every record on the sink. Returns an unsubscribe. */
  on(fn: Listener): () => void;
}

/** The wire form of a record: `{v: 1, ...event}`. */
export function serializeEvent(event: KernelEvent): string {
  return JSON.stringify({ v: 1, ...event });
}

/** A part of a snapshot, contributed by a layer or feature. */
export interface SnapshotPart<T = unknown> {
  dump(): T;
  load(data: T): void;
}

/** Context object built for user functions in one phase. */
export type Ctx = Record<string, unknown>;

export interface KernelOptions {
  /** Shared with every system it serves. Defaults to a new one. */
  scheduler?: Scheduler;
  /** Defaults to a virtual clock at 0 (deterministic). */
  clock?: Clock;
  /** A generator or a seed. Defaults to a seed derived from the id. */
  rng?: Rng | number;
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
  readonly children: Kernel[];
  readonly graph: Graph;
  readonly scheduler: Scheduler;
  readonly clock: Clock;
  readonly rng: Rng;
  readonly lane: Lane;
  readonly hooks: Hooks;
  readonly ctx: {
    /** Add members to the ctx of `phase`. Returns a remover. */
    extend(phase: Phase, fn: (ctx: Ctx) => void): () => void;
    /** Build a ctx for `phase`: `base` with every extender applied in order. */
    make<T extends Ctx>(phase: Phase, base: T): T;
  };
  readonly snapshot: {
    /** Register a part under a unique id. */
    contribute<T>(id: string, part: SnapshotPart<T>): void;
    /** Every part's data, by id, in contribution order. */
    dump(): Record<string, unknown>;
    /** Load the parts present in `data`. */
    load(data: Record<string, unknown>): void;
  };
  /** Feature members defined so far. */
  readonly features: Readonly<Record<string, unknown>>;
  /** Define a feature member. Throws if `member` is taken. */
  define(member: string, value: unknown): void;
  /** True for a built-in capability or a defined member. */
  has(cap: string): boolean;
  /** Run `fn` in `phase` each time this kernel flushes. */
  phase(phase: Phase, fn: (lane: Lane) => void): () => void;
  /** Flush this kernel now on `lane` (every lane when omitted). */
  flush(lane?: Lane): void;
  /** Dispose children, leave the scheduler, emit `dispose`. Idempotent. */
  dispose(): void;
}

/** Capabilities every kernel of this version has. */
const BUILTIN = [
  "graph",
  "scheduler",
  "clock",
  "rng",
  "hooks",
  "ctx",
  "snapshot",
  "phases",
];

interface Sink {
  seq: number;
  listeners: Listener[];
}

/** Hooks carry their sink build-privately, so a child can share it. */
type SinkHooks = Hooks & { sink_: Sink };

/** Create a kernel. */
export function createKernel(options: KernelOptions = {}): Kernel {
  const parent = options.parent ?? null;
  const scheduler = options.scheduler ?? parent?.scheduler ?? createScheduler();
  const clock = options.clock ?? parent?.clock ?? createVirtualClock();
  const sink: Sink = parent
    ? (parent.hooks as SinkHooks).sink_
    : { seq: 0, listeners: [] };
  const lane = options.lane ?? parent?.lane ?? "micro";
  const target: SchedulerTarget = {
    flush: (l) => {
      hooks.emit("flush", { lane: l });
      graph.flush();
    },
  };
  const id = scheduler.register(target);
  const seed = options.rng;
  const rng =
    typeof seed === "function"
      ? seed
      : createRng(
          seed ??
            (parent
              ? (parent.rng() * 4294967296) | 0
              : Math.imul(id + 1, 0x9e3779b1)),
        );
  const graph = createGraph({
    schedule: () => scheduler.request(lane, target),
    maxRuns: options.maxRuns,
  });

  const hooks: SinkHooks = {
    sink_: sink,
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
      sink.listeners.push(fn);

      return () => {
        const i = sink.listeners.indexOf(fn);
        if (i >= 0) {
          sink.listeners.splice(i, 1);
        }
      };
    },
  };

  const extenders: Array<Array<(ctx: Ctx) => void>> = [];
  const parts = new Map<string, SnapshotPart<any>>();
  const features: Record<string, unknown> = Object.create(null);
  let disposed = false;

  const kernel: Kernel = {
    id,
    version: KERNEL_VERSION,
    parent,
    children: [],
    graph,
    scheduler,
    clock,
    rng,
    lane,
    hooks,
    ctx: {
      extend(phase, fn) {
        const list = (extenders[phaseIndex(phase)] ??= []);
        list.push(fn);

        return () => {
          const i = list.indexOf(fn);
          if (i >= 0) {
            list.splice(i, 1);
          }
        };
      },
      make(phase, base) {
        for (const fn of extenders[phaseIndex(phase)] ?? []) {
          fn(base);
        }

        return base;
      },
    },
    snapshot: {
      contribute(key, part) {
        if (parts.has(key)) {
          throw Error(`[Directive] Snapshot part "${key}" already exists`);
        }
        parts.set(key, part);
      },
      dump() {
        const out: Record<string, unknown> = {};
        for (const [key, part] of parts) {
          out[key] = part.dump();
        }

        return out;
      },
      load(data) {
        for (const [key, part] of parts) {
          if (key in data) {
            part.load(data[key]);
          }
        }
      },
    },
    features,
    define(member, value) {
      if (member in features || BUILTIN.includes(member)) {
        throw Error(`[Directive] Feature member "${member}" already defined`);
      }
      features[member] = value;
    },
    has: (cap) => BUILTIN.includes(cap) || cap in features,
    phase: (phase, fn) => scheduler.phase(phase, target, fn),
    flush: (l) => scheduler.flush(l, target),
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const child of kernel.children.splice(0)) {
        child.dispose();
      }
      scheduler.unregister(target);
      if (parent) {
        const siblings = parent.children;
        const i = siblings.indexOf(kernel);
        if (i >= 0) {
          siblings.splice(i, 1);
        }
      }
      hooks.emit("dispose");
    },
  };
  kernel.snapshot.contribute("rng", {
    dump: () => rng.state,
    load: (state: number) => {
      rng.state = state;
    },
  });
  parent?.children.push(kernel);

  return kernel;
}

function phaseIndex(phase: Phase): number {
  const i = PHASES.indexOf(phase);
  if (i < 0) {
    throw Error(`[Directive] Unknown phase "${phase}"`);
  }

  return i;
}
