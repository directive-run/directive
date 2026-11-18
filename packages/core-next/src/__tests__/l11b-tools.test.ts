/**
 * L11b: the predicate tools (RFC rev 2, "The tools"). Ported from 1.35 with
 * their behaviour; the conformance suite carries the 187 oracle cases, this
 * file pins that every name is exported at the path 1.35 uses and that the
 * ten files work together.
 */
import { describe, expect, it } from "vitest";
import * as root from "../index.js";
import * as internals from "../internals.js";

const ROOT_NAMES = [
  "MAX_REPLAY_FRAMES",
  "MAX_SWEEP_POINTS",
  "applyPatch",
  "describePredicate",
  "diffClauses",
  "diffRules",
  "doctor",
  "evaluateKeySelector",
  "evaluatePredicate",
  "evaluatePredicateExplained",
  "evaluateTemplate",
  "extractDeps",
  "extractTemplateKeys",
  "flattenPredicate",
  "framesFromHistory",
  "framesFromSnapshots",
  "isPredicate",
  "isTemplate",
  "memoizePredicate",
  "predicateHash",
  "predicateToMongo",
  "predicateToPostgrest",
  "predicateToSQL",
  "predicateToWhere",
  "predict",
  "replayUnder",
  "sweepUnder",
  "toReplayFrames",
  "toRulesMap",
  "validatePredicate",
  "validatePredicateAgainstSchema",
] as const;

describe("L11b predicate tools", () => {
  it("exports the 31 root names and the 2 internals", () => {
    for (const name of ROOT_NAMES) {
      expect((root as Record<string, unknown>)[name], name).toBeDefined();
    }
    expect(typeof internals.hashObject).toBe("function");
    expect(typeof internals.dangerousRegex).toBe("function");
    expect(root.MAX_REPLAY_FRAMES).toBe(1_000_000);
    expect(root.MAX_SWEEP_POINTS).toBe(10_000);
  });

  it("one predicate runs everywhere: evaluate, describe, hash, compile, predict", () => {
    const spec = { phase: "red", elapsed: { $gte: 30 } };
    expect(root.evaluatePredicate(spec, { phase: "red", elapsed: 45 })).toBe(
      true,
    );
    expect(root.describePredicate(spec)).toBe(
      "phase is red AND elapsed is at least 30",
    );
    expect(root.predicateHash(spec)).toBe(
      root.predicateHash({ elapsed: { $gte: 30 }, phase: "red" }),
    );
    const sql = root.predicateToWhere(spec);
    expect(sql.params).toContain("red");
    expect(sql.where).not.toContain("red");
    expect(root.predicateToMongo(spec)).toEqual({
      phase: "red",
      elapsed: { $gte: 30 },
    });
    const result = root.predict(spec, { phase: "red", elapsed: 10 });
    expect(result.wouldFire).toBe(false);
  });

  it("validatePredicate refuses a lost RegExp; dangerousRegex flags nesting", () => {
    expect(() => root.validatePredicate({ a: { $matches: {} } })).toThrow();
    expect(internals.dangerousRegex("(a+)+")).toBe(true);
    expect(internals.dangerousRegex("^a+$")).toBe(false);
  });
});
