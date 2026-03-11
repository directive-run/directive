import { describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

// ============================================================================
// Helpers
// ============================================================================

function createTestModule(options?: {
  snapshotEvents?: ("increment" | "setLabel" | "reset")[];
}) {
  return createModule("test", {
    schema: {
      facts: {
        count: t.number(),
        label: t.string(),
      },
      derivations: {},
      events: {
        increment: {},
        setLabel: { label: t.string() },
        reset: {},
      },
      requirements: {},
    },
    init: (facts) => {
      facts.count = 0;
      facts.label = "";
    },
    events: {
      increment: (facts) => {
        facts.count = (facts.count as number) + 1;
      },
      setLabel: (facts, { label }) => {
        facts.label = label;
      },
      reset: (facts) => {
        facts.count = 0;
        facts.label = "";
      },
    },
    snapshotEvents: options?.snapshotEvents,
  });
}

// ============================================================================
// snapshotEvents
// ============================================================================

describe("snapshotEvents", () => {
  it("snapshots all events when snapshotEvents is omitted (backward compat)", async () => {
    const mod = createTestModule();
    const system = createSystem({
      module: mod,
      history: { maxSnapshots: 50 },
    });
    system.start();
    await system.settle();

    const initialIndex = system.history!.currentIndex;

    system.events.increment();
    await system.settle();

    system.events.setLabel({ label: "hello" });
    await system.settle();

    system.events.reset();
    await system.settle();

    // All 3 events should have created snapshots
    expect(system.history!.currentIndex).toBe(initialIndex + 3);

    system.destroy();
  });

  it("only creates snapshots for listed events", async () => {
    const mod = createTestModule({ snapshotEvents: ["increment"] });
    const system = createSystem({
      module: mod,
      history: { maxSnapshots: 50 },
    });
    system.start();
    await system.settle();

    const initialIndex = system.history!.currentIndex;

    // This should snapshot
    system.events.increment();
    await system.settle();

    // This should NOT snapshot
    system.events.setLabel({ label: "hello" });
    await system.settle();

    // This should NOT snapshot
    system.events.reset();
    await system.settle();

    // Only increment created a snapshot
    expect(system.history!.currentIndex).toBe(initialIndex + 1);

    system.destroy();
  });

  it("unlisted events do NOT create snapshots", async () => {
    const mod = createTestModule({ snapshotEvents: ["increment", "reset"] });
    const system = createSystem({
      module: mod,
      history: { maxSnapshots: 50 },
    });
    system.start();
    await system.settle();

    const initialIndex = system.history!.currentIndex;

    // setLabel is NOT in snapshotEvents — no snapshot
    system.events.setLabel({ label: "a" });
    await system.settle();
    system.events.setLabel({ label: "b" });
    await system.settle();
    system.events.setLabel({ label: "c" });
    await system.settle();

    expect(system.history!.currentIndex).toBe(initialIndex);

    // But increment IS in snapshotEvents
    system.events.increment();
    await system.settle();

    expect(system.history!.currentIndex).toBe(initialIndex + 1);

    system.destroy();
  });

  it("direct fact mutation creates snapshot even with filtering", async () => {
    const mod = createTestModule({ snapshotEvents: ["increment"] });
    const system = createSystem({
      module: mod,
      history: { maxSnapshots: 50 },
    });
    system.start();
    await system.settle();

    const initialIndex = system.history!.currentIndex;

    // Direct mutation should always snapshot
    system.facts.count = 42;
    await system.settle();

    expect(system.history!.currentIndex).toBe(initialIndex + 1);
    expect(system.facts.count).toBe(42);

    system.destroy();
  });

  it("undo reverses only snapshot events", async () => {
    const mod = createTestModule({ snapshotEvents: ["increment"] });
    const system = createSystem({
      module: mod,
      history: { maxSnapshots: 50 },
    });
    system.start();
    await system.settle();

    // increment (snapshots): count = 1
    system.events.increment();
    await system.settle();

    // setLabel (no snapshot): label = "hello"
    system.events.setLabel({ label: "hello" });
    await system.settle();

    // increment (snapshots): count = 2
    system.events.increment();
    await system.settle();

    expect(system.facts.count).toBe(2);

    // Undo should revert to count=1 (the last snapshot state)
    system.history!.goBack();

    expect(system.facts.count).toBe(1);

    system.destroy();
  });

  it("multi-module: each module controls its own events", async () => {
    const moduleA = createModule("modA", {
      schema: {
        facts: { x: t.number() },
        derivations: {},
        events: {
          setX: { value: t.number() },
          noopA: {},
        },
        requirements: {},
      },
      init: (facts) => {
        facts.x = 0;
      },
      events: {
        setX: (facts, { value }) => {
          facts.x = value;
        },
        noopA: (facts) => {
          facts.x = facts.x as number;
        },
      },
      // Only setX snapshots
      snapshotEvents: ["setX"],
    });

    const moduleB = createModule("modB", {
      schema: {
        facts: { y: t.number() },
        derivations: {},
        events: {
          setY: { value: t.number() },
          noopB: {},
        },
        requirements: {},
      },
      init: (facts) => {
        facts.y = 0;
      },
      events: {
        setY: (facts, { value }) => {
          facts.y = value;
        },
        noopB: (facts) => {
          facts.y = facts.y as number;
        },
      },
      // No snapshotEvents — ALL events from moduleB snapshot
    });

    const system = createSystem({
      modules: { a: moduleA, b: moduleB },
      history: { maxSnapshots: 50 },
    });
    system.start();
    await system.settle();

    const initialIndex = system.history!.currentIndex;

    // moduleA.setX — in snapshotEvents → snapshots
    system.events.a.setX({ value: 10 });
    await system.settle();
    expect(system.history!.currentIndex).toBe(initialIndex + 1);

    // moduleB.setY — no filter on moduleB → snapshots
    system.events.b.setY({ value: 20 });
    await system.settle();
    expect(system.history!.currentIndex).toBe(initialIndex + 2);

    system.destroy();
  });

  it("dev warning for invalid snapshotEvents entries", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    createModule("test", {
      schema: {
        facts: { count: t.number() },
        derivations: {},
        events: { increment: {} },
        requirements: {},
      },
      init: (facts) => {
        facts.count = 0;
      },
      events: {
        increment: (facts) => {
          facts.count = (facts.count as number) + 1;
        },
      },
      // @ts-expect-error — intentionally passing invalid event name to test dev warning
      snapshotEvents: ["increment", "nonExistentEvent"],
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("nonExistentEvent"),
    );

    warnSpy.mockRestore();
  });

  it("dev warning for empty snapshotEvents array", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    createModule("test", {
      schema: {
        facts: { count: t.number() },
        derivations: {},
        events: { increment: {} },
        requirements: {},
      },
      init: (facts) => {
        facts.count = 0;
      },
      events: {
        increment: (facts) => {
          facts.count = (facts.count as number) + 1;
        },
      },
      snapshotEvents: [],
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("empty array"),
    );

    warnSpy.mockRestore();
  });

  it("snapshotEvents: [] disables all event snapshots", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mod = createTestModule({ snapshotEvents: [] });
    const system = createSystem({
      module: mod,
      history: { maxSnapshots: 50 },
    });
    system.start();
    await system.settle();

    const initialIndex = system.history!.currentIndex;

    // No events should create snapshots
    system.events.increment();
    await system.settle();
    system.events.setLabel({ label: "hello" });
    await system.settle();

    expect(system.history!.currentIndex).toBe(initialIndex);

    // But direct fact mutations still snapshot
    system.facts.count = 99;
    await system.settle();

    expect(system.history!.currentIndex).toBe(initialIndex + 1);

    system.destroy();
    warnSpy.mockRestore();
  });

  it("dispatch() path respects snapshotEvents filtering", async () => {
    const mod = createTestModule({ snapshotEvents: ["increment"] });
    const system = createSystem({
      module: mod,
      history: { maxSnapshots: 50 },
    });
    system.start();
    await system.settle();

    const initialIndex = system.history!.currentIndex;

    // dispatch() with snapshot event — should snapshot
    system.dispatch({ type: "increment" });
    await system.settle();
    expect(system.history!.currentIndex).toBe(initialIndex + 1);

    // dispatch() with non-snapshot event — should NOT snapshot
    system.dispatch({ type: "setLabel", label: "hello" });
    await system.settle();
    expect(system.history!.currentIndex).toBe(initialIndex + 1);

    system.destroy();
  });

  it("isDispatching resets correctly when handler throws", async () => {
    const throwingModule = createModule("throwing", {
      schema: {
        facts: {
          count: t.number(),
          label: t.string(),
        },
        derivations: {},
        events: {
          throwingEvent: {},
          increment: {},
        },
        requirements: {},
      },
      init: (facts) => {
        facts.count = 0;
        facts.label = "";
      },
      events: {
        throwingEvent: () => {
          throw new Error("Handler error");
        },
        increment: (facts) => {
          facts.count = (facts.count as number) + 1;
        },
      },
      snapshotEvents: ["increment"],
    });

    const system = createSystem({
      module: throwingModule,
      history: { maxSnapshots: 50 },
    });
    system.start();
    await system.settle();

    const initialIndex = system.history!.currentIndex;

    // Dispatch a throwing event — should not corrupt state
    expect(() => system.events.throwingEvent()).toThrow("Handler error");

    // After the throw, direct fact mutations should still create snapshots
    system.facts.count = 42;
    await system.settle();

    expect(system.history!.currentIndex).toBe(initialIndex + 1);
    expect(system.facts.count).toBe(42);

    system.destroy();
  });

  // ============================================================================
  // history.snapshotModules
  // ============================================================================

  describe("history.snapshotModules", () => {
    it("only listed modules create snapshots", async () => {
      const moduleA = createModule("modA", {
        schema: {
          facts: { x: t.number() },
          derivations: {},
          events: { setX: { value: t.number() } },
          requirements: {},
        },
        init: (facts) => {
          facts.x = 0;
        },
        events: {
          setX: (facts, { value }) => {
            facts.x = value;
          },
        },
      });

      const moduleB = createModule("modB", {
        schema: {
          facts: { y: t.number() },
          derivations: {},
          events: { setY: { value: t.number() } },
          requirements: {},
        },
        init: (facts) => {
          facts.y = 0;
        },
        events: {
          setY: (facts, { value }) => {
            facts.y = value;
          },
        },
      });

      const system = createSystem({
        modules: { a: moduleA, b: moduleB },
        history: {
          maxSnapshots: 50,
          snapshotModules: ["a"],
        },
      });
      system.start();
      await system.settle();

      const initialIndex = system.history!.currentIndex;

      // moduleA event — in snapshotModules → snapshots
      system.events.a.setX({ value: 10 });
      await system.settle();
      expect(system.history!.currentIndex).toBe(initialIndex + 1);

      // moduleB event — NOT in snapshotModules → no snapshot
      system.events.b.setY({ value: 20 });
      await system.settle();
      expect(system.history!.currentIndex).toBe(initialIndex + 1);

      system.destroy();
    });

    it("omitted snapshotModules snapshots all modules (backward compat)", async () => {
      const moduleA = createModule("modA", {
        schema: {
          facts: { x: t.number() },
          derivations: {},
          events: { setX: { value: t.number() } },
          requirements: {},
        },
        init: (facts) => {
          facts.x = 0;
        },
        events: {
          setX: (facts, { value }) => {
            facts.x = value;
          },
        },
      });

      const moduleB = createModule("modB", {
        schema: {
          facts: { y: t.number() },
          derivations: {},
          events: { setY: { value: t.number() } },
          requirements: {},
        },
        init: (facts) => {
          facts.y = 0;
        },
        events: {
          setY: (facts, { value }) => {
            facts.y = value;
          },
        },
      });

      const system = createSystem({
        modules: { a: moduleA, b: moduleB },
        history: { maxSnapshots: 50 },
      });
      system.start();
      await system.settle();

      const initialIndex = system.history!.currentIndex;

      system.events.a.setX({ value: 10 });
      await system.settle();
      expect(system.history!.currentIndex).toBe(initialIndex + 1);

      system.events.b.setY({ value: 20 });
      await system.settle();
      expect(system.history!.currentIndex).toBe(initialIndex + 2);

      system.destroy();
    });

    it("intersects with per-module snapshotEvents", async () => {
      const moduleA = createModule("modA", {
        schema: {
          facts: { x: t.number() },
          derivations: {},
          events: {
            setX: { value: t.number() },
            resetX: {},
          },
          requirements: {},
        },
        init: (facts) => {
          facts.x = 0;
        },
        events: {
          setX: (facts, { value }) => {
            facts.x = value;
          },
          resetX: (facts) => {
            facts.x = 0;
          },
        },
        // Only setX snapshots at the module level
        snapshotEvents: ["setX"],
      });

      const moduleB = createModule("modB", {
        schema: {
          facts: { y: t.number() },
          derivations: {},
          events: { setY: { value: t.number() } },
          requirements: {},
        },
        init: (facts) => {
          facts.y = 0;
        },
        events: {
          setY: (facts, { value }) => {
            facts.y = value;
          },
        },
      });

      const system = createSystem({
        modules: { a: moduleA, b: moduleB },
        history: {
          maxSnapshots: 50,
          snapshotModules: ["a"], // Only module a
        },
      });
      system.start();
      await system.settle();

      const initialIndex = system.history!.currentIndex;

      // moduleA.setX — in snapshotModules AND in per-module snapshotEvents → snapshots
      system.events.a.setX({ value: 10 });
      await system.settle();
      expect(system.history!.currentIndex).toBe(initialIndex + 1);

      // moduleA.resetX — in snapshotModules BUT NOT in per-module snapshotEvents → no snapshot
      system.events.a.resetX();
      await system.settle();
      expect(system.history!.currentIndex).toBe(initialIndex + 1);

      // moduleB.setY — NOT in snapshotModules → no snapshot
      system.events.b.setY({ value: 20 });
      await system.settle();
      expect(system.history!.currentIndex).toBe(initialIndex + 1);

      system.destroy();
    });

    it("dev warning for unknown module name", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const moduleA = createModule("modA", {
        schema: {
          facts: { x: t.number() },
          derivations: {},
          events: {},
          requirements: {},
        },
        init: (facts) => {
          facts.x = 0;
        },
      });

      const system = createSystem({
        modules: { a: moduleA },
        history: {
          snapshotModules: ["a", "nonExistent"],
        },
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'history.snapshotModules entry "nonExistent" doesn\'t match any module',
        ),
      );

      system.destroy();
      warnSpy.mockRestore();
    });

    it("dev warning for single-module system", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const mod = createTestModule();
      const system = createSystem({
        module: mod,
        history: {
          snapshotModules: ["test"],
        },
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "history.snapshotModules has no effect in single-module mode",
        ),
      );

      system.destroy();
      warnSpy.mockRestore();
    });
  });

  it("multi-module: non-snapshot events do NOT create snapshots", async () => {
    const moduleA = createModule("modA", {
      schema: {
        facts: { x: t.number() },
        derivations: {},
        events: {
          setX: { value: t.number() },
          noopA: {},
        },
        requirements: {},
      },
      init: (facts) => {
        facts.x = 0;
      },
      events: {
        setX: (facts, { value }) => {
          facts.x = value;
        },
        noopA: () => {
          /* intentionally empty */
        },
      },
      // Only setX snapshots
      snapshotEvents: ["setX"],
    });

    const moduleB = createModule("modB", {
      schema: {
        facts: { y: t.number() },
        derivations: {},
        events: {
          setY: { value: t.number() },
        },
        requirements: {},
      },
      init: (facts) => {
        facts.y = 0;
      },
      events: {
        setY: (facts, { value }) => {
          facts.y = value;
        },
      },
      // No snapshotEvents — ALL events from moduleB snapshot
    });

    const system = createSystem({
      modules: { a: moduleA, b: moduleB },
      history: { maxSnapshots: 50 },
    });
    system.start();
    await system.settle();

    const initialIndex = system.history!.currentIndex;

    // moduleA.noopA — NOT in snapshotEvents, handler is a no-op → no snapshot
    system.events.a.noopA();
    await system.settle();
    expect(system.history!.currentIndex).toBe(initialIndex);

    // moduleA.setX — IN snapshotEvents → snapshots
    system.events.a.setX({ value: 10 });
    await system.settle();
    expect(system.history!.currentIndex).toBe(initialIndex + 1);

    // moduleB.setY — no filter on moduleB → snapshots
    system.events.b.setY({ value: 20 });
    await system.settle();
    expect(system.history!.currentIndex).toBe(initialIndex + 2);

    system.destroy();
  });
});
