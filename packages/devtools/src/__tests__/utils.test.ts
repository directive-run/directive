import { describe, expect, it } from "vitest";
import {
  EVENT_COLORS,
  getEventCategory,
  DAG_NODE_COLORS,
  CIRCUIT_STATE_COLORS,
} from "../lib/colors";
import { formatTimestamp, formatDuration } from "../lib/time-format";
import type { DebugEventType } from "../lib/types";

// ============================================================================
// getEventCategory
// ============================================================================

describe("getEventCategory", () => {
  it('returns "Agent" for agent_start', () => {
    expect(getEventCategory("agent_start")).toBe("Agent");
  });

  it('returns "Agent" for agent_complete', () => {
    expect(getEventCategory("agent_complete")).toBe("Agent");
  });

  it('returns "Agent" for agent_error', () => {
    expect(getEventCategory("agent_error")).toBe("Agent");
  });

  it('returns "Agent" for agent_retry', () => {
    expect(getEventCategory("agent_retry")).toBe("Agent");
  });

  it('returns "Agent" for reroute (special case — not prefixed with "agent_")', () => {
    expect(getEventCategory("reroute")).toBe("Agent");
  });

  it('returns "Engine" for guardrail_check', () => {
    expect(getEventCategory("guardrail_check")).toBe("Engine");
  });

  it('returns "Engine" for constraint_evaluate', () => {
    expect(getEventCategory("constraint_evaluate")).toBe("Engine");
  });

  it('returns "Engine" for resolver_start', () => {
    expect(getEventCategory("resolver_start")).toBe("Engine");
  });

  it('returns "Control" for approval_request', () => {
    expect(getEventCategory("approval_request")).toBe("Control");
  });

  it('returns "Control" for breakpoint_hit', () => {
    expect(getEventCategory("breakpoint_hit")).toBe("Control");
  });

  it('returns "Orchestration" for handoff_start', () => {
    expect(getEventCategory("handoff_start")).toBe("Orchestration");
  });

  it('returns "Orchestration" for pattern_start', () => {
    expect(getEventCategory("pattern_start")).toBe("Orchestration");
  });

  it('returns "Orchestration" for dag_node_update', () => {
    expect(getEventCategory("dag_node_update")).toBe("Orchestration");
  });

  it('returns "Orchestration" for race_start', () => {
    expect(getEventCategory("race_start")).toBe("Orchestration");
  });

  it('returns "State" for derivation_update', () => {
    expect(getEventCategory("derivation_update")).toBe("State");
  });

  it('returns "State" for scratchpad_update', () => {
    expect(getEventCategory("scratchpad_update")).toBe("State");
  });

  it('returns "State" for reflection_iteration', () => {
    expect(getEventCategory("reflection_iteration")).toBe("State");
  });

  it('returns "State" for debate_round', () => {
    expect(getEventCategory("debate_round")).toBe("State");
  });
});

// ============================================================================
// EVENT_COLORS
// ============================================================================

describe("EVENT_COLORS", () => {
  const allEventTypes: DebugEventType[] = [
    "agent_start",
    "agent_complete",
    "agent_error",
    "agent_retry",
    "guardrail_check",
    "constraint_evaluate",
    "resolver_start",
    "resolver_complete",
    "resolver_error",
    "approval_request",
    "approval_response",
    "handoff_start",
    "handoff_complete",
    "pattern_start",
    "pattern_complete",
    "dag_node_update",
    "breakpoint_hit",
    "breakpoint_resumed",
    "derivation_update",
    "scratchpad_update",
    "reflection_iteration",
    "race_start",
    "race_winner",
    "race_cancelled",
    "reroute",
    "debate_round",
  ];

  it("has an entry for every DebugEventType", () => {
    for (const type of allEventTypes) {
      expect(EVENT_COLORS).toHaveProperty(type);
    }
  });

  it("all values are valid hex color strings", () => {
    const hexPattern = /^#[0-9a-fA-F]{6}$/;
    for (const [key, value] of Object.entries(EVENT_COLORS)) {
      expect(value, `EVENT_COLORS["${key}"]`).toMatch(hexPattern);
    }
  });

  it("has no undefined values", () => {
    for (const [key, value] of Object.entries(EVENT_COLORS)) {
      expect(value, `EVENT_COLORS["${key}"]`).toBeDefined();
    }
  });
});

// ============================================================================
// DAG_NODE_COLORS
// ============================================================================

describe("DAG_NODE_COLORS", () => {
  it("has all 6 statuses", () => {
    const expected = ["pending", "ready", "running", "completed", "error", "skipped"];
    expect(Object.keys(DAG_NODE_COLORS).sort()).toEqual(expected.sort());
  });

  it("all values are hex color strings", () => {
    const hexPattern = /^#[0-9a-fA-F]{6}$/;
    for (const [key, value] of Object.entries(DAG_NODE_COLORS)) {
      expect(value, `DAG_NODE_COLORS["${key}"]`).toMatch(hexPattern);
    }
  });
});

// ============================================================================
// CIRCUIT_STATE_COLORS
// ============================================================================

describe("CIRCUIT_STATE_COLORS", () => {
  it("has all 3 states", () => {
    const expected = ["CLOSED", "HALF_OPEN", "OPEN"];
    expect(Object.keys(CIRCUIT_STATE_COLORS).sort()).toEqual(expected.sort());
  });

  it("each state has bg, text, and label properties", () => {
    for (const [key, value] of Object.entries(CIRCUIT_STATE_COLORS)) {
      expect(value, `CIRCUIT_STATE_COLORS["${key}"]`).toHaveProperty("bg");
      expect(value, `CIRCUIT_STATE_COLORS["${key}"]`).toHaveProperty("text");
      expect(value, `CIRCUIT_STATE_COLORS["${key}"]`).toHaveProperty("label");
      expect(typeof value.bg).toBe("string");
      expect(typeof value.text).toBe("string");
      expect(typeof value.label).toBe("string");
    }
  });
});

// ============================================================================
// formatTimestamp
// ============================================================================

describe("formatTimestamp", () => {
  it('"ms" format returns "Xms"', () => {
    expect(formatTimestamp(1234, "ms")).toBe("1234ms");
  });

  it('"elapsed" format returns "+X.XXs" relative to base', () => {
    expect(formatTimestamp(5500, "elapsed", 3000)).toBe("+2.50s");
  });

  it('"elapsed" with no base uses 0', () => {
    expect(formatTimestamp(2500, "elapsed")).toBe("+2.50s");
  });

  it('"ms" format rounds to nearest integer', () => {
    expect(formatTimestamp(1234.7, "ms")).toBe("1235ms");
  });

  it('"clock" format returns a string from toLocaleTimeString', () => {
    const result = formatTimestamp(1609459200000, "clock");
    // Output is locale- and runtime-dependent; just verify it's a non-empty string
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// formatDuration
// ============================================================================

describe("formatDuration", () => {
  it('ms < 1000 returns "Xms"', () => {
    expect(formatDuration(500)).toBe("500ms");
  });

  it('1000 <= ms < 60000 returns "X.XXs"', () => {
    expect(formatDuration(2500)).toBe("2.50s");
  });

  it('ms >= 60000 returns "Xm X.Xs"', () => {
    expect(formatDuration(90500)).toBe("1m 30.5s");
  });

  it('exact boundary: 1000 returns "1.00s"', () => {
    expect(formatDuration(1000)).toBe("1.00s");
  });

  it('exact boundary: 60000 returns "1m 0.0s"', () => {
    expect(formatDuration(60000)).toBe("1m 0.0s");
  });
});
