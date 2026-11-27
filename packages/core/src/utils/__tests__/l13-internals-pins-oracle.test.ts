import { describe, expect, it } from "vitest";
import { safeStringify } from "../../internals.js";

// The L13 review's pin for /internals' safeStringify. It pins 1.35's
// behaviour: JSON with two-space indent, BigInt as "<n>n", a cut at maxLen
// (default 500) with a count of the full length, "[undefined]" for a value
// JSON drops, and "[unserializable]" for anything that throws. There is no
// depth limit; an Error and a Map or Set serialise as "{}".

describe("L13 probe pins: /internals safeStringify", () => {
  it("serialises with a two-space indent", () => {
    expect(safeStringify({ a: 1, b: [true, null] })).toBe(
      '{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}',
    );
  });

  it("writes a BigInt as its digits and an n, at any depth", () => {
    expect(safeStringify(10n)).toBe('"10n"');
    expect(safeStringify({ a: { b: [2n] } })).toBe(
      '{\n  "a": {\n    "b": [\n      "2n"\n    ]\n  }\n}',
    );
  });

  it("returns [undefined] for undefined, a function and a symbol", () => {
    expect(safeStringify(undefined)).toBe("[undefined]");
    expect(safeStringify(() => 1)).toBe("[undefined]");
    expect(safeStringify(Symbol("s"))).toBe("[undefined]");
  });

  it("returns [unserializable] for a cycle and for a throwing toJSON", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(safeStringify(cycle)).toBe("[unserializable]");
    expect(
      safeStringify({
        toJSON() {
          throw new Error("no");
        },
      }),
    ).toBe("[unserializable]");
  });

  it("cuts at maxLen and reports the full length, and leaves a value of exactly maxLen alone", () => {
    const text = "x".repeat(10);
    const full = JSON.stringify(text, null, 2);
    expect(full.length).toBe(12);
    expect(safeStringify(text, 12)).toBe(full);
    expect(safeStringify(text, 5)).toBe(
      `${full.slice(0, 5)}\n... (truncated, 12 chars total)`,
    );
    expect(safeStringify("y".repeat(600))).toBe(
      `${JSON.stringify("y".repeat(600), null, 2).slice(0, 500)}\n... (truncated, 602 chars total)`,
    );
  });

  it("has no depth limit, and writes an Error, a Map and a Set as {}", () => {
    let deep: unknown = 1;
    for (let i = 0; i < 40; i++) {
      deep = { d: deep };
    }
    expect(safeStringify(deep, 100_000)).toBe(JSON.stringify(deep, null, 2));
    expect(safeStringify(new Error("boom"))).toBe("{}");
    expect(safeStringify(new Map([["a", 1]]))).toBe("{}");
    expect(safeStringify(new Set([1]))).toBe("{}");
  });
});
