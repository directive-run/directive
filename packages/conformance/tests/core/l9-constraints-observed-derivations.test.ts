// Ported from packages/core/src/core/__tests__/l9-constraints-observed-derivations.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { describe, expect, it } from "vitest";

// L9 (introspection): inspect().observedDerivations is an advisory cost
// counter, so this pin lives with the other observedDerivations tests rather
// than in the pinned L2 constraints file. It is the full-run killer for the
// disable-cleanup mutants in constraints.ts (773:50, 775:9, 775:15, 777:7,
// 1596:7), triaged later-layer L9.

describe("a disabled constraint", () => {
  it("no longer keeps watched the derivation it read, and does again once enabled", async () => {
    const mod = createModule("w", {
      schema: {
        facts: { n: t.number() },
        derivations: { doubled: t.number() },
        events: {},
        requirements: { R: {} },
      },
      init: (facts: any) => {
        facts.n = 0;
      },
      derive: { doubled: (facts: any) => facts.n * 2 },
      constraints: {
        reader: {
          when: (_facts: any, derived: any) => derived.doubled > 1e9,
          require: { type: "R" },
        },
      },
      resolvers: { r: { requirement: "R", resolve: async () => undefined } },
    } as never);
    const system = createSystem({ module: mod } as never) as any;
    system.start();
    await system.settle();
    expect(system.inspect().observedDerivations).toBe(1);
    system.constraints.disable("reader");
    system.facts.n = 1;
    await system.settle();
    expect(system.inspect().observedDerivations).toBe(0);
    system.constraints.enable("reader");
    system.facts.n = 2;
    await system.settle();
    expect(system.inspect().observedDerivations).toBe(1);
    system.destroy();
  });
});
