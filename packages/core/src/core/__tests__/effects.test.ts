import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFacts, t } from "../../index.js";
import { createEffectsManager } from "../effects.js";
import type { EffectsManager } from "../effects.js";

// ============================================================================
// Helpers
// ============================================================================

const schema = { count: t.number(), name: t.string() };

type TestSchema = typeof schema;

function setup(
  definitions: Record<string, { run: (...args: unknown[]) => unknown; deps?: string[] }> = {},
  callbacks: {
    onRun?: (id: string, deps: string[]) => void;
    onError?: (id: string, error: unknown) => void;
  } = {},
) {
  const { store, facts } = createFacts({ schema });
  facts.count = 0;
  facts.name = "alice";

  const manager = createEffectsManager({
    definitions: definitions as Parameters<typeof createEffectsManager>[0]["definitions"],
    facts: facts as never,
    store: store as never,
    ...callbacks,
  });

  return { store, facts, manager };
}

// ============================================================================
// runEffects
// ============================================================================

describe("effects", () => {
  describe("runEffects", () => {
    it("runs an effect when its deps overlap with changedKeys", async () => {
      const runFn = vi.fn();
      const { manager } = setup({
        log: { deps: ["count"], run: runFn },
      });

      await manager.runEffects(new Set(["count"]));

      expect(runFn).toHaveBeenCalledTimes(1);
    });

    it("does not run an effect when changedKeys do not overlap with deps", async () => {
      const runFn = vi.fn();
      const { manager } = setup({
        log: { deps: ["name"], run: runFn },
      });

      await manager.runEffects(new Set(["count"]));

      expect(runFn).not.toHaveBeenCalled();
    });

    it("runs effects with no deps on any change (first run)", async () => {
      const runFn = vi.fn();
      const { manager } = setup({
        log: { run: runFn },
      });

      await manager.runEffects(new Set(["count"]));

      expect(runFn).toHaveBeenCalledTimes(1);
    });

    it("runs multiple effects whose deps overlap", async () => {
      const runA = vi.fn();
      const runB = vi.fn();
      const { manager } = setup({
        effectA: { deps: ["count"], run: runA },
        effectB: { deps: ["count", "name"], run: runB },
      });

      await manager.runEffects(new Set(["count"]));

      expect(runA).toHaveBeenCalledTimes(1);
      expect(runB).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================================
  // Auto-tracking
  // ============================================================================

  describe("auto-tracking", () => {
    it("auto-tracks fact reads and only re-runs when those facts change", async () => {
      const runFn = vi.fn((facts: { count: number }) => {
        // Read count — this should be auto-tracked
        void facts.count;
      });
      const { manager } = setup({ log: { run: runFn } });

      // First run — auto-tracks "count"
      await manager.runEffects(new Set(["count"]));
      expect(runFn).toHaveBeenCalledTimes(1);

      // Change "name" — should NOT re-run because only "count" was tracked
      await manager.runEffects(new Set(["name"]));
      expect(runFn).toHaveBeenCalledTimes(1);

      // Change "count" — should re-run
      await manager.runEffects(new Set(["count"]));
      expect(runFn).toHaveBeenCalledTimes(2);
    });

    it("re-tracks deps on every run to capture conditional reads", async () => {
      let readName = false;
      const runFn = vi.fn((facts: { count: number; name: string }) => {
        void facts.count;
        if (readName) {
          void facts.name;
        }
      });
      const { manager } = setup({ log: { run: runFn } });

      // First run — only "count" tracked
      await manager.runEffects(new Set(["count"]));
      expect(runFn).toHaveBeenCalledTimes(1);

      // "name" change should NOT trigger (not tracked yet)
      await manager.runEffects(new Set(["name"]));
      expect(runFn).toHaveBeenCalledTimes(1);

      // Now enable reading name and re-run via count change
      readName = true;
      await manager.runEffects(new Set(["count"]));
      expect(runFn).toHaveBeenCalledTimes(2);

      // Now "name" should be tracked too
      await manager.runEffects(new Set(["name"]));
      expect(runFn).toHaveBeenCalledTimes(3);
    });
  });

  // ============================================================================
  // Explicit deps
  // ============================================================================

  describe("explicit deps", () => {
    it("only runs when explicit deps change", async () => {
      const runFn = vi.fn();
      const { manager } = setup({
        log: { deps: ["count"], run: runFn },
      });

      await manager.runEffects(new Set(["name"]));
      expect(runFn).not.toHaveBeenCalled();

      await manager.runEffects(new Set(["count"]));
      expect(runFn).toHaveBeenCalledTimes(1);
    });

    it("deps are fixed and do not change between runs", async () => {
      const runFn = vi.fn((facts: { count: number; name: string }) => {
        // Read both facts, but deps should stay fixed to ["count"]
        void facts.count;
        void facts.name;
      });
      const { manager } = setup({
        log: { deps: ["count"], run: runFn },
      });

      await manager.runEffects(new Set(["count"]));
      expect(runFn).toHaveBeenCalledTimes(1);

      // "name" change should still NOT trigger — explicit deps override auto-tracking
      await manager.runEffects(new Set(["name"]));
      expect(runFn).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================================
  // Cleanup
  // ============================================================================

  describe("cleanup", () => {
    it("calls cleanup function before next execution", async () => {
      const cleanup = vi.fn();
      const runFn = vi.fn(() => cleanup);
      const { manager } = setup({
        log: { deps: ["count"], run: runFn },
      });

      await manager.runEffects(new Set(["count"]));
      expect(cleanup).not.toHaveBeenCalled();

      await manager.runEffects(new Set(["count"]));
      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it("stores new cleanup after each run", async () => {
      let cleanupCount = 0;
      const cleanups: Array<ReturnType<typeof vi.fn>> = [];

      const runFn = vi.fn(() => {
        const c = vi.fn();
        cleanups.push(c);
        cleanupCount++;

        return c;
      });
      const { manager } = setup({
        log: { deps: ["count"], run: runFn },
      });

      await manager.runEffects(new Set(["count"]));
      await manager.runEffects(new Set(["count"]));
      await manager.runEffects(new Set(["count"]));

      // First cleanup called before second run, second before third
      expect(cleanups[0]).toHaveBeenCalledTimes(1);
      expect(cleanups[1]).toHaveBeenCalledTimes(1);
      // Third cleanup not yet called (no subsequent run)
      expect(cleanups[2]).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // cleanupAll
  // ============================================================================

  describe("cleanupAll", () => {
    it("runs all cleanup functions and marks manager as stopped", async () => {
      const cleanupA = vi.fn();
      const cleanupB = vi.fn();
      const { manager } = setup({
        effectA: { deps: ["count"], run: () => cleanupA },
        effectB: { deps: ["name"], run: () => cleanupB },
      });

      await manager.runEffects(new Set(["count", "name"]));
      expect(cleanupA).not.toHaveBeenCalled();
      expect(cleanupB).not.toHaveBeenCalled();

      manager.cleanupAll();

      expect(cleanupA).toHaveBeenCalledTimes(1);
      expect(cleanupB).toHaveBeenCalledTimes(1);
    });

    it("handles effects that did not return a cleanup function", async () => {
      const { manager } = setup({
        log: { deps: ["count"], run: () => {} },
      });

      await manager.runEffects(new Set(["count"]));

      // Should not throw
      expect(() => manager.cleanupAll()).not.toThrow();
    });
  });

  // ============================================================================
  // disable / enable / isEnabled
  // ============================================================================

  describe("disable / enable / isEnabled", () => {
    it("disable prevents an effect from running", async () => {
      const runFn = vi.fn();
      const { manager } = setup({
        log: { deps: ["count"], run: runFn },
      });

      manager.disable("log");
      await manager.runEffects(new Set(["count"]));

      expect(runFn).not.toHaveBeenCalled();
    });

    it("enable re-enables a disabled effect", async () => {
      const runFn = vi.fn();
      const { manager } = setup({
        log: { deps: ["count"], run: runFn },
      });

      manager.disable("log");
      manager.enable("log");
      await manager.runEffects(new Set(["count"]));

      expect(runFn).toHaveBeenCalledTimes(1);
    });

    it("isEnabled returns true by default", () => {
      const { manager } = setup({
        log: { deps: ["count"], run: () => {} },
      });

      expect(manager.isEnabled("log")).toBe(true);
    });

    it("isEnabled returns false after disable", () => {
      const { manager } = setup({
        log: { deps: ["count"], run: () => {} },
      });

      manager.disable("log");

      expect(manager.isEnabled("log")).toBe(false);
    });

    it("isEnabled returns true after disable then enable", () => {
      const { manager } = setup({
        log: { deps: ["count"], run: () => {} },
      });

      manager.disable("log");
      manager.enable("log");

      expect(manager.isEnabled("log")).toBe(true);
    });
  });

  // ============================================================================
  // Error isolation
  // ============================================================================

  describe("error isolation", () => {
    it("throwing effect does not propagate the error", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { manager } = setup({
        bad: {
          deps: ["count"],
          run: () => {
            throw new Error("boom");
          },
        },
      });

      await expect(manager.runEffects(new Set(["count"]))).resolves.toBeUndefined();

      consoleSpy.mockRestore();
    });

    it("throwing effect does not prevent other effects from running", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const goodRun = vi.fn();
      const { manager } = setup({
        bad: {
          deps: ["count"],
          run: () => {
            throw new Error("boom");
          },
        },
        good: { deps: ["count"], run: goodRun },
      });

      await manager.runEffects(new Set(["count"]));

      expect(goodRun).toHaveBeenCalledTimes(1);
      consoleSpy.mockRestore();
    });

    it("throwing cleanup does not propagate the error", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { manager } = setup({
        bad: {
          deps: ["count"],
          run: () => () => {
            throw new Error("cleanup boom");
          },
        },
      });

      await manager.runEffects(new Set(["count"]));

      // Trigger cleanup by running again
      await expect(manager.runEffects(new Set(["count"]))).resolves.toBeUndefined();

      consoleSpy.mockRestore();
    });
  });

  // ============================================================================
  // onRun callback
  // ============================================================================

  describe("onRun callback", () => {
    it("fires when an effect runs with the effect id and deps", async () => {
      const onRun = vi.fn();
      const { manager } = setup(
        { log: { deps: ["count"], run: () => {} } },
        { onRun },
      );

      await manager.runEffects(new Set(["count"]));

      expect(onRun).toHaveBeenCalledTimes(1);
      expect(onRun).toHaveBeenCalledWith("log", ["count"]);
    });

    it("passes empty array for auto-tracked effects with no deps yet", async () => {
      const onRun = vi.fn();
      const { manager } = setup(
        { log: { run: () => {} } },
        { onRun },
      );

      await manager.runEffects(new Set(["count"]));

      expect(onRun).toHaveBeenCalledWith("log", []);
    });
  });

  // ============================================================================
  // onError callback
  // ============================================================================

  describe("onError callback", () => {
    it("fires when an effect throws", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const onError = vi.fn();
      const err = new Error("test error");
      const { manager } = setup(
        {
          bad: {
            deps: ["count"],
            run: () => {
              throw err;
            },
          },
        },
        { onError },
      );

      await manager.runEffects(new Set(["count"]));

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith("bad", err);
      consoleSpy.mockRestore();
    });

    it("fires when a cleanup function throws", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const onError = vi.fn();
      const err = new Error("cleanup error");
      const { manager } = setup(
        {
          bad: {
            deps: ["count"],
            run: () => () => {
              throw err;
            },
          },
        },
        { onError },
      );

      // First run stores cleanup
      await manager.runEffects(new Set(["count"]));
      // Second run triggers cleanup of previous
      await manager.runEffects(new Set(["count"]));

      expect(onError).toHaveBeenCalledWith("bad", err);
      consoleSpy.mockRestore();
    });
  });

  // ============================================================================
  // Previous snapshot (prev argument)
  // ============================================================================

  describe("previous snapshot", () => {
    it("passes null as prev on first run", async () => {
      const runFn = vi.fn();
      const { manager } = setup({
        log: { deps: ["count"], run: runFn },
      });

      await manager.runEffects(new Set(["count"]));

      expect(runFn.mock.calls[0][1]).toBeNull();
    });

    it("passes previous facts snapshot on subsequent runs", async () => {
      const runFn = vi.fn();
      const { facts, manager } = setup({
        log: { deps: ["count"], run: runFn },
      });

      await manager.runEffects(new Set(["count"]));
      expect(runFn.mock.calls[0][1]).toBeNull();

      // Change count and re-run
      facts.count = 42;
      await manager.runEffects(new Set(["count"]));

      // prev should reflect the snapshot taken after the first run
      const prev = runFn.mock.calls[1][1];
      expect(prev).not.toBeNull();
      expect(prev.count).toBe(0);
    });

    it("prev reflects state at the time of last runEffects call", async () => {
      const prevValues: Array<Record<string, unknown> | null> = [];
      const runFn = vi.fn((_facts: unknown, prev: Record<string, unknown> | null) => {
        prevValues.push(prev ? { ...prev } : null);
      });
      const { facts, manager } = setup({
        log: { deps: ["count"], run: runFn },
      });

      facts.count = 1;
      await manager.runEffects(new Set(["count"]));

      facts.count = 2;
      await manager.runEffects(new Set(["count"]));

      facts.count = 3;
      await manager.runEffects(new Set(["count"]));

      expect(prevValues[0]).toBeNull();
      expect(prevValues[1]!.count).toBe(1);
      expect(prevValues[2]!.count).toBe(2);
    });
  });

  // ============================================================================
  // registerDefinitions
  // ============================================================================

  describe("registerDefinitions", () => {
    it("adds new effects at runtime", async () => {
      const { manager } = setup({});

      const runFn = vi.fn();
      manager.registerDefinitions({
        newEffect: { deps: ["count"], run: runFn },
      } as never);

      await manager.runEffects(new Set(["count"]));

      expect(runFn).toHaveBeenCalledTimes(1);
    });

    it("registered effects are enabled by default", async () => {
      const { manager } = setup({});

      manager.registerDefinitions({
        newEffect: { deps: ["count"], run: () => {} },
      } as never);

      expect(manager.isEnabled("newEffect")).toBe(true);
    });
  });

  // ============================================================================
  // assignDefinition
  // ============================================================================

  describe("assignDefinition", () => {
    it("replaces an existing effect definition", async () => {
      const oldRun = vi.fn();
      const newRun = vi.fn();
      const { manager } = setup({
        log: { deps: ["count"], run: oldRun },
      });

      manager.assignDefinition("log", { deps: ["count"], run: newRun } as never);

      await manager.runEffects(new Set(["count"]));

      expect(oldRun).not.toHaveBeenCalled();
      expect(newRun).toHaveBeenCalledTimes(1);
    });

    it("runs old cleanup before replacing", async () => {
      const oldCleanup = vi.fn();
      const { manager } = setup({
        log: { deps: ["count"], run: () => oldCleanup },
      });

      // Run to store cleanup
      await manager.runEffects(new Set(["count"]));
      expect(oldCleanup).not.toHaveBeenCalled();

      manager.assignDefinition("log", { deps: ["count"], run: () => {} } as never);

      expect(oldCleanup).toHaveBeenCalledTimes(1);
    });

    it("throws when assigning to a non-existent effect", () => {
      const { manager } = setup({});

      expect(() =>
        manager.assignDefinition("nonexistent", { deps: ["count"], run: () => {} } as never),
      ).toThrow(/does not exist/);
    });
  });

  // ============================================================================
  // unregisterDefinition
  // ============================================================================

  describe("unregisterDefinition", () => {
    it("removes an effect so it no longer runs", async () => {
      const runFn = vi.fn();
      const { manager } = setup({
        log: { deps: ["count"], run: runFn },
      });

      manager.unregisterDefinition("log");
      await manager.runEffects(new Set(["count"]));

      expect(runFn).not.toHaveBeenCalled();
    });

    it("runs cleanup when unregistering", async () => {
      const cleanup = vi.fn();
      const { manager } = setup({
        log: { deps: ["count"], run: () => cleanup },
      });

      await manager.runEffects(new Set(["count"]));
      expect(cleanup).not.toHaveBeenCalled();

      manager.unregisterDefinition("log");

      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it("does not throw when unregistering a non-existent effect", () => {
      const { manager } = setup({});

      expect(() => manager.unregisterDefinition("nonexistent")).not.toThrow();
    });
  });

  // ============================================================================
  // callOne
  // ============================================================================

  describe("callOne", () => {
    it("executes a single effect immediately", async () => {
      const runA = vi.fn();
      const runB = vi.fn();
      const { manager } = setup({
        effectA: { deps: ["count"], run: runA },
        effectB: { deps: ["count"], run: runB },
      });

      await manager.callOne("effectA");

      expect(runA).toHaveBeenCalledTimes(1);
      expect(runB).not.toHaveBeenCalled();
    });

    it("throws for a non-existent effect", async () => {
      const { manager } = setup({});

      await expect(manager.callOne("nonexistent")).rejects.toThrow(/does not exist/);
    });

    it("runs cleanup before re-executing", async () => {
      const cleanup = vi.fn();
      const { manager } = setup({
        log: { deps: ["count"], run: () => cleanup },
      });

      await manager.callOne("log");
      expect(cleanup).not.toHaveBeenCalled();

      await manager.callOne("log");
      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it("does not run a disabled effect", async () => {
      const runFn = vi.fn();
      const { manager } = setup({
        log: { deps: ["count"], run: runFn },
      });

      manager.disable("log");
      await manager.callOne("log");

      expect(runFn).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // runAll
  // ============================================================================

  describe("runAll", () => {
    it("runs all enabled effects regardless of deps", async () => {
      const runA = vi.fn();
      const runB = vi.fn();
      const { manager } = setup({
        effectA: { deps: ["count"], run: runA },
        effectB: { deps: ["name"], run: runB },
      });

      await manager.runAll();

      expect(runA).toHaveBeenCalledTimes(1);
      expect(runB).toHaveBeenCalledTimes(1);
    });

    it("skips disabled effects", async () => {
      const runA = vi.fn();
      const runB = vi.fn();
      const { manager } = setup({
        effectA: { deps: ["count"], run: runA },
        effectB: { deps: ["name"], run: runB },
      });

      manager.disable("effectA");
      await manager.runAll();

      expect(runA).not.toHaveBeenCalled();
      expect(runB).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================================
  // Stopped behavior (async cleanup after stop)
  // ============================================================================

  describe("stopped behavior", () => {
    it("cleanup returned by async effect after stop is invoked immediately", async () => {
      const cleanup = vi.fn();
      let resolveEffect: () => void;
      const effectPromise = new Promise<void>((resolve) => {
        resolveEffect = resolve;
      });

      const { manager } = setup({
        asyncEffect: {
          deps: ["count"],
          run: async () => {
            await effectPromise;

            return cleanup;
          },
        },
      });

      // Start the async effect
      const runPromise = manager.runEffects(new Set(["count"]));

      // Stop the manager while the effect is still running
      manager.cleanupAll();

      // Resolve the async effect — cleanup should be invoked immediately
      resolveEffect!();
      await runPromise;

      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it("cleanup errors after stop are caught and reported", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const onError = vi.fn();
      const err = new Error("post-stop cleanup error");
      let resolveEffect: () => void;
      const effectPromise = new Promise<void>((resolve) => {
        resolveEffect = resolve;
      });

      const { manager } = setup(
        {
          asyncEffect: {
            deps: ["count"],
            run: async () => {
              await effectPromise;

              return () => {
                throw err;
              };
            },
          },
        },
        { onError },
      );

      const runPromise = manager.runEffects(new Set(["count"]));
      manager.cleanupAll();

      resolveEffect!();
      await runPromise;

      expect(onError).toHaveBeenCalledWith("asyncEffect", err);
      consoleSpy.mockRestore();
    });
  });
});
