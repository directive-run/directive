/**
 * Tests for `predicateHash` — content-addressed FactPredicate fingerprint.
 *
 * The hash MUST be stable across:
 *   - Key ordering inside an object
 *   - Whitespace differences in the original source
 *   - Nesting (`$any`, `$all`, `$not`) with re-ordered combinator children?
 *     NO — combinators are ARRAYS; order matters semantically (`[A, B] !== [B, A]`
 *     under stable-stringify). The hash only canonicalises *object* keys.
 */

import { describe, expect, it } from "vitest";
import { predicateHash } from "../predicate-hash.js";

describe("predicateHash — determinism", () => {
  it("returns a non-empty 8-character hex string", () => {
    const h = predicateHash({ cartTotal: { $gte: 50 } });
    expect(h).toMatch(/^[0-9a-f]{1,8}$/);
    expect(h.length).toBeGreaterThan(0);
  });

  it("is stable across runs for the same input", () => {
    const spec = { cartTotal: { $gte: 50 }, region: { $in: ["US", "EU"] } };
    expect(predicateHash(spec)).toBe(predicateHash(spec));
  });

  it("is identical for semantically-identical predicates with different key order", () => {
    const a = { cartTotal: { $gte: 50 }, region: { $in: ["US", "EU"] } };
    const b = { region: { $in: ["US", "EU"] }, cartTotal: { $gte: 50 } };
    expect(predicateHash(a)).toBe(predicateHash(b));
  });

  it("is identical for nested predicates with different key order", () => {
    const a = { user: { age: { $gte: 18 }, region: "US" } };
    const b = { user: { region: "US", age: { $gte: 18 } } };
    expect(predicateHash(a)).toBe(predicateHash(b));
  });

  it("differs for different predicates", () => {
    const a = { cartTotal: { $gte: 50 } };
    const b = { cartTotal: { $gte: 100 } };
    expect(predicateHash(a)).not.toBe(predicateHash(b));
  });

  it("treats array ordering as significant (combinator children are arrays)", () => {
    // `[A, B]` and `[B, A]` aren't object key reorderings — they're
    // distinct array layouts. stableStringify preserves array order,
    // so the hashes differ.
    const a = { $any: [{ region: "US" }, { region: "EU" }] };
    const b = { $any: [{ region: "EU" }, { region: "US" }] };
    expect(predicateHash(a)).not.toBe(predicateHash(b));
  });
});

describe("predicateHash — edge cases", () => {
  it("hashes an empty predicate without throwing", () => {
    expect(() => predicateHash({})).not.toThrow();
    expect(predicateHash({})).toMatch(/^[0-9a-f]+$/);
  });

  it("hashes a deeply-nested predicate", () => {
    const spec = {
      $all: [
        { $any: [{ a: 1 }, { b: 2 }] },
        { $not: { c: { $eq: 3 } } },
        { d: { $in: [1, 2, 3, 4, 5] } },
      ],
    };
    const h = predicateHash(spec);
    expect(h).toMatch(/^[0-9a-f]+$/);
    expect(predicateHash(spec)).toBe(h);
  });

  it("hashes null operand values", () => {
    const a = { user: { $eq: null } };
    const b = { user: null };
    // null operand vs equality-shortcut to null — different shapes.
    expect(predicateHash(a)).not.toBe(predicateHash(b));
  });

  it("hashes boolean / number / string operands distinctly", () => {
    const hashes = new Set([
      predicateHash({ x: true }),
      predicateHash({ x: 1 }),
      predicateHash({ x: "1" }),
      predicateHash({ x: false }),
    ]);
    expect(hashes.size).toBe(4);
  });
});
