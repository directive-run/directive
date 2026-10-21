import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystemCore } from "../api/core.js";
import { withEffects } from "../api/effects.js";
import { withObserve } from "../api/observe.js";
import { withPlugins } from "../api/plugins.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";
import { createVirtualClock } from "../clock.js";
import { createScheduler } from "../scheduler.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** An effect that dispatches `inc` through the captured system while n > 0. */
function selfWaking(limit = Number.POSITIVE_INFINITY) {
  const runs: number[] = [];
  let sys: any;
  const module = createModule("chain", {
    schema: { facts: { n: t.number() }, events: { inc: {} } },
    init: (f) => {
      f.n = 0;
    },
    events: {
      inc: (f) => {
        f.n = f.n + 1;
      },
    },
    effects: {
      e: {
        run: (f: { n: number }) => {
          runs.push(f.n);
          if (f.n > 0 && f.n < limit) {
            sys.events.inc();
          }
        },
      },
    },
  });

  return { module, runs, bind: (s: unknown) => (sys = s) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("effect-driven reconcile passes (1.35 parity)", () => {
  it("cuts a self-waking chain after 100 passes, warns, and stays live", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { module, runs, bind } = selfWaking();
    const sys = bind(createSystem({ module })) as any;
    sys.start();
    await Promise.resolve();
    sys.events.inc();
    await sleep(20);
    // 1 start pass + 1 pass from inc + 100 chained passes (1.35: 102).
    expect(runs.length).toBe(102);
    expect(sys.facts.n).toBe(102);
    expect(sys.isSettled).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "[Directive] Effects kept waking each other for 100 passes in a row",
      ),
    );
    runs.length = 0;
    sys.facts.n = -100;
    await sleep(5);
    expect(runs).toEqual([-100]);
    expect(sys.isSettled).toBe(true);
    sys.destroy();
  });

  it("runs each follow-up pass on its own microtask (ticks 2,3,4)", async () => {
    const { module, bind } = selfWaking(3);
    const ticks: number[] = [];
    let tick = 0;
    const sys = bind(
      createSystem({
        module,
        plugins: [{ name: "p", onReconcileStart: () => ticks.push(tick) }],
      }),
    ) as any;
    sys.start();
    tick = 0;
    const ticker = (async () => {
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
        tick++;
      }
    })();
    await Promise.resolve();
    sys.events.inc();
    await ticker;
    await sleep(5);
    expect(ticks).toEqual([0, 2, 3, 4]);
    sys.destroy();
  });

  it("a lane that fails to settle does not wedge the system", () => {
    const queued: Array<() => void> = [];
    const scheduler = createScheduler({
      micro: (cb) => queued.push(cb),
      maxPasses: 2,
    });
    const tick = () => {
      for (const cb of queued.splice(0)) {
        cb();
      }
    };
    const runs: number[] = [];
    const module = createModule("c", {
      schema: { facts: { count: t.number() } },
      init: (f) => {
        f.count = 0;
      },
      effects: {
        log: {
          run: (f: { count: number }) => {
            runs.push(f.count);
          },
        },
      },
    });
    const sys = createSystemCore({ module }, [withEffects], { scheduler });
    sys.start();
    tick();
    let loop = true;
    const foreign = {
      flush() {
        if (loop) {
          sys.facts.count = sys.facts.count + 1;
          scheduler.request("micro", foreign);
        }
      },
    };
    scheduler.request("micro", foreign);
    expect(tick).toThrow("[Directive] micro lane did not settle");
    loop = false;
    expect(sys.isSettled).toBe(false);
    sys.facts.count = 100;
    tick();
    expect(runs.at(-1)).toBe(100);
    expect(sys.isSettled).toBe(true);
    sys.destroy();
  });
});

describe("timer owners", () => {
  it("destroying one system never clears another's timers on a shared clock", async () => {
    const clock = createVirtualClock();
    const module = () =>
      createModule("m", {
        schema: { facts: { x: t.number() } },
        init: (f) => {
          f.x = 0;
        },
      });
    // Same clock, separate schedulers: both kernels have id 0.
    const a = createSystemCore({ module: module() }, [], {
      clock,
      scheduler: createScheduler(),
    });
    const b = createSystemCore({ module: module() }, [], {
      clock,
      scheduler: createScheduler(),
    });
    a.start();
    b.start();
    const pa = a.when(() => false, { timeout: 50 });
    pa.catch(() => {});
    b.when(() => false, { timeout: 50 }).catch(() => {});
    const owners = clock.timers().map((tm) => tm.owner);
    expect(new Set(owners).size).toBe(2);
    expect(owners).not.toContain(0);
    b.destroy();
    expect(clock.timers().length).toBe(1);
    clock.advanceTo(60);
    await expect(pa).rejects.toThrow("when: timed out after 50ms");
    a.destroy();
    expect(clock.timers()).toEqual([]);
  });
});

describe("after destroy (1.35 parity)", () => {
  it("plugins and observers still hear writes; writes are accepted", () => {
    const seen: string[] = [];
    const module = createModule("d", {
      schema: { facts: { x: t.number() } },
      init: (f) => {
        f.x = 0;
      },
    });
    const sys = createSystemCore({ module }, [
      withObserve,
      withPlugins([
        {
          name: "p",
          onFactSet: (k: string, v: unknown) => seen.push(`set ${k}=${v}`),
        },
      ]),
    ]);
    sys.observe((e: any) => {
      if (e.type === "fact.change") {
        seen.push(`obs ${e.key}=${e.next}`);
      }
    });
    sys.start();
    sys.destroy();
    seen.length = 0;
    sys.facts.x = 9;
    expect(sys.facts.x).toBe(9);
    expect(seen).toEqual(["set x=9", "obs x=9"]);
  });

  it("an observer throwing in a batch is logged per key, 1.35 wording", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const module = createModule("o", {
      schema: { facts: { x: t.number(), y: t.number() } },
      init: (f) => {
        f.x = 0;
        f.y = 0;
      },
    });
    const sys = createSystemCore({ module }, [withObserve, withPlugins()]);
    const keys: string[] = [];
    sys.observe((e: any) => {
      if (e.type === "fact.change") {
        keys.push(e.key);
        throw new Error("obs");
      }
    });
    sys.start();
    keys.length = 0;
    error.mockClear();
    sys.batch(() => {
      sys.facts.x = 1;
      sys.facts.y = 1;
    });
    expect(keys).toEqual(["x", "y"]);
    expect(error).toHaveBeenCalledWith(
      '[Directive] Observer threw on fact "x"; the remaining keys in this batch were still delivered.',
      expect.any(Error),
    );
    sys.destroy();
  });

  it("warns on an unknown event with 1.35's text", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const module = createModule("u", {
      schema: { facts: { x: t.number() }, events: { go: {} } },
      init: (f) => {
        f.x = 0;
      },
      events: { go: () => {} },
    });
    const sys = createSystem({ module });
    sys.start();
    sys.dispatch({ type: "nope" } as never);
    expect(warn).toHaveBeenCalledWith(
      '[Directive] Unknown event type "nope". No handler is registered for this event. Available events: go',
    );
    sys.destroy();
  });
});
