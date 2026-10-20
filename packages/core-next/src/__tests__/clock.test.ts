import { describe, expect, it } from "vitest";
import { createClock, createRng, createVirtualClock } from "../clock.js";

describe("virtual clock", () => {
  it("moves only on advanceTo and never backwards", () => {
    const c = createVirtualClock(10);
    expect(c.now()).toBe(10);
    c.advanceTo(25);
    expect(c.now()).toBe(25);
    c.advanceTo(5);
    expect(c.now()).toBe(25);
  });

  it("fires timers by deadline, ties by creation order, at their deadline", () => {
    const c = createVirtualClock();
    const log: string[] = [];
    c.setTimeout(() => log.push(`b@${c.now()}`), 20);
    c.setTimeout(() => log.push(`a1@${c.now()}`), 10);
    c.setTimeout(() => log.push(`c@${c.now()}`), 30);
    c.setTimeout(() => log.push(`a2@${c.now()}`), 10);
    expect(c.nextDeadline()).toBe(10);
    c.advanceTo(20);
    expect(log).toEqual(["a1@10", "a2@10", "b@20"]);
    expect(c.nextDeadline()).toBe(30);
    c.advanceTo(100);
    expect(log.at(-1)).toBe("c@30");
    expect(c.nextDeadline()).toBeUndefined();
  });

  it("fires timers set by timers when they fall due in range", () => {
    const c = createVirtualClock();
    const log: number[] = [];
    c.setTimeout(() => {
      log.push(c.now());
      c.setTimeout(() => log.push(c.now()), 5);
      c.setTimeout(() => log.push(c.now()), 500);
    }, 5);
    c.advanceTo(50);
    expect(log).toEqual([5, 10]);
    expect(c.timers().map((t) => t.deadline)).toEqual([505]);
  });

  it("clearTimeout removes a timer; timers() is plain data in firing order", () => {
    const c = createVirtualClock();
    const a = c.setTimeout(() => {}, 30, { owner: 7, kind: "retry" });
    const b = c.setTimeout(() => {}, 10);
    const d = c.setTimeout(() => {}, 10, { kind: "after" });
    c.clearTimeout(b);
    expect(c.timers()).toEqual([
      { deadline: 10, owner: 0, kind: "after", seq: d },
      { deadline: 30, owner: 7, kind: "retry", seq: a },
    ]);
    expect(JSON.parse(JSON.stringify(c.timers()))).toEqual(c.timers());
    expect(c.nextDeadline()).toBe(10);
    c.clearTimeout(d);
    expect(c.nextDeadline()).toBe(30);
  });

  it("keeps firing after a timer throws, then rethrows the first error", () => {
    const c = createVirtualClock();
    const log: number[] = [];
    c.setTimeout(() => {
      throw Error("boom");
    }, 1);
    c.setTimeout(() => log.push(2), 2);
    expect(() => c.advanceTo(10)).toThrow("boom");
    expect(log).toEqual([2]);
    expect(c.now()).toBe(10);
  });

  it("heap ordering holds under many random timers", () => {
    const c = createVirtualClock();
    const rng = createRng(42);
    const fired: Array<[number, number]> = [];
    const ids: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const ms = Math.floor(rng() * 100);
      const id = c.setTimeout(() => fired.push([c.now(), id]), ms);
      ids.push(id);
    }
    for (let i = 0; i < 300; i++) {
      c.clearTimeout(ids[Math.floor(rng() * ids.length)]!);
    }
    const expected = c.timers().map((t) => [t.deadline, t.seq]);
    c.advanceTo(1000);
    expect(fired).toEqual(expected);
  });

  it("never uses host timers", () => {
    const g = globalThis as any;
    const saved = g.setTimeout;
    g.setTimeout = () => {
      throw Error("host timer used");
    };
    try {
      const c = createVirtualClock();
      let ran = false;
      c.setTimeout(() => {
        ran = true;
      }, 10);
      c.advanceTo(10);
      expect(ran).toBe(true);
    } finally {
      g.setTimeout = saved;
    }
  });
});

describe("real clock", () => {
  it("gives each timer its own host timer; records stay plain data", () => {
    let now = 100;
    const armed: Array<{ cb: () => void; ms: number; live: boolean }> = [];
    const c = createClock({
      now: () => now,
      setTimer: (cb, ms) => {
        const h = { cb, ms, live: true };
        armed.push(h);

        return h;
      },
      clearTimer: (h) => {
        (h as { live: boolean }).live = false;
      },
    });
    const log: string[] = [];
    c.setTimeout(() => log.push("late"), 50, { owner: 2, kind: "x" });
    c.setTimeout(() => log.push("early"), 10);
    expect(armed.map((h) => h.ms)).toEqual([50, 10]);
    expect(c.nextDeadline()).toBe(110);
    expect(c.timers()).toEqual([
      { deadline: 110, owner: 0, kind: "timeout", seq: 2 },
      { deadline: 150, owner: 2, kind: "x", seq: 1 },
    ]);
    now = 110;
    armed[1]!.cb();
    expect(log).toEqual(["early"]);
    // advanceTo fires what is due and clears its host timer.
    now = 150;
    c.advanceTo(150);
    expect(log).toEqual(["early", "late"]);
    expect(armed[0]!.live).toBe(false);
    armed[0]!.cb();
    expect(log).toEqual(["early", "late"]);
    expect(c.timers()).toEqual([]);
  });

  it("clearOwner clears that owner's timers and their host timers", () => {
    const handles: Array<{ live: boolean }> = [];
    const c = createClock({
      setTimer: () => {
        const h = { live: true };
        handles.push(h);

        return h;
      },
      clearTimer: (h) => {
        (h as { live: boolean }).live = false;
      },
    });
    c.setTimeout(() => {}, 5, { owner: 1 });
    c.setTimeout(() => {}, 5, { owner: 2 });
    c.clearOwner(1);
    expect(c.timers().map((t) => t.owner)).toEqual([2]);
    expect(handles.map((h) => h.live)).toEqual([false, true]);
  });

  it("defaults to performance.now when present", () => {
    const c = createClock();
    const p = performance.now();
    expect(Math.abs(c.now() - p)).toBeLessThan(1000);
  });

  it("works with real host timers by default", async () => {
    const c = createClock();
    const t0 = c.now();
    const fired = await new Promise<number>((resolve) => {
      c.setTimeout(() => resolve(c.now()), 5);
    });
    expect(fired - t0).toBeGreaterThanOrEqual(4);
  });
});

describe("rng", () => {
  it("is deterministic per seed and replays from its state", () => {
    const a = createRng(123);
    const b = createRng(123);
    const seqA = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(seqA);
    const saved = a.state;
    const next = [a(), a()];
    a.state = saved;
    expect([a(), a()]).toEqual(next);
    expect(createRng(124)()).not.toBe(seqA[0]);
  });

  it("rejects non-integer seeds and reduces to 32 bits", () => {
    expect(() => createRng(1.5)).toThrow(/integer/);
    expect(() => createRng(Number.NaN)).toThrow(/integer/);
    expect(createRng(2 ** 32 + 7).seed).toBe(7);
  });

  it("forks children purely from seed and ordinal", () => {
    const a = createRng(9);
    const before = a.state;
    const c0 = a.fork(0);
    expect(a.state).toBe(before);
    expect(a.fork(0).seed).toBe(c0.seed);
    expect(a.fork(1).seed).not.toBe(c0.seed);
    expect(createRng(10).fork(0).seed).not.toBe(c0.seed);
  });

  it("stays in [0, 1)", () => {
    const r = createRng(0);
    for (let i = 0; i < 10000; i++) {
      const x = r();
      expect(x >= 0 && x < 1).toBe(true);
    }
  });
});
