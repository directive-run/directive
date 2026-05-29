import { describe, expect, it, vi } from "vitest";
import { MAX_SWEEP_POINTS, type ReplayFrame, sweepUnder } from "../../index.js";

// ============================================================================
// Test fixtures
// ============================================================================

/** 6 frames covering a spread of cart totals. */
const cartFrames: ReplayFrame[] = [
  { id: "c1", facts: { cartTotal: 25, userId: "u1" } },
  { id: "c2", facts: { cartTotal: 50, userId: "u1" } },
  { id: "c3", facts: { cartTotal: 100, userId: "u2" } },
  { id: "c4", facts: { cartTotal: 120, userId: "u3" } },
  { id: "c5", facts: { cartTotal: 200, userId: "u4" } },
  { id: "c6", facts: { cartTotal: 350, userId: "u5" } },
];

// ============================================================================
// Single-hole sweep
// ============================================================================

describe("sweepUnder — single hole", () => {
  it("sweeps a threshold and ranks by matched-count", () => {
    const report = sweepUnder({
      frames: cartFrames,
      original: { cartTotal: { $gte: 100 } },
      template: { cartTotal: { $gte: { $hole: "threshold" } } },
      sweep: { threshold: [25, 50, 100, 200] },
    });

    // 4 points evaluated, in sweep order.
    expect(report.points).toHaveLength(4);
    expect(report.points.map((p) => p.values.threshold)).toEqual([
      25, 50, 100, 200,
    ]);

    // Matched counts at each threshold (>=).
    expect(report.points.map((p) => p.report.proposed.matched)).toEqual([
      6, 5, 4, 2,
    ]);

    // Default objective is matched-count, higher is better → 25 wins.
    expect(report.best.values).toEqual({ threshold: 25 });
    expect(report.best.report.proposed.matched).toBe(6);
    expect(report.bestIndex).toBe(0);
  });

  it("includes a baseline point that replays the original against itself", () => {
    const report = sweepUnder({
      frames: cartFrames,
      original: { cartTotal: { $gte: 100 } },
      template: { cartTotal: { $gte: { $hole: "t" } } },
      sweep: { t: [50, 200] },
    });

    // Baseline = original matched against itself → score = 4 (matched
    // at the original threshold of 100).
    expect(report.baseline.values).toEqual({});
    expect(report.baseline.score).toBe(4);
    expect(report.baseline.report.delta).toBe(0);
  });
});

// ============================================================================
// Custom objective
// ============================================================================

describe("sweepUnder — custom objective", () => {
  it("ranks by an arbitrary score function", () => {
    // Minimize delta — closest-to-baseline wins. Use `0 - x` (not
    // `-x`) so the score for delta=0 is +0, avoiding Object.is(-0,0) flak.
    const report = sweepUnder({
      frames: cartFrames,
      original: { cartTotal: { $gte: 100 } },
      template: { cartTotal: { $gte: { $hole: "t" } } },
      sweep: { t: [25, 100, 200] },
      objective: (r) => 0 - Math.abs(r.delta),
    });

    // t=100 gives delta=0 → score=0 (the maximum among {-2, 0, -2}).
    expect(report.best.values).toEqual({ t: 100 });
    expect(report.best.score).toBe(0);
  });

  it("threads entityKey into each replay", () => {
    const report = sweepUnder({
      frames: cartFrames,
      original: { cartTotal: { $gte: 100 } },
      template: { cartTotal: { $gte: { $hole: "t" } } },
      sweep: { t: [50] },
      entityKey: "userId",
    });

    // 5 frames match at t=50 (cartTotal in {50,100,120,200,350}), spread
    // across 5 distinct userIds.
    expect(report.points[0]?.report.proposed.matched).toBe(5);
    expect(report.points[0]?.report.proposed.matchedEntities).toBe(5);
  });
});

// ============================================================================
// Multi-hole grid search
// ============================================================================

describe("sweepUnder — multi-hole grid", () => {
  it("walks the cartesian product in declared key order", () => {
    const report = sweepUnder({
      frames: cartFrames,
      original: { cartTotal: { $gte: 100 } },
      template: {
        $all: [
          { cartTotal: { $gte: { $hole: "low" } } },
          { cartTotal: { $lte: { $hole: "high" } } },
        ],
      },
      sweep: {
        low: [50, 100],
        high: [200, 300],
      },
    });

    // 2 × 2 = 4 points.
    expect(report.points).toHaveLength(4);

    // Order: low first, then high. So:
    // (50,200), (50,300), (100,200), (100,300).
    expect(report.points.map((p) => [p.values.low, p.values.high])).toEqual([
      [50, 200],
      [50, 300],
      [100, 200],
      [100, 300],
    ]);
  });

  it("ranks the grid by default objective", () => {
    const report = sweepUnder({
      frames: cartFrames,
      original: { cartTotal: { $gte: 100 } },
      template: {
        $all: [
          { cartTotal: { $gte: { $hole: "low" } } },
          { cartTotal: { $lte: { $hole: "high" } } },
        ],
      },
      sweep: {
        low: [25, 100],
        high: [200, 400],
      },
    });

    // (low=25, high=400) is the widest band → maximum matches.
    expect(report.best.values).toEqual({ low: 25, high: 400 });
    expect(report.best.report.proposed.matched).toBe(6);
  });
});

// ============================================================================
// Error handling
// ============================================================================

describe("sweepUnder — error paths", () => {
  it("throws when sweep is empty", () => {
    expect(() =>
      sweepUnder({
        frames: cartFrames,
        original: { cartTotal: { $gte: 100 } },
        template: { cartTotal: { $gte: { $hole: "t" } } },
        sweep: {},
      }),
    ).toThrow(/at least one hole name/);
  });

  it("throws when a hole in the template has no sweep values", () => {
    expect(() =>
      sweepUnder({
        frames: cartFrames,
        original: { cartTotal: { $gte: 100 } },
        template: { cartTotal: { $gte: { $hole: "missing" } } },
        sweep: { other: [1, 2, 3] },
      }),
    ).toThrow(/hole "missing".*no values/);
  });

  it("throws when a hole has an empty value array", () => {
    expect(() =>
      sweepUnder({
        frames: cartFrames,
        original: { cartTotal: { $gte: 100 } },
        template: { cartTotal: { $gte: { $hole: "t" } } },
        sweep: { t: [] },
      }),
    ).toThrow(/zero candidate values/);
  });

  it("throws when the grid exceeds MAX_SWEEP_POINTS", () => {
    // Three holes of length 100 = 1,000,000 — over the 10k cap.
    const big = Array.from({ length: 100 }, (_, i) => i);
    expect(() =>
      sweepUnder({
        frames: cartFrames,
        original: { cartTotal: { $gte: 100 } },
        template: {
          $all: [
            { cartTotal: { $gte: { $hole: "a" } } },
            { cartTotal: { $gte: { $hole: "b" } } },
            { cartTotal: { $gte: { $hole: "c" } } },
          ],
        },
        sweep: { a: big, b: big, c: big },
      }),
    ).toThrow(/exceeds the MAX_SWEEP_POINTS limit/);
  });
});

// ============================================================================
// Template substitution edge cases
// ============================================================================

describe("sweepUnder — AE-round regression coverage", () => {
  it("substitutes shared sub-tree references on every occurrence (no WeakSet aliasing)", () => {
    // A hand-built template where the same hole reference appears twice
    // via a shared object. Both occurrences must be substituted — the
    // earlier aliasing bug left the second one as a literal {$hole}.
    const hole = { $hole: "t" };
    const report = sweepUnder({
      frames: cartFrames,
      original: { cartTotal: { $eq: 100 } },
      template: { $any: [{ cartTotal: hole }, { cartTotal: hole }] },
      sweep: { t: [120] },
    });
    expect(report.points).toHaveLength(1);
    // cartTotal === 120 matches one frame (c4).
    expect(report.points[0]?.report.proposed.matched).toBe(1);
  });

  it("throws on a cyclic template", () => {
    const tmpl: Record<string, unknown> = {
      cartTotal: { $eq: { $hole: "t" } },
    };
    tmpl.self = tmpl;
    expect(() =>
      sweepUnder({
        frames: cartFrames,
        original: { cartTotal: { $gte: 100 } },
        template: tmpl,
        sweep: { t: [100] },
      }),
    ).toThrow(/contains a cycle/);
  });

  it("isolates a throwing objective", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const report = sweepUnder({
      frames: cartFrames,
      original: { cartTotal: { $gte: 100 } },
      template: { cartTotal: { $gte: { $hole: "t" } } },
      sweep: { t: [50, 100] },
      objective: () => {
        throw new Error("objective boom");
      },
    });
    expect(report.points).toHaveLength(2);
    // Every score is -Infinity (the safe fallback), bestIndex is 0.
    expect(
      report.points.every((p) => p.score === Number.NEGATIVE_INFINITY),
    ).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("objective threw"),
    );
    warnSpy.mockRestore();
  });

  it("isolates a non-finite objective return", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const report = sweepUnder({
      frames: cartFrames,
      original: { cartTotal: { $gte: 100 } },
      template: { cartTotal: { $gte: { $hole: "t" } } },
      sweep: { t: [50] },
      objective: () => Number.NaN,
    });
    expect(report.points[0]?.score).toBe(Number.NEGATIVE_INFINITY);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("enforces the aggregate MAX_SWEEP_EVALUATIONS cap", async () => {
    const { MAX_SWEEP_EVALUATIONS } = await import("../sweep-under.js");
    // 1000 points × 100k frames > 50M evaluations
    const big = Array.from({ length: 1000 }, (_, i) => i);
    const manyFrames: ReplayFrame[] = Array.from(
      { length: 100_000 },
      (_, i) => ({
        id: i,
        facts: { x: i },
      }),
    );
    expect(() =>
      sweepUnder({
        frames: manyFrames,
        original: { x: { $gte: 0 } },
        template: { x: { $gte: { $hole: "t" } } },
        sweep: { t: big },
      }),
    ).toThrow(/MAX_SWEEP_EVALUATIONS/);
    expect(MAX_SWEEP_EVALUATIONS).toBe(50_000_000);
  });
});

describe("sweepUnder — template substitution", () => {
  it("does not mutate the input template", () => {
    const template = { cartTotal: { $gte: { $hole: "t" } } };
    const before = JSON.stringify(template);
    sweepUnder({
      frames: cartFrames,
      original: { cartTotal: { $gte: 100 } },
      template,
      sweep: { t: [50, 100] },
    });
    expect(JSON.stringify(template)).toBe(before);
  });

  it("handles holes nested inside arrays", () => {
    const report = sweepUnder({
      frames: cartFrames,
      original: { cartTotal: { $eq: 100 } },
      template: { cartTotal: { $in: [{ $hole: "a" }, { $hole: "b" }] } },
      sweep: { a: [25, 50], b: [200, 350] },
    });

    expect(report.points).toHaveLength(4);
    // (a=25, b=200) → matches frames with cartTotal in {25, 200} → 2 frames.
    expect(report.points[0]?.report.proposed.matched).toBe(2);
  });

  it("treats non-hole `$`-keyed objects as predicate operators", () => {
    // `{ $hole: "t" }` is a hole; `{ $hole: "t", extra: 1 }` is NOT — it
    // has more than one key. The substituter must treat the latter as a
    // regular object (recurse into its values), not as a hole.
    const report = sweepUnder({
      frames: cartFrames,
      original: { cartTotal: { $gte: 100 } },
      template: { cartTotal: { $gte: { $hole: "t" } } },
      sweep: { t: [100] },
    });
    expect(report.points).toHaveLength(1);
    expect(report.points[0]?.report.proposed.matched).toBe(4);
  });
});

// ============================================================================
// Type-soundness sanity (compile-time only — these assertions exist to make
// sure the public API signatures don't drift)
// ============================================================================

describe("sweepUnder — API shape", () => {
  it("exposes the expected SweepReport shape", () => {
    const report = sweepUnder({
      frames: cartFrames,
      original: { cartTotal: { $gte: 100 } },
      template: { cartTotal: { $gte: { $hole: "t" } } },
      sweep: { t: [100] },
    });

    expect(report).toHaveProperty("points");
    expect(report).toHaveProperty("bestIndex");
    expect(report).toHaveProperty("best");
    expect(report).toHaveProperty("baseline");
    expect(report.best).toBe(report.points[report.bestIndex]);
  });

  it("exports MAX_SWEEP_POINTS as a public constant", () => {
    expect(MAX_SWEEP_POINTS).toBe(10_000);
  });
});
