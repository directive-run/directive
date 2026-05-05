import { createModule, createSystem, t } from "@directive-run/core";
import { flushAsync } from "@directive-run/core/testing";
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { clearAllTimelines, recordTimeline } from "../index.js";
import { matchers, registerMatchers } from "../matchers.js";

// Register the matchers explicitly so the side-effect-on-import path
// doesn't have to fire.
registerMatchers(expect);

interface CounterDeps {
  loadInitial: () => Promise<number>;
}

function buildCounter(deps: CounterDeps) {
  return createModule("counter", {
    schema: {
      facts: {
        count: t.number(),
        status: t.string<"idle" | "loading" | "ready">(),
      },
      events: { LOAD: {}, INC: {} },
      requirements: { FETCH: {} },
    },
    init: (f) => {
      f.count = 0;
      f.status = "idle";
    },
    constraints: {
      load: {
        when: (f) => f.status === "loading",
        require: { type: "FETCH" },
      },
    },
    resolvers: {
      initialLoader: {
        requirement: "FETCH",
        resolve: async (_req, ctx) => {
          ctx.facts.count = await deps.loadInitial();
          ctx.facts.status = "ready";
        },
      },
    },
    events: {
      LOAD: (f) => {
        if (f.status === "idle") f.status = "loading";
      },
      INC: (f) => {
        f.count += 1;
      },
    },
  });
}

describe("R1.B matchers — toReachInMs", () => {
  it("passes when fact reaches the value within the budget", async () => {
    clearAllTimelines();
    const sys = createSystem({
      module: buildCounter({ loadInitial: async () => 7 }),
    });
    const t1 = recordTimeline(sys, { id: "reach-pass" });
    sys.start();
    sys.events.LOAD();
    await flushAsync();

    // @ts-expect-error — matchers register at runtime; consumers add their own type augmentation (see matchers.ts header)
    expect(t1).toReachInMs("status", "ready", 1_000);
    sys.destroy();
  });

  it("fails when fact never reaches the expected value", () => {
    clearAllTimelines();
    const sys = createSystem({
      module: buildCounter({ loadInitial: async () => 7 }),
    });
    const t1 = recordTimeline(sys, { id: "reach-never" });
    sys.start();
    // Don't dispatch LOAD — status stays 'idle' forever.

    const result = matchers.toReachInMs(t1, "status", "ready", 1_000);
    expect(result.pass).toBe(false);
    expect(result.message()).toContain("never reached");
    sys.destroy();
  });

  it("supports vitest .not for negation", async () => {
    clearAllTimelines();
    const sys = createSystem({
      module: buildCounter({ loadInitial: async () => 7 }),
    });
    const t1 = recordTimeline(sys, { id: "reach-not" });
    sys.start();
    // Don't load — status never becomes 'ready'.

    // @ts-expect-error — matchers register at runtime; see matchers.ts
    expect(t1).not.toReachInMs("status", "ready", 1_000);
    sys.destroy();
  });
});

describe("R1.B matchers — toFireConstraint", () => {
  it("passes when constraint fired at least once", async () => {
    clearAllTimelines();
    const sys = createSystem({
      module: buildCounter({ loadInitial: async () => 7 }),
    });
    const t1 = recordTimeline(sys, { id: "fire-pass" });
    sys.start();
    sys.events.LOAD();
    await flushAsync();

    // @ts-expect-error — matchers register at runtime; see matchers.ts
    expect(t1).toFireConstraint("load");
    sys.destroy();
  });

  it("supports exact times option", async () => {
    clearAllTimelines();
    const sys = createSystem({
      module: buildCounter({ loadInitial: async () => 7 }),
    });
    const t1 = recordTimeline(sys, { id: "fire-times" });
    sys.start();
    sys.events.LOAD();
    await flushAsync();

    // The 'load' constraint fires once when status enters 'loading'
    // and not again after status leaves 'loading'.
    const result = matchers.toFireConstraint(t1, "load", { times: 1 });
    expect(result.pass).toBe(true);
    sys.destroy();
  });

  it("fails when constraint never fired", async () => {
    clearAllTimelines();
    const sys = createSystem({
      module: buildCounter({ loadInitial: async () => 7 }),
    });
    const t1 = recordTimeline(sys, { id: "fire-miss" });
    sys.start();
    // Don't dispatch LOAD — load constraint never fires.

    const result = matchers.toFireConstraint(t1, "load");
    expect(result.pass).toBe(false);
    sys.destroy();
  });
});

describe("R1.B matchers — toResolveWithinMs", () => {
  it("passes when resolver completed within budget", async () => {
    clearAllTimelines();
    const sys = createSystem({
      module: buildCounter({ loadInitial: async () => 7 }),
    });
    const t1 = recordTimeline(sys, { id: "resolve-pass" });
    sys.start();
    sys.events.LOAD();
    await flushAsync();

    // initialLoader is synchronous-ish; should easily fit in 5_000ms
    // @ts-expect-error — matchers register at runtime; see matchers.ts
    expect(t1).toResolveWithinMs("initialLoader", 5_000);
    sys.destroy();
  });

  it("fails when resolver never completed", async () => {
    clearAllTimelines();
    const sys = createSystem({
      module: buildCounter({ loadInitial: async () => 7 }),
    });
    const t1 = recordTimeline(sys, { id: "resolve-miss" });
    sys.start();
    // Don't dispatch LOAD — initialLoader never fires.

    const result = matchers.toResolveWithinMs(t1, "initialLoader", 1_000);
    expect(result.pass).toBe(false);
    expect(result.message()).toContain("never completed");
    sys.destroy();
  });
});

describe("R1.B matchers — toCascade", () => {
  it("returns true when ≥2 constraints fire in same reconcile", () => {
    clearAllTimelines();
    // Synthetic frame stream: two constraint.evaluate(active=true)
    // frames within one reconcile cycle.
    const synthetic = {
      id: "cascade",
      startedAtMs: 0,
      frames: [
        { ts: 0, event: { type: "reconcile.start" as const } },
        {
          ts: 1,
          event: {
            type: "constraint.evaluate" as const,
            id: "a",
            active: true,
          },
        },
        {
          ts: 2,
          event: {
            type: "constraint.evaluate" as const,
            id: "b",
            active: true,
          },
        },
        {
          ts: 3,
          event: {
            type: "reconcile.end" as const,
            resolversCompleted: 0,
            resolversCanceled: 0,
          },
        },
      ],
      stop: () => {},
    };

    const result = matchers.toCascade(synthetic as never);
    expect(result.pass).toBe(true);
  });

  it("returns false when no reconcile cycle has ≥2 active constraints", () => {
    const synthetic = {
      id: "no-cascade",
      startedAtMs: 0,
      frames: [
        { ts: 0, event: { type: "reconcile.start" as const } },
        {
          ts: 1,
          event: {
            type: "constraint.evaluate" as const,
            id: "a",
            active: true,
          },
        },
        {
          ts: 2,
          event: {
            type: "reconcile.end" as const,
            resolversCompleted: 0,
            resolversCanceled: 0,
          },
        },
      ],
      stop: () => {},
    };

    const result = matchers.toCascade(synthetic as never);
    expect(result.pass).toBe(false);
  });
});

describe("R1.B matchers — toMutate", () => {
  it("returns true when MUTATE-shaped fact change appears", () => {
    const synthetic = {
      id: "mutate",
      startedAtMs: 0,
      frames: [
        {
          ts: 1,
          event: {
            type: "fact.change" as const,
            key: "pendingMutation",
            prev: null,
            next: {
              kind: "submit",
              payload: { values: ["a"] },
              status: "pending",
              error: null,
            },
          },
        },
      ],
      stop: () => {},
    };

    const result = matchers.toMutate(synthetic as never, "submit");
    expect(result.pass).toBe(true);
  });

  it("returns false when no matching mutation appears", () => {
    const synthetic = {
      id: "no-mutate",
      startedAtMs: 0,
      frames: [],
      stop: () => {},
    };

    const result = matchers.toMutate(synthetic as never, "submit");
    expect(result.pass).toBe(false);
  });
});

describe("R1.B matchers — input validation", () => {
  it("toReachInMs rejects null input", () => {
    expect(() => matchers.toReachInMs(null as never, "x", 1, 100)).toThrow(
      /expected a Timeline/,
    );
  });

  it("toReachInMs rejects input without frames array", () => {
    expect(() =>
      matchers.toReachInMs({ id: "x" } as never, "x", 1, 100),
    ).toThrow(/frames is missing/);
  });
});
