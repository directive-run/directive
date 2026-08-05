import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
const settle = () => new Promise((r) => setTimeout(r, 0));

function build(dep: string) {
  const seen: number[] = [];
  const mod = createModule("m", {
    schema: {
      facts: { n: t.number() },
      derivations: { doubled: t.number() },
      requirements: {},
    },
    init: (facts) => { facts.n = 0; },
    derive: { doubled: (facts) => facts.n * 2 },
    effects: {
      watch: { deps: [dep], run: (facts) => { seen.push(facts.n); } },
    },
  });
  return { system: createSystem({ module: mod }), seen };
}

describe("startup + wake behaviour by dep kind", () => {
  it("fact dep", async () => {
    const { system, seen } = build("n");
    system.start();
    await settle();
    const atStart = [...seen];
    system.facts.n = 1; await settle();
    system.facts.n = 2; await settle();
    // Startup announces the fact keys `init` wrote, so a fact dep matches.
    expect(atStart).toEqual([0]);
    expect(seen).toEqual([0, 1, 2]);
    system.destroy();
  });

  it("derivation dep", async () => {
    const { system, seen } = build("doubled");
    system.start();
    await settle();
    const atStart = [...seen];
    system.facts.n = 1; await settle();
    system.facts.n = 2; await settle();
    // A derivation is not among the announced startup keys, so a
    // derivation-only `deps` has nothing to match until the first fact change.
    expect(atStart).toEqual([]);
    expect(seen).toEqual([1, 2]);
    system.destroy();
  });
});
