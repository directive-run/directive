import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import { doctor } from "../doctor.js";
import { flattenPredicate } from "../rules-diff.js";

describe("doctor.checkAgainst — direct contradictions", () => {
  it("$gte vs $lt with no overlap → direct", () => {
    const result = doctor.checkAgainst({ cartTotal: { $gte: 100 } }, [
      {
        id: "freeShipping",
        whenSpec: { cartTotal: { $lt: 50 } },
      },
    ]);
    expect(result.contradictions).toHaveLength(1);
    expect(result.contradictions[0]?.type).toBe("direct");
    expect(result.contradictions[0]?.constraintId).toBe("freeShipping");
  });

  it("$gt 50 vs $lt 50 (boundary) → direct", () => {
    const result = doctor.checkAgainst({ x: { $gt: 50 } }, [
      { id: "cap", whenSpec: { x: { $lt: 50 } } },
    ]);
    expect(result.contradictions).toHaveLength(1);
  });

  it("$eq vs different $eq → direct", () => {
    const result = doctor.checkAgainst({ status: { $eq: "active" } }, [
      { id: "block", whenSpec: { status: { $eq: "banned" } } },
    ]);
    expect(result.contradictions[0]?.type).toBe("direct");
  });

  it("$eq vs matching $ne → direct", () => {
    const result = doctor.checkAgainst({ status: { $eq: "active" } }, [
      { id: "exclude", whenSpec: { status: { $ne: "active" } } },
    ]);
    expect(result.contradictions[0]?.type).toBe("direct");
  });

  it("$in vs $in with no shared values → direct", () => {
    const result = doctor.checkAgainst(
      { region: { $in: ["ASIA", "AFRICA"] } },
      [{ id: "geo", whenSpec: { region: { $in: ["US", "EU"] } } }],
    );
    expect(result.contradictions[0]?.type).toBe("direct");
  });
});

describe("doctor.checkAgainst — subset (M17: now a warning, not a contradiction)", () => {
  it("candidate $gte 100 vs existing $gte 50 → subset in warnings", () => {
    const result = doctor.checkAgainst({ cartTotal: { $gte: 100 } }, [
      { id: "discount", whenSpec: { cartTotal: { $gte: 50 } } },
    ]);
    expect(result.contradictions).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.type).toBe("subset");
  });

  it("two identical $eq clauses → subset in warnings (candidate redundant)", () => {
    const result = doctor.checkAgainst({ status: { $eq: "active" } }, [
      { id: "echo", whenSpec: { status: { $eq: "active" } } },
    ]);
    expect(result.contradictions).toEqual([]);
    expect(result.warnings[0]?.type).toBe("subset");
  });

  it("candidate $in [US] vs existing $in [US,EU] → subset in warnings", () => {
    const result = doctor.checkAgainst({ region: { $in: ["US"] } }, [
      { id: "geo", whenSpec: { region: { $in: ["US", "EU"] } } },
    ]);
    expect(result.contradictions).toEqual([]);
    expect(result.warnings[0]?.type).toBe("subset");
  });
});

describe("doctor.checkAgainst — overlap (warning, not error)", () => {
  it("shared fact with non-comparable ops → overlap warning", () => {
    const result = doctor.checkAgainst({ name: { $startsWith: "Mr" } }, [
      { id: "x", whenSpec: { name: { $contains: "Smith" } } },
    ]);
    expect(result.contradictions).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.type).toBe("overlap");
  });

  it("$gte vs $lt with non-empty intersection → overlap (not direct)", () => {
    const result = doctor.checkAgainst({ x: { $gte: 50 } }, [
      { id: "cap", whenSpec: { x: { $lt: 100 } } },
    ]);
    expect(result.contradictions).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("doctor.checkAgainst — clean cases", () => {
  it("disjoint fact paths → no findings", () => {
    const result = doctor.checkAgainst({ cartTotal: { $gte: 50 } }, [
      { id: "other", whenSpec: { region: { $eq: "US" } } },
    ]);
    expect(result.contradictions).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("empty existing set → no findings", () => {
    const result = doctor.checkAgainst({ x: { $gte: 50 } }, []);
    expect(result.contradictions).toEqual([]);
  });

  it("constraint without whenSpec (function-form) → skipped, no findings", () => {
    const result = doctor.checkAgainst(
      { x: { $gte: 50 } },
      [{ id: "fnform" }], // no whenSpec
    );
    expect(result.contradictions).toEqual([]);
  });

  it("accepts the inspect()-style { constraints: [...] } wrapper", () => {
    const result = doctor.checkAgainst(
      { x: { $gte: 100 } },
      { constraints: [{ id: "x", whenSpec: { x: { $lt: 50 } } }] },
    );
    expect(result.contradictions).toHaveLength(1);
  });
});

describe("doctor.checkAgainst — reason quality", () => {
  it("reason cites both sides of the conflict", () => {
    const result = doctor.checkAgainst({ cartTotal: { $gte: 100 } }, [
      { id: "cap", whenSpec: { cartTotal: { $lt: 50 } } },
    ]);
    const reason = result.contradictions[0]?.reason ?? "";
    expect(reason).toContain("100");
    expect(reason).toContain("50");
    expect(reason).toContain("cartTotal");
  });
});

// ============================================================================
// M4 — doctor.checkOwns (owns:/bind: awareness)
// ============================================================================

describe("doctor.checkOwns (M4) — owns/bind awareness", () => {
  it("flags a candidate path that matches a constraint's owns: (M5: in warnings)", () => {
    const result = doctor.checkOwns(
      { cartTotal: { $gte: 100 }, region: { $eq: "US" } },
      [
        {
          id: "applyDiscount",
          whenSpec: { cartTotal: { $gte: 50 } },
          owns: ["cartTotal"],
        },
      ],
    );
    expect(result.warnings).toHaveLength(1);
    const f = result.warnings[0]!;
    expect(f.constraintId).toBe("applyDiscount");
    expect(f.candidatePath).toBe("cartTotal");
    expect(f.source).toBe("owns");
    expect(f.severity).toBe("warning");
    expect(f.reason).toContain("applyDiscount");
    expect(f.reason).toContain("cartTotal");
  });

  it("flags a candidate path that matches a constraint's bind: (M5: in warnings)", () => {
    const result = doctor.checkOwns({ phase: { $eq: "red" } }, [
      { id: "lock", bind: ["phase"] },
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.source).toBe("bind");
    expect(result.warnings[0]?.severity).toBe("warning");
  });

  it("no findings when constraints expose no owns:/bind: metadata", () => {
    const result = doctor.checkOwns({ cartTotal: { $gte: 100 } }, [
      { id: "noMeta", whenSpec: { cartTotal: { $lt: 50 } } },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("no findings when candidate paths are disjoint from owners", () => {
    const result = doctor.checkOwns({ region: { $eq: "US" } }, [
      { id: "x", owns: ["cartTotal"] },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("F-3: CheckOwnsResult shape is { warnings } only — no contradictions field", () => {
    const result = doctor.checkOwns({ cartTotal: { $gte: 100 } }, [
      { id: "owner", owns: ["cartTotal"] },
    ]);
    expect(Object.keys(result).sort()).toEqual(["warnings"]);
    expect(
      (result as { contradictions?: unknown }).contradictions,
    ).toBeUndefined();
  });

  it("accepts the inspect()-style { constraints: [...] } wrapper", () => {
    const result = doctor.checkOwns(
      { cartTotal: { $gte: 100 } },
      { constraints: [{ id: "owner", owns: ["cartTotal"] }] },
    );
    expect(result.warnings).toHaveLength(1);
  });

  // ============================================================================
  // F1 — owns: surfaces through real system.inspect()
  // ============================================================================

  it("F1: real system.inspect().constraints[].owns is populated and doctor flags it", () => {
    const mod = createModule("ownsmod", {
      schema: {
        facts: {
          foo: t.number(),
          bar: t.number(),
        },
        derivations: {},
        events: {},
        requirements: { SET_FOO: {} },
      },
      init: (facts) => {
        facts.foo = 0;
        facts.bar = 0;
      },
      constraints: {
        x: {
          when: { bar: { $gte: 5 } },
          require: { type: "SET_FOO" },
          owns: ["foo"],
        },
      },
      resolvers: {
        setFoo: {
          requirement: "SET_FOO",
          resolve: async (_req, ctx) => {
            ctx.facts.foo = 1;
          },
        },
      },
    });
    const system = createSystem({ module: mod });
    system.start();
    try {
      const inspection = system.inspect();
      expect(inspection.constraints[0]?.owns).toEqual(["foo"]);

      const result = doctor.checkOwns({ foo: { $gte: 1 } }, inspection);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.constraintId).toBe("x");
      expect(result.warnings[0]?.candidatePath).toBe("foo");
      expect(result.warnings[0]?.source).toBe("owns");
    } finally {
      system.destroy();
    }
  });
});

// ============================================================================
// M11 — doctor contract on flattenPredicate leaf shape
// ============================================================================

describe("doctor — flattenPredicate leaf shape contract (M11)", () => {
  it("flattenPredicate emits { path, op, value } LeafClause shape", () => {
    const out = flattenPredicate({ x: { $gte: 5 } });
    expect(out).toEqual([{ path: "x", op: "$gte", value: 5 }]);
  });

  it("LeafClause shape is preserved across combinator nesting", () => {
    const out = flattenPredicate({
      $all: [{ x: { $gte: 5 } }, { y: { $eq: "z" } }],
    });
    const keys = out.map((leaf) => Object.keys(leaf).sort());
    for (const k of keys) {
      expect(k).toEqual(["op", "path", "value"]);
    }
  });
});
