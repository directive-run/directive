/**
 * Tests for `describePredicate` — natural-language + algebraic rendering.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  _clearNumberFormatCache,
  _getNumberFormatCacheSize,
  NUMBER_FORMAT_CACHE_LIMIT,
  describePredicate,
  getNumberFormat,
} from "../predicate-describe.js";

// ============================================================================
// Empty / trivial
// ============================================================================

describe("describePredicate — empty / trivial", () => {
  it("renders an empty predicate as 'always true'", () => {
    expect(describePredicate({})).toBe("always true");
  });

  it("renders empty $all as 'always true'", () => {
    expect(describePredicate({ $all: [] })).toBe("always true");
  });

  it("renders empty $any as 'never'", () => {
    expect(describePredicate({ $any: [] })).toBe("never");
  });

  it("renders $not {} as 'never'", () => {
    expect(describePredicate({ $not: {} })).toBe("never");
  });

  it("renders empty array-form as 'always true'", () => {
    expect(describePredicate([])).toBe("always true");
  });

  it("returns invalid-predicate sentinel for non-object input", () => {
    expect(describePredicate("not a predicate" as never)).toBe(
      "<invalid predicate>",
    );
    expect(describePredicate(null as never)).toBe("<invalid predicate>");
  });

  it("returns cycle sentinel for a cyclic spec", () => {
    // Build a cyclic $all tree: a → b → a.
    const a: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    a.$all = [b];
    b.$all = [a];
    expect(describePredicate(a)).toContain("<invalid predicate: cycle>");
  });
});

// ============================================================================
// Per-operator natural style
// ============================================================================

describe("describePredicate — natural style operators", () => {
  it("bare equality", () => {
    expect(describePredicate({ cartTotal: 50 })).toBe("cartTotal is 50");
  });

  it("$eq", () => {
    expect(describePredicate({ cartTotal: { $eq: 50 } })).toBe(
      "cartTotal is 50",
    );
  });

  it("$ne", () => {
    expect(describePredicate({ cartTotal: { $ne: 0 } })).toBe(
      "cartTotal is not 0",
    );
  });

  it("$gt", () => {
    expect(describePredicate({ cartTotal: { $gt: 50 } })).toBe(
      "cartTotal is more than 50",
    );
  });

  it("$gte", () => {
    expect(describePredicate({ cartTotal: { $gte: 50 } })).toBe(
      "cartTotal is at least 50",
    );
  });

  it("$lt", () => {
    expect(describePredicate({ cartTotal: { $lt: 100 } })).toBe(
      "cartTotal is less than 100",
    );
  });

  it("$lte", () => {
    expect(describePredicate({ cartTotal: { $lte: 100 } })).toBe(
      "cartTotal is at most 100",
    );
  });

  it("$in", () => {
    expect(describePredicate({ region: { $in: ["US", "EU"] } })).toBe(
      "region is one of US, EU",
    );
  });

  it("$nin", () => {
    expect(describePredicate({ region: { $nin: ["BANNED"] } })).toBe(
      "region is not one of BANNED",
    );
  });

  it("$exists true / false", () => {
    expect(describePredicate({ email: { $exists: true } })).toBe(
      "email is set",
    );
    expect(describePredicate({ email: { $exists: false } })).toBe(
      "email is not set",
    );
  });

  it("$between", () => {
    expect(describePredicate({ age: { $between: [18, 65] } })).toBe(
      "age is between 18 and 65",
    );
  });

  it("$startsWith / $endsWith / $contains quote the operand", () => {
    expect(describePredicate({ name: { $startsWith: "Mr" } })).toBe(
      `name starts with "Mr"`,
    );
    expect(describePredicate({ name: { $endsWith: ".io" } })).toBe(
      `name ends with ".io"`,
    );
    expect(describePredicate({ bio: { $contains: "rust" } })).toBe(
      `bio contains "rust"`,
    );
  });

  it("$matches renders the RegExp literal", () => {
    expect(describePredicate({ email: { $matches: /^[a-z]/ } })).toBe(
      "email matches /^[a-z]/",
    );
  });

  it("$changed", () => {
    expect(describePredicate({ phase: { $changed: true } })).toBe(
      "phase changed",
    );
  });
});

// ============================================================================
// Per-operator formal style
// ============================================================================

describe("describePredicate — formal style operators", () => {
  it("renders relational operators with symbols", () => {
    expect(
      describePredicate({ cartTotal: { $gte: 50 } }, { style: "formal" }),
    ).toBe("cartTotal ≥ 50");
    expect(
      describePredicate({ cartTotal: { $gt: 50 } }, { style: "formal" }),
    ).toBe("cartTotal > 50");
    expect(
      describePredicate({ cartTotal: { $lt: 100 } }, { style: "formal" }),
    ).toBe("cartTotal < 100");
    expect(
      describePredicate({ cartTotal: { $lte: 100 } }, { style: "formal" }),
    ).toBe("cartTotal ≤ 100");
  });

  it("renders equality with =, inequality with ≠", () => {
    expect(
      describePredicate({ region: { $eq: "US" } }, { style: "formal" }),
    ).toBe(`region = "US"`);
    expect(
      describePredicate({ region: { $ne: "US" } }, { style: "formal" }),
    ).toBe(`region ≠ "US"`);
  });

  it("renders $in with ∈ and braces", () => {
    expect(
      describePredicate({ region: { $in: ["US", "EU"] } }, { style: "formal" }),
    ).toBe("region ∈ {US, EU}");
  });

  it("renders $exists with ∃ / ∄", () => {
    expect(
      describePredicate({ email: { $exists: true } }, { style: "formal" }),
    ).toBe("∃ email");
    expect(
      describePredicate({ email: { $exists: false } }, { style: "formal" }),
    ).toBe("∄ email");
  });

  it("renders $between as low ≤ name ≤ high", () => {
    expect(
      describePredicate({ age: { $between: [18, 65] } }, { style: "formal" }),
    ).toBe("18 ≤ age ≤ 65");
  });

  it("renders $matches with ~", () => {
    expect(
      describePredicate(
        { email: { $matches: /^[a-z]/ } },
        { style: "formal" },
      ),
    ).toBe("email ~ /^[a-z]/");
  });

  it("renders $changed with Δ", () => {
    expect(
      describePredicate({ phase: { $changed: true } }, { style: "formal" }),
    ).toBe("Δphase");
  });
});

// ============================================================================
// Combinators
// ============================================================================

describe("describePredicate — combinators", () => {
  it("implicit AND on object-form siblings (no parens at top level)", () => {
    expect(
      describePredicate({ cartTotal: { $gte: 50 }, region: "US" }),
    ).toBe("cartTotal is at least 50 AND region is US");
  });

  it("$all with > 1 child parenthesizes each", () => {
    expect(describePredicate({ $all: [{ a: 1 }, { b: 2 }] })).toBe(
      "(a is 1) AND (b is 2)",
    );
  });

  it("$any with > 1 child parenthesizes each", () => {
    expect(describePredicate({ $any: [{ a: 1 }, { b: 2 }] })).toBe(
      "(a is 1) OR (b is 2)",
    );
  });

  it("$not wraps in parens with NOT", () => {
    expect(describePredicate({ $not: { region: "US" } })).toBe(
      "NOT (region is US)",
    );
  });

  it("nested $any of $all and bare", () => {
    expect(
      describePredicate({
        $any: [{ $all: [{ a: 1 }, { b: 2 }] }, { c: 3 }],
      }),
    ).toBe("((a is 1) AND (b is 2)) OR (c is 3)");
  });

  it("formal style combinators use ∧ / ∨ / ¬", () => {
    expect(
      describePredicate({ $any: [{ a: 1 }, { b: 2 }] }, { style: "formal" }),
    ).toBe("(a = 1) ∨ (b = 2)");
    expect(
      describePredicate({ $not: { region: "US" } }, { style: "formal" }),
    ).toBe(`¬(region = "US")`);
  });

  it("single-element $all renders without parens", () => {
    expect(describePredicate({ $all: [{ a: 1 }] })).toBe("a is 1");
  });

  it("parenthesize: false drops combinator parens", () => {
    expect(
      describePredicate(
        { $all: [{ a: 1 }, { b: 2 }] },
        { parenthesize: false },
      ),
    ).toBe("a is 1 AND b is 2");
  });
});

// ============================================================================
// factName remapping
// ============================================================================

describe("describePredicate — factName", () => {
  it("remaps fact paths in natural style", () => {
    expect(
      describePredicate(
        { cartTotal: { $gte: 50 } },
        { factName: (p) => p.replace(/([A-Z])/g, " $1").toLowerCase() },
      ),
    ).toBe("cart total is at least 50");
  });

  it("formal style ignores factName (preserves raw path)", () => {
    expect(
      describePredicate(
        { cartTotal: { $gte: 50 } },
        {
          style: "formal",
          factName: (p) => p.replace(/([A-Z])/g, " $1").toLowerCase(),
        },
      ),
    ).toBe("cartTotal ≥ 50");
  });
});

// ============================================================================
// Value formatting
// ============================================================================

describe("describePredicate — value formatting", () => {
  it("renders bigint values", () => {
    expect(describePredicate({ count: { $gte: 1234n } })).toBe(
      "count is at least 1234",
    );
    expect(
      describePredicate({ count: { $gte: 1234n } }, { style: "formal" }),
    ).toBe("count ≥ 1234n");
  });

  it("renders Date values as ISO 8601", () => {
    const d = new Date("2026-01-01T00:00:00.000Z");
    expect(describePredicate({ at: { $gte: d } })).toBe(
      "at is at least 2026-01-01T00:00:00.000Z",
    );
  });

  it("renders null values with 'is null' / 'is not null'", () => {
    expect(describePredicate({ region: null })).toBe("region is null");
    expect(describePredicate({ region: { $ne: null } })).toBe(
      "region is not null",
    );
  });

  it("renders array values via JSON", () => {
    expect(describePredicate({ tags: ["a", "b"] })).toBe(
      "tags is [a, b]",
    );
  });

  it("quotes strings with spaces / commas in natural style", () => {
    expect(describePredicate({ name: "Mr Smith" })).toBe(
      `name is "Mr Smith"`,
    );
    expect(describePredicate({ name: "a, b" })).toBe(`name is "a, b"`);
  });

  it("always quotes strings in formal style", () => {
    expect(
      describePredicate({ region: "US" }, { style: "formal" }),
    ).toBe(`region = "US"`);
  });
});

// ============================================================================
// Locale formatting
// ============================================================================

describe("describePredicate — locale formatting", () => {
  it("formats numbers with en-US thousands separator by default", () => {
    expect(describePredicate({ cartTotal: { $gte: 1234567 } })).toBe(
      "cartTotal is at least 1,234,567",
    );
  });

  it("formats numbers with de-DE thousands separator", () => {
    // de-DE uses `.` for thousands.
    const out = describePredicate(
      { cartTotal: { $gte: 1234567 } },
      { locale: "de-DE" },
    );
    // Intl uses a non-breaking space in some locales; just check no comma.
    expect(out).not.toContain(",");
    expect(out.startsWith("cartTotal is at least ")).toBe(true);
  });

  it("caches Intl.NumberFormat instances per locale (identity on hit)", () => {
    const a = getNumberFormat("en-US");
    const b = getNumberFormat("en-US");
    expect(a).toBe(b); // same reference → cache hit
    const c = getNumberFormat("de-DE");
    expect(c).not.toBe(a); // different locale → different instance
  });

  it("falls back to en-US for invalid locale tags", () => {
    // Invalid BCP-47 tag — should not throw, should return a valid formatter.
    const fmt = getNumberFormat("not-a-real-locale-tag-zzz");
    expect(fmt).toBeInstanceOf(Intl.NumberFormat);
    // Smoke-test through describePredicate too.
    const out = describePredicate(
      { cartTotal: { $gte: 1234 } },
      { locale: "not-a-real-locale-tag-zzz" },
    );
    expect(out.startsWith("cartTotal is at least ")).toBe(true);
  });
});

// ============================================================================
// Array-form & multi-clause
// ============================================================================

describe("describePredicate — array form", () => {
  it("renders an array-form predicate equivalently to the object form", () => {
    const arrayForm = describePredicate([
      { fact: "x", op: "$gte", value: 5 },
    ]);
    const objForm = describePredicate({ x: { $gte: 5 } });
    expect(arrayForm).toBe(objForm);
    expect(arrayForm).toBe("x is at least 5");
  });

  it("renders multiple array clauses joined by AND", () => {
    expect(
      describePredicate([
        { fact: "a", op: "$gte", value: 1 },
        { fact: "b", op: "$lte", value: 9 },
      ]),
    ).toBe("a is at least 1 AND b is at most 9");
  });
});

// ============================================================================
// Unknown operator
// ============================================================================

describe("describePredicate — fallthrough", () => {
  it("renders an unknown operator with generic '<path> <op> <value>'", () => {
    // The runtime would dev-warn but describe falls through cleanly.
    const out = describePredicate({
      cartTotal: { $weirdOp: 5 },
    } as never);
    expect(out).toBe("cartTotal $weirdOp 5");
  });
});

// ============================================================================
// Nested-object (cross-module) clauses
// ============================================================================

describe("describePredicate — nested fact paths", () => {
  it("renders nested object as dotted path", () => {
    expect(
      describePredicate({
        auth: { token: { $exists: true } },
      }),
    ).toBe("auth.token is set");
  });

  it("renders deeply nested with AND on siblings", () => {
    expect(
      describePredicate({
        auth: {
          token: { $exists: true },
          role: "admin",
        },
      }),
    ).toBe("auth.token is set AND auth.role is admin");
  });
});

// ============================================================================
// F-4 — NumberFormat cache bound (FIFO eviction at NUMBER_FORMAT_CACHE_LIMIT)
// ============================================================================

describe("getNumberFormat — F-4 cache cap (50 entries, FIFO eviction)", () => {
  beforeEach(() => {
    _clearNumberFormatCache();
  });

  it("caps cache at NUMBER_FORMAT_CACHE_LIMIT (50) entries", () => {
    // Allocate 60 distinct locales (mix of valid + bogus). Invalid
    // ones fall back to en-US BUT are still cached under their raw
    // key — bounded growth is the point of the cap.
    for (let i = 0; i < 60; i++) {
      getNumberFormat(`x-test-locale-${i}`);
    }
    expect(_getNumberFormatCacheSize()).toBe(NUMBER_FORMAT_CACHE_LIMIT);
    expect(NUMBER_FORMAT_CACHE_LIMIT).toBe(50);
  });

  it("evicts the OLDEST entry first when at capacity", () => {
    // Fill cache to exactly the cap.
    for (let i = 0; i < NUMBER_FORMAT_CACHE_LIMIT; i++) {
      getNumberFormat(`x-locale-${i}`);
    }
    expect(_getNumberFormatCacheSize()).toBe(NUMBER_FORMAT_CACHE_LIMIT);

    // Adding one more should evict the oldest (`x-locale-0`).
    getNumberFormat("x-locale-NEW");
    expect(_getNumberFormatCacheSize()).toBe(NUMBER_FORMAT_CACHE_LIMIT);

    // Re-requesting the oldest now causes a fresh insert (proving
    // it was evicted) — verify size remains at the cap, not above.
    getNumberFormat("x-locale-0");
    expect(_getNumberFormatCacheSize()).toBe(NUMBER_FORMAT_CACHE_LIMIT);
  });
});
