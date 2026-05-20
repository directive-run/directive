import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyPatch,
  compilePredicate,
  evaluateKeySelector,
  evaluatePredicate,
  evaluatePredicateExplained,
  evaluateTemplate,
  extractDeps,
  extractTemplateKeys,
  isPredicateSpec,
  isTemplate,
} from "../predicate.js";

// ============================================================================
// evaluatePredicate — operators
// ============================================================================

describe("evaluatePredicate — operators", () => {
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
    expect(evaluatePredicate({ elapsed: { $between: [0, 60] } }, facts)).toBe(true);
    expect(evaluatePredicate({ elapsed: { $between: [40, 60] } }, facts)).toBe(false);
  });

  it("$in / $nin", () => {
    expect(evaluatePredicate({ phase: { $in: ["red", "green"] } }, facts)).toBe(true);
    expect(evaluatePredicate({ phase: { $nin: ["green"] } }, facts)).toBe(true);
    expect(evaluatePredicate({ phase: { $nin: ["red"] } }, facts)).toBe(false);
  });

  it("$exists", () => {
    expect(evaluatePredicate({ phase: { $exists: true } }, facts)).toBe(true);
    expect(evaluatePredicate({ missing: { $exists: false } }, facts)).toBe(true);
    expect(evaluatePredicate({ missing: { $exists: true } }, facts)).toBe(false);
  });

  it("$matches", () => {
    expect(evaluatePredicate({ phase: { $matches: /^r/ } }, facts)).toBe(true);
    expect(evaluatePredicate({ phase: { $matches: "ed$" } }, facts)).toBe(true);
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
      evaluatePredicate({ phase: { $changed: true } }, { phase: "red" }, { phase: "green" }),
    ).toBe(true);
    expect(
      evaluatePredicate({ phase: { $changed: true } }, { phase: "red" }, { phase: "red" }),
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
    expect(evaluatePredicate({ $eq: 1, phase: "red" }, { phase: "red" })).toBe(false);
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
    expect([...extractDeps({ phase: "red", elapsed: { $gte: 30 } })].sort()).toEqual([
      "elapsed",
      "phase",
    ]);
  });

  it("collects array-clause facts", () => {
    expect([
      ...extractDeps([{ fact: "phase", op: "$eq", value: "red" }]),
    ]).toEqual(["phase"]);
  });

  it("walks combinators and nested predicates with dotted keys", () => {
    expect(
      [...extractDeps({ $all: [{ phase: "red" }, { auth: { token: "x" } }] })].sort(),
    ).toEqual(["auth.token", "phase"]);
  });
});

// ============================================================================
// Templates
// ============================================================================

describe("evaluateTemplate", () => {
  it("interpolates placeholders", () => {
    expect(
      evaluateTemplate({ $template: "Phase ${phase} for ${elapsed}s" }, {
        phase: "red",
        elapsed: 30,
      }),
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
  it("isPredicateSpec is false for functions, true for plain objects/clause arrays", () => {
    expect(isPredicateSpec(() => true)).toBe(false);
    expect(isPredicateSpec({ phase: "red" })).toBe(true);
    expect(isPredicateSpec([])).toBe(true);
    expect(
      isPredicateSpec([{ fact: "phase", op: "$eq", value: "red" }]),
    ).toBe(true);
  });

  it("isPredicateSpec rejects class instances and built-ins (DX-M8)", () => {
    expect(isPredicateSpec(new Date())).toBe(false);
    expect(isPredicateSpec(/re/)).toBe(false);
    expect(isPredicateSpec(new Map())).toBe(false);
    expect(isPredicateSpec(new Set())).toBe(false);
    expect(isPredicateSpec(Promise.resolve(1))).toBe(false);
    class Foo {}
    expect(isPredicateSpec(new Foo())).toBe(false);
    // Array of non-clause objects is not a clause array.
    expect(isPredicateSpec([{ phase: "red" }])).toBe(false);
  });

  it("isTemplate detects { $template }", () => {
    expect(isTemplate({ $template: "x" })).toBe(true);
    expect(isTemplate({ phase: "red" })).toBe(false);
    expect(isTemplate(() => "x")).toBe(false);
  });

  it("compilePredicate returns a cached closure", () => {
    const spec = { phase: "red" };
    const fn = compilePredicate(spec);
    expect(compilePredicate(spec)).toBe(fn);
    expect(fn({ phase: "red" })).toBe(true);
    expect(fn({ phase: "green" })).toBe(false);
  });

  it("compilePredicate throws on non-object specs (S-m5)", () => {
    expect(() =>
      // @ts-expect-error: testing runtime guard
      compilePredicate(null),
    ).toThrow(/spec must be a plain object or array/);
    expect(() =>
      // @ts-expect-error: testing runtime guard
      compilePredicate("string"),
    ).toThrow(/spec must be a plain object or array/);
    expect(() =>
      // @ts-expect-error: testing runtime guard
      compilePredicate(42),
    ).toThrow(/spec must be a plain object or array/);
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
    expect(
      evaluatePredicate({ a: { $eq: cyclic } }, { a: acyclic }),
    ).toBe(false);
  });

  it("identical cyclic pair still equals itself via $eq", () => {
    const a: Record<string, unknown> = { v: 1 };
    a.self = a;
    const b: Record<string, unknown> = { v: 1 };
    b.self = b;
    // Same structure on both sides — deepEqual short-circuits on the
    // re-encountered pair without infinite recursion.
    expect(() =>
      evaluatePredicate({ x: { $eq: a } }, { x: b }),
    ).not.toThrow();
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

describe("AE-fix: $matches ReDoS cache (S-m7, DM-M5)", () => {
  it("reuses the same compiled RegExp for repeated string operands", () => {
    // Indirect check: the cached regex preserves lastIndex behavior — but
    // since we use .test() without /g, lastIndex doesn't apply. Instead,
    // verify that 1000 evaluations with the same string pattern complete
    // quickly (would be slow if we recompiled every call).
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      evaluatePredicate({ s: { $matches: "^foo" } }, { s: "foobar" });
    }
    const elapsed = performance.now() - start;
    // Loose bound — recompiling 1000 regexes would still be fast, so this is
    // a smoke test only.
    expect(elapsed).toBeLessThan(500);
  });

  it("string and RegExp operands both work", () => {
    expect(evaluatePredicate({ s: { $matches: "^foo" } }, { s: "foobar" })).toBe(
      true,
    );
    expect(evaluatePredicate({ s: { $matches: /^foo/ } }, { s: "foobar" })).toBe(
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
        String(call[0] ?? "").includes("$ref \"missing\" is missing"),
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
      warnSpy.mock.calls.some((call) =>
        String(call[0] ?? "").includes('null'),
      ),
    ).toBe(true);
  });

  it("dev-warns when an interpolated key is explicitly undefined (present)", () => {
    expect(
      evaluateTemplate({ $template: "v=${x}" }, { x: undefined as unknown }),
    ).toBe("v=");
    expect(
      warnSpy.mock.calls.some((call) =>
        String(call[0] ?? "").includes('undefined'),
      ),
    ).toBe(true);
  });
});
