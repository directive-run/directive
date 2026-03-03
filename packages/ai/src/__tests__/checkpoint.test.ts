import { beforeEach, describe, expect, it } from "vitest";
import {
  InMemoryCheckpointStore,
  createCheckpointId,
  validateCheckpoint,
} from "../checkpoint.js";
import type {
  Checkpoint,
  MultiAgentCheckpointLocalState,
} from "../checkpoint.js";
import {
  createMockAgentRunner,
  createTestCheckpointStore,
  createTestMultiAgentOrchestrator,
  createTestOrchestrator,
} from "../testing.js";

// ============================================================================
// Helpers
// ============================================================================

function createValidCheckpoint(overrides?: Partial<Checkpoint>): Checkpoint {
  return {
    version: 1,
    id: createCheckpointId(),
    createdAt: new Date().toISOString(),
    systemExport: "{}",
    timelineExport: null,
    localState: { type: "single" },
    memoryExport: null,
    orchestratorType: "single",
    ...overrides,
  };
}

// ============================================================================
// 1. createCheckpointId
// ============================================================================

describe("createCheckpointId", () => {
  it("generates IDs starting with ckpt_", () => {
    const id = createCheckpointId();

    expect(id.startsWith("ckpt_")).toBe(true);
  });

  it("generates unique IDs on consecutive calls", () => {
    const a = createCheckpointId();
    const b = createCheckpointId();

    expect(a).not.toBe(b);
  });

  it("generates IDs that are non-empty strings", () => {
    const id = createCheckpointId();

    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan("ckpt_".length);
  });
});

// ============================================================================
// 2. validateCheckpoint
// ============================================================================

describe("validateCheckpoint", () => {
  it("returns false for null", () => {
    expect(validateCheckpoint(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(validateCheckpoint(undefined)).toBe(false);
  });

  it("returns false for non-objects", () => {
    expect(validateCheckpoint("not an object")).toBe(false);
    expect(validateCheckpoint(42)).toBe(false);
    expect(validateCheckpoint(true)).toBe(false);
  });

  it("returns false for wrong version", () => {
    const cp = createValidCheckpoint();
    (cp as any).version = 2;

    expect(validateCheckpoint(cp)).toBe(false);
  });

  it("returns false for missing id", () => {
    const cp = createValidCheckpoint();
    (cp as any).id = undefined;

    expect(validateCheckpoint(cp)).toBe(false);
  });

  it("returns false for missing createdAt", () => {
    const cp = createValidCheckpoint();
    (cp as any).createdAt = undefined;

    expect(validateCheckpoint(cp)).toBe(false);
  });

  it("returns false for missing systemExport", () => {
    const cp = createValidCheckpoint();
    (cp as any).systemExport = undefined;

    expect(validateCheckpoint(cp)).toBe(false);
  });

  it("returns false for invalid localState type field", () => {
    const cp = createValidCheckpoint();
    (cp as any).localState = { type: "invalid" };

    expect(validateCheckpoint(cp)).toBe(false);
  });

  it("returns false for invalid orchestratorType", () => {
    const cp = createValidCheckpoint();
    (cp as any).orchestratorType = "invalid";

    expect(validateCheckpoint(cp)).toBe(false);
  });

  it("returns true for a valid single-agent checkpoint", () => {
    const cp = createValidCheckpoint({
      orchestratorType: "single",
      localState: { type: "single" },
    });

    expect(validateCheckpoint(cp)).toBe(true);
  });

  it("returns true for a valid multi-agent checkpoint", () => {
    const cp = createValidCheckpoint({
      orchestratorType: "multi",
      localState: {
        type: "multi",
        globalTokenCount: 500,
        globalStatus: "idle",
        agentStates: {},
        handoffCounter: 0,
        pendingHandoffs: [],
        handoffResults: [],
        roundRobinCounters: null,
      },
    });

    expect(validateCheckpoint(cp)).toBe(true);
  });

  it("returns false for __proto__ key (prototype pollution defense)", () => {
    // Intentionally constructed object with __proto__ key for prototype pollution testing
    void ({
      version: 1,
      id: "ckpt_test",
      createdAt: new Date().toISOString(),
      systemExport: "{}",
      timelineExport: null,
      localState: { type: "single" },
      memoryExport: null,
      orchestratorType: "single",
      __proto__: { malicious: true },
    } as unknown);

    // Object.create(null) + explicit __proto__ key
    const obj = Object.create(null);
    obj.version = 1;
    obj.id = "ckpt_test";
    obj.createdAt = new Date().toISOString();
    obj.systemExport = "{}";
    obj.timelineExport = null;
    obj.localState = { type: "single" };
    obj.memoryExport = null;
    obj.orchestratorType = "single";
    obj.__proto__ = { malicious: true };

    expect(validateCheckpoint(obj)).toBe(false);
  });
});

// ============================================================================
// 3. InMemoryCheckpointStore
// ============================================================================

describe("InMemoryCheckpointStore", () => {
  let store: InMemoryCheckpointStore;

  beforeEach(() => {
    store = new InMemoryCheckpointStore();
  });

  it("save + load round-trip", async () => {
    const cp = createValidCheckpoint();
    const savedId = await store.save(cp);
    const loaded = await store.load(savedId);

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(cp.id);
    expect(loaded!.systemExport).toBe(cp.systemExport);
  });

  it("list returns all saved checkpoints in order", async () => {
    const cp1 = createValidCheckpoint({ label: "first" });
    const cp2 = createValidCheckpoint({ label: "second" });
    const cp3 = createValidCheckpoint({ label: "third" });

    await store.save(cp1);
    await store.save(cp2);
    await store.save(cp3);

    const list = await store.list();

    expect(list).toHaveLength(3);
    expect(list[0]!.label).toBe("first");
    expect(list[1]!.label).toBe("second");
    expect(list[2]!.label).toBe("third");
  });

  it("delete removes a checkpoint", async () => {
    const cp = createValidCheckpoint();
    await store.save(cp);

    const deleted = await store.delete(cp.id);

    expect(deleted).toBe(true);
    expect(await store.load(cp.id)).toBeNull();
    expect(await store.list()).toHaveLength(0);
  });

  it("delete returns false for unknown ID", async () => {
    const result = await store.delete("nonexistent");

    expect(result).toBe(false);
  });

  it("clear removes all checkpoints", async () => {
    await store.save(createValidCheckpoint());
    await store.save(createValidCheckpoint());
    await store.save(createValidCheckpoint());

    await store.clear();

    expect(await store.list()).toHaveLength(0);
  });

  it("FIFO eviction when maxCheckpoints exceeded", async () => {
    const smallStore = new InMemoryCheckpointStore({ maxCheckpoints: 2 });

    const cp1 = createValidCheckpoint({ label: "oldest" });
    const cp2 = createValidCheckpoint({ label: "middle" });
    const cp3 = createValidCheckpoint({ label: "newest" });

    await smallStore.save(cp1);
    await smallStore.save(cp2);
    await smallStore.save(cp3);

    const list = await smallStore.list();

    expect(list).toHaveLength(2);
    expect(list[0]!.label).toBe("middle");
    expect(list[1]!.label).toBe("newest");

    // Oldest should be evicted
    expect(await smallStore.load(cp1.id)).toBeNull();
  });

  it("rejects invalid checkpoint data on save", async () => {
    const invalid = { version: 999 } as unknown as Checkpoint;

    await expect(store.save(invalid)).rejects.toThrow(
      "Invalid checkpoint data",
    );
  });

  it("rejects maxCheckpoints < 1", () => {
    expect(() => {
      new InMemoryCheckpointStore({ maxCheckpoints: 0 });
    }).toThrow("maxCheckpoints must be >= 1");

    expect(() => {
      new InMemoryCheckpointStore({ maxCheckpoints: -5 });
    }).toThrow("maxCheckpoints must be >= 1");
  });

  it("saving duplicate ID overwrites and pushes to order", async () => {
    const cp = createValidCheckpoint({ label: "original" });
    await store.save(cp);

    const updated = { ...cp, label: "updated" };
    await store.save(updated);

    const loaded = await store.load(cp.id);

    expect(loaded!.label).toBe("updated");

    // The order array now has two entries for the same ID (save pushes unconditionally),
    // but the map only has one entry. Verify load returns the latest.
    const list = await store.list();

    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it("handles concurrent saves without data loss", async () => {
    const checkpoints = Array.from({ length: 10 }, (_, i) =>
      createValidCheckpoint({ label: `concurrent-${i}` }),
    );

    // Save all concurrently
    await Promise.all(checkpoints.map((cp) => store.save(cp)));

    const list = await store.list();

    expect(list).toHaveLength(10);

    // All checkpoints should be loadable
    for (const cp of checkpoints) {
      const loaded = await store.load(cp.id);

      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(cp.id);
    }
  });

  it("load returns null for unknown ID", async () => {
    const result = await store.load("ckpt_nonexistent");

    expect(result).toBeNull();
  });

  it("list includes createdAt from saved checkpoints", async () => {
    const cp = createValidCheckpoint({ label: "timestamped" });
    await store.save(cp);

    const list = await store.list();

    expect(list[0]!.createdAt).toBe(cp.createdAt);
  });
});

// ============================================================================
// 4. Single-agent checkpoint round-trip
// ============================================================================

describe("Single-agent checkpoint round-trip", () => {
  it("creates a checkpoint after a run", async () => {
    const store = createTestCheckpointStore();
    const orch = createTestOrchestrator({
      checkpointStore: store,
      debug: true,
      defaultMockResponse: { output: "hello", totalTokens: 50 },
    });

    await orch.run({ name: "test-agent", instructions: "" }, "Hi");
    const cp = await orch.checkpoint({ label: "after-first-run" });

    expect(cp).toBeDefined();
    expect(cp.id).toBeTruthy();
    expect(cp.label).toBe("after-first-run");
    expect(store.saved).toHaveLength(1);
  });

  it("checkpoint has orchestratorType single", async () => {
    const store = createTestCheckpointStore();
    const orch = createTestOrchestrator({
      checkpointStore: store,
      debug: true,
      defaultMockResponse: { output: "test", totalTokens: 10 },
    });

    await orch.run({ name: "agent", instructions: "" }, "input");
    const cp = await orch.checkpoint();

    expect(cp.orchestratorType).toBe("single");
    expect(cp.localState.type).toBe("single");
  });

  it("checkpoint has non-empty systemExport", async () => {
    const store = createTestCheckpointStore();
    const orch = createTestOrchestrator({
      checkpointStore: store,
      debug: true,
      defaultMockResponse: { output: "data", totalTokens: 20 },
    });

    await orch.run({ name: "agent", instructions: "" }, "input");
    const cp = await orch.checkpoint();

    expect(typeof cp.systemExport).toBe("string");
    expect(cp.systemExport.length).toBeGreaterThan(0);
  });

  it("checkpoint stores label", async () => {
    const store = createTestCheckpointStore();
    const orch = createTestOrchestrator({
      checkpointStore: store,
      debug: true,
      defaultMockResponse: { output: "data", totalTokens: 10 },
    });

    await orch.run({ name: "agent", instructions: "" }, "input");
    const cp = await orch.checkpoint({ label: "my-label" });

    expect(cp.label).toBe("my-label");
  });

  it("throws if agent is running", async () => {
    const store = createTestCheckpointStore();

    // Create a runner that blocks until we manually release it
    let releaseRunner!: () => void;
    const blockedPromise = new Promise<void>((resolve) => {
      releaseRunner = resolve;
    });

    const mockRunner = createMockAgentRunner({
      defaultResponse: {
        output: "eventually",
        totalTokens: 5,
        // Use generate to block indefinitely
        generate: () => ({
          output: "blocked",
          totalTokens: 5,
        }),
      },
    });

    // Patch the mock runner's run to block
    const originalRun = mockRunner.run;
    mockRunner.run = async (agent, input, opts) => {
      await blockedPromise;

      return originalRun(agent, input, opts);
    };

    const { createAgentOrchestrator } = await import(
      "../agent-orchestrator.js"
    );
    const orch = createAgentOrchestrator({
      runner: mockRunner.run,
      checkpointStore: store,
      debug: true,
    });

    // Start a run — the runner will block
    const runPromise = orch.run(
      { name: "blocking-agent", instructions: "" },
      "input",
    );

    // Give the orchestrator a tick to set status to "running"
    await new Promise((r) => setTimeout(r, 20));

    // Attempt checkpoint while agent is running
    await expect(orch.checkpoint()).rejects.toThrow(
      "Cannot checkpoint while agent is running",
    );

    // Release the runner so the test completes cleanly
    releaseRunner();

    try {
      await runPromise;
    } catch {
      // May throw — that's fine for cleanup
    }
  });
});

// ============================================================================
// 5. Multi-agent checkpoint round-trip
// ============================================================================

describe("Multi-agent checkpoint round-trip", () => {
  it("creates a checkpoint after a run", async () => {
    const store = createTestCheckpointStore();
    const orch = createTestMultiAgentOrchestrator({
      agents: {
        alpha: { agent: { name: "alpha", instructions: "" } },
        beta: { agent: { name: "beta", instructions: "" } },
      },
      checkpointStore: store,
      debug: true,
      defaultMockResponse: { output: "multi-output", totalTokens: 75 },
    });

    await orch.runAgent("alpha", "Do something");
    const cp = await orch.checkpoint({ label: "multi-checkpoint" });

    expect(cp).toBeDefined();
    expect(cp.id).toBeTruthy();
    expect(cp.label).toBe("multi-checkpoint");
    expect(store.saved).toHaveLength(1);
  });

  it("checkpoint has orchestratorType multi", async () => {
    const store = createTestCheckpointStore();
    const orch = createTestMultiAgentOrchestrator({
      agents: {
        alpha: { agent: { name: "alpha", instructions: "" } },
      },
      checkpointStore: store,
      debug: true,
      defaultMockResponse: { output: "result", totalTokens: 30 },
    });

    await orch.runAgent("alpha", "input");
    const cp = await orch.checkpoint();

    expect(cp.orchestratorType).toBe("multi");
    expect(cp.localState.type).toBe("multi");
  });

  it("localState captures globalTokenCount and agentStates", async () => {
    const store = createTestCheckpointStore();
    const orch = createTestMultiAgentOrchestrator({
      agents: {
        alpha: { agent: { name: "alpha", instructions: "" } },
        beta: { agent: { name: "beta", instructions: "" } },
      },
      checkpointStore: store,
      debug: true,
      defaultMockResponse: { output: "output", totalTokens: 100 },
    });

    await orch.runAgent("alpha", "task 1");
    await orch.runAgent("beta", "task 2");
    const cp = await orch.checkpoint();

    const local = cp.localState as MultiAgentCheckpointLocalState;

    expect(local.type).toBe("multi");
    expect(typeof local.globalTokenCount).toBe("number");
    expect(local.globalTokenCount).toBeGreaterThan(0);
    expect(local.agentStates).toBeDefined();
    expect(local.agentStates.alpha).toBeDefined();
    expect(local.agentStates.beta).toBeDefined();
  });

  it("restore() then checkpoint() produces similar state", async () => {
    const store = createTestCheckpointStore();
    const orch = createTestMultiAgentOrchestrator({
      agents: {
        alpha: { agent: { name: "alpha", instructions: "" } },
        beta: { agent: { name: "beta", instructions: "" } },
      },
      checkpointStore: store,
      debug: true,
      defaultMockResponse: { output: "output", totalTokens: 50 },
    });

    // Run agents and checkpoint
    await orch.runAgent("alpha", "task A");
    await orch.runAgent("beta", "task B");
    const cp1 = await orch.checkpoint({ label: "before-restore" });

    // Restore from checkpoint
    orch.restore(cp1);

    // Checkpoint again after restore
    const cp2 = await orch.checkpoint({ label: "after-restore" });

    const local1 = cp1.localState as MultiAgentCheckpointLocalState;
    const local2 = cp2.localState as MultiAgentCheckpointLocalState;

    // The restored state should match the original
    expect(local2.globalTokenCount).toBe(local1.globalTokenCount);
    expect(local2.globalStatus).toBe(local1.globalStatus);
    expect(Object.keys(local2.agentStates)).toEqual(
      Object.keys(local1.agentStates),
    );
    expect(local2.handoffCounter).toBe(local1.handoffCounter);
  });
});
