import { describe, it, expect } from "vitest";
import {
	CircularBuffer,
	formatValue,
	truncate,
	validateMaxEvents,
	cloneViaJSON,
	isDevMode,
	createPerfMetrics,
	createDepGraph,
	createRecordingState,
	createTimelineState,
	MAX_RECORDED_EVENTS,
	MAX_RECORDED_SNAPSHOTS,
	MAX_TIMELINE_ENTRIES,
	S,
	FLOW,
} from "../devtools-types.js";

// ============================================================================
// CircularBuffer
// ============================================================================

describe("CircularBuffer", () => {
	it("starts empty", () => {
		const buf = new CircularBuffer<number>(5);
		expect(buf.size).toBe(0);
		expect(buf.toArray()).toEqual([]);
	});

	it("pushes items and returns in order", () => {
		const buf = new CircularBuffer<number>(5);
		buf.push(1);
		buf.push(2);
		buf.push(3);
		expect(buf.size).toBe(3);
		expect(buf.toArray()).toEqual([1, 2, 3]);
	});

	it("wraps around when capacity is reached", () => {
		const buf = new CircularBuffer<number>(3);
		buf.push(1);
		buf.push(2);
		buf.push(3);
		buf.push(4);
		expect(buf.size).toBe(3);
		expect(buf.toArray()).toEqual([2, 3, 4]);
	});

	it("wraps around multiple times", () => {
		const buf = new CircularBuffer<number>(2);
		buf.push(1);
		buf.push(2);
		buf.push(3);
		buf.push(4);
		buf.push(5);
		expect(buf.size).toBe(2);
		expect(buf.toArray()).toEqual([4, 5]);
	});

	it("clear resets to empty", () => {
		const buf = new CircularBuffer<number>(5);
		buf.push(1);
		buf.push(2);
		buf.clear();
		expect(buf.size).toBe(0);
		expect(buf.toArray()).toEqual([]);
	});

	it("works after clear and re-push", () => {
		const buf = new CircularBuffer<number>(3);
		buf.push(1);
		buf.push(2);
		buf.push(3);
		buf.clear();
		buf.push(10);
		buf.push(20);
		expect(buf.size).toBe(2);
		expect(buf.toArray()).toEqual([10, 20]);
	});

	it("handles capacity of 1", () => {
		const buf = new CircularBuffer<string>(1);
		buf.push("a");
		expect(buf.toArray()).toEqual(["a"]);
		buf.push("b");
		expect(buf.toArray()).toEqual(["b"]);
		expect(buf.size).toBe(1);
	});
});

// ============================================================================
// formatValue
// ============================================================================

describe("formatValue", () => {
	it("formats undefined", () => {
		expect(formatValue(undefined)).toBe("undefined");
	});

	it("formats null", () => {
		expect(formatValue(null)).toBe("null");
	});

	it("formats numbers", () => {
		expect(formatValue(42)).toBe("42");
		expect(formatValue(0)).toBe("0");
		expect(formatValue(-1.5)).toBe("-1.5");
	});

	it("formats strings", () => {
		expect(formatValue("hello")).toBe("hello");
	});

	it("formats booleans", () => {
		expect(formatValue(true)).toBe("true");
		expect(formatValue(false)).toBe("false");
	});

	it("formats bigint", () => {
		expect(formatValue(BigInt(42))).toBe("42n");
	});

	it("formats symbol", () => {
		expect(formatValue(Symbol("test"))).toBe("Symbol(test)");
	});

	it("formats simple objects as JSON", () => {
		expect(formatValue({ a: 1 })).toBe('{"a":1}');
	});

	it("formats arrays as JSON", () => {
		expect(formatValue([1, 2, 3])).toBe("[1,2,3]");
	});

	it("truncates long objects at 120 chars", () => {
		const long = { data: "x".repeat(200) };
		const result = formatValue(long);
		expect(result.length).toBeLessThanOrEqual(120);
		expect(result.endsWith("...")).toBe(true);
	});

	it("handles circular references gracefully", () => {
		const obj: Record<string, unknown> = {};
		obj.self = obj;
		expect(formatValue(obj)).toBe("<error>");
	});
});

// ============================================================================
// truncate
// ============================================================================

describe("truncate", () => {
	it("returns short strings unchanged", () => {
		expect(truncate("hello", 10)).toBe("hello");
	});

	it("truncates long strings with ...", () => {
		expect(truncate("hello world", 8)).toBe("hello...");
	});

	it("returns exact-length strings unchanged", () => {
		expect(truncate("abc", 3)).toBe("abc");
	});

	it("handles very short max", () => {
		expect(truncate("hello", 4)).toBe("h...");
	});
});

// ============================================================================
// validateMaxEvents
// ============================================================================

describe("validateMaxEvents", () => {
	it("returns 1000 for undefined", () => {
		expect(validateMaxEvents(undefined)).toBe(1000);
	});

	it("accepts valid positive numbers", () => {
		expect(validateMaxEvents(500)).toBe(500);
		expect(validateMaxEvents(1)).toBe(1);
		expect(validateMaxEvents(10000)).toBe(10000);
	});

	it("floors float values", () => {
		expect(validateMaxEvents(5.7)).toBe(5);
		expect(validateMaxEvents(1.1)).toBe(1);
	});

	it("returns 1000 for zero", () => {
		expect(validateMaxEvents(0)).toBe(1000);
	});

	it("returns 1000 for negative numbers", () => {
		expect(validateMaxEvents(-5)).toBe(1000);
	});

	it("returns 1000 for NaN", () => {
		expect(validateMaxEvents(NaN)).toBe(1000);
	});

	it("returns 1000 for Infinity", () => {
		expect(validateMaxEvents(Infinity)).toBe(1000);
	});
});

// ============================================================================
// cloneViaJSON
// ============================================================================

describe("cloneViaJSON", () => {
	it("returns primitives unchanged", () => {
		expect(cloneViaJSON(null)).toBeNull();
		expect(cloneViaJSON(undefined)).toBeUndefined();
		expect(cloneViaJSON(42)).toBe(42);
		expect(cloneViaJSON("hello")).toBe("hello");
		expect(cloneViaJSON(true)).toBe(true);
	});

	it("deep-clones objects", () => {
		const original = { a: { b: 1 } };
		const cloned = cloneViaJSON(original) as typeof original;
		expect(cloned).toEqual({ a: { b: 1 } });
		expect(cloned).not.toBe(original);
		expect(cloned.a).not.toBe(original.a);
	});

	it("deep-clones arrays", () => {
		const original = [{ x: 1 }, { x: 2 }];
		const cloned = cloneViaJSON(original) as typeof original;
		expect(cloned).toEqual([{ x: 1 }, { x: 2 }]);
		expect(cloned[0]).not.toBe(original[0]);
	});

	it("returns null for circular references", () => {
		const obj: Record<string, unknown> = {};
		obj.self = obj;
		expect(cloneViaJSON(obj)).toBeNull();
	});

	it("strips functions (via JSON serialization)", () => {
		const obj = { a: 1, fn: () => {} };
		const cloned = cloneViaJSON(obj) as Record<string, unknown>;
		expect(cloned).toEqual({ a: 1 });
		expect(cloned.fn).toBeUndefined();
	});
});

// ============================================================================
// Factory Functions
// ============================================================================

describe("factory functions", () => {
	it("createPerfMetrics returns zeroed state", () => {
		const perf = createPerfMetrics();
		expect(perf.reconcileCount).toBe(0);
		expect(perf.reconcileTotalMs).toBe(0);
		expect(perf.resolverStats.size).toBe(0);
		expect(perf.effectRunCount).toBe(0);
		expect(perf.effectErrorCount).toBe(0);
		expect(perf.lastReconcileStartMs).toBe(0);
	});

	it("createDepGraph returns empty collections", () => {
		const graph = createDepGraph();
		expect(graph.derivationDeps.size).toBe(0);
		expect(graph.activeConstraints.size).toBe(0);
		expect(graph.recentlyChangedFacts.size).toBe(0);
		expect(graph.recentlyComputedDerivations.size).toBe(0);
		expect(graph.recentlyActiveConstraints.size).toBe(0);
		expect(graph.animationTimer).toBeNull();
	});

	it("createRecordingState returns idle state", () => {
		const rec = createRecordingState();
		expect(rec.isRecording).toBe(false);
		expect(rec.recordedEvents).toEqual([]);
		expect(rec.snapshots).toEqual([]);
	});

	it("createTimelineState returns empty state", () => {
		const tl = createTimelineState();
		expect(tl.entries.toArray()).toEqual([]);
		expect(tl.inflight.size).toBe(0);
	});
});

// ============================================================================
// Constants
// ============================================================================

describe("constants", () => {
	it("MAX_RECORDED_EVENTS is reasonable", () => {
		expect(MAX_RECORDED_EVENTS).toBe(10_000);
	});

	it("MAX_RECORDED_SNAPSHOTS is reasonable", () => {
		expect(MAX_RECORDED_SNAPSHOTS).toBe(100);
	});

	it("MAX_TIMELINE_ENTRIES is reasonable", () => {
		expect(MAX_TIMELINE_ENTRIES).toBe(200);
	});

	it("S has required color constants", () => {
		expect(S.bg).toBe("#1a1a2e");
		expect(S.text).toBe("#e0e0e0");
		expect(S.accent).toBe("#8b9aff");
		expect(S.green).toBe("#4ade80");
		expect(S.yellow).toBe("#fbbf24");
		expect(S.red).toBe("#f87171");
	});

	it("FLOW has valid layout constants", () => {
		expect(FLOW.nodeW).toBeGreaterThan(0);
		expect(FLOW.nodeH).toBeGreaterThan(0);
		expect(FLOW.columns).toBe(5);
		expect(FLOW.fontSize).toBeGreaterThan(0);
	});
});

// ============================================================================
// isDevMode
// ============================================================================

describe("isDevMode", () => {
	it("returns a boolean", () => {
		expect(typeof isDevMode()).toBe("boolean");
	});
});
