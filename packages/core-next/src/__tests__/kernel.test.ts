import { describe, expect, it } from "vitest";
import { createRng, createVirtualClock } from "../clock.js";
import {
  KERNEL_VERSION,
  type KernelEvent,
  createKernel,
  serializeEvent,
} from "../kernel.js";
import { type HostCallback, createScheduler } from "../scheduler.js";

function manualMicro() {
  const cbs: Array<() => void> = [];
  const micro: HostCallback = (cb) => {
    cbs.push(cb);
  };

  return {
    scheduler: createScheduler({ micro, frame: micro, idle: micro }),
    get armed() {
      return cbs.length;
    },
    run() {
      for (const cb of cbs.splice(0)) {
        cb();
      }
    },
  };
}

describe("graph wiring", () => {
  it("graph effects flush on the micro lane by default", () => {
    const h = manualMicro();
    const k = createKernel({ scheduler: h.scheduler });
    const s = k.graph.signal(1);
    const seen: number[] = [];
    k.graph.effect(() => seen.push(k.graph.read(s)));
    k.graph.write(s, 2);
    k.graph.write(s, 3);
    expect(seen).toEqual([1]);
    expect(h.armed).toBe(1);
    h.run();
    expect(seen).toEqual([1, 3]);
  });

  it("the sync lane settles before the write returns", () => {
    const k = createKernel({ lane: "sync" });
    const s = k.graph.signal(1);
    const seen: number[] = [];
    k.graph.effect(() => seen.push(k.graph.read(s)));
    k.graph.write(s, 2);
    expect(seen).toEqual([1, 2]);
  });

  it("the manual lane waits for kernel.flush", () => {
    const h = manualMicro();
    const k = createKernel({ scheduler: h.scheduler, lane: "manual" });
    const s = k.graph.signal(1);
    const seen: number[] = [];
    k.graph.effect(() => seen.push(k.graph.read(s)));
    k.graph.write(s, 2);
    h.run();
    expect(seen).toEqual([1]);
    k.flush();
    expect(seen).toEqual([1, 2]);
  });

  it("batch and touch still hold and notify", () => {
    const k = createKernel({ lane: "sync" });
    const box = k.graph.signal({ n: 0 });
    const seen: number[] = [];
    k.graph.effect(() => seen.push(k.graph.read(box).n));
    k.graph.batch(() => {
      k.graph.read(box).n = 1;
      k.graph.touch(box);
      expect(seen).toEqual([0]);
    });
    expect(seen).toEqual([0, 1]);
  });

  it("many kernels on one scheduler flush once each, in creation order", () => {
    const h = manualMicro();
    const order: number[] = [];
    const kernels = Array.from({ length: 500 }, () =>
      createKernel({ scheduler: h.scheduler }),
    );
    const signals = kernels.map((k) => {
      const s = k.graph.signal(0);
      k.graph.effect(() => {
        if (k.graph.read(s)) {
          order.push(k.id);
        }
      });

      return s;
    });
    for (let i = kernels.length - 1; i >= 0; i--) {
      kernels[i]!.graph.write(signals[i]!, 1);
    }
    expect(h.armed).toBe(1);
    h.run();
    expect(order).toEqual(kernels.map((k) => k.id));
    expect(new Set(order).size).toBe(500);
  });

  it("phase handlers run around the graph settle", () => {
    const k = createKernel({ lane: "manual" });
    const s = k.graph.signal(0);
    const log: string[] = [];
    k.graph.effect(() => log.push(`effect ${k.graph.read(s)}`));
    k.phase("render", () => log.push(`render ${k.graph.read(s)}`));
    k.phase("input", () => k.graph.write(s, 5));
    k.graph.write(s, 1);
    k.flush("manual");
    expect(log).toEqual(["effect 0", "effect 5", "render 5"]);
  });
});

describe("hooks", () => {
  it("one ordered stream with seq, time and system id", () => {
    const clock = createVirtualClock(100);
    const k = createKernel({ clock });
    const events: KernelEvent[] = [];
    k.hooks.on((e) => events.push(e));
    k.hooks.emit("custom", { x: 1 });
    clock.advanceTo(150);
    k.hooks.emit("other");
    expect(events).toEqual([
      { t: 100, seq: 1, sys: k.id, at: "custom", x: 1 },
      { t: 150, seq: 2, sys: k.id, at: "other" },
    ]);
    expect(JSON.parse(serializeEvent(events[0]!))).toEqual({
      v: 1,
      ...events[0],
    });
  });

  it("data cannot overwrite the record's own fields", () => {
    const k = createKernel();
    const events: KernelEvent[] = [];
    k.hooks.on((e) => events.push(e));
    k.hooks.emit("a", { seq: 99, at: "b" });
    expect(events[0]).toMatchObject({ seq: 1, at: "a" });
  });

  it("unsubscribe stops delivery; a throwing listener does not starve others", () => {
    const k = createKernel();
    const a: string[] = [];
    k.hooks.on(() => {
      throw Error("listener");
    });
    const off = k.hooks.on((e) => a.push(e.at));
    expect(() => k.hooks.emit("one")).toThrow("listener");
    off();
    expect(() => k.hooks.emit("two")).toThrow("listener");
    expect(a).toEqual(["one"]);
  });

  it("flushes appear on the stream with their lane", () => {
    const k = createKernel({ lane: "sync" });
    const events: KernelEvent[] = [];
    k.hooks.on((e) => events.push(e));
    const s = k.graph.signal(0);
    k.graph.effect(() => k.graph.read(s));
    k.graph.write(s, 1);
    expect(events.map((e) => [e.at, e.lane])).toEqual([["flush", "sync"]]);
  });
});

describe("kernel services", () => {
  it("ctx.extend applies extenders per phase, in order", () => {
    const k = createKernel();
    k.ctx.extend("constraints", (ctx) => {
      ctx.a = 1;
    });
    const off = k.ctx.extend("constraints", (ctx) => {
      ctx.b = (ctx.a as number) + 1;
    });
    k.ctx.extend("render", (ctx) => {
      ctx.r = true;
    });
    expect(k.ctx.make("constraints", {})).toEqual({ a: 1, b: 2 });
    off();
    expect(k.ctx.make("constraints", { z: 0 })).toEqual({ z: 0, a: 1 });
    expect(() => k.ctx.extend("nope" as any, () => {})).toThrow();
  });

  it("snapshot parts dump and load; rng is a built-in part", () => {
    const k = createKernel({ rng: 7 });
    let n = 3;
    k.snapshot.contribute("n", {
      dump: () => n,
      load: (v: number) => {
        n = v;
      },
    });
    expect(() => k.snapshot.contribute("n", { dump() {}, load() {} })).toThrow(
      /already exists/,
    );
    const snap = k.snapshot.dump();
    expect(Object.keys(snap)).toEqual(["rng", "n"]);
    const before = [k.rng(), k.rng()];
    n = 9;
    k.snapshot.load(JSON.parse(JSON.stringify(snap)));
    expect(n).toBe(3);
    expect([k.rng(), k.rng()]).toEqual(before);
  });

  it("define / has / version", () => {
    const k = createKernel();
    expect(k.version).toBe(KERNEL_VERSION);
    expect(k.has("scheduler")).toBe(true);
    expect(k.has("history")).toBe(false);
    const api = { undo() {} };
    k.define("history", api);
    expect(k.has("history")).toBe(true);
    expect(k.features.history).toBe(api);
    expect(() => k.define("history", {})).toThrow(/already defined/);
    expect(() => k.define("graph", {})).toThrow(/already defined/);
    expect(k.has("toString")).toBe(false);
  });
});

describe("isolation and trees", () => {
  it("two kernels share nothing by default", () => {
    const a = createKernel({ lane: "sync" });
    const b = createKernel({ lane: "sync" });
    expect(a.scheduler).not.toBe(b.scheduler);
    expect(a.clock).not.toBe(b.clock);
    const ea: KernelEvent[] = [];
    a.hooks.on((e) => ea.push(e));
    b.hooks.emit("b");
    a.define("x", 1);
    expect(ea).toEqual([]);
    expect(b.has("x")).toBe(false);
    const sa = a.graph.signal(0);
    const sb = b.graph.signal(0);
    const seen: string[] = [];
    a.graph.effect(() => seen.push(`a${a.graph.read(sa)}`));
    b.graph.effect(() => seen.push(`b${b.graph.read(sb)}`));
    a.graph.write(sa, 1);
    expect(seen).toEqual(["a0", "b0", "a1"]);
  });

  it("a child shares scheduler, clock and sink; has its own graph and rng", () => {
    const h = manualMicro();
    const parent = createKernel({ scheduler: h.scheduler, rng: 5 });
    const child = createKernel({ parent });
    expect(child.parent).toBe(parent);
    expect(parent.children).toEqual([child]);
    expect(child.scheduler).toBe(parent.scheduler);
    expect(child.clock).toBe(parent.clock);
    expect(child.graph).not.toBe(parent.graph);
    expect(child.rng).not.toBe(parent.rng);
    expect(child.id).not.toBe(parent.id);
    const events: KernelEvent[] = [];
    parent.hooks.on((e) => events.push(e));
    child.hooks.emit("c");
    parent.hooks.emit("p");
    expect(events.map((e) => [e.sys, e.seq])).toEqual([
      [child.id, 1],
      [parent.id, 2],
    ]);
    // The child's seed is drawn from the parent's rng: deterministic.
    const again = createKernel({ parent: createKernel({ rng: 5 }) });
    expect(again.rng.state).toBe(child.rng.state);
  });

  it("disposing a parent disposes its children and leaves the scheduler", () => {
    const h = manualMicro();
    const parent = createKernel({ scheduler: h.scheduler });
    const child = createKernel({ parent });
    const s = child.graph.signal(0);
    const seen: number[] = [];
    child.graph.effect(() => seen.push(child.graph.read(s)));
    child.graph.write(s, 1);
    const events: string[] = [];
    parent.hooks.on((e) => events.push(`${e.at}:${e.sys}`));
    parent.dispose();
    parent.dispose();
    h.run();
    expect(seen).toEqual([0]);
    expect(events).toEqual([`dispose:${child.id}`, `dispose:${parent.id}`]);
    expect(parent.children).toEqual([]);
    expect(h.scheduler.pending()).toBe(false);
  });
});

/**
 * A small random program over a kernel tree: writes, timers, rng draws and
 * flushes, driven by one seed. Returns the serialized event stream.
 */
function program(seed: number): string {
  const drive = createRng(seed);
  const clock = createVirtualClock();
  const scheduler = createScheduler({
    micro: (cb) => clock.setTimeout(cb, 0, { kind: "micro" }),
    frame: (cb) => clock.setTimeout(cb, 16, { kind: "frame" }),
    idle: (cb) => clock.setTimeout(cb, 50, { kind: "idle" }),
  });
  const lanes = ["sync", "micro", "frame", "idle", "manual"] as const;
  const root = createKernel({ scheduler, clock, rng: seed });
  const kernels = [root];
  for (let i = 0; i < 3; i++) {
    kernels.push(
      createKernel({
        parent: kernels[Math.floor(drive() * kernels.length)]!,
        lane: lanes[Math.floor(drive() * lanes.length)]!,
      }),
    );
  }
  const out: string[] = [];
  root.hooks.on((e) => out.push(serializeEvent(e)));
  const sigs = kernels.map((k) => {
    const s = k.graph.signal(0);
    const d = k.graph.computed(() => k.graph.read(s) * 2);
    k.graph.effect(() => {
      k.hooks.emit("saw", { d: k.graph.read(d), r: k.rng() });
    });

    return s;
  });
  for (let step = 0; step < 20; step++) {
    const i = Math.floor(drive() * kernels.length);
    const k = kernels[i]!;
    const op = Math.floor(drive() * 4);
    if (op === 0) {
      k.graph.write(sigs[i]!, Math.floor(drive() * 5));
    } else if (op === 1) {
      const v = Math.floor(drive() * 5);
      clock.setTimeout(
        () => k.graph.write(sigs[i]!, v),
        Math.floor(drive() * 40),
        {
          owner: k.id,
          kind: "set",
        },
      );
    } else if (op === 2) {
      clock.advanceTo(clock.now() + Math.floor(drive() * 30));
    } else {
      k.flush();
    }
  }
  clock.advanceTo(clock.now() + 1000);
  scheduler.flush();

  return out.join("\n");
}

describe("determinism", () => {
  it("same seed and same events give the same stream, 1,000 seeds", () => {
    const distinct = new Set<string>();
    for (let seed = 1; seed <= 1000; seed++) {
      const a = program(seed);
      const b = program(seed);
      if (a !== b) {
        throw Error(`seed ${seed} diverged`);
      }
      distinct.add(a);
    }
    // The fuzz actually explores: different seeds give different streams.
    expect(distinct.size).toBeGreaterThan(900);
  });
});
