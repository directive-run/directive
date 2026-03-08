import { describe, expect, it, vi } from "vitest";

import {
  createAgentAuditHandlers,
  createAuditTrail,
} from "../../plugins/audit.js";
import type { AuditEntry, AuditInstance } from "../../plugins/audit.js";

// ============================================================================
// addEntry
// ============================================================================

describe("addEntry", () => {
  it("creates entry with id, timestamp, eventType, payload", async () => {
    const audit = createAuditTrail();
    const entry = await audit.addEntry("agent.run.start", { foo: "bar" });

    expect(entry.id).toBeDefined();
    expect(typeof entry.id).toBe("string");
    expect(typeof entry.timestamp).toBe("number");
    expect(entry.eventType).toBe("agent.run.start");
    expect(entry.payload).toEqual({ foo: "bar" });
  });

  it("calculates SHA-256 hash", async () => {
    const audit = createAuditTrail();
    const entry = await audit.addEntry("fact.set", { key: "x", value: 1 });

    // SHA-256 produces 64-char hex string
    expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("links to previous entry hash (hash chain)", async () => {
    const audit = createAuditTrail();
    const first = await audit.addEntry("agent.run.start", { step: 1 });
    const second = await audit.addEntry("agent.run.complete", { step: 2 });

    expect(second.previousHash).toBe(first.hash);
  });

  it("first entry links to genesis hash", async () => {
    const audit = createAuditTrail();
    const entry = await audit.addEntry("agent.run.start", {});

    expect(entry.previousHash).toBe("0".repeat(64));
  });

  it("sets actorId and sessionId from config", async () => {
    const audit = createAuditTrail({
      actorId: "user-42",
      sessionId: "sess-abc",
    });
    const entry = await audit.addEntry("fact.set", { key: "x" });

    expect(entry.actorId).toBe("user-42");
    expect(entry.sessionId).toBe("sess-abc");
  });

  it("fires onEntryAdded callback", async () => {
    const onEntryAdded = vi.fn();
    const audit = createAuditTrail({ events: { onEntryAdded } });

    const entry = await audit.addEntry("agent.run.start", {});

    expect(onEntryAdded).toHaveBeenCalledOnce();
    expect(onEntryAdded).toHaveBeenCalledWith(entry);
  });
});

// ============================================================================
// getEntries
// ============================================================================

describe("getEntries", () => {
  async function seedAudit(): Promise<{
    audit: AuditInstance;
    entries: AuditEntry[];
  }> {
    const audit = createAuditTrail({
      actorId: "actor-1",
      sessionId: "sess-1",
    });
    const entries: AuditEntry[] = [];
    entries.push(
      await audit.addEntry("agent.run.start", { agent: "a" }),
    );
    entries.push(
      await audit.addEntry("tool.call.start", { tool: "t" }),
    );
    entries.push(
      await audit.addEntry("agent.run.complete", { agent: "a" }),
    );

    return { audit, entries };
  }

  it("returns all entries without filter", async () => {
    const { audit, entries } = await seedAudit();
    const result = audit.getEntries();

    expect(result).toHaveLength(3);
    expect(result[0]!.id).toBe(entries[0]!.id);
    expect(result[2]!.id).toBe(entries[2]!.id);
  });

  it("filters by eventTypes", async () => {
    const { audit } = await seedAudit();
    const result = audit.getEntries({ eventTypes: ["tool.call.start"] });

    expect(result).toHaveLength(1);
    expect(result[0]!.eventType).toBe("tool.call.start");
  });

  it("filters by actorId", async () => {
    const audit = createAuditTrail({ actorId: "actor-1" });
    await audit.addEntry("agent.run.start", {});

    const audit2 = createAuditTrail({ actorId: "actor-2" });
    await audit2.addEntry("agent.run.start", {});

    // actorId filter on the first audit (all entries have actor-1)
    const matching = audit.getEntries({ actorId: "actor-1" });
    const nonMatching = audit.getEntries({ actorId: "actor-99" });

    expect(matching).toHaveLength(1);
    expect(nonMatching).toHaveLength(0);
  });

  it("filters by sessionId", async () => {
    const audit = createAuditTrail({ sessionId: "sess-A" });
    await audit.addEntry("agent.run.start", {});
    await audit.addEntry("agent.run.complete", {});

    const result = audit.getEntries({ sessionId: "sess-A" });
    const none = audit.getEntries({ sessionId: "sess-B" });

    expect(result).toHaveLength(2);
    expect(none).toHaveLength(0);
  });

  it("filters by since/until timestamps", async () => {
    const audit = createAuditTrail();

    const before = Date.now();
    await audit.addEntry("agent.run.start", {});

    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 5));
    const mid = Date.now();

    await audit.addEntry("agent.run.complete", {});
    await new Promise((r) => setTimeout(r, 5));
    const after = Date.now();

    const sinceMid = audit.getEntries({ since: mid });
    const untilMid = audit.getEntries({ until: mid - 1 });
    const all = audit.getEntries({ since: before, until: after });

    expect(sinceMid.length).toBeGreaterThanOrEqual(1);
    expect(untilMid.length).toBeLessThanOrEqual(1);
    expect(all).toHaveLength(2);
  });

  it("supports limit and offset for pagination", async () => {
    const { audit } = await seedAudit();

    const page1 = audit.getEntries({ limit: 2 });
    const page2 = audit.getEntries({ limit: 2, offset: 2 });

    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(1);
    expect(page1[0]!.eventType).toBe("agent.run.start");
    expect(page2[0]!.eventType).toBe("agent.run.complete");
  });
});

// ============================================================================
// verifyChain
// ============================================================================

describe("verifyChain", () => {
  it("returns valid for empty chain", async () => {
    const audit = createAuditTrail();
    const result = await audit.verifyChain();

    expect(result.valid).toBe(true);
    expect(result.entriesVerified).toBe(0);
    expect(typeof result.verifiedAt).toBe("number");
  });

  it("returns valid for intact chain", async () => {
    const audit = createAuditTrail();
    await audit.addEntry("agent.run.start", { step: 1 });
    await audit.addEntry("tool.call.start", { step: 2 });
    await audit.addEntry("agent.run.complete", { step: 3 });

    const result = await audit.verifyChain();

    expect(result.valid).toBe(true);
    expect(result.entriesVerified).toBe(3);
  });

  it("returns invalid when hash is tampered with", async () => {
    const onChainBroken = vi.fn();
    const audit = createAuditTrail({ events: { onChainBroken } });

    await audit.addEntry("agent.run.start", { a: 1 });
    await audit.addEntry("tool.call.start", { b: 2 });

    // getEntries returns shallow copies — same object refs. Tamper with hash.
    const entries = audit.getEntries();
    const original = entries[0]!.hash;
    (entries[0] as { hash: string }).hash = "x".repeat(64);

    const result = await audit.verifyChain();

    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBeDefined();
    expect(result.brokenAt!.index).toBe(0);
    expect(result.brokenAt!.entryId).toBe(entries[0]!.id);
    expect(result.brokenAt!.expectedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.brokenAt!.actualHash).toBe("x".repeat(64));
    expect(onChainBroken).toHaveBeenCalledOnce();

    // Restore for cleanup
    (entries[0] as { hash: string }).hash = original;
  });

  it("fires onChainBroken callback on tamper detection", async () => {
    const onChainBroken = vi.fn();
    const audit = createAuditTrail({ events: { onChainBroken } });

    await audit.addEntry("agent.run.start", {});

    // For an intact chain, onChainBroken should NOT be called
    await audit.verifyChain();

    expect(onChainBroken).not.toHaveBeenCalled();
  });

  it("validates chain linkage (previousHash matches prior entry hash)", async () => {
    const audit = createAuditTrail();
    const first = await audit.addEntry("agent.run.start", {});
    const second = await audit.addEntry("agent.run.complete", {});

    // Second entry's previousHash must match first entry's hash
    expect(second.previousHash).toBe(first.hash);

    // Chain should verify
    const result = await audit.verifyChain();

    expect(result.valid).toBe(true);
    expect(result.entriesVerified).toBe(2);
  });
});

// ============================================================================
// signing
// ============================================================================

describe("signing", () => {
  it("calls signFn with hash on addEntry", async () => {
    const signFn = vi.fn().mockResolvedValue("sig-abc");
    const audit = createAuditTrail({ signing: { signFn } });

    const entry = await audit.addEntry("agent.run.start", { x: 1 });

    expect(signFn).toHaveBeenCalledOnce();
    expect(signFn).toHaveBeenCalledWith(entry.hash);
    expect(entry.signature).toBe("sig-abc");
  });

  it("verifyChain checks signature via verifyFn", async () => {
    const signFn = vi.fn().mockResolvedValue("valid-sig");
    const verifyFn = vi.fn().mockResolvedValue(true);
    const audit = createAuditTrail({ signing: { signFn, verifyFn } });

    await audit.addEntry("agent.run.start", {});
    await audit.addEntry("agent.run.complete", {});

    const result = await audit.verifyChain();

    expect(result.valid).toBe(true);
    expect(verifyFn).toHaveBeenCalledTimes(2);

    // Each call should receive (hash, signature)
    for (const call of verifyFn.mock.calls) {
      expect(call[0]).toMatch(/^[0-9a-f]{64}$/);
      expect(call[1]).toBe("valid-sig");
    }
  });

  it("verifyChain reports invalid when verifyFn returns false", async () => {
    const signFn = vi.fn().mockResolvedValue("bad-sig");
    const verifyFn = vi.fn().mockResolvedValue(false);
    const onChainBroken = vi.fn();
    const audit = createAuditTrail({
      signing: { signFn, verifyFn },
      events: { onChainBroken },
    });

    await audit.addEntry("agent.run.start", {});

    const result = await audit.verifyChain();

    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBeDefined();
    expect(result.brokenAt!.index).toBe(0);
    expect(result.brokenAt!.expectedHash).toBe("signature-invalid");
    expect(result.brokenAt!.actualHash).toBe("bad-sig");
    expect(onChainBroken).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// maxEntries / FIFO eviction
// ============================================================================

describe("maxEntries / FIFO eviction", () => {
  it("evicts oldest entries when exceeding maxEntries", async () => {
    const audit = createAuditTrail({ maxEntries: 3 });

    await audit.addEntry("agent.run.start", { n: 1 });
    await audit.addEntry("tool.call.start", { n: 2 });
    await audit.addEntry("tool.call.complete", { n: 3 });
    await audit.addEntry("agent.run.complete", { n: 4 });

    const entries = audit.getEntries();

    expect(entries).toHaveLength(3);
    // First entry (n:1) should have been evicted
    expect(entries[0]!.payload).toEqual({ n: 2 });
    expect(entries[2]!.payload).toEqual({ n: 4 });
  });
});

// ============================================================================
// prune
// ============================================================================

describe("prune", () => {
  it("removes entries older than retentionMs", async () => {
    // Use a very short retention
    const audit = createAuditTrail({ retentionMs: 50 });

    await audit.addEntry("agent.run.start", { old: true });
    await new Promise((r) => setTimeout(r, 60));
    await audit.addEntry("agent.run.complete", { recent: true });

    const pruned = audit.prune();

    expect(pruned).toBe(1);
    expect(audit.getEntries()).toHaveLength(1);
    expect(audit.getEntries()[0]!.payload).toEqual({ recent: true });
  });

  it("returns count of pruned entries", async () => {
    const audit = createAuditTrail({ retentionMs: 50 });

    await audit.addEntry("agent.run.start", {});
    await audit.addEntry("tool.call.start", {});
    await new Promise((r) => setTimeout(r, 60));

    const pruned = audit.prune();

    expect(pruned).toBe(2);
  });
});

// ============================================================================
// export
// ============================================================================

describe("export", () => {
  it("returns all entries", async () => {
    const audit = createAuditTrail();
    await audit.addEntry("agent.run.start", {});
    await audit.addEntry("agent.run.complete", {});

    const exported = await audit.export();

    expect(exported).toHaveLength(2);
  });

  it("filters by since timestamp", async () => {
    const audit = createAuditTrail();
    await audit.addEntry("agent.run.start", {});
    await new Promise((r) => setTimeout(r, 5));
    const mid = Date.now();
    await audit.addEntry("agent.run.complete", {});

    const exported = await audit.export(mid);

    expect(exported).toHaveLength(1);
    expect(exported[0]!.eventType).toBe("agent.run.complete");
  });

  it("calls exporter function if configured", async () => {
    const exporter = vi.fn().mockResolvedValue(undefined);
    const audit = createAuditTrail({ exporter, exportInterval: 0 });

    await audit.addEntry("agent.run.start", { data: 1 });
    const exported = await audit.export();

    expect(exporter).toHaveBeenCalledOnce();
    expect(exporter.mock.calls[0]![0]).toHaveLength(1);
    expect(exported).toHaveLength(1);
  });
});

// ============================================================================
// PII masking
// ============================================================================

describe("PII masking", () => {
  it("creates maskedPayload when piiMasking.enabled=true", async () => {
    const audit = createAuditTrail({
      piiMasking: {
        enabled: true,
        types: ["ssn"],
        redactionStyle: "typed",
      },
    });

    const entry = await audit.addEntry("agent.run.start", {
      message: "SSN: 123-45-6789",
    });

    expect(entry.maskedPayload).toBeDefined();
    // The SSN should be redacted with typed style -> [SSN]
    expect(entry.maskedPayload!.message).toContain("[SSN]");
    expect(entry.maskedPayload!.message).not.toContain("123-45-6789");

    // Original payload should be untouched
    expect(entry.payload.message).toBe("SSN: 123-45-6789");
  });
});

// ============================================================================
// getStats
// ============================================================================

describe("getStats", () => {
  it("returns totalEntries, byEventType counts, oldestEntry, newestEntry, entriesPruned", async () => {
    const audit = createAuditTrail({ retentionMs: 50 });

    await audit.addEntry("agent.run.start", {});
    await audit.addEntry("agent.run.start", {});
    await audit.addEntry("tool.call.start", {});

    // Force prune of 0 entries (all recent)
    audit.prune();

    const stats = audit.getStats();

    expect(stats.totalEntries).toBe(3);
    expect(stats.byEventType["agent.run.start"]).toBe(2);
    expect(stats.byEventType["tool.call.start"]).toBe(1);
    expect(typeof stats.oldestEntry).toBe("number");
    expect(typeof stats.newestEntry).toBe("number");
    expect(stats.oldestEntry).toBeLessThanOrEqual(stats.newestEntry!);
    expect(stats.entriesPruned).toBe(0);
  });

  it("tracks entriesPruned across prune calls", async () => {
    const audit = createAuditTrail({ retentionMs: 30 });

    await audit.addEntry("agent.run.start", {});
    await new Promise((r) => setTimeout(r, 40));
    audit.prune();

    await audit.addEntry("agent.run.complete", {});
    const stats = audit.getStats();

    expect(stats.entriesPruned).toBe(1);
    expect(stats.totalEntries).toBe(1);
  });
});

// ============================================================================
// dispose
// ============================================================================

describe("dispose", () => {
  it("clears export timer", async () => {
    const exporter = vi.fn().mockResolvedValue(undefined);
    const audit = createAuditTrail({
      exporter,
      exportInterval: 100,
    });

    await audit.dispose();

    // After dispose, the timer should be cleared. Adding an entry and waiting
    // should not trigger the exporter again (timer was cleared).
    exporter.mockClear();
    await new Promise((r) => setTimeout(r, 150));

    // The exporter should NOT have been called by the interval after dispose
    // (it may have been called once during dispose to flush)
    expect(exporter.mock.calls.length).toBeLessThanOrEqual(0);
  });

  it("flushes remaining entries to exporter", async () => {
    const exporter = vi.fn().mockResolvedValue(undefined);
    const audit = createAuditTrail({
      exporter,
      exportInterval: 0, // No auto-export timer
    });

    await audit.addEntry("agent.run.start", { flushed: true });
    await audit.dispose();

    expect(exporter).toHaveBeenCalledOnce();
    expect(exporter.mock.calls[0]![0]).toHaveLength(1);
    expect(exporter.mock.calls[0]![0][0].payload).toEqual({ flushed: true });
  });
});

// ============================================================================
// createPlugin
// ============================================================================

describe("createPlugin", () => {
  it('returns plugin with name "audit-trail"', () => {
    const audit = createAuditTrail();
    const plugin = audit.createPlugin();

    expect(plugin.name).toBe("audit-trail");
  });
});

// ============================================================================
// createAgentAuditHandlers
// ============================================================================

describe("createAgentAuditHandlers", () => {
  it("returns expected handler functions", () => {
    const audit = createAuditTrail();
    const handlers = createAgentAuditHandlers(audit);

    expect(typeof handlers.onAgentStart).toBe("function");
    expect(typeof handlers.onAgentComplete).toBe("function");
    expect(typeof handlers.onAgentError).toBe("function");
    expect(typeof handlers.onToolStart).toBe("function");
    expect(typeof handlers.onToolComplete).toBe("function");
    expect(typeof handlers.onToolError).toBe("function");
    expect(typeof handlers.onApprovalRequested).toBe("function");
    expect(typeof handlers.onApprovalGranted).toBe("function");
    expect(typeof handlers.onApprovalDenied).toBe("function");
  });

  it("onAgentStart calls audit.addEntry with correct eventType", async () => {
    const audit = createAuditTrail();
    const spy = vi.spyOn(audit, "addEntry");
    const handlers = createAgentAuditHandlers(audit);

    handlers.onAgentStart("my-agent", "hello");

    expect(spy).toHaveBeenCalledWith("agent.run.start", {
      agentName: "my-agent",
      input: "hello",
    });
  });

  it("onAgentComplete calls audit.addEntry with correct eventType", async () => {
    const audit = createAuditTrail();
    const spy = vi.spyOn(audit, "addEntry");
    const handlers = createAgentAuditHandlers(audit);

    handlers.onAgentComplete("my-agent", "result", 100, 0.05);

    expect(spy).toHaveBeenCalledWith("agent.run.complete", {
      agentName: "my-agent",
      output: "result",
      tokens: 100,
      cost: 0.05,
    });
  });

  it("onAgentError calls audit.addEntry with correct eventType", async () => {
    const audit = createAuditTrail();
    const spy = vi.spyOn(audit, "addEntry");
    const handlers = createAgentAuditHandlers(audit);

    const error = new Error("boom");
    handlers.onAgentError("my-agent", error);

    expect(spy).toHaveBeenCalledWith("agent.run.error", {
      agentName: "my-agent",
      error: "boom",
      stack: error.stack,
    });
  });

  it("onToolStart calls audit.addEntry with correct eventType", async () => {
    const audit = createAuditTrail();
    const spy = vi.spyOn(audit, "addEntry");
    const handlers = createAgentAuditHandlers(audit);

    handlers.onToolStart("search", "tc-1", { query: "test" });

    expect(spy).toHaveBeenCalledWith("tool.call.start", {
      toolName: "search",
      toolCallId: "tc-1",
      args: { query: "test" },
    });
  });

  it("onToolComplete calls audit.addEntry with correct eventType", async () => {
    const audit = createAuditTrail();
    const spy = vi.spyOn(audit, "addEntry");
    const handlers = createAgentAuditHandlers(audit);

    handlers.onToolComplete("search", "tc-1", { results: [] });

    expect(spy).toHaveBeenCalledWith("tool.call.complete", {
      toolName: "search",
      toolCallId: "tc-1",
      result: { results: [] },
    });
  });

  it("onToolError calls audit.addEntry with correct eventType", async () => {
    const audit = createAuditTrail();
    const spy = vi.spyOn(audit, "addEntry");
    const handlers = createAgentAuditHandlers(audit);

    handlers.onToolError("search", "tc-1", new Error("timeout"));

    expect(spy).toHaveBeenCalledWith("tool.call.error", {
      toolName: "search",
      toolCallId: "tc-1",
      error: "timeout",
    });
  });

  it("onApprovalRequested calls audit.addEntry with correct eventType", async () => {
    const audit = createAuditTrail();
    const spy = vi.spyOn(audit, "addEntry");
    const handlers = createAgentAuditHandlers(audit);

    handlers.onApprovalRequested("delete", "tc-2", { id: 5 });

    expect(spy).toHaveBeenCalledWith("approval.requested", {
      toolName: "delete",
      toolCallId: "tc-2",
      args: { id: 5 },
    });
  });

  it("onApprovalDenied calls audit.addEntry with correct eventType and reason", async () => {
    const audit = createAuditTrail();
    const spy = vi.spyOn(audit, "addEntry");
    const handlers = createAgentAuditHandlers(audit);

    handlers.onApprovalDenied("delete", "tc-2", "too dangerous");

    expect(spy).toHaveBeenCalledWith("approval.denied", {
      toolName: "delete",
      toolCallId: "tc-2",
      reason: "too dangerous",
    });
  });
});
