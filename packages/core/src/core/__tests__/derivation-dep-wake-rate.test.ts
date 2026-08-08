import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("what actually wakes a derivation-dep effect", () => {
  it("unrelated fact writes vs the derivation's own input", async () => {
    const seen: string[] = [];
    const mod = createModule("m", {
      schema: {
        facts: { n: t.number(), unrelated: t.number() },
        derivations: { doubled: t.number() },
        requirements: {},
      },
      init: (facts) => {
        facts.n = 0;
        facts.unrelated = 0;
      },
      derive: { doubled: (facts) => facts.n * 2 },
      effects: {
        watch: {
          deps: ["doubled"],
          run: (facts) => {
            seen.push(`n=${facts.n}`);
          },
        },
      },
    });
    const system = createSystem({ module: mod });
    system.start();
    await settle();
    seen.length = 0;

    // 5 writes to a fact the derivation does NOT read.
    for (let i = 1; i <= 5; i++) {
      system.facts.unrelated = i;
      await settle();
    }
    const afterUnrelated = seen.length;

    // 3 writes to the fact the derivation DOES read.
    for (let i = 1; i <= 3; i++) {
      system.facts.n = i;
      await settle();
    }
    const afterOwn = seen.length - afterUnrelated;

    // A derivation dep does NOT mean "every reconcile" — that is the
    // no-recorded-dependencies case, which is a different shape.
    expect(afterUnrelated).toBe(0);
    expect(afterOwn).toBe(3);
    system.destroy();
  });

  it("same-value writes to the derivation's input", async () => {
    const seen: number[] = [];
    const mod = createModule("m2", {
      schema: {
        facts: { n: t.number() },
        derivations: { flag: t.boolean() },
        requirements: {},
      },
      init: (facts) => {
        facts.n = 1;
      },
      derive: { flag: (facts) => facts.n > 0 },
      effects: {
        watch: {
          deps: ["flag"],
          run: () => {
            seen.push(1);
          },
        },
      },
    });
    const system = createSystem({ module: mod });
    system.start();
    await settle();
    seen.length = 0;
    // Value never changes; the derived boolean never changes either.
    for (let i = 0; i < 5; i++) {
      system.facts.n = 7;
      await settle();
    }
    // Only the first write is a change (1 -> 7); 7 -> 7 four times is not.
    // The derived boolean never moves, which is the over-firing this release
    // documents: the wake follows the input, not the derived value.
    expect(seen.length).toBe(1);
    system.destroy();
  });
});
