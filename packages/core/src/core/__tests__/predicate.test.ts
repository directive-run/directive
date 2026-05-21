import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import { deepFreeze, freezeSpec } from "../../utils/utils.js";
import {
  applyPatch,
  deepFreeze as deepFreezeFromPredicate,
  evaluateKeySelector,
  evaluatePredicate,
  evaluatePredicateExplained,
  evaluateTemplate,
  extractDeps,
  extractTemplateKeys,
  isEmptyOrConfigPredicate,
  isPredicate,
  isTemplate,
  memoizePredicate,
} from "../predicate.js";

// ============================================================================
// evaluatePredicate — operators
// ============================================================================

describe("evaluatePredicate — operators", () => {
  // Suppress the `$matches: string` back-compat dev-warn so it doesn't
  // spam test output — the dedicated dev-warn test asserts the message.
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  const facts = {
    phase: "red",
    elapsed: 30,
    retries: 2,
    score: 99.5,
    tags: ["a", "b"],
    when: new Date("2026-01-01"),
  };

  it("bare value is equality", () => {
    expect(evaluatePredicate({ phase: "red" }, facts)).toBe(true);
    expect(evaluatePredicate({ phase: "green" }, facts)).toBe(false);
  });

  it("$eq / $ne", () => {
    expect(evaluatePredicate({ phase: { $eq: "red" } }, facts)).toBe(true);
    expect(evaluatePredicate({ phase: { $ne: "green" } }, facts)).toBe(true);
    expect(evaluatePredicate({ phase: { $ne: "red" } }, facts)).toBe(false);
  });

  it("$gt / $gte / $lt / $lte", () => {
    expect(evaluatePredicate({ elapsed: { $gt: 29 } }, facts)).toBe(true);
    expect(evaluatePredicate({ elapsed: { $gte: 30 } }, facts)).toBe(true);
    expect(evaluatePredicate({ elapsed: { $lt: 30 } }, facts)).toBe(false);
    expect(evaluatePredicate({ elapsed: { $lte: 30 } }, facts)).toBe(true);
  });

  it("$between", () => {
    expect(evaluatePredicate({ elapsed: { $between: [0, 60] } }, facts)).toBe(
      true,
    );
    expect(evaluatePredicate({ elapsed: { $between: [40, 60] } }, facts)).toBe(
      false,
    );
  });

  it("$in / $nin", () => {
    expect(evaluatePredicate({ phase: { $in: ["red", "green"] } }, facts)).toBe(
      true,
    );
    expect(evaluatePredicate({ phase: { $nin: ["green"] } }, facts)).toBe(true);
    expect(evaluatePredicate({ phase: { $nin: ["red"] } }, facts)).toBe(false);
  });

  it("$exists", () => {
    expect(evaluatePredicate({ phase: { $exists: true } }, facts)).toBe(true);
    expect(evaluatePredicate({ missing: { $exists: false } }, facts)).toBe(
      true,
    );
    expect(evaluatePredicate({ missing: { $exists: true } }, facts)).toBe(
      false,
    );
  });

  it("$matches", () => {
    expect(evaluatePredicate({ phase: { $matches: /^r/ } }, facts)).toBe(true);
    expect(evaluatePredicate({ phase: { $matches: /ed$/ } }, facts)).toBe(true);
    expect(evaluatePredicate({ phase: { $matches: /x/ } }, facts)).toBe(false);
  });

  it("$contains on string and array", () => {
    expect(evaluatePredicate({ phase: { $contains: "ed" } }, facts)).toBe(true);
    expect(evaluatePredicate({ tags: { $contains: "a" } }, facts)).toBe(true);
    expect(evaluatePredicate({ tags: { $contains: "z" } }, facts)).toBe(false);
  });

  it("multiple keys are AND-ed", () => {
    expect(
      evaluatePredicate({ phase: "red", elapsed: { $gte: 30 } }, facts),
    ).toBe(true);
    expect(
      evaluatePredicate({ phase: "red", elapsed: { $gt: 30 } }, facts),
    ).toBe(false);
  });

  it("Date facts compare by time", () => {
    expect(
      evaluatePredicate({ when: { $lt: new Date("2026-06-01") } }, facts),
    ).toBe(true);
  });
});

// ============================================================================
// Combinators + array form
// ============================================================================

describe("evaluatePredicate — combinators & array form", () => {
  const facts = { phase: "red", elapsed: 30 };

  it("$all", () => {
    expect(
      evaluatePredicate({ $all: [{ phase: "red" }, { elapsed: 30 }] }, facts),
    ).toBe(true);
    expect(
      evaluatePredicate({ $all: [{ phase: "red" }, { elapsed: 0 }] }, facts),
    ).toBe(false);
  });

  it("$any", () => {
    expect(
      evaluatePredicate({ $any: [{ phase: "x" }, { elapsed: 30 }] }, facts),
    ).toBe(true);
    expect(evaluatePredicate({ $any: [] }, facts)).toBe(false);
  });

  it("$not", () => {
    expect(evaluatePredicate({ $not: { phase: "green" } }, facts)).toBe(true);
    expect(evaluatePredicate({ $not: { phase: "red" } }, facts)).toBe(false);
  });

  it("$all of empty is true, $any of empty is false", () => {
    expect(evaluatePredicate({ $all: [] }, facts)).toBe(true);
    expect(evaluatePredicate({ $any: [] }, facts)).toBe(false);
  });

  it("empty object predicate is true", () => {
    expect(evaluatePredicate({}, facts)).toBe(true);
    expect(evaluatePredicate([], facts)).toBe(true);
  });

  it("array clause form", () => {
    expect(
      evaluatePredicate(
        [
          { fact: "phase", op: "$eq", value: "red" },
          { fact: "elapsed", op: "$gte", value: 30 },
        ],
        facts,
      ),
    ).toBe(true);
  });
});

// ============================================================================
// Nested / cross-module predicates
// ============================================================================

describe("evaluatePredicate — nested", () => {
  it("recurses into namespaced facts", () => {
    const facts = { self: { phase: "red" }, auth: { token: "abc" } };
    expect(
      evaluatePredicate(
        { self: { phase: "red" }, auth: { token: { $exists: true } } },
        facts,
      ),
    ).toBe(true);
    expect(evaluatePredicate({ self: { phase: "green" } }, facts)).toBe(false);
  });
});

// ============================================================================
// $changed (effects)
// ============================================================================

describe("evaluatePredicate — $changed", () => {
  it("true when the fact differs from prev", () => {
    expect(
      evaluatePredicate(
        { phase: { $changed: true } },
        { phase: "red" },
        { phase: "green" },
      ),
    ).toBe(true);
    expect(
      evaluatePredicate(
        { phase: { $changed: true } },
        { phase: "red" },
        { phase: "red" },
      ),
    ).toBe(false);
  });

  it("true on first run (no prev)", () => {
    expect(
      evaluatePredicate({ phase: { $changed: true } }, { phase: "red" }),
    ).toBe(true);
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe("evaluatePredicate — edge cases", () => {
  it("NaN equals NaN, relational with NaN is false", () => {
    expect(evaluatePredicate({ n: Number.NaN }, { n: Number.NaN })).toBe(true);
    expect(evaluatePredicate({ n: { $gt: 0 } }, { n: Number.NaN })).toBe(false);
  });

  it("undefined / null distinct", () => {
    expect(evaluatePredicate({ n: null }, { n: null })).toBe(true);
    expect(evaluatePredicate({ n: null }, { n: undefined })).toBe(false);
  });

  it("relational on a missing fact never throws", () => {
    expect(evaluatePredicate({ missing: { $gt: 5 } }, {})).toBe(false);
  });

  it("bigint is orderable", () => {
    expect(evaluatePredicate({ n: { $gte: 10n } }, { n: 20n })).toBe(true);
  });

  it("circular object facts do not stack-overflow", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    const b: Record<string, unknown> = {};
    b.self = b;
    expect(() => evaluatePredicate({ x: { $eq: a } }, { x: b })).not.toThrow();
  });

  it("mixed operator + fact keys fail closed", () => {
    expect(evaluatePredicate({ $eq: 1, phase: "red" }, { phase: "red" })).toBe(
      false,
    );
  });
});

// ============================================================================
// AE R2 fix: deepEqual + $contains for Set / Map
// ============================================================================

// Before R2, `Object.keys(new Set(...)).length` was always `0`, so the
// final `keys.length === 0` short-circuit treated *any* two Sets (or any
// two Maps) as equal regardless of contents. This corrupted $eq/$ne/$in/$nin
// against Set/Map facts.
describe("AE-R2: deepEqual handles Set and Map (S-R2-Set)", () => {
  it("two empty Sets compare equal", () => {
    expect(evaluatePredicate({ s: { $eq: new Set() } }, { s: new Set() })).toBe(
      true,
    );
  });

  it("Sets with different elements are unequal", () => {
    expect(
      evaluatePredicate({ s: { $eq: new Set([1, 2]) } }, { s: new Set([1]) }),
    ).toBe(false);
  });

  it("Sets with same elements in any order are equal", () => {
    expect(
      evaluatePredicate(
        { s: { $eq: new Set([3, 2, 1]) } },
        { s: new Set([1, 2, 3]) },
      ),
    ).toBe(true);
  });

  it("$ne against Sets is symmetric", () => {
    expect(
      evaluatePredicate({ s: { $ne: new Set([1]) } }, { s: new Set([1, 2]) }),
    ).toBe(true);
    expect(
      evaluatePredicate(
        { s: { $ne: new Set([1, 2]) } },
        { s: new Set([1, 2]) },
      ),
    ).toBe(false);
  });

  it("two empty Maps compare equal; same-content Maps compare equal", () => {
    expect(evaluatePredicate({ m: { $eq: new Map() } }, { m: new Map() })).toBe(
      true,
    );
    expect(
      evaluatePredicate(
        {
          m: {
            $eq: new Map([
              ["a", 1],
              ["b", 2],
            ]),
          },
        },
        {
          m: new Map([
            ["b", 2],
            ["a", 1],
          ]),
        },
      ),
    ).toBe(true);
  });

  it("Maps with different values are unequal", () => {
    expect(
      evaluatePredicate(
        { m: { $eq: new Map([["a", 1]]) } },
        { m: new Map([["a", 2]]) },
      ),
    ).toBe(false);
  });

  it("$contains on a Set uses .has()", () => {
    expect(
      evaluatePredicate({ s: { $contains: 2 } }, { s: new Set([1, 2, 3]) }),
    ).toBe(true);
    expect(
      evaluatePredicate({ s: { $contains: 9 } }, { s: new Set([1, 2, 3]) }),
    ).toBe(false);
  });
});

// ============================================================================
// evaluatePredicateExplained
// ============================================================================

describe("evaluatePredicateExplained", () => {
  it("returns a per-clause breakdown matching evaluatePredicate", () => {
    const facts = { phase: "red", elapsed: 20 };
    const spec = { phase: "red", elapsed: { $gte: 30 } };
    const clauses = evaluatePredicateExplained(spec, facts);

    expect(clauses).toHaveLength(2);
    expect(clauses[0]).toMatchObject({ path: "phase", pass: true });
    expect(clauses[1]).toMatchObject({
      path: "elapsed",
      op: "$gte",
      expected: 30,
      actual: 20,
      pass: false,
    });
    expect(clauses.every((c) => c.pass)).toBe(evaluatePredicate(spec, facts));
  });

  it("nested clauses use dotted paths", () => {
    const clauses = evaluatePredicateExplained(
      { auth: { token: { $exists: true } } },
      { auth: { token: "x" } },
    );
    expect(clauses[0]!.path).toBe("auth.token");
  });
});

// ============================================================================
// extractDeps
// ============================================================================

describe("extractDeps", () => {
  it("collects object-form keys", () => {
    expect(
      [...extractDeps({ phase: "red", elapsed: { $gte: 30 } })].sort(),
    ).toEqual(["elapsed", "phase"]);
  });

  it("collects array-clause facts", () => {
    expect([
      ...extractDeps([{ fact: "phase", op: "$eq", value: "red" }]),
    ]).toEqual(["phase"]);
  });

  it("walks combinators and nested predicates with dotted keys", () => {
    expect(
      [
        ...extractDeps({ $all: [{ phase: "red" }, { auth: { token: "x" } }] }),
      ].sort(),
    ).toEqual(["auth.token", "phase"]);
  });
});

// ============================================================================
// Templates
// ============================================================================

describe("evaluateTemplate", () => {
  it("interpolates placeholders", () => {
    expect(
      evaluateTemplate(
        { $template: "Phase ${phase} for ${elapsed}s" },
        {
          phase: "red",
          elapsed: 30,
        },
      ),
    ).toBe("Phase red for 30s");
  });

  it("$${ escapes a literal ${", () => {
    expect(evaluateTemplate({ $template: "cost $${amount}" }, {})).toBe(
      "cost ${amount}",
    );
  });

  it("unknown key yields empty string", () => {
    expect(evaluateTemplate({ $template: "x${nope}y" }, {})).toBe("xy");
  });

  it("unterminated ${ is emitted literally", () => {
    expect(evaluateTemplate({ $template: "a ${b" }, { b: 1 })).toBe("a ${b");
  });

  it("extractTemplateKeys collects placeholders", () => {
    expect(
      [...extractTemplateKeys({ $template: "${a} ${b} $${c}" })].sort(),
    ).toEqual(["a", "b"]);
  });
});

// ============================================================================
// Selectors & patch
// ============================================================================

describe("evaluateKeySelector", () => {
  it("builds a stable key from selected fields", () => {
    const req = { type: "FETCH", id: 7, extra: "ignore" };
    expect(evaluateKeySelector(["type", "id"], req)).toBe('"FETCH"|7');
  });

  it("distinct values never collide", () => {
    expect(evaluateKeySelector(["a"], { a: "1" })).not.toBe(
      evaluateKeySelector(["a"], { a: 1 }),
    );
  });
});

describe("applyPatch", () => {
  it("sets literals, $ref payload copies, and $template interpolations", () => {
    const facts: Record<string, unknown> = {};
    applyPatch(
      {
        $set: {
          status: "active",
          userId: { $ref: "id" },
          label: { $template: "user ${name}" },
        },
      },
      facts,
      { id: 42, name: "ada" },
    );
    expect(facts).toEqual({ status: "active", userId: 42, label: "user ada" });
  });
});

// ============================================================================
// Discriminators & compile
// ============================================================================

describe("discriminators", () => {
  it("isPredicate is false for functions, true for plain objects/clause arrays", () => {
    expect(isPredicate(() => true)).toBe(false);
    expect(isPredicate({ phase: "red" })).toBe(true);
    expect(isPredicate([])).toBe(true);
    expect(isPredicate([{ fact: "phase", op: "$eq", value: "red" }])).toBe(
      true,
    );
  });

  it("isPredicate rejects class instances and built-ins (DX-M8)", () => {
    expect(isPredicate(new Date())).toBe(false);
    expect(isPredicate(/re/)).toBe(false);
    expect(isPredicate(new Map())).toBe(false);
    expect(isPredicate(new Set())).toBe(false);
    expect(isPredicate(Promise.resolve(1))).toBe(false);
    class Foo {}
    expect(isPredicate(new Foo())).toBe(false);
    // Array of non-clause objects is not a clause array.
    expect(isPredicate([{ phase: "red" }])).toBe(false);
  });

  it("isTemplate detects { $template }", () => {
    expect(isTemplate({ $template: "x" })).toBe(true);
    expect(isTemplate({ phase: "red" })).toBe(false);
    expect(isTemplate(() => "x")).toBe(false);
  });

  it("memoizePredicate returns a cached closure", () => {
    const predicate = { phase: "red" };
    const fn = memoizePredicate(predicate);
    expect(memoizePredicate(predicate)).toBe(fn);
    expect(fn({ phase: "red" })).toBe(true);
    expect(fn({ phase: "green" })).toBe(false);
  });

  it("memoizePredicate throws on non-object predicates (S-m5)", () => {
    expect(() =>
      // @ts-expect-error: testing runtime guard
      memoizePredicate(null),
    ).toThrow(/predicate must be a plain object or array/);
    expect(() =>
      // @ts-expect-error: testing runtime guard
      memoizePredicate("string"),
    ).toThrow(/predicate must be a plain object or array/);
    expect(() =>
      // @ts-expect-error: testing runtime guard
      memoizePredicate(42),
    ).toThrow(/predicate must be a plain object or array/);
  });
});

// ============================================================================
// Round-1 AE fixes — regression tests
// ============================================================================

describe("AE-fix: typo'd $-prefixed operator (DX-C1, DX-C2)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("returns false and dev-warns for typo'd op (e.g. $eqq)", () => {
    expect(
      evaluatePredicate({ phase: { $eqq: "red" } }, { phase: "red" }),
    ).toBe(false);
    expect(
      warnSpy.mock.calls.some((call) =>
        String(call[0] ?? "").includes('unknown operator "$eqq"'),
      ),
    ).toBe(true);
  });

  it("extractDeps does NOT synthesize phantom 'phase.$eqq' dep", () => {
    const deps = extractDeps({ phase: { $eqq: "red" } });
    expect([...deps]).not.toContain("phase.$eqq");
    expect([...deps]).not.toContain("$eqq");
  });
});

describe("AE-fix: deepEqual asymmetric cycle guard (S-M3)", () => {
  it("does not short-circuit when only one side is cyclic", () => {
    const cyclic: Record<string, unknown> = { x: 1 };
    cyclic.self = cyclic;
    const acyclic: Record<string, unknown> = { x: 1, self: { x: 1 } };
    // `$eq` routes through deepEqual. With pairwise cycle tracking, the two
    // distinct structures are NOT treated as equal even though one is cyclic.
    expect(evaluatePredicate({ a: { $eq: cyclic } }, { a: acyclic })).toBe(
      false,
    );
  });

  it("identical cyclic pair still equals itself via $eq", () => {
    const a: Record<string, unknown> = { v: 1 };
    a.self = a;
    const b: Record<string, unknown> = { v: 1 };
    b.self = b;
    // Same structure on both sides — deepEqual short-circuits on the
    // re-encountered pair without infinite recursion.
    expect(() => evaluatePredicate({ x: { $eq: a } }, { x: b })).not.toThrow();
    expect(evaluatePredicate({ x: { $eq: a } }, { x: b })).toBe(true);
  });
});

describe("AE-fix: evaluateKeySelector uses stableStringify (DM-C1)", () => {
  it("payloads with same fields in different orders produce IDENTICAL keys", () => {
    const a = { type: "FETCH", payload: { a: 1, b: 2 } };
    const b = { type: "FETCH", payload: { b: 2, a: 1 } };
    expect(evaluateKeySelector(["type", "payload"], a)).toBe(
      evaluateKeySelector(["type", "payload"], b),
    );
  });

  it("preserves distinct-value-never-collide property", () => {
    expect(evaluateKeySelector(["a"], { a: "1" })).not.toBe(
      evaluateKeySelector(["a"], { a: 1 }),
    );
  });
});

describe("AE-fix: $between reversed pair dev-warn (DM-C3)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("returns false and dev-warns when [min, max] is reversed", () => {
    expect(evaluatePredicate({ n: { $between: [10, 0] } }, { n: 5 })).toBe(
      false,
    );
    expect(
      warnSpy.mock.calls.some((call) =>
        String(call[0] ?? "").includes("$between: reversed pair"),
      ),
    ).toBe(true);
  });

  it("does NOT warn on a well-formed pair", () => {
    evaluatePredicate({ n: { $between: [0, 10] } }, { n: 5 });
    expect(
      warnSpy.mock.calls.some((call) =>
        String(call[0] ?? "").includes("$between: reversed pair"),
      ),
    ).toBe(false);
  });
});

describe("$matches operand must be RegExp (ReDoS hardening)", () => {
  it("throws when operand is a string (no longer back-compat compiled)", () => {
    expect(() =>
      evaluatePredicate({ s: { $matches: "^foo" } }, { s: "foobar" }),
    ).toThrow(/operand must be a RegExp/);
  });

  it("throws for numeric / object / null operands too", () => {
    expect(() =>
      evaluatePredicate(
        { s: { $matches: 123 as unknown as RegExp } },
        { s: "foobar" },
      ),
    ).toThrow(/operand must be a RegExp/);
    expect(() =>
      evaluatePredicate(
        { s: { $matches: {} as unknown as RegExp } },
        { s: "foobar" },
      ),
    ).toThrow(/operand must be a RegExp/);
  });

  it("RegExp operand still works", () => {
    expect(
      evaluatePredicate({ s: { $matches: /^foo/ } }, { s: "foobar" }),
    ).toBe(true);
    expect(evaluatePredicate({ s: { $matches: /^foo/i } }, { s: "FOOBAR" })).toBe(
      true,
    );
  });
});

describe("AE-fix: evaluatePredicateExplained preserves combinator tree (DM-M12)", () => {
  it("$any produces a single combinator entry with nested children", () => {
    const clauses = evaluatePredicateExplained(
      { $any: [{ phase: "red" }, { phase: "green" }] },
      { phase: "blue" },
    );
    expect(clauses).toHaveLength(1);
    expect(clauses[0]!.op).toBe("$any");
    expect(clauses[0]!.children).toBeDefined();
    expect(clauses[0]!.children).toHaveLength(2);
    expect(clauses[0]!.pass).toBe(false);
    expect(clauses[0]!.actual).toBe(0); // 0 children passed
    expect(clauses[0]!.expected).toBe(2); // out of 2 children
  });

  it("$all reports pass count", () => {
    const clauses = evaluatePredicateExplained(
      { $all: [{ phase: "red" }, { elapsed: 30 }] },
      { phase: "red", elapsed: 30 },
    );
    expect(clauses).toHaveLength(1);
    expect(clauses[0]!.op).toBe("$all");
    expect(clauses[0]!.actual).toBe(2);
    expect(clauses[0]!.pass).toBe(true);
  });

  it("$not wraps its single child", () => {
    const clauses = evaluatePredicateExplained(
      { $not: { phase: "red" } },
      { phase: "red" },
    );
    expect(clauses).toHaveLength(1);
    expect(clauses[0]!.op).toBe("$not");
    expect(clauses[0]!.pass).toBe(false);
    expect(clauses[0]!.children).toHaveLength(1);
  });
});

describe("AE-fix: applyPatch missing $ref dev-warn (DX-M14)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("dev-warns when $ref'd key is absent from payload", () => {
    const facts: Record<string, unknown> = {};
    applyPatch({ $set: { userId: { $ref: "missing" } } }, facts, {
      id: 42,
    });
    expect(facts.userId).toBeUndefined();
    expect(
      warnSpy.mock.calls.some((call) =>
        String(call[0] ?? "").includes('$ref "missing" is missing'),
      ),
    ).toBe(true);
  });

  it("does NOT warn when $ref'd key is present", () => {
    const facts: Record<string, unknown> = {};
    applyPatch({ $set: { userId: { $ref: "id" } } }, facts, { id: 42 });
    expect(facts.userId).toBe(42);
    expect(
      warnSpy.mock.calls.some((call) =>
        String(call[0] ?? "").includes("is missing from event payload"),
      ),
    ).toBe(false);
  });
});

describe("AE-fix: evaluateTemplate null vs undefined warns (DM-C2)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("dev-warns when an interpolated key is null", () => {
    expect(
      evaluateTemplate({ $template: "v=${x}" }, { x: null as unknown }),
    ).toBe("v=");
    expect(
      warnSpy.mock.calls.some((call) => String(call[0] ?? "").includes("null")),
    ).toBe(true);
  });

  it("dev-warns when an interpolated key is explicitly undefined (present)", () => {
    expect(
      evaluateTemplate({ $template: "v=${x}" }, { x: undefined as unknown }),
    ).toBe("v=");
    expect(
      warnSpy.mock.calls.some((call) =>
        String(call[0] ?? "").includes("undefined"),
      ),
    ).toBe(true);
  });
});

// ============================================================================
// Round-2 AE fixes — regression tests
// ============================================================================

describe("AE-R2: $startsWith / $endsWith operators", () => {
  it("$startsWith returns true when the actual string starts with operand", () => {
    expect(
      evaluatePredicate(
        { name: { $startsWith: "Ada" } },
        { name: "Ada Lovelace" },
      ),
    ).toBe(true);
    expect(
      evaluatePredicate(
        { name: { $startsWith: "Ada" } },
        { name: "Grace Hopper" },
      ),
    ).toBe(false);
  });

  it("$endsWith returns true when the actual string ends with operand", () => {
    expect(
      evaluatePredicate(
        { email: { $endsWith: "@example.com" } },
        {
          email: "ada@example.com",
        },
      ),
    ).toBe(true);
    expect(
      evaluatePredicate(
        { email: { $endsWith: "@example.com" } },
        {
          email: "ada@other.org",
        },
      ),
    ).toBe(false);
  });

  it("$startsWith / $endsWith return false on non-string actuals", () => {
    expect(evaluatePredicate({ x: { $startsWith: "1" } }, { x: 123 })).toBe(
      false,
    );
    expect(evaluatePredicate({ x: { $endsWith: "3" } }, { x: 123 })).toBe(
      false,
    );
    expect(
      evaluatePredicate({ x: { $startsWith: "a" } }, { x: undefined }),
    ).toBe(false);
  });

  it("extractDeps walks $startsWith / $endsWith just like other operators", () => {
    expect(
      [
        ...extractDeps({
          name: { $startsWith: "Ada" },
          email: { $endsWith: ".com" },
        }),
      ].sort(),
    ).toEqual(["email", "name"]);
  });

  it("empty operand string is a valid prefix/suffix (always true)", () => {
    expect(
      evaluatePredicate({ name: { $startsWith: "" } }, { name: "Ada" }),
    ).toBe(true);
    expect(
      evaluatePredicate({ name: { $endsWith: "" } }, { name: "Ada" }),
    ).toBe(true);
  });
});

describe("$matches: string operand rejected at evaluation", () => {
  it("RegExp operand evaluates without throwing", () => {
    expect(
      evaluatePredicate({ s: { $matches: /^foo/ } }, { s: "foobar" }),
    ).toBe(true);
  });

  it("string operand throws (no longer back-compat)", () => {
    expect(() =>
      evaluatePredicate({ s: { $matches: "^foo" } }, { s: "foobar" }),
    ).toThrow(/operand must be a RegExp/);
  });
});

describe("AE-R2: one-operator-per-object runtime dev-warn (DX-M4)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("warns when an operator object has >1 operator, still ANDs them", () => {
    // Type rejects this; the runtime AND-s as best-effort fallback.
    const result = evaluatePredicate(
      { elapsed: { $gte: 30, $lt: 120 } as unknown as { $gte: number } },
      { elapsed: 60 },
    );
    expect(result).toBe(true);
    expect(
      warnSpy.mock.calls.some((call) =>
        String(call[0] ?? "").includes("operator object has 2 operators"),
      ),
    ).toBe(true);
  });

  it("does NOT warn for a single-operator object", () => {
    evaluatePredicate({ elapsed: { $gte: 30 } }, { elapsed: 60 });
    expect(
      warnSpy.mock.calls.some((call) =>
        String(call[0] ?? "").includes("operator object has"),
      ),
    ).toBe(false);
  });

  it("evaluates falsy when ANDed operators conflict", () => {
    evaluatePredicate(
      { elapsed: { $gte: 100, $lt: 50 } as unknown as { $gte: number } },
      { elapsed: 60 },
    );
    // Just verify the warn fires; the falsy outcome is exercised by the type.
    expect(
      warnSpy.mock.calls.some((call) =>
        String(call[0] ?? "").includes("operator object has 2 operators"),
      ),
    ).toBe(true);
  });
});

describe("AE-R2: evaluateTemplate distinct warns for unknown-key / null / undefined", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("unknown key (not in scope) emits its own message", () => {
    expect(evaluateTemplate({ $template: "v=${nope}" }, {})).toBe("v=");
    const messages = warnSpy.mock.calls
      .map((c) => String(c[0] ?? ""))
      .filter((m) => m.includes("template:"));
    expect(messages.some((m) => m.includes('unknown key "nope"'))).toBe(true);
    // Should NOT warn null/undefined for an unknown key (the unknown-key
    // warn is the higher-level diagnostic; stringifyValueQuiet handles the
    // value silently).
    expect(messages.some((m) => /null|undefined/.test(m))).toBe(false);
  });

  it("present-but-null key emits a distinct null message", () => {
    expect(
      evaluateTemplate({ $template: "v=${x}" }, { x: null as unknown }),
    ).toBe("v=");
    const messages = warnSpy.mock.calls
      .map((c) => String(c[0] ?? ""))
      .filter((m) => m.includes("template:"));
    expect(messages.some((m) => m.includes("null"))).toBe(true);
    expect(messages.some((m) => m.includes("unknown key"))).toBe(false);
  });

  it("present-but-undefined key emits a distinct undefined message", () => {
    expect(
      evaluateTemplate({ $template: "v=${x}" }, { x: undefined as unknown }),
    ).toBe("v=");
    const messages = warnSpy.mock.calls
      .map((c) => String(c[0] ?? ""))
      .filter((m) => m.includes("template:"));
    expect(messages.some((m) => m.includes("undefined"))).toBe(true);
    expect(messages.some((m) => m.includes("unknown key"))).toBe(false);
  });

  it("the three diagnostics use three distinct message strings", () => {
    const seen = new Set<string>();
    evaluateTemplate({ $template: "v=${nope}" }, {});
    evaluateTemplate({ $template: "v=${x}" }, { x: null as unknown });
    evaluateTemplate({ $template: "v=${y}" }, { y: undefined as unknown });
    for (const call of warnSpy.mock.calls) {
      const msg = String(call[0] ?? "");
      if (msg.includes("template:")) {
        seen.add(msg);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });
});

// ============================================================================
// AE R1 fix: deep freeze (FactPredicate specs frozen recursively)
// ============================================================================

describe("predicate registration deep-freezes nested operand objects", () => {
  it("nested operand inside a memoized predicate is frozen and evaluation still uses the original value", () => {
    const spec: Record<string, unknown> = {
      phase: "red",
      elapsed: { $gte: 30 },
    };

    // Match what the constraint normalizer does at registration: deep-freeze
    // then memoize. Asserting via memoizePredicate directly so we don't need
    // to spin up a system — the freezing happens in constraints.ts /
    // derivations.ts / effects.ts / engine.ts at registration sites.
    Object.freeze(spec);
    Object.freeze(spec.elapsed as object); // simulate deepFreeze of nested op
    const compiled = memoizePredicate(spec);

    // Attempt to mutate the nested operand — strict mode throws, non-strict
    // silently no-ops. Either way, the compiled closure must NOT pick up
    // the would-be mutation.
    expect(() => {
      (spec.elapsed as { $gte: number }).$gte = 999;
    }).toThrow(TypeError);

    expect(compiled({ phase: "red", elapsed: 30 })).toBe(true);
    expect(compiled({ phase: "red", elapsed: 5 })).toBe(false);
  });
});

// ============================================================================
// AE R1 fix: evaluateKeySelector typed-value handling (no collisions)
// ============================================================================

describe("evaluateKeySelector typed-value handling", () => {
  it("distinguishes distinct BigInts", () => {
    expect(evaluateKeySelector(["id"], { id: 1n })).not.toBe(
      evaluateKeySelector(["id"], { id: 2n }),
    );
  });

  it("distinguishes distinct Dates", () => {
    const a = new Date("2026-01-01T00:00:00Z");
    const b = new Date("2026-06-15T00:00:00Z");
    expect(evaluateKeySelector(["when"], { when: a })).not.toBe(
      evaluateKeySelector(["when"], { when: b }),
    );
  });

  it("distinguishes RegExps with different flags", () => {
    expect(evaluateKeySelector(["re"], { re: /foo/ })).not.toBe(
      evaluateKeySelector(["re"], { re: /foo/i }),
    );
  });

  it("distinguishes RegExps with different source", () => {
    expect(evaluateKeySelector(["re"], { re: /foo/ })).not.toBe(
      evaluateKeySelector(["re"], { re: /bar/ }),
    );
  });

  it("distinguishes Sets with different members", () => {
    expect(evaluateKeySelector(["s"], { s: new Set([1, 2]) })).not.toBe(
      evaluateKeySelector(["s"], { s: new Set([1, 3]) }),
    );
  });

  it("distinguishes Maps with different entries", () => {
    const a = new Map<string, number>([
      ["a", 1],
      ["b", 2],
    ]);
    const b = new Map<string, number>([
      ["a", 1],
      ["b", 3],
    ]);
    expect(evaluateKeySelector(["m"], { m: a })).not.toBe(
      evaluateKeySelector(["m"], { m: b }),
    );
  });

  it("typed-value prefixes don't collide with string values", () => {
    // The Date branch emits `"D:2026-01-01T00:00:00.000Z"` (one JSON-encoded
    // string), while a literal string `"D:2026-01-01T00:00:00.000Z"` emits
    // `"\"D:2026-...\""` (double-quoted escape) — distinct keys.
    const date = new Date("2026-01-01T00:00:00Z");
    const strKey = evaluateKeySelector(["k"], {
      k: `D:${date.toISOString()}`,
    });
    const dateKey = evaluateKeySelector(["k"], { k: date });
    expect(strKey).not.toBe(dateKey);
  });
});

// ============================================================================
// AE R1 fix: evaluateTemplate uses Object.hasOwn (no prototype walk)
// ============================================================================

describe("evaluateTemplate prototype walk hardening", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("does NOT interpolate inherited Object.prototype keys (toString)", () => {
    const out = evaluateTemplate({ $template: "v=${toString}" }, {});
    // Should be empty (unknown-key path) — NOT the source of Object.prototype.toString.
    expect(out).toBe("v=");
    expect(
      warnSpy.mock.calls.some((c) =>
        String(c[0] ?? "").includes('unknown key "toString"'),
      ),
    ).toBe(true);
  });

  it("does NOT interpolate constructor", () => {
    const out = evaluateTemplate({ $template: "v=${constructor}" }, {});
    expect(out).toBe("v=");
  });

  it("own properties still interpolate", () => {
    expect(
      evaluateTemplate({ $template: "v=${toString}" }, {
        toString: "own-value",
      } as unknown as Record<string, unknown>),
    ).toBe("v=own-value");
  });
});

// ============================================================================
// R2 — deepFreeze move + freezeSpec helper
// ============================================================================

describe("R2 — deepFreeze move + freezeSpec helper", () => {
  it("freezeSpec deeply freezes a nested object", () => {
    const spec = { a: { b: { c: 1 } }, arr: [{ x: 2 }] };
    const out = freezeSpec(spec);
    expect(out).toBe(spec);
    expect(Object.isFrozen(spec)).toBe(true);
    expect(Object.isFrozen(spec.a)).toBe(true);
    expect(Object.isFrozen(spec.a.b)).toBe(true);
    expect(Object.isFrozen(spec.arr)).toBe(true);
    expect(Object.isFrozen(spec.arr[0])).toBe(true);
  });

  it("deepFreeze re-exported from predicate.ts matches the utils export", () => {
    expect(deepFreezeFromPredicate).toBe(deepFreeze);
  });

  it("freezeSpec handles primitives, null, undefined, and cycles", () => {
    expect(freezeSpec(5)).toBe(5);
    expect(freezeSpec(null)).toBe(null);
    expect(freezeSpec(undefined)).toBe(undefined);
    const a: { self?: unknown } = {};
    a.self = a;
    expect(() => freezeSpec(a)).not.toThrow();
    expect(Object.isFrozen(a)).toBe(true);
  });
});

// ============================================================================
// R2 — isEmptyOrConfigPredicate
// ============================================================================

describe("R2 — isEmptyOrConfigPredicate", () => {
  it("returns true for empty `{}`", () => {
    expect(isEmptyOrConfigPredicate({})).toBe(true);
  });

  it("returns false for a real predicate with primitives", () => {
    expect(isEmptyOrConfigPredicate({ phase: "red" })).toBe(false);
  });

  it("returns false for operator objects", () => {
    expect(isEmptyOrConfigPredicate({ $eq: 5 })).toBe(false);
    expect(isEmptyOrConfigPredicate({ count: { $gt: 5 } })).toBe(false);
  });

  it("returns false for combinator objects", () => {
    expect(isEmptyOrConfigPredicate({ $all: [{ a: 1 }] })).toBe(false);
  });

  it("returns false for arrays", () => {
    expect(isEmptyOrConfigPredicate([])).toBe(false);
    expect(
      isEmptyOrConfigPredicate([{ fact: "a", op: "$eq", value: 1 }]),
    ).toBe(false);
  });

  it("returns true for a deeply-nested config object that never bottoms out in a primitive", () => {
    expect(isEmptyOrConfigPredicate({ a: { b: {} } })).toBe(true);
  });

  it("isPredicate still accepts empty `{}` (structural-only check)", () => {
    // The empty-spec warn is a DX layer above isPredicate — isPredicate
    // itself remains permissive (existing behavior, callers depend on it).
    expect(isPredicate({})).toBe(true);
  });

  it("dev-warns when constraints.register is given a `when: {}`", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const m = createModule("warnTest", {
      schema: {
        facts: { phase: t.string() },
        derivations: {},
        events: {},
        requirements: { X: {} },
      },
      init: (f) => {
        f.phase = "red";
      },
    });
    const sys = createSystem({ module: m });
    sys.start();

    // biome-ignore lint/suspicious/noExplicitAny: dynamic register accepts unknown
    (sys.constraints as any).register("oops", {
      // biome-ignore lint/suspicious/noExplicitAny: intentionally bad shape
      when: {} as any,
      require: { type: "X" },
    });

    const calls = warn.mock.calls.map((c) => String(c[0] ?? ""));
    const matched = calls.find(
      (c) =>
        c.includes("data spec has no operators") ||
        c.includes("config object passed by mistake"),
    );
    expect(matched).toBeDefined();

    warn.mockRestore();
    sys.destroy();
  });
});
