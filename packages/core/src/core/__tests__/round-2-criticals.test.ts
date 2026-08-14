/**
 * Two defects a review round found in the derivation lifecycle. Both were
 * reproduced first, both fail without the fix below them, and neither was
 * caused by the change that prompted the review.
 */

import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index";

describe("replacing a derivation definition", () => {
  it("does not leave the system waiting for quiet forever", async () => {
    const module = createModule("a", {
      schema: {
        facts: { n: t.number() },
        derivations: { doubled: t.number() },
        requirements: { NOTE: {} },
      },
      init: (facts) => {
        facts.n = 1;
      },
      derive: { doubled: (facts) => facts.n * 2 },
      constraints: {
        w: { when: (_f, d) => d.doubled > 1e9, require: { type: "NOTE" } },
      },
      resolvers: { w: { requirement: "NOTE", resolve: async () => {} } },
    });

    const system = createSystem({ module });
    system.start();
    await system.settle();
    expect(system.inspect().observedDerivations).toBe(1);

    system.derive.assign("doubled", (facts: { n: number }) => facts.n * 3);

    // Before: hung forever, because nothing scheduled a pass to drain the
    // invalidation the assign had recorded.
    const outcome = await Promise.race([
      system.settle().then(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve("hung"), 500)),
    ]);
    expect(outcome).toBe("settled");

    system.stop();
  });
});
