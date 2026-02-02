/**
 * Utils tests - Security-critical utility functions
 */

import { describe, it, expect, vi } from "vitest";
import {
	withTimeout,
	normalizeError,
	stableStringify,
	isPrototypeSafe,
	shallowEqual,
} from "../utils/utils.js";

describe("withTimeout", () => {
	it("resolves when promise completes before timeout", async () => {
		const result = await withTimeout(
			Promise.resolve("success"),
			1000,
			"Timeout",
		);
		expect(result).toBe("success");
	});

	it("rejects when timeout is exceeded", async () => {
		const slowPromise = new Promise((resolve) => setTimeout(resolve, 1000));
		await expect(
			withTimeout(slowPromise, 10, "Operation timed out"),
		).rejects.toThrow("Operation timed out");
	});

	it("cleans up timer when promise resolves", async () => {
		const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
		await withTimeout(Promise.resolve("fast"), 1000, "Timeout");
		expect(clearTimeoutSpy).toHaveBeenCalled();
		clearTimeoutSpy.mockRestore();
	});

	it("cleans up timer when promise rejects", async () => {
		const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
		await expect(
			withTimeout(Promise.reject(new Error("fail")), 1000, "Timeout"),
		).rejects.toThrow("fail");
		expect(clearTimeoutSpy).toHaveBeenCalled();
		clearTimeoutSpy.mockRestore();
	});
});

describe("normalizeError", () => {
	it("returns Error instances unchanged", () => {
		const error = new Error("test");
		expect(normalizeError(error)).toBe(error);
	});

	it("wraps strings in Error", () => {
		const result = normalizeError("string error");
		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe("string error");
	});

	it("wraps objects in Error with string representation", () => {
		const result = normalizeError({ code: 500 });
		expect(result).toBeInstanceOf(Error);
		// normalizeError uses String() which gives [object Object] for objects
		expect(result.message).toBe("[object Object]");
	});

	it("handles null", () => {
		const result = normalizeError(null);
		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe("null");
	});

	it("handles undefined", () => {
		const result = normalizeError(undefined);
		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe("undefined");
	});
});

describe("stableStringify", () => {
	it("stringifies primitives", () => {
		expect(stableStringify("hello")).toBe('"hello"');
		expect(stableStringify(42)).toBe("42");
		expect(stableStringify(true)).toBe("true");
		expect(stableStringify(null)).toBe("null");
	});

	it("stringifies objects with sorted keys", () => {
		const obj = { b: 2, a: 1, c: 3 };
		expect(stableStringify(obj)).toBe('{"a":1,"b":2,"c":3}');
	});

	it("stringifies nested objects with sorted keys", () => {
		const obj = { z: { b: 2, a: 1 }, y: 1 };
		expect(stableStringify(obj)).toBe('{"y":1,"z":{"a":1,"b":2}}');
	});

	it("stringifies arrays", () => {
		expect(stableStringify([1, 2, 3])).toBe("[1,2,3]");
		expect(stableStringify([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
	});

	it("handles circular references", () => {
		const obj: Record<string, unknown> = { a: 1 };
		obj.self = obj;
		expect(stableStringify(obj)).toBe('{"a":1,"self":"[circular]"}');
	});

	it("handles max depth", () => {
		const deep = { a: { b: { c: { d: { e: 1 } } } } };
		const result = stableStringify(deep, 3);
		expect(result).toContain("[max depth exceeded]");
	});

	it("handles undefined values in objects", () => {
		const obj = { a: 1, b: undefined };
		// stableStringify includes undefined as a string
		expect(stableStringify(obj)).toBe('{"a":1,"b":undefined}');
	});

	it("handles functions", () => {
		const obj = { a: 1, fn: () => {} };
		// stableStringify marks functions with [function]
		expect(stableStringify(obj)).toBe('{"a":1,"fn":"[function]"}');
	});
});

describe("isPrototypeSafe", () => {
	it("returns true for safe objects", () => {
		expect(isPrototypeSafe({ a: 1, b: 2 })).toBe(true);
		expect(isPrototypeSafe({ nested: { value: 1 } })).toBe(true);
		expect(isPrototypeSafe([1, 2, 3])).toBe(true);
	});

	it("returns false for __proto__ key", () => {
		const unsafe = JSON.parse('{"__proto__": {"polluted": true}}');
		expect(isPrototypeSafe(unsafe)).toBe(false);
	});

	it("returns false for constructor key", () => {
		const unsafe = JSON.parse('{"constructor": {"prototype": {}}}');
		expect(isPrototypeSafe(unsafe)).toBe(false);
	});

	it("returns false for prototype key", () => {
		const unsafe = JSON.parse('{"prototype": {}}');
		expect(isPrototypeSafe(unsafe)).toBe(false);
	});

	it("detects dangerous keys in nested objects", () => {
		const unsafe = JSON.parse('{"a": {"b": {"__proto__": {}}}}');
		expect(isPrototypeSafe(unsafe)).toBe(false);
	});

	it("detects dangerous keys in arrays", () => {
		const unsafe = JSON.parse('[{"__proto__": {}}]');
		expect(isPrototypeSafe(unsafe)).toBe(false);
	});

	it("handles deeply nested dangerous keys", () => {
		const unsafe = JSON.parse(
			'{"level1": {"level2": {"level3": {"constructor": {}}}}}',
		);
		expect(isPrototypeSafe(unsafe)).toBe(false);
	});

	it("handles circular references without infinite loop", () => {
		const obj: Record<string, unknown> = { a: 1 };
		obj.self = obj;
		// Should not throw, should return true (no dangerous keys)
		expect(isPrototypeSafe(obj)).toBe(true);
	});

	it("returns true for primitives", () => {
		expect(isPrototypeSafe("string")).toBe(true);
		expect(isPrototypeSafe(123)).toBe(true);
		expect(isPrototypeSafe(null)).toBe(true);
		expect(isPrototypeSafe(undefined)).toBe(true);
	});

	it("returns false at max depth (fail safe)", () => {
		// Create a deeply nested object that exceeds max depth
		let obj: Record<string, unknown> = { value: 1 };
		for (let i = 0; i < 100; i++) {
			obj = { nested: obj };
		}
		// Should return false at max depth (fail safe behavior)
		expect(isPrototypeSafe(obj, 50)).toBe(false);
	});

	it("returns true for objects within max depth", () => {
		// Create a nested object within max depth
		let obj: Record<string, unknown> = { value: 1 };
		for (let i = 0; i < 10; i++) {
			obj = { nested: obj };
		}
		// Should return true when within max depth
		expect(isPrototypeSafe(obj, 50)).toBe(true);
	});
});

describe("shallowEqual", () => {
	it("returns true for identical objects", () => {
		const obj = { a: 1, b: 2 };
		expect(shallowEqual(obj, obj)).toBe(true);
	});

	it("returns true for objects with same values", () => {
		expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
	});

	it("returns false for different values", () => {
		expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
	});

	it("returns false for different keys", () => {
		expect(shallowEqual({ a: 1 }, { b: 1 })).toBe(false);
	});

	it("returns false for different key counts", () => {
		expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
	});

	it("compares by reference for nested objects", () => {
		const nested = { x: 1 };
		expect(shallowEqual({ a: nested }, { a: nested })).toBe(true);
		expect(shallowEqual({ a: { x: 1 } }, { a: { x: 1 } })).toBe(false); // Different refs
	});

	it("handles empty objects", () => {
		expect(shallowEqual({}, {})).toBe(true);
	});
});
