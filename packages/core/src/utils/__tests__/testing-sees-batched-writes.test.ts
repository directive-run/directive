import { describe, expect, it } from "vitest";
import { createModule, t } from "../../index.js";
import { createTestSystem } from "../testing.js";

/**
 * The testing utilities recorded a fact change only when the write was made
 * outside a batch.
 *
 * Event handlers, effects, resolvers before their first `await`, the opening
 * state and every history navigation write through a batch — so a fact that
 * changed four times was reported as having changed once, and
 * `assertFactChanges(key, 1)` passed for it.
 *
 * That is this page's oldest shape sitting inside the tooling written to catch
 * it: an assertion that a value did not change, passing for a value that did.
 * It also contradicted the guidance added to `Plugin.onFactSet` in 1.32.0,
 * which tells plugin authors that hook does not see batched writes.
 */

function makeModule() {
  return createModule("counter", {
    schema: {
      facts: { n: t.number(), label: t.string() },
      events: { BUMP: {} },
    },
    init: (facts) => {
      facts.n = 0;
      facts.label = "start";
    },
    events: {
      BUMP: (facts) => {
        facts.n = facts.n + 1;
      },
    },
  });
}

describe("the testing utilities and batched writes", () => {
  it("counts a write an event handler made", async () => {
    const system = createTestSystem({ module: makeModule() });
    await system.start();

    system.events.BUMP();
    await system.settle();
    system.events.BUMP();
    await system.settle();

    // Two dispatches, plus the module's own `init` write, which is also
    // batched and was also invisible. Reported as none at all before this.
    system.assertFactChanges("n", 3);

    await system.stop();
  });

  it("counts a write made in an explicit batch", async () => {
    const system = createTestSystem({ module: makeModule() });
    await system.start();

    system.batch(() => {
      system.facts.n = 5;
      system.facts.label = "batched";
    });
    await system.settle();

    system.assertFactChanges("n", 2);
    system.assertFactChanges("label", 2);

    await system.stop();
  });

  it("reports the same history whether a write was batched or not", async () => {
    const unbatched = createTestSystem({ module: makeModule() });
    await unbatched.start();
    unbatched.facts.n = 7;
    await unbatched.settle();
    const loose = unbatched
      .getFactsHistory()
      .filter((change) => change.key === "n");
    await unbatched.stop();

    const batched = createTestSystem({ module: makeModule() });
    await batched.start();
    batched.batch(() => {
      batched.facts.n = 7;
    });
    await batched.settle();
    const wrapped = batched
      .getFactsHistory()
      .filter((change) => change.key === "n");
    await batched.stop();

    expect(wrapped).toHaveLength(loose.length);
    expect(wrapped[0]?.previousValue).toEqual(loose[0]?.previousValue);
    expect(wrapped[0]?.newValue).toEqual(loose[0]?.newValue);
  });

  it("keeps two modules' same-named facts apart", async () => {
    // Assertions matched the short name only, so two modules with a fact of
    // the same name shared a count — and the namespaced name that would have
    // told them apart matched nothing at all. Recording every module's opening
    // write is what made it bite: a two-module system reported a fact as having
    // changed twice before anything had run.
    const alpha = createModule("alpha", {
      schema: { facts: { v: t.number() } },
      init: (facts) => {
        facts.v = 0;
      },
    });
    const beta = createModule("beta", {
      schema: { facts: { v: t.number() } },
      init: (facts) => {
        facts.v = 0;
      },
    });
    const system = createTestSystem({ modules: { alpha, beta } });
    await system.start();

    system.facts.alpha.v = 1;
    await system.settle();

    // Two writes to alpha (its opening value and this one), one to beta.
    system.assertFactChanges("alpha::v", 2);
    system.assertFactChanges("beta::v", 1);

    await system.stop();
  });

  it("keeps the log bounded, and says when it drops anything", async () => {
    // The log holds the value before and after every change, so it pins every
    // intermediate object. Now that batched writes are recorded that is nearly
    // every write, and a handler writing in a loop retained a lot.
    const warnings: unknown[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    const system = createTestSystem({
      module: makeModule(),
      maxFactsHistory: 50,
    });
    await system.start();
    system.batch(() => {
      for (let i = 1; i <= 500; i++) {
        system.facts.n = i;
      }
    });
    await system.settle();
    console.warn = original;

    expect(system.getFactsHistory().length).toBeLessThanOrEqual(50);
    // A silently truncated log fails an exact-count assertion for a reason
    // nothing on screen explains.
    expect(warnings.length).toBeGreaterThan(0);

    await system.stop();
  });
});
