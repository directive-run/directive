/**
 * One function body, one consistency model.
 *
 * An effect's `run()` executes inside `store.batch()`. A write reaches the
 * backing map immediately, so `facts.n` reads back the value you just wrote —
 * but derivation invalidation used to wait for the batch to flush, so
 * `derived.doubled` read the value from before that same write. A constraint's
 * `when()` is not batched, so the identical code there worked. Same parameter,
 * two answers, decided by which manager you happened to be inside.
 *
 * Invalidation is now eager and only the *notification* waits, which is the
 * half that actually needs to: marking a derivation stale is cheap and
 * idempotent, while announcing it early is what would let a listener see a
 * half-written batch. The tests below hold both ends of that.
 */

import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index";

describe("reading your own write inside a batched body", () => {
  it("an effect sees its own write through derived", async () => {
    const seen: Array<{ fact: number; derived: number }> = [];

    const system = createSystem({
      module: createModule("m", {
        schema: {
          facts: { n: t.number(), go: t.boolean() },
          derivations: { doubled: t.number() },
        },
        init: (facts) => {
          facts.n = 1;
          facts.go = false;
        },
        derive: { doubled: (facts) => facts.n * 2 },
        effects: {
          bump: {
            deps: ["go"],
            run: (facts, _prev, derived) => {
              if (!facts.go) {
                return;
              }
              facts.n = 5;
              seen.push({ fact: facts.n, derived: derived.doubled });
            },
          },
        },
      }),
    });
    system.start();
    await system.settle();

    system.facts.go = true;
    await system.settle();

    // The fact always read back. The derivation now agrees with it.
    expect(seen).toEqual([{ fact: 5, derived: 10 }]);

    system.stop();
  });

  it("matches what the same code does in a constraint, which was never batched", async () => {
    // The asymmetry this closes: identical reads, different answers, decided by
    // where the code happened to live.
    const seen: number[] = [];

    const system = createSystem({
      module: createModule("m", {
        schema: {
          facts: { n: t.number() },
          derivations: { doubled: t.number() },
          requirements: { NEVER: {} },
        },
        init: (facts) => {
          facts.n = 1;
        },
        derive: { doubled: (facts) => facts.n * 2 },
        constraints: {
          watch: {
            when: (facts, derived) => {
              if (facts.n === 1) {
                facts.n = 5;
                seen.push(derived.doubled);
              }

              return false;
            },
            require: { type: "NEVER" },
          },
        },
      }),
    });
    system.start();
    await system.settle();

    expect(seen).toEqual([10]);

    system.stop();
  });

  it("still announces once, at the end, with the batch whole", async () => {
    // The half that must not become eager. A listener firing mid-batch would
    // see one fact written and the other not — which is why invalidation moved
    // and notification did not.
    const observedAtNotify: Array<{ a: number; b: number }> = [];

    const system = createSystem({
      module: createModule("m", {
        schema: {
          facts: { a: t.number(), b: t.number(), go: t.boolean() },
          derivations: { sum: t.number() },
        },
        init: (facts) => {
          facts.a = 0;
          facts.b = 0;
          facts.go = false;
        },
        derive: { sum: (facts) => facts.a + facts.b },
        effects: {
          writeBoth: {
            deps: ["go"],
            run: (facts) => {
              if (!facts.go) {
                return;
              }
              facts.a = 1;
              facts.b = 2;
            },
          },
        },
      }),
    });
    system.start();
    await system.settle();

    system.derive.sum; // observe, so the listener has something to watch
    const unsubscribe = system.subscribe(["a", "b"], () => {
      observedAtNotify.push({ a: system.facts.a, b: system.facts.b });
    });

    system.facts.go = true;
    await system.settle();

    // Never `{ a: 1, b: 0 }` — no listener saw the batch half-applied.
    for (const observation of observedAtNotify) {
      expect(observation).not.toEqual({ a: 1, b: 0 });
    }

    unsubscribe();
    system.stop();
  });
});
