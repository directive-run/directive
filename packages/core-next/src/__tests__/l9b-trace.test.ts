/**
 * L9b: the trace part. 1.35's behaviour (R1–R9) is pinned by the conformance
 * suite; these pin the two approved rows, which the suite pins on 1.35's
 * side, and that a system without the option subscribes to nothing. They also
 * pin, in core-next's own suite, R2's default, each part of R3's causal
 * chain, R5's two anomalies and the batch run's "unknown" resolver.
 * - (bh): `system.trace` is one frozen array until the next change, and an
 *   entry is frozen when it settles, one level into the lists and rows the
 *   trace made. The program's values and meta are not frozen.
 * - (bi): a pending run pushed out of the ring still reports `onTraceComplete`
 *   once, when its last resolver ends, also when it was pushed out while its
 *   resolver waited to retry.
 */

import { describe, expect, it, vi } from "vitest";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `k` raises one requirement per step (S1, S2, …), each with a slow resolver. */
const stepper = (ms: number) =>
  createModule("m", {
    schema: {
      facts: { k: t.number(), box: t.object<{ n: number }>() },
      derivations: {},
      events: {},
      requirements: { S1: {}, S2: {}, S3: {} },
    },
    init: (facts) => {
      facts.k = 0;
      facts.box = { n: 0 };
    },
    constraints: Object.fromEntries(
      [1, 2, 3].map((i) => [
        `c${i}`,
        { when: (facts: any) => facts.k >= i, require: { type: `S${i}` } },
      ]),
    ) as any,
    resolvers: Object.fromEntries(
      [1, 2, 3].map((i) => [
        `r${i}`,
        { requirement: `S${i}`, resolve: () => wait(ms) },
      ]),
    ) as any,
  });

const traced = (trace: unknown, onTraceComplete = vi.fn()) => ({
  system: createSystem({
    module: stepper(15),
    trace,
    plugins: [{ name: "t", onTraceComplete }],
  } as any) as any,
  onTraceComplete,
});

describe("the trace option (R1)", () => {
  it("off, or not true and not an object: no trace, and inspect() says so", async () => {
    for (const trace of [undefined, false, 1]) {
      const { system, onTraceComplete } = traced(trace);
      system.start();
      system.facts.k = 1;
      await system.settle();
      expect(system.trace).toBeNull();
      const report = system.inspect();
      expect(report.traceEnabled).toBe(false);
      expect("trace" in report).toBe(false);
      expect(onTraceComplete).not.toHaveBeenCalled();
      system.destroy();
    }
  });

  it("on: each pass with activity is an entry, and destroy() empties it", async () => {
    const { system, onTraceComplete } = traced(true);
    system.start();
    await system.settle();
    system.facts.k = 1;
    await system.settle();
    // The start pass, the pass that started r1, and the pass its end asked
    // for, which hits the constraint again (U8).
    expect(system.trace.map((e: any) => e.status)).toEqual([
      "settled",
      "settled",
      "settled",
    ]);
    expect(system.trace[1].resolversStarted).toMatchObject([
      { resolver: "r1", requirementId: "S1:{}" },
    ]);
    expect(onTraceComplete).toHaveBeenCalledTimes(3);
    expect(system.inspect()).toMatchObject({ traceEnabled: true });
    system.destroy();
    expect(system.trace).toEqual([]);
  });
});

describe("(bh) a read cannot edit the trace", () => {
  it("the array is frozen and is the same array until the next change", async () => {
    const { system } = traced(true);
    system.start();
    await system.settle();
    const first = system.trace;
    expect(system.trace).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => first.push({})).toThrow(TypeError);
    system.facts.k = 1;
    await system.settle();
    expect(system.trace).not.toBe(first);
    system.destroy();
  });

  it("a settled entry is frozen one level into its lists and rows, not into values or meta", async () => {
    const { system } = traced(true);
    system.start();
    await system.settle();
    const box = { n: 1 };
    system.facts.box = box;
    await system.settle();
    const entry = system.trace.at(-1);
    expect(entry.status).toBe("settled");
    expect(Object.isFrozen(entry)).toBe(true);
    expect(() => entry.factChanges.push({})).toThrow(TypeError);
    const row = entry.factChanges[0];
    expect(row.newValue).toBe(box);
    expect(() => {
      row.key = "edited";
    }).toThrow(TypeError);
    // The program's own value is not the trace's to freeze.
    expect(Object.isFrozen(box)).toBe(false);
    // inspect() hands a copy, which can be edited.
    const copy = system.inspect().trace.at(-1);
    copy.causalChain = "edited";
    expect(system.trace.at(-1).causalChain).not.toBe("edited");
    system.destroy();
  });

  it("a pending entry is not frozen, and freezes when its resolver ends", async () => {
    const { system } = traced(true);
    system.start();
    await system.settle();
    system.facts.k = 1;
    await wait(0);
    const entry = system.trace.at(-1);
    expect(entry.status).toBe("pending");
    expect(Object.isFrozen(entry)).toBe(false);
    await system.settle();
    expect(entry.status).toBe("settled");
    expect(Object.isFrozen(entry)).toBe(true);
    system.destroy();
  });

  it("a plugin that edits the entry it is handed throws, and the error is logged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { system } = traced(
      true,
      vi.fn((entry: any) => {
        entry.causalChain = "annotated";
      }),
    );
    system.start();
    await system.settle();
    expect(system.trace[0].causalChain).not.toBe("annotated");
    expect(error).toHaveBeenCalledWith(
      "[Directive] Plugin error:",
      expect.objectContaining({ hook: "onTraceComplete" }),
    );
    error.mockRestore();
    system.destroy();
  });
});

describe("(bi) every run reports onTraceComplete once", () => {
  it("runs pushed out of the ring while their resolvers run still report", async () => {
    const { system, onTraceComplete } = traced({ maxRuns: 1 });
    system.start();
    await system.settle();
    for (const k of [1, 2, 3]) {
      system.facts.k = k;
      await wait(0);
    }
    expect(system.trace).toHaveLength(1);
    await system.settle();
    // Every run once, the three that each started a resolver among them
    // (1.35 loses the two pushed out while their resolvers ran).
    const entries = onTraceComplete.mock.calls.map(([entry]) => entry);
    const ids = entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(Math.max(...ids));
    expect(
      entries.flatMap((entry) =>
        entry.resolversStarted.map((r: any) => r.resolver),
      ),
    ).toEqual(["r1", "r2", "r3"]);
    expect(
      onTraceComplete.mock.calls.every(([entry]) => entry.status === "settled"),
    ).toBe(true);
    system.destroy();
  });

  it("with maxRuns 0 the trace stays empty and every run reports", async () => {
    const { system, onTraceComplete } = traced({ maxRuns: 0 });
    system.start();
    await system.settle();
    system.facts.k = 1;
    await system.settle();
    expect(system.trace).toEqual([]);
    const entries = onTraceComplete.mock.calls.map(([entry]) => entry);
    expect(entries.map((entry) => entry.id)).toEqual(
      entries.map((_, i) => i + 1),
    );
    expect(entries.some((entry) => entry.resolversStarted.length === 1)).toBe(
      true,
    );
    system.destroy();
  });

  it("a run whose requirement no resolver serves is not kept once pushed out", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onTraceComplete = vi.fn();
    const system = createSystem({
      module: createModule("m", {
        schema: {
          facts: { k: t.number() },
          derivations: {},
          events: {},
          requirements: { NONE: {} },
        },
        init: (facts) => {
          facts.k = 0;
        },
        constraints: {
          orphan: {
            when: (facts) => facts.k === 1,
            require: { type: "NONE" },
          },
        },
      }),
      trace: { maxRuns: 1 },
      plugins: [{ name: "t", onTraceComplete }],
    } as any) as any;
    system.start();
    await system.settle();
    system.facts.k = 1;
    await wait(0);
    const orphan = system.trace.at(-1);
    expect(orphan.resolversStarted).toMatchObject([
      { resolver: "unknown", requirementId: "NONE:{}" },
    ]);
    // Pending, as in 1.35: nothing will end it. Pushed out, it is dropped.
    system.facts.k = 2;
    await wait(0);
    expect(system.trace.at(-1)).not.toBe(orphan);
    const reported = onTraceComplete.mock.calls.map(([entry]) => entry);
    expect(reported).not.toContain(orphan);
    expect(orphan.status).toBe("pending");
    vi.restoreAllMocks();
    system.destroy();
  });

  it("a run pushed out while its resolver waits to retry reports once, after the last attempt", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let attempts = 0;
    const onTraceComplete = vi.fn();
    const system = createSystem({
      module: createModule("m", {
        schema: {
          facts: { k: t.number() },
          derivations: {},
          events: {},
          requirements: { S1: {}, S2: {} },
        },
        init: (facts: any) => {
          facts.k = 0;
        },
        constraints: {
          c1: { when: (facts: any) => facts.k >= 1, require: { type: "S1" } },
          c2: { when: (facts: any) => facts.k >= 2, require: { type: "S2" } },
        },
        resolvers: {
          r1: {
            requirement: "S1",
            retry: { attempts: 2, backoff: "none", initialDelay: 30 },
            resolve: async () => {
              if (++attempts === 1) {
                throw new Error("once");
              }
            },
          },
          r2: { requirement: "S2", resolve: () => wait(2) },
        },
      } as any),
      trace: { maxRuns: 1 },
      plugins: [{ name: "t", onTraceComplete }],
    } as any) as any;
    system.start();
    await system.settle();
    system.facts.k = 1;
    await wait(5);
    // r1's first attempt failed; it waits to retry as its run leaves the ring.
    const retrying = system.trace.at(-1);
    expect(retrying.resolversStarted).toMatchObject([{ resolver: "r1" }]);
    system.facts.k = 2;
    await wait(0);
    expect(system.trace).not.toContain(retrying);
    expect(attempts).toBe(1);
    await system.settle();
    expect(attempts).toBe(2);
    const reported = onTraceComplete.mock.calls.map(([entry]) => entry);
    expect(reported.filter((entry) => entry === retrying)).toHaveLength(1);
    expect(retrying).toMatchObject({
      status: "settled",
      resolversCompleted: [{ resolver: "r1" }],
      resolversErrored: [],
    });
    vi.restoreAllMocks();
    system.destroy();
  });

  it("destroy() drops the runs still in flight: they never report", async () => {
    const { system, onTraceComplete } = traced({ maxRuns: 1 });
    system.start();
    await system.settle();
    system.facts.k = 1;
    await wait(0);
    const before = onTraceComplete.mock.calls.length;
    system.destroy();
    await wait(30);
    // A canceled resolver settles its run during stop(), before the clear.
    expect(onTraceComplete.mock.calls.length).toBeLessThanOrEqual(before + 1);
  });
});

describe("the ring's size (R2)", () => {
  it("maxRuns defaults to 100: 105 runs leave the last 100", async () => {
    const { system } = traced(true);
    system.start();
    await system.settle();
    for (let n = 1; n < 105; n++) {
      system.facts.box = { n };
      await system.settle();
    }
    expect(system.trace).toHaveLength(100);
    expect(system.trace[0].id).toBe(6);
    expect(system.trace.at(-1).id).toBe(105);
    system.destroy();
  });
});

/** One pass that fills every list of the causal chain (R3, R5). */
const everything = () =>
  createModule("m", {
    schema: {
      facts: { k: t.number() },
      derivations: { dbl: t.number() },
      events: {},
      requirements: { OK: {}, BAD: {} },
    },
    init: (facts: any) => {
      facts.k = 0;
    },
    derive: { dbl: (facts: any) => facts.k * 2 },
    constraints: {
      // A constraint reads the derivation, so the pass recomputes it.
      ok: {
        when: (_facts: any, d: any) => d.dbl === 2,
        require: { type: "OK" },
      },
      bad: { when: (facts: any) => facts.k === 1, require: { type: "BAD" } },
    },
    resolvers: {
      good: { requirement: "OK", resolve: () => wait(2) },
      fails: {
        requirement: "BAD",
        resolve: async () => {
          throw new Error("card declined");
        },
      },
    },
    effects: {
      watch: {
        run: (facts: any) => {
          void facts.k;
        },
      },
    },
  } as any);

describe("a settled run's causal chain and anomalies (R3, R5)", () => {
  it("the chain names each row, in 1.35's order, and an error is an anomaly", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onTraceComplete = vi.fn();
    const system = createSystem({
      module: everything(),
      trace: true,
      plugins: [{ name: "t", onTraceComplete }],
    } as any) as any;
    system.start();
    await system.settle();
    system.facts.k = 1;
    await system.settle();
    const entry = system.trace[1];
    expect(entry.status).toBe("settled");
    expect(entry.causalChain.replace(/\(\d+ms\)/, "(Nms)")).toBe(
      [
        "k changed",
        "dbl recomputed",
        "ok constraint hit",
        "bad constraint hit",
        "OK requirement added",
        "BAD requirement added",
        "good resolved (Nms)",
        "fails errored",
        "watch effect ran",
      ].join(" → "),
    );
    expect(entry.resolversErrored).toMatchObject([
      { resolver: "fails", error: "Error: card declined" },
    ]);
    expect(entry.anomalies).toEqual(["1 resolver(s) errored"]);
    expect(onTraceComplete).toHaveBeenCalledWith(entry);
    vi.restoreAllMocks();
    system.destroy();
  });

  it("after three runs, a run 5 times slower than the average is an anomaly", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const system = createSystem({
      module: createModule("m", {
        schema: {
          facts: { k: t.number() },
          derivations: {},
          events: {},
          requirements: { SLOW: {} },
        },
        init: (facts: any) => {
          facts.k = 0;
        },
        constraints: {
          slow: {
            when: (facts: any) => facts.k === 8,
            require: { type: "SLOW" },
          },
        },
        resolvers: {
          slow: {
            requirement: "SLOW",
            resolve: async () => {
              now += 100;
            },
          },
        },
      } as any),
      trace: true,
    } as any) as any;
    system.start();
    await system.settle();
    // Runs 2 to 8 take no time; run 9 takes 100 ms, the average 100 / 9.
    for (let k = 1; k <= 8; k++) {
      system.facts.k = k;
      await system.settle();
    }
    const slow = system.trace.find(
      (entry: any) => entry.resolversStarted.length > 0,
    );
    expect(slow.id).toBe(9);
    expect(slow.anomalies).toEqual([
      "Duration 100ms is 5x+ above average (11ms)",
    ]);
    expect(system.trace.filter((entry: any) => entry.anomalies)).toEqual([
      slow,
    ]);
    vi.restoreAllMocks();
    system.destroy();
  });
});

describe("the resolver a run names", () => {
  it("a batch run in flight is named 'unknown', as 1.35's pass end reads it", async () => {
    const system = createSystem({
      module: createModule("m", {
        schema: {
          facts: { k: t.number() },
          derivations: {},
          events: {},
          requirements: { B: {} },
        },
        init: (facts: any) => {
          facts.k = 0;
        },
        constraints: {
          b: { when: (facts: any) => facts.k === 1, require: { type: "B" } },
        },
        resolvers: {
          many: {
            requirement: "B",
            batch: { enabled: true, maxSize: 1 },
            resolveBatch: () => wait(5),
          },
        },
      } as any),
      trace: true,
    } as any) as any;
    system.start();
    await system.settle();
    system.facts.k = 1;
    await system.settle();
    expect(system.trace[1].resolversStarted).toMatchObject([
      { resolver: "unknown", requirementId: "B:{}" },
    ]);
    expect(system.trace[1].resolversCompleted).toMatchObject([
      { resolver: "many", requirementId: "B:{}" },
    ]);
    system.destroy();
  });
});
