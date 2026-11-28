/**
 * L13b fix round 2, option B (owner, 2026-11-27: "B: one shared tracker"):
 * every system reads and writes one tracker (api/facts.ts `sharedTracker`),
 * as 1.35's module-level tracker is.
 *
 * - The first two groups are what it buys: `/adapter-utils`' selector records
 *   its reads through a copy or wrapper of a system and from a second system.
 *   They fail with a tracker per system.
 * - The third group is what must not move: two systems run interleaved keep
 *   their own dependencies, and every frame restores the one before it.
 *
 * Every expected value is 1.35's, taken from the probes (probe.mjs,
 * probe2.mjs and probe4.mjs in the slice's notes, run on packages/core/dist).
 */
import { describe, expect, it } from "vitest";
import { type SystemLike, runTrackedSelector } from "../adapter-utils.js";
import { createModule, createSystemCore } from "../api/core.js";
import { withEffects } from "../api/effects.js";
import { sharedTracker } from "../api/facts.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";
import { createScheduler } from "../scheduler.js";

type Any = any;

const tick = () => new Promise((resolve) => setTimeout(resolve, 15));

/** A started-by-the-caller system of number facts, plus whatever `rest` adds. */
const systemOf = (
  name: string,
  facts: Record<string, number>,
  rest: Record<string, unknown> = {},
  derivations: string[] = [],
): Any => {
  const schema: Any = { facts: {}, derivations: {}, requirements: { X: {} } };
  for (const key of Object.keys(facts)) {
    schema.facts[key] = t.number();
  }
  for (const key of derivations) {
    schema.derivations[key] = t.number();
  }

  return createSystem({
    module: createModule(name, {
      schema,
      init: (f: Any) => {
        for (const key of Object.keys(facts)) {
          f[key] = facts[key];
        }
      },
      ...rest,
    } as Any),
  } as Any);
};

const counter = (): Any => {
  const system = systemOf(
    "counter",
    { n: 2, other: 7 },
    { derive: { double: (f: Any) => f.n * 2 } },
    ["double"],
  );
  system.start();

  return system;
};

const select = (
  system: unknown,
  deriveKeys: string[],
  selector: (state: Any) => unknown,
) => runTrackedSelector(system as SystemLike, new Set(deriveKeys), selector);

describe("L13b shared tracker: a selector over a copy or wrapper of a system (difference 1)", () => {
  const expected = {
    value: 6,
    factKeys: ["n", "\u001Fdouble"],
    deriveKeys: ["double"],
  };
  const copies: [string, (system: Any) => unknown][] = [
    ["a spread copy", (system) => ({ ...system })],
    ["Object.create(system)", (system) => Object.create(system)],
    ["new Proxy(system, {})", (system) => new Proxy(system, {})],
    [
      "a createTestSystem-style spread with members added",
      (system) => ({ ...system, eventHistory: [], resolverCalls: new Map() }),
    ],
  ];

  for (const [name, copy] of copies) {
    it(`records the reads through ${name}`, () => {
      const system = counter();

      expect(
        select(copy(system), ["double"], (state) => state.n + state.double),
      ).toEqual(expected);
      system.destroy();
    });
  }

  it("gives an adapter keys to subscribe to, so it hears the change", () => {
    const system = counter();
    const copy = { ...system };
    const { factKeys } = select(copy, [], (state) => state.other);
    let fired = 0;
    const stop = copy.facts.$store.subscribe(factKeys, () => fired++);

    system.facts.other = 8;

    expect(factKeys).toEqual(["other"]);
    expect(fired).toBe(1);
    stop();
    system.destroy();
  });
});

describe("L13b shared tracker: a selector that reads a second system (difference 4)", () => {
  const second = (): Any => {
    const system = systemOf(
      "second",
      { y: 5 },
      { derive: { yy: (f: Any) => f.y * 2 } },
      ["yy"],
    );
    system.start();

    return system;
  };

  it("records the second system's fact and derivation with the first's", () => {
    const a = counter();
    const b = second();

    expect(select(a, [], (state) => state.other + b.facts.y)).toEqual({
      value: 12,
      factKeys: ["other", "y"],
      deriveKeys: [],
    });
    expect(select(a, [], (state) => state.other + b.derive.yy)).toEqual({
      value: 17,
      factKeys: ["other", "\u001Fyy"],
      deriveKeys: [],
    });
    expect(select(a, [], () => b.facts.y).factKeys).toEqual(["y"]);
    a.destroy();
    b.destroy();
  });

  it("keeps the read out of the second system's effect it ran inside", async () => {
    const a = counter();
    let runs = 0;
    let b: Any = null;
    b = systemOf(
      "b",
      { x: 1, y: 1 },
      {
        effects: {
          e: {
            run: (f: Any) => {
              runs++;
              f.x;
              if (b) {
                select(a, [], () => b.facts.y);
              }
            },
          },
        },
      },
    );
    b.start();
    await tick();
    const log = [runs];
    for (const write of [
      () => (b.facts.x = 2),
      () => (b.facts.y = 2),
      () => (b.facts.y = 3),
    ]) {
      write();
      await tick();
      log.push(runs);
    }

    // The first rerun (x) is the first with `b` set; the selector's read of
    // `y` stays in the selector's frame, so `y` never reruns the effect.
    expect(log).toEqual([1, 2, 2, 2]);
    a.destroy();
    b.destroy();
  });
});

describe("L13b shared tracker: two systems run interleaved keep their own frames", () => {
  it("effects that read each other rerun on their own system's writes only", async () => {
    const runs = { a: 0, b: 0 };
    let b: Any = null;
    const a = systemOf(
      "a",
      { ax: 1, shared: 1 },
      {
        effects: {
          e: {
            run: (f: Any) => {
              runs.a++;
              f.ax;
              b?.facts.by;
            },
          },
        },
      },
    );
    b = systemOf(
      "b",
      { by: 1, shared: 1 },
      {
        effects: {
          e: {
            run: (f: Any) => {
              runs.b++;
              f.by;
              a.facts.ax;
            },
          },
        },
      },
    );
    a.start();
    b.start();
    await tick();
    const log = [[runs.a, runs.b]];
    for (const write of [
      () => (a.facts.ax = 2),
      () => (b.facts.by = 2),
      () => (a.facts.shared = 2),
      () => (b.facts.shared = 2),
      () => (a.facts.ax = 3),
      () => (b.facts.by = 3),
    ]) {
      write();
      await tick();
      log.push([runs.a, runs.b]);
    }

    expect(log).toEqual([
      [1, 1],
      [2, 1],
      [2, 2],
      [2, 2],
      [2, 2],
      [3, 2],
      [3, 3],
    ]);
    expect(sharedTracker.deps).toBeNull();
    a.destroy();
    b.destroy();
  });

  it("an effect that read another system's fact reruns on its own fact of that name, as 1.35", async () => {
    let runs = 0;
    const b = systemOf("b", { k: 1 });
    const a = systemOf(
      "a",
      { ax: 1, k: 1 },
      {
        effects: {
          e: {
            run: (f: Any) => {
              runs++;
              f.ax;
              b.facts.k;
            },
          },
        },
      },
    );
    b.start();
    a.start();
    await tick();
    const log = [runs];
    for (const write of [
      () => (b.facts.k = 2),
      () => (a.facts.k = 2),
      () => (a.facts.ax = 2),
    ]) {
      write();
      await tick();
      log.push(runs);
    }

    // The effect's keys are names: `k` read from b is the key `k`, which a's
    // own `k` changes (1.35's rule; a tracker per system gave [1, 1, 1, 2]).
    expect(log).toEqual([1, 1, 2, 3]);
    a.destroy();
    b.destroy();
  });

  it("derivations that read another system keep their own dependencies", async () => {
    const computes = { a: 0, b: 0 };
    let b: Any = null;
    const a = systemOf(
      "a",
      { ax: 1 },
      {
        derive: {
          da: (f: Any) => {
            computes.a++;

            return f.ax + (b ? b.derive.db : 0);
          },
        },
      },
      ["da"],
    );
    b = systemOf(
      "b",
      { by: 10 },
      {
        derive: {
          db: (f: Any) => {
            computes.b++;

            return f.by * 2;
          },
        },
      },
      ["db"],
    );
    a.start();
    b.start();
    const first = a.read("da");
    const row = () => [b.read("db"), computes.a, computes.b];
    const log = [row()];
    b.facts.by = 20;
    await tick();
    const second = a.read("da");
    log.push(row());
    a.facts.ax = 2;
    await tick();
    const third = a.read("da");
    log.push(row());

    // a's derivation is not woken by b's write (b's facts are not a's), and
    // recomputes on its own fact; b's is not disturbed by a's frame.
    expect([first, second, third]).toEqual([Number.NaN, Number.NaN, 42]);
    expect(log).toEqual([
      [20, 1, 2],
      [40, 1, 3],
      [40, 2, 3],
    ]);
    expect(select(a, ["da"], (state) => state.da)).toEqual({
      value: 42,
      factKeys: ["\u001Fda"],
      deriveKeys: ["da"],
    });
    a.destroy();
    b.destroy();
  });

  it("constraints with tracked reads of another system re-evaluate on their own facts", async () => {
    const evals = { a: 0, b: 0 };
    const resolved: string[] = [];
    let b: Any = null;
    const make = (name: string, facts: Record<string, number>, when: Any) =>
      systemOf(name, facts, {
        constraints: { k: { when, require: { type: "X" } } },
        resolvers: {
          x: {
            requirement: "X",
            resolve: async () => {
              resolved.push(name);
            },
          },
        },
      });
    const a = make("a", { ax: 1 }, (f: Any) => {
      evals.a++;

      return f.ax > 1 && (b ? b.facts.by : 0) > 100;
    });
    b = make("b", { by: 1 }, (f: Any) => {
      evals.b++;
      a.facts.ax;

      return f.by > 1000;
    });
    a.start();
    b.start();
    await tick();
    const log = [[evals.a, evals.b]];
    for (const write of [
      () => (b.facts.by = 200),
      () => (a.facts.ax = 2),
      () => (b.facts.by = 300),
    ]) {
      write();
      await tick();
      log.push([evals.a, evals.b]);
    }

    expect(log).toEqual([
      [1, 1],
      [1, 2],
      [2, 2],
      [2, 3],
    ]);
    expect(resolved).toEqual(["a"]);
    expect(sharedTracker.deps).toBeNull();
    a.destroy();
    b.destroy();
  });

  it("a system created and started inside an effect leaves that effect's frame as it was", async () => {
    const runs = { a: 0, inner: 0 };
    const seen: boolean[] = [];
    const inners: Any[] = [];
    let a: Any = null;
    a = systemOf(
      "a",
      { ax: 1, n: 1, z: 1 },
      {
        derive: { dd: (f: Any) => f.n * 2 },
        effects: {
          e: {
            run: (f: Any) => {
              runs.a++;
              f.ax;
              const inner = systemOf(
                "inner",
                { iy: 1 },
                {
                  effects: {
                    ie: {
                      run: (g: Any) => {
                        runs.inner++;
                        g.iy;
                      },
                    },
                  },
                },
              );
              inner.start();
              inners.push(inner);
              // After the inner system's effect ran: still an effect's
              // membership test (no dependency on `dd`'s value), and `z`
              // below still lands in this effect's set.
              if (a) {
                seen.push("dd" in a.derive);
              }
              f.z;
            },
          },
        },
      },
      ["dd"],
    );
    a.start();
    await tick();
    const log = [[runs.a, runs.inner]];
    for (const write of [
      () => (a.facts.n = 2),
      () => (a.facts.z = 2),
      () => (inners[0].facts.iy = 2),
      () => (a.facts.ax = 2),
      () => (a.facts.n = 3),
    ]) {
      write();
      await tick();
      log.push([runs.a, runs.inner]);
    }

    expect(log).toEqual([
      [1, 1],
      [1, 1],
      [2, 2],
      [2, 3],
      [3, 4],
      [3, 4],
    ]);
    expect(seen).toEqual([true, true, true]);
    a.destroy();
    for (const inner of inners) {
      inner.destroy();
    }
  });

  it("an effect of another system run inside an effect body restores the outer effect's frame", async () => {
    // A system's pass normally starts on a microtask, so no effect body runs
    // inside another. A caller that owns the scheduler can flush it anywhere,
    // an effect body included: the inner system's effect then runs inside
    // the outer one, on the same tracker.
    const scheduler = createScheduler();
    const runs = { a: 0, inner: 0 };
    const order: string[] = [];
    let inner: Any;
    let a: Any = null;
    a = systemOf(
      "a",
      { ax: 1, n: 1, z: 1 },
      {
        derive: { dd: (f: Any) => f.n * 2 },
        effects: {
          e: {
            run: (f: Any) => {
              runs.a++;
              f.ax;
              if (runs.a === 1) {
                inner = createSystemCore(
                  {
                    module: createModule("inner", {
                      schema: { facts: { iy: t.number() } },
                      init: (g: Any) => {
                        g.iy = 1;
                      },
                      effects: {
                        ie: {
                          run: (g: Any) => {
                            runs.inner++;
                            g.iy;
                            order.push("inner");
                          },
                        },
                      },
                    } as Any),
                  } as never,
                  [withEffects],
                  { scheduler },
                );
                inner.start();
                scheduler.flush();
                order.push("outer");
              }
              // Still an effect's membership test: it depends on `dd` being
              // there, not on its value, so a write to `n` reruns nothing.
              "dd" in a.derive;
              f.z;
            },
          },
        },
      },
      ["dd"],
    );
    a.start();
    await tick();
    const log = [[runs.a, runs.inner]];
    for (const write of [() => (a.facts.n = 2), () => (a.facts.z = 2)]) {
      write();
      await tick();
      log.push([runs.a, runs.inner]);
    }

    expect(order).toEqual(["inner", "outer"]);
    expect(log).toEqual([
      [1, 1],
      [1, 1],
      [2, 1],
    ]);
    a.destroy();
    inner.destroy();
  });

  it("a selector over A inside B's effect gives B's effect nothing of A's", async () => {
    let runs = 0;
    const results: unknown[] = [];
    const a = systemOf(
      "a",
      { ax: 1, n: 1 },
      { derive: { dd: (f: Any) => f.n * 2 } },
      ["dd"],
    );
    a.start();
    const b = systemOf(
      "b",
      { by: 1, bz: 1 },
      {
        effects: {
          e: {
            run: (f: Any) => {
              runs++;
              f.by;
              results.push(select(a, ["dd"], (s) => s.ax + s.dd));
              f.bz;
            },
          },
        },
      },
    );
    b.start();
    await tick();
    const log = [runs];
    for (const write of [
      () => (a.facts.ax = 2),
      () => (a.facts.n = 2),
      () => (b.facts.bz = 2),
      () => (b.facts.by = 2),
    ]) {
      write();
      await tick();
      log.push(runs);
    }

    expect(log).toEqual([1, 1, 1, 2, 3]);
    expect(results[0]).toEqual({
      value: 3,
      factKeys: ["ax", "\u001Fdd"],
      deriveKeys: ["dd"],
    });
    a.destroy();
    b.destroy();
  });

  it("a selector over A inside B's derivation does not link the derivation to A", async () => {
    let computes = 0;
    let inner: unknown;
    const a = systemOf("a", { ax: 1 });
    a.start();
    const b = systemOf(
      "b",
      { by: 10 },
      {
        derive: {
          db: (f: Any) => {
            computes++;
            const result = select(a, [], (state) => state.ax);
            inner = result;

            return f.by + (result.value as number);
          },
        },
      },
      ["db"],
    );
    b.start();
    const log = [[b.read("db"), computes]];
    a.facts.ax = 2;
    await tick();
    log.push([b.read("db"), computes]);
    b.facts.by = 20;
    await tick();
    log.push([b.read("db"), computes]);

    expect(log).toEqual([
      [11, 1],
      [11, 1],
      [22, 2],
    ]);
    expect(inner).toEqual({ value: 2, factKeys: ["ax"], deriveKeys: [] });
    expect(select(b, ["db"], (state) => state.db).factKeys).toEqual([
      "\u001Fdb",
    ]);
    a.destroy();
    b.destroy();
  });

  it("a throwing selector and a throwing derivation of A restore B's effect frame", async () => {
    let runs = 0;
    let boom = false;
    const caught: string[] = [];
    const a = systemOf(
      "a",
      { ax: 1 },
      {
        derive: {
          bad: (f: Any) => {
            f.ax;
            if (boom) {
              throw new Error("dboom");
            }

            return 0;
          },
        },
      },
      ["bad"],
    );
    a.start();
    boom = true;
    a.facts.ax = 5;
    const b = systemOf(
      "b",
      { by: 1, bz: 1 },
      {
        effects: {
          e: {
            run: (f: Any) => {
              runs++;
              f.by;
              const frame = sharedTracker.deps;
              const effectFrame = sharedTracker.effect_;
              for (const selector of [
                (state: Any) => {
                  state.ax;
                  throw new RangeError("sboom");
                },
                (state: Any) => state.bad,
              ]) {
                try {
                  select(a, ["bad"], selector);
                } catch (error) {
                  caught.push((error as Error).message);
                }
                expect(sharedTracker.deps).toBe(frame);
                expect(sharedTracker.effect_).toBe(effectFrame);
              }
              f.bz;
            },
          },
        },
      },
    );
    b.start();
    await tick();
    const log = [runs];
    for (const write of [() => (b.facts.bz = 2), () => (b.facts.by = 2)]) {
      write();
      await tick();
      log.push(runs);
    }

    // `bz`, read after both throws, is still the effect's dependency.
    expect(log).toEqual([1, 2, 3]);
    expect(caught.slice(0, 2)).toEqual(["sboom", "dboom"]);
    expect(select(a, [], (state) => state.ax)).toEqual({
      value: 5,
      factKeys: ["ax"],
      deriveKeys: [],
    });
    expect(sharedTracker.deps).toBeNull();
    a.destroy();
    b.destroy();
  });
});
