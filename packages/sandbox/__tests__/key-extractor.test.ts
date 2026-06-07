// Unit tests for the derivation key extractor (P0-DM2). The
// regression case that originally bit us: derivations declared on a
// single line `derive: { isPositive: ... }` weren't found because the
// earlier line-based scanner needed newlines between keys.

import { describe, expect, it } from "vitest";
import { extractDerivationKeys } from "../src/key-extractor.js";

describe("extractDerivationKeys", () => {
  it("returns empty when no derive/derivations block exists", () => {
    expect(
      extractDerivationKeys([
        {
          path: "src/main.ts",
          source: "export const x = 1;\n",
        },
      ]),
    ).toEqual([]);
  });

  it("finds multi-line `derive:` block keys", () => {
    const source = [
      'import { createModule } from "@directive-run/core";',
      'export const counter = createModule("counter", {',
      "  schema: { facts: { count: 0 } },",
      "  derive: {",
      "    isPositive: (facts) => facts.count > 0,",
      "    doubled: (facts) => facts.count * 2,",
      "  },",
      "});",
    ].join("\n");
    expect(extractDerivationKeys([{ path: "src/counter.ts", source }])).toEqual(
      ["isPositive", "doubled"],
    );
  });

  it("finds compact single-line `derive:` block keys (the audit regression)", () => {
    // The case that originally surfaced the bug: derivations on one
    // line with no newlines between keys. The line-based scanner
    // missed all of them.
    const source = [
      'import { createModule } from "@directive-run/core";',
      'export const counter = createModule("counter", {',
      "  schema: { facts: { count: 0 } },",
      "  derive: { isPositive: (facts) => facts.count > 0 },",
      "});",
    ].join("\n");
    expect(extractDerivationKeys([{ path: "src/counter.ts", source }])).toEqual(
      ["isPositive"],
    );
  });

  it("finds `derivations:` schema block keys", () => {
    const source = [
      "const schema = {",
      "  facts: { x: 1 },",
      "  derivations: { isReady: true, total: 0 },",
      "};",
    ].join("\n");
    expect(extractDerivationKeys([{ path: "src/x.ts", source }])).toEqual([
      "isReady",
      "total",
    ]);
  });

  it("unions across multiple files and dedupes", () => {
    const f1 = "const schema = { derive: { a: 1, b: 2 } };";
    const f2 = "const schema = { derive: { b: 2, c: 3 } };";
    expect(
      extractDerivationKeys([
        { path: "src/a.ts", source: f1 },
        { path: "src/b.ts", source: f2 },
      ]),
    ).toEqual(["a", "b", "c"]);
  });

  it("does NOT pick up nested `derive:` deeper than the matched block", () => {
    // The first `derive:` match wins; nested objects inside that
    // block's value position aren't walked.
    const source = [
      "const schema = {",
      "  derive: { top: (f) => ({ nested: f.x }) },",
      "};",
    ].join("\n");
    expect(extractDerivationKeys([{ path: "src/x.ts", source }])).toEqual([
      "top",
    ]);
  });

  it("handles quoted keys (`'isPositive': ...`)", () => {
    const source = `const schema = { derive: { 'isPositive': fn, "doubled": fn2 } };`;
    expect(extractDerivationKeys([{ path: "src/x.ts", source }])).toEqual([
      "isPositive",
      "doubled",
    ]);
  });
});
