/**
 * L2c: constraint binding (RFC-0003), as 1.35 does it.
 *
 * The conformance suite pins the headline rules (a clobbered write is
 * dropped and aborts the run, ten reports then a summary, a detached run's
 * writes land). These pin the edges it does not reach: the check is by
 * value at the run's own write, a listener's write to a bound key during
 * the run's write is caught at the next one, siblings dispatched in one
 * pass share one baseline, each attempt starts again from that baseline,
 * a clobbered run reports no outcome, and a detached run reports its own
 * outcome without asking for a pass.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystemCore } from "../api/core.js";
import { withPlugins } from "../api/plugins.js";
import { withReconcile } from "../api/reconcile.js";
import { t } from "../api/schema-builders.js";
import { createVirtualClock } from "../clock.js";
import { createScheduler } from "../scheduler.js";

afterEach(() => vi.restoreAllMocks());

/** Let microtasks and the scheduler's flushes run. */
const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
};

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((r) => {
    open = r;
  });

  return { promise, open };
}

function recorder() {
  const log = {
    order: [] as string[],
    rejected: [] as Record<string, unknown>[],
    disabled: [] as unknown[][],
  };
  const plugin = {
    name: "recorder",
    onResolverStart: (r: string) => log.order.push(`start:${r}`),
    onResolverComplete: (r: string) => log.order.push(`complete:${r}`),
    onResolverCancel: (r: string) => log.order.push(`cancel:${r}`),
    onResolverError: (r: string) => log.order.push(`error:${r}`),
    onResolverWriteRejected: (e: Record<string, unknown>) =>
      log.rejected.push(e),
    onConstraintBindingDisabled: (...args: unknown[]) =>
      log.disabled.push(args),
  };

  return { log, plugin };
}

function build(definition: Record<string, unknown>) {
  const { log, plugin } = recorder();
  const mod = createModule("m", {
    schema: {
      facts: {
        go: t.boolean(),
        k: t.number(),
        other: t.number(),
        n: t.number(),
      },
      derivations: {},
      events: {},
      requirements: {},
    },
    init: (f: any) => {
      f.go = false;
      f.k = 0;
      f.other = 0;
      f.n = 0;
    },
    ...definition,
  } as never);
  const clock = createVirtualClock();
  const system = createSystemCore(
    { module: mod } as never,
    [withReconcile, withPlugins([plugin as never])],
    { clock, scheduler: createScheduler() },
  ) as any;

  return { system, log, clock };
}

/** One bound constraint (`abortOn: ["k"]`) and its resolver. */
function bound(resolve: (context: any) => Promise<void>, extra = {}) {
  return build({
    constraints: {
      load: {
        when: (f: any) => f.go,
        require: { type: "LOAD" },
        abortOn: ["k"],
      },
    },
    resolvers: {
      load: {
        requirement: "LOAD",
        resolve: (_req: unknown, context: any) => resolve(context),
        ...extra,
      },
    },
  });
}

describe("the check is by value, at the run's own write", () => {
  it("a key changed and changed back meanwhile is not a clobber (1.35 compares values)", async () => {
    const g = gate();
    let signal: AbortSignal | undefined;
    const { system, log } = bound(async (context) => {
      signal = context.signal;
      await g.promise;
      context.facts.k = 5;
    });
    system.start();
    system.facts.go = true;
    await flush();
    system.facts.k = 9;
    system.facts.k = 0;
    await flush();
    g.open();
    await flush();
    expect(system.facts.k).toBe(5);
    expect(signal?.aborted).toBe(false);
    expect(log.rejected).toEqual([]);
    system.destroy();
  });

  it("a run that never writes the key is not aborted by an outside write to it", async () => {
    const g = gate();
    let signal: AbortSignal | undefined;
    const { system, log } = bound(async (context) => {
      signal = context.signal;
      await g.promise;
      context.facts.other = 1;
    });
    system.start();
    system.facts.go = true;
    await flush();
    system.facts.k = 9;
    await flush();
    expect(signal?.aborted).toBe(false);
    g.open();
    await flush();
    expect(system.facts.other).toBe(1);
    expect(log.rejected).toEqual([]);
    expect(log.order).toEqual(["start:load", "complete:load"]);
    system.destroy();
  });

  it("a listener's write to the bound key during the run's write is caught at the run's next write", async () => {
    const g = gate();
    const { system, log } = bound(async (context) => {
      await g.promise;
      context.facts.k = 1;
      context.facts.k = 2;
    });
    system.start();
    system.facts.go = true;
    await flush();
    const off = system.facts.$store.subscribe(["k"], () => {
      if (system.facts.k === 1) {
        system.facts.k = 7;
      }
    });
    g.open();
    await flush();
    off();
    expect(system.facts.k).toBe(7);
    expect(log.rejected).toMatchObject([
      { kind: "rejection", fact: "k", expected: 1, actual: 7 },
    ]);
    system.destroy();
  });

  it("a listener's write to another key during the run's write changes nothing", async () => {
    const g = gate();
    let signal: AbortSignal | undefined;
    const { system, log } = bound(async (context) => {
      signal = context.signal;
      await g.promise;
      context.facts.k = 1;
      context.facts.k = 2;
    });
    system.start();
    system.facts.go = true;
    await flush();
    const off = system.facts.$store.subscribe(["k"], () => {
      system.facts.other = system.facts.k;
    });
    g.open();
    await flush();
    off();
    expect(system.facts.k).toBe(2);
    expect(signal?.aborted).toBe(false);
    expect(log.rejected).toEqual([]);
    system.destroy();
  });

  it("a delete of the bound key is checked like a write", async () => {
    const g = gate();
    const { system, log } = bound(async (context) => {
      await g.promise;
      // biome-ignore lint/performance/noDelete: the delete path is what is tested
      delete context.facts.k;
    });
    system.start();
    system.facts.go = true;
    await flush();
    system.facts.k = 3;
    g.open();
    await flush();
    expect(system.facts.k).toBe(3);
    expect(log.rejected).toMatchObject([
      { kind: "rejection", fact: "k", expected: 0, actual: 3 },
    ]);
    system.destroy();
  });

  it("a write through $store is not the run's: its next bound write is rejected (1.35)", async () => {
    const g = gate();
    const { system, log } = bound(async (context) => {
      await g.promise;
      context.facts.$store.set("k", 4);
      context.facts.k = 5;
    });
    system.start();
    system.facts.go = true;
    await flush();
    g.open();
    await flush();
    expect(system.facts.k).toBe(4);
    expect(log.rejected).toMatchObject([{ fact: "k", expected: 0, actual: 4 }]);
    system.destroy();
  });

  it("an outside write after the run ended reports nothing; the ended run's own late write is still checked (1.35)", async () => {
    let late = (_v: number) => {};
    const { system, log } = bound(async (context) => {
      late = (v) => {
        context.facts.k = v;
      };
    });
    system.start();
    system.facts.go = true;
    await flush();
    expect(log.order).toEqual(["start:load", "complete:load"]);
    system.facts.k = 8;
    await flush();
    expect(log.rejected).toEqual([]);
    // A leaked context: 1.35's bound view outlives the run, so the write
    // is dropped and reported, and no second outcome follows.
    late(9);
    await flush();
    expect(system.facts.k).toBe(8);
    expect(log.rejected).toMatchObject([{ fact: "k", expected: 0, actual: 8 }]);
    expect(log.order).toEqual(["start:load", "complete:load"]);
    system.destroy();
  });
});

describe("a clobbered run", () => {
  it("reports no outcome, and its requirement waits unmet until it is asked again (1.35)", async () => {
    const g = gate();
    let runs = 0;
    const { system, log } = bound(async (context) => {
      runs++;
      await g.promise;
      context.facts.k = 1;
    });
    system.start();
    system.facts.go = true;
    await flush();
    system.facts.k = 50;
    await flush();
    g.open();
    await flush();
    expect(log.order).toEqual(["start:load"]);
    expect(system.isSettled).toBe(true);
    expect(runs).toBe(1);
    system.destroy();
  });

  it("a body that throws once clobbered reports no error, and is not retried", async () => {
    const g = gate();
    let runs = 0;
    const { system, log } = bound(
      async (context) => {
        runs++;
        await g.promise;
        context.facts.k = 1;
        throw new Error("after the clobber");
      },
      { retry: { attempts: 3, backoff: "none", initialDelay: 1 } },
    );
    system.start();
    system.facts.go = true;
    await flush();
    system.facts.k = 50;
    await flush();
    g.open();
    await flush();
    expect(runs).toBe(1);
    expect(log.order).toEqual(["start:load"]);
    system.destroy();
  });
});

describe("one baseline per pass, from before any run starts", () => {
  it("a sibling's synchronous write to a shared bound key is a clobber for the later sibling", async () => {
    const { system, log } = build({
      constraints: {
        first: {
          when: (f: any) => f.go,
          require: { type: "A" },
          abortOn: ["k"],
        },
        second: {
          when: (f: any) => f.go,
          require: { type: "B" },
          abortOn: ["k"],
        },
      },
      resolvers: {
        a: {
          requirement: "A",
          resolve: async (_r: unknown, context: any) => {
            context.facts.k = 1;
          },
        },
        b: {
          requirement: "B",
          resolve: async (_r: unknown, context: any) => {
            await Promise.resolve();
            context.facts.k = 2;
          },
        },
      },
    });
    system.start();
    system.facts.go = true;
    await flush();
    expect(system.facts.k).toBe(1);
    expect(log.rejected).toMatchObject([
      { resolver: "b", fact: "k", expected: 0, actual: 1 },
    ]);
    system.destroy();
  });

  it("each attempt starts again from the dispatch baseline: a retry's write over its own first attempt's is rejected (1.35)", async () => {
    let attempt = 0;
    const { system, log, clock } = bound(
      async (context) => {
        attempt++;
        context.facts.k = attempt;
        if (attempt === 1) {
          throw new Error("first");
        }
      },
      { retry: { attempts: 2, backoff: "none", initialDelay: 1 } },
    );
    system.start();
    system.facts.go = true;
    await flush();
    clock.advanceTo(clock.now() + 5);
    await flush();
    expect(attempt).toBe(2);
    expect(system.facts.k).toBe(1);
    expect(log.rejected).toMatchObject([{ fact: "k", expected: 0, actual: 1 }]);
    system.destroy();
  });
});

describe("detach", () => {
  it("a retracted bound run is not canceled: it reports its own outcome and asks for no pass", async () => {
    const g = gate();
    let signal: AbortSignal | undefined;
    const { system, log } = bound(async (context) => {
      signal = context.signal;
      await g.promise;
      context.facts.other = 1;
    });
    system.start();
    system.facts.go = true;
    await flush();
    system.facts.go = false;
    await flush();
    expect(log.order).toEqual(["start:load"]);
    // Out of flight: settle does not wait for it.
    expect(system.isSettled).toBe(true);
    g.open();
    await flush();
    expect(signal?.aborted).toBe(false);
    expect(system.facts.other).toBe(1);
    expect(log.order).toEqual(["start:load", "complete:load"]);
    system.destroy();
  });

  it("an unbound retracted run is canceled, as before", async () => {
    const g = gate();
    let signal: AbortSignal | undefined;
    const { system, log } = build({
      constraints: {
        load: { when: (f: any) => f.go, require: { type: "LOAD" } },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          resolve: async (_r: unknown, context: any) => {
            signal = context.signal;
            await g.promise;
          },
        },
      },
    });
    system.start();
    system.facts.go = true;
    await flush();
    system.facts.go = false;
    await flush();
    expect(signal?.aborted).toBe(true);
    expect(log.order).toEqual(["start:load", "cancel:load"]);
    g.open();
    system.destroy();
  });
});

describe("binding on an async constraint", () => {
  it("is off, reported once per constraint and reason, with a development warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const g = gate();
    const { system, log } = build({
      constraints: {
        load: {
          async: true,
          deps: ["go"],
          when: async (f: any) => f.go,
          require: { type: "LOAD" },
          abortOn: ["k"],
        },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          resolve: async (_r: unknown, context: any) => {
            await g.promise;
            context.facts.k = 1;
          },
        },
      },
    });
    system.start();
    system.facts.go = true;
    await flush();
    system.facts.k = 9;
    g.open();
    await flush();
    expect(system.facts.k).toBe(1);
    expect(log.rejected).toEqual([]);
    expect(log.disabled).toEqual([["load", "async-declared"]]);
    expect(
      warn.mock.calls.filter((c) => String(c[0]).includes("abortOn")),
    ).toHaveLength(1);
    system.destroy();
  });
});

describe("a dropped write still counts as the run's own (1.35's recordRunWrites)", () => {
  /**
   * `when: go && k === 0`, bound to k. The first run's body: another writer
   * sets k to 5, the run writes `drop` to k (dropped, a clobber), then it
   * waits; once released it writes other and n. Later runs write n.
   */
  function scenario(drop: number, outside: number[] = [5]) {
    const g = gate();
    let runs = 0;
    let signal: AbortSignal | undefined;
    const built = build({
      constraints: {
        load: {
          when: (f: any) => f.go && f.k === 0,
          require: { type: "LOAD" },
          abortOn: ["k"],
        },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          resolve: async (_req: unknown, context: any) => {
            runs++;
            if (runs > 1) {
              context.facts.n = runs;

              return;
            }
            signal = context.signal;
            for (const value of outside) {
              built.system.facts.k = value;
            }
            context.facts.k = drop;
            await g.promise;
            context.facts.other = 7;
            context.facts.n = 70;
          },
        },
      },
    });

    return {
      ...built,
      signal: () => signal,
      async play() {
        built.system.start();
        built.system.facts.go = true;
        await flush();
        // The requirement comes back while the first run still waits.
        built.system.facts.k = 0;
        await flush();
        g.open();
        await flush();
      },
    };
  }

  it("a changing write the binding dropped makes up for the other writer's change: satisfied, then superseded", async () => {
    const { system, log, signal, play } = scenario(6);
    await play();
    expect(signal()?.aborted).toBe(true);
    expect(log.rejected).toHaveLength(1);
    // Satisfied, so still in flight when the requirement came back: the new
    // run supersedes it and its late writes drop.
    expect(log.order).toEqual([
      "start:load",
      "cancel:load",
      "start:load",
      "complete:load",
    ]);
    expect([system.facts.k, system.facts.other, system.facts.n]).toEqual([
      0, 0, 2,
    ]);
    system.destroy();
  });

  it("a dropped write of the value already there is not counted: detached, its late writes land", async () => {
    const { system, log, play } = scenario(5);
    await play();
    expect(log.order).toEqual(["start:load", "start:load", "complete:load"]);
    expect([system.facts.k, system.facts.other, system.facts.n]).toEqual([
      0, 7, 70,
    ]);
    system.destroy();
  });

  it("counts, not writers: one dropped write does not make up for three changes", async () => {
    const { system, log, play } = scenario(6, [5, 4, 5]);
    await play();
    expect(log.order).toEqual(["start:load", "start:load", "complete:load"]);
    expect([system.facts.other, system.facts.n]).toEqual([7, 70]);
    system.destroy();
  });
});
