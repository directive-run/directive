import { describe, expect, it } from "vitest";
import {
  type AntiPattern,
  MIGRATION_SOURCES,
  clearAntiPatternCache,
  clearCompositionsCache,
  clearMigrationCache,
  getAntiPatternById,
  getAntiPatterns,
  getCompositions,
  getCompositionsFor,
  getMigrationPattern,
  getMigrationPatterns,
  getMigrationSources,
  getReverseCompositionsFor,
} from "../src/index.js";

describe("getAntiPatterns", () => {
  it("parses every numbered section from anti-patterns.md", () => {
    clearAntiPatternCache();
    const all = getAntiPatterns();
    expect(all.length).toBeGreaterThanOrEqual(15);
    expect(all.length).toBeLessThanOrEqual(25);
  });

  it("every entry has a slug id, title, severity, category, and at least one example", () => {
    for (const ap of getAntiPatterns()) {
      expect(ap.id).toMatch(/^[a-z0-9-]+$/);
      expect(ap.title.length).toBeGreaterThan(3);
      expect(["error", "warning", "info"]).toContain(ap.severity);
      expect([
        "module",
        "schema",
        "constraint",
        "resolver",
        "derivation",
        "effect",
        "naming",
        "react",
        "composition",
      ]).toContain(ap.category);
      expect(
        ap.badExample || ap.goodExample,
        `${ap.id} has neither bad nor good example`,
      ).toBeTruthy();
    }
  });

  it("entries are returned in stable numeric order", () => {
    const numbers = getAntiPatterns().map((ap) => ap.number);
    const sorted = [...numbers].sort((a, b) => a - b);
    expect(numbers).toEqual(sorted);
  });

  it("getAntiPatternById round-trips every id", () => {
    for (const ap of getAntiPatterns()) {
      const lookup = getAntiPatternById(ap.id);
      expect(lookup).toBe(ap);
    }
  });

  it("getAntiPatternById returns undefined for unknown ids", () => {
    expect(getAntiPatternById("not-a-real-anti-pattern")).toBeUndefined();
  });

  it("captures the WRONG and CORRECT examples separately when both present", () => {
    const withBoth = getAntiPatterns().filter(
      (ap): ap is AntiPattern & { badExample: string; goodExample: string } =>
        Boolean(ap.badExample && ap.goodExample),
    );
    expect(withBoth.length).toBeGreaterThan(5);
    for (const ap of withBoth) {
      expect(ap.badExample).not.toEqual(ap.goodExample);
    }
  });
});

describe("getMigrationSources / getMigrationPattern", () => {
  it("MIGRATION_SOURCES matches getMigrationSources", () => {
    expect(getMigrationSources()).toEqual(MIGRATION_SOURCES);
  });

  it("ships patterns for every declared source", () => {
    clearMigrationCache();
    const patterns = getMigrationPatterns();
    for (const id of MIGRATION_SOURCES) {
      const pattern = patterns.find((p) => p.id === id);
      expect(pattern, `missing pattern for ${id}`).toBeDefined();
      expect(pattern!.conceptMap.length).toBeGreaterThan(3);
      expect(pattern!.steps.length).toBeGreaterThan(2);
      expect(pattern!.before.length).toBeGreaterThan(20);
      expect(pattern!.after.length).toBeGreaterThan(20);
    }
  });

  it("getMigrationPattern looks up by id", () => {
    const redux = getMigrationPattern("redux");
    expect(redux?.name).toBe("Redux");
    expect(redux?.before).toContain("createSlice");
    expect(redux?.after).toContain("createModule");
  });

  it("getMigrationPattern returns undefined for unknown source", () => {
    expect(getMigrationPattern("not-a-lib")).toBeUndefined();
  });
});

describe("getCompositions / getCompositionsFor", () => {
  it("every edge is well-formed", () => {
    clearCompositionsCache();
    const all = getCompositions();
    expect(all.length).toBeGreaterThan(20);
    for (const edge of all) {
      expect(edge.from).toMatch(/^@directive-run\//);
      expect(edge.to).toMatch(/^@directive-run\//);
      expect(edge.from).not.toBe(edge.to);
      expect(edge.reason.length).toBeGreaterThan(10);
    }
  });

  it("getCompositionsFor returns outgoing edges only", () => {
    const fromQuery = getCompositionsFor("@directive-run/query");
    expect(fromQuery.length).toBeGreaterThan(0);
    for (const e of fromQuery) {
      expect(e.from).toBe("@directive-run/query");
    }
  });

  it("getReverseCompositionsFor returns incoming edges only", () => {
    const toCore = getReverseCompositionsFor("@directive-run/core");
    expect(toCore.length).toBeGreaterThan(0);
    for (const e of toCore) {
      expect(e.to).toBe("@directive-run/core");
    }
  });

  it("returns empty for unknown packages", () => {
    expect(getCompositionsFor("@directive-run/not-a-package")).toEqual([]);
    expect(getReverseCompositionsFor("@directive-run/not-a-package")).toEqual(
      [],
    );
  });

  it("populates compositions for every package in the workspace surface", () => {
    const all = getCompositions();
    const nodes = new Set<string>();
    for (const e of all) {
      nodes.add(e.from);
      nodes.add(e.to);
    }
    // Cross-check a representative subset of expected packages.
    for (const pkg of [
      "@directive-run/core",
      "@directive-run/ai",
      "@directive-run/react",
      "@directive-run/query",
      "@directive-run/mutator",
      "@directive-run/optimistic",
      "@directive-run/timeline",
      "@directive-run/mcp",
      "@directive-run/scaffold",
      "@directive-run/lint",
      "@directive-run/knowledge",
      "@directive-run/cli",
      "@directive-run/claude-plugin",
    ]) {
      expect(nodes.has(pkg), `${pkg} missing from composition graph`).toBe(
        true,
      );
    }
  });
});
