/**
 * Time and randomness, injected (L0b).
 *
 * A {@link Clock} owns its timers as data: a min-heap of
 * `{deadline, owner, kind, seq}` records ordered by deadline, then by `seq`
 * (creation order), so ties always fire the same way. Callbacks live beside
 * the records, never in them, so {@link Clock.timers} is plain data a
 * snapshot can keep.
 *
 * - {@link createVirtualClock}: time moves only on {@link Clock.advanceTo}.
 *   It never touches a host timer.
 * - {@link createClock}: real time, one host timer armed for the earliest
 *   deadline. Host functions are looked up when the clock is created.
 *
 * {@link createRng}: a seeded PRNG whose whole state is one number.
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
}

export interface Clock {
  /** Current time in ms. */
  now(): number;
  /** The earliest pending deadline, or `undefined` when none. */
  nextDeadline(): number | undefined;
  /**
   * Fire every timer due at or before `t`, earliest first (ties by `seq`),
   * including timers they set that also fall due. A virtual clock then sits
   * at `t`; it never moves backwards. Errors are collected and the first is
   * rethrown after the due timers ran.
   */
  advanceTo(t: number): void;
  /** Schedule `fn` after `ms`. Returns the timer's `seq`, its id. */
  setTimeout(fn: () => void, ms: number, options?: TimerOptions): number;
  clearTimeout(seq: number): void;
  /** Pending timers, in firing order. Plain data. */
  timers(): TimerRecord[];
}

interface Timer extends TimerRecord {
  fn: () => void;
}

const before = (a: Timer, b: Timer): boolean =>
  a.deadline < b.deadline || (a.deadline === b.deadline && a.seq < b.seq);

/** The heap and timer table both clocks share. */
function timerCore(getNow: () => number, onChange: () => void) {
  const heap: Timer[] = [];
  const live = new Map<number, Timer>();
  let seq = 0;

  const push = (t: Timer): void => {
    let i = heap.push(t) - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(heap[i]!, heap[p]!)) {
        break;
      }
      [heap[i], heap[p]] = [heap[p]!, heap[i]!];
      i = p;
    }
  };
  const pop = (): Timer => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && before(heap[l]!, heap[m]!)) {
          m = l;
        }
        if (r < heap.length && before(heap[r]!, heap[m]!)) {
          m = r;
        }
        if (m === i) {
          break;
        }
        [heap[i], heap[m]] = [heap[m]!, heap[i]!];
        i = m;
      }
    }

    return top;
  };
  /** Drop cleared timers sitting at the top. */
  const head = (): Timer | undefined => {
    while (heap.length && !live.has(heap[0]!.seq)) {
      pop();
    }

    return heap[0];
  };

  return {
    head,
    nextDeadline: () => head()?.deadline,
    set(fn: () => void, ms: number, options?: TimerOptions): number {
      const t: Timer = {
        deadline: getNow() + Math.max(0, ms),
        owner: options?.owner ?? 0,
        kind: options?.kind ?? "timeout",
        seq: ++seq,
        fn,
      };
      live.set(t.seq, t);
      push(t);
      onChange();

      return t.seq;
    },
    clear(id: number): void {
      if (live.delete(id)) {
        onChange();
      }
    },
    /** Fire due timers; `step` moves virtual time to each deadline. */
    run(t: number, step: (deadline: number) => void): void {
      let error: unknown = heap;
      for (let top = head(); top && top.deadline <= t; top = head()) {
        pop();
        live.delete(top.seq);
        step(top.deadline);
        try {
          top.fn();
        } catch (e) {
          if (error === heap) {
            error = e;
          }
        }
      }
      if (error !== heap) {
        throw error;
      }
    },
    timers(): TimerRecord[] {
      return [...live.values()]
        .sort((a, b) => (before(a, b) ? -1 : 1))
        .map(({ deadline, owner, kind, seq }) => ({
          deadline,
          owner,
          kind,
          seq,
        }));
    },
  };
}

/** A clock that moves only when told to. Starts at `start` (default 0). */
export function createVirtualClock(start = 0): Clock {
  let now = start;
  const core = timerCore(
    () => now,
    () => {},
  );

  return {
    now: () => now,
    nextDeadline: core.nextDeadline,
    advanceTo(t) {
      try {
        core.run(t, (d) => {
          if (d > now) {
            now = d;
          }
        });
      } finally {
        if (t > now) {
          now = t;
        }
      }
    },
    setTimeout: core.set,
    clearTimeout: core.clear,
    timers: core.timers,
  };
}

export interface RealClockOptions {
  /** Defaults to `Date.now`. */
  now?: () => number;
  /** Host timer pair. Defaults to the global `setTimeout`/`clearTimeout`. */
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Real time. Keeps the same timer heap and arms one host timer for the
 * earliest deadline; when it fires, due timers run via `advanceTo(now())`.
 */
export function createClock(options: RealClockOptions = {}): Clock {
  const g = globalThis as any;
  const now = options.now ?? (() => Date.now());
  const setTimer =
    options.setTimer ?? ((cb: () => void, ms: number) => g.setTimeout(cb, ms));
  const clearTimer = options.clearTimer ?? ((h: unknown) => g.clearTimeout(h));
  let handle: unknown;
  let armedFor: number | undefined;
  let firing = false;

  const rearm = (): void => {
    const d = core.nextDeadline();
    if (d === armedFor) {
      return;
    }
    if (armedFor !== undefined) {
      clearTimer(handle);
    }
    armedFor = d;
    if (d !== undefined) {
      handle = setTimer(
        () => {
          armedFor = undefined;
          clock.advanceTo(now());
        },
        Math.max(0, d - now()),
      );
    }
  };
  const core = timerCore(now, () => {
    // Re-arming during a run waits for the run to finish.
    if (!firing) {
      rearm();
    }
  });
  const clock: Clock = {
    now,
    nextDeadline: core.nextDeadline,
    advanceTo(t) {
      firing = true;
      try {
        core.run(t, () => {});
      } finally {
        firing = false;
        rearm();
      }
    },
    setTimeout: core.set,
    clearTimeout: core.clear,
    timers: core.timers,
  };

  return clock;
}

/** A seeded PRNG: `rng()` returns a float in [0, 1). */
export interface Rng {
  (): number;
  /** The whole generator state. Save it and assign it back to replay. */
  state: number;
}

/** A seeded mulberry32 generator. Same seed, same sequence, any host. */
export function createRng(seed = 1): Rng {
  const rng = (() => {
    let t = (rng.state = (rng.state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  rng.state = seed | 0;

  return rng;
}
