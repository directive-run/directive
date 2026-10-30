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
  formatInvalidLaterLayer,
  formatOrphanTriage,
  formatTable,
  formatUnexplained,
  gateDebt,
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
  it("fails a file whose triage entry matches no mutant (a shifted line), and lists it", () => {
    const big: ReportFile = {
      source,
      mutants: [
        ...Array.from({ length: 4 }, () => mut(3, 11, 17, "Killed")),
        mut(5, 5, 10, "Survived", "EqualityOperator", "y >= 2"),
      ],
    };
    const ok: TriageEntry = {
      line: 5,
      col: 5,
      mutator: "EqualityOperator",
      replacement: "y >= 2",
      reason: "not-observable",
    };
    // The same entry three lines down, as after a 1.35 edit above it.
    const shifted: TriageEntry = { ...ok, line: 8 };
    const s = scoreFile("a.ts", big, [ok, shifted]);
    expect(s.gateScore).toBe(80);
    expect(s.orphanTriage).toEqual([shifted]);
    expect(s.pass).toBe(false);
    expect(scoreFile("a.ts", big, [ok]).pass).toBe(true);
    expect(formatOrphanTriage([s])).toContain("a.ts:8:5 EqualityOperator");
  });

  describe("feature-layer and proxy-mechanics (GATE-1 decision 4)", () => {
    const big: ReportFile = {
      source,
      mutants: [
        ...Array.from({ length: 4 }, () => mut(3, 11, 17, "Killed")),
        mut(5, 5, 10, "Survived", "EqualityOperator", "y >= 2"),
      ],
    };
    const fe = (layer: string): TriageEntry => ({
      line: 5,
      col: 5,
      mutator: "EqualityOperator",
      replacement: "y >= 2",
      reason: "feature-layer",
      layer,
      note: "history snapshot bookkeeping",
    });

    it("defers a feature-layer mutant below its layer and counts it at or above", () => {
      const below = scoreFile("a.ts", big, [fe("L8")], undefined, 3);
      expect([below.deferred, below.survived, below.gateScore]).toEqual([
        1, 0, 100,
      ]);
      expect(below.deferredMutants[0]!.why).toBe("feature-layer");
      expect(formatDeferred([below])).toContain("(feature-layer L8)");
      const at = scoreFile("a.ts", big, [fe("L8")], undefined, 8);
      expect([at.deferred, at.survived]).toEqual([0, 1]);
      expect(at.unexplained).toHaveLength(1);
      expect(at.pass).toBe(false);
    });

    it("warns when a full-run test already kills a feature-layer mutant", () => {
      const full: ReportFile = {
        source,
        mutants: [mut(5, 5, 10, "Killed", "EqualityOperator", "y >= 2")],
      };
      const s = scoreFile("a.ts", big, [fe("L8")], full, 3);
      expect(s.killedFeatureLayer).toHaveLength(1);
      // Still deferred: the warning is a hint to make it later-layer.
      expect(s.deferred).toBe(1);
    });

    it("rejects a feature-layer entry without a layer above the row, or without a note", () => {
      expect(() => validateTriage("a.ts", [fe("L3")], 3)).toThrow(/not above/);
      expect(() =>
        validateTriage("a.ts", [{ ...fe("L8"), note: " " }], 3),
      ).toThrow(/feature-layer needs a note/);
      expect(() => validateTriage("a.ts", [fe("L8")], 3)).not.toThrow();
    });

    it("fails an excluded or deferred entry that matches two missed mutants, unless it names the end", () => {
      const twin: ReportFile = {
        source,
        mutants: [
          ...Array.from({ length: 8 }, () => mut(3, 11, 17, "Killed")),
          mut(5, 5, 10, "Survived", "EqualityOperator", "y >= 2"),
          mut(5, 5, 20, "Survived", "EqualityOperator", "y >= 2"),
        ],
      };
      const eq: TriageEntry = {
        line: 5,
        col: 5,
        mutator: "EqualityOperator",
        replacement: "y >= 2",
        reason: "equivalent",
      };
      const s = scoreFile("a.ts", twin, [eq]);
      expect(s.ambiguousTriage).toEqual([{ entry: eq, count: 2 }]);
      expect(s.pass).toBe(false);
      // Naming the end covers one mutant; the other stays unexplained.
      const one = scoreFile("a.ts", twin, [{ ...eq, endLine: 5, endCol: 10 }]);
      expect(one.ambiguousTriage).toEqual([]);
      expect([one.excluded, one.unexplained.length]).toEqual([1, 1]);
      // A counted reason may cover both: it does not change the score.
      expect(
        scoreFile("a.ts", twin, [{ ...eq, reason: "not-observable" }])
          .ambiguousTriage,
      ).toEqual([]);
    });

    it("excludes proxy-mechanics like equivalent, and requires a mechanic and a note", () => {
      const pm: TriageEntry = {
        line: 5,
        col: 5,
        mutator: "EqualityOperator",
        replacement: "y >= 2",
        reason: "proxy-mechanics",
        mechanic: "trap-result",
        note: "set trap returns true instead of false; the suite at L3 passes with it",
      };
      const s = scoreFile("a.ts", big, [pm]);
      expect([s.excluded, s.survived, s.gateScore, s.pass]).toEqual([
        1,
        0,
        100,
        true,
      ]);
      expect(() =>
        validateTriage("a.ts", [{ ...pm, mechanic: undefined }], 3),
      ).toThrow(/proxy-mechanics needs mechanic/);
      expect(() => validateTriage("a.ts", [{ ...pm, note: "" }], 3)).toThrow(
        /proxy-mechanics needs a note/,
      );
    });
  });

  describe("--gate debt, read from every triage file and the gate run", () => {
    it("owes every entry at or below the gate that the run at that ceiling does not kill", () => {
      const dir = mkdtempSync(join(tmpdir(), "mutscore-debt-"));
      const entry = (line: number, reason: string, layer: string) => ({
        line,
        col: 5,
        mutator: "EqualityOperator",
        replacement: "x >= 1",
        reason,
        layer,
        note: "feature note, killed by x",
      });
      writeFileSync(
        join(dir, "engine.json"),
        JSON.stringify([
          entry(4, "later-layer", "L4"), // killed in the L4 run: paid
          entry(5, "later-layer", "L4"), // its killer is above L4: owed
          entry(6, "feature-layer", "L4"), // not killed: owed
          entry(7, "feature-layer", "L9"), // above the gate: not checked
          entry(8, "later-layer", "L2"), // stale key: owed
        ]),
      );
      writeFileSync(
        join(dir, "absent.json"),
        JSON.stringify([entry(4, "feature-layer", "L3")]),
      );
      const m = (line: number, status: string) =>
        mut(line, 5, 10, status, "EqualityOperator", "x >= 1");
      // A run at ceiling L4: tests above L4 did not run.
      const at = new Map<string, ReportFile>([
        [
          "src/engine.ts",
          {
            source,
            mutants: [
              m(4, "Killed"),
              m(5, "Survived"),
              m(6, "NoCoverage"),
              m(7, "Survived"),
            ],
          },
        ],
      ]);
      // Twins of entry 4 (same key, another end): one kill does not pay both.
      const twin = new Map(at);
      twin.set("src/engine.ts", {
        ...at.get("src/engine.ts")!,
        mutants: [
          ...at.get("src/engine.ts")!.mutants,
          mut(4, 5, 20, "Survived", "EqualityOperator", "x >= 1"),
        ],
      });
      expect(
        gateDebt(dir, twin, 4).some(
          (d) => d.entry.line === 4 && d.file === "engine.ts",
        ),
      ).toBe(true);
      const debt = gateDebt(dir, at, 4);
      expect(debt.map((d) => `${d.file}:${d.entry.line} ${d.why}`)).toEqual([
        "absent.ts:4 file not in the L4 gate run",
        "engine.ts:5 not killed by the tests at or below L4 (Survived)",
        "engine.ts:6 not killed by the tests at or below L4 (NoCoverage)",
        "engine.ts:8 no such mutant in the L4 gate run (stale key)",
      ]);
      expect(gateDebt(dir, at, 1)).toEqual([]);
    });
  });

  it("lists unexplained survivors", () => {
    const s = scoreFile("a.ts", file, []);
    expect(formatUnexplained([s])).toContain(
      "a.ts:5:5 EqualityOperator -> y >= 2 (Survived)",
    );
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

  describe("later-layer validation against the full run", () => {
    // Ceiling run: line 4 survived, line 5 not reached below the ceiling.
    const ceilingRun: ReportFile = {
      source,
      mutants: [
        ...Array.from({ length: 4 }, () => mut(3, 11, 17, "Killed")),
        mut(4, 5, 10, "Survived", "EqualityOperator", "x >= 1"),
        mut(5, 5, 10, "NoCoverage", "EqualityOperator", "y >= 2"),
      ],
    };
    const entry = (line: number, replacement: string, note: string) =>
      ({
        line,
        col: 5,
        mutator: "EqualityOperator",
        replacement,
        reason: "later-layer",
        layer: "L4",
        note,
      }) satisfies TriageEntry;
    const note = "prev capture; killed by prev-capture.test.ts";
    const triage = [entry(4, "x >= 1", note), entry(5, "y >= 2", note)];
    const tests = {
      t1: {
        name: "prev capture restores",
        file: "tests/core/prev-capture.test.ts",
      },
    };
    const fullWith = (
      line4: string,
      line5: string,
      killedBy: string[] = ["t1"],
    ): ReportFile => ({
      source,
      tests,
      mutants: [
        ...Array.from({ length: 4 }, () => mut(3, 11, 17, "Killed")),
        { ...mut(4, 5, 10, line4, "EqualityOperator", "x >= 1"), killedBy },
        { ...mut(5, 5, 10, line5, "EqualityOperator", "y >= 2"), killedBy },
      ],
    });

    it("defers a later-layer entry the full run kills (Killed or Timeout)", () => {
      for (const status of ["Killed", "Timeout"]) {
        const s = scoreFile(
          "a.ts",
          ceilingRun,
          triage,
          fullWith(status, status),
          1,
        );
        expect([s.deferred, s.survived, s.noCoverage]).toEqual([2, 0, 0]);
        expect(s.invalidLaterLayer).toEqual([]);
        expect(s.unnamedKillers).toEqual([]);
        expect(s.pass).toBe(true);
      }
    });

    it("counts an entry the full run does not kill, and lists it", () => {
      // Survived or NoCoverage in the full run: a test reaches it (or none
      // does), but none kills it. Not deferred, not even by the full-run rule.
      for (const status of ["Survived", "NoCoverage"]) {
        const s = scoreFile(
          "a.ts",
          ceilingRun,
          triage,
          fullWith(status, status),
          1,
        );
        expect([s.deferred, s.survived, s.noCoverage]).toEqual([0, 1, 1]);
        expect(s.unexplained).toHaveLength(2);
        expect(s.pass).toBe(false);
        expect(s.invalidLaterLayer.map((i) => i.fullStatus)).toEqual([
          status,
          status,
        ]);
        const text = formatInvalidLaterLayer([s]);
        expect(text).toContain("later-layer without a full-run kill (2)");
        expect(text).toContain(
          `a.ts:4:5 EqualityOperator (later-layer L4; full run: ${status})`,
        );
        expect(text).toContain(
          `a.ts:5:5 EqualityOperator (later-layer L4; full run: ${status})`,
        );
      }
    });

    it("an invalid entry on a NoCoverage mutant is not rescued by the full-run rule", () => {
      // Without the entry the full-run rule defers a NoCoverage mutant the
      // full run reaches; with the false later-layer claim it must surface.
      const bare = scoreFile(
        "a.ts",
        ceilingRun,
        [],
        fullWith("Killed", "Survived"),
        1,
      );
      expect(bare.deferred).toBe(1);
      const claimed = scoreFile(
        "a.ts",
        ceilingRun,
        [entry(5, "y >= 2", note)],
        fullWith("Killed", "Survived"),
        1,
      );
      expect([claimed.deferred, claimed.invalidLaterLayer.length]).toEqual([
        0, 1,
      ]);
      expect(claimed.unexplained.map((m) => m.location.start.line)).toContain(
        5,
      );
    });

    it("treats an entry as invalid when the full report lacks the mutant, the file or the same source", () => {
      const missing = scoreFile(
        "a.ts",
        ceilingRun,
        triage,
        { source, mutants: [] },
        1,
      );
      expect(missing.invalidLaterLayer.map((i) => i.fullStatus)).toEqual([
        "not in the full report",
        "not in the full report",
      ]);
      // --full given but this file is not in it: scoreFile(..., undefined, 1, true).
      const noFile = scoreFile("a.ts", ceilingRun, triage, undefined, 1, true);
      expect(noFile.invalidLaterLayer).toHaveLength(2);
      expect(noFile.pass).toBe(false);
      const stale = scoreFile(
        "a.ts",
        ceilingRun,
        triage,
        { ...fullWith("Killed", "Killed"), source: `${source}\n` },
        1,
      );
      expect(stale.invalidLaterLayer.map((i) => i.fullStatus)).toEqual([
        "stale full report",
        "stale full report",
      ]);
      expect(stale.deferred).toBe(0);
    });

    it("warns, without failing, when the note names none of the killing tests", () => {
      const vague = [
        entry(4, "x >= 1", "later feature, covered elsewhere"),
        entry(5, "y >= 2", "see the Prev Capture Restores test"),
      ];
      const s = scoreFile(
        "a.ts",
        ceilingRun,
        vague,
        fullWith("Killed", "Killed"),
        1,
      );
      expect(s.pass).toBe(true);
      expect(s.deferred).toBe(2);
      expect(s.invalidLaterLayer).toEqual([]);
      // Line 4 names nothing; line 5 names the test (case-insensitive).
      expect(s.unnamedKillers.map((u) => u.mutant.location.start.line)).toEqual(
        [4],
      );
      expect(s.unnamedKillers[0]!.killers).toEqual([
        "prev capture restores [prev-capture.test.ts]",
      ]);
    });

    it("names the killer by file basename too, and cannot warn without killedBy or testFiles", () => {
      const byFile = scoreFile(
        "a.ts",
        ceilingRun,
        triage,
        fullWith("Killed", "Killed"),
        1,
      );
      expect(byFile.unnamedKillers).toEqual([]);
      const vague = [entry(4, "x >= 1", "later feature")];
      const noIds = fullWith("Killed", "Killed", []);
      expect(
        scoreFile("a.ts", ceilingRun, vague, noIds, 1).unnamedKillers,
      ).toEqual([]);
      const noTests = { ...fullWith("Killed", "Killed"), tests: undefined };
      expect(
        scoreFile("a.ts", ceilingRun, vague, noTests, 1).unnamedKillers,
      ).toEqual([]);
    });

    it("without a full report nothing is validated and behaviour is unchanged", () => {
      const s = scoreFile("a.ts", ceilingRun, triage, undefined, 1);
      expect([s.deferred, s.invalidLaterLayer, s.unnamedKillers]).toEqual([
        2,
        [],
        [],
      ]);
      expect(s.pass).toBe(true);
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

  it("--gate Ln needs --at, reads every triage file, and fails while debt for Ln is open", () => {
    const root = mkdtempSync(join(tmpdir(), "mutscore-gate-"));
    mkdirSync(join(root, "mutation-triage"));
    mkdirSync(join(root, "gate"));
    writeFileSync(
      join(root, "MUTATION.md"),
      "| Layer | Files |\n|---|---|\n| L3 | engine.ts |\n",
    );
    writeFileSync(
      join(root, "mutation-triage", "engine.json"),
      JSON.stringify([
        {
          line: 4,
          col: 5,
          mutator: "EqualityOperator",
          replacement: "x >= 1",
          reason: "feature-layer",
          layer: "L8",
          note: "history snapshot bookkeeping",
        },
      ]),
    );
    const report = (status: string) =>
      JSON.stringify({
        files: {
          "src/engine.ts": {
            source,
            mutants: [mut(4, 5, 10, status, "EqualityOperator", "x >= 1")],
          },
        },
      });
    const gate = join(root, "gate");
    // Without --at: refused, with the reason.
    const noAt = run(["--gate", "L7"], root);
    expect(noAt.code).toBe(1);
    expect(noAt.err.join(" ")).toContain("--gate Ln needs --at");
    writeFileSync(join(gate, "g.json"), report("Survived"));
    // Below the entry's layer nothing is owed yet.
    expect(run(["--gate", "L7", "--at", gate], root).code).toBe(0);
    const at8 = run(["--gate", "L8", "--at", gate], root);
    expect(at8.code).toBe(1);
    expect(at8.out).toContain("Layer gate L8: FAIL");
    expect(at8.out).toContain("engine.ts:4:5 EqualityOperator");
    // The L8 run kills it: paid.
    writeFileSync(join(gate, "g.json"), report("Killed"));
    const paid = run(["--gate", "L8", "--at", gate], root);
    expect(paid.code).toBe(0);
    expect(paid.out).toContain("Layer gate L8: every");
  });

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

  /** A full report for setup()'s facts.ts, with the line-4 mutant in `status`. */
  const writeFull = (root: string, status: string, killedBy?: string[]) => {
    const dir = join(root, "full");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "f.json"),
      JSON.stringify({
        testFiles: {
          "tests/core/prev-capture.test.ts": {
            tests: [{ id: "7", name: "prev capture restores" }],
          },
        },
        files: {
          "src/facts.ts": {
            source,
            mutants: [
              ...Array.from({ length: 4 }, () => mut(3, 11, 17, "Killed")),
              {
                ...mut(4, 5, 10, status, "EqualityOperator", "x >= 1"),
                ...(killedBy ? { killedBy } : {}),
              },
            ],
          },
        },
      }),
    );

    return dir;
  };

  it("--full: a later-layer entry the full run kills stays deferred", () => {
    const root = setup();
    const full = writeFull(root, "Killed", ["7"]);
    const r = run(["--check", "--layer", "row", "--full", full], root);
    expect(r.err).toEqual([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("facts.ts:4:5 EqualityOperator (later-layer L4)");
    expect(r.out).not.toContain("later-layer without a full-run kill");
    expect(r.out).not.toContain("WARNING");
    expect(r.out).not.toContain("unvalidated");
  });

  it("--full: a later-layer entry the full run does not kill fails the gate and is listed", () => {
    const root = setup();
    for (const status of ["Survived", "NoCoverage"]) {
      const full = writeFull(root, status);
      const r = run(["--check", "--layer", "row", "--full", full], root);
      expect(r.code).toBe(1);
      expect(r.out).toContain("later-layer without a full-run kill (1)");
      expect(r.out).toContain(
        `facts.ts:4:5 EqualityOperator (later-layer L4; full run: ${status})`,
      );
      expect(r.out).not.toContain("<details>");
    }
  });

  it("--full: a note that names no killing test warns but passes", () => {
    const root = setup("a later feature");
    const full = writeFull(root, "Killed", ["7"]);
    const r = run(["--check", "--layer", "row", "--full", full], root);
    expect(r.code).toBe(0);
    expect(r.out).toContain(
      "WARNING: later-layer note does not name a killing test (1)",
    );
    expect(r.out).toContain("prev capture restores [prev-capture.test.ts]");
  });

  it("--full: a file missing from the full report cannot vouch for its later-layer entries", () => {
    const root = setup();
    const dir = join(root, "full");
    mkdirSync(dir);
    writeFileSync(
      join(dir, "other.json"),
      JSON.stringify({ files: { "src/other.ts": { source, mutants: [] } } }),
    );
    const r = run(["--check", "--layer", "row", "--full", dir], root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("full run: not in the full report");
  });

  it("without --full: unchanged, plus a note that later-layer entries are unvalidated", () => {
    const root = setup();
    const r = run(["--check", "--layer", "row"], root);
    expect(r.code).toBe(0);
    expect(r.out).toContain("later-layer entries are unvalidated");
    expect(r.out).not.toContain("later-layer without a full-run kill");
  });
});
