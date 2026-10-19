/**
 * The mutation gate score ignores message text and demands a triage entry
 * for every remaining survivor. Pure logic, runs on a tiny fake report.
 */

import { describe, expect, it } from "vitest";
import {
  type ReportFile,
  formatTable,
  isMessageText,
  scoreFile,
} from "../scripts/mutation-score.js";

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
        reason: "equivalent",
      },
    ]);
    expect(triaged.gateScore).toBe(80);
    expect(triaged.triaged).toBe(1);
    expect(triaged.pass).toBe(true);
    expect(formatTable([triaged])).toContain("PASS");
  });
});
