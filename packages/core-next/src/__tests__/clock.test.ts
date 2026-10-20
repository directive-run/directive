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
  it("arms one host timer for the earliest deadline and fires through it", () => {
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
    c.setTimeout(() => log.push("late"), 50);
    c.setTimeout(() => log.push("early"), 10);
    const live = () => armed.filter((h) => h.live);
    expect(live().map((h) => h.ms)).toEqual([10]);
    now = 110;
    live()[0]!.live = false;
    armed.at(-1)!.cb();
    expect(log).toEqual(["early"]);
    expect(live().map((h) => h.ms)).toEqual([40]);
    now = 150;
    live()[0]!.live = false;
    armed.at(-1)!.cb();
    expect(log).toEqual(["early", "late"]);
    expect(live()).toEqual([]);
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

  it("stays in [0, 1)", () => {
    const r = createRng(0);
    for (let i = 0; i < 10000; i++) {
      const x = r();
      expect(x >= 0 && x < 1).toBe(true);
    }
  });
});
