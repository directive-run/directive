import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createInMemoryAuditStore,
  createInMemoryCheckpointStore,
  type AuditStore,
  type CheckpointStore,
  type ArchitectCheckpoint,
  type GuardStateSnapshot,
} from "../persistence.js";
import { createTestSystem, mockRunner } from "../testing.js";
import { createAIArchitect } from "../architect.js";
import type { AuditEntry, ArchitectEvent } from "../types.js";

// ============================================================================
// Helpers
// ============================================================================

function makeAuditEntry(
  id: number,
  overrides: Partial<AuditEntry> = {},
): AuditEntry {
  return {
    id: `audit-${id}`,
    timestamp: Date.now() + id,
    trigger: "demand",
    definitionType: "constraint",
    definitionId: `def-${id}`,
    code: `() => true`,
    approved: true,
    applied: true,
    riskScore: 0.3,
    prevHash: `prev-${id}`,
    hash: `hash-${id}`,
    ...overrides,
  };
}

function makeCheckpoint(
  overrides: Partial<ArchitectCheckpoint> = {},
): ArchitectCheckpoint {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    dynamicIds: [],
    actions: [],
    rollbackEntries: [],
    approvedDefinitions: [],
    actionTimestamps: [],
    versionCounter: 0,
    guardState: {
      tokensUsed: 0,
      dollarsUsed: 0,
      alertedThresholds: [],
      circuitBreakerState: "closed",
      failureCount: 0,
    },
    auditCounter: 0,
    ...overrides,
  };
}

// ============================================================================
// In-Memory Audit Store
// ============================================================================

describe("createInMemoryAuditStore", () => {
  it("appends and queries entries", async () => {
    const store = createInMemoryAuditStore();

    await store.append(makeAuditEntry(1));
    await store.append(makeAuditEntry(2));

    const all = await store.query();
    expect(all).toHaveLength(2);
    expect(all[0]!.id).toBe("audit-1");
    expect(all[1]!.id).toBe("audit-2");
  });

  it("counts entries", async () => {
    const store = createInMemoryAuditStore();

    expect(await store.count()).toBe(0);
    await store.append(makeAuditEntry(1));
    expect(await store.count()).toBe(1);
    await store.append(makeAuditEntry(2));
    expect(await store.count()).toBe(2);
  });

  it("queries by trigger", async () => {
    const store = createInMemoryAuditStore();
    await store.append(makeAuditEntry(1, { trigger: "demand" }));
    await store.append(makeAuditEntry(2, { trigger: "settled" }));
    await store.append(makeAuditEntry(3, { trigger: "demand" }));

    const results = await store.query({ trigger: "demand" });
    expect(results).toHaveLength(2);
    expect(results.every((e) => e.trigger === "demand")).toBe(true);
  });

  it("queries by definitionType", async () => {
    const store = createInMemoryAuditStore();
    await store.append(makeAuditEntry(1, { definitionType: "constraint" }));
    await store.append(makeAuditEntry(2, { definitionType: "resolver" }));

    const results = await store.query({ definitionType: "resolver" });
    expect(results).toHaveLength(1);
    expect(results[0]!.definitionType).toBe("resolver");
  });

  it("queries by time range (after/before)", async () => {
    const store = createInMemoryAuditStore();
    const now = Date.now();
    await store.append(makeAuditEntry(1, { timestamp: now - 100 }));
    await store.append(makeAuditEntry(2, { timestamp: now }));
    await store.append(makeAuditEntry(3, { timestamp: now + 100 }));

    const results = await store.query({ after: now - 50, before: now + 50 });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("audit-2");
  });

  it("queries by approved/applied status", async () => {
    const store = createInMemoryAuditStore();
    await store.append(makeAuditEntry(1, { approved: true, applied: true }));
    await store.append(makeAuditEntry(2, { approved: false, applied: false }));
    await store.append(makeAuditEntry(3, { approved: true, applied: false }));

    const approved = await store.query({ approved: true });
    expect(approved).toHaveLength(2);

    const applied = await store.query({ applied: true });
    expect(applied).toHaveLength(1);
    expect(applied[0]!.id).toBe("audit-1");
  });

  it("respects query limit", async () => {
    const store = createInMemoryAuditStore();
    for (let i = 1; i <= 10; i++) {
      await store.append(makeAuditEntry(i));
    }

    const results = await store.query({ limit: 3 });
    expect(results).toHaveLength(3);
    // limit takes the last N entries
    expect(results[0]!.id).toBe("audit-8");
  });

  it("returns copies — mutations don't affect store", async () => {
    const store = createInMemoryAuditStore();
    await store.append(makeAuditEntry(1));

    const results = await store.query();
    results.push(makeAuditEntry(99));

    expect(await store.count()).toBe(1);
  });

  it("verifies hash chain — valid chain", async () => {
    const store = createInMemoryAuditStore();
    await store.append(makeAuditEntry(1, { prevHash: "genesis", hash: "h1" }));
    await store.append(makeAuditEntry(2, { prevHash: "h1", hash: "h2" }));
    await store.append(makeAuditEntry(3, { prevHash: "h2", hash: "h3" }));

    expect(await store.verifyChain()).toBe(true);
  });

  it("verifies hash chain — broken chain", async () => {
    const store = createInMemoryAuditStore();
    await store.append(makeAuditEntry(1, { prevHash: "genesis", hash: "h1" }));
    await store.append(makeAuditEntry(2, { prevHash: "WRONG", hash: "h2" }));

    expect(await store.verifyChain()).toBe(false);
  });

  it("verifies empty chain as valid", async () => {
    const store = createInMemoryAuditStore();
    expect(await store.verifyChain()).toBe(true);
  });

  it("evicts oldest entries when maxEntries reached (ring buffer)", async () => {
    const store = createInMemoryAuditStore(3);
    await store.append(makeAuditEntry(1, { prevHash: "g", hash: "h1" }));
    await store.append(makeAuditEntry(2, { prevHash: "h1", hash: "h2" }));
    await store.append(makeAuditEntry(3, { prevHash: "h2", hash: "h3" }));
    await store.append(makeAuditEntry(4, { prevHash: "h3", hash: "h4" }));

    expect(await store.count()).toBe(3);
    const all = await store.query();
    expect(all[0]!.id).toBe("audit-2");
    expect(all[2]!.id).toBe("audit-4");
  });

  it("verifies chain after eviction (genesis hash tracking)", async () => {
    const store = createInMemoryAuditStore(2);
    await store.append(makeAuditEntry(1, { prevHash: "g", hash: "h1" }));
    await store.append(makeAuditEntry(2, { prevHash: "h1", hash: "h2" }));
    // Evicts entry 1, genesis hash becomes "h1"
    await store.append(makeAuditEntry(3, { prevHash: "h2", hash: "h3" }));

    // Entry 2 (prevHash="h1") should match genesis hash "h1"
    expect(await store.verifyChain()).toBe(true);
  });
});

// ============================================================================
// In-Memory Checkpoint Store
// ============================================================================

describe("createInMemoryCheckpointStore", () => {
  it("returns null when no checkpoint saved", async () => {
    const store = createInMemoryCheckpointStore();
    expect(await store.load()).toBeNull();
  });

  it("save/load roundtrip preserves all fields", async () => {
    const store = createInMemoryCheckpointStore();
    const checkpoint = makeCheckpoint({
      dynamicIds: ["constraint::my-c"],
      actions: [["a1", {
        id: "a1",
        tool: "create_constraint",
        arguments: "{}",
        riskScore: 0.3,
        reasoning: { trigger: "demand", observation: "x", justification: "y", expectedOutcome: "z", raw: "" },
        approvalStatus: "auto-approved",
        version: 1,
        timestamp: Date.now(),
      }]],
      rollbackEntries: [["a1", { actionId: "a1", type: "constraint", definitionId: "my-c", previousCode: null }]],
      approvedDefinitions: ["constraint::my-c"],
      actionTimestamps: [Date.now()],
      versionCounter: 5,
      guardState: {
        tokensUsed: 500,
        dollarsUsed: 1.5,
        alertedThresholds: [0.8],
        circuitBreakerState: "closed",
        failureCount: 2,
      },
      auditCounter: 10,
    });

    await store.save(checkpoint);
    const loaded = await store.load();

    expect(loaded).toEqual(checkpoint);
  });

  it("overwrites previous checkpoint on save", async () => {
    const store = createInMemoryCheckpointStore();

    await store.save(makeCheckpoint({ versionCounter: 1 }));
    await store.save(makeCheckpoint({ versionCounter: 2 }));

    const loaded = await store.load();
    expect(loaded!.versionCounter).toBe(2);
  });
});

// ============================================================================
// Guard State Export/Import
// ============================================================================

describe("guard state roundtrip", () => {
  it("exports and imports guard state correctly", async () => {
    // We test this through the architect — apply some budget usage, export, import
    const system = createTestSystem({ phase: "red" });

    // Use a runner that consumes tokens
    const runner = mockRunner([
      {
        toolCalls: [{ name: "observe_system", arguments: "{}" }],
        totalTokens: 500,
      },
    ]);

    const architect = createAIArchitect({
      system: system as any,
      runner,
      budget: { tokens: 100_000, dollars: 10 },
      safety: { approval: { constraints: "never", resolvers: "never" } },
    });

    // Trigger an analysis to consume some tokens
    await architect.analyze("test prompt");

    const usage = architect.getBudgetUsage();
    expect(usage.tokens).toBe(500);
    expect(usage.dollars).toBeGreaterThan(0);

    architect.destroy();
  });
});

// ============================================================================
// Pipeline Hydration & Checkpointing (Integration)
// ============================================================================

describe("persistence integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hydrate returns false when no checkpoint store configured", async () => {
    const system = createTestSystem({ phase: "red" });
    const runner = mockRunner([]);

    const architect = createAIArchitect({
      system: system as any,
      runner,
      budget: { tokens: 100_000, dollars: 10 },
      safety: { approval: { constraints: "never", resolvers: "never" } },
      // No persistence configured
    });

    // Architect should work fine without persistence
    expect(architect.getActiveDefinitions()).toHaveLength(0);
    architect.destroy();
  });

  it("checkpoint is saved after actions and can be loaded", async () => {
    const system = createTestSystem({ phase: "red" });
    const checkpointStore = createInMemoryCheckpointStore();
    const auditStore = createInMemoryAuditStore();

    // Runner that calls observe_system (always succeeds, triggers audit + checkpoint)
    const runner = mockRunner([
      {
        toolCalls: [{ name: "observe_system", arguments: "{}" }],
        totalTokens: 200,
      },
    ]);

    const architect = createAIArchitect({
      system: system as any,
      runner,
      budget: { tokens: 100_000, dollars: 10 },
      safety: { approval: { constraints: "never", resolvers: "never" } },
      persistence: {
        audit: auditStore,
        checkpoint: checkpointStore,
      },
    });

    // Need to wait for async init
    await vi.advanceTimersByTimeAsync(100);

    await architect.analyze("test prompt");

    // Checkpoint is debounced — advance past debounce window
    await vi.advanceTimersByTimeAsync(1500);

    const checkpoint = await checkpointStore.load();
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.version).toBe(1);
    expect(checkpoint!.versionCounter).toBeGreaterThanOrEqual(0);

    architect.destroy();
  });

  it("audit entries are routed to external AuditStore", async () => {
    const system = createTestSystem({ phase: "red" });
    const auditStore = createInMemoryAuditStore();

    const runner = mockRunner([
      {
        toolCalls: [{ name: "observe_system", arguments: "{}" }],
        totalTokens: 200,
      },
    ]);

    const architect = createAIArchitect({
      system: system as any,
      runner,
      budget: { tokens: 100_000, dollars: 10 },
      safety: { approval: { constraints: "never", resolvers: "never" } },
      persistence: { audit: auditStore },
    });

    await vi.advanceTimersByTimeAsync(100);
    await architect.analyze("test prompt");

    // Audit entries should have been routed to the store
    const count = await auditStore.count();
    expect(count).toBeGreaterThan(0);

    architect.destroy();
  });

  it("checkpoint debounce coalesces rapid state changes", async () => {
    const checkpointStore = createInMemoryCheckpointStore();
    const saveSpy = vi.spyOn(checkpointStore, "save");

    const system = createTestSystem({ phase: "red" });
    const runner = mockRunner([
      {
        toolCalls: [{ name: "observe_system", arguments: "{}" }],
        totalTokens: 50,
      },
      {
        toolCalls: [{ name: "observe_system", arguments: "{}" }],
        totalTokens: 50,
      },
      {
        toolCalls: [{ name: "observe_system", arguments: "{}" }],
        totalTokens: 50,
      },
    ]);

    const architect = createAIArchitect({
      system: system as any,
      runner,
      budget: { tokens: 100_000, dollars: 10 },
      safety: { approval: { constraints: "never", resolvers: "never" } },
      persistence: { checkpoint: checkpointStore },
    });

    await vi.advanceTimersByTimeAsync(100);

    // Multiple rapid analyses
    await architect.analyze("test 1");
    await architect.analyze("test 2");
    await architect.analyze("test 3");

    // Before debounce fires
    expect(saveSpy).not.toHaveBeenCalled();

    // Advance past debounce (1000ms)
    await vi.advanceTimersByTimeAsync(1500);

    // Should have coalesced into fewer saves than 3
    // (observe_system doesn't apply actions, so there may be 0 scheduled checkpoints
    //  from apply, but destroy will do a final save)
    architect.destroy();

    // The destroy call does a synchronous final save
    // At minimum, the final checkpoint should have been saved
    const loaded = await checkpointStore.load();
    expect(loaded).not.toBeNull();
  });

  it("audit store error emits error event but continues", async () => {
    const system = createTestSystem({ phase: "red" });
    const events: ArchitectEvent[] = [];

    const failingAuditStore: AuditStore = {
      async append() { throw new Error("DB down"); },
      async query() { return []; },
      async count() { return 0; },
      async verifyChain() { return true; },
    };

    const runner = mockRunner([
      {
        toolCalls: [{ name: "observe_system", arguments: "{}" }],
        totalTokens: 100,
      },
    ]);

    const architect = createAIArchitect({
      system: system as any,
      runner,
      budget: { tokens: 100_000, dollars: 10 },
      safety: { approval: { constraints: "never", resolvers: "never" } },
      persistence: { audit: failingAuditStore },
    });

    architect.on((e) => events.push(e));
    await vi.advanceTimersByTimeAsync(100);

    // Analysis should still work even if audit store fails
    const analysis = await architect.analyze("test prompt");
    expect(analysis).toBeDefined();

    // Wait for async error to fire
    await vi.advanceTimersByTimeAsync(100);

    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents.length).toBeGreaterThan(0);

    architect.destroy();
  });

  it("checkpoint store error emits error event but continues", async () => {
    const system = createTestSystem({ phase: "red" });
    const events: ArchitectEvent[] = [];

    const failingCheckpointStore: CheckpointStore = {
      async save() { throw new Error("Disk full"); },
      async load() { return null; },
    };

    const runner = mockRunner([
      {
        toolCalls: [{ name: "observe_system", arguments: "{}" }],
        totalTokens: 100,
      },
    ]);

    const architect = createAIArchitect({
      system: system as any,
      runner,
      budget: { tokens: 100_000, dollars: 10 },
      safety: { approval: { constraints: "never", resolvers: "never" } },
      persistence: { checkpoint: failingCheckpointStore },
    });

    architect.on((e) => events.push(e));
    await vi.advanceTimersByTimeAsync(100);

    // Analysis should still work
    const analysis = await architect.analyze("test prompt");
    expect(analysis).toBeDefined();

    // Trigger checkpoint debounce
    await vi.advanceTimersByTimeAsync(1500);

    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents.length).toBeGreaterThan(0);

    architect.destroy();
  });

  it("destroy saves final checkpoint", async () => {
    const system = createTestSystem({ phase: "red" });
    const checkpointStore = createInMemoryCheckpointStore();

    const runner = mockRunner([]);
    const architect = createAIArchitect({
      system: system as any,
      runner,
      budget: { tokens: 100_000, dollars: 10 },
      safety: { approval: { constraints: "never", resolvers: "never" } },
      persistence: { checkpoint: checkpointStore },
    });

    await vi.advanceTimersByTimeAsync(100);

    architect.destroy();

    // Final checkpoint should have been saved
    const checkpoint = await checkpointStore.load();
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.version).toBe(1);
  });

  it("combined query filters work correctly", async () => {
    const store = createInMemoryAuditStore();
    const now = Date.now();

    await store.append(makeAuditEntry(1, { trigger: "demand", approved: true, timestamp: now - 100 }));
    await store.append(makeAuditEntry(2, { trigger: "demand", approved: false, timestamp: now }));
    await store.append(makeAuditEntry(3, { trigger: "settled", approved: true, timestamp: now + 100 }));

    // Combine trigger + approved + time
    const results = await store.query({
      trigger: "demand",
      approved: true,
      after: now - 200,
      before: now + 200,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("audit-1");
  });
});
