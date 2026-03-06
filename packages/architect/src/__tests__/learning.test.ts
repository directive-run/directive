/**
 * Tests for the learning / feedback store.
 */

import { describe, it, expect } from "vitest";
import {
  createFeedbackStore,
  type FeedbackEntry,
  type FeedbackStore,
} from "../learning.js";

// ============================================================================
// Unit tests — FeedbackStore
// ============================================================================

describe("createFeedbackStore", () => {
  function makeEntry(
    overrides?: Partial<Omit<FeedbackEntry, "timestamp">>,
  ): Omit<FeedbackEntry, "timestamp"> {
    return {
      actionId: "a-1",
      tool: "add_constraint",
      toolArguments: { id: "test" },
      approved: true,
      risk: "low",
      ...overrides,
    };
  }

  it("records and retrieves entries (newest first)", () => {
    const store = createFeedbackStore();
    store.record(makeEntry({ actionId: "a-1" }));
    store.record(makeEntry({ actionId: "a-2" }));

    const entries = store.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].actionId).toBe("a-2");
    expect(entries[1].actionId).toBe("a-1");
  });

  it("adds timestamp automatically", () => {
    const store = createFeedbackStore();
    const before = Date.now();
    store.record(makeEntry());
    const after = Date.now();

    const [entry] = store.getEntries();
    expect(entry.timestamp).toBeGreaterThanOrEqual(before);
    expect(entry.timestamp).toBeLessThanOrEqual(after);
  });

  it("respects maxEntries via ring buffer eviction", () => {
    const store = createFeedbackStore({ maxEntries: 3 });
    for (let i = 0; i < 5; i++) {
      store.record(makeEntry({ actionId: `a-${i}` }));
    }

    const entries = store.getEntries();
    expect(entries).toHaveLength(3);
    // Oldest two evicted (a-0, a-1)
    expect(entries.map((e) => e.actionId)).toEqual(["a-4", "a-3", "a-2"]);
  });

  it("updateHealthDelta sets delta on matching entry", () => {
    const store = createFeedbackStore();
    store.record(makeEntry({ actionId: "a-1" }));
    store.record(makeEntry({ actionId: "a-2" }));

    store.updateHealthDelta("a-1", 15);

    const entries = store.getEntries();
    const a1 = entries.find((e) => e.actionId === "a-1");
    expect(a1?.healthDelta).toBe(15);

    // a-2 unaffected
    const a2 = entries.find((e) => e.actionId === "a-2");
    expect(a2?.healthDelta).toBeUndefined();
  });

  it("updateHealthDelta is no-op for unknown actionId", () => {
    const store = createFeedbackStore();
    store.record(makeEntry({ actionId: "a-1" }));

    // Should not throw
    store.updateHealthDelta("unknown", 10);

    const [entry] = store.getEntries();
    expect(entry.healthDelta).toBeUndefined();
  });

  // ---------- getPatterns ----------

  it("getPatterns aggregates by tool", () => {
    const store = createFeedbackStore();
    store.record(makeEntry({ tool: "add_constraint", approved: true }));
    store.record(makeEntry({ tool: "add_constraint", approved: true }));
    store.record(makeEntry({ tool: "add_constraint", approved: false, reason: "too aggressive" }));
    store.record(makeEntry({ tool: "set_fact", approved: true }));

    const patterns = store.getPatterns();
    expect(patterns).toHaveLength(2);

    const constraintPattern = patterns.find((p) => p.tool === "add_constraint");
    expect(constraintPattern).toBeDefined();
    expect(constraintPattern!.totalCount).toBe(3);
    expect(constraintPattern!.approvedCount).toBe(2);
    expect(constraintPattern!.rejectedCount).toBe(1);
    expect(constraintPattern!.approvalRate).toBeCloseTo(0.67, 1);
    expect(constraintPattern!.commonReasons).toEqual(["too aggressive"]);

    const factPattern = patterns.find((p) => p.tool === "set_fact");
    expect(factPattern!.approvalRate).toBe(1);
  });

  it("getPatterns sorts by total count descending", () => {
    const store = createFeedbackStore();
    store.record(makeEntry({ tool: "set_fact" }));
    store.record(makeEntry({ tool: "add_constraint" }));
    store.record(makeEntry({ tool: "add_constraint" }));
    store.record(makeEntry({ tool: "add_constraint" }));

    const patterns = store.getPatterns();
    expect(patterns[0].tool).toBe("add_constraint");
    expect(patterns[1].tool).toBe("set_fact");
  });

  it("getPatterns limits common reasons to 5", () => {
    const store = createFeedbackStore();
    for (let i = 0; i < 8; i++) {
      store.record(
        makeEntry({ tool: "add_constraint", approved: false, reason: `reason-${i}` }),
      );
    }

    const [pattern] = store.getPatterns();
    expect(pattern.commonReasons).toHaveLength(5);
  });

  // ---------- formatForPrompt ----------

  it("formatForPrompt returns empty string when no entries", () => {
    const store = createFeedbackStore();
    expect(store.formatForPrompt()).toBe("");
  });

  it("formatForPrompt includes header and tool summary", () => {
    const store = createFeedbackStore();
    store.record(makeEntry({ tool: "add_constraint", approved: true }));
    store.record(makeEntry({ tool: "add_constraint", approved: false, reason: "too risky" }));

    const prompt = store.formatForPrompt();
    expect(prompt).toContain("### Human Feedback");
    expect(prompt).toContain("add_constraint: 1/2 approved (50%)");
    expect(prompt).toContain("Common rejections: too risky");
  });

  it("formatForPrompt includes recent decisions", () => {
    const store = createFeedbackStore();
    store.record(makeEntry({ tool: "add_constraint", approved: true }));
    store.record(makeEntry({ tool: "set_fact", approved: false, reason: "not needed" }));

    const prompt = store.formatForPrompt();
    expect(prompt).toContain("Recent decisions:");
    expect(prompt).toContain("set_fact: rejected (not needed)");
    expect(prompt).toContain("add_constraint: approved");
  });

  it("formatForPrompt respects maxDisplay limit", () => {
    const store = createFeedbackStore();
    for (let i = 0; i < 20; i++) {
      store.record(makeEntry({ actionId: `a-${i}` }));
    }

    const prompt = store.formatForPrompt(5);
    const recentLines = prompt
      .split("\n")
      .filter((l) => l.startsWith("- add_constraint:"));
    // Tool summary has 1 line, recent decisions has 5
    expect(recentLines.length).toBeLessThanOrEqual(6);
  });

  // ---------- destroy ----------

  it("destroy clears all entries", () => {
    const store = createFeedbackStore();
    store.record(makeEntry());
    store.record(makeEntry());

    store.destroy();

    expect(store.getEntries()).toHaveLength(0);
    expect(store.getPatterns()).toHaveLength(0);
    expect(store.formatForPrompt()).toBe("");
  });

  // ---------- default maxEntries ----------

  it("uses default maxEntries of 500", () => {
    const store = createFeedbackStore();
    // Record more than 500
    for (let i = 0; i < 510; i++) {
      store.record(makeEntry({ actionId: `a-${i}` }));
    }

    expect(store.getEntries()).toHaveLength(500);
  });
});
