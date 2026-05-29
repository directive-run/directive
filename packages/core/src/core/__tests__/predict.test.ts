import { describe, expect, it } from "vitest";
import { predict } from "../predict.js";

describe("predict — happy path", () => {
  it("wouldFire: true when all clauses pass, missingChanges empty", () => {
    const result = predict({ cartTotal: { $gte: 50 } }, { cartTotal: 75 });
    expect(result.wouldFire).toBe(true);
    expect(result.missingChanges).toEqual([]);
    expect(result.whenExplain.every((c) => c.pass)).toBe(true);
  });

  it("does not leak the input predicate reference on the result (M15)", () => {
    const p = { cartTotal: { $gte: 50 } };
    const result = predict(p, { cartTotal: 75 });
    expect(result).not.toHaveProperty("predicate");
  });
});

describe("predict — missingChanges suggestions", () => {
  it("$gte → 'set X to at least N (currently A)'", () => {
    const result = predict({ cartTotal: { $gte: 50 } }, { cartTotal: 30 });
    expect(result.wouldFire).toBe(false);
    expect(result.missingChanges).toHaveLength(1);
    const m = result.missingChanges[0]!;
    expect(m.path).toBe("cartTotal");
    expect(m.op).toBe("$gte");
    expect(m.expected).toBe(50);
    expect(m.actual).toBe(30);
    expect(m.suggestion).toBe("set cartTotal to at least 50 (currently 30)");
  });

  it("$eq → 'set X to V (currently A)'", () => {
    const result = predict(
      { status: { $eq: "active" } },
      { status: "inactive" },
    );
    expect(result.missingChanges[0]?.suggestion).toBe(
      'set status to "active" (currently "inactive")',
    );
  });

  it("$in → 'set X to one of [...] (currently A)'", () => {
    const result = predict(
      { region: { $in: ["US", "EU"] } },
      { region: "ASIA" },
    );
    const sug = result.missingChanges[0]?.suggestion ?? "";
    expect(sug).toContain("set region to one of");
    expect(sug).toContain('"US"');
    expect(sug).toContain('"EU"');
    expect(sug).toContain('"ASIA"');
  });

  it("$exists: true → 'set X to a non-null value' when the fact is undefined", () => {
    // Directive's $exists checks `!== undefined`. null counts as "exists".
    const result = predict({ email: { $exists: true } }, {
      email: undefined,
    } as unknown as Record<string, unknown>);
    expect(result.missingChanges[0]?.suggestion).toBe(
      "set email to a non-null value (currently null/missing)",
    );
  });

  it("$exists: false → 'unset X'", () => {
    const result = predict({ ssn: { $exists: false } }, { ssn: "123" });
    expect(result.missingChanges[0]?.suggestion).toBe(
      'unset ssn (currently "123")',
    );
  });

  it("$between → ranges show both bounds", () => {
    const result = predict({ age: { $between: [18, 65] } }, { age: 12 });
    expect(result.missingChanges[0]?.suggestion).toBe(
      "set age between 18 and 65 (currently 12)",
    );
  });

  it("$startsWith / $endsWith / $contains → string-shape hints", () => {
    const sw = predict({ name: { $startsWith: "Mr" } }, { name: "Alice" });
    expect(sw.missingChanges[0]?.suggestion).toContain("start with");

    const ew = predict({ email: { $endsWith: ".gov" } }, { email: "a@b.com" });
    expect(ew.missingChanges[0]?.suggestion).toContain("end with");

    const c = predict({ bio: { $contains: "rust" } }, { bio: "go developer" });
    expect(c.missingChanges[0]?.suggestion).toContain("contain");
  });
});

describe("predict — multi-clause + combinators", () => {
  it("collects every failing leaf when $all has multiple", () => {
    const result = predict(
      {
        $all: [{ cartTotal: { $gte: 50 } }, { region: { $in: ["US", "EU"] } }],
      },
      { cartTotal: 30, region: "ASIA" },
    );
    expect(result.wouldFire).toBe(false);
    expect(result.missingChanges).toHaveLength(2);
    expect(result.missingChanges.map((m) => m.path).sort()).toEqual([
      "cartTotal",
      "region",
    ]);
  });

  it("flat object form collects all failures", () => {
    const result = predict(
      { cartTotal: { $gte: 50 }, region: { $eq: "US" } },
      { cartTotal: 30, region: "EU" },
    );
    expect(result.missingChanges).toHaveLength(2);
  });

  it("returns empty missingChanges when predicate has no failed clauses", () => {
    const result = predict(
      { cartTotal: { $gte: 50 }, region: { $eq: "US" } },
      { cartTotal: 75, region: "US" },
    );
    expect(result.wouldFire).toBe(true);
    expect(result.missingChanges).toEqual([]);
  });
});

describe("predict — prev/$changed", () => {
  it("$changed with prev → fires when value differs from prev", () => {
    const result = predict(
      { phase: { $changed: true } },
      { phase: "green" },
      { phase: "red" },
    );
    expect(result.wouldFire).toBe(true);
  });

  it("$changed with prev → fails when value matches prev, suggestion mentions it", () => {
    const result = predict(
      { phase: { $changed: true } },
      { phase: "green" },
      { phase: "green" },
    );
    expect(result.wouldFire).toBe(false);
    expect(result.missingChanges[0]?.suggestion).toContain(
      "required to differ",
    );
  });

  it("M10: $changed without prev → synthetic warning entry per $changed clause (when wouldFire is false)", () => {
    // Mix a $changed clause with a non-matching $eq clause so wouldFire is
    // false — that's when the synthetic warning is relevant. (M2: when the
    // predicate fires despite $changed-without-prev, the synthetic warning
    // is silenced because the predicate result is unambiguous.)
    const result = predict(
      {
        $all: [
          { phase: { $changed: true } },
          { status: { $changed: true } },
          // Force wouldFire=false with a clause we know fails.
          { region: { $eq: "EU" } },
        ],
      },
      { phase: "green", status: "ok", region: "US" },
      // prev intentionally omitted
    );

    expect(result.wouldFire).toBe(false);
    const synthetics = result.missingChanges.filter(
      (m) => m.op === "$changed" && m.suggestion.includes("`prev` snapshot"),
    );
    expect(synthetics.length).toBe(2);
    expect(synthetics.map((m) => m.path).sort()).toEqual(["phase", "status"]);
    for (const s of synthetics) {
      expect(s.actual).toBeUndefined();
      expect(s.expected).toBe(true);
    }
  });

  it("M10: $changed without prev and nested in $all → still synthetically reported when wouldFire is false", () => {
    // Use $all so the predicate as a whole fails (status.$eq "ok" fails),
    // making the synthetic warning relevant. Note: $changed without prev
    // is "actual !== undefined" → "green" !== undefined → passes, but the
    // $all combinator still fails because of the status clause, so the
    // synthetic warning surfaces.
    //
    // (M2 update: synthetic warnings only fire when wouldFire === false.
    // A $any predicate where another arm passes will silence the warning —
    // see the M2-specific tests below for that case.)
    const result = predict(
      { $all: [{ phase: { $changed: true } }, { status: { $eq: "ok" } }] },
      { phase: "green", status: "no" },
    );
    const synthetic = result.missingChanges.find(
      (m) => m.op === "$changed" && m.path === "phase",
    );
    expect(synthetic).toBeDefined();
    expect(synthetic?.suggestion).toContain("`prev` snapshot");
  });

  // ============================================================================
  // M2 — synthetic $changed warning is silent when wouldFire === true
  // ============================================================================

  it("M2: $changed without prev → NO synthetic warning when other clauses make wouldFire true", () => {
    // When `prev` is undefined, `$changed` evaluates as: actual !== prev → actual !== undefined.
    // "green" !== undefined → true → the $changed clause passes, $any fires.
    // No missingChanges should be reported — the predicate is satisfied.
    const result = predict(
      {
        $any: [{ phase: { $changed: true } }, { status: { $eq: "no-match" } }],
      },
      { phase: "green", status: "ok" },
      // prev intentionally omitted
    );

    expect(result.wouldFire).toBe(true);
    // Synthetic $changed warnings should be silent — the predicate fired.
    expect(result.missingChanges).toHaveLength(0);
  });

  it("M2: $changed without prev → synthetic warning still fires when wouldFire === false", () => {
    // Both clauses fail → wouldFire is false → synthetic warning surfaces.
    // (Regression guard: don't accidentally silence the warning everywhere.)
    const result = predict(
      { $all: [{ phase: { $changed: true } }, { status: { $eq: "ok" } }] },
      { phase: "green", status: "no" },
    );

    expect(result.wouldFire).toBe(false);
    const synthetic = result.missingChanges.find(
      (m) => m.op === "$changed" && m.path === "phase",
    );
    expect(synthetic).toBeDefined();
    expect(synthetic?.suggestion).toContain("`prev` snapshot");
  });
});
