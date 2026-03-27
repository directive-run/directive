// @ts-nocheck
import { createModule, createSystem, t } from "@directive-run/core";
import type { ModuleSchema } from "@directive-run/core";
import { describe, expect, it } from "vitest";
import { createMutation, createQuery, withQueries } from "../index.js";
import { replaceEqualDeep } from "../internal.js";

// ============================================================================
// withQueries
// ============================================================================

describe("withQueries", () => {
  describe("duplicate name detection", () => {
    it("throws when two queries share the same name", () => {
      const q1 = createQuery({
        name: "users",
        key: () => ({ all: true }),
        fetcher: async () => [],
      });
      const q2 = createQuery({
        name: "users",
        key: () => ({ all: true }),
        fetcher: async () => [],
      });

      expect(() =>
        withQueries([q1, q2], {
          schema: { facts: {}, derivations: {}, events: {}, requirements: {} },
        }),
      ).toThrow(/already registered/);
    });

    it("throws when query and mutation share the same name", () => {
      const q = createQuery({
        name: "users",
        key: () => ({ all: true }),
        fetcher: async () => [],
      });
      const m = createMutation({
        name: "users",
        mutator: async () => ({}),
      });

      expect(() =>
        withQueries([q, m], {
          schema: { facts: {}, derivations: {}, events: {}, requirements: {} },
        }),
      ).toThrow(/already registered/);
    });

    it("allows different names", () => {
      const q = createQuery({
        name: "users",
        key: () => ({ all: true }),
        fetcher: async () => [],
      });
      const m = createMutation({
        name: "updateUser",
        mutator: async () => ({}),
      });

      expect(() =>
        withQueries([q, m], {
          schema: { facts: {}, derivations: {}, events: {}, requirements: {} },
        }),
      ).not.toThrow();
    });
  });

  describe("empty array", () => {
    it("works with no queries", () => {
      const config = withQueries([], {
        schema: {
          facts: { name: t.string() },
          derivations: {},
          events: {},
          requirements: {},
        },
      });

      expect(config.schema.facts.name).toBeDefined();
    });
  });
});

// ============================================================================
// mutateAsync (promise-based)
// ============================================================================

describe("mutateAsync", () => {
  it("resolves with data on success", async () => {
    const mutation = createMutation({
      name: "update",
      mutator: async (vars: { id: string }) => ({ ...vars, done: true }),
    });
    const mod = createModule(
      "test",
      withQueries([mutation], {
        schema: {
          facts: {},
          derivations: {},
          events: {},
          requirements: {},
        } satisfies ModuleSchema,
      }),
    );
    const system = createSystem({ module: mod });
    system.start();

    const result = await mutation.mutateAsync(system.facts, { id: "1" });

    expect(result).toEqual({ id: "1", done: true });
  });

  it("rejects with error on failure", async () => {
    const mutation = createMutation({
      name: "update",
      mutator: async () => {
        throw new Error("Server error");
      },
    });
    const mod = createModule(
      "test",
      withQueries([mutation], {
        schema: {
          facts: {},
          derivations: {},
          events: {},
          requirements: {},
        } satisfies ModuleSchema,
      }),
    );
    const system = createSystem({ module: mod });
    system.start();

    await expect(mutation.mutateAsync(system.facts, {})).rejects.toThrow(
      "Server error",
    );
  });
});

// ============================================================================
// replaceEqualDeep (structural sharing)
// ============================================================================

describe("replaceEqualDeep", () => {
  it("returns old reference for identical primitives", () => {
    expect(replaceEqualDeep(42, 42)).toBe(42);
    expect(replaceEqualDeep("hello", "hello")).toBe("hello");
  });

  it("returns new value for different primitives", () => {
    expect(replaceEqualDeep(1, 2)).toBe(2);
  });

  it("preserves old reference for deeply equal objects", () => {
    const old = { a: 1, b: { c: 2 } };
    const result = replaceEqualDeep(old, { a: 1, b: { c: 2 } });

    expect(result).toBe(old);
  });

  it("returns new value for different objects", () => {
    const old = { a: 1 };
    const newVal = { a: 2 };
    const result = replaceEqualDeep(old, newVal);

    expect(result).not.toBe(old);
    expect(result).toEqual({ a: 2 });
  });

  it("preserves old reference for deeply equal arrays", () => {
    const old = [1, 2, 3];
    const result = replaceEqualDeep(old, [1, 2, 3]);

    expect(result).toBe(old);
  });

  it("returns new value for different-length arrays", () => {
    const old = [1, 2];
    const result = replaceEqualDeep(old, [1, 2, 3]);

    expect(result).toEqual([1, 2, 3]);
    expect(result).not.toBe(old);
  });

  it("handles null values", () => {
    expect(replaceEqualDeep(null, null)).toBeNull();
    expect(replaceEqualDeep({ a: 1 }, null)).toBeNull();
    expect(replaceEqualDeep(null, { a: 1 })).toEqual({ a: 1 });
  });

  it("returns new value for non-plain objects (Date)", () => {
    const oldDate = new Date("2024-01-01");
    const newDate = new Date("2024-01-01");
    const result = replaceEqualDeep(oldDate, newDate);

    // Should return new value even though they represent the same date
    expect(result).toBe(newDate);
    expect(result).not.toBe(oldDate);
  });

  it("returns new value for non-plain objects (Map)", () => {
    const oldMap = new Map([["a", 1]]);
    const newMap = new Map([["a", 1]]);
    const result = replaceEqualDeep(oldMap, newMap);

    expect(result).toBe(newMap);
  });

  it("handles mixed nesting with reference preservation", () => {
    const inner = { x: 1 };
    const old = { a: inner, b: 2 };
    const result = replaceEqualDeep(old, { a: { x: 1 }, b: 3 }) as Record<
      string,
      unknown
    >;

    // a is equal so should preserve inner reference
    expect((result as { a: typeof inner }).a).toBe(inner);
    // but b changed so overall object is new
    expect(result).not.toBe(old);
  });
});
