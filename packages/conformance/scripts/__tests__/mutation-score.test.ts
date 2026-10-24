/**
 * The mutation gate score ignores message text and demands a triage entry
 * for every remaining survivor. Pure logic, runs on a tiny fake report.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ReportFile,
  type TriageEntry,
  formatDeferred,
  formatTable,
  isMessageText,
  rowLayers,
  run,
  scoreFile,
  validateTriage,
} from "../mutation-score.js";

const source = [
  'throw new Error("bad thing");', // 1: message line
  'const a = "two words";', // 2: literal has a space
  'const b = "kind";', // 3: behavioural literal
  "if (x > 1) run();", // 4
  "if (y > 2) run();", // 5
].join("\n");

function mut(
  line: number,
  column: number,
  endColumn: number,
  status: string,
  mutatorName = "StringLiteral",
  replacement = '""',
) {
  return {
    mutatorName,
    replacement,
    status,
    location: {
      start: { line, column },
      end: { line, column: endColumn },
    },
  };
}

const file: ReportFile = {
  source,
  mutants: [
    mut(1, 17, 26, "Survived"), // message text -> ignored
    mut(2, 11, 22, "Survived"), // space in literal -> ignored
    mut(3, 11, 17, "Killed"),
    mut(4, 5, 10, "Timeout", "EqualityOperator", "x >= 1"),
    mut(5, 5, 10, "Survived", "EqualityOperator", "y >= 2"),
    mut(5, 5, 10, "Ignored", "EqualityOperator", "y < 2"), // not counted
  ],
};

describe("mutation-score", () => {
  it("flags message-text string mutants only", () => {
    expect(isMessageText(file.mutants[0]!, source)).toBe(true);
    expect(isMessageText(file.mutants[1]!, source)).toBe(true);
    expect(isMessageText(file.mutants[2]!, source)).toBe(false);
    expect(isMessageText(file.mutants[4]!, source)).toBe(false);
  });

  it("scores killed over non-ignored mutants and fails on an untriaged survivor", () => {
    const s = scoreFile("a.ts", file, []);
    expect([s.killed, s.survived, s.noCoverage, s.ignored]).toEqual([
      2, 1, 0, 2,
    ]);
    expect(s.rawScore).toBeCloseTo(40, 5);
    expect(s.gateScore).toBeCloseTo(66.666, 2);
    expect(s.pass).toBe(false);
  });

  it("passes when the gate is met and every survivor is triaged", () => {
    const big: ReportFile = {
      source,
      mutants: [
        ...Array.from({ length: 4 }, () => mut(3, 11, 17, "Killed")),
        mut(5, 5, 10, "Survived", "EqualityOperator", "y >= 2"),
      ],
    };
    expect(scoreFile("a.ts", big, []).pass).toBe(false);
    const triaged = scoreFile("a.ts", big, [
      {
        line: 5,
        col: 5,
        mutator: "EqualityOperator",
        replacement: "y >= 2",
        reason: "not-observable",
      },
    ]);
    expect(triaged.gateScore).toBe(80);
    expect(triaged.triaged).toBe(1);
    expect(triaged.pass).toBe(true);
    expect(formatTable([triaged])).toContain("PASS");
  });
  it("leaves equivalent and internals-only mutants out of the score; other triage stays in", () => {
    const entry = (reason: "equivalent" | "internals-only" | "perf-only") => ({
      line: 5,
      col: 5,
      mutator: "EqualityOperator",
      replacement: "y >= 2",
      reason,
    });
    for (const reason of ["equivalent", "internals-only"] as const) {
      const s = scoreFile("a.ts", file, [entry(reason)]);
      expect([s.killed, s.survived, s.excluded, s.triaged]).toEqual([
        2, 0, 1, 1,
      ]);
      expect(s.gateScore).toBe(100);
      expect(s.pass).toBe(true);
    }
    const kept = scoreFile("a.ts", file, [entry("perf-only")]);
    expect([kept.survived, kept.excluded, kept.triaged]).toEqual([1, 0, 1]);
    expect(kept.gateScore).toBeCloseTo(66.666, 2);
    expect(kept.pass).toBe(false);
  });

  describe("deferral against a full (no-ceiling) report", () => {
    // Ceiling run: three killed, line-4 and line-5 mutants not reached by
    // any test at or below the ceiling, one survivor.
    const ceiling: ReportFile = {
      source,
      mutants: [
        ...Array.from({ length: 3 }, () => mut(3, 11, 17, "Killed")),
        mut(4, 5, 10, "NoCoverage", "EqualityOperator", "x >= 1"),
        mut(5, 5, 10, "NoCoverage", "EqualityOperator", "y >= 2"),
        mut(5, 5, 10, "Survived", "EqualityOperator", "y < 2"),
      ],
    };
    const fullRun = (line4: string, line5: string): ReportFile => ({
      source,
      mutants: [
        ...Array.from({ length: 3 }, () => mut(3, 11, 17, "Killed")),
        mut(4, 5, 10, line4, "EqualityOperator", "x >= 1"),
        mut(5, 5, 10, line5, "EqualityOperator", "y >= 2"),
        mut(5, 5, 10, "Survived", "EqualityOperator", "y < 2"),
      ],
    });

    it("counts NoCoverage without a full report (conservative)", () => {
      const s = scoreFile("a.ts", ceiling, []);
      expect([s.killed, s.survived, s.noCoverage, s.deferred]).toEqual([
        3, 1, 2, 0,
      ]);
      expect(s.gateScore).toBe(50);
      expect(formatTable([s])).toContain("| 2 | 0 |");
    });

    it("defers NoCoverage the full run reaches, whatever it did there", () => {
      // Killed or Survived in the full run: a higher-layer test reaches it.
      for (const reached of ["Killed", "Survived", "Timeout"]) {
        const s = scoreFile("a.ts", ceiling, [], fullRun(reached, reached));
        expect([s.noCoverage, s.deferred]).toEqual([0, 2]);
        expect(s.gateScore).toBe(75);
        expect(s.unexplained).toHaveLength(1);
        expect(formatTable([s])).toContain("| 0 | 2 |");
      }
    });

    it("keeps NoCoverage the full run also leaves uncovered (genuinely untested)", () => {
      const s = scoreFile("a.ts", ceiling, [], fullRun("Killed", "NoCoverage"));
      expect([s.noCoverage, s.deferred]).toEqual([1, 1]);
      expect(s.unexplained.map((m) => m.location.start.line)).toEqual([5, 5]);
    });

    it("always counts survivors: a test at or below the ceiling reaches them", () => {
      const s = scoreFile("a.ts", ceiling, [], fullRun("Killed", "Killed"));
      expect(s.survived).toBe(1);
      expect(s.unexplained[0]!.status).toBe("Survived");
    });

    it("keeps NoCoverage the full report does not have", () => {
      const partial: ReportFile = { source, mutants: [] };
      const s = scoreFile("a.ts", ceiling, [], partial);
      expect([s.noCoverage, s.deferred]).toEqual([2, 0]);
    });

    it("defers nothing when the full report has different source", () => {
      const other = { ...fullRun("Killed", "Killed"), source: `${source}\n` };
      const s = scoreFile("a.ts", ceiling, [], other);
      expect(s.fullStale).toBe(true);
      expect([s.noCoverage, s.deferred]).toEqual([2, 0]);
      expect(formatTable([s])).toContain("| 0 (stale) |");
    });

    it("does not pass a file whose every counted mutant was deferred", () => {
      const onlyUncovered: ReportFile = {
        source,
        mutants: [mut(4, 5, 10, "NoCoverage", "EqualityOperator", "x >= 1")],
      };
      const s = scoreFile("a.ts", onlyUncovered, [], {
        source,
        mutants: [mut(4, 5, 10, "Killed", "EqualityOperator", "x >= 1")],
      });
      expect([s.deferred, s.gateScore]).toEqual([1, 100]);
      expect(s.pass).toBe(false);
    });
  });

  describe("later-layer triage", () => {
    const report: ReportFile = {
      source,
      mutants: [
        ...Array.from({ length: 4 }, () => mut(3, 11, 17, "Killed")),
        mut(4, 5, 10, "Survived", "EqualityOperator", "x >= 1"),
        mut(5, 5, 10, "NoCoverage", "EqualityOperator", "y >= 2"),
      ],
    };
    const later = (line: number, replacement: string): TriageEntry => ({
      line,
      col: 5,
      mutator: "EqualityOperator",
      replacement,
      reason: "later-layer",
      layer: "L4",
      note: "prev capture",
    });
    const triage = [later(4, "x >= 1"), later(5, "y >= 2")];

    it("defers below its layer, even a survivor", () => {
      const s = scoreFile("a.ts", report, triage, undefined, 1);
      expect([s.survived, s.noCoverage, s.deferred, s.triaged]).toEqual([
        0, 0, 2, 2,
      ]);
      expect(s.unexplained).toEqual([]);
      expect(s.gateScore).toBe(100);
      expect(s.pass).toBe(true);
    });

    it("counts as untriaged at or above its layer, or with no ceiling", () => {
      for (const ceiling of [4, 9, undefined]) {
        const s = scoreFile("a.ts", report, triage, undefined, ceiling);
        expect([s.survived, s.noCoverage, s.deferred, s.triaged]).toEqual([
          1, 1, 0, 0,
        ]);
        expect(s.unexplained).toHaveLength(2);
        expect(s.pass).toBe(false);
      }
    });

    it("rejects a missing or bad layer, and one not above the file's row", () => {
      const bad = (layer: unknown): TriageEntry[] => [
        { ...later(4, "x >= 1"), layer: layer as string },
      ];
      expect(() => validateTriage("a.ts", bad(undefined), 1)).toThrow(
        /needs layer L0\.\.L13/,
      );
      expect(() => validateTriage("a.ts", bad("L14"), 1)).toThrow(
        /needs layer/,
      );
      expect(() => validateTriage("a.ts", bad("L1"), 1)).toThrow(
        /not above the file's layer L1.*mislabelled/,
      );
      expect(() => validateTriage("a.ts", bad("L4"), undefined)).toThrow(
        /no row in MUTATION\.md/,
      );
      expect(() => validateTriage("a.ts", bad("L4"), 1)).not.toThrow();
    });

    it("requires a note naming the feature and the killing test", () => {
      for (const note of [undefined, "", "   "]) {
        expect(() =>
          validateTriage("a.ts", [{ ...later(4, "x >= 1"), note }], 1),
        ).toThrow(/needs a note naming the later feature and the test/);
      }
    });

    it("lists each deferred mutant as file:line:col mutator", () => {
      const s = scoreFile("a.ts", report, triage, undefined, 1);
      const text = formatDeferred([s]);
      expect(text).toContain("<details>");
      expect(text).toContain("a.ts:4:5 EqualityOperator (later-layer L4)");
      expect(text).toContain("a.ts:5:5 EqualityOperator (later-layer L4)");
      expect(
        formatDeferred([scoreFile("a.ts", report, [], undefined, 1)]),
      ).toBe("");
    });

    it("treats a report without source as stale: nothing deferred", () => {
      const noSource = { mutants: report.mutants } as ReportFile;
      const s = scoreFile("a.ts", report, [], noSource);
      expect(s.fullStale).toBe(true);
      expect(s.deferred).toBe(0);
      const s2 = scoreFile("a.ts", noSource, [], report);
      expect(s2.fullStale).toBe(true);
    });

    it("reads each file's row layer from the MUTATION.md table", () => {
      const rows = rowLayers(
        [
          "| Layer | Files |",
          "|---|---|",
          "| L0-L1 (Phase 1) | facts.ts, tracking.ts |",
          "| L11 | predicate.ts |",
        ].join("\n"),
      );
      expect([...rows]).toEqual([
        ["facts.ts", 1],
        ["tracking.ts", 1],
        ["predicate.ts", 11],
      ]);
    });
  });
});

describe("CLI (run)", () => {
  // facts.ts is row L1 in this MUTATION.md; its triage defers L4 code.
  const setup = (note = "prev capture; killed by prev-capture.test.ts") => {
    const root = mkdtempSync(join(tmpdir(), "mutscore-"));
    mkdirSync(join(root, "mutation-triage"));
    mkdirSync(join(root, "reports"));
    writeFileSync(
      join(root, "MUTATION.md"),
      "| Layer | Files |\n|---|---|\n| L0-L1 | facts.ts |\n",
    );
    writeFileSync(
      join(root, "mutation-triage", "facts.json"),
      JSON.stringify([
        {
          line: 4,
          col: 5,
          mutator: "EqualityOperator",
          replacement: "x >= 1",
          reason: "later-layer",
          layer: "L4",
          note,
        },
      ]),
    );
    writeFileSync(
      join(root, "reports", "r.json"),
      JSON.stringify({
        files: {
          "src/facts.ts": {
            source,
            mutants: [
              ...Array.from({ length: 4 }, () => mut(3, 11, 17, "Killed")),
              mut(4, 5, 10, "Survived", "EqualityOperator", "x >= 1"),
            ],
          },
        },
      }),
    );

    return root;
  };

  it("--layer Ln below the entry's layer defers it; at or above it counts", () => {
    const root = setup();
    const below = run(["--check", "--layer", "L1"], root);
    expect(below.err).toEqual([]);
    expect(below.code).toBe(0);
    expect(below.out).toContain("facts.ts:4:5 EqualityOperator");
    expect(below.out).toContain("Ceiling: L1.");
    for (const l of ["L4", "L9"]) {
      const at = run(["--check", "--layer", l], root);
      expect(at.code).toBe(1);
      expect(at.out).not.toContain("<details>");
    }
    expect(run(["--check"], root).code).toBe(1);
  });

  it("--layer row uses the file's MUTATION.md row (L1) as the ceiling", () => {
    const root = setup();
    const r = run(["--check", "--layer", "row"], root);
    expect(r.code).toBe(0);
    expect(r.out).toContain("each file's MUTATION.md row");
    expect(r.out).toContain("| facts.ts | 4 | 0 | 0 | 1 |");
  });

  it("rejects a later-layer entry without a note, and a bad --layer", () => {
    const root = setup("");
    const r = run(["--layer", "row"], root);
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toMatch(/needs a note/);
    expect(run(["--layer", "L99"], root).code).toBe(1);
  });
});
