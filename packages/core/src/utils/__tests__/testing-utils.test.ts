import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index";
import { createCoverageTracker, createTestObserver } from "../testing";

function createTestModule() {
  return createModule("cov", {
    schema: {
      facts: { count: t.number(), name: t.string() },
      derivations: { doubled: t.number() },
      requirements: { FIX: {} },
      events: { bump: {} },
    },
    init: (f) => {
      f.count = 0;
      f.name = "";
    },
    derive: { doubled: (f) => f.count * 2 },
    constraints: {
      needsFix: {
        when: (f) => f.count < 0,
        require: { type: "FIX" },
      },
      unused: {
        when: () => false,
        require: null,
      },
    },
    resolvers: {
      fix: {
        requirement: "FIX",
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

describe("createCoverageTracker", () => {
  it("tracks constraints hit", async () => {
    const mod = createTestModule();
    const sys = createSystem({ module: mod });
    sys.start();

    const { run, report } = createCoverageTracker(sys);

    await run(async () => {
      sys.facts.count = -1;
      await sys.settle();
    });

    const coverage = report();
    expect(coverage.constraintsHit.has("needsFix")).toBe(true);
    expect(coverage.constraintsMissed.has("unused")).toBe(true);
    expect(coverage.constraintCoverage).toBeGreaterThan(0);
    expect(coverage.constraintCoverage).toBeLessThan(1);

    sys.destroy();
  });

  it("tracks resolvers run", async () => {
    const mod = createTestModule();
    const sys = createSystem({ module: mod });
    sys.start();

    const { run, report } = createCoverageTracker(sys);

    await run(async () => {
      sys.facts.count = -1;
      await sys.settle();
    });

    const coverage = report();
    expect(coverage.resolversRun.has("fix")).toBe(true);
    expect(coverage.resolverCoverage).toBe(1);

    sys.destroy();
  });

  it("tracks effects run", async () => {
    const mod = createTestModule();
    const sys = createSystem({ module: mod });
    sys.start();

    const { run, report } = createCoverageTracker(sys);

    await run(async () => {
      sys.facts.count = 1;
      await sys.settle();
    });

    const coverage = report();
    expect(coverage.effectsRun.size).toBeGreaterThan(0);
    expect(coverage.effectCoverage).toBeGreaterThan(0);

    sys.destroy();
  });

  it("returns 1.0 coverage when all constraints hit", async () => {
    const mod = createModule("full", {
      schema: {
        facts: { x: t.number() },
        derivations: {},
        requirements: { DO: {} },
        events: {},
      },
      init: (f) => {
        f.x = 0;
      },
      constraints: {
        check: {
          when: (f) => f.x > 0,
          require: { type: "DO" },
        },
      },
      resolvers: {
        doer: {
          requirement: "DO",
          resolve: async () => {},
        },
      },
    });
    const sys = createSystem({ module: mod });
    sys.start();

    const { run, report } = createCoverageTracker(sys);

    await run(async () => {
      sys.facts.x = 1;
      await sys.settle();
    });

    const coverage = report();
    expect(coverage.constraintCoverage).toBe(1);
    expect(coverage.constraintsMissed.size).toBe(0);

    sys.destroy();
  });

  it("returns 1.0 when no constraints defined", () => {
    const mod = createModule("empty", {
      schema: {
        facts: { x: t.number() },
        derivations: {},
        requirements: {},
        events: {},
      },
      init: (f) => {
        f.x = 0;
      },
    });
    const sys = createSystem({ module: mod });
    sys.start();

    const { report } = createCoverageTracker(sys);

    // Don't even need to run a scenario
    const coverage = report();
    expect(coverage.constraintCoverage).toBe(1);
    expect(coverage.resolverCoverage).toBe(1);

    sys.destroy();
  });
});

describe("createTestObserver", () => {
  it("collects events", async () => {
    const mod = createTestModule();
    const sys = createSystem({ module: mod });
    sys.start();

    const observer = createTestObserver(sys);

    sys.facts.count = 5;
    await sys.settle();

    expect(observer.events.length).toBeGreaterThan(0);

    observer.dispose();
    sys.destroy();
  });

  it("ofType filters correctly", async () => {
    const mod = createTestModule();
    const sys = createSystem({ module: mod });
    sys.start();

    const observer = createTestObserver(sys);

    sys.facts.count = 5;
    await sys.settle();

    const factChanges = observer.ofType("fact.change");
    expect(factChanges.length).toBeGreaterThan(0);
    expect(factChanges.every((e) => e.type === "fact.change")).toBe(true);

    observer.dispose();
    sys.destroy();
  });

  it("clear resets events", () => {
    const mod = createTestModule();
    const sys = createSystem({ module: mod });
    sys.start();

    const observer = createTestObserver(sys);

    sys.facts.count = 1;
    expect(observer.events.length).toBeGreaterThan(0);

    observer.clear();
    expect(observer.events.length).toBe(0);

    observer.dispose();
    sys.destroy();
  });

  it("dispose stops collecting", () => {
    const mod = createTestModule();
    const sys = createSystem({ module: mod });
    sys.start();

    const observer = createTestObserver(sys);

    sys.facts.count = 1;
    const countBefore = observer.events.length;

    observer.dispose();

    sys.facts.count = 2;
    expect(observer.events.length).toBe(countBefore);

    sys.destroy();
  });
});
