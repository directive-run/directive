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

/**
 * Every field is declared and assigned in the constructor, never as a class
 * field initializer: with define semantics (ES2022 class fields) each
 * initializer is a define-property, which makes allocation measurably slower.
 */

/** An edge: `target` read `source`. */
export class Link {
  declare source: ReactiveNode;
  declare target: ReactiveNode;
  /** Next dependency of `target`, in read order. */
  declare nextDep: Link | null;
  declare prevSub: Link | null;
  declare nextSub: Link | null;

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
    this.nextSub = null;
  }
}

/**
 * A signal, computed or effect. One class for all three keeps every node the
 * same shape. Fields are public for the layers built on top; treat them as
 * read-only outside this module.
 */
export class ReactiveNode<T = any> {
  /** Unique within its graph. */
  declare readonly id: number;
  declare flags: number;
  declare value: T;
  declare fn: ((previous: T) => T) | null;
  declare equals: Equals<T>;
  /** Bumped each time `value` changes. */
  declare version: number;
  /** First dependency, in read order. */
  declare deps: Link | null;
  /**
   * During a run: the last dependency confirmed so far. During a pull walk
   * (never at the same time): the next dependency to check.
   */
  declare cursor: Link | null;
  declare subs: Link | null;
  declare subsTail: Link | null;
  /** Id of the current or most recent run, for de-duplicating reads. */
  declare run: number;
  /**
   * Run id of the last node that tracked this one. Run ids only grow, so a
   * stamp below a running node's id proves that run has not read this node.
   */
  declare stamp: number;
  /** The effect that created this effect, if any. */
  declare parent: ReactiveNode | null;
  /** Effects created while this effect ran: disposed before it re-runs. */
  declare children: ReactiveNode[] | null;
  declare cleanups: Array<() => void> | null;
  /** Runs in the current flush, for write-loop detection. */
  declare runs: number;

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
    this.version = this.run = this.stamp = this.runs = 0;
    this.deps =
      this.cursor =
      this.subs =
      this.subsTail =
      this.parent =
      this.children =
      this.cleanups =
        null;
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
  private seq_ = 0;
  private depth_ = 0;
  private busy_ = false;
  /** Effects to run, and how many: slots past `qn` are stale. */
  private queue_: Array<ReactiveNode | null> = [];
  private qn_ = 0;
  /** Pull stack and its height, shared by nested pulls. */
  private ps_: ReactiveNode[] = [];
  private psp_ = 0;
  /**
   * Work stack shared by the mark (push) and release walks. Neither calls
   * user code or the other, so they never overlap.
   */
  private ms_: Array<Link | null> = [];
  private readonly sched_: ((graph: Graph) => void) | undefined;
  private readonly max_: number;

  constructor(options?: GraphOptions) {
    this.sched_ = options?.schedule;
    this.max_ = options?.maxRuns ?? 100;
  }

  /** A writable source node. */
  signal<T>(value: T, options?: NodeOptions<T>): ReactiveNode<T> {
    return new ReactiveNode(++this.seq_, 0, value, null, eq(options));
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
      ++this.seq_,
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
      ++this.seq_,
      F.Effect | (options?.static ? F.Static : 0),
      undefined as T,
      fn as (previous: T) => T,
      never,
    );
    const owner = (node.parent = this.owner);
    if (owner) {
      (owner.children ??= []).push(node);
    }
    try {
      this.exec_(node);
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
    // Every run starts from a read, a pull (which skips running nodes) or a
    // new effect, so this is the one cycle check a run needs.
    if (flags & F.Running) {
      throw cycle();
    }
    if (flags & F.Dirty) {
      this.exec_(node);
    } else if (flags & F.Check) {
      this.pull_(node);
    }
    if (this.active) {
      this.track_(node);
    }
    if (node.flags & F.Errored) {
      throw node.value;
    }

    return node.value;
  }

  /** Write a signal. No-op when `equals` says the value is unchanged. */
  write<T>(node: ReactiveNode<T>, value: T): void {
    if (same(node, value)) {
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
      this.mark_(node);
      this.kick_();
    }
  }

  /** Run `fn` with effects held until the outermost batch ends. */
  batch<R>(fn: () => R): R {
    this.depth_++;
    try {
      return fn();
    } finally {
      this.depth_--;
      this.kick_();
    }
  }

  /** Flush (or schedule a flush) if effects wait and nothing holds them. */
  private kick_(): void {
    if (!this.depth_ && !this.busy_ && this.qn_) {
      this.sched_ ? this.sched_(this) : this.flush();
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
    node.flags |= node.flags & F.Effect ? F.Disposed : F.Dirty;
    // A computed owns nothing, so this only cleans effects.
    this.clean_(node);
    this.drop_(node.deps);
    node.deps = node.cursor = null;
  }

  /**
   * Run every queued effect that is stale. Effects queued while flushing run
   * in the same flush. Errors from effects are collected; the first is
   * rethrown after the queue drains.
   */
  flush(): void {
    if (this.busy_) {
      return;
    }
    this.busy_ = true;
    const queue = this.queue_;
    // Run ids only grow: an effect whose last run id is not above this has not
    // run in this flush, so its write-loop count starts over (no reset pass).
    const start = this.seq_;
    // The queue itself marks "no error": user code can never throw it.
    let error: unknown = queue;
    for (let i = 0; i < this.qn_; i++) {
      const node = queue[i]!;
      queue[i] = null;
      if (live(node)) {
        try {
          if (node.run <= start) {
            node.runs = 0;
          }
          if (++node.runs > this.max_) {
            node.flags &= ~F.Stale;
            throw cycle();
          }
          // Owners run before the effects they own, outermost first. Each
          // owner is brought up to date in turn (a CHECK owner whose inputs
          // did not change does not re-run, but one below it may); a re-run
          // may dispose this effect or bring it up to date.
          if (this.owners_(node, node.parent)) {
            // A DIRTY effect just runs: no dependency walk to set up.
            node.flags & F.Dirty ? this.exec_(node) : this.pull_(node);
          }
        } catch (e) {
          // Keep the first error; the next effect still runs.
          if (error === queue) {
            error = e;
          }
        }
      }
    }
    this.qn_ = 0;
    this.busy_ = false;
    if (error !== queue) {
      throw error;
    }
  }

  /**
   * Refresh `node`'s stale owners from the outermost down (`p` starts at its
   * parent). Returns false once `node` is disposed or no longer stale, so the
   * caller skips it. Owner chains are as deep as effect nesting in user code.
   */
  private owners_(node: ReactiveNode, p: ReactiveNode | null): boolean {
    if (!p) {
      return true;
    }
    if (!this.owners_(node, p.parent)) {
      return false;
    }
    if (live(p)) {
      this.pull_(p);

      return live(node);
    }

    return true;
  }

  /** Record that the active node read `dep`, reusing a link when possible. */
  private track_(dep: ReactiveNode): void {
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
  private mark_(source: ReactiveNode): void {
    const stack = this.ms_;
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
            this.queue_[this.qn_++] = target;
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
   * {@link exec_}), and a `DIRTY` node re-runs; a `CHECK` node whose
   * dependencies all came back clean is clean.
   */
  private pull_(node: ReactiveNode): void {
    // The node being checked is a local; the stack holds only the nodes
    // waiting on it, so a shallow check never touches the stack.
    const stack = this.ps_;
    const base = this.psp_;
    let sp = base;
    let top = node;
    top.cursor = top.deps;
    try {
      for (;;) {
        if (top.flags & F.Dirty) {
          this.psp_ = sp;
          this.exec_(top);
        } else {
          const link = top.cursor;
          if (link) {
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
                this.psp_ = sp;
                this.compute_(dep);
              } else {
                stack[sp++] = top;
                top = dep;
                dep.cursor = dep.deps;
              }
            }
            continue;
          }
          top.flags &= ~F.Check;
        }
        if (sp === base) {
          break;
        }
        top = stack[--sp]!;
      }
    } finally {
      this.psp_ = base;
    }
  }

  /**
   * Recompute a derivation. A computed owns nothing: cleanups and effects
   * created inside it must not attach to whichever effect pulled it. The
   * result (or thrown error) bumps the version only when it differs per
   * `equals`, and then marks `CHECK` subscribers `DIRTY`.
   */
  private compute_(node: ReactiveNode): void {
    const flags = node.flags;
    const prevOwner = this.owner;
    const prev = this.begin_(node, flags);
    if (prevOwner) {
      this.owner = null;
    }
    let value: any;
    // `Errored` when `fn` threw, else 0: it goes straight into the flags.
    let failed = 0;
    try {
      value = node.fn!(node.value);
    } catch (e) {
      value = e;
      failed = F.Errored;
    }
    this.owner = prevOwner;
    this.end_(node, prev);
    if (
      failed ||
      // No value yet, or the last result was an error: always a change.
      (flags & (F.HasValue | F.Errored)) !== F.HasValue ||
      !same(node, value)
    ) {
      // One flag write for the whole result: clears Running too.
      node.value = value;
      node.version++;
      node.flags =
        ((node.flags | F.HasValue) & ~(F.Errored | F.Running)) | failed;
      // Subscribers waiting on a check now know: this input changed.
      for (let l = node.subs; l; l = l.nextSub) {
        const target = l.target;
        if (target.flags & F.Check) {
          target.flags |= F.Dirty;
        }
      }
    } else {
      node.flags &= ~F.Running;
    }
  }

  /**
   * Run a computed or effect's function. An effect runs as a batch: what it
   * writes is flushed after it returns, never inside it.
   */
  private exec_(node: ReactiveNode): void {
    if (!(node.flags & F.Effect)) {
      this.compute_(node);

      return;
    }
    this.clean_(node);
    const prevOwner = this.owner;
    // A flush already holds writes back; outside one, hold them as a batch.
    const hold = !this.busy_;
    const prev = this.begin_(node, node.flags);
    this.owner = node;
    if (hold) {
      this.depth_++;
    }
    try {
      node.value = node.fn!(node.value);
    } finally {
      this.owner = prevOwner;
      this.end_(node, prev);
      // An effect whose first run throws is disposed, so HasValue only
      // matters after a run that completed.
      node.flags = (node.flags & ~F.Running) | F.HasValue;
      if (hold) {
        this.depth_--;
        this.kick_();
      }
    }
  }

  /**
   * Start a run: clear stale marks, open tracking. A static node tracks on
   * its first successful run only. Returns the reader to restore.
   */
  private begin_(node: ReactiveNode, flags: number): ReactiveNode | null {
    const prev = this.active;
    const tracked =
      (flags & (F.Static | F.HasValue | F.Errored)) !== (F.Static | F.HasValue);
    node.flags = (flags & ~F.Stale) | F.Running;
    node.cursor = null;
    node.run = ++this.seq_;
    this.active = tracked ? node : null;

    return prev;
  }

  /**
   * Finish a run: restore the reader, drop dependencies this run skipped.
   * The run tracked if `active` is still the node (every reader restores it).
   * The caller clears `Running`.
   */
  private end_(node: ReactiveNode, prev: ReactiveNode | null): void {
    if (this.active === node) {
      const cursor = node.cursor;
      const stale = cursor ? cursor.nextDep : node.deps;
      if (stale) {
        if (cursor) {
          cursor.nextDep = null;
        } else {
          node.deps = null;
        }
        this.drop_(stale);
      }
    }
    this.active = prev;
  }

  /**
   * Unsubscribe `link` and every dependency after it. A computed left with
   * no subscribers releases its own dependencies and goes dirty.
   */
  private drop_(link: Link | null): void {
    const stack = this.ms_;
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
  private clean_(node: ReactiveNode): void {
    const children = node.children;
    const cleanups = node.cleanups;
    if (children || cleanups) {
      this.untracked(() => {
        // Newest first. Popping leaves only what has not run if one throws.
        while (children?.length) {
          this.dispose(children.pop()!);
        }
        while (cleanups?.length) {
          cleanups.pop()!();
        }
      });
    }
  }
}

/** An effect that still has to run: stale and not disposed. */
function live(node: ReactiveNode): boolean {
  return !(node.flags & F.Disposed) && !!(node.flags & F.Stale);
}

/** `equals` says `next` is unchanged. The default needs no indirect call. */
function same(node: ReactiveNode, next: unknown): boolean {
  const equals = node.equals;

  return equals === Object.is
    ? Object.is(node.value, next)
    : equals(node.value, next);
}

function eq<T>(options?: NodeOptions<T>): Equals<T> {
  const equals = options?.equals;

  return equals === false ? never : (equals ?? Object.is);
}

function cycle(): Error {
  return Error("[Directive] Cycle detected");
}

/**
 * Create an isolated reactive graph. Nodes belong to the graph that created
 * them: pass a node only to that graph's methods. Mixing graphs (reading,
 * writing or disposing another graph's node) is unsupported and unchecked.
 */
export function createGraph(options?: GraphOptions): Graph {
  return new Graph(options);
}
