import { describe, expect, it } from "vitest";
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
  it("isPredicateSpec is false for functions, true for objects/arrays", () => {
    expect(isPredicateSpec(() => true)).toBe(false);
    expect(isPredicateSpec({ phase: "red" })).toBe(true);
    expect(isPredicateSpec([])).toBe(true);
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
});
