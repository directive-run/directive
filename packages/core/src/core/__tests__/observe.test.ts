import { describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index";
import type { ObservationEvent } from "../types/system";

function createTestModule() {
  return createModule("obs", {
    schema: {
      facts: { count: t.number() },
      derivations: { doubled: t.number() },
      requirements: { INC: {} },
      events: { bump: {} },
    },
    init: (f) => {
      f.count = 0;
    },
    derive: { doubled: (f) => f.count * 2 },
    constraints: {
      needsInc: {
        when: (f) => f.count < 0,
        require: { type: "INC" },
      },
    },
    resolvers: {
      inc: {
        requirement: "INC",
        resolve: async (_req, context) => {
          context.facts.count = 0;
        },
      },
    },
    effects: {
      log: { run: () => {} },
    },
    events: {
      bump: (f) => {
        f.count += 1;
      },
    },
  });
}

describe("system.observe()", () => {
  it("receives fact.change events", () => {
    const mod = createTestModule();
    const sys = createSystem({ module: mod });
    sys.start();

    const events: ObservationEvent[] = [];
    const unsub = sys.observe((e) => events.push(e));

    sys.facts.count = 42;

    const factChanges = events.filter((e) => e.type === "fact.change");
    expect(factChanges.length).toBeGreaterThan(0);
    const change = factChanges.find(
      (e) => e.type === "fact.change" && e.key === "count",
    );
    expect(change).toBeDefined();
    if (change?.type === "fact.change") {
      expect(change.next).toBe(42);
    }

    unsub();
    sys.destroy();
  });

  it("receives constraint.evaluate events", async () => {
    const mod = createTestModule();
    const sys = createSystem({ module: mod });
    sys.start();

    const events: ObservationEvent[] = [];
    const unsub = sys.observe((e) => events.push(e));

    sys.facts.count = -1;
    await sys.settle();

    const evals = events.filter((e) => e.type === "constraint.evaluate");
    expect(evals.length).toBeGreaterThan(0);

    unsub();
    sys.destroy();
  });

  it("receives resolver.start and resolver.complete events", async () => {
    const mod = createTestModule();
    const sys = createSystem({ module: mod });
    sys.start();

    const events: ObservationEvent[] = [];
    const unsub = sys.observe((e) => events.push(e));

    sys.facts.count = -1;
    await sys.settle();

    const starts = events.filter((e) => e.type === "resolver.start");
    const completes = events.filter((e) => e.type === "resolver.complete");
    expect(starts.length).toBeGreaterThan(0);
    expect(completes.length).toBeGreaterThan(0);

    unsub();
    sys.destroy();
  });

  it("receives effect.run events", async () => {
    const mod = createTestModule();
    const sys = createSystem({ module: mod });
    sys.start();

    const events: ObservationEvent[] = [];
    const unsub = sys.observe((e) => events.push(e));

    sys.facts.count = 1;
    await sys.settle();

    const effectRuns = events.filter((e) => e.type === "effect.run");
    expect(effectRuns.length).toBeGreaterThan(0);

    unsub();
    sys.destroy();
  });

  it("receives reconcile.start and reconcile.end events", async () => {
    const mod = createTestModule();
    const sys = createSystem({ module: mod });
    sys.start();

    const events: ObservationEvent[] = [];
    const unsub = sys.observe((e) => events.push(e));

    sys.facts.count = 5;
    await sys.settle();

    expect(events.some((e) => e.type === "reconcile.start")).toBe(true);

    unsub();
    sys.destroy();
  });

  it("unsubscribe stops events", () => {
    const mod = createTestModule();
    const sys = createSystem({ module: mod });
    sys.start();

    const events: ObservationEvent[] = [];
    const unsub = sys.observe((e) => events.push(e));

    sys.facts.count = 1;
    const countBefore = events.length;

    unsub();

    sys.facts.count = 2;
    expect(events.length).toBe(countBefore);

    sys.destroy();
  });

  it("works with no initial plugins", () => {
    const mod = createTestModule();
    const sys = createSystem({ module: mod });
    sys.start();

    const events: ObservationEvent[] = [];
    const unsub = sys.observe((e) => events.push(e));

    sys.facts.count = 10;

    expect(events.some((e) => e.type === "fact.change")).toBe(true);

    unsub();
    sys.destroy();
  });

  it("caps at 100 observers", () => {
    const mod = createTestModule();
    const sys = createSystem({ module: mod });
    sys.start();

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unsubs: (() => void)[] = [];

    for (let i = 0; i < 101; i++) {
      unsubs.push(sys.observe(() => {}));
    }

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Maximum observer limit"),
    );

    for (const unsub of unsubs) unsub();
    warnSpy.mockRestore();
    sys.destroy();
  });
});
