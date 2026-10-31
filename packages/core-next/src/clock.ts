/**
 * Time and randomness, injected (L0b).
 *
 * A {@link Clock} owns its timers as data: `{deadline, owner, kind, seq}`
 * records, fired by deadline, then by `seq` (creation order), so ties always
 * fire the same way. Callbacks live beside the records, never in them, so
 * {@link Clock.timers} is plain data a snapshot can keep.
 *
 * - {@link createClock}: real time (the default a kernel uses). Each timer
 *   gets its own host timer. Host functions are looked up when the clock is
 *   created. It has only the {@link Clock} members.
 * - {@link createVirtualClock}: time moves only on
 *   {@link VirtualClock.advanceTo}, and its timers are inspectable data.
 *   It never touches a host timer. Opt-in: import it to use it.
 *
 * {@link createRng}: a seeded PRNG whose whole state is one number. Opt-in.
 *
 * No `process.env` reads and no module-level mutable state.
 *
 * @module
 */

/** A pending timer, as data. */
export interface TimerRecord {
  deadline: number;
  /** Who set it (a system or node id); 0 when unowned. */
  owner: number;
  /** What it is for, so a restore can re-bind it ("after", "retry", …). */
  kind: string;
  /** Creation order: the tie-break, and the timer's id. */
  seq: number;
}

export interface TimerOptions {
  owner?: number;
  kind?: string;
  /**
   * False: the timer alone does not keep the host process alive (the real
   * clock calls the host handle's `unref`, where it has one). Default true.
   * A host concern, not state, so it is not in {@link TimerRecord}.
   */
  keepAlive?: boolean;
}

export interface Clock {
  /** Current time in ms. */
  now(): number;
  /** Schedule `fn` after `ms`. Returns the timer's `seq`, its id. */
  setTimeout(fn: () => void, ms: number, options?: TimerOptions): number;
  clearTimeout(seq: number): void;
  /** Clear every timer set with this `owner`. */
  clearOwner(owner: number): void;
}

/**
 * A clock whose timers are data that tests and snapshots drive: the virtual
 * clock. The real clock leaves these out (its host timers fire on their own),
 * so they cost a production bundle nothing.
 */
export interface VirtualClock extends Clock {
  /** The earliest pending deadline, or `undefined` when none. */
  nextDeadline(): number | undefined;
  /**
   * Fire timers due at or before `t`, earliest first (ties by `seq`), with
   * `now()` at each one's deadline; then sit at `t` (time never moves
   * backwards). Errors are collected and the first is rethrown after the due
   * timers ran. Timers set for the deadline being fired run in a further
   * pass at that deadline; a deadline that needs more than 1,000 passes
   * throws, leaving time at that deadline and the timer pending.
   */
  advanceTo(t: number): void;
  /** Pending timers, in firing order. Plain data. */
  timers(): TimerRecord[];
}

interface Timer extends TimerRecord {
  fn: () => void;
}

const before = (a: Timer, b: Timer): boolean =>
  a.deadline < b.deadline || (a.deadline === b.deadline && a.seq < b.seq);

const order = (list: Iterable<Timer>): Timer[] =>
  [...list].sort((a, b) => (before(a, b) ? -1 : 1));

const record = ({ deadline, owner, kind, seq }: Timer): TimerRecord => ({
  deadline,
  owner,
  kind,
  seq,
});

const make = (
  seq: number,
  at: number,
  fn: () => void,
  ms: number,
  options?: TimerOptions,
): Timer => ({
  deadline: at + Math.max(0, ms),
  owner: options?.owner ?? 0,
  kind: options?.kind ?? "timeout",
  seq,
  fn,
});

/** Most passes one virtual deadline may take (timers setting 0 ms timers). */
const MAX_PASSES = 1000;

/**
 * A clock that moves only when told to. Starts at `start` (default 0). Its
 * timers sit in a min-heap.
 */
export function createVirtualClock(start = 0): VirtualClock {
  let now = start;
  let seq = 0;
  const heap: Timer[] = [];
  const live = new Map<number, Timer>();

  const swap = (i: number, j: number): void => {
    [heap[i], heap[j]] = [heap[j]!, heap[i]!];
  };
  const pop = (): void => {
    const last = heap.pop()!;
    if (!heap.length) {
      return;
    }
    heap[0] = last;
    for (let i = 0; ; ) {
      const l = 2 * i + 1;
      let m = i;
      if (l < heap.length && before(heap[l]!, heap[m]!)) {
        m = l;
      }
      if (l + 1 < heap.length && before(heap[l + 1]!, heap[m]!)) {
        m = l + 1;
      }
      if (m === i) {
        return;
      }
      swap(i, m);
      i = m;
    }
  };
  /** Drop cleared timers sitting at the top. */
  const head = (): Timer | undefined => {
    while (heap.length && !live.has(heap[0]!.seq)) {
      pop();
    }

    return heap[0];
  };

  return {
    now: () => now,
    nextDeadline: () => head()?.deadline,
    advanceTo(t) {
      let error: unknown = heap;
      /** The deadline being fired, and the last `seq` of its current pass. */
      let at = Number.NaN;
      let mark = 0;
      let passes = 0;
      for (let top = head(); top && top.deadline <= t; top = head()) {
        if (top.deadline !== at) {
          at = top.deadline;
          mark = seq;
          passes = 0;
        } else if (top.seq > mark) {
          // Set while this deadline fired: the next pass.
          mark = seq;
          if (++passes >= MAX_PASSES) {
            if (error === heap) {
              error = Error(`[Directive] timers at ${at} did not settle`);
            }
            t = at;
            break;
          }
        }
        pop();
        live.delete(top.seq);
        if (at > now) {
          now = at;
        }
        try {
          top.fn();
        } catch (e) {
          if (error === heap) {
            error = e;
          }
        }
      }
      if (t > now) {
        now = t;
      }
      if (error !== heap) {
        throw error;
      }
    },
    setTimeout(fn, ms, options) {
      const timer = make(++seq, now, fn, ms, options);
      live.set(seq, timer);
      let i = heap.push(timer) - 1;
      for (let p = (i - 1) >> 1; i > 0 && before(heap[i]!, heap[p]!); ) {
        swap(i, p);
        i = p;
        p = (i - 1) >> 1;
      }

      return seq;
    },
    clearTimeout: (id) => {
      live.delete(id);
    },
    clearOwner(owner) {
      for (const [id, timer] of live) {
        if (timer.owner === owner) {
          live.delete(id);
        }
      }
    },
    timers: () => order(live.values()).map(record),
  };
}

export interface RealClockOptions {
  /** Defaults to `performance.now` when present, else `Date.now`. */
  now?: () => number;
  /** Host timer pair. Defaults to the global `setTimeout`/`clearTimeout`. */
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Real time: each timer is its own host timer, remembered with its owner so
 * {@link Clock.clearOwner} can cancel it. Host functions are looked up when
 * the clock is created.
 */
export function createClock(options: RealClockOptions = {}): Clock {
  const g = globalThis as any;
  const perf = g.performance;
  const now =
    options.now ?? (perf?.now ? () => perf.now() : () => g.Date.now());
  const setTimer =
    options.setTimer ?? ((cb: () => void, ms: number) => g.setTimeout(cb, ms));
  const clearTimer = options.clearTimer ?? ((h: unknown) => g.clearTimeout(h));
  /** Pending timers by id: [owner, host handle]. */
  const live = new Map<number, [number, unknown]>();
  let seq = 0;
  const clear = (id: number): void => {
    const timer = live.get(id);
    if (timer) {
      live.delete(id);
      clearTimer(timer[1]);
    }
  };

  return {
    now,
    setTimeout(fn, ms, options) {
      const id = ++seq;
      const timer: [number, unknown] = [options?.owner ?? 0, undefined];
      live.set(id, timer);
      timer[1] = setTimer(
        () => {
          if (live.delete(id)) {
            fn();
          }
        },
        Math.max(0, ms),
      );
      if (options?.keepAlive === false) {
        (timer[1] as { unref?: () => void } | undefined)?.unref?.();
      }

      return id;
    },
    clearTimeout: clear,
    clearOwner(owner) {
      for (const [id, timer] of live) {
        if (timer[0] === owner) {
          clear(id);
        }
      }
    },
  };
}

/** A seeded PRNG: `rng()` returns a float in [0, 1). */
export interface Rng {
  (): number;
  /** The whole generator state. Save it and assign it back to replay. */
  state: number;
  /** The seed it was created with. */
  readonly seed: number;
  /**
   * A child generator for ordinal `n`, seeded purely from this generator's
   * seed and `n`: it never draws from this one, so creating children in any
   * number never changes this sequence.
   */
  fork(n: number): Rng;
  /** Snapshot part: the state. */
  dump(): number;
  load(state: number): void;
}

/**
 * A seeded mulberry32 generator. Same seed, same sequence, any host. The
 * seed must be an integer; it is reduced to 32 bits.
 */
export function createRng(seed = 1): Rng {
  if (!Number.isInteger(seed)) {
    throw TypeError(`[Directive] rng seed must be an integer, got ${seed}`);
  }
  const rng = (() => {
    let t = (rng.state = (rng.state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  const s = seed | 0;
  rng.state = s;
  (rng as { seed: number }).seed = s;
  rng.fork = (n) => {
    // A 32-bit mix of (seed, n): pure, so a child's seed is reproducible.
    let h =
      Math.imul(s ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(n + 1, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);

    return createRng((h ^ (h >>> 15)) | 0);
  };
  rng.dump = () => rng.state;
  rng.load = (state) => {
    rng.state = state;
  };

  return rng;
}
