/**
 * Regressions from the PR #202 review (T1–T9). Each failed on the first L0b
 * cut and passes now.
 */
import { describe, expect, it } from "vitest";
import { createRng, createVirtualClock } from "../clock.js";
import { createKernel } from "../kernel.js";
import { withPhases } from "../phases.js";
import { type HostCallback, createScheduler } from "../scheduler.js";

function manual() {
  const cbs: Array<() => void> = [];
  const micro: HostCallback = (cb) => {
    cbs.push(cb);
  };

  return {
    scheduler: createScheduler({
      micro,
      frame: micro,
      idle: micro,
      maxPasses: 5,
    }),
    cbs,
    run() {
      for (const cb of cbs.splice(0)) {
        cb();
      }
    },
  };
}

describe("L0b review regressions", () => {
  it("T1 a lane that did not settle does not wedge its targets", () => {
    const h = manual();
    let n = 0;
    const t = {
      flush() {
        if (n++ < 50) {
          h.scheduler.request("micro", t);
        }
      },
    };
    h.scheduler.request("micro", t);
    expect(() => h.run()).toThrow(/did not settle/);
    expect(h.scheduler.pending()).toBe(false);
    let flushed = 0;
    t.flush = () => {
      flushed++;
    };
    h.scheduler.request("micro", t);
    h.run();
    h.scheduler.flush("micro");
    expect(flushed).toBe(1);
  });

  it("T2 a request made during a settle gets another pass (constraints re-run)", () => {
    const h = manual();
    const k = createKernel({ scheduler: h.scheduler });
    const fact = k.graph.signal(0);
    const log: string[] = [];
    const phases = withPhases(k);
    phases.on("constraints", () =>
      log.push(`constraints sees ${k.graph.read(fact)}`),
    );
    phases.on("resolvers", () => {
      if (k.graph.read(fact) === 0) {
        k.graph.write(fact, 1);
        k.request();
      }
    });
    k.request();
    h.run();
    h.run();
    expect(log).toEqual(["constraints sees 0", "constraints sees 1"]);
    // Plain scheduler targets get the same: a self-request flushes again.
    let flushes = 0;
    const t = {
      flush() {
        if (++flushes === 1) {
          h.scheduler.request("manual", t);
        }
      },
    };
    h.scheduler.request("manual", t);
    h.scheduler.flush("manual");
    expect(flushes).toBe(2);
  });

  it("T3 a disposed kernel ignores writes and never re-registers", () => {
    const h = manual();
    const k = createKernel({ scheduler: h.scheduler });
    const s = k.graph.signal(0);
    let runs = 0;
    k.graph.effect(() => {
      k.graph.read(s);
      runs++;
    });
    k.dispose();
    expect(k.disposed).toBe(true);
    k.graph.write(s, 1);
    k.request();
    k.flush();
    h.run();
    h.scheduler.flush();
    expect(runs).toBe(1);
    expect(h.cbs.length).toBe(0);
    expect(h.scheduler.pending()).toBe(false);
  });

  it("T4 a throwing flush listener does not lose the graph settle", () => {
    const h = manual();
    const k = createKernel({ scheduler: h.scheduler });
    const s = k.graph.signal(0);
    const seen: number[] = [];
    k.graph.effect(() => seen.push(k.graph.read(s)));
    let boom = true;
    k.hooks.on((e) => {
      if (e.at === "flush" && boom) {
        boom = false;
        throw Error("x");
      }
    });
    k.graph.write(s, 1);
    expect(() => h.run()).toThrow("x");
    h.run();
    expect(seen).toEqual([0, 1]);
  });

  it("T5 creating a child does not perturb the parent's rng; seeds are pure", () => {
    const a = createKernel({ rng: createRng(7) });
    const b = createKernel({ rng: createRng(7) });
    const child = createKernel({ parent: b });
    expect(b.rng!()).toBe(a.rng!());
    // An unrelated kernel registered first does not change the child seed.
    const scheduler = createScheduler();
    createKernel({ scheduler });
    const b2 = createKernel({ scheduler, rng: createRng(7) });
    expect(createKernel({ parent: b2 }).rng!.seed).toBe(child.rng!.seed);
    // The second child gets a different, equally pure seed.
    expect(createKernel({ parent: b }).rng!.seed).toBe(
      createRng(7).fork(1).seed,
    );
  });

  it("T6 a 0 ms self-rescheduling timer cannot hang advanceTo", () => {
    const c = createVirtualClock();
    let n = 0;
    const tick = () => {
      if (++n < 100000) {
        c.setTimeout(tick, 0);
      }
    };
    c.setTimeout(tick, 0);
    expect(() => c.advanceTo(10)).toThrow(/did not settle/);
    expect(n).toBe(1000);
    expect(c.now()).toBe(0);
    expect(c.timers().length).toBe(1);
    // A finite chain at one deadline completes, pass by pass.
    const d = createVirtualClock();
    let m = 0;
    const step = () => {
      if (++m < 5) {
        d.setTimeout(step, 0);
      }
    };
    d.setTimeout(step, 0);
    d.advanceTo(10);
    expect([m, d.now()]).toEqual([5, 10]);
  });

  it("T7 500 kernels share one host callback; sync nested writes settle", () => {
    const h = manual();
    const ks = Array.from({ length: 500 }, () =>
      createKernel({ scheduler: h.scheduler }),
    );
    const sigs = ks.map((k) => k.graph.signal(0));
    let total = 0;
    ks.forEach((k, i) =>
      k.graph.effect(() => {
        k.graph.read(sigs[i]!);
        total++;
      }),
    );
    ks.forEach((k, i) => k.graph.write(sigs[i]!, 1));
    expect(h.cbs.length).toBe(1);
    h.run();
    expect(total).toBe(1000);
    expect(h.cbs.length).toBe(0);
    const k = createKernel({ lane: "sync" });
    const a = k.graph.signal(0);
    const b = k.graph.signal(0);
    const seen: number[] = [];
    k.graph.effect(() => {
      const v = k.graph.read(a);
      if (v) {
        k.graph.write(b, v * 10);
      }
    });
    k.graph.effect(() => seen.push(k.graph.read(b)));
    k.graph.write(a, 1);
    expect(seen).toEqual([0, 10]);
  });

  it("T8 effects run only at the final settle, never between phases", () => {
    const h = manual();
    const k = createKernel({ scheduler: h.scheduler });
    const f = k.graph.signal(0);
    const seen: number[] = [];
    k.graph.effect(() => seen.push(k.graph.read(f)));
    const phases = withPhases(k);
    phases.on("input", () => k.graph.write(f, 1));
    phases.on("resolvers", () => k.graph.write(f, 2));
    k.graph.write(f, -1);
    h.run();
    expect(seen).toEqual([0, 2]);
  });

  it("T9 dispose clears the kernel's timers, listeners and runs onDispose", () => {
    const p = createKernel({ clock: createVirtualClock() });
    const c = createKernel({ parent: p });
    let fired = 0;
    let heard = 0;
    let hooked = 0;
    c.clock.setTimeout(() => fired++, 5, { owner: c.id });
    p.clock.setTimeout(() => fired++, 5, { owner: p.id });
    c.hooks.on(() => heard++);
    c.onDispose(() => hooked++);
    const off = c.onDispose(() => hooked++);
    off();
    c.dispose();
    c.dispose();
    p.clock.advanceTo(10);
    p.hooks.emit("x");
    expect([fired, heard, hooked]).toEqual([1, 1, 1]);
    expect(c.hooks.on(() => heard++)).toBeTypeOf("function");
    p.hooks.emit("y");
    expect(heard).toBe(1);
  });
});
