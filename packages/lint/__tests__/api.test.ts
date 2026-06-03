import { describe, expect, it } from "vitest";
import {
  type Finding,
  applyFix,
  getRuleById,
  getRules,
  runRules,
} from "../src/index.js";

describe("getRules / getRuleById", () => {
  it("returns the 10 v0.2.0 rules", () => {
    const rules = getRules();
    expect(rules.length).toBe(10);
  });

  it("returns undefined for unknown ids", () => {
    expect(getRuleById("not-a-rule")).toBeUndefined();
  });

  it("round-trips every id via getRuleById", () => {
    for (const rule of getRules()) {
      expect(getRuleById(rule.id)?.id).toBe(rule.id);
    }
  });
});

describe("runRules", () => {
  it("returns empty findings for clean code", async () => {
    const result = await runRules("const x = 1;");
    expect(result.findings).toEqual([]);
    expect(result.summary).toEqual({
      error: 0,
      warning: 0,
      info: 0,
      total: 0,
    });
    expect(result.findingsByRule).toEqual({});
    expect(result.findingsBySeverity).toEqual({
      error: [],
      warning: [],
      info: [],
    });
    expect(result.unknownRules).toEqual([]);
  });

  it("populates unknownRules when ruleFilter includes unregistered ids", async () => {
    const result = await runRules("const x = 1;", {
      ruleFilter: ["not-a-rule", "also-fake"],
    });
    expect(result.unknownRules.sort()).toEqual(["also-fake", "not-a-rule"]);
  });

  it("returns empty result without unknown-rule entries when filter is empty array", async () => {
    const result = await runRules("const x = 1;", { ruleFilter: [] });
    expect(result.findings).toEqual([]);
    expect(result.unknownRules).toEqual([]);
  });
});

describe("applyFix", () => {
  const fakeFinding: Finding = {
    ruleId: "not-a-rule",
    severity: "warning",
    line: 1,
    column: 1,
    message: "test",
    findingId: "not-a-rule@1",
  };

  it("rejects unknown rule ids", async () => {
    const result = await applyFix("const x = 1;", fakeFinding);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/unknown rule/);
  });
});
