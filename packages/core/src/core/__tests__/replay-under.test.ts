import { describe, expect, it } from "vitest";
import {
  type ReplayFrame,
  replayUnder,
} from "../replay-under.js";

/** A traffic-light history: phase + elapsed seconds. */
const HISTORY: ReplayFrame[] = [
  { id: 0, timestamp: 1000, facts: { phase: "red", elapsed: 5 } },
  { id: 1, timestamp: 2000, facts: { phase: "red", elapsed: 35 } },
  { id: 2, timestamp: 3000, facts: { phase: "green", elapsed: 10 } },
  { id: 3, timestamp: 4000, facts: { phase: "red", elapsed: 45 } },
  { id: 4, timestamp: 5000, facts: { phase: "yellow", elapsed: 2 } },
];

/** Build N frames where exactly the first `matchingOriginal` are phase "red". */
function syntheticFrames(count: number): ReplayFrame[] {
  const frames: ReplayFrame[] = [];
  for (let i = 0; i < count; i++) {
    frames.push({ id: i, facts: { phase: "red", elapsed: i } });
  }

  return frames;
}

/** The replay invariant — must hold for every report. */
function assertInvariant(report: ReturnType<typeof replayUnder>): void {
  expect(report.proposed.matched).toBe(
    report.original.matched + report.newMatchCount - report.lostMatchCount,
  );
}

describe("replayUnder", () => {
  it("counts matches under a tightening change and holds the invariant", () => {
    const report = replayUnder({
      frames: HISTORY,
      original: { phase: "red" },
      proposed: { phase: "red", elapsed: { $gte: 30 } },
    });

    // 3 red frames (0, 1, 3); proposed also needs elapsed >= 30 (1, 3).
    expect(report.framesEvaluated).toBe(5);
    expect(report.original.matched).toBe(3);
    expect(report.proposed.matched).toBe(2);
    expect(report.delta).toBe(-1);
    assertInvariant(report);
  });

  it("reports new matches when the rule is loosened", () => {
    const report = replayUnder({
      frames: HISTORY,
      // Original: only red. Proposed: red OR yellow.
      original: { phase: "red" },
      proposed: { $any: [{ phase: "red" }, { phase: "yellow" }] },
    });

    expect(report.newMatchCount).toBeGreaterThan(0);
    expect(report.newMatchCount).toBe(1); // frame 4 (yellow)
    expect(report.lostMatchCount).toBe(0);
    expect(report.newMatches).toHaveLength(1);
    expect(report.newMatches[0]!.frameId).toBe(4);
    expect(report.newMatches[0]!.timestamp).toBe(5000);
    // Explain bits carry through.
    expect(report.newMatches[0]!.originalExplain.length).toBeGreaterThan(0);
    expect(report.newMatches[0]!.proposedExplain.length).toBeGreaterThan(0);
    assertInvariant(report);
  });

  it("reports lost matches when the rule is tightened", () => {
    const report = replayUnder({
      frames: HISTORY,
      original: { phase: "red" },
      proposed: { phase: "red", elapsed: { $gte: 40 } },
    });

    // Red frames 0 (elapsed 5) and 1 (elapsed 35) lose; frame 3 (45) keeps.
    expect(report.lostMatchCount).toBe(2);
    expect(report.newMatchCount).toBe(0);
    expect(report.lostMatches).toHaveLength(2);
    expect(report.lostMatches.map((s) => s.frameId)).toEqual([0, 1]);
    assertInvariant(report);
  });

  it("holds the invariant across mixed new + lost changes", () => {
    const report = replayUnder({
      frames: HISTORY,
      // Original: red. Proposed: yellow OR (red AND elapsed >= 40).
      original: { phase: "red" },
      proposed: {
        $any: [{ phase: "yellow" }, { phase: "red", elapsed: { $gte: 40 } }],
      },
    });

    expect(report.newMatchCount).toBeGreaterThan(0);
    expect(report.lostMatchCount).toBeGreaterThan(0);
    assertInvariant(report);
  });

  it("caps samples at maxSamples while keeping full counts", () => {
    // 50 frames, all red — original never matches, proposed always matches.
    const frames = syntheticFrames(50);
    const report = replayUnder({
      frames,
      original: { phase: "green" }, // matches none
      proposed: { phase: "red" }, // matches all 50
      maxSamples: 10,
    });

    expect(report.newMatchCount).toBe(50);
    expect(report.newMatches).toHaveLength(10);
    expect(report.lostMatchCount).toBe(0);
    assertInvariant(report);
  });

  it("emits no samples when maxSamples is 0 but keeps counts", () => {
    const frames = syntheticFrames(20);
    const report = replayUnder({
      frames,
      original: { phase: "green" },
      proposed: { phase: "red" },
      maxSamples: 0,
    });

    expect(report.newMatchCount).toBe(20);
    expect(report.newMatches).toHaveLength(0);
    expect(report.lostMatches).toHaveLength(0);
    assertInvariant(report);
  });

  it("treats a negative maxSamples as 0", () => {
    const frames = syntheticFrames(8);
    const report = replayUnder({
      frames,
      original: { phase: "green" },
      proposed: { phase: "red" },
      maxSamples: -5,
    });

    expect(report.newMatchCount).toBe(8);
    expect(report.newMatches).toHaveLength(0);
  });

  it("returns a zeroed report for empty frames without throwing", () => {
    const report = replayUnder({
      frames: [],
      original: { phase: "red" },
      proposed: { phase: "green" },
    });

    expect(report.framesEvaluated).toBe(0);
    expect(report.original.matched).toBe(0);
    expect(report.proposed.matched).toBe(0);
    expect(report.delta).toBe(0);
    expect(report.newMatchCount).toBe(0);
    expect(report.lostMatchCount).toBe(0);
    expect(report.unchanged).toBe(0);
    expect(report.newMatches).toEqual([]);
    expect(report.lostMatches).toEqual([]);
    assertInvariant(report);
  });

  it("reports delta 0 and full unchanged when proposed equals original", () => {
    const spec = { phase: "red", elapsed: { $gte: 20 } };
    const report = replayUnder({
      frames: HISTORY,
      original: { ...spec },
      proposed: { ...spec },
    });

    expect(report.delta).toBe(0);
    expect(report.unchanged).toBe(report.framesEvaluated);
    expect(report.newMatchCount).toBe(0);
    expect(report.lostMatchCount).toBe(0);
    assertInvariant(report);
  });

  it("replays combinator specs ($all / $any / $not) correctly", () => {
    const allReport = replayUnder({
      frames: HISTORY,
      original: { phase: "red" },
      proposed: {
        $all: [{ phase: "red" }, { elapsed: { $gte: 30 } }],
      },
    });
    expect(allReport.proposed.matched).toBe(2); // frames 1, 3
    assertInvariant(allReport);

    const notReport = replayUnder({
      frames: HISTORY,
      original: { phase: "red" },
      proposed: { $not: { phase: "red" } },
    });
    expect(notReport.proposed.matched).toBe(2); // green + yellow
    assertInvariant(notReport);

    const anyReport = replayUnder({
      frames: HISTORY,
      original: { phase: "green" },
      proposed: { $any: [{ phase: "green" }, { phase: "yellow" }] },
    });
    expect(anyReport.proposed.matched).toBe(2);
    assertInvariant(anyReport);
  });

  it("carries correct clause pass bits in diff samples", () => {
    const report = replayUnder({
      frames: [{ id: "f1", facts: { phase: "red", elapsed: 35 } }],
      original: { phase: "green" }, // false on this frame
      proposed: { phase: "red", elapsed: { $gte: 30 } }, // true
    });

    expect(report.newMatches).toHaveLength(1);
    const sample = report.newMatches[0]!;

    // Original explain: phase $eq green — does not pass (actual is red).
    const origPhase = sample.originalExplain.find((c) => c.path === "phase");
    expect(origPhase?.pass).toBe(false);

    // Proposed explain: both clauses pass.
    const propPhase = sample.proposedExplain.find((c) => c.path === "phase");
    const propElapsed = sample.proposedExplain.find(
      (c) => c.path === "elapsed",
    );
    expect(propPhase?.pass).toBe(true);
    expect(propElapsed?.pass).toBe(true);
    expect(propElapsed?.op).toBe("$gte");
  });

  it("threads the previous frame's facts for $changed predicates", () => {
    const frames: ReplayFrame[] = [
      { id: 0, facts: { phase: "red" } },
      { id: 1, facts: { phase: "red" } }, // unchanged from frame 0
      { id: 2, facts: { phase: "green" } }, // changed
      { id: 3, facts: { phase: "green" } }, // unchanged
    ];

    const report = replayUnder({
      frames,
      original: { phase: { $exists: true } }, // matches all 4
      proposed: { phase: { $changed: true } }, // matches frame 2 only
    });

    // Frame 0 has prev=undefined: $changed compares "red" vs undefined -> true.
    // Frame 1: "red" vs "red" -> false. Frame 2: "green" vs "red" -> true.
    // Frame 3: "green" vs "green" -> false.
    expect(report.proposed.matched).toBe(2);
    assertInvariant(report);
  });
});
