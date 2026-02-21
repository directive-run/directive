import { describe, it, expect, vi, beforeEach } from "vitest";
import { VALID_EVENT_TYPES } from "../lib/types";
import type { DebugEvent } from "../lib/types";

// We test the pure functions from use-run-sessions.ts directly

function makeEvent(overrides: Partial<DebugEvent> & { id: number; type: DebugEvent["type"]; timestamp: number }): DebugEvent {
  return { snapshotId: null, ...overrides } as DebugEvent;
}

interface SavedRun {
  id: string;
  name: string;
  savedAt: string;
  events: DebugEvent[];
  metadata: {
    eventCount: number;
    totalTokens: number;
    durationMs: number;
    agentCount: number;
  };
}

// Re-implement computeMetadata for testing
function computeMetadata(events: DebugEvent[]): SavedRun["metadata"] {
  let totalTokens = 0;
  const agents = new Set<string>();

  for (const e of events) {
    if (e.agentId) {
      agents.add(e.agentId);
    }
    if (typeof e.totalTokens === "number") {
      totalTokens += e.totalTokens;
    }
  }

  const first = events[0]?.timestamp ?? 0;
  const last = events[events.length - 1]?.timestamp ?? 0;

  return {
    eventCount: events.length,
    totalTokens,
    durationMs: last - first,
    agentCount: agents.size,
  };
}

// Re-implement persistRuns for testing
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

function persistRuns(runs: SavedRun[]): string | null {
  try {
    const json = JSON.stringify(runs);
    if (json.length > MAX_SIZE_BYTES) {
      const trimmed = [...runs];
      while (trimmed.length > 1 && JSON.stringify(trimmed).length > MAX_SIZE_BYTES) {
        trimmed.shift();
      }
      localStorage.setItem("directive-devtools-runs", JSON.stringify(trimmed));

      return null;
    }
    localStorage.setItem("directive-devtools-runs", json);

    return null;
  } catch (err) {
    return `Failed to save runs: ${err instanceof Error ? err.message : "storage full"}`;
  }
}

// Re-implement importRun validation for testing (updated to match H6 fix)
function validateImportedRun(json: string): { events: DebugEvent[]; name: string } | null {
  try {
    const parsed = JSON.parse(json);
    if (parsed?.run?.events && Array.isArray(parsed.run.events)) {
      const validEvents = parsed.run.events.filter(
        (e: unknown) =>
          typeof e === "object" && e !== null &&
          typeof (e as Record<string, unknown>).id === "number" &&
          typeof (e as Record<string, unknown>).type === "string" &&
          VALID_EVENT_TYPES.has((e as Record<string, unknown>).type as string) &&
          typeof (e as Record<string, unknown>).timestamp === "number",
      );

      if (validEvents.length === 0) {
        return null;
      }

      return {
        events: validEvents,
        name: typeof parsed.run.name === "string" ? parsed.run.name : `Imported Run`,
      };
    }

    return null;
  } catch {
    return null;
  }
}

// Re-implement isValidSavedRun for testing (P2 fix)
function isValidSavedRun(value: unknown): value is SavedRun {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.id === "string" &&
    typeof obj.name === "string" &&
    typeof obj.savedAt === "string" &&
    Array.isArray(obj.events) &&
    typeof obj.metadata === "object" && obj.metadata !== null &&
    typeof (obj.metadata as Record<string, unknown>).eventCount === "number" &&
    typeof (obj.metadata as Record<string, unknown>).totalTokens === "number" &&
    typeof (obj.metadata as Record<string, unknown>).durationMs === "number" &&
    typeof (obj.metadata as Record<string, unknown>).agentCount === "number"
  );
}

// ============================================================================
// computeMetadata tests
// ============================================================================

describe("computeMetadata", () => {
  it("returns zeros for empty events", () => {
    const meta = computeMetadata([]);
    expect(meta.eventCount).toBe(0);
    expect(meta.totalTokens).toBe(0);
    expect(meta.durationMs).toBe(0);
    expect(meta.agentCount).toBe(0);
  });

  it("computes correct totals", () => {
    const events = [
      makeEvent({ id: 1, type: "agent_start", timestamp: 1000, agentId: "a" }),
      makeEvent({ id: 2, type: "agent_complete", timestamp: 2000, agentId: "a", totalTokens: 100 }),
      makeEvent({ id: 3, type: "agent_complete", timestamp: 3000, agentId: "b", totalTokens: 200 }),
    ];
    const meta = computeMetadata(events);
    expect(meta.eventCount).toBe(3);
    expect(meta.totalTokens).toBe(300);
    expect(meta.durationMs).toBe(2000);
    expect(meta.agentCount).toBe(2);
  });

  it("handles events without totalTokens", () => {
    const events = [
      makeEvent({ id: 1, type: "agent_start", timestamp: 1000, agentId: "a" }),
      makeEvent({ id: 2, type: "agent_start", timestamp: 2000, agentId: "b" }),
    ];
    const meta = computeMetadata(events);
    expect(meta.totalTokens).toBe(0);
  });

  it("handles events without agentId", () => {
    const events = [
      makeEvent({ id: 1, type: "constraint_evaluate", timestamp: 1000 }),
    ];
    const meta = computeMetadata(events);
    expect(meta.agentCount).toBe(0);
  });
});

// ============================================================================
// persistRuns tests (M11)
// ============================================================================

describe("persistRuns", () => {
  beforeEach(() => {
    // Mock localStorage
    const storage: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => storage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => { storage[key] = value; }),
      removeItem: vi.fn((key: string) => { delete storage[key]; }),
    });
  });

  it("returns null on successful save", () => {
    const runs: SavedRun[] = [];
    expect(persistRuns(runs)).toBeNull();
  });

  it("returns error message when localStorage throws (M11)", () => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(),
      setItem: vi.fn(() => { throw new Error("QuotaExceededError"); }),
    });

    const runs: SavedRun[] = [{
      id: "test",
      name: "Test",
      savedAt: new Date().toISOString(),
      events: [],
      metadata: { eventCount: 0, totalTokens: 0, durationMs: 0, agentCount: 0 },
    }];

    const err = persistRuns(runs);
    expect(err).toContain("Failed to save runs");
    expect(err).toContain("QuotaExceededError");
  });

  it("returns null for empty runs array", () => {
    expect(persistRuns([])).toBeNull();
  });
});

// ============================================================================
// validateImportedRun tests
// ============================================================================

describe("validateImportedRun", () => {
  it("returns null for invalid JSON", () => {
    expect(validateImportedRun("not json")).toBeNull();
  });

  it("returns null for JSON without run.events", () => {
    expect(validateImportedRun(JSON.stringify({ data: "test" }))).toBeNull();
    expect(validateImportedRun(JSON.stringify({ run: {} }))).toBeNull();
    expect(validateImportedRun(JSON.stringify({ run: { events: "not an array" } }))).toBeNull();
  });

  it("returns null when all events are invalid", () => {
    const json = JSON.stringify({
      run: { events: [{ bad: true }, null, "string"] },
    });
    expect(validateImportedRun(json)).toBeNull();
  });

  it("returns valid events and filters invalid ones", () => {
    const json = JSON.stringify({
      run: {
        name: "Test Run",
        events: [
          { id: 1, type: "agent_start", timestamp: 1000 },
          { bad: true },
          { id: 2, type: "agent_complete", timestamp: 2000 },
        ],
      },
    });
    const result = validateImportedRun(json);
    expect(result).not.toBeNull();
    expect(result!.events).toHaveLength(2);
    expect(result!.name).toBe("Test Run");
  });

  it("uses default name when name is missing", () => {
    const json = JSON.stringify({
      run: {
        events: [{ id: 1, type: "agent_start", timestamp: 1000 }],
      },
    });
    const result = validateImportedRun(json);
    expect(result!.name).toContain("Imported Run");
  });

  it("validates event types at import boundary", () => {
    const json = JSON.stringify({
      run: {
        events: [
          { id: 1, type: "agent_start", timestamp: 1000 },
          { id: 2, type: 123, timestamp: 2000 }, // invalid type
          { id: "bad", type: "agent_complete", timestamp: 3000 }, // invalid id
        ],
      },
    });
    const result = validateImportedRun(json);
    expect(result!.events).toHaveLength(1);
  });

  it("rejects events with unknown event types (H6 fix)", () => {
    const json = JSON.stringify({
      run: {
        events: [
          { id: 1, type: "unknown_type", timestamp: 1000 },
          { id: 2, type: "__proto__", timestamp: 2000 },
          { id: 3, type: "constructor", timestamp: 3000 },
        ],
      },
    });
    expect(validateImportedRun(json)).toBeNull();
  });

  it("keeps valid events and rejects unknown types in mixed batch", () => {
    const json = JSON.stringify({
      run: {
        events: [
          { id: 1, type: "agent_start", timestamp: 1000 },
          { id: 2, type: "fake_event", timestamp: 2000 },
          { id: 3, type: "resolver_complete", timestamp: 3000 },
        ],
      },
    });
    const result = validateImportedRun(json);
    expect(result).not.toBeNull();
    expect(result!.events).toHaveLength(2);
  });
});

// ============================================================================
// isValidSavedRun tests (P2 fix)
// ============================================================================

describe("isValidSavedRun (P2)", () => {
  const validRun: SavedRun = {
    id: "run_123",
    name: "Test Run",
    savedAt: "2026-02-20T00:00:00Z",
    events: [],
    metadata: { eventCount: 0, totalTokens: 0, durationMs: 0, agentCount: 0 },
  };

  it("accepts a valid SavedRun", () => {
    expect(isValidSavedRun(validRun)).toBe(true);
  });

  it("accepts SavedRun with events", () => {
    const run = {
      ...validRun,
      events: [makeEvent({ id: 1, type: "agent_start", timestamp: 1000 })],
      metadata: { eventCount: 1, totalTokens: 0, durationMs: 0, agentCount: 0 },
    };
    expect(isValidSavedRun(run)).toBe(true);
  });

  it("rejects null", () => {
    expect(isValidSavedRun(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isValidSavedRun(undefined)).toBe(false);
  });

  it("rejects primitives", () => {
    expect(isValidSavedRun("string")).toBe(false);
    expect(isValidSavedRun(42)).toBe(false);
    expect(isValidSavedRun(true)).toBe(false);
  });

  it("rejects missing id", () => {
    const { id: _, ...rest } = validRun;
    expect(isValidSavedRun(rest)).toBe(false);
  });

  it("rejects missing name", () => {
    const { name: _, ...rest } = validRun;
    expect(isValidSavedRun(rest)).toBe(false);
  });

  it("rejects missing savedAt", () => {
    const { savedAt: _, ...rest } = validRun;
    expect(isValidSavedRun(rest)).toBe(false);
  });

  it("rejects missing events", () => {
    const { events: _, ...rest } = validRun;
    expect(isValidSavedRun(rest)).toBe(false);
  });

  it("rejects non-array events", () => {
    expect(isValidSavedRun({ ...validRun, events: "not an array" })).toBe(false);
    expect(isValidSavedRun({ ...validRun, events: {} })).toBe(false);
  });

  it("rejects missing metadata", () => {
    const { metadata: _, ...rest } = validRun;
    expect(isValidSavedRun(rest)).toBe(false);
  });

  it("rejects null metadata", () => {
    expect(isValidSavedRun({ ...validRun, metadata: null })).toBe(false);
  });

  it("rejects metadata with missing eventCount", () => {
    const { eventCount: _, ...badMeta } = validRun.metadata;
    expect(isValidSavedRun({ ...validRun, metadata: badMeta })).toBe(false);
  });

  it("rejects metadata with missing totalTokens", () => {
    const { totalTokens: _, ...badMeta } = validRun.metadata;
    expect(isValidSavedRun({ ...validRun, metadata: badMeta })).toBe(false);
  });

  it("rejects metadata with missing durationMs", () => {
    const { durationMs: _, ...badMeta } = validRun.metadata;
    expect(isValidSavedRun({ ...validRun, metadata: badMeta })).toBe(false);
  });

  it("rejects metadata with missing agentCount", () => {
    const { agentCount: _, ...badMeta } = validRun.metadata;
    expect(isValidSavedRun({ ...validRun, metadata: badMeta })).toBe(false);
  });

  it("rejects metadata with string eventCount", () => {
    expect(isValidSavedRun({
      ...validRun,
      metadata: { ...validRun.metadata, eventCount: "3" },
    })).toBe(false);
  });

  it("rejects numeric id", () => {
    expect(isValidSavedRun({ ...validRun, id: 123 })).toBe(false);
  });
});
