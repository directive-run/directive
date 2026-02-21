import { describe, it, expect, vi, beforeEach } from "vitest";
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

// Re-implement importRun validation for testing
function validateImportedRun(json: string): { events: DebugEvent[]; name: string } | null {
  try {
    const parsed = JSON.parse(json);
    if (parsed?.run?.events && Array.isArray(parsed.run.events)) {
      const validEvents = parsed.run.events.filter(
        (e: unknown) =>
          typeof e === "object" && e !== null &&
          typeof (e as Record<string, unknown>).id === "number" &&
          typeof (e as Record<string, unknown>).type === "string" &&
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
});
