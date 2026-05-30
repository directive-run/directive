/**
 * Tests for internal utilities. `serializeKey` is part of the published surface
 * but the prototype-safety guarantees deserve direct coverage rather than
 * being inferred through downstream tests.
 */

import { describe, expect, it } from "vitest";

import { serializeKey } from "../internal.js";

describe("serializeKey", () => {
  it("sorts keys so different orderings produce the same string", () => {
    expect(serializeKey({ a: 1, b: 2 })).toBe(serializeKey({ b: 2, a: 1 }));
  });

  it("uses a null-prototype accumulator so the output JSON has no prototype keys", () => {
    const out = serializeKey({ x: 1 });
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(parsed).toEqual({ x: 1 });
  });

  it("filters __proto__, constructor, and prototype from the input keys", () => {
    // Each of these would be a prototype-pollution surface if the cache key
    // were JSON.parsed and merged into another object downstream. Filtering
    // them at serialize time keeps the cache key honest about its shape.
    const key = {
      __proto__: "polluted",
      constructor: "polluted",
      prototype: "polluted",
      ticker: "AAPL",
    } as Record<string, unknown>;
    const out = serializeKey(key);
    expect(out).not.toContain("__proto__");
    expect(out).not.toContain("constructor");
    expect(out).not.toContain("prototype");
    expect(out).toContain("ticker");
    expect(out).toContain("AAPL");
  });

  it("produces identical strings whether or not the prototype key was present", () => {
    expect(serializeKey({ ticker: "AAPL" })).toBe(
      serializeKey({
        ticker: "AAPL",
        __proto__: "ignored",
      } as Record<string, unknown>),
    );
  });
});
