// P3-F4: the 1.35 public names at layers core-next has built. Every expected
// value here is what 1.35 returns for the same input (the inputs were run
// through packages/core and core-next side by side; they agreed on all).
import { describe, expect, it } from "vitest";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";
import {
  Backoff,
  isNamespacedSystem,
  isSingleModuleSystem,
  shallowEqual,
  typedConstraint,
  typedResolver,
} from "../index.js";
import {
  createConstraintFactory,
  createResolverFactory,
  isPrototypeSafe,
  stableStringify,
} from "../internals.js";

const nest = (n: number): Record<string, unknown> => {
  let o: Record<string, unknown> = { leaf: 1 };
  for (let i = 0; i < n; i++) {
    o = { o };
  }

  return o;
};

describe("root: Backoff", () => {
  it("holds 1.35's three strategies, not frozen", () => {
    expect(Backoff).toEqual({
      None: "none",
      Linear: "linear",
      Exponential: "exponential",
    });
    expect(Object.isFrozen(Backoff)).toBe(false);
  });
});

describe("root: isSingleModuleSystem / isNamespacedSystem", () => {
  const counter = () =>
    createModule("counter", {
      schema: { facts: { n: t.number() } },
      init: (facts) => {
        facts.n = 0;
      },
    });

  it("tell a single-module system from a namespaced one by its _mode", () => {
    const single = createSystem({ module: counter() });
    const named = createSystem({ modules: { a: counter(), b: counter() } });
    expect([isSingleModuleSystem(single), isNamespacedSystem(single)]).toEqual([
      true,
      false,
    ]);
    expect([isSingleModuleSystem(named), isNamespacedSystem(named)]).toEqual([
      false,
      true,
    ]);
    single.destroy();
    named.destroy();
  });

  it("read only _mode, as 1.35 does: a plain object is neither, a lookalike passes", () => {
    const as = (value: unknown) =>
      value as Parameters<typeof isNamespacedSystem>[0];
    expect(isSingleModuleSystem(as({}))).toBe(false);
    expect(isNamespacedSystem(as({}))).toBe(false);
    expect(isSingleModuleSystem(as({ _mode: "single" }))).toBe(true);
    expect(isNamespacedSystem(as({ _mode: "namespaced" }))).toBe(true);
    expect(isNamespacedSystem(as({ _mode: "x" }))).toBe(false);
    // 1.35 dereferences without a guard: null and undefined throw.
    expect(() => isSingleModuleSystem(as(null))).toThrow(TypeError);
    expect(() => isNamespacedSystem(as(undefined))).toThrow(TypeError);
  });
});

describe("root: shallowEqual", () => {
  const shared = { x: 1 };
  it.each([
    [{}, {}, true],
    [{ a: 1 }, { a: 1 }, true],
    [{ a: 1 }, { a: 2 }, false],
    [{ a: 1 }, { a: 1, b: 2 }, false],
    [{ a: {} }, { a: {} }, false],
    [{ a: shared }, { a: shared }, true],
    [null, null, true],
    [null, {}, false],
    [{}, undefined, false],
    [{ a: undefined }, { b: undefined }, true],
    [[1, 2], [1, 2], true],
    [{ a: Number.NaN }, { a: Number.NaN }, false],
  ])("shallowEqual(%j, %j) is %s", (a, b, expected) => {
    expect(
      shallowEqual(a as Record<string, unknown>, b as Record<string, unknown>),
    ).toBe(expected);
  });
});

describe("root: typedConstraint / typedResolver, internals: the factories", () => {
  it("return the definition they are given, unchanged", () => {
    const constraint = { when: () => true, require: { type: "X" } };
    const resolver = { requirement: "X", async resolve() {} };
    expect(typedConstraint(constraint)).toBe(constraint);
    expect(typedResolver(resolver)).toBe(resolver);
    const constraints = createConstraintFactory();
    const resolvers = createResolverFactory();
    expect(Object.keys(constraints)).toEqual(["create"]);
    expect(Object.keys(resolvers)).toEqual(["create"]);
    expect(constraints.create(constraint)).toBe(constraint);
    expect(resolvers.create(resolver)).toBe(resolver);
  });
});

describe("internals: stableStringify", () => {
  it("sorts keys and tags non-JSON values as 1.35 does", () => {
    expect(stableStringify({ b: 2, a: { d: 4, c: 3 } })).toBe(
      '{"a":{"c":3,"d":4},"b":2}',
    );
    expect(
      [
        null,
        undefined,
        -0,
        Number.NaN,
        10n,
        () => 1,
        Symbol("q"),
        new Date(0),
        /a+/gi,
        new Map([
          ["b", 2],
          ["a", 1],
        ]),
        new Set([3, 1, 2]),
        "D:x",
        { u: undefined, f() {} },
      ].map((v) => stableStringify(v)),
    ).toEqual([
      "null",
      "undefined",
      "0",
      "NaN",
      "10n",
      '"[function]"',
      '"[symbol]"',
      "D:1970-01-01T00:00:00.000Z",
      "R:a+:gi",
      'M:[["a",1],["b",2]]',
      "S:[1,2,3]",
      '"D:x"',
      '{"f":"[function]","u":undefined}',
    ]);
  });

  it("marks a cycle, but not a value seen twice off the path", () => {
    const cyc: Record<string, unknown> = { a: 1 };
    cyc.self = cyc;
    const arr: unknown[] = [1];
    arr.push(arr);
    const shared = { x: 1 };
    expect(stableStringify(cyc)).toBe('{"a":1,"self":"[circular]"}');
    expect(stableStringify(arr)).toBe('[1,"[circular]"]');
    expect(stableStringify({ p: shared, q: shared })).toBe(
      '{"p":{"x":1},"q":{"x":1}}',
    );
  });

  it("stops past maxDepth (default 50)", () => {
    expect(stableStringify(nest(3), 2)).toBe(
      '{"o":{"o":{"o":"[max depth exceeded]"}}}',
    );
    expect(stableStringify([[[]]], 0)).toBe('["[max depth exceeded]"]');
    expect(stableStringify({}, -1)).toBe('"[max depth exceeded]"');
    // Depths 0 to 50 are written; the value at depth 51 is not.
    expect(stableStringify(nest(60))).toBe(
      `${'{"o":'.repeat(51)}"[max depth exceeded]"${"}".repeat(51)}`,
    );
  });
});

describe("internals: isPrototypeSafe", () => {
  it("refuses a blocked key at any depth, own keys only", () => {
    expect(isPrototypeSafe(JSON.parse('{"__proto__":{"x":1}}'))).toBe(false);
    expect(isPrototypeSafe(JSON.parse('{"a":{"__proto__":1}}'))).toBe(false);
    expect(isPrototypeSafe({ constructor: { prototype: {} } })).toBe(false);
    expect(isPrototypeSafe({ a: { prototype: 1 } })).toBe(false);
    expect(isPrototypeSafe([{ constructor: 1 }])).toBe(false);
    // A literal `__proto__` sets the prototype; it is not an own key.
    expect(isPrototypeSafe({ __proto__: { evil: 1 } })).toBe(true);
    expect(isPrototypeSafe({ a: { b: [1, { c: 2 }] } })).toBe(true);
    for (const value of [null, undefined, 1, "x", {}]) {
      expect(isPrototypeSafe(value)).toBe(true);
    }
  });

  it("walks an array by its elements only, as 1.35 does", () => {
    const arr: unknown[] & { constructor?: unknown } = [1, 2];
    arr.constructor = 5;
    expect(isPrototypeSafe(arr)).toBe(true);
  });

  it("counts a cycle as safe", () => {
    const cyc: Record<string, unknown> = { a: 1 };
    cyc.self = cyc;
    const arr: unknown[] = [1];
    arr.push(arr);
    expect(isPrototypeSafe(cyc)).toBe(true);
    expect(isPrototypeSafe(arr)).toBe(true);
  });

  it("fails safe past maxDepth (default 50)", () => {
    expect(isPrototypeSafe(nest(48))).toBe(true);
    expect(isPrototypeSafe(nest(49))).toBe(true);
    expect(isPrototypeSafe(nest(50))).toBe(false);
    expect(isPrototypeSafe(nest(3), 3)).toBe(false);
    expect(isPrototypeSafe(nest(3), 4)).toBe(true);
    expect(isPrototypeSafe(1, -1)).toBe(false);
    expect(isPrototypeSafe({}, 0)).toBe(true);
    expect(isPrototypeSafe({ a: 1 }, 0)).toBe(false);
  });
});
