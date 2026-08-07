import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
const settle = () => new Promise((r) => setTimeout(r, 0));

// `deps` is keyed on this module's own facts and derivations, so a bare
// `string` here widens past what the config accepts and takes the rest of the
// module's inference down with it.
function build(dep: "n" | "doubled") {
  const seen: number[] = [];
  const mod = createModule("m", {
    schema: {
      facts: { n: t.number() },
      derivations: { doubled: t.number() },
      requirements: {},
    },
    init: (facts) => {
      facts.n = 0;
    },
    derive: { doubled: (facts) => facts.n * 2 },
    effects: {
      watch: {
        deps: [dep],
        run: (facts) => {
          seen.push(facts.n);
        },
      },
    },
  });
  return { system: createSystem({ module: mod }), seen };
}

/**
 * Measured against the published 1.24.1 in a worktree: the fact-dep case is
 * identical there, and the derivation-dep case observes `[]` — the effect never
 * runs at all, at startup or on any later change. The `[1, 2]` below is this
 * release's change, and it is the whole of it: an effect that was inert goes to
 * running whenever the derivation may have moved.
 */
describe("startup + wake behaviour by dep kind", () => {
  it("fact dep", async () => {
    const { system, seen } = build("n");
    system.start();
    await settle();
    const atStart = [...seen];
    system.facts.n = 1;
    await settle();
    system.facts.n = 2;
    await settle();
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
    system.facts.n = 1;
    await settle();
    system.facts.n = 2;
    await settle();
    // A derivation is not among the announced startup keys, so a
    // derivation-only `deps` has nothing to match until the first fact change.
    expect(atStart).toEqual([]);
    expect(seen).toEqual([1, 2]);
    system.destroy();
  });
});
