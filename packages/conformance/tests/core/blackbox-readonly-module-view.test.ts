// Ported from packages/core/src/core/__tests__/blackbox-readonly-module-view.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// Black-box tests: the read-only view an effect reads facts through, in
// development, and how an in-place change to a nested fact is noticed. Public
// API only.

afterEach(() => {
  vi.restoreAllMocks();
});

type Setup = () => Record<string, unknown>;

/**
 * Build a system whose effect `e` reads the facts named in `read` (in that
 * order) and then runs `act` on the facts it was handed.
 */
async function probe(
  initial: Setup,
  read: string[],
  act: (facts: any, prev: any, derived: any) => unknown = () => undefined,
) {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const errors: Array<[string, Error]> = [];
  const blocked: Array<[string, string]> = [];
  const mod = createModule("m", {
    schema: {
      facts: {
        a: t.any(),
        b: t.any(),
        c: t.any(),
        tick: t.number(),
      },
      derivations: { ticked: t.number() },
    },
    init: (facts: any) => {
      const values = initial();
      facts.a = values.a ?? null;
      facts.b = values.b ?? null;
      facts.c = values.c ?? null;
      facts.tick = 0;
    },
    derive: { ticked: (facts) => facts.tick },
    effects: {
      e: {
        deps: ["tick"],
        run: (facts: any, prev: any, derived: any) => {
          for (const name of read) {
            void facts[name];
          }

          return act(facts, prev, derived);
        },
      },
    } as never,
  });
  const system = createSystem({
    module: mod,
    plugins: [
      {
        name: "spy",
        onEffectError: (id: string, error: unknown) => {
          errors.push([id, error as Error]);
        },
        onEffectWriteBlocked: (id: string, key: string) => {
          blocked.push([id, key]);
        },
      },
    ],
  } as never);
  await system.start();
  await system.settle();

  return { system: system as any, errors, blocked };
}

describe("an in-place change to a nested fact names where it happened", () => {
  it("a deep property", async () => {
    const { blocked, errors, system } = await probe(
      () => ({ a: { x: { y: { z: 1 } } } }),
      ["a"],
      (facts) => {
        facts.a.x.y.z = 2;
      },
    );

    expect(errors).toHaveLength(1);
    expect(blocked).toEqual([["e", "a.x.y.z"]]);
    await system.destroy();
  });

  it("the second of two sibling objects", async () => {
    const { blocked, system } = await probe(
      () => ({ a: { first: { p: 1 }, second: { q: 1 } } }),
      ["a"],
      (facts) => {
        facts.a.second.q = 2;
      },
    );

    expect(blocked).toEqual([["e", "a.second.q"]]);
    await system.destroy();
  });

  it("an array element, deep inside", async () => {
    const { blocked, system } = await probe(
      () => ({ a: { list: [{ n: 1 }, { n: 2 }, { n: 3 }] } }),
      ["a"],
      (facts) => {
        facts.a.list[2].n = 9;
      },
    );

    expect(blocked).toEqual([["e", "a.list.2.n"]]);
    await system.destroy();
  });

  it("an element pushed onto an array", async () => {
    const { blocked, system } = await probe(
      () => ({ a: { list: [1, 2] } }),
      ["a"],
      (facts) => {
        facts.a.list.push(3);
      },
    );

    expect(blocked).toHaveLength(1);
    expect(blocked[0]![1]).toMatch(/^a\.list/);
    await system.destroy();
  });

  it("a key added next to existing keys", async () => {
    const { blocked, system } = await probe(
      () => ({ a: { one: 1, two: 2 } }),
      ["a"],
      (facts) => {
        facts.a.three = 3;
      },
    );

    expect(blocked).toEqual([["e", "a.three"]]);
    await system.destroy();
  });

  it("a key removed from among others", async () => {
    const { blocked, system } = await probe(
      () => ({ a: { one: 1, two: 2, three: 3 } }),
      ["a"],
      (facts) => {
        delete facts.a.two;
      },
    );

    expect(blocked).toEqual([["e", "a.two"]]);
    await system.destroy();
  });

  it("the only key removed", async () => {
    const { blocked, system } = await probe(
      () => ({ a: { only: 1 } }),
      ["a"],
      (facts) => {
        delete facts.a.only;
      },
    );

    expect(blocked).toEqual([["e", "a.only"]]);
    await system.destroy();
  });

  it("one key swapped for another, so the count stays the same", async () => {
    const { blocked, system } = await probe(
      () => ({ a: { old: 1, keep: 2 } }),
      ["a"],
      (facts) => {
        delete facts.a.old;
        facts.a.fresh = 1;
      },
    );

    expect(blocked).toEqual([["e", "a.old"]]);
    await system.destroy();
  });

  it("a key that held undefined swapped for another", async () => {
    const { blocked, system } = await probe(
      () => ({ a: { gone: undefined, keep: 1 } }),
      ["a"],
      (facts) => {
        delete facts.a.gone;
        facts.a.fresh = 1;
      },
    );

    expect(blocked).toEqual([["e", "a.gone"]]);
    await system.destroy();
  });

  it("an object held under the second object key of a Map", async () => {
    const k1 = {};
    const k2 = {};
    const { blocked, system } = await probe(
      () =>
        ({
          a: new Map<object, unknown>([
            [k1, { n: 1 }],
            [k2, { n: 2 }],
          ]),
        }) as never,
      ["a"],
      (facts) => {
        for (const [key, value] of facts.a) {
          if (key === k2) {
            value.n = 3;
          }
        }
      },
    );

    expect(blocked).toEqual([["e", "a[1].value.n"]]);
    await system.destroy();
  });

  it("a getter swapped for another", async () => {
    const { blocked, system } = await probe(
      () => {
        const obj = {};
        Object.defineProperty(obj, "g", {
          get: () => 1,
          enumerable: true,
          configurable: true,
        });

        return { a: obj };
      },
      ["a"],
      (facts) => {
        Object.defineProperty(facts.a, "g", {
          get: () => 2,
          enumerable: true,
          configurable: true,
        });
      },
    );

    expect(blocked).toEqual([["e", "a.g"]]);
    await system.destroy();
  });

  it("an accessor is not run just by being read", async () => {
    let ran = 0;
    const { errors, system } = await probe(() => {
      const obj = { plain: 1 };
      Object.defineProperty(obj, "lazy", {
        get: () => {
          ran++;

          return 1;
        },
        enumerable: true,
      });

      return { a: obj };
    }, ["a"]);

    expect(errors).toEqual([]);
    expect(ran).toBe(0);
    await system.destroy();
  });

  it("the prototype replaced", async () => {
    const { blocked, errors, system } = await probe(
      () => ({ a: { x: 1 } }),
      ["a"],
      (facts) => {
        Object.setPrototypeOf(facts.a, { inherited: true });
      },
    );

    expect(errors).toHaveLength(1);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]![1]).toMatch(/^a\b/);
    await system.destroy();
  });

  it("a Date moved", async () => {
    const { blocked, system } = await probe(
      () => ({ a: { when: new Date(1000) } }),
      ["a"],
      (facts) => {
        facts.a.when.setTime(2000);
      },
    );

    expect(blocked).toEqual([["e", "a.when"]]);
    await system.destroy();
  });

  it("the first changed fact is the one named, however many changed", async () => {
    const { blocked, errors, system } = await probe(
      () => ({ a: { x: 1 }, b: { y: 1 } }),
      ["a", "b"],
      (facts) => {
        facts.b.y = 2;
        facts.a.x = 2;
      },
    );

    expect(errors).toHaveLength(1);
    expect(blocked).toEqual([["e", "a.x"]]);
    await system.destroy();
  });

  it("a change to a later fact is found when an earlier one is untouched", async () => {
    const { blocked, system } = await probe(
      () => ({ a: { x: 1 }, b: { y: 1 } }),
      ["a", "b"],
      (facts) => {
        facts.b.y = 2;
      },
    );

    expect(blocked).toEqual([["e", "b.y"]]);
    await system.destroy();
  });

  it("a change to an earlier fact is found when a later one is untouched", async () => {
    const { blocked, system } = await probe(
      () => ({ a: { x: 1 }, b: { y: 1 } }),
      ["a", "b"],
      (facts) => {
        facts.a.x = 2;
      },
    );

    expect(blocked).toEqual([["e", "a.x"]]);
    await system.destroy();
  });
});

describe("Map and Set facts", () => {
  it("a Map value under a string key", async () => {
    const { blocked, system } = await probe(
      () => ({ a: new Map<string, unknown>([["k", 1]]) }),
      ["a"],
      (facts) => {
        facts.a.set("k", 2);
      },
    );

    expect(blocked).toHaveLength(1);
    expect(blocked[0]![1]).toMatch(/^a/);
    await system.destroy();
  });

  it("a Map value under a number key", async () => {
    const { blocked, system } = await probe(
      () => ({ a: new Map<number, unknown>([[7, 1]]) }),
      ["a"],
      (facts) => {
        facts.a.set(7, 2);
      },
    );

    expect(blocked).toHaveLength(1);
    expect(blocked[0]![1]).toMatch(/^a/);
    await system.destroy();
  });

  it("a Map value under an object key names its position", async () => {
    const k1 = {};
    const k2 = {};
    const { blocked, system } = await probe(
      () =>
        ({
          a: new Map<object, unknown>([
            [k1, 1],
            [k2, 2],
          ]),
        }) as never,
      ["a"],
      (facts) => {
        for (const key of facts.a.keys()) {
          if (key === k2) {
            facts.a.set(key, 3);
          }
        }
      },
    );

    expect(blocked).toHaveLength(1);
    expect(blocked[0]![1]).toMatch(/^a/);
    await system.destroy();
  });

  it("an object held inside a Map", async () => {
    const { blocked, system } = await probe(
      () => ({
        a: new Map<string, unknown>([
          ["one", { n: 1 }],
          ["two", { n: 2 }],
        ]),
      }),
      ["a"],
      (facts) => {
        facts.a.get("two").n = 5;
      },
    );

    expect(blocked).toHaveLength(1);
    expect(blocked[0]![1]).toMatch(/^a/);
    await system.destroy();
  });

  it("a Map key replaced by another, so the size stays the same", async () => {
    const { blocked, system } = await probe(
      () => ({
        a: new Map<string, unknown>([
          ["x", 1],
          ["y", 2],
        ]),
      }),
      ["a"],
      (facts) => {
        facts.a.delete("y");
        facts.a.set("z", 2);
      },
    );

    expect(blocked).toHaveLength(1);
    expect(blocked[0]![1]).toMatch(/^a/);
    await system.destroy();
  });

  it("a Map that grew", async () => {
    const { blocked, system } = await probe(
      () => ({ a: new Map<string, unknown>([["x", 1]]) }),
      ["a"],
      (facts) => {
        facts.a.set("y", 2);
      },
    );

    expect(blocked).toHaveLength(1);
    expect(blocked[0]![1]).toMatch(/^a/);
    expect(blocked[0]![1]).toMatch(/size/);
    await system.destroy();
  });

  it("a Set element replaced by another", async () => {
    const { blocked, system } = await probe(
      () => ({ a: new Set([1, 2, 3]) }),
      ["a"],
      (facts) => {
        facts.a.delete(3);
        facts.a.add(4);
      },
    );

    expect(blocked).toHaveLength(1);
    expect(blocked[0]![1]).toMatch(/^a/);
    await system.destroy();
  });

  it("a Set of numbers or strings, left alone, raises nothing", async () => {
    const { errors, system } = await probe(
      () => ({ a: new Set([1, 2, 3]), b: new Set(["ab", "cd"]) }),
      ["a", "b"],
    );

    expect(errors).toEqual([]);
    await system.destroy();
  });

  it("a Set that shrank", async () => {
    const { blocked, system } = await probe(
      () => ({ a: new Set([1, 2]) }),
      ["a"],
      (facts) => {
        facts.a.delete(1);
      },
    );

    expect(blocked[0]![1]).toMatch(/size/);
    await system.destroy();
  });
});

describe("what reading leaves behind", () => {
  it("reading values of every kind, then changing nothing, raises nothing", async () => {
    const { errors, system } = await probe(
      () => {
        const cyclic: Record<string, unknown> = { name: "loop" };
        cyclic.self = cyclic;

        return { a: cyclic, b: { n: null, s: "x", f: () => 1, num: 4 } };
      },
      ["a", "b", "c"],
      (facts) => {
        void facts.a.self.self.name;
        void facts.c;
      },
    );

    expect(errors).toEqual([]);
    await system.destroy();
  });

  it("a null fact reads as null", async () => {
    let seen: unknown = "unset";
    const { errors, system } = await probe(
      () => ({}),
      [],
      (facts) => {
        seen = facts.a;
      },
    );

    expect(seen).toBeNull();
    expect(errors).toEqual([]);
    await system.destroy();
  });

  it("a change inside a cycle is still found, once", async () => {
    const { blocked, errors, system } = await probe(
      () => {
        const node: Record<string, unknown> = { v: 1 };
        node.me = node;

        return { a: node };
      },
      ["a"],
      (facts) => {
        facts.a.v = 2;
      },
    );

    expect(errors).toHaveLength(1);
    expect(blocked).toEqual([["e", "a.v"]]);
    await system.destroy();
  });

  it("a change is reported for its own run only", async () => {
    let first = true;
    const { errors, system, blocked } = await probe(
      () => ({ a: { x: 1 } }),
      ["a"],
      (facts) => {
        if (first) {
          first = false;
          facts.a.x = 2;
        }
      },
    );
    expect(errors).toHaveLength(1);

    system.facts.tick = 1;
    await system.settle();
    system.facts.tick = 2;
    await system.settle();

    expect(errors).toHaveLength(1);
    expect(blocked).toHaveLength(1);
    await system.destroy();
  });

  it("a fact is judged against what the run first saw, on every run", async () => {
    let runs = 0;
    const { errors, system } = await probe(
      () => ({ a: { x: 1 } }),
      ["a"],
      (facts) => {
        runs++;
        if (runs === 3) {
          facts.a.x = 99;
        }
      },
    );
    system.facts.tick = 1;
    await system.settle();
    expect(errors).toEqual([]);
    system.facts.tick = 2;
    await system.settle();

    expect(errors).toHaveLength(1);
    await system.destroy();
  });
});

describe("values too large to check are left alone", () => {
  const N = 20000;

  it("a wide object", async () => {
    const { errors, system } = await probe(
      () => {
        const obj: Record<string, number> = {};
        for (let i = 0; i < N; i++) {
          obj[`k${i}`] = i;
        }

        return { a: obj };
      },
      ["a"],
      (facts) => {
        facts.a.k5 = -1;
      },
    );

    expect(errors).toEqual([]);
    await system.destroy();
  });

  it("a long array", async () => {
    const { errors, system } = await probe(
      () => ({ a: Array.from({ length: N }, (_, i) => ({ i })) }),
      ["a"],
      (facts) => {
        facts.a[5].i = -1;
      },
    );

    expect(errors).toEqual([]);
    await system.destroy();
  });

  it("a large Map", async () => {
    const { errors, system } = await probe(
      () => ({
        a: new Map(Array.from({ length: N }, (_, i) => [`k${i}`, i])),
      }),
      ["a"],
      (facts) => {
        facts.a.set("k5", -1);
      },
    );

    expect(errors).toEqual([]);
    await system.destroy();
  });

  it("a large Set", async () => {
    const { errors, system } = await probe(
      () => ({ a: new Set(Array.from({ length: N }, (_, i) => i)) }),
      ["a"],
      (facts) => {
        facts.a.add(-1);
      },
    );

    expect(errors).toEqual([]);
    await system.destroy();
  });

  it("an object with many accessors", async () => {
    const { errors, system } = await probe(
      () => {
        const obj = {};
        for (let i = 0; i < N; i++) {
          Object.defineProperty(obj, `g${i}`, {
            get: () => i,
            enumerable: true,
            configurable: true,
          });
        }

        return { a: obj };
      },
      ["a"],
      (facts) => {
        Object.defineProperty(facts.a, "g5", {
          get: () => -1,
          enumerable: true,
          configurable: true,
        });
      },
    );

    expect(errors).toEqual([]);
    await system.destroy();
  });

  it("reading a large collection and changing nothing raises nothing", async () => {
    const { errors, system } = await probe(
      () => ({
        a: new Map(Array.from({ length: N }, (_, i) => [`k${i}`, i])),
        b: new Set(Array.from({ length: N }, (_, i) => i)),
        c: Array.from({ length: N }, (_, i) => i),
      }),
      ["a", "b", "c"],
    );

    expect(errors).toEqual([]);
    await system.destroy();
  });

  it("a large fact does not stop a small one being checked", async () => {
    const { blocked, system } = await probe(
      () => ({ a: { x: 1 }, b: Array.from({ length: N }, (_, i) => i) }),
      ["a", "b"],
      (facts) => {
        facts.a.x = 2;
      },
    );

    expect(blocked).toEqual([["e", "a.x"]]);
    await system.destroy();
  });
});

describe("the facts view itself", () => {
  it("a delete is refused and reported", async () => {
    const { blocked, system } = await probe(
      () => ({ a: 1 }),
      [],
      (facts) => {
        delete facts.a;
      },
    );

    expect(blocked).toContainEqual(["e", "a"]);
    expect(system.facts.a).toBe(1);
    await system.destroy();
  });

  it("defining a property is refused and reported", async () => {
    const { blocked, system } = await probe(
      () => ({ a: 1 }),
      [],
      (facts) => {
        Object.defineProperty(facts, "a", { value: 2 });
      },
    );

    expect(blocked).toContainEqual(["e", "a"]);
    expect(system.facts.a).toBe(1);
    await system.destroy();
  });

  it("it cannot be made non-extensible or re-prototyped", async () => {
    const out: Record<string, unknown> = {};
    const attempt = (fn: () => unknown) => {
      try {
        fn();
      } catch {
        // a throw or a quiet refusal are both fine
      }
    };
    const { blocked, system } = await probe(
      () => ({ a: 1 }),
      [],
      (facts) => {
        attempt(() => Object.preventExtensions(facts));
        attempt(() => Object.setPrototypeOf(facts, { inherited: true }));
        out.after = facts.a;
        out.inherited = (facts as any).inherited;
        attempt(() => {
          facts.a = 2;
        });
      },
    );

    expect(out.after).toBe(1);
    expect(out.inherited).toBeUndefined();
    expect(blocked.map(([, key]) => key)).toContain("a");
    expect(system.facts.a).toBe(1);
    await system.destroy();
  });

  it("it lists and tests keys like the facts do", async () => {
    const out: Record<string, unknown> = {};
    const { errors, system } = await probe(
      () => ({ a: 5 }),
      [],
      (facts) => {
        out.keys = Object.keys(facts);
        out.hasA = "a" in facts;
        out.hasNope = "nope" in facts;
        out.own = Object.hasOwn(facts, "a");
      },
    );

    expect(errors).toEqual([]);
    expect(out.keys).toEqual(expect.arrayContaining(["a", "b", "c", "tick"]));
    expect(out.hasA).toBe(true);
    expect(out.hasNope).toBe(false);
    expect(out.own).toBe(true);
    await system.destroy();
  });

  it("previous facts and derivations cannot be written, and name themselves", async () => {
    const { blocked, system } = await probe(
      () => ({}),
      [],
      (_facts, prev, derived) => {
        if (prev) {
          prev.tick = 5;
          delete prev.tick;
        }
        derived.ticked = 5;
      },
    );
    system.facts.tick = 1;
    await system.settle();

    const keys = blocked.map(([, key]) => key);
    expect(keys).toContain("derived.ticked");
    expect(keys).toContain("prevFacts.tick");
    await system.destroy();
  });

  it("a nested change in previous facts is found", async () => {
    let n = 0;
    const { blocked, system } = await probe(
      () => ({ a: { x: 1 } }),
      [],
      (_facts, prev) => {
        n++;
        if (prev && n === 2) {
          prev.a.x = 7;
        }
      },
    );
    system.facts.tick = 1;
    await system.settle();

    expect(blocked.map(([, key]) => key)).toContain("prevFacts.a.x");
    await system.destroy();
  });
});
