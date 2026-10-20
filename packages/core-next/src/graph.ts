/**
 * The reactive graph: the bottom layer (L0a) of the 2.0 engine.
 *
 * Three node kinds share one object shape: signals (facts), computeds
 * (derivations) and effects (watchers). Edges are {@link Link} objects that
 * sit in two intrusive lists at once: the target's dependency list and the
 * source's subscriber list. Links are reused across runs, so a node whose
 * dependencies do not change allocates nothing when it re-runs.
 *
 * Push-pull with marks:
 * - A write bumps the signal's `version` and pushes marks downstream: direct
 *   subscribers get `DIRTY`, everything further down gets `CHECK` (maybe
 *   stale). Effects reached by the walk are queued.
 * - Reading a marked computed pulls: it walks its dependencies in the order
 *   they were read and brings each marked one up to date first. A computed
 *   that recomputes to a new value marks its `CHECK` subscribers `DIRTY` on
 *   the spot, so the walk never compares versions: a `CHECK` node whose
 *   dependencies all came back clean is clean. A computed whose value is
 *   unchanged (per its `equals`) marks nothing, so nothing below it re-runs.
 *
 * Invariant the walk relies on: a stale node's subscribers are stale too, and
 * a node one of whose dependencies changed since it last ran is `DIRTY`.
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
  /** Something upstream changed: pull stale dependencies before use. */
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

// The same bits as numeric literals for the hot paths: a const enum is
// inlined at every use, where a module-level const is a variable load.
// biome-ignore lint/suspicious/noConstEnum: internal, never exported.
const enum F {
  Computed = 1,
  Effect = 2,
  Dirty = 4,
  Check = 8,
  Running = 16,
  Disposed = 32,
  Static = 64,
  HasValue = 128,
  Errored = 512,
  Stale = Dirty | Check,
}

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

/** An edge: `target` read `source`. */
export class Link {
  declare source: ReactiveNode;
  declare target: ReactiveNode;
  /** Next dependency of `target`, in read order. */
  declare nextDep: Link | null;
  declare prevSub: Link | null;
  nextSub: Link | null = null;

  constructor(
    source: ReactiveNode,
    target: ReactiveNode,
    nextDep: Link | null,
    prevSub: Link | null,
  ) {
    this.source = source;
    this.target = target;
    this.nextDep = nextDep;
    this.prevSub = prevSub;
  }
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
  /**
   * During a run: the last dependency confirmed so far. During a pull walk
   * (never at the same time): the next dependency to check.
   */
  cursor: Link | null = null;
  subs: Link | null = null;
  subsTail: Link | null = null;
  /** Id of the current or most recent run, for de-duplicating reads. */
  run = 0;
  /**
   * Run id of the last node that tracked this one. Run ids only grow, so a
   * stamp below a running node's id proves that run has not read this node.
   */
  stamp = 0;
  /** The effect that created this effect, if any. */
  parent: ReactiveNode | null = null;
  /** Effects created while this effect ran: disposed before it re-runs. */
  children: ReactiveNode[] | null = null;
  cleanups: Array<() => void> | null = null;
  /** Runs in the current flush, for write-loop detection. */
  runs = 0;

  /** Unique within its graph. */
  declare readonly id: number;
  declare flags: number;
  declare value: T;
  declare fn: ((previous: T) => T) | null;
  declare equals: Equals<T>;

  constructor(
    id: number,
    flags: number,
    value: T,
    fn: ((previous: T) => T) | null,
    equals: Equals<T>,
  ) {
    this.id = id;
    this.flags = flags;
    this.value = value;
    this.fn = fn;
    this.equals = equals;
  }
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
  /** Node ids and run ids share one counter: both only need to grow. */
  private seq = 0;
  private depth = 0;
  private busy = false;
  /** Effects to run, and how many: slots past `qn` are stale. */
  private queue: Array<ReactiveNode | null> = [];
  private qn = 0;
  /** Pull stack and its height, shared by nested pulls. */
  private ps: ReactiveNode[] = [];
  private psp = 0;
  /**
   * Work stack shared by the mark (push) and release walks. Neither calls
   * user code or the other, so they never overlap.
   */
  private ms: Array<Link | null> = [];
  private readonly sched: ((graph: Graph) => void) | undefined;
  private readonly max: number;

  constructor(options: GraphOptions = {}) {
    this.sched = options.schedule;
    this.max = options.maxRuns ?? 100;
  }

  /** A writable source node. */
  signal<T>(value: T, options?: NodeOptions<T>): ReactiveNode<T> {
    return new ReactiveNode(++this.seq, 0, value, null, eq(options));
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
      ++this.seq,
      F.Computed | F.Dirty | (options?.static ? F.Static : 0),
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
      ++this.seq,
      F.Effect | (options?.static ? F.Static : 0),
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

  /**
   * Read a node's current value, tracking it if a node is running. The node
   * must belong to this graph: reading another graph's node is unsupported
   * (it is neither tracked correctly nor kept up to date).
   */
  read<T>(node: ReactiveNode<T>): T {
    const flags = node.flags;
    if (flags & F.Dirty) {
      this.exec(node);
    } else if (flags & F.Check) {
      this.pull(node);
    } else if (flags & F.Running) {
      throw cycle();
    }
    if (this.active) {
      this.track(node);
    }
    if (node.flags & F.Errored) {
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
    this.touch(node);
  }

  /**
   * Report a change to a signal without replacing its value, for a value
   * mutated in place. Bumps the version and notifies subscribers exactly as
   * {@link write} does, skipping the `equals` check.
   */
  touch(node: ReactiveNode): void {
    node.version++;
    if (node.subs) {
      this.mark(node);
      this.kick();
    }
  }

  /** Run `fn` with effects held until the outermost batch ends. */
  batch<R>(fn: () => R): R {
    this.depth++;
    try {
      return fn();
    } finally {
      this.depth--;
      this.kick();
    }
  }

  /** Flush (or schedule a flush) if effects wait and nothing holds them. */
  private kick(): void {
    if (!this.depth && !this.busy && this.qn) {
      this.sched ? this.sched(this) : this.flush();
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
    if (node.flags & F.Effect) {
      node.flags |= F.Disposed;
      this.clean(node);
    } else {
      node.flags |= F.Dirty;
    }
    const deps = node.deps;
    node.deps = node.cursor = null;
    this.drop(deps);
  }

  /**
   * Run every queued effect that is stale. Effects queued while flushing run
   * in the same flush. Errors from effects are collected; the first is
   * rethrown after the queue drains.
   */
  flush(): void {
    if (this.busy) {
      return;
    }
    this.busy = true;
    const queue = this.queue;
    let failed = false;
    let error: unknown;
    try {
      for (let i = 0; i < this.qn; i++) {
        const node = queue[i]!;
        try {
          if (!live(node)) {
            continue;
          }
          if (++node.runs > this.max) {
            node.flags &= ~F.Stale;
            throw cycle();
          }
          // Owners run before the effects they own, outermost first. Each
          // owner is brought up to date in turn (a CHECK owner whose inputs
          // did not change does not re-run, but one below it may); a re-run
          // may dispose this effect or bring it up to date.
          if (this.owners(node, node.parent)) {
            this.pull(node);
          }
        } catch (e) {
          // Keep the first error; the next effect still runs.
          if (!failed) {
            failed = true;
            error = e;
          }
        }
      }
    } finally {
      // Every effect that ran this flush is in the queue: reset its count.
      for (let j = 0; j < this.qn; j++) {
        queue[j]!.runs = 0;
        queue[j] = null;
      }
      this.qn = 0;
      this.busy = false;
    }
    if (failed) {
      throw error;
    }
  }

  /**
   * Refresh `node`'s stale owners from the outermost down (`p` starts at its
   * parent). Returns false once `node` is disposed or no longer stale, so the
   * caller skips it. Owner chains are as deep as effect nesting in user code.
   */
  private owners(node: ReactiveNode, p: ReactiveNode | null): boolean {
    if (!p) {
      return true;
    }
    if (!this.owners(node, p.parent)) {
      return false;
    }
    if (live(p)) {
      this.pull(p);

      return live(node);
    }

    return true;
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
      sub.cursor = next;
      dep.stamp = sub.run;

      return;
    }
    // A node disposed during its own run tracks nothing more: dispose freed
    // its links and nothing would free new ones.
    if (sub.flags & F.Disposed) {
      return;
    }
    // Read earlier in this run (A, B, A or A, C(reads A), A): one link is
    // enough. Only scan when something read `dep` during this run.
    if (prev && dep.stamp >= sub.run) {
      for (let l = sub.deps!; ; l = l.nextDep!) {
        if (l.source === dep) {
          return;
        }
        if (l === prev) {
          break;
        }
      }
    }
    dep.stamp = sub.run;
    const tail = dep.subsTail;
    const link = new Link(dep, sub, next, tail);
    if (prev) {
      prev.nextDep = link;
    } else {
      sub.deps = link;
    }
    sub.cursor = link;
    if (tail) {
      tail.nextSub = link;
    } else {
      dep.subs = link;
    }
    dep.subsTail = link;
  }

  /**
   * Push marks from a changed signal: `DIRTY` on its direct subscribers,
   * `CHECK` below them. Queues every effect reached. Only a node with more
   * subscribers to visit is stacked, so a chain walks without the stack.
   */
  private mark(source: ReactiveNode): void {
    const stack = this.ms;
    let sp = 0;
    let link: Link | null = source.subs;
    for (;;) {
      while (link) {
        const target: ReactiveNode = link.target;
        const flags = target.flags;
        const next: Link | null = link.nextSub;
        const direct = link.source === source;
        if (!(flags & F.Stale)) {
          target.flags = flags | (direct ? F.Dirty : F.Check);
          if (flags & F.Effect) {
            this.queue[this.qn++] = target;
          } else if (target.subs) {
            if (next) {
              stack[sp++] = next;
            }
            link = target.subs;
            continue;
          }
        } else if (direct) {
          target.flags = flags | F.Dirty;
        }
        link = next;
      }
      if (!sp) {
        break;
      }
      link = stack[--sp]!;
    }
  }

  /**
   * Pull: bring a stale computed or effect up to date. Walks dependencies in
   * read order with an explicit stack, refreshing each stale one first. A
   * dependency that recomputes to a new value marks this node `DIRTY` (see
   * {@link exec}), and a `DIRTY` node re-runs; a `CHECK` node whose
   * dependencies all came back clean is clean.
   */
  private pull(node: ReactiveNode): void {
    const stack = this.ps;
    const base = this.psp;
    let sp = base;
    stack[sp++] = node;
    node.cursor = node.deps;
    try {
      while (sp > base) {
        const top = stack[sp - 1]!;
        if (top.flags & F.Dirty) {
          this.psp = sp;
          this.exec(top);
          sp--;
          continue;
        }
        const link = top.cursor;
        if (!link) {
          top.flags &= ~F.Check;
          sp--;
          continue;
        }
        top.cursor = link.nextDep;
        const dep = link.source;
        const flags = dep.flags;
        if (flags & (F.Stale | F.Running)) {
          // A dependency still running is up the call stack: its result
          // depends on this pull, which depends on it.
          if (flags & F.Running) {
            throw cycle();
          }
          if (flags & F.Dirty) {
            this.psp = sp;
            this.compute(dep);
          } else {
            stack[sp++] = dep;
            dep.cursor = dep.deps;
          }
        }
      }
    } finally {
      this.psp = base;
    }
  }

  /**
   * Recompute a derivation. A computed owns nothing: cleanups and effects
   * created inside it must not attach to whichever effect pulled it. The
   * result (or thrown error) bumps the version only when it differs per
   * `equals`, and then marks `CHECK` subscribers `DIRTY`.
   */
  private compute(node: ReactiveNode): void {
    const flags = node.flags;
    const prevOwner = this.owner;
    const prev = this.active;
    this.begin(node, flags);
    this.owner = null;
    let value: any;
    let failed = false;
    try {
      value = node.fn!(node.value);
    } catch (e) {
      value = e;
      failed = true;
    }
    this.owner = prevOwner;
    this.end(node, prev);
    if (
      failed ||
      // No value yet, or the last result was an error: always a change.
      (flags & (F.HasValue | F.Errored)) !== F.HasValue ||
      !node.equals(node.value, value)
    ) {
      node.value = value;
      node.version++;
      node.flags =
        ((node.flags | F.HasValue) & ~F.Errored) | (failed ? F.Errored : 0);
      // Subscribers waiting on a check now know: this input changed.
      for (let l = node.subs; l; l = l.nextSub) {
        const target = l.target;
        if (target.flags & F.Check) {
          target.flags |= F.Dirty;
        }
      }
    }
  }

  /**
   * Run a computed or effect's function. An effect runs as a batch: what it
   * writes is flushed after it returns, never inside it.
   */
  private exec(node: ReactiveNode): void {
    if (!(node.flags & F.Effect)) {
      this.compute(node);

      return;
    }
    if (node.children || node.cleanups) {
      this.clean(node);
    }
    const prevOwner = this.owner;
    const prev = this.active;
    this.begin(node, node.flags);
    this.owner = node;
    this.depth++;
    try {
      node.value = node.fn!(node.value);
      node.flags |= F.HasValue;
    } finally {
      this.owner = prevOwner;
      this.end(node, prev);
      this.depth--;
      this.kick();
    }
  }

  /**
   * Start a run: clear stale marks, open tracking. A static node tracks on
   * its first successful run only. Returns whether this run tracks.
   */
  private begin(node: ReactiveNode, flags: number): void {
    if (flags & F.Running) {
      throw cycle();
    }
    const tracked =
      (flags & (F.Static | F.HasValue | F.Errored)) !== (F.Static | F.HasValue);
    node.flags = (flags & ~F.Stale) | F.Running;
    node.cursor = null;
    node.run = ++this.seq;
    this.active = tracked ? node : null;
  }

  /**
   * Finish a run: restore the reader, drop dependencies this run skipped.
   * The run tracked if `active` is still the node (every reader restores it).
   */
  private end(node: ReactiveNode, prev: ReactiveNode | null): void {
    const tracked = this.active === node;
    this.active = prev;
    node.flags &= ~F.Running;
    const cursor = node.cursor;
    const stale = cursor ? cursor.nextDep : node.deps;
    if (tracked && stale) {
      if (cursor) {
        cursor.nextDep = null;
      } else {
        node.deps = null;
      }
      this.drop(stale);
    }
  }

  /**
   * Unsubscribe `link` and every dependency after it. A computed left with
   * no subscribers releases its own dependencies and goes dirty.
   */
  private drop(link: Link | null): void {
    const stack = this.ms;
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
        if (!dep.subs && dep.flags & F.Computed && dep.deps) {
          dep.flags |= F.Dirty;
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
  private clean(node: ReactiveNode): void {
    const children = node.children;
    const cleanups = node.cleanups;
    const prev = this.active;
    this.active = null;
    try {
      // Newest first. Popping leaves only what has not run if one throws.
      while (children?.length) {
        this.dispose(children.pop()!);
      }
      while (cleanups?.length) {
        cleanups.pop()!();
      }
    } finally {
      this.active = prev;
    }
  }
}

/** An effect that still has to run: stale and not disposed. */
function live(node: ReactiveNode): boolean {
  return !(node.flags & F.Disposed) && !!(node.flags & F.Stale);
}

function eq<T>(options?: NodeOptions<T>): Equals<T> {
  const equals = options?.equals;

  return equals === false ? never : (equals ?? Object.is);
}

function cycle(): Error {
  return new Error("[Directive] Cycle detected");
}

/**
 * Create an isolated reactive graph. Nodes belong to the graph that created
 * them: pass a node only to that graph's methods. Mixing graphs (reading,
 * writing or disposing another graph's node) is unsupported and unchecked.
 */
export function createGraph(options?: GraphOptions): Graph {
  return new Graph(options);
}
