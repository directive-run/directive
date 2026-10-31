/**
 * L2a: the reconcile pass, constraints and resolver dispatch.
 *
 * The three GATE-1 quirks this slice fixes (b, e, j) are pinned here, not in
 * the conformance suite: 1.35 behaves the other way. Every timer runs on a
 * virtual kernel clock, so each test controls time exactly.
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
const flush = () => new Promise((r) => setTimeout(r, 0));

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((r) => {
    open = r;
  });

  return { promise, open };
}

function outcomes() {
  const log = {
    starts: [] as string[],
    completed: 0,
    canceled: 0,
    errors: 0,
    retries: 0,
    /** Every start and outcome, in the order reported. */
    order: [] as string[],
  };
  const plugin = {
    name: "outcomes",
    onResolverStart: (_r: string, req: { id: string }) => {
      log.starts.push(req.id);
      log.order.push("start");
    },
    onResolverComplete: () => {
      log.completed++;
      log.order.push("complete");
    },
    onResolverCancel: () => {
      log.canceled++;
      log.order.push("cancel");
    },
    onResolverError: () => {
      log.errors++;
      log.order.push("error");
    },
    onResolverRetry: () => {
      log.retries++;
    },
  };

  return { log, plugin };
}

function build(definition: Record<string, unknown>, plugin: object) {
  const clock = createVirtualClock();
  const mod = createModule("m", {
    schema: {
      facts: { go: t.boolean(), n: t.number(), want: t.boolean() },
      derivations: {},
      events: {},
      requirements: {},
    },
    init: (f: any) => {
      f.go = false;
      f.n = 0;
      f.want = false;
    },
    ...definition,
  } as never);
  const system = createSystemCore(
    { module: mod } as never,
    [withReconcile, withPlugins([plugin as never])],
    { clock, scheduler: createScheduler() },
  ) as any;

  return { system, clock };
}

describe("quirk b: exactly one outcome per run", () => {
  it("a run retracted during its retry wait reports one outcome, cancel", async () => {
    const { log, plugin } = outcomes();
    const { system, clock } = build(
      {
        constraints: {
          load: { when: (f: any) => f.want, require: { type: "LOAD" } },
        },
        resolvers: {
          load: {
            requirement: "LOAD",
            retry: { attempts: 3, initialDelay: 100 },
            resolve: async () => {
              throw new Error("down");
            },
          },
        },
      },
      plugin,
    );
    system.start();
    system.facts.want = true;
    await flush();
    expect(log.starts).toHaveLength(1);
    // The first attempt failed: the run waits 100 ms on the kernel clock.
    const waits = clock.timers().filter((tm) => tm.kind === "retry");
    expect(waits).toHaveLength(1);
    system.facts.want = false;
    await flush();
    expect(log).toMatchObject({ canceled: 1, errors: 0, completed: 0 });
    // The wait was cleared with the cancel, and nothing more is reported.
    expect(clock.timers().filter((tm) => tm.kind === "retry")).toEqual([]);
    clock.advanceTo(1000);
    await flush();
    expect(log).toMatchObject({ canceled: 1, errors: 0, retries: 0 });
    expect(system.isSettled).toBe(true);
    system.destroy();
  });

  it("a canceled run that later returns reports only the cancel", async () => {
    const { log, plugin } = outcomes();
    const g = gate();
    const { system } = build(
      {
        constraints: {
          load: { when: (f: any) => f.want, require: { type: "LOAD" } },
        },
        resolvers: {
          load: { requirement: "LOAD", resolve: () => g.promise },
        },
      },
      plugin,
    );
    system.start();
    system.facts.want = true;
    await flush();
    system.facts.want = false;
    await flush();
    g.open();
    await flush();
    expect(log).toMatchObject({ canceled: 1, completed: 0, errors: 0 });
    system.destroy();
  });

  it("a timeout reports one error, then a late return and stop() report nothing", async () => {
    const { log, plugin } = outcomes();
    const g = gate();
    const { system, clock } = build(
      {
        constraints: {
          load: { when: (f: any) => f.want, require: { type: "LOAD" } },
        },
        resolvers: {
          load: { requirement: "LOAD", timeout: 50, resolve: () => g.promise },
        },
      },
      plugin,
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    system.start();
    system.facts.want = true;
    await flush();
    // As 1.35's withTimeout: a plain timer, cleared when the race settles,
    // not by stop or destroy (the fuzz harness counts timers at teardown).
    const timeout = clock.timers().find((tm) => tm.kind === "timeout");
    expect(timeout?.owner).toBe(0);
    clock.advanceTo(60);
    await flush();
    expect(log).toMatchObject({ errors: 1, canceled: 0, completed: 0 });
    g.open();
    await flush();
    system.stop();
    expect(log).toMatchObject({ errors: 1, canceled: 0, completed: 0 });
    system.destroy();
  });

  // Review of #264: the run left flight only after its outcome was reported,
  // so the pass its own write scheduled found it and reported a cancel too.
  for (const mode of ["sync", "async"] as const) {
    it(`a run whose own ${mode} write retracts its requirement reports one outcome`, async () => {
      const { log, plugin } = outcomes();
      const retract =
        mode === "sync"
          ? (_req: unknown, ctx: any) => {
              ctx.facts.want = false;
            }
          : async (_req: unknown, ctx: any) => {
              await Promise.resolve();
              ctx.facts.want = false;
            };
      const { system } = build(
        {
          constraints: {
            load: { when: (f: any) => f.want, require: { type: "LOAD" } },
          },
          resolvers: { load: { requirement: "LOAD", resolve: retract } },
        },
        plugin,
      );
      system.start();
      system.facts.want = true;
      await flush();
      await flush();
      expect(log.order).toEqual(["start", "complete"]);
      expect(system.isSettled).toBe(true);
      system.destroy();
      expect(log.order).toEqual(["start", "complete"]);
    });
  }

  it("a timeout aborts the attempt's signal (candidate n), reports one error, not a cancel, and keeps its later writes", async () => {
    const { log, plugin } = outcomes();
    const g = gate();
    let signal: AbortSignal | undefined;
    const { system, clock } = build(
      {
        constraints: {
          load: { when: (f: any) => f.want, require: { type: "LOAD" } },
        },
        resolvers: {
          load: {
            requirement: "LOAD",
            timeout: 50,
            resolve: async (_req: unknown, ctx: any) => {
              signal = ctx.signal;
              try {
                await g.promise;
              } finally {
                ctx.facts.n = -1;
              }
            },
          },
        },
      },
      plugin,
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    system.start();
    system.facts.want = true;
    await flush();
    expect(signal?.aborted).toBe(false);
    clock.advanceTo(60);
    await flush();
    // (n), approved: the body is told (1.35 leaves the signal clean). The
    // outcome is still the error, read from the run's signal, not a cancel.
    expect(signal?.aborted).toBe(true);
    expect(String(signal?.reason)).toMatch(/timed out after 50ms/);
    expect(log.order).toEqual(["start", "error"]);
    // The body's cleanup write after the timeout lands (only supersede drops).
    g.open();
    await flush();
    expect(system.facts.n).toBe(-1);
    expect(log.order).toEqual(["start", "error"]);
    system.destroy();
  });

  it("stop() during a timeout wait cancels once and clears the timer", async () => {
    const { log, plugin } = outcomes();
    const { system, clock } = build(
      {
        constraints: {
          load: { when: (f: any) => f.want, require: { type: "LOAD" } },
        },
        resolvers: {
          load: {
            requirement: "LOAD",
            timeout: 50,
            resolve: () => new Promise(() => {}),
          },
        },
      },
      plugin,
    );
    system.start();
    system.facts.want = true;
    await flush();
    system.stop();
    clock.advanceTo(100);
    await flush();
    expect(log).toMatchObject({ canceled: 1, errors: 0, completed: 0 });
    system.destroy();
    expect(clock.timers()).toEqual([]);
  });
});

describe("quirk e: `after` waits only while its dependency may still act", () => {
  const defs = (resolveA: () => unknown, plugin: object) =>
    build(
      {
        constraints: {
          a: { when: (f: any) => f.go, require: { type: "A" } },
          b: {
            after: ["a"],
            when: (f: any) => f.n > 0,
            require: (f: any) => ({ type: "B", n: f.n }),
          },
        },
        resolvers: {
          a: { requirement: "A", resolve: resolveA },
          b: { requirement: "B", resolve: async () => {} },
        },
      },
      plugin,
    );

  it("a dependent asked alone is not held back by one that did not fire", async () => {
    const { log, plugin } = outcomes();
    const { system } = defs(async () => {}, plugin);
    system.start();
    await flush();
    // Only `b` reads `n`: `a` is not asked again, and its answer stands.
    system.facts.n = 1;
    await flush();
    expect(log.starts).toEqual(['B:{"n":1}']);
    system.destroy();
  });

  it("a held dependent is asked once its dependency stops firing", async () => {
    const { log, plugin } = outcomes();
    const g = gate();
    const { system } = defs(() => g.promise, plugin);
    system.start();
    system.facts.go = true;
    system.facts.n = 1;
    await flush();
    // `a` fired and its run is going: `b` waits.
    expect(log.starts).toEqual(["A:{}"]);
    system.facts.go = false;
    await flush();
    expect(log.canceled).toBe(1);
    expect(log.starts).toEqual(["A:{}", 'B:{"n":1}']);
    system.destroy();
  });

  it("a held dependent is asked once its dependency's requirement resolved, not before", async () => {
    const { log, plugin } = outcomes();
    const g = gate();
    const { system } = defs(() => g.promise, plugin);
    system.start();
    system.facts.go = true;
    system.facts.n = 1;
    await flush();
    system.facts.n = 2;
    await flush();
    expect(log.starts).toEqual(["A:{}"]);
    g.open();
    await flush();
    // `a` completed, then `b` ran (and completed) with the latest `n`.
    expect(log.completed).toBe(2);
    expect(log.starts).toEqual(["A:{}", 'B:{"n":2}']);
    system.destroy();
  });

  it("a dependency that resolved, retracted and fired again holds its dependent until the new requirement resolves", async () => {
    const { log, plugin } = outcomes();
    const g = gate();
    let calls = 0;
    const { system } = defs(
      () => (++calls === 1 ? undefined : g.promise),
      plugin,
    );
    system.start();
    system.facts.go = true;
    await flush();
    expect(log.completed).toBe(1);
    system.facts.go = false;
    await flush();
    system.facts.go = true;
    await flush();
    expect(log.starts).toEqual(["A:{}", "A:{}"]);
    // `b` is asked alone while `a`'s new requirement is in flight: it waits.
    system.facts.n = 1;
    await flush();
    expect(log.starts).toEqual(["A:{}", "A:{}"]);
    g.open();
    await flush();
    expect(log.starts).toEqual(["A:{}", "A:{}", 'B:{"n":1}']);
    system.destroy();
  });

  it("a dependent held on the first pass is asked once its dependency is disabled", async () => {
    const { log, plugin } = outcomes();
    const g = gate();
    const { system } = build(
      {
        init: (f: any) => {
          f.go = true;
          f.n = 1;
          f.want = false;
        },
        constraints: {
          a: { when: (f: any) => f.go, require: { type: "A" } },
          b: {
            after: ["a"],
            when: (f: any) => f.n > 0,
            require: (f: any) => ({ type: "B", n: f.n }),
          },
        },
        resolvers: {
          a: { requirement: "A", resolve: () => g.promise },
          b: { requirement: "B", resolve: async () => {} },
        },
      },
      plugin,
    );
    system.start();
    await flush();
    // `a` fired on the first pass: `b` waits, having read nothing.
    expect(log.starts).toEqual(["A:{}"]);
    system.constraints.disable("a");
    await flush();
    expect(log.canceled).toBe(1);
    expect(log.starts).toEqual(["A:{}", 'B:{"n":1}']);
    system.destroy();
  });
});

describe("quirk j: start() after stop() dispatches what is still wanted", () => {
  it("re-dispatches each still-wanted requirement once, and nothing unwanted", async () => {
    const { log, plugin } = outcomes();
    const { system } = build(
      {
        constraints: {
          keep: { when: () => true, require: { type: "KEEP" } },
          drop: { when: (f: any) => f.want, require: { type: "DROP" } },
        },
        resolvers: {
          any: {
            requirement: (req: { type: string }) => req.type !== "",
            resolve: () => new Promise(() => {}),
          },
        },
      },
      plugin,
    );
    system.start();
    system.facts.want = true;
    await flush();
    expect(log.starts.sort()).toEqual(["DROP:{}", "KEEP:{}"]);
    system.stop();
    expect(log.canceled).toBe(2);
    system.facts.want = false;
    system.start();
    await flush();
    system.facts.n = 1;
    await flush();
    expect(log.starts.sort()).toEqual(["DROP:{}", "KEEP:{}", "KEEP:{}"]);
    expect(log.canceled).toBe(2);
    system.destroy();
    expect(log.canceled).toBe(3);
  });
});

describe("zero cost when unused", () => {
  it("a module with no constraints and no resolvers defines no L2 feature", () => {
    const { system } = build({}, { name: "none" });
    system.start();
    expect(system.constraints).toBeUndefined();
    system.destroy();
  });
});

describe("passes follow each settled run, microtask for microtask (1.35)", () => {
  // Fix round of #272 (DIFF_FUZZ_SEED=1): two runs dispatched in one pass,
  // one completes and one throws. 1.35 reports the error two microtasks
  // later than the completion (processRetryError, handleRetryError), and
  // each run asks for its pass as it leaves flight, so each gets its own.
  it("a completion and an error get a pass each", async () => {
    const order: string[] = [];
    const plugin = {
      name: "order",
      onReconcileStart: () => order.push("pass"),
      onRequirementMet: () => order.push("met"),
      onResolverError: () => order.push("error"),
    };
    const { system } = build(
      {
        constraints: {
          a: { when: (f: any) => f.n >= 0, require: { type: "A" } },
          b: { when: (f: any) => f.n >= 0, require: { type: "B" } },
        },
        resolvers: {
          a: { requirement: "A", resolve: async () => {} },
          b: {
            requirement: "B",
            resolve: async () => {
              throw new Error("b");
            },
          },
        },
      },
      plugin,
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    system.start();
    await flush();
    expect(order).toEqual(["pass", "met", "pass", "error", "pass"]);
    system.destroy();
  });

  // Fix round of #272: a run that leaves flight while a pass awaits an async
  // constraint asks for a pass whose microtask finds that pass still open,
  // so 1.35 drops it; no extra pass, so no extra constraint hits.
  it("a run that ends while a pass is open asks for no extra pass", async () => {
    const g = gate();
    let passes = 0;
    /** Times each constraint was found active: inspect()'s hitCount. */
    const hits: Record<string, number> = {};
    const plugin = {
      name: "count",
      onReconcileStart: () => passes++,
      onConstraintEvaluate: (id: string, active: boolean) => {
        if (active) {
          hits[id] = (hits[id] ?? 0) + 1;
        }
      },
    };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { system } = build(
      {
        constraints: {
          // No deps: evaluated in every pass (it warns in development).
          slow: {
            async: true,
            when: async (f: any) => {
              await g.promise;

              return f.want;
            },
            require: { type: "SLOW" },
          },
          fast: { when: (f: any) => f.go, require: { type: "FAST" } },
        },
        resolvers: {
          slow: { requirement: "SLOW", resolve: async () => {} },
          fast: {
            requirement: "FAST",
            resolve: async () => {
              await g.promise;
            },
          },
        },
      },
      plugin,
    );
    system.start();
    system.facts.want = true;
    system.facts.go = true;
    await flush();
    system.facts.go = false;
    await flush();
    g.open();
    await flush();
    await flush();
    expect({ passes, hits }).toEqual({ passes: 2, hits: { slow: 2, fast: 1 } });
    system.destroy();
  });
});

describe("affected constraints are evaluated in 1.35's order", () => {
  // Fix round of #272 (fuzz seed 24301, case 30): 1.35's updateDependencies
  // leaves the key index alone when a constraint's deps are unchanged, so
  // only a constraint whose deps changed moves to the end of a key's set.
  it("a constraint whose deps changed is evaluated after the unchanged ones", async () => {
    const order: string[] = [];
    const plugin = {
      name: "order",
      onConstraintEvaluate: (id: string) => order.push(id),
    };
    const { system } = build(
      {
        constraints: {
          c0: { when: (f: any) => f.n < 0, require: { type: "X" } },
          // Reads `want` only once n >= 1: its deps change in the second pass.
          c1: { when: (f: any) => f.n >= 1 && f.want, require: { type: "X" } },
          c2: { when: (f: any) => f.n < 0, require: { type: "X" } },
        },
        resolvers: {},
      },
      plugin,
    );
    system.start();
    await flush();
    order.push("|");
    system.facts.n = 1;
    await flush();
    order.push("|");
    system.facts.n = 2;
    await flush();
    expect(order.join(" ")).toBe("c0 c1 c2 | c0 c1 c2 | c0 c2 c1");
    system.destroy();
  });
});
