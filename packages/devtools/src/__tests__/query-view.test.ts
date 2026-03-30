import { describe, expect, it } from "vitest";
import {
  QUERY_LANE_COLORS,
  QUERY_SPAN_COLORS,
  QUERY_STATUS_COLORS,
} from "../lib/colors";
import { formatAge } from "../lib/time-format";
import type { DebugEvent } from "../lib/types";
import {
  buildExplainSteps,
  detectKind,
  extractQueries,
  extractQueryName,
  getEffectiveStatus,
  parseTimelineData,
  safeStringify,
} from "../views/QueryView";

// ============================================================================
// Helper: create a minimal DebugEvent
// ============================================================================

function makeEvent(
  overrides: Record<string, unknown> & { type: DebugEvent["type"] },
): DebugEvent {
  return {
    id: 1,
    timestamp: Date.now(),
    snapshotId: null,
    ...overrides,
  } as DebugEvent;
}

function makeQueryEntry(overrides: Record<string, unknown> = {}) {
  return {
    name: "user",
    kind: "query" as const,
    status: "success" as const,
    data: { id: 1 },
    error: null,
    dataUpdatedAt: Date.now() - 5000,
    isFetching: false,
    isStale: false,
    failureCount: 0,
    cacheKey: '{"userId":"1"}',
    triggerValue: null,
    ...overrides,
  };
}

// ============================================================================
// extractQueryName
// ============================================================================

describe("extractQueryName", () => {
  it("extracts simple query name from _q_user_state", () => {
    expect(extractQueryName("_q_user_state")).toBe("user");
  });

  it("extracts simple query name from _q_user_fetch", () => {
    expect(extractQueryName("_q_user_fetch")).toBe("user");
  });

  it("extracts simple query name from _q_user_resolve", () => {
    expect(extractQueryName("_q_user_resolve")).toBe("user");
  });

  it("preserves underscored query names: _q_user_profile_state", () => {
    expect(extractQueryName("_q_user_profile_state")).toBe("user_profile");
  });

  it("preserves underscored query names: _q_order_items_fetch", () => {
    expect(extractQueryName("_q_order_items_fetch")).toBe("order_items");
  });

  it("handles deeply underscored names: _q_my_long_query_name_resolve", () => {
    expect(extractQueryName("_q_my_long_query_name_resolve")).toBe(
      "my_long_query_name",
    );
  });

  it("handles _initial_resolve suffix (infinite query)", () => {
    expect(extractQueryName("_q_posts_initial_resolve")).toBe("posts");
  });

  it("handles _next_resolve suffix (infinite query)", () => {
    expect(extractQueryName("_q_posts_next_resolve")).toBe("posts");
  });

  it("handles _prev_resolve suffix (infinite query)", () => {
    expect(extractQueryName("_q_feed_prev_resolve")).toBe("feed");
  });

  it("handles _gc suffix", () => {
    expect(extractQueryName("_q_user_gc")).toBe("user");
  });

  it("handles _focus suffix", () => {
    expect(extractQueryName("_q_user_focus")).toBe("user");
  });

  it("handles _online suffix", () => {
    expect(extractQueryName("_q_user_online")).toBe("user");
  });

  it("handles _poll suffix", () => {
    expect(extractQueryName("_q_user_poll")).toBe("user");
  });

  it("handles _sub suffix (subscription)", () => {
    expect(extractQueryName("_q_notifications_sub")).toBe("notifications");
  });

  it("handles _vars suffix (mutation)", () => {
    expect(extractQueryName("_q_addTodo_vars")).toBe("addTodo");
  });

  it("handles _prevData suffix", () => {
    expect(extractQueryName("_q_user_prevData")).toBe("user");
  });

  it("returns null for non-_q_ prefixed strings", () => {
    expect(extractQueryName("user_state")).toBeNull();
    expect(extractQueryName("theme")).toBeNull();
    expect(extractQueryName("")).toBeNull();
  });

  it("returns the rest if no known suffix matches", () => {
    expect(extractQueryName("_q_custom")).toBe("custom");
  });

  it("returns null for _q_ with no name (just suffix)", () => {
    // _q__state would mean name is empty string
    expect(extractQueryName("_q__state")).toBeNull();
  });
});

// ============================================================================
// safeStringify
// ============================================================================

describe("safeStringify", () => {
  it("stringifies plain objects", () => {
    expect(safeStringify({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it("handles null", () => {
    expect(safeStringify(null)).toBe("null");
  });

  it("handles undefined", () => {
    expect(safeStringify(undefined)).toBe("[undefined]");
  });

  it("handles BigInt values", () => {
    expect(safeStringify({ val: BigInt(42) })).toBe('{\n  "val": "42n"\n}');
  });

  it("handles circular references", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(safeStringify(obj)).toBe("[unserializable]");
  });

  it("truncates at maxLen with indicator", () => {
    const data = { long: "x".repeat(1000) };
    const result = safeStringify(data, 100);
    expect(result.length).toBeLessThan(200);
    expect(result).toContain("... (truncated,");
    expect(result).toContain("chars total)");
  });

  it("does not truncate short output", () => {
    const result = safeStringify({ a: 1 }, 500);
    expect(result).not.toContain("truncated");
  });

  it("handles arrays", () => {
    expect(safeStringify([1, 2, 3])).toBe("[\n  1,\n  2,\n  3\n]");
  });

  it("handles empty object", () => {
    expect(safeStringify({})).toBe("{}");
  });
});

// ============================================================================
// getEffectiveStatus
// ============================================================================

describe("getEffectiveStatus", () => {
  it("returns 'fetching' when isFetching is true", () => {
    const q = makeQueryEntry({ isFetching: true, status: "success" });
    expect(getEffectiveStatus(q)).toBe("fetching");
  });

  it("returns base status when not fetching", () => {
    expect(getEffectiveStatus(makeQueryEntry({ status: "success" }))).toBe(
      "success",
    );
    expect(getEffectiveStatus(makeQueryEntry({ status: "error" }))).toBe(
      "error",
    );
    expect(getEffectiveStatus(makeQueryEntry({ status: "pending" }))).toBe(
      "pending",
    );
    expect(getEffectiveStatus(makeQueryEntry({ status: "disabled" }))).toBe(
      "disabled",
    );
  });
});

// ============================================================================
// parseTimelineData
// ============================================================================

describe("parseTimelineData", () => {
  it("returns empty for no events", () => {
    const { spans, triggers } = parseTimelineData([]);
    expect(spans).toEqual([]);
    expect(triggers).toEqual([]);
  });

  it("creates a success span from resolver_start + resolver_complete", () => {
    const events = [
      makeEvent({
        type: "resolver_start",
        timestamp: 1000,
        resolverId: "_q_user_resolve",
      }),
      makeEvent({
        type: "resolver_complete",
        timestamp: 1500,
        resolverId: "_q_user_resolve",
        durationMs: 500,
      }),
    ];

    const { spans } = parseTimelineData(events);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      queryName: "user",
      startTime: 1000,
      endTime: 1500,
      status: "success",
      duration: 500,
    });
  });

  it("creates an error span from resolver_start + resolver_error", () => {
    const events = [
      makeEvent({
        id: 1,
        type: "resolver_start",
        timestamp: 1000,
        resolverId: "_q_user_resolve",
      }),
      makeEvent({
        id: 2,
        type: "resolver_error",
        timestamp: 1200,
        resolverId: "_q_user_resolve",
      }),
    ];

    const { spans } = parseTimelineData(events);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.status).toBe("error");
    expect(spans[0]?.duration).toBe(200);
  });

  it("creates a pending span for orphaned resolver_start", () => {
    const events = [
      makeEvent({
        id: 1,
        type: "resolver_start",
        timestamp: 1000,
        resolverId: "_q_user_resolve",
      }),
    ];

    const { spans } = parseTimelineData(events);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.status).toBe("pending");
    expect(spans[0]?.endTime).toBeNull();
  });

  it("creates trigger dots from constraint_evaluate with active=true", () => {
    const events = [
      makeEvent({
        id: 1,
        type: "constraint_evaluate",
        timestamp: 1000,
        constraintId: "_q_user_fetch",
        active: true,
      }),
    ];

    const { triggers } = parseTimelineData(events);
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({
      queryName: "user",
      type: "constraint",
    });
  });

  it("ignores constraint_evaluate with active=false", () => {
    const events = [
      makeEvent({
        id: 1,
        type: "constraint_evaluate",
        timestamp: 1000,
        constraintId: "_q_user_fetch",
        active: false,
      }),
    ];

    const { triggers } = parseTimelineData(events);
    expect(triggers).toHaveLength(0);
  });

  it("ignores events with non-_q_ prefixed IDs", () => {
    const events = [
      makeEvent({
        id: 1,
        type: "resolver_start",
        timestamp: 1000,
        resolverId: "some_other_resolver",
      }),
    ];

    const { spans, triggers } = parseTimelineData(events);
    expect(spans).toHaveLength(0);
    expect(triggers).toHaveLength(0);
  });

  it("handles underscored query names in resolver IDs", () => {
    const events = [
      makeEvent({
        id: 1,
        type: "resolver_start",
        timestamp: 1000,
        resolverId: "_q_user_profile_resolve",
      }),
      makeEvent({
        id: 2,
        type: "resolver_complete",
        timestamp: 1100,
        resolverId: "_q_user_profile_resolve",
        durationMs: 100,
      }),
    ];

    const { spans } = parseTimelineData(events);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.queryName).toBe("user_profile");
  });
});

// ============================================================================
// buildExplainSteps
// ============================================================================

describe("buildExplainSteps", () => {
  it("builds steps from constraint + resolver events", () => {
    const query = makeQueryEntry();
    const events = [
      makeEvent({
        id: 1,
        type: "constraint_evaluate",
        timestamp: 1000,
        constraintId: "_q_user_fetch",
        active: true,
      }),
      makeEvent({
        id: 2,
        type: "resolver_start",
        timestamp: 1001,
        resolverId: "_q_user_resolve",
      }),
      makeEvent({
        id: 3,
        type: "resolver_complete",
        timestamp: 1100,
        resolverId: "_q_user_resolve",
        durationMs: 99,
      }),
    ];

    const steps = buildExplainSteps("user", query, events);
    expect(steps).toHaveLength(3);
    expect(steps[0]?.label).toContain("Constraint triggered");
    expect(steps[1]?.label).toBe("Fetcher started");
    expect(steps[2]?.label).toContain("Fetched successfully");
    expect(steps[2]?.label).toContain("99ms");
  });

  it("builds error step from resolver_error", () => {
    const query = makeQueryEntry({ status: "error" });
    const events = [
      makeEvent({
        id: 1,
        type: "resolver_start",
        timestamp: 1000,
        resolverId: "_q_user_resolve",
      }),
      makeEvent({
        id: 2,
        type: "resolver_error",
        timestamp: 1050,
        resolverId: "_q_user_resolve",
        errorMessage: "Network timeout",
      }),
    ];

    const steps = buildExplainSteps("user", query, events);
    expect(steps).toHaveLength(2);
    expect(steps[1]?.label).toBe("Fetch failed");
    expect(steps[1]?.detail).toBe("Network timeout");
  });

  it("falls back to state-based steps when no events match", () => {
    const query = makeQueryEntry({ status: "success", isStale: true });
    const steps = buildExplainSteps("user", query, []);

    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps[0]?.label).toBe("Data loaded");
    expect(steps[1]?.label).toBe("Data is stale");
  });

  it("shows disabled state for idle/disabled queries", () => {
    const query = makeQueryEntry({ status: "disabled" });
    const steps = buildExplainSteps("user", query, []);

    expect(steps[0]?.label).toBe("Query is disabled");
  });

  it("shows pending state", () => {
    const query = makeQueryEntry({
      status: "pending",
      isFetching: true,
      data: null,
    });
    const steps = buildExplainSteps("user", query, []);

    expect(steps[0]?.label).toBe("Fetching (first load)");
    expect(steps[0]?.detail).toBe("Currently fetching initial data");
  });

  it("shows error state with failure count", () => {
    const query = makeQueryEntry({
      status: "error",
      error: "Server error",
      failureCount: 3,
    });
    const steps = buildExplainSteps("user", query, []);

    expect(steps[0]?.label).toContain("errored");
    expect(steps[1]?.label).toContain("Failed 3 times");
  });

  it("includes cache key in state-based steps", () => {
    const query = makeQueryEntry({ cacheKey: '{"id":"1"}' });
    const steps = buildExplainSteps("user", query, []);
    const cacheStep = steps.find((s) => s.label.includes("Cache key"));
    expect(cacheStep).toBeDefined();
    expect(cacheStep?.label).toContain('{"id":"1"}');
  });
});

// ============================================================================
// formatAge (moved to lib/time-format.ts)
// ============================================================================

describe("formatAge", () => {
  it("returns – for null", () => {
    expect(formatAge(null)).toBe("–");
  });

  it("returns – for 0", () => {
    expect(formatAge(0)).toBe("–");
  });

  it('returns "just now" for recent timestamps', () => {
    expect(formatAge(Date.now() - 500)).toBe("just now");
  });

  it("returns seconds for <60s", () => {
    expect(formatAge(Date.now() - 30_000)).toBe("30s ago");
  });

  it("returns minutes for <60m", () => {
    expect(formatAge(Date.now() - 5 * 60_000)).toBe("5m ago");
  });

  it("returns hours for >=60m", () => {
    expect(formatAge(Date.now() - 2 * 3_600_000)).toBe("2h ago");
  });

  it("accepts a custom 'now' parameter", () => {
    expect(formatAge(1000, 6000)).toBe("5s ago");
  });

  it("returns 'just now' for future timestamps (clock skew)", () => {
    // Future timestamps result in negative ms, which is < 1000
    expect(formatAge(Date.now() + 500)).toBe("just now");
  });
});

// ============================================================================
// Color constants
// ============================================================================

describe("query color constants", () => {
  it("QUERY_STATUS_COLORS has all expected statuses", () => {
    expect(QUERY_STATUS_COLORS).toHaveProperty("success");
    expect(QUERY_STATUS_COLORS).toHaveProperty("pending");
    expect(QUERY_STATUS_COLORS).toHaveProperty("error");
    expect(QUERY_STATUS_COLORS).toHaveProperty("disabled");
    expect(QUERY_STATUS_COLORS).toHaveProperty("fetching");
  });

  it("QUERY_LANE_COLORS has 8 colors", () => {
    expect(QUERY_LANE_COLORS).toHaveLength(8);
  });

  it("QUERY_SPAN_COLORS has success, error, pending", () => {
    expect(QUERY_SPAN_COLORS).toHaveProperty("success");
    expect(QUERY_SPAN_COLORS).toHaveProperty("error");
    expect(QUERY_SPAN_COLORS).toHaveProperty("pending");
  });

  it("all QUERY_SPAN_COLORS are valid hex colors", () => {
    for (const color of Object.values(QUERY_SPAN_COLORS)) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

// ============================================================================
// extractQueries
// ============================================================================

describe("extractQueries", () => {
  it("extracts queries from snapshot _q_*_state keys", () => {
    const snapshot = {
      _q_user_state: {
        status: "success",
        data: { id: 1 },
        error: null,
        dataUpdatedAt: 1000,
        isFetching: false,
        isStale: false,
        failureCount: 0,
      },
      _q_user_key: '{"id":"1"}',
    };
    const result = extractQueries([], snapshot);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("user");
    expect(result[0]?.status).toBe("success");
    expect(result[0]?.cacheKey).toBe('{"id":"1"}');
  });

  it("skips BLOCKED_KEYS in snapshot", () => {
    const snapshot = {
      __proto__: { _q_evil_state: { status: "success" } },
      constructor: "bad",
      _q_user_state: { status: "success", data: null },
    };
    const result = extractQueries([], snapshot);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("user");
  });

  it("maps unknown status to disabled", () => {
    const snapshot = {
      _q_user_state: { status: "idle", data: null },
    };
    const result = extractQueries([], snapshot);
    expect(result[0]?.status).toBe("disabled");
  });

  it("falls back to event-based extraction when no snapshot", () => {
    const events = [
      makeEvent({
        type: "resolver_start",
        resolverId: "_q_todo_resolve",
      }),
    ];
    const result = extractQueries(events, null);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("todo");
    expect(result[0]?.status).toBe("disabled");
  });

  it("sorts by status priority then name", () => {
    const snapshot = {
      _q_beta_state: { status: "success", data: null },
      _q_alpha_state: { status: "success", data: null },
      _q_charlie_state: { status: "error", data: null },
    };
    const result = extractQueries([], snapshot);
    expect(result.map((q) => q.name)).toEqual(["alpha", "beta", "charlie"]);
  });

  it("returns empty for empty inputs", () => {
    expect(extractQueries([], null)).toEqual([]);
    expect(extractQueries([], undefined)).toEqual([]);
    expect(extractQueries([], {})).toEqual([]);
  });
});

// ============================================================================
// detectKind
// ============================================================================

describe("detectKind", () => {
  it("detects mutation from _vars fact key", () => {
    expect(detectKind("addTodo", { _q_addTodo_vars: {} })).toBe("mutation");
  });

  it("detects subscription from _key without _trigger", () => {
    expect(
      detectKind("notifications", {
        _q_notifications_state: { status: "success" },
        _q_notifications_key: "all",
        // no _q_notifications_trigger — subscriptions don't use triggers
      }),
    ).toBe("subscription");
  });

  it("detects infinite from state.pages array", () => {
    expect(
      detectKind("posts", {
        _q_posts_state: { status: "success", pages: [{ items: [] }] },
      }),
    ).toBe("infinite");
  });

  it("does not detect infinite when pages is not an array", () => {
    expect(
      detectKind("posts", {
        _q_posts_state: { status: "success", pages: null },
      }),
    ).toBe("query");
  });

  it("defaults to query when _key and _trigger both present", () => {
    expect(
      detectKind("user", {
        _q_user_state: { status: "success" },
        _q_user_key: "1",
        _q_user_trigger: 123456,
      }),
    ).toBe("query");
  });

  it("defaults to query when no special keys", () => {
    expect(detectKind("user", {})).toBe("query");
    expect(detectKind("user", { _q_user_state: {} })).toBe("query");
  });

  it("mutation takes priority over infinite (if both _vars and pages)", () => {
    expect(
      detectKind("hybrid", {
        _q_hybrid_vars: {},
        _q_hybrid_state: { pages: [] },
      }),
    ).toBe("mutation");
  });
});

// ============================================================================
// Additional edge case tests
// ============================================================================

describe("safeStringify edge cases", () => {
  it("handles objects with throwing toJSON", () => {
    const obj = {
      toJSON() {
        throw new Error("boom");
      },
    };
    expect(safeStringify(obj)).toBe("[unserializable]");
  });
});

describe("buildExplainSteps edge cases", () => {
  it("handles resolver_complete without durationMs", () => {
    const query = makeQueryEntry();
    const events = [
      makeEvent({
        type: "resolver_start",
        timestamp: 1000,
        resolverId: "_q_user_resolve",
      }),
      makeEvent({
        type: "resolver_complete",
        timestamp: 1100,
        resolverId: "_q_user_resolve",
        // no durationMs — should fall back to 0
      }),
    ];
    const steps = buildExplainSteps("user", query, events);
    expect(steps).toHaveLength(2);
    expect(steps[1]?.label).toContain("Fetched successfully");
    expect(steps[1]?.label).toContain("0ms");
  });

  it("does not match user_profile events for user query", () => {
    const query = makeQueryEntry();
    const events = [
      makeEvent({
        type: "resolver_start",
        timestamp: 1000,
        resolverId: "_q_user_profile_resolve",
      }),
    ];
    // "user" should NOT match "_q_user_profile_resolve"
    const steps = buildExplainSteps("user", query, events);
    // Should fall back to state-based steps (no event-based match)
    expect(steps[0]?.label).toBe("Data loaded");
  });
});

describe("parseTimelineData edge cases", () => {
  it("handles two sequential fetch cycles for the same resolver", () => {
    const events = [
      makeEvent({
        type: "resolver_start",
        timestamp: 1000,
        resolverId: "_q_user_resolve",
      }),
      makeEvent({
        type: "resolver_complete",
        timestamp: 1100,
        resolverId: "_q_user_resolve",
        durationMs: 100,
      }),
      makeEvent({
        type: "resolver_start",
        timestamp: 2000,
        resolverId: "_q_user_resolve",
      }),
      makeEvent({
        type: "resolver_complete",
        timestamp: 2200,
        resolverId: "_q_user_resolve",
        durationMs: 200,
      }),
    ];
    const { spans } = parseTimelineData(events);
    expect(spans).toHaveLength(2);
    expect(spans[0]?.duration).toBe(100);
    expect(spans[1]?.duration).toBe(200);
  });
});
