/**
 * The reactive graph: the bottom layer (L0a) of the 2.0 engine.
 *
 * Three node kinds share one object shape: signals (facts), computeds
 * (derivations) and effects (watchers). Edges are {@link Link} objects that
 * sit in two intrusive lists at once: the target's dependency list and the
 * source's subscriber list. Links are reused across runs, so a node whose
 * dependencies do not change allocates nothing when it re-runs.
 *
 * Push-pull with version counters:
 * - A write bumps the signal's `version` and pushes marks downstream: direct
 *   subscribers get `DIRTY`, everything further down gets `CHECK` (maybe
 *   stale). Effects reached by the walk are queued.
 * - Reading a marked computed pulls: it walks its dependencies in the order
 *   they were read, brings each marked one up to date first, and recomputes
 *   only if some dependency's version differs from the version its link
 *   recorded. A computed whose value is unchanged (per its `equals`) keeps
 *   its version, so nothing below it re-runs.
 * - Effects flush after the write (or at the end of the outermost batch), each
 *   pulling the same way, so an effect never sees a half-updated graph.
 *
 * All state lives on a {@link Graph} instance. There is no module-level
 * mutable state: two graphs in one process cannot see each other.
 *
 * The walks that can go deep (marking, pulling, releasing) use explicit
 * stacks, not recursion. A computed's own function reading a computed that
 * was never computed still recurses through user code, so build very deep
 * chains bottom-up (read each level once) or expect the host's stack limit.
 *
 * @module
 */

/** Bit flags on {@link ReactiveNode.flags}. */
export const Flags = {
  /** Kind: a derivation. Signals have neither kind bit. */
  Computed: 1,
  /** Kind: an effect (watcher). */
  Effect: 2,
  /** A direct dependency changed: must recompute or re-run. */
  Dirty: 4,
  /** Something upstream changed: check dependency versions before use. */
  Check: 8,
  /** The node's function is running now. Reading it again is a cycle. */
  Running: 16,
  /** An effect that was disposed: never runs again. */
  Disposed: 32,
  /** Track dependencies on the first run only; later runs reuse the links. */
  Static: 64,
  /** The function has completed once, so `value` holds a result. */
  HasValue: 128,
  /**
   * Reserved for async or off-thread results (a derivation whose value is
   * not ready yet). The graph does not set or read it; later layers do.
   */
  Pending: 256,
  /** A computed whose function threw: `value` holds the error, reads rethrow it. */
  Errored: 512,
} as const;

const COMPUTED = 1;
const EFFECT = 2;
const DIRTY = 4;
const CHECK = 8;
const RUNNING = 16;
const DISPOSED = 32;
const STATIC = 64;
const HAS_VALUE = 128;
const ERRORED = 512;
const STALE = DIRTY | CHECK;

/** Per-node equality. Return true when the new value counts as unchanged. */
export type Equals<T> = (previous: T, next: T) => boolean;

/** Options for {@link Graph.signal} and {@link Graph.computed}. */
export interface NodeOptions<T> {
  /** Defaults to `Object.is`. `false` means every write or result is a change. */
  equals?: Equals<T> | false;
}

/** Options for {@link Graph.computed} and {@link Graph.effect}. */
export interface TrackOptions {
  /**
   * Track dependencies on the first successful run only. Later runs read
   * without tracking and keep the first run's links. Use it when the set of
   * dependencies can never change (Directive's explicit `deps`).
   */
  static?: boolean;
}

/** Options for {@link createGraph}. */
export interface GraphOptions {
  /**
   * Called instead of flushing synchronously when a write (outside a batch)
   * queues effects. Call `graph.flush()` from it, now or later. The default
   * flushes immediately.
   */
  schedule?: (graph: Graph) => void;
  /**
   * The most times one effect may run in a single flush before the flush
   * treats it as a write loop and throws. Default 100.
   */
  maxRuns?: number;
}

const never = () => false;

/** An edge: `target` read `source` and saw `source.version === version`. */
export class Link {
  /** Next dependency of `target`, in read order. */
  nextDep: Link | null = null;
  prevSub: Link | null = null;
  nextSub: Link | null = null;

  constructor(
    public source: ReactiveNode,
    public target: ReactiveNode,
    public version: number,
    /** The target's run id when this link was last read. */
    public seen: number,
  ) {}
}

/**
 * A signal, computed or effect. One class for all three keeps every node the
 * same shape. Fields are public for the layers built on top; treat them as
 * read-only outside this module.
 */
export class ReactiveNode<T = any> {
  /** Bumped each time `value` changes. */
  version = 0;
  /** First dependency, in read order. */
  deps: Link | null = null;
  /** During a run: the last dependency confirmed so far. */
  cursor: Link | null = null;
  subs: Link | null = null;
  subsTail: Link | null = null;
  /** Pull-walk position (see {@link Graph.refresh}). */
  check: Link | null = null;
  /** Id of the current or most recent run, for de-duplicating reads. */
  run = 0;
  /** The effect that created this effect, if any. */
  parent: ReactiveNode | null = null;
  /** Effects created while this effect ran: disposed before it re-runs. */
  children: ReactiveNode[] | null = null;
  cleanups: Array<() => void> | null = null;
  /** Runs in the current flush, for write-loop detection. */
  runs = 0;
  flushId = 0;

  constructor(
    /** Unique within its graph. */
    public readonly id: number,
    public flags: number,
    public value: T,
    public fn: ((previous: T) => T) | null,
    public equals: Equals<T>,
  ) {}
}

/**
 * One reactive graph. Each system owns one; nothing is shared between
 * instances.
 */
export class Graph {
  /** The node whose reads are being tracked, if any. */
  active: ReactiveNode | null = null;
  /** The effect currently running, which owns cleanups and child effects. */
  owner: ReactiveNode | null = null;
  private ids = 0;
  private seq = 0;
  private depth = 0;
  private flushing = false;
  private flushSeq = 0;
  private queue: ReactiveNode[] = [];
  /** Pull stack and its height, shared by nested pulls. */
  private ps: ReactiveNode[] = [];
  private psp = 0;
  /** Mark (push) and release work stacks. Neither walk calls user code. */
  private ms: Array<Link | null> = [];
  private rs: Link[] = [];
  private readonly sched: (graph: Graph) => void;
  private readonly maxRuns: number;

  constructor(options: GraphOptions = {}) {
    this.sched = options.schedule ?? ((g) => g.flush());
    this.maxRuns = options.maxRuns ?? 100;
  }

  /** A writable source node. */
  signal<T>(value: T, options?: NodeOptions<T>): ReactiveNode<T> {
    return new ReactiveNode(++this.ids, 0, value, null, eq(options));
  }

  /**
   * A derived node. `fn` receives its previous value (`undefined` before the
   * first run). Lazy: it runs on first read, then only when a dependency
   * changed. If `fn` throws, the node holds the error and every read rethrows
   * it until a dependency changes and it recomputes.
   */
  computed<T>(
    fn: (previous: T | undefined) => T,
    options?: NodeOptions<T> & TrackOptions,
  ): ReactiveNode<T> {
    return new ReactiveNode<T>(
      ++this.ids,
      COMPUTED | DIRTY | (options?.static ? STATIC : 0),
      undefined as T,
      fn as (previous: T) => T,
      eq(options),
    );
  }

  /**
   * A watcher. Runs `fn` now, then again after any dependency changes. `fn`
   * receives what it returned last time (prev-value capture). Register
   * teardown with {@link onCleanup}; it runs before the next run and on
   * dispose. Effects created inside `fn` are owned by this effect: disposed
   * before it re-runs, and never run ahead of it in a flush. If the first run
   * throws, the effect is disposed and the error rethrown.
   */
  effect<T>(
    fn: (previous: T | undefined) => T,
    options?: TrackOptions,
  ): ReactiveNode<T> {
    const node = new ReactiveNode<T>(
      ++this.ids,
      EFFECT | (options?.static ? STATIC : 0),
      undefined as T,
      fn as (previous: T) => T,
      never,
    );
    const owner = this.owner;
    if (owner) {
      node.parent = owner;
      (owner.children ??= []).push(node);
    }
    try {
      this.exec(node);
    } catch (e) {
      this.dispose(node);
      throw e;
    }

    return node;
  }

  /** Read a node's current value, tracking it if a node is running. */
  read<T>(node: ReactiveNode<T>): T {
    const flags = node.flags;
    if (flags & STALE) {
      this.refresh(node);
    } else if (flags & RUNNING) {
      throw cycle();
    }
    if (this.active) {
      this.track(node);
    }
    if (node.flags & ERRORED) {
      throw node.value;
    }

    return node.value;
  }

  /** Write a signal. No-op when `equals` says the value is unchanged. */
  write<T>(node: ReactiveNode<T>, value: T): void {
    if (node.equals(node.value, value)) {
      return;
    }
    node.value = value;
    node.version++;
    if (node.subs) {
      this.mark(node.subs);
      if (!this.depth && !this.flushing && this.queue.length) {
        this.sched(this);
      }
    }
  }

  /** Run `fn` with effects held until the outermost batch ends. */
  batch<R>(fn: () => R): R {
    this.depth++;
    try {
      return fn();
    } finally {
      if (!--this.depth && !this.flushing && this.queue.length) {
        this.sched(this);
      }
    }
  }

  /** Run `fn` without tracking what it reads. */
  untracked<R>(fn: () => R): R {
    const prev = this.active;
    this.active = null;
    try {
      return fn();
    } finally {
      this.active = prev;
    }
  }

  /** Register teardown for the running effect. Ignored outside an effect. */
  onCleanup(fn: () => void): void {
    const owner = this.owner;
    if (owner) {
      (owner.cleanups ??= []).push(fn);
    }
  }

  /**
   * Release a node's dependencies. An effect is also cleaned up and never
   * runs again. A computed recomputes (and re-subscribes) if read again.
   * Computeds that lose their last subscriber this way release theirs too.
   */
  dispose(node: ReactiveNode): void {
    if (node.flags & EFFECT) {
      node.flags |= DISPOSED;
      this.teardown(node);
    } else {
      node.flags |= DIRTY;
    }
    const deps = node.deps;
    node.deps = node.cursor = null;
    this.release(deps);
  }

  /**
   * Run every queued effect that is stale. Effects queued while flushing run
   * in the same flush. Errors from effects are collected; the first is
   * rethrown after the queue drains.
   */
  flush(): void {
    if (this.flushing) {
      return;
    }
    this.flushing = true;
    const queue = this.queue;
    const id = ++this.flushSeq;
    let failed = false;
    let error: unknown;
    let i = 0;
    try {
      // The try sits outside the loop; an error resumes at the next effect.
      while (i < queue.length) {
        try {
          for (; i < queue.length; i++) {
            const node = queue[i]!;
            if (node.flags & DISPOSED || !(node.flags & STALE)) {
              continue;
            }
            if (node.flushId !== id) {
              node.flushId = id;
              node.runs = 0;
            }
            if (++node.runs > this.maxRuns) {
              node.flags &= ~STALE;
              throw cycle();
            }
            // An owner runs before the effects it owns; re-running it may
            // dispose this one.
            if (node.parent) {
              let stale: ReactiveNode | null = null;
              for (let p: ReactiveNode | null = node.parent; p; p = p.parent) {
                if (p.flags & STALE) {
                  stale = p;
                }
              }
              if (stale) {
                this.refresh(stale);
              }
              if (!(node.flags & STALE) || node.flags & DISPOSED) {
                continue;
              }
            }
            this.refresh(node);
          }
        } catch (e) {
          if (!failed) {
            failed = true;
            error = e;
          }
          i++;
        }
      }
    } finally {
      queue.length = 0;
      this.flushing = false;
    }
    if (failed) {
      throw error;
    }
  }

  /** Record that the active node read `dep`, reusing a link when possible. */
  private track(dep: ReactiveNode): void {
    const sub = this.active!;
    const prev = sub.cursor;
    if (prev && prev.source === dep) {
      return;
    }
    const next = prev ? prev.nextDep : sub.deps;
    if (next && next.source === dep) {
      next.version = dep.version;
      next.seen = sub.run;
      sub.cursor = next;

      return;
    }
    // Already read earlier in this run (A, B, A): one link is enough.
    const tail = dep.subsTail;
    if (tail && tail.target === sub && tail.seen === sub.run) {
      return;
    }
    const link = new Link(dep, sub, dep.version, sub.run);
    link.nextDep = next;
    if (prev) {
      prev.nextDep = link;
    } else {
      sub.deps = link;
    }
    sub.cursor = link;
    link.prevSub = tail;
    if (tail) {
      tail.nextSub = link;
    } else {
      dep.subs = link;
    }
    dep.subsTail = link;
  }

  /**
   * Push marks from a changed signal's subscriber list: `DIRTY` on direct
   * subscribers, `CHECK` below them. Queues every effect reached.
   */
  private mark(start: Link): void {
    const stack = this.ms;
    let sp = 0;
    let link: Link | null = start;
    let flag = DIRTY;
    for (;;) {
      while (link) {
        const target: ReactiveNode = link.target;
        const flags = target.flags;
        if (!(flags & STALE)) {
          target.flags = flags | flag;
          if (flags & EFFECT) {
            this.queue.push(target);
          } else if (target.subs) {
            stack[sp++] = link.nextSub;
            link = target.subs;
            flag = CHECK;
            continue;
          }
        } else if (flag === DIRTY) {
          target.flags = flags | DIRTY;
        }
        link = link.nextSub;
      }
      if (!sp) {
        break;
      }
      link = stack[--sp]!;
      flag = sp ? CHECK : DIRTY;
    }
  }

  /**
   * Pull: bring a stale computed or effect up to date. Walks dependencies in
   * read order with an explicit stack; recomputes a node only once one of its
   * dependencies has a version its link did not record.
   */
  private refresh(node: ReactiveNode): void {
    if (node.flags & DIRTY) {
      this.exec(node);

      return;
    }
    const stack = this.ps;
    const base = this.psp;
    let sp = base;
    stack[sp++] = node;
    node.check = node.deps;
    try {
      while (sp > base) {
        const top = stack[sp - 1]!;
        if (top.flags & DIRTY) {
          this.psp = sp;
          this.exec(top);
          sp--;
          continue;
        }
        const link = top.check;
        if (!link) {
          top.flags &= ~CHECK;
          sp--;
          continue;
        }
        const dep = link.source;
        // A dependency still running is up the call stack: its result
        // depends on this pull, which depends on it.
        if (dep.flags & RUNNING) {
          throw cycle();
        }
        if (dep.flags & STALE) {
          stack[sp++] = dep;
          dep.check = dep.deps;
        } else if (dep.version !== link.version) {
          top.flags |= DIRTY;
        } else {
          top.check = link.nextDep;
        }
      }
    } finally {
      this.psp = base;
    }
  }

  /** Run a computed or effect's function. */
  private exec(node: ReactiveNode): void {
    if (node.flags & EFFECT) {
      this.runEffect(node);
    } else {
      this.compute(node);
    }
  }

  /**
   * Recompute a derivation. Bumps its version only when the result differs
   * (per `equals`); a thrown error is stored as the result.
   */
  private compute(node: ReactiveNode): void {
    const flags = node.flags;
    if (flags & RUNNING) {
      throw cycle();
    }
    const prev = this.active;
    const retrack = this.begin(node, flags);
    let value: any;
    let failed = false;
    try {
      value = node.fn!(node.value);
    } catch (e) {
      value = e;
      failed = true;
    }
    this.end(node, retrack, prev);
    if (
      failed ||
      !(flags & HAS_VALUE) ||
      flags & ERRORED ||
      !node.equals(node.value, value)
    ) {
      node.value = value;
      node.version++;
      node.flags = failed
        ? node.flags | HAS_VALUE | ERRORED
        : (node.flags | HAS_VALUE) & ~ERRORED;
    }
  }

  /**
   * Run an effect. It runs as a batch: what it writes is flushed after it
   * returns, never inside it.
   */
  private runEffect(node: ReactiveNode): void {
    const flags = node.flags;
    if (flags & RUNNING) {
      throw cycle();
    }
    if (node.children || node.cleanups) {
      this.teardown(node);
    }
    const prevOwner = this.owner;
    this.owner = node;
    this.depth++;
    const prev = this.active;
    const retrack = this.begin(node, flags);
    try {
      node.value = node.fn!(node.value);
      node.flags |= HAS_VALUE;
    } finally {
      this.owner = prevOwner;
      this.end(node, retrack, prev);
      if (!--this.depth && !this.flushing && this.queue.length) {
        this.sched(this);
      }
    }
  }

  /** Start a run: clear stale marks, open tracking. Returns whether it tracks. */
  private begin(node: ReactiveNode, flags: number): boolean {
    const retrack = !(
      flags & STATIC &&
      flags & HAS_VALUE &&
      !(flags & ERRORED)
    );
    node.flags = (flags & ~STALE) | RUNNING;
    node.cursor = null;
    node.run = ++this.seq;
    this.active = retrack ? node : null;

    return retrack;
  }

  /** Finish a run: restore the reader, drop dependencies this run skipped. */
  private end(
    node: ReactiveNode,
    retrack: boolean,
    prev: ReactiveNode | null,
  ): void {
    this.active = prev;
    node.flags &= ~RUNNING;
    if (retrack) {
      const cursor = node.cursor;
      const stale = cursor ? cursor.nextDep : node.deps;
      if (stale) {
        if (cursor) {
          cursor.nextDep = null;
        } else {
          node.deps = null;
        }
        this.release(stale);
      }
    } else {
      for (let l = node.deps; l; l = l.nextDep) {
        l.version = l.source.version;
      }
    }
  }

  /**
   * Unsubscribe `link` and every dependency after it. A computed left with
   * no subscribers releases its own dependencies and goes dirty.
   */
  private release(link: Link | null): void {
    const stack = this.rs;
    let sp = 0;
    for (;;) {
      while (link) {
        const dep = link.source;
        const { prevSub, nextSub } = link;
        if (prevSub) {
          prevSub.nextSub = nextSub;
        } else {
          dep.subs = nextSub;
        }
        if (nextSub) {
          nextSub.prevSub = prevSub;
        } else {
          dep.subsTail = prevSub;
        }
        if (!dep.subs && dep.flags & COMPUTED && dep.deps) {
          dep.flags |= DIRTY;
          stack[sp++] = dep.deps;
          dep.deps = null;
        }
        link = link.nextDep;
      }
      if (!sp) {
        break;
      }
      link = stack[--sp]!;
    }
  }

  /** Dispose an effect's children and run its cleanups, untracked. */
  private teardown(node: ReactiveNode): void {
    const children = node.children;
    const cleanups = node.cleanups;
    if (!children?.length && !cleanups?.length) {
      return;
    }
    const prev = this.active;
    this.active = null;
    try {
      if (children) {
        for (let i = children.length - 1; i >= 0; i--) {
          this.dispose(children[i]!);
        }
        children.length = 0;
      }
      if (cleanups) {
        for (let i = cleanups.length - 1; i >= 0; i--) {
          cleanups[i]!();
        }
        cleanups.length = 0;
      }
    } finally {
      this.active = prev;
    }
  }
}

function eq<T>(options?: NodeOptions<T>): Equals<T> {
  const equals = options?.equals;

  return equals === false ? never : (equals ?? Object.is);
}

function cycle(): Error {
  return new Error("[Directive] Cycle detected in the reactive graph");
}

/** Create an isolated reactive graph. */
export function createGraph(options?: GraphOptions): Graph {
  return new Graph(options);
}
