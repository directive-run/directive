/**
 * Two timing rules that must not depend on how many microtasks anything
 * takes, or on whether some unrelated resolver happens to be running.
 *
 * 1. A resolver whose own write retracts its requirement completes and is
 *    never canceled, however long it waits between that write and its
 *    return, single or batched, with or without a derivation in between.
 *
 * 2. Coalescing: a pass starts on the microtask after the first write and
 *    takes every write made before it starts. A pass whose effects and
 *    constraint phase finish without awaiting completes inside that
 *    microtask, so writes separated by an `await` each get their own pass,
 *    their own effect run and, with history on, their own snapshot. Writes
 *    made in the same synchronous run share one.
 */

import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

const flushMacrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

async function ticks(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await Promise.resolve();
  }
}

async function retractingRun(options: {
  waitAfterWrite: number;
  viaDerivation: boolean;
  batched: boolean;
}) {
  let completed = 0;
  let canceled = 0;
  const mod = createModule("load", {
    schema: {
      facts: { go: t.boolean(), done: t.boolean() },
      derivations: { pending: t.boolean() },
      events: {},
      requirements: { LOAD: {} },
    },
    init: (facts: any) => {
      facts.go = false;
      facts.done = false;
    },
    derive: {
      pending: (facts: any) => facts.go && !facts.done,
    },
    constraints: {
      load: {
        when: options.viaDerivation
          ? (_facts: any, derived: any) => derived.pending
          : (facts: any) => facts.go && !facts.done,
        require: { type: "LOAD" },
      },
    },
    effects: {
      mirror: {
        run: (facts: any) => {
          void facts.done;
        },
      },
    },
    resolvers: {
      load: options.batched
        ? {
            requirement: "LOAD",
            batch: { enabled: true, windowMs: 0 },
            resolveBatch: async (_reqs: unknown, context: any) => {
              context.facts.done = true;
              await ticks(options.waitAfterWrite);
            },
          }
        : {
            requirement: "LOAD",
            resolve: async (_req: unknown, context: any) => {
              context.facts.done = true;
              await ticks(options.waitAfterWrite);
            },
          },
    },
  } as never);
  const system = createSystem({
    module: mod,
    plugins: [
      {
        name: "count",
        onResolverComplete: () => {
          completed++;
        },
        onResolverCancel: () => {
          canceled++;
        },
      },
    ],
  });
  system.start();
  await system.settle();
  (system.facts as unknown as { go: boolean }).go = true;
  await system.settle();
  await flushMacrotask();
  await flushMacrotask();
  system.destroy();

  return { completed, canceled };
}

describe("a resolver whose own write retracts its requirement", () => {
  for (const waitAfterWrite of [0, 1, 3, 10]) {
    for (const batched of [false, true]) {
      for (const viaDerivation of [false, true]) {
        it(`completes, never canceled (wait ${waitAfterWrite} microtasks${batched ? ", batched" : ""}${viaDerivation ? ", via a derivation" : ""})`, async () => {
          const result = await retractingRun({
            waitAfterWrite,
            batched,
            viaDerivation,
          });

          expect(result).toEqual({ completed: 1, canceled: 0 });
        });
      }
    }
  }

  it("is still canceled when something else retracts the requirement", async () => {
    let canceled = 0;
    let completed = 0;
    let release: () => void = () => {};
    const mod = createModule("load", {
      schema: {
        facts: { go: t.boolean(), progress: t.number() },
        derivations: {},
        events: {},
        requirements: { LOAD: {} },
      },
      init: (facts) => {
        facts.go = false;
        facts.progress = 0;
      },
      constraints: {
        load: { when: (facts) => facts.go, require: { type: "LOAD" } },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          resolve: async (_req, context) => {
            // A write the constraint does not read.
            context.facts.progress = 50;
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          },
        },
      },
    });
    const system = createSystem({
      module: mod,
      plugins: [
        {
          name: "count",
          onResolverComplete: () => {
            completed++;
          },
          onResolverCancel: () => {
            canceled++;
          },
        },
      ],
    });
    system.start();
    system.facts.go = true;
    await flushMacrotask();
    system.facts.go = false;
    await flushMacrotask();
    release();
    await flushMacrotask();
    system.destroy();

    // Canceled, as before: its write did not retract the requirement. (An
    // aborted resolver that still returns normally is also reported
    // complete; that is unchanged and not what this test is about.)
    expect(canceled).toBe(1);
    void completed;
  });
});

describe("coalescing", () => {
  async function burst(
    gap: () => Promise<void>,
    slowResolverRunning: boolean,
  ): Promise<{ effects: number; snapshots: number }> {
    let effects = 0;
    let release: () => void = () => {};
    const mod = createModule("m", {
      schema: {
        facts: { a: t.number(), b: t.number() },
        derivations: {},
        events: {},
        requirements: { R: {} },
      },
      init: (facts) => {
        facts.a = 0;
        facts.b = 0;
      },
      effects: {
        watch: {
          run: (facts) => {
            void facts.a;
            effects++;
          },
        },
      },
      constraints: {
        slow: { when: (facts) => facts.b > 0, require: { type: "R" } },
      },
      resolvers: {
        slow: {
          requirement: "R",
          resolve: () =>
            new Promise<void>((resolve) => {
              release = resolve;
            }),
        },
      },
    });
    const system = createSystem({ module: mod, history: true });
    system.start();
    await system.settle();
    if (slowResolverRunning) {
      system.facts.b = 1;
      await flushMacrotask();
    }
    effects = 0;
    const before = system.history!.snapshots.length;
    for (let i = 1; i <= 10; i++) {
      system.facts.a = i;
      await gap();
    }
    await flushMacrotask();
    const snapshots = system.history!.snapshots.length - before;
    release();
    system.destroy();

    return { effects, snapshots };
  }

  it("gives each awaited write its own pass, effect run and snapshot", async () => {
    expect(await burst(() => Promise.resolve(), false)).toEqual({
      effects: 10,
      snapshots: 10,
    });
  });

  it("does not change because an unrelated resolver is running", async () => {
    expect(await burst(() => Promise.resolve(), true)).toEqual(
      await burst(() => Promise.resolve(), false),
    );
  });

  it("does not change with how long the gap between writes is", async () => {
    expect(await burst(() => ticks(3), false)).toEqual(
      await burst(() => Promise.resolve(), false),
    );
  });

  it("gives writes in one synchronous run a single pass", async () => {
    expect(await burst(async () => {}, false)).toEqual(
      await burst(async () => {}, false),
    );
    let effects = 0;
    const mod = createModule("m", {
      schema: { facts: { a: t.number() } },
      init: (facts) => {
        facts.a = 0;
      },
      effects: {
        watch: {
          run: (facts) => {
            void facts.a;
            effects++;
          },
        },
      },
    });
    const system = createSystem({ module: mod, history: true });
    system.start();
    await system.settle();
    effects = 0;
    const before = system.history!.snapshots.length;
    for (let i = 1; i <= 10; i++) {
      system.facts.a = i;
    }
    await system.settle();

    expect(effects).toBe(1);
    expect(system.history!.snapshots.length - before).toBe(1);
    system.destroy();
  });
});
