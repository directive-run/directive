/**
 * Test placement signals (lib/layers.ts) on a tiny in-memory test file.
 * The fixture registers its cases with `check(…)`, not the usual test
 * call, so the census does not count them as tests of this file.
 */

import { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import { layerTests } from "../../lib/layers.js";
import { staticTests } from "../../lib/tests.js";

function place(body: string) {
  const sf = new Project({ useInMemoryFileSystem: true }).createSourceFile(
    "/t/a.test.ts",
    `declare const system: any; declare const check: any;\n${body}`,
  );

  return layerTests(
    sf,
    staticTests(sf, ["check"]),
    { rule: "L0" },
    "/core/src",
    () => false,
  );
}

describe("layer placement", () => {
  it("places effect controls on system.effects at L4", () => {
    // One file per case: file-level code is reachable from every case.
    const out = {
      ...place(`check("disable", () => { system.effects.disable("a"); });`),
      ...place(
        `check("enable", () => { const e = system.effects; e.enable("a"); });`,
      ),
      ...place(
        `check("isEnabled", () => { (system.effects as any).isEnabled("a"); });`,
      ),
    };
    expect(out.disable).toMatchObject({
      layer: "L4",
      by: ["member .effects.disable"],
    });
    expect(out.enable).toMatchObject({
      layer: "L4",
      by: ["member .effects.enable"],
    });
    expect(out.isEnabled).toMatchObject({
      layer: "L4",
      by: ["member .effects.isEnabled"],
    });
  });

  it("does not raise an enable or disable on anything else", () => {
    const out = place(`
      declare const toggle: any;
      check("own helper", () => { toggle.enable(); system.facts.disable = 1; });
    `);
    expect(out["own helper"]!.layer).toBe("L0");
  });
});
