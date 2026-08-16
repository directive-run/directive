/**
 * Asking a question about the system is not reading a value from it.
 *
 * `byTag` walks the derivation graph, forcing each node so its dependency edges
 * are current. Forcing goes through the same accessor a derivation body uses,
 * and that accessor records a watcher when it runs inside an observer tracking
 * frame — which is what a constraint's `when()` runs inside. On paper a
 * constraint that calls `byTag` once should acquire a dependency on every
 * derivation in the system.
 *
 * It does not, and these tests are the evidence. Both pass today. They are
 * guards, not the reproduction of a defect: a review reported the watched set
 * growing here, and four attempts to reproduce it — dynamic constraint,
 * module-declared constraint, a constraint that also reads a derivation, and a
 * with/without comparison — all measured no growth and no extra evaluations.
 *
 * Kept because the code path is real even though the symptom is not: if
 * anything downstream stops neutralising it, these go red.
 */

import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index";

function moduleWithDerivations() {
  return createModule("m", {
    schema: {
      facts: {
        gate: t.boolean(),
        email: t.string().meta({ tags: ["pii"] }),
        n: t.number(),
      },
      derivations: {
        a: t.number(),
        b: t.number(),
        c: t.number(),
        domain: t.string(),
      },
    },
    init: (facts) => {
      facts.gate = false;
      facts.email = "a@b.test";
      facts.n = 1;
    },
    derive: {
      a: (facts) => facts.n + 1,
      b: (_facts, derived) => derived.a + 1,
      c: (_facts, derived) => derived.b + 1,
      domain: (facts) => facts.email,
    },
  });
}

describe("a metadata query leaves no trace in the asker's dependencies", () => {
  it("does not put every derivation into the watched set", () => {
    const system = createSystem({ module: moduleWithDerivations() });
    system.start();

    const before = system.inspect().observedDerivations;

    system.constraints.register("asks", {
      when: () => {
        // A constraint consulting the tag registry — a redactor gate, an
        // audit rule. It reads no derivation value.
        system.meta.byTag("pii");

        return false;
      },
      require: { type: "NEVER" },
    });

    system.facts.n = 2;

    expect(system.inspect().observedDerivations).toBe(before);

    system.stop();
  });

  it("does not make the asker re-evaluate on unrelated derivation changes", () => {
    const system = createSystem({ module: moduleWithDerivations() });
    system.start();

    let evaluations = 0;
    system.constraints.register("asks", {
      when: (facts) => {
        evaluations++;
        system.meta.byTag("pii");

        return facts.gate;
      },
      require: { type: "NEVER" },
    });

    system.facts.gate = false;
    const settled = evaluations;

    // `n` feeds a, b and c — none of which this constraint reads.
    system.facts.n = 99;

    expect(evaluations).toBe(settled);

    system.stop();
  });
});
