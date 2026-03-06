import { describe, it, expect, vi, afterEach } from "vitest";
import { createDiscoverySession } from "../discovery.js";

function mockSystem(overrides = {}) {
  const subscribers: Array<() => void> = [];
  const settledSubscribers: Array<(settled: boolean) => void> = [];

  return {
    facts: { count: 0, status: "idle" },
    inspect: vi.fn(() => ({ facts: {}, constraints: [], resolvers: [] })),
    constraints: {
      register: vi.fn(),
      unregister: vi.fn(),
      listDynamic: vi.fn(() => []),
    },
    resolvers: {
      register: vi.fn(),
      unregister: vi.fn(),
      listDynamic: vi.fn(() => []),
    },
    effects: {
      register: vi.fn(),
      unregister: vi.fn(),
      listDynamic: vi.fn(() => []),
    },
    subscribe: vi.fn((cb: () => void) => {
      subscribers.push(cb);

      return () => {
        const idx = subscribers.indexOf(cb);
        if (idx >= 0) {
          subscribers.splice(idx, 1);
        }
      };
    }),
    onSettledChange: vi.fn((cb: (settled: boolean) => void) => {
      settledSubscribers.push(cb);

      return () => {
        const idx = settledSubscribers.indexOf(cb);
        if (idx >= 0) {
          settledSubscribers.splice(idx, 1);
        }
      };
    }),
    // Helpers for tests
    _emitFactChange: () => {
      for (const cb of subscribers) {
        cb();
      }
    },
    _emitSettledChange: (settled: boolean) => {
      for (const cb of settledSubscribers) {
        cb(settled);
      }
    },
    ...overrides,
  };
}

describe("discovery", () => {
  it("creates a discovery session", () => {
    const system = mockSystem();
    const session = createDiscoverySession(system as never);

    expect(session).toBeDefined();
    expect(session.stop).toBeTypeOf("function");
    expect(session.progress).toBeTypeOf("function");
  });

  it("reports progress", () => {
    const system = mockSystem();
    const session = createDiscoverySession(system as never, undefined, {
      duration: 60_000,
      useAI: false,
    });

    const progress = session.progress();

    expect(progress.eventCount).toBe(0);
    expect(progress.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("collects fact-change events", async () => {
    const system = mockSystem();
    const session = createDiscoverySession(system as never, undefined, {
      duration: 60_000,
      useAI: false,
    });

    // Emit some fact changes
    system._emitFactChange();
    system._emitFactChange();
    system._emitFactChange();

    const progress = session.progress();

    expect(progress.eventCount).toBe(3);

    const report = await session.stop();

    expect(report.timeline).toHaveLength(3);
    expect(report.timeline[0]!.type).toBe("fact-change");
  });

  it("collects settled events", async () => {
    const system = mockSystem();
    const session = createDiscoverySession(system as never, undefined, {
      duration: 60_000,
      useAI: false,
    });

    system._emitSettledChange(false);
    system._emitSettledChange(true);

    const report = await session.stop();

    expect(report.timeline).toHaveLength(2);
    expect(report.timeline[0]!.type).toBe("settled");
  });

  it("identifies recurring-unmet pattern", async () => {
    const system = mockSystem();
    const session = createDiscoverySession(system as never, undefined, {
      duration: 60_000,
      useAI: false,
    });

    // Simulate repeated unsettled states
    system._emitSettledChange(false);
    system._emitSettledChange(true);
    system._emitSettledChange(false);
    system._emitSettledChange(true);
    system._emitSettledChange(false);

    const report = await session.stop();

    const recurring = report.patterns.find((p) => p.type === "recurring-unmet");

    expect(recurring).toBeDefined();
    expect(recurring!.occurrences).toBeGreaterThanOrEqual(3);
  });

  it("identifies fact oscillation pattern", async () => {
    const system = mockSystem();
    const session = createDiscoverySession(system as never, undefined, {
      duration: 60_000,
      useAI: false,
    });

    // Simulate fact oscillation: A → B → A → B → A
    system.facts.status = "active";
    system._emitFactChange();
    system.facts.status = "idle";
    system._emitFactChange();
    system.facts.status = "active";
    system._emitFactChange();
    system.facts.status = "idle";
    system._emitFactChange();
    system.facts.status = "active";
    system._emitFactChange();

    const report = await session.stop();

    const oscillation = report.patterns.find((p) => p.type === "fact-oscillation");

    expect(oscillation).toBeDefined();
    expect(oscillation!.factKeys).toContain("status");
  });

  it("respects maxEvents limit", async () => {
    const system = mockSystem();
    const session = createDiscoverySession(system as never, undefined, {
      duration: 60_000,
      maxEvents: 3,
      useAI: false,
    });

    // Emit more events than the limit
    for (let i = 0; i < 10; i++) {
      system._emitFactChange();
    }

    const report = await session.stop();

    expect(report.timeline.length).toBeLessThanOrEqual(3);
  });

  it("stops collecting after stop()", async () => {
    const system = mockSystem();
    const session = createDiscoverySession(system as never, undefined, {
      duration: 60_000,
      useAI: false,
    });

    system._emitFactChange();
    const report = await session.stop();

    // Events after stop should not be collected
    system._emitFactChange();
    system._emitFactChange();

    expect(report.timeline).toHaveLength(1);
  });

  it("returns report with correct structure", async () => {
    const system = mockSystem();
    const session = createDiscoverySession(system as never, undefined, {
      duration: 60_000,
      useAI: false,
    });

    const report = await session.stop();

    expect(report.patterns).toBeDefined();
    expect(report.recommendations).toBeDefined();
    expect(report.timeline).toBeDefined();
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.startedAt).toBeGreaterThan(0);
  });
});
