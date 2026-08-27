import { describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import { declaresPrevFacts } from "../effects.js";

/**
 * `prevFacts` is built by copying every fact in the system, once per
 * reconciliation pass, whether or not anything reads it.
 *
 * Most effects take only `facts`. They paid for the copy anyway, and the cost
 * scales with the size of the whole system rather than with the effect — which
 * is what put a hard ceiling on how many facts a system could hold before
 * reconciliation stopped fitting in a frame.
 *
 * The copy is only skipped when nothing can observe it. Detection fails toward
 * building it: an effect whose parameter list cannot be read confidently still
 * gets a real snapshot.
 */

function factsModule(count: number, effects: Record<string, unknown>) {
  const facts: Record<string, unknown> = {};
  for (let i = 0; i < count; i++) {
    facts[`f${i}`] = t.number();
  }

  return createModule("wide", {
    schema: { facts: { ...facts, trigger: t.number() } },
    init: (f: any) => {
      for (let i = 0; i < count; i++) {
        f[`f${i}`] = i;
      }
      f.trigger = 0;
    },
    effects: effects as never,
  } as never);
}

/**
 * Counts full-store copies by spying on the store's `toObject`.
 *
 * `$store` hangs off the root facts proxy for a single-module system and off
 * each namespace proxy for a composed one; both reach the same store.
 */
function countSnapshots(system: any, namespace?: string) {
  const store = namespace
    ? system.facts[namespace].$store
    : system.facts.$store;

  return vi.spyOn(store, "toObject");
}

describe("prevFacts is only built when something reads it", () => {
  it("does not copy the store when no effect declares prevFacts", async () => {
    const run = vi.fn();
    const system = createSystem({
      module: factsModule(200, {
        // One parameter: reads facts, never prevFacts.
        watch: { deps: ["trigger"], run: (facts: any) => run(facts.trigger) },
      }),
    });
    system.start();
    await system.settle();

    const spy = countSnapshots(system);

    (system.facts as any).trigger = 1;
    await system.settle();

    expect(run).toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
    system.destroy();
  });

  it("still builds it when an effect declares prevFacts", async () => {
    const seen: unknown[] = [];
    const system = createSystem({
      module: factsModule(20, {
        watch: {
          deps: ["trigger"],
          run: (_facts: any, prevFacts: any) => {
            seen.push(prevFacts?.["wide::trigger"] ?? prevFacts?.trigger);
          },
        },
      }),
    });
    system.start();
    await system.settle();

    (system.facts as any).trigger = 7;
    await system.settle();

    // The effect saw a real previous value, not undefined-because-skipped.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)).toBe(0);

    system.destroy();
  });

  it("builds it for a rest-parameter effect, which declares nothing", async () => {
    // `Function.length` is 0 here, so arity alone cannot tell this apart from
    // an effect that reads nothing. Detection has to fail toward building.
    let sawPrev: unknown;
    const system = createSystem({
      module: factsModule(10, {
        watch: {
          deps: ["trigger"],
          run: (...args: unknown[]) => {
            sawPrev = args[1];
          },
        },
      }),
    });
    system.start();
    await system.settle();

    (system.facts as any).trigger = 3;
    await system.settle();

    expect(sawPrev).toBeTypeOf("object");

    system.destroy();
  });

  it("builds it for a defaulted second parameter, which arity undercounts", async () => {
    // `(facts, prevFacts = null) => …` reports length 1, exactly like an effect
    // that only takes facts.
    let sawPrev: unknown;
    const system = createSystem({
      module: factsModule(10, {
        watch: {
          deps: ["trigger"],
          run: (_facts: any, prevFacts: any = null) => {
            sawPrev = prevFacts;
          },
        },
      }),
    });
    system.start();
    await system.settle();

    (system.facts as any).trigger = 4;
    await system.settle();

    expect(sawPrev).not.toBeNull();

    system.destroy();
  });

  it("builds it when an effect uses an `on` gate, which receives prevFacts", async () => {
    const system = createSystem({
      module: factsModule(10, {
        watch: {
          on: { trigger: { $gt: 0 } },
          run: (facts: any) => facts.trigger,
        },
      }),
    });
    system.start();
    await system.settle();

    const spy = countSnapshots(system);

    (system.facts as any).trigger = 5;
    await system.settle();

    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
    system.destroy();
  });

  it("engages for a namespaced system too, not just a single module", async () => {
    // The namespace transform wraps every effect in a three-parameter function,
    // so reading the wrapper's arity made every composed system look like a
    // reader — silently opting out exactly the systems holding the most facts.
    const a = factsModule(100, {
      watch: { deps: ["trigger"], run: (facts: any) => facts.trigger },
    });
    const system = createSystem({ modules: { a } } as never) as any;
    system.start();
    await system.settle();

    const spy = countSnapshots(system, "a");

    system.facts.a.trigger = 1;
    await system.settle();

    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
    system.destroy();
  });

  it("still gives a namespaced effect its prevFacts when it asks", async () => {
    const seen: unknown[] = [];
    const a = factsModule(10, {
      watch: {
        deps: ["trigger"],
        run: (_facts: any, prevFacts: any) => {
          seen.push(prevFacts?.trigger);
        },
      },
    });
    const system = createSystem({ modules: { a } } as never) as any;
    system.start();
    await system.settle();

    system.facts.a.trigger = 6;
    await system.settle();

    expect(seen.at(-1)).toBe(0);

    system.destroy();
  });

  it("gives an effect registered later a real prevFacts on its first run", async () => {
    // The snapshot is only refilled at the end of a pass, so an effect added
    // mid-life used to read null on its first run.
    let sawPrev: unknown = "unset";
    const system = createSystem({
      module: factsModule(10, {
        idle: { deps: ["trigger"], run: (facts: any) => facts.trigger },
      }),
    }) as any;
    system.start();
    await system.settle();

    system.facts.trigger = 1;
    await system.settle();

    system.effects.register("late", {
      deps: ["trigger"],
      run: (_facts: any, prevFacts: any) => {
        sawPrev = prevFacts;
      },
    });

    system.facts.trigger = 2;
    await system.settle();

    expect(sawPrev).not.toBeNull();
    expect(sawPrev).not.toBe("unset");

    system.destroy();
  });

  it("does not fire a later $changed gate on a fact that did not change", async () => {
    // Worse than a wrong value: the predicate runtime reads an absent previous
    // state as "everything changed", so the gate fired on a fact that was
    // untouched.
    const fired: string[] = [];
    const system = createSystem({
      module: factsModule(10, {
        idle: { deps: ["trigger"], run: (facts: any) => facts.trigger },
      }),
    }) as any;
    system.start();
    await system.settle();

    system.facts.f0 = 1;
    await system.settle();
    system.facts.trigger = 1;
    await system.settle();

    system.effects.register("gated", {
      on: { "wide::f0": { $changed: true } },
      run: () => {
        fired.push("fired");
      },
    });

    // `f0` is never touched again.
    system.facts.trigger = 9;
    await system.settle();

    expect(fired).toEqual([]);

    system.destroy();
  });

  it("does not copy the store for a module with no effects at all", async () => {
    const system = createSystem({ module: factsModule(500, {}) });
    system.start();
    await system.settle();

    const spy = countSnapshots(system);

    (system.facts as any).trigger = 2;
    await system.settle();

    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
    system.destroy();
  });
});

/**
 * The shapes above prove the behaviour end to end. These prove the decision
 * itself, across shapes that are awkward to build as real effects — and every
 * one of them is a case where getting the answer wrong would hand an effect
 * `null` where it expected a snapshot, silently.
 */
/**
 * A declaration rather than an expression, so the formatter leaves it alone —
 * an arrow function has no `arguments`, which is the whole point of the case.
 */
function readsViaArguments(_facts: unknown): unknown {
  // biome-ignore lint/style/noArguments: the case under test
  return arguments[1];
}

describe("declaresPrevFacts", () => {
  const reads = [
    ["two plain parameters", (_f: unknown, _p: unknown) => undefined],
    ["rest parameters", (..._a: unknown[]) => undefined],
    ["no parameters at all", () => undefined],
    ["reads `arguments`", readsViaArguments],
    [
      "a defaulted second parameter",
      (_f: unknown, _p: unknown = null) => undefined,
    ],
    [
      "a defaulted second parameter calling a function",
      (_f: unknown, _p = String(1)) => undefined,
    ],
    [
      "a bound function",
      ((_a: unknown, _f: unknown) => undefined).bind(null, 1),
    ],
    [
      "a Function-constructed body",
      new Function("facts", "return arguments[1]"),
    ],
    ["a non-function", undefined],
  ] as const;

  for (const [label, fn] of reads) {
    it(`says yes for ${label}`, () => {
      expect(declaresPrevFacts(fn)).toBe(true);
    });
  }

  const doesNotRead = [
    ["one plain parameter", (_f: unknown) => undefined],
    ["one parameter, no parentheses", (_f: unknown) => undefined],
    ["a destructured first parameter", ({ _a }: { _a?: unknown }) => _a],
    ["an async single-parameter effect", async (_f: unknown) => undefined],
    ["a call with two arguments in the body", (_f: unknown) => Math.max(1, 2)],
  ] as const;

  for (const [label, fn] of doesNotRead) {
    it(`says no for ${label}`, () => {
      expect(declaresPrevFacts(fn)).toBe(false);
    });
  }
});
