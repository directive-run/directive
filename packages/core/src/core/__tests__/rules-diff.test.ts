import { describe, expect, it } from "vitest";
import { diffRules, flattenPredicate, toRulesMap } from "../../index.js";

// ============================================================================
// Constraint-level diff
// ============================================================================

describe("diffRules – constraint level", () => {
  it("classifies added / removed / changed / unchanged", () => {
    const report = diffRules({
      before: {
        unchanged: { phase: "red" },
        removed:   { phase: "yellow" },
        changed:   { cartTotal: { $gte: 100 } },
      },
      after: {
        unchanged: { phase: "red" },
        changed:   { cartTotal: { $gte: 50 } },
        added:     { riskScore: { $gte: 0.7 } },
      },
    });

    const byId = Object.fromEntries(report.constraints.map((c) => [c.id, c]));
    expect(byId.unchanged?.status).toBe("unchanged");
    expect(byId.removed?.status).toBe("removed");
    expect(byId.changed?.status).toBe("changed");
    expect(byId.added?.status).toBe("added");

    expect(report.summary).toEqual({
      added: 1,
      removed: 1,
      changed: 1,
      unchanged: 1,
      totalClauseChanges: 3, // removed:1 + changed:1 + added:1
    });
  });

  it("sorts constraints alphabetically for deterministic output", () => {
    const report = diffRules({
      before: { z: { x: 1 }, a: { x: 1 }, m: { x: 1 } },
      after:  { z: { x: 1 }, a: { x: 1 }, m: { x: 1 } },
    });
    expect(report.constraints.map((c) => c.id)).toEqual(["a", "m", "z"]);
  });
});

// ============================================================================
// Direction analysis – relaxed vs tightened
// ============================================================================

describe("diffRules – direction analysis", () => {
  it("relaxes $gte when threshold drops", () => {
    const report = diffRules({
      before: { c: { cartTotal: { $gte: 100 } } },
      after:  { c: { cartTotal: { $gte: 50 } } },
    });
    expect(report.constraints[0]?.changes[0]?.kind).toBe("relaxed");
  });

  it("tightens $gte when threshold rises", () => {
    const report = diffRules({
      before: { c: { cartTotal: { $gte: 50 } } },
      after:  { c: { cartTotal: { $gte: 100 } } },
    });
    expect(report.constraints[0]?.changes[0]?.kind).toBe("tightened");
  });

  it("relaxes $lte when threshold rises", () => {
    const report = diffRules({
      before: { c: { age: { $lte: 18 } } },
      after:  { c: { age: { $lte: 21 } } },
    });
    expect(report.constraints[0]?.changes[0]?.kind).toBe("relaxed");
  });

  it("tightens $between when range narrows", () => {
    const report = diffRules({
      before: { c: { x: { $between: [10, 90] } } },
      after:  { c: { x: { $between: [25, 75] } } },
    });
    expect(report.constraints[0]?.changes[0]?.kind).toBe("tightened");
  });

  it("relaxes $in when the set grows, tightens $nin when set grows", () => {
    const relax = diffRules({
      before: { c: { plan: { $in: ["free"] } } },
      after:  { c: { plan: { $in: ["free", "plus", "pro"] } } },
    });
    expect(relax.constraints[0]?.changes[0]?.kind).toBe("relaxed");

    const tighten = diffRules({
      before: { c: { plan: { $nin: ["banned"] } } },
      after:  { c: { plan: { $nin: ["banned", "fraud"] } } },
    });
    expect(tighten.constraints[0]?.changes[0]?.kind).toBe("tightened");
  });

  it("falls back to 'changed' for non-numeric value changes", () => {
    const report = diffRules({
      before: { c: { phase: "red" } },
      after:  { c: { phase: "blue" } },
    });
    expect(report.constraints[0]?.changes[0]?.kind).toBe("changed");
  });
});

// ============================================================================
// Combinator walking
// ============================================================================

describe("diffRules – combinators", () => {
  it("walks into $all and reports per-branch changes", () => {
    const report = diffRules({
      before: {
        c: { $all: [{ phase: "red" }, { elapsed: { $gte: 30 } }] },
      },
      after: {
        c: { $all: [{ phase: "red" }, { elapsed: { $gte: 60 } }] },
      },
    });
    const change = report.constraints[0]?.changes[0];
    expect(change?.path).toBe("$all[1].elapsed");
    expect(change?.kind).toBe("tightened");
  });

  it("walks into $any and reports added branches", () => {
    const report = diffRules({
      before: { c: { $any: [{ phase: "red" }] } },
      after:  { c: { $any: [{ phase: "red" }, { phase: "blue" }] } },
    });
    const change = report.constraints[0]?.changes[0];
    expect(change?.path).toBe("$any[1].phase");
    expect(change?.kind).toBe("added");
  });

  it("walks into $not", () => {
    const report = diffRules({
      before: { c: { $not: { paused: true } } },
      after:  { c: { $not: { paused: false } } },
    });
    const change = report.constraints[0]?.changes[0];
    expect(change?.path).toBe("$not.paused");
    expect(change?.kind).toBe("changed");
  });
});

// ============================================================================
// Input normalization
// ============================================================================

describe("toRulesMap – input shapes", () => {
  it("accepts a flat { id: whenSpec } map", () => {
    expect(toRulesMap({ c1: { x: 1 } })).toEqual({ c1: { x: 1 } });
  });

  it("accepts the inspect().constraints array form", () => {
    expect(
      toRulesMap([
        { id: "c1", whenSpec: { x: 1 } },
        { id: "c2", whenSpec: { y: 2 } },
      ]),
    ).toEqual({ c1: { x: 1 }, c2: { y: 2 } });
  });

  it("accepts the inspect() wrapper { constraints: ... }", () => {
    expect(toRulesMap({ constraints: { c1: { x: 1 } } })).toEqual({
      c1: { x: 1 },
    });
    expect(
      toRulesMap({ constraints: [{ id: "c1", whenSpec: { x: 1 } }] }),
    ).toEqual({ c1: { x: 1 } });
  });

  it("throws on bad shapes", () => {
    expect(() => toRulesMap(null)).toThrow(/expected a/);
    expect(() => toRulesMap(42)).toThrow(/expected a/);
    expect(() => toRulesMap([{ noId: true }])).toThrow(/id, whenSpec/);
  });
});

// ============================================================================
// Predicate flattening
// ============================================================================

describe("flattenPredicate", () => {
  it("flattens object form to one clause per fact", () => {
    const out = flattenPredicate({ phase: "red", elapsed: { $gte: 30 } });
    expect(out).toEqual([
      { path: "phase", op: "$eq", value: "red" },
      { path: "elapsed", op: "$gte", value: 30 },
    ]);
  });

  it("flattens array form (PredicateClause[])", () => {
    const out = flattenPredicate([
      { fact: "phase", op: "$eq", value: "red" },
      { fact: "elapsed", op: "$gte", value: 30 },
    ]);
    expect(out).toEqual([
      { path: "phase", op: "$eq", value: "red" },
      { path: "elapsed", op: "$gte", value: 30 },
    ]);
  });

  it("recurses into nested predicates (cross-module)", () => {
    const out = flattenPredicate({
      self: { phase: "red" },
      auth: { token: { $exists: true } },
    });
    expect(out).toEqual([
      { path: "self.phase", op: "$eq", value: "red" },
      { path: "auth.token", op: "$exists", value: true },
    ]);
  });
});

// ============================================================================
// Function-form (opaque) handling
// ============================================================================

describe("diffClauses – function-form predicates", () => {
  it("emits a single 'changed' placeholder when only one side is walkable", () => {
    // Simulating function-form: undefined whenSpec for one side. The
    // diff can't walk a function, so it reports the constraint changed
    // without per-clause detail.
    const report = diffRules({
      before: { c: undefined },
      after:  { c: { phase: "red" } },
    });
    expect(report.constraints[0]?.status).toBe("changed");
  });

  it("treats two undefined whenSpecs as unchanged", () => {
    const report = diffRules({
      before: { c: undefined },
      after:  { c: undefined },
    });
    expect(report.constraints[0]?.status).toBe("unchanged");
  });
});

// ============================================================================
// AE-round regression coverage
// ============================================================================

describe("diffRules – AE-round regressions", () => {
  it("$contains on arrays gets direction analysis (relaxed when set grows)", () => {
    const report = diffRules({
      before: { c: { tags: { $contains: ["admin"] } } },
      after:  { c: { tags: { $contains: ["admin", "auditor"] } } },
    });
    expect(report.constraints[0]?.changes[0]?.kind).toBe("relaxed");
  });

  it("$contains on strings stays 'changed' (substring direction is ambiguous)", () => {
    const report = diffRules({
      before: { c: { name: { $contains: "foo" } } },
      after:  { c: { name: { $contains: "foobar" } } },
    });
    expect(report.constraints[0]?.changes[0]?.kind).toBe("changed");
  });

  it("emits a (function-form) placeholder for opaque removed/added constraints", () => {
    const removed = diffRules({
      before: { fn: undefined },
      after:  {},
    });
    expect(removed.constraints[0]?.status).toBe("removed");
    expect(removed.constraints[0]?.changes).toEqual([
      { path: "(function-form predicate)", kind: "removed" },
    ]);

    const added = diffRules({
      before: {},
      after:  { fn: undefined },
    });
    expect(added.constraints[0]?.status).toBe("added");
    expect(added.constraints[0]?.changes).toEqual([
      { path: "(function-form predicate)", kind: "added" },
    ]);
  });

  it("ties on path are broken by operator name (deterministic across input order)", () => {
    // Two clauses on the same fact, different operators, in different
    // input orders. Output must be the same.
    const a = diffRules({
      before: {},
      after: {
        c: [
          { fact: "x", op: "$gte", value: 5 },
          { fact: "x", op: "$lte", value: 100 },
        ],
      },
    });
    const b = diffRules({
      before: {},
      after: {
        c: [
          { fact: "x", op: "$lte", value: 100 },
          { fact: "x", op: "$gte", value: 5 },
        ],
      },
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ============================================================================
// Output stability
// ============================================================================

describe("diffRules – output stability", () => {
  it("sorts changes by path for deterministic output", () => {
    const report = diffRules({
      before: {},
      after: { c: { z: 1, a: 2, m: 3 } },
    });
    const paths = report.constraints[0]?.changes.map((c) => c.path);
    expect(paths).toEqual(["a", "m", "z"]);
  });

  it("two value-equal predicates with different key order diff as unchanged", () => {
    const report = diffRules({
      before: { c: { a: 1, b: 2 } },
      after:  { c: { b: 2, a: 1 } },
    });
    expect(report.constraints[0]?.status).toBe("unchanged");
  });
});
