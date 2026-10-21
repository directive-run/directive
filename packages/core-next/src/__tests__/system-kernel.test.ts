import { describe, expect, it } from "vitest";
import { createModule, createSystemCore } from "../api/core.js";
import { withEffects } from "../api/effects.js";
import { withObserve } from "../api/observe.js";
import { withPlugins } from "../api/plugins.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";
import { createVirtualClock } from "../clock.js";
import { createScheduler } from "../scheduler.js";

const counter = (runs: number[] = []) =>
  createModule("counter", {
    schema: {
      facts: { count: t.number() },
      derivations: { doubled: t.number() },
    },
    init: (facts) => {
      facts.count = 0;
    },
    derive: { doubled: (facts) => facts.count * 2 },
    effects: {
      log: {
        run: (facts: { count: number }) => {
          runs.push(facts.count);
        },
      },
    },
  });

/** A scheduler whose micro lane runs only when the test says so. */
function manualMicro() {
  const queued: Array<() => void> = [];
  const scheduler = createScheduler({ micro: (cb) => queued.push(cb) });

  return {
    scheduler,
    queued,
    tick() {
      for (const cb of queued.splice(0)) {
        cb();
      }
    },
  };
}

describe("a system on the kernel", () => {
  it("runs its reconcile pass on the scheduler it is given", () => {
    const { scheduler, queued, tick } = manualMicro();
    const runs: number[] = [];
    const system = createSystemCore({ module: counter(runs) }, [withEffects], {
      scheduler,
    });
    system.start();
    tick();
    const before = runs.length;
    system.facts.count = 1;
    expect(scheduler.pending("micro")).toBe(true);
    expect(runs.length).toBe(before);
    expect(queued.length).toBe(1);
    tick();
    expect(runs.at(-1)).toBe(1);
    expect(scheduler.pending()).toBe(false);
    expect(system.isSettled).toBe(true);
  });

  it("flushes two systems sharing a scheduler in one host callback", () => {
    const { scheduler, queued, tick } = manualMicro();
    const a: number[] = [];
    const b: number[] = [];
    const sa = createSystemCore({ module: counter(a) }, [withEffects], {
      scheduler,
    });
    const sb = createSystemCore({ module: counter(b) }, [withEffects], {
      scheduler,
    });
    sa.start();
    sb.start();
    expect(queued.length).toBe(1);
    tick();
    sa.facts.count = 5;
    sb.facts.count = 7;
    expect(queued.length).toBe(1);
    tick();
    expect(a.at(-1)).toBe(5);
    expect(b.at(-1)).toBe(7);
    expect(queued.length).toBe(0);
  });

  it("stops scheduling once destroyed", () => {
    const { scheduler, tick } = manualMicro();
    const runs: number[] = [];
    const system = createSystemCore({ module: counter(runs) }, [withEffects], {
      scheduler,
    });
    system.start();
    tick();
    system.destroy();
    const count = runs.length;
    system.facts.count = 3;
    expect(scheduler.pending()).toBe(false);
    tick();
    expect(runs.length).toBe(count);
  });

  it("notifies derivation subscribers on the sync lane, before the write returns", () => {
    const { scheduler } = manualMicro();
    const system = createSystemCore({ module: counter() }, [], { scheduler });
    system.start();
    const seen: unknown[] = [];
    system.subscribe(["doubled"], () => seen.push(system.read("doubled")));
    system.read("doubled");
    system.facts.count = 2;
    expect(seen).toEqual([4]);
    expect(scheduler.pending("sync")).toBe(false);
  });

  it("throws 1.35's runaway error when a subscriber keeps re-triggering", () => {
    const system = createSystemCore({ module: counter() });
    system.start();
    system.read("doubled");
    // In a batch, so the store's own loop guard is not what trips.
    system.subscribe(["doubled"], () => {
      system.read("doubled");
      system.batch(() => {
        system.facts.count = (system.facts.count as number) + 1;
      });
    });
    expect(() => {
      system.batch(() => {
        system.facts.count = 1;
      });
    }).toThrow("Infinite derivation notification loop detected after 100");
  });

  it("feeds plugins and observers from one record on the kernel stream", async () => {
    const calls: unknown[][] = [];
    const system = createSystemCore({ module: counter() }, [
      withObserve,
      withPlugins([
        {
          name: "spy",
          onFactSet: (...args: unknown[]) => calls.push(args),
        },
      ]),
    ]);
    const events: unknown[] = [];
    system.observe((event) => events.push(event));
    system.start();
    system.facts.count = 4;
    await system.settle();
    expect(calls).toContainEqual(["count", 4, 0]);
    expect(events).toContainEqual({
      type: "fact.change",
      key: "count",
      prev: 0,
      next: 4,
      origin: "authored",
    });
  });

  it("times when() on the kernel's clock", async () => {
    const clock = createVirtualClock();
    const system = createSystemCore({ module: counter() }, [], { clock });
    system.start();
    const done = system.when(() => false, { timeout: 50 });
    expect(clock.timers()).toHaveLength(1);
    clock.advanceTo(50);
    await expect(done).rejects.toThrow("when: timed out after 50ms");
  });

  it("gives each 1.35 system its own kernel", async () => {
    const a: number[] = [];
    const b: number[] = [];
    const sa = createSystem({ module: counter(a) });
    const sb = createSystem({ module: counter(b) });
    sa.start();
    sb.start();
    sa.facts.count = 9;
    await sa.settle();
    await sb.settle();
    expect(a.at(-1)).toBe(9);
    expect(b.at(-1)).toBe(0);
    expect(sb.facts.count).toBe(0);
  });
});
