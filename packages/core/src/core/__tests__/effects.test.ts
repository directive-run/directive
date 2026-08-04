import { describe, expect, it, vi } from "vitest";
import { t } from "../../index.js";
import { createEffectsManager } from "../effects.js";
import { createFacts } from "../facts.js";
import { derivationDep } from "../tracking.js";

// ============================================================================
// Helpers
// ============================================================================

const schema = { count: t.number(), name: t.string() };

function setup(
  definitions: Record<
    string,
    {
      run: (...args: any[]) => any;
      deps?: string[];
      on?: unknown;
    }
  > = {},
  callbacks: {
    onRun?: (id: string, deps: string[]) => void;
    onError?: (id: string, error: unknown) => void;
  } = {},
) {
  const { store, facts } = createFacts({ schema });
  facts.count = 0;
  facts.name = "alice";

  const manager = createEffectsManager({
    definitions: definitions as Parameters<
      typeof createEffectsManager
    >[0]["definitions"],
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
  // Resolving declared `deps` names
  // ============================================================================
  //
  // A `deps` name is resolved against what the system holds when the effect is
  // considered, not when it was registered, because the piecemeal API lets the
  // derivation a name refers to arrive second. What is worth carrying forward
  // between reconciles is only the names still capable of changing meaning — a
  // name that already means a declared fact cannot come to mean a derivation,
  // since a collision resolves toward the fact.

  describe("declared deps resolution", () => {
    /** A manager wired the way the engine wires it, over a mutable module set. */
    function setupResolving(
      deps: string[],
      known: { facts?: string[]; derivations?: string[] } = {},
    ) {
      const factNames = new Set(known.facts ?? []);
      const derivationNames = new Set(known.derivations ?? []);

      const isDerivation = vi.fn(
        (name: string) => derivationNames.has(name) && !factNames.has(name),
      );
      const isFactKey = vi.fn((name: string) => factNames.has(name));

      const { store, facts } = createFacts({ schema });
      facts.count = 0;
      facts.name = "alice";

      const runFn = vi.fn();
      const manager = createEffectsManager({
        definitions: { log: { deps, run: runFn } } as Parameters<
          typeof createEffectsManager
        >[0]["definitions"],
        facts: facts as never,
        store: store as never,
        isDerivation,
        isFactKey,
      });

      return {
        manager,
        runFn,
        isDerivation,
        isFactKey,
        factNames,
        derivationNames,
      };
    }

    it("stops asking about a deps name that already means a declared fact", async () => {
      const { manager, isDerivation, isFactKey } = setupResolving(["count"], {
        facts: ["count", "name"],
      });

      await manager.runEffects(new Set(["count"]));
      isDerivation.mockClear();
      isFactKey.mockClear();

      for (let i = 0; i < 5; i++) {
        await manager.runEffects(new Set(["count"]));
      }

      // The name was settled by the first resolution. Nothing about the merged
      // module set can change what it means, so nothing asks again.
      expect(isDerivation).not.toHaveBeenCalled();
      expect(isFactKey).not.toHaveBeenCalled();
    });

    it("keeps asking about a deps name the system holds nothing under", async () => {
      const { manager, isDerivation, derivationNames } = setupResolving(
        ["doubled"],
        { facts: ["count", "name"] },
      );

      await manager.runEffects(new Set(["count"]));
      isDerivation.mockClear();

      await manager.runEffects(new Set(["count"]));
      expect(
        isDerivation.mock.calls.some((call) => call[0] === "doubled"),
      ).toBe(true);

      // And when it finally means something, it is picked up and the asking
      // stops.
      derivationNames.add("doubled");
      await manager.runEffects(new Set(["count"]));
      isDerivation.mockClear();

      await manager.runEffects(new Set(["count"]));
      expect(isDerivation).not.toHaveBeenCalled();
    });

    it("wakes on the namespaced name once a deps name becomes a derivation", async () => {
      const { manager, runFn, derivationNames } = setupResolving(["doubled"], {
        facts: ["count", "name"],
      });

      // Nothing holds `doubled`, so the bare name is what is recorded, and the
      // invalidation set never carries it.
      await manager.runEffects(new Set([derivationDep("doubled")]));
      expect(runFn).not.toHaveBeenCalled();

      derivationNames.add("doubled");
      await manager.runEffects(new Set([derivationDep("doubled")]));
      expect(runFn).toHaveBeenCalledTimes(1);
    });

    it("stops asking once a deps name becomes a declared fact", async () => {
      const { manager, runFn, isDerivation, isFactKey, factNames } =
        setupResolving(["later"], { facts: ["count", "name"] });

      await manager.runEffects(new Set(["count"]));
      expect(runFn).not.toHaveBeenCalled();

      // A module registered afterwards declares it. The bare name was already
      // the right one, so nothing about the dependency set moves — what changes
      // is that the question is now answered.
      factNames.add("later");
      await manager.runEffects(new Set(["later"]));
      expect(runFn).toHaveBeenCalledTimes(1);

      isDerivation.mockClear();
      isFactKey.mockClear();
      await manager.runEffects(new Set(["later"]));
      expect(isDerivation).not.toHaveBeenCalled();
      expect(isFactKey).not.toHaveBeenCalled();
      expect(runFn).toHaveBeenCalledTimes(2);
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
      const cleanups: ReturnType<typeof vi.fn>[] = [];

      const runFn = vi.fn(() => {
        const c = vi.fn();
        cleanups.push(c);

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
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const { manager } = setup({
        bad: {
          deps: ["count"],
          run: () => {
            throw new Error("boom");
          },
        },
      });

      await expect(
        manager.runEffects(new Set(["count"])),
      ).resolves.toBeUndefined();

      consoleSpy.mockRestore();
    });

    it("throwing effect does not prevent other effects from running", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
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
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
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
      await expect(
        manager.runEffects(new Set(["count"])),
      ).resolves.toBeUndefined();

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
      const { manager } = setup({ log: { run: () => {} } }, { onRun });

      await manager.runEffects(new Set(["count"]));

      expect(onRun).toHaveBeenCalledWith("log", []);
    });
  });

  // ============================================================================
  // onError callback
  // ============================================================================

  describe("onError callback", () => {
    it("fires when an effect throws", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
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
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
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

      expect(runFn.mock.calls[0]![1]).toBeNull();
    });

    it("passes previous facts snapshot on subsequent runs", async () => {
      const runFn = vi.fn();
      const { facts, manager } = setup({
        log: { deps: ["count"], run: runFn },
      });

      await manager.runEffects(new Set(["count"]));
      expect(runFn.mock.calls[0]![1]).toBeNull();

      // Change count and re-run
      facts.count = 42;
      await manager.runEffects(new Set(["count"]));

      // prev should reflect the snapshot taken after the first run
      const prev = runFn.mock.calls[1]![1];
      expect(prev).not.toBeNull();
      expect(prev!.count).toBe(0);
    });

    it("prev reflects state at the time of last runEffects call", async () => {
      const prevValues: Array<Record<string, unknown> | null> = [];
      const runFn = vi.fn(
        (_facts: unknown, prev: Record<string, unknown> | null) => {
          prevValues.push(prev ? { ...prev } : null);
        },
      );
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

      manager.assignDefinition("log", {
        deps: ["count"],
        run: newRun,
      } as never);

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

      manager.assignDefinition("log", {
        deps: ["count"],
        run: () => {},
      } as never);

      expect(oldCleanup).toHaveBeenCalledTimes(1);
    });

    it("throws when assigning to a non-existent effect", () => {
      const { manager } = setup({});

      expect(() =>
        manager.assignDefinition("nonexistent", {
          deps: ["count"],
          run: () => {},
        } as never),
      ).toThrow(/does not exist/);
    });

    // Regression: onGates leaked across assignDefinition. A data-form `on`
    // effect's compiled gate persisted in shouldRun after a swap to a
    // function-form effect, gating runs that should now be unconditional.
    it("clears a stale `on` gate when swapping to a function-form effect", async () => {
      const newRun = vi.fn();
      const { facts, manager } = setup({
        gated: {
          on: { name: "alice" } as never,
          run: () => {},
        },
      });

      // Swap from data-form `on` to function-form (no `on`, no `deps`).
      manager.assignDefinition("gated", { run: newRun } as never);

      // Mutate an unrelated fact that doesn't match the old gate. With the
      // leak, the stale gate would evaluate against the new facts and
      // suppress the run; with the fix, the function-form effect runs on
      // any change.
      facts.count = 1;
      await manager.runEffects(new Set(["count"]));

      expect(newRun).toHaveBeenCalledTimes(1);
    });

    it("rejects a non-predicate `on` value with a friendly throw", () => {
      const { manager } = setup({
        log: { deps: ["count"], run: () => {} },
      });

      expect(() =>
        manager.assignDefinition("log", {
          on: 42 as never,
          run: () => {},
        } as never),
      ).toThrow(/effect on must be a FactPredicate spec/);
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

      await expect(manager.callOne("nonexistent")).rejects.toThrow(
        /does not exist/,
      );
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
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
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

  // ==========================================================================
  // Async auto-tracking
  // ==========================================================================

  describe("async auto-tracking", () => {
    it("does not re-run for a fact read only after an await", async () => {
      const seen: number[] = [];
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { store, manager } = setup({
        watcher: {
          run: async (facts: { count: number; name: string }) => {
            void facts.count;
            await Promise.resolve();
            seen.push(facts.count);
          },
        },
      });

      await manager.runEffects(new Set(["count"]));
      store.set("name", "bob");
      await manager.runEffects(new Set(["name"]));

      // `name` is read past the await, so it was never recorded — the effect
      // is deaf to it. This is the documented limitation; the assertion pins
      // it so the warning below stays truthful.
      expect(seen).toHaveLength(1);
      warn.mockRestore();
    });

    it("warns once when every read is past the await", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { manager } = setup({
        watcher: {
          run: async (facts: { count: number }) => {
            await Promise.resolve();
            void facts.count;
          },
        },
      });

      await manager.runEffects(new Set(["count"]));
      await manager.runEffects(new Set(["count"]));
      await manager.runEffects(new Set(["count"]));

      const messages = warn.mock.calls
        .map((call) => String(call[0]))
        .filter((message) => message.includes('Async effect "watcher"'));

      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain("runs on every reconcile");
      warn.mockRestore();
    });

    it("stays quiet for an async effect whose reads are hoisted above the await", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { manager } = setup({
        watcher: {
          run: async (facts: { count: number }) => {
            const count = facts.count;
            await Promise.resolve();
            void count;
          },
        },
      });

      await manager.runEffects(new Set(["count"]));

      expect(
        warn.mock.calls.filter((call) =>
          String(call[0]).includes("Async effect"),
        ),
      ).toHaveLength(0);
      warn.mockRestore();
    });

    it("stays quiet for an async effect with explicit deps", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { manager } = setup({
        watcher: {
          deps: ["count"],
          run: async () => {
            await Promise.resolve();
          },
        },
      });

      await manager.runEffects(new Set(["count"]));

      expect(
        warn.mock.calls.filter((call) =>
          String(call[0]).includes("Async effect"),
        ),
      ).toHaveLength(0);
      warn.mockRestore();
    });
  });
});
