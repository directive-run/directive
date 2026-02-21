import { describe, it, expect } from "vitest";
import { VALID_EVENT_TYPES } from "../lib/types";
import type { DebugEvent, DebugEventType } from "../lib/types";

// Re-implement the validation functions from use-devtools-connection
// since they are not exported — we test the logic directly

const VALID_SERVER_MESSAGE_TYPES = new Set([
  "welcome",
  "pong",
  "event",
  "event_batch",
  "snapshot",
  "health",
  "breakpoints",
  "scratchpad_state",
  "scratchpad_update",
  "derived_state",
  "derived_update",
  "fork_complete",
  "token_stream",
  "stream_done",
  "error",
]);

function isValidServerMessage(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return typeof obj.type === "string" && VALID_SERVER_MESSAGE_TYPES.has(obj.type);
}

function isValidEvent(value: unknown): value is DebugEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.id === "number" &&
    typeof obj.type === "string" &&
    VALID_EVENT_TYPES.has(obj.type) &&
    typeof obj.timestamp === "number"
  );
}

function validateEvents(arr: unknown[]): DebugEvent[] {
  return arr.filter(isValidEvent);
}

// ============================================================================
// isValidEvent tests
// ============================================================================

describe("isValidEvent", () => {
  it("accepts a valid event", () => {
    const event = { id: 1, type: "agent_start", timestamp: 1000, snapshotId: null };
    expect(isValidEvent(event)).toBe(true);
  });

  it("accepts all known event types", () => {
    for (const type of VALID_EVENT_TYPES) {
      expect(isValidEvent({ id: 1, type, timestamp: 1000, snapshotId: null })).toBe(true);
    }
  });

  it("rejects null", () => {
    expect(isValidEvent(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isValidEvent(undefined)).toBe(false);
  });

  it("rejects primitive values", () => {
    expect(isValidEvent(42)).toBe(false);
    expect(isValidEvent("string")).toBe(false);
    expect(isValidEvent(true)).toBe(false);
  });

  it("rejects empty object", () => {
    expect(isValidEvent({})).toBe(false);
  });

  it("rejects object with missing id", () => {
    expect(isValidEvent({ type: "agent_start", timestamp: 1000 })).toBe(false);
  });

  it("rejects object with missing type", () => {
    expect(isValidEvent({ id: 1, timestamp: 1000 })).toBe(false);
  });

  it("rejects object with missing timestamp", () => {
    expect(isValidEvent({ id: 1, type: "agent_start" })).toBe(false);
  });

  it("rejects object with string id", () => {
    expect(isValidEvent({ id: "1", type: "agent_start", timestamp: 1000 })).toBe(false);
  });

  it("rejects object with numeric type", () => {
    expect(isValidEvent({ id: 1, type: 123, timestamp: 1000 })).toBe(false);
  });

  it("rejects object with string timestamp", () => {
    expect(isValidEvent({ id: 1, type: "agent_start", timestamp: "1000" })).toBe(false);
  });

  it("rejects unknown event types (M3)", () => {
    expect(isValidEvent({ id: 1, type: "unknown_type", timestamp: 1000 })).toBe(false);
    expect(isValidEvent({ id: 1, type: "__proto__", timestamp: 1000 })).toBe(false);
    expect(isValidEvent({ id: 1, type: "constructor", timestamp: 1000 })).toBe(false);
  });

  it("accepts events with extra properties", () => {
    const event = {
      id: 1,
      type: "agent_complete" as DebugEventType,
      timestamp: 1000,
      snapshotId: null,
      agentId: "test-agent",
      durationMs: 500,
      totalTokens: 100,
    };
    expect(isValidEvent(event)).toBe(true);
  });
});

// ============================================================================
// validateEvents tests
// ============================================================================

describe("validateEvents", () => {
  it("returns empty array for empty input", () => {
    expect(validateEvents([])).toEqual([]);
  });

  it("filters out invalid events", () => {
    const input = [
      { id: 1, type: "agent_start", timestamp: 1000, snapshotId: null },
      null,
      { id: "bad", type: "agent_start", timestamp: 1000 },
      { id: 2, type: "agent_complete", timestamp: 2000, snapshotId: null },
    ];
    const result = validateEvents(input);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe(1);
    expect(result[1]!.id).toBe(2);
  });

  it("returns all events when all are valid", () => {
    const input = [
      { id: 1, type: "agent_start", timestamp: 1000, snapshotId: null },
      { id: 2, type: "agent_complete", timestamp: 2000, snapshotId: null },
    ];
    expect(validateEvents(input)).toHaveLength(2);
  });

  it("returns empty array when none are valid", () => {
    const input = [null, undefined, 42, "string", { bad: true }];
    expect(validateEvents(input)).toHaveLength(0);
  });
});

// ============================================================================
// isValidServerMessage tests (M2)
// ============================================================================

describe("isValidServerMessage", () => {
  it("accepts all known server message types", () => {
    for (const type of VALID_SERVER_MESSAGE_TYPES) {
      expect(isValidServerMessage({ type })).toBe(true);
    }
  });

  it("rejects unknown message types", () => {
    expect(isValidServerMessage({ type: "unknown" })).toBe(false);
    expect(isValidServerMessage({ type: "hack" })).toBe(false);
  });

  it("rejects null/undefined", () => {
    expect(isValidServerMessage(null)).toBe(false);
    expect(isValidServerMessage(undefined)).toBe(false);
  });

  it("rejects objects without type", () => {
    expect(isValidServerMessage({})).toBe(false);
    expect(isValidServerMessage({ data: "test" })).toBe(false);
  });

  it("rejects objects with non-string type", () => {
    expect(isValidServerMessage({ type: 123 })).toBe(false);
    expect(isValidServerMessage({ type: null })).toBe(false);
  });

  it("rejects prototype pollution attempts", () => {
    expect(isValidServerMessage({ type: "__proto__" })).toBe(false);
    expect(isValidServerMessage({ type: "constructor" })).toBe(false);
  });
});

// ============================================================================
// VALID_EVENT_TYPES set consistency
// ============================================================================

describe("VALID_EVENT_TYPES", () => {
  it("contains all 26 expected event types", () => {
    expect(VALID_EVENT_TYPES.size).toBe(26);
  });

  it("matches the DebugEventType union", () => {
    // These are the event types from the union type
    const expectedTypes: DebugEventType[] = [
      "agent_start", "agent_complete", "agent_error", "agent_retry",
      "guardrail_check", "constraint_evaluate",
      "resolver_start", "resolver_complete", "resolver_error",
      "approval_request", "approval_response",
      "handoff_start", "handoff_complete",
      "pattern_start", "pattern_complete",
      "dag_node_update",
      "breakpoint_hit", "breakpoint_resumed",
      "derivation_update", "scratchpad_update",
      "reflection_iteration",
      "race_start", "race_winner", "race_cancelled",
      "reroute", "debate_round",
    ];

    for (const type of expectedTypes) {
      expect(VALID_EVENT_TYPES.has(type)).toBe(true);
    }
  });
});
