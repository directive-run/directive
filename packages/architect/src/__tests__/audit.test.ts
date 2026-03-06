import { describe, it, expect } from "vitest";
import { createAuditLog } from "../audit.js";
import type { ActionReasoning } from "../types.js";

const mockReasoning: ActionReasoning = {
  trigger: "demand",
  observation: "Test observation",
  justification: "Test justification",
  expectedOutcome: "Test outcome",
  raw: "raw text",
};

describe("audit log", () => {
  it("appends entries with sequential IDs", () => {
    const log = createAuditLog();

    const entry1 = log.append({
      trigger: "demand",
      tool: "observe_system",
      arguments: {},
      reasoning: mockReasoning,
      approvalRequired: false,
      approved: true,
      applied: true,
    });

    const entry2 = log.append({
      trigger: "error",
      tool: "create_constraint",
      arguments: { id: "test" },
      reasoning: mockReasoning,
      definitionType: "constraint",
      definitionId: "test",
      approvalRequired: true,
      approved: true,
      applied: true,
    });

    expect(entry1.id).toBeTruthy();
    expect(entry2.id).toBeTruthy();
    expect(entry1.id).not.toBe(entry2.id);
    expect(log.size()).toBe(2);
  });

  it("creates hash chain", () => {
    const log = createAuditLog();

    const entry1 = log.append({
      trigger: "demand",
      tool: "observe_system",
      arguments: {},
      reasoning: mockReasoning,
      approvalRequired: false,
      approved: true,
      applied: true,
    });

    const entry2 = log.append({
      trigger: "demand",
      tool: "read_facts",
      arguments: {},
      reasoning: mockReasoning,
      approvalRequired: false,
      approved: true,
      applied: true,
    });

    expect(entry1.prevHash).toBeNull();
    expect(entry2.prevHash).toBe(entry1.hash);
    expect(entry1.hash).toBeTruthy();
    expect(entry2.hash).toBeTruthy();
  });

  it("verifies chain integrity", () => {
    const log = createAuditLog();

    log.append({
      trigger: "demand",
      tool: "a",
      arguments: {},
      reasoning: mockReasoning,
      approvalRequired: false,
      approved: true,
      applied: true,
    });

    log.append({
      trigger: "demand",
      tool: "b",
      arguments: {},
      reasoning: mockReasoning,
      approvalRequired: false,
      approved: true,
      applied: true,
    });

    log.append({
      trigger: "demand",
      tool: "c",
      arguments: {},
      reasoning: mockReasoning,
      approvalRequired: false,
      approved: true,
      applied: true,
    });

    expect(log.verifyChain()).toBe(true);
  });

  it("freezes entries (immutable)", () => {
    const log = createAuditLog();

    const entry = log.append({
      trigger: "demand",
      tool: "test",
      arguments: {},
      reasoning: mockReasoning,
      approvalRequired: false,
      approved: true,
      applied: true,
    });

    expect(() => {
      (entry as { applied: boolean }).applied = false;
    }).toThrow();
  });

  it("evicts oldest entries when maxEntries reached", () => {
    const log = createAuditLog({ maxEntries: 3 });

    log.append({ trigger: "demand", tool: "a", arguments: {}, reasoning: mockReasoning, approvalRequired: false, approved: true, applied: true });
    log.append({ trigger: "demand", tool: "b", arguments: {}, reasoning: mockReasoning, approvalRequired: false, approved: true, applied: true });
    log.append({ trigger: "demand", tool: "c", arguments: {}, reasoning: mockReasoning, approvalRequired: false, approved: true, applied: true });
    log.append({ trigger: "demand", tool: "d", arguments: {}, reasoning: mockReasoning, approvalRequired: false, approved: true, applied: true });

    expect(log.size()).toBe(3);

    const all = log.getAll();

    expect(all[0]!.tool).toBe("b"); // "a" was evicted
    expect(all[2]!.tool).toBe("d");
  });

  it("marks entries as rolled back", () => {
    const log = createAuditLog();

    const entry = log.append({
      trigger: "demand",
      tool: "create_constraint",
      arguments: { id: "test" },
      reasoning: mockReasoning,
      definitionType: "constraint",
      definitionId: "test",
      approvalRequired: false,
      approved: true,
      applied: true,
    });

    expect(entry.rolledBack).toBe(false);

    const success = log.markRolledBack(entry.id);

    expect(success).toBe(true);

    const all = log.getAll();

    // Item 4: original entry is NOT mutated (append-only)
    const original = all.find((e) => e.id === entry.id);
    expect(original!.rolledBack).toBe(false); // unchanged

    // Rollback status queried via rollbackOf entries
    expect(log.isRolledBack(entry.id)).toBe(true);

    // Should also append a rollback entry referencing original
    const rollbackEntry = all.find((e) => e.rollbackOf === entry.id);

    expect(rollbackEntry).toBeDefined();
    expect(rollbackEntry!.tool).toBe("rollback");
  });

  it("returns false when marking non-existent entry", () => {
    const log = createAuditLog();
    const success = log.markRolledBack("non-existent");

    expect(success).toBe(false);
  });

  describe("query", () => {
    it("returns all entries when no filter", () => {
      const log = createAuditLog();

      log.append({ trigger: "demand", tool: "a", arguments: {}, reasoning: mockReasoning, approvalRequired: false, approved: true, applied: true });
      log.append({ trigger: "error", tool: "b", arguments: {}, reasoning: mockReasoning, approvalRequired: false, approved: true, applied: true });

      expect(log.query()).toHaveLength(2);
    });

    it("filters by trigger", () => {
      const log = createAuditLog();

      log.append({ trigger: "demand", tool: "a", arguments: {}, reasoning: mockReasoning, approvalRequired: false, approved: true, applied: true });
      log.append({ trigger: "error", tool: "b", arguments: {}, reasoning: mockReasoning, approvalRequired: false, approved: true, applied: true });
      log.append({ trigger: "demand", tool: "c", arguments: {}, reasoning: mockReasoning, approvalRequired: false, approved: true, applied: true });

      const result = log.query({ trigger: "demand" });

      expect(result).toHaveLength(2);
    });

    it("filters by definitionType", () => {
      const log = createAuditLog();

      log.append({ trigger: "demand", tool: "a", arguments: {}, reasoning: mockReasoning, definitionType: "constraint", approvalRequired: false, approved: true, applied: true });
      log.append({ trigger: "demand", tool: "b", arguments: {}, reasoning: mockReasoning, definitionType: "resolver", approvalRequired: false, approved: true, applied: true });

      const result = log.query({ definitionType: "constraint" });

      expect(result).toHaveLength(1);
      expect(result[0]!.definitionType).toBe("constraint");
    });

    it("filters by applied status", () => {
      const log = createAuditLog();

      log.append({ trigger: "demand", tool: "a", arguments: {}, reasoning: mockReasoning, approvalRequired: false, approved: true, applied: true });
      log.append({ trigger: "demand", tool: "b", arguments: {}, reasoning: mockReasoning, approvalRequired: false, approved: false, applied: false });

      const result = log.query({ applied: true });

      expect(result).toHaveLength(1);
    });

    it("limits results", () => {
      const log = createAuditLog();

      for (let i = 0; i < 10; i++) {
        log.append({ trigger: "demand", tool: `t${i}`, arguments: {}, reasoning: mockReasoning, approvalRequired: false, approved: true, applied: true });
      }

      const result = log.query({ limit: 3 });

      expect(result).toHaveLength(3);
    });
  });

  // ===========================================================================
  // M3: Genesis hash after eviction
  // ===========================================================================

  describe("genesis hash", () => {
    it("M3: verifyChain succeeds after ring buffer eviction", () => {
      const log = createAuditLog({ maxEntries: 3 });

      // Fill to capacity
      for (let i = 0; i < 5; i++) {
        log.append({ trigger: "demand", tool: `t${i}`, arguments: {}, reasoning: mockReasoning, approvalRequired: false, approved: true, applied: true });
      }

      // Only 3 entries should remain after eviction
      expect(log.size()).toBe(3);

      // Chain should still be valid because genesisHash tracks the evicted entry
      expect(log.verifyChain()).toBe(true);
    });
  });

  // ===========================================================================
  // M9: importLog validation
  // ===========================================================================

  describe("importLog validation", () => {
    it("M9: rejects entries missing required fields", () => {
      const log = createAuditLog();

      const invalidJson = JSON.stringify({
        version: 1,
        entries: [
          { id: "a1" },
          { id: "a2", timestamp: 123 },
        ],
      });

      expect(log.importLog(invalidJson)).toBe(false);
    });

    it("M9: accepts entries with all required fields", () => {
      const log = createAuditLog();

      const validJson = JSON.stringify({
        version: 1,
        entries: [
          {
            id: "audit-1-1000",
            timestamp: 1000,
            trigger: "demand",
            tool: "observe_system",
            arguments: {},
            reasoning: mockReasoning,
            approvalRequired: false,
            approved: true,
            applied: true,
            hash: "abc12345",
            prevHash: null,
          },
        ],
      });

      expect(log.importLog(validJson)).toBe(true);
      expect(log.size()).toBe(1);
    });
  });
});
