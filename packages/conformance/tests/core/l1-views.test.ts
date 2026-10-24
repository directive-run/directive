// Ported from packages/core/src/core/__tests__/l1-views.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// Black-box tests (L0/L1): the read-only view an effect reads facts through,
// in development, and how an in-place change to a nested fact is noticed. No
// effect deps, plugins or previous facts: an effect that reads a fact is run
// when it changes. Public API only.

afterEach(() => {
  vi.restoreAllMocks();
});

type Facts = Record<string, any>;

/** In-place change reports the console received, newest last. */
function reports(spy: ReturnType<typeof vi.spyOn>): string[] {
  const out: string[] = [];
  for (const call of spy.mock.calls) {
    for (const arg of call) {
      if (arg instanceof Error && /in place/.test(arg.message)) {
        out.push(arg.message);
      }
    }
  }

  return out;
}

/**
 * A system whose effect `e` reads the named facts (in that order) and then
 * runs `act` on the facts view it was handed. Returns what was reported.
 */
async function probe(
  initial: () => Facts,
  read: string[],
  act: (facts: any) => unknown = () => undefined,
) {
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const mod = createModule("m", {
    schema: {
      facts: { a: t.any(), b: t.any(), c: t.any(), tick: t.number() },
      derivations: {},
    } as never,
    init: (facts: any) => {
      const values = initial();
      facts.a = values.a ?? null;
      facts.b = values.b ?? null;
      facts.c = values.c ?? null;
      facts.tick = 0;
    },
    events: {
      bump: (facts: any) => {
        facts.tick = facts.tick + 1;
      },
    } as never,
    effects: {
      e: {
        run: (facts: any) => {
          void facts.tick;
          for (const name of read) {
            void facts[name];
          }

          return act(facts);
        },
      },
    } as never,
  });
  const system = createSystem({ module: mod } as never) as any;
  await system.start();
  await system.settle();

  return { system, errors, found: () => reports(errors) };
}

/** The message names `path` as a whole path, not as the start of a longer one. */
function namesPath(path: string): RegExp {
  return new RegExp(`"${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[" ]`);
}

/** Run one scenario and expect exactly one report naming `path`. */
async function expectPath(
  initial: () => Facts,
  act: (facts: any) => unknown,
  path: string,
  read = ["a"],
) {
  const { system, found } = await probe(initial, read, act);
  const msgs = found();

  expect(msgs).toHaveLength(1);
  expect(msgs[0]).toMatch(namesPath(path));
  await system.destroy();
}

describe("an in-place change to a nested fact names where it happened", () => {
  it("a deep property", () =>
    expectPath(
      () => ({ a: { x: { y: { z: 1 } } } }),
      (f) => {
        f.a.x.y.z = 2;
      },
      "a.x.y.z",
    ));

  it("a property swapped for another object of the same shape", () =>
    expectPath(
      () => ({ a: { x: { y: 1 } } }),
      (f) => {
        f.a.x = { y: 1 };
      },
      "a.x",
    ));

  it("a property added", () =>
    expectPath(
      () => ({ a: { x: 1 } }),
      (f) => {
        f.a.extra = 1;
      },
      "a.extra",
    ));

  it("a property removed", () =>
    expectPath(
      () => ({ a: { x: 1, y: 2 } }),
      (f) => {
        delete f.a.x;
      },
      "a.x",
    ));

  it("one property removed and another added", () =>
    expectPath(
      () => ({ a: { p: 1, q: 2 } }),
      (f) => {
        delete f.a.p;
        f.a.r = 3;
      },
      "a.p",
    ));

  it("the second of two sibling objects", () =>
    expectPath(
      () => ({ a: { first: { p: 1 }, second: { q: 1 } } }),
      (f) => {
        f.a.second.q = 2;
      },
      "a.second.q",
    ));

  it("an array element, deep inside", () =>
    expectPath(
      () => ({ a: { list: [{ n: 1 }, { n: 2 }, { n: 3 }] } }),
      (f) => {
        f.a.list[2].n = 9;
      },
      "a.list.2.n",
    ));

  it("an element pushed onto an array", () =>
    expectPath(
      () => ({ a: { list: [1, 2, 3] } }),
      (f) => {
        f.a.list.push(4);
      },
      "a.list.3",
    ));

  it("a Date moved", () =>
    expectPath(
      () => ({ a: { when: new Date(1000) } }),
      (f) => {
        f.a.when.setTime(2000);
      },
      "a.when",
    ));

  it("a Map value replaced under a string key", () =>
    expectPath(
      () => ({ a: { m: new Map([["k", 1]]) } }),
      (f) => {
        f.a.m.set("k", 2);
      },
      'a.m.get("k")',
    ));

  it("a Map value replaced under an object key", () => {
    const k1 = { id: 1 };
    const k2 = { id: 2 };

    return expectPath(
      () => ({
        a: {
          m: new Map<object, number>([
            [k1, 1],
            [k2, 2],
          ]),
        },
      }),
      (f) => {
        f.a.m.set(k2, 5);
      },
      "a.m[1].value",
    );
  });

  it("a Map value replaced under a number key", () =>
    expectPath(
      () => ({ a: { m: new Map([[7, 1]]) } }),
      (f) => {
        f.a.m.set(7, 2);
      },
      "a.m.get(7)",
    ));

  it("a property that held undefined removed and another added", () =>
    expectPath(
      () => ({ a: { p: undefined, q: 1 } }),
      (f) => {
        delete f.a.p;
        f.a.r = 1;
      },
      "a.p",
    ));

  it("a Map entry added", () =>
    expectPath(
      () => ({ a: { m: new Map([["k", 1]]) } }),
      (f) => {
        f.a.m.set("j", 1);
      },
      "a.m",
    ));

  it("a Map entry swapped for another key", () =>
    expectPath(
      () => ({ a: { m: new Map([["k", 1]]) } }),
      (f) => {
        f.a.m.delete("k");
        f.a.m.set("j", 1);
      },
      "a.m[0]",
    ));

  it("an object held in a Map's second entry", () =>
    expectPath(
      () => ({
        a: {
          m: new Map([
            ["one", { v: 1 }],
            ["two", { v: 2 }],
          ]),
        },
      }),
      (f) => {
        f.a.m.get("two").v = 3;
      },
      'a.m.get("two").v',
    ));

  it("an object held under the second object key of a Map", () => {
    const k1 = { id: 1 };
    const k2 = { id: 2 };

    return expectPath(
      () => ({
        a: {
          m: new Map<object, { v: number }>([
            [k1, { v: 1 }],
            [k2, { v: 2 }],
          ]),
        },
      }),
      (f) => {
        f.a.m.get(k2).v = 3;
      },
      "a.m[1].value.v",
    );
  });

  it("a Set grown", () =>
    expectPath(
      () => ({ a: { s: new Set([1, 2]) } }),
      (f) => {
        f.a.s.add(3);
      },
      "a.s",
    ));

  it("a Set member swapped", () =>
    expectPath(
      () => ({ a: { s: new Set([1, 2]) } }),
      (f) => {
        f.a.s.delete(2);
        f.a.s.add(9);
      },
      "a.s[1]",
    ));

  it("a prototype changed", () =>
    expectPath(
      () => ({ a: { x: { y: 1 } } }),
      (f) => {
        Object.setPrototypeOf(f.a.x, { inherited: true });
      },
      "a.x",
    ));

  it("an object frozen", () =>
    expectPath(
      () => ({ a: { x: { y: 1 } } }),
      (f) => {
        Object.freeze(f.a.x);
      },
      "a.x",
    ));

  it("an accessor replaced", () => {
    const make = (n: number) => ({
      get: () => n,
      enumerable: true,
      configurable: true,
    });

    return expectPath(
      () => ({ a: Object.defineProperty({}, "g", make(1)) }),
      (f) => {
        Object.defineProperty(f.a, "g", make(2));
      },
      "a.g",
    );
  });

  it("a change inside a structure that refers to itself", () =>
    expectPath(
      () => {
        const node: Facts = { v: 1 };
        node.self = node;

        return { a: node };
      },
      (f) => {
        f.a.v = 2;
      },
      "a.v",
    ));

  it("a change in an object shared by two properties, named once", () =>
    expectPath(
      () => {
        const shared = { v: 1 };

        return { a: { p: shared, q: shared } };
      },
      (f) => {
        f.a.p.v = 2;
      },
      "a.p.v",
    ));

  it("the second fact read", () =>
    expectPath(
      () => ({ a: { x: 1 }, b: { y: { z: 1 } } }),
      (f) => {
        f.b.y.z = 2;
      },
      "b.y.z",
      ["a", "b"],
    ));

  it("the first change, when two facts were both changed", async () => {
    const { system, found } = await probe(
      () => ({ a: { x: 1 }, b: { y: 1 } }),
      ["a", "b"],
      (f) => {
        f.a.x = 2;
        f.b.y = 2;
      },
    );

    expect(found()).toHaveLength(1);
    expect(found()[0]).toMatch(namesPath("a.x"));
    await system.destroy();
  });

  it("the changed fact, when a later one read is untouched", async () => {
    const { system, found } = await probe(
      () => ({ a: { x: 1 }, b: { y: 1 } }),
      ["a", "b"],
      (f) => {
        f.a.x = 2;
      },
    );

    expect(found()).toHaveLength(1);
    expect(found()[0]).toMatch(namesPath("a.x"));
    await system.destroy();
  });

  it("a change made after the fact was read twice", () =>
    expectPath(
      () => ({ a: { x: 1 } }),
      (f) => {
        f.a.x = 2;
        void f.a;
      },
      "a.x",
    ));
});

describe("what is not reported", () => {
  it("reading without changing anything", async () => {
    const { system, found } = await probe(
      () => ({
        a: {
          x: { y: [1, { z: 2 }] },
          m: new Map([["k", { v: 1 }]]),
          s: new Set([1]),
          d: new Date(5),
        },
      }),
      ["a"],
      (f) => {
        const seen = [f.a.x.y[1].z, f.a.m.get("k").v, f.a.s.has(1)];

        return seen;
      },
    );

    expect(found()).toEqual([]);
    await system.destroy();
  });

  it("facts that are null, undefined or primitive", async () => {
    const { system, found, errors } = await probe(
      () => ({ a: null, b: 5, c: undefined }),
      ["a", "b", "c"],
    );

    expect(errors).not.toHaveBeenCalled();
    expect(found()).toEqual([]);
    await system.destroy();
  });

  it("a typed array written through, which is a leaf", async () => {
    const { system, found } = await probe(
      () => ({ a: new Uint8Array(4) }),
      ["a"],
      (f) => {
        f.a[0] = 1;
      },
    );

    expect(found()).toEqual([]);
    await system.destroy();
  });

  it("an already-frozen object", async () => {
    const { system, found } = await probe(
      () => ({ a: Object.freeze({ x: Object.freeze({ y: 1 }) }) }),
      ["a"],
    );

    expect(found()).toEqual([]);
    await system.destroy();
  });

  it("a value too large to check, even when changed", async () => {
    const { system, found, errors } = await probe(
      () => ({ a: { rows: Array.from({ length: 50_000 }, () => ({ n: 1 })) } }),
      ["a"],
      (f) => {
        f.a.rows[49_999].n = 2;
      },
    );

    expect(errors).not.toHaveBeenCalled();
    expect(found()).toEqual([]);
    await system.destroy();
  });

  const big: Array<[string, () => unknown, (v: any) => void]> = [
    [
      "a Map with thousands of entries",
      () => new Map(Array.from({ length: 5000 }, (_, i) => [i, i])),
      (v) => v.set(4999, -1),
    ],
    [
      "a Set with thousands of members",
      () => new Set(Array.from({ length: 5000 }, (_, i) => i)),
      (v) => v.add(-1),
    ],
    [
      "an object with thousands of properties",
      () =>
        Object.fromEntries(
          Array.from({ length: 5000 }, (_, i) => [`k${i}`, i]),
        ),
      (v) => {
        v.k4999 = -1;
      },
    ],
    [
      "an object with thousands of dates",
      () =>
        Object.fromEntries(
          Array.from({ length: 3000 }, (_, i) => [`d${i}`, new Date(i)]),
        ),
      (v) => v.d2999.setTime(-1),
    ],
    [
      "an object with thousands of accessors",
      () =>
        Object.defineProperties(
          {},
          Object.fromEntries(
            Array.from({ length: 3000 }, (_, i) => [
              `g${i}`,
              { get: () => i, enumerable: true, configurable: true },
            ]),
          ),
        ),
      (v) => {
        Object.defineProperty(v, "g2999", {
          get: () => -1,
          enumerable: true,
          configurable: true,
        });
      },
    ],
    [
      "thousands of small objects, each within bounds",
      () => ({
        rows: Array.from({ length: 1000 }, () => ({ p: 1, q: 2, r: 3 })),
      }),
      (v) => {
        v.rows[0].p = 9;
      },
    ],
  ];
  for (const [name, make, change] of big) {
    it(`${name} is left unchecked, quietly`, async () => {
      const { system, found, errors } = await probe(
        () => ({ a: make() }),
        ["a"],
        (f) => change(f.a),
      );

      expect(errors).not.toHaveBeenCalled();
      expect(found()).toEqual([]);
      await system.destroy();
    });
  }

  it("a later run is still bounded the same way", async () => {
    let runs = 0;
    const { system, errors, found } = await probe(
      () => ({
        a: { rows: Array.from({ length: 1000 }, () => ({ p: 1, q: 2 })) },
      }),
      ["a"],
      (f) => {
        runs++;
        if (runs === 2) {
          f.a.rows[0].p = 9;
        }
      },
    );
    system.events.bump();
    await system.settle();

    expect(runs).toBe(2);
    expect(errors).not.toHaveBeenCalled();
    expect(found()).toEqual([]);
    await system.destroy();
  });

  it("an unchecked large fact does not hide a change in the next one", async () => {
    const { system, found } = await probe(
      () => ({
        a: Array.from({ length: 50_000 }, () => ({ n: 1 })),
        b: { y: 1 },
      }),
      ["b", "a"],
      (f) => {
        f.b.y = 2;
      },
    );

    expect(found()).toHaveLength(1);
    expect(found()[0]).toMatch(namesPath("b.y"));
    await system.destroy();
  });

  it("a getter is recorded without being run", async () => {
    let runs = 0;
    const holder = Object.defineProperty({}, "g", {
      get: () => {
        runs++;

        return 1;
      },
      enumerable: true,
    });
    const { system, found } = await probe(() => ({ a: holder }), ["a"]);

    expect(found()).toEqual([]);
    expect(runs).toBe(0);
    await system.destroy();
  });

  it("an effect handed the stored object itself", async () => {
    const stored = { x: 1 };
    let handed: unknown;
    const { system } = await probe(
      () => ({ a: stored }),
      ["a"],
      (f) => {
        handed = f.a;
      },
    );

    expect(handed).toBe(stored);
    await system.destroy();
  });
});

describe("a change is reported once, then the check starts over", () => {
  it("a second run that changes nothing reports nothing", async () => {
    let runs = 0;
    const { system, errors, found } = await probe(
      () => ({ a: { x: 1 } }),
      ["a"],
      (f) => {
        runs++;
        if (runs === 1) {
          f.a.x = 2;
        }
      },
    );

    expect(found()).toHaveLength(1);
    system.events.bump();
    await system.settle();

    expect(runs).toBe(2);
    expect(reports(errors)).toHaveLength(1);
    await system.destroy();
  });

  it("a later run that changes something else reports that", async () => {
    let runs = 0;
    const { system, errors } = await probe(
      () => ({ a: { x: 1, y: 1 } }),
      ["a"],
      (f) => {
        runs++;
        if (runs === 1) {
          f.a.x = 2;
        } else {
          f.a.y = 2;
        }
      },
    );

    system.events.bump();
    await system.settle();

    const msgs = reports(errors);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatch(namesPath("a.x"));
    expect(msgs[1]).toMatch(namesPath("a.y"));
    await system.destroy();
  });
});

describe("a top-level change through the facts an effect is handed", () => {
  const attempts: Array<[string, (f: any) => unknown, string]> = [
    ["an assignment", (f) => void (f.a = 5), '"a"'],
    ["a delete", (f) => void delete f.a, '"a"'],
    [
      "a property definition",
      (f) => Object.defineProperty(f, "a", { value: 5 }),
      '"a"',
    ],
    [
      "preventing extensions",
      (f) => Object.preventExtensions(f),
      "preventExtensions",
    ],
    [
      "a prototype change",
      (f) => Object.setPrototypeOf(f, {}),
      "setPrototypeOf",
    ],
  ];
  for (const [name, attempt, named] of attempts) {
    it(`${name} is refused, names what was attempted, and changes nothing`, async () => {
      const { system, errors } = await probe(
        () => ({ a: { x: 1 } }),
        ["a"],
        (f) => attempt(f),
      );

      expect(errors).toHaveBeenCalledTimes(1);
      const thrown = errors.mock.calls[0]!.find((arg) => arg instanceof Error);
      expect((thrown as Error).message).toContain(named);
      expect((thrown as Error).message).toContain('"e"');
      expect(system.facts.a).toEqual({ x: 1 });
      await system.destroy();
    });
  }
});

describe("the facts object an effect is handed", () => {
  it("lists and describes only the real facts, with no prototype", async () => {
    const seen: Facts = {};
    const { system } = await probe(
      () => ({ a: { x: 1 } }),
      ["a"],
      (f) => {
        seen.keys = Object.keys(f).sort();
        seen.missing = Object.getOwnPropertyDescriptor(f, "__proto__");
        seen.present = Object.getOwnPropertyDescriptor(f, "a") !== undefined;
        seen.proto = Object.getPrototypeOf(f);
        seen.has = ["a" in f, "nope" in f];
        seen.extensible = Object.isExtensible(f);
      },
    );

    expect(seen.keys).toEqual(expect.arrayContaining(["a", "b", "c", "tick"]));
    expect(seen.keys).not.toContain("nope");
    expect(seen.missing).toBeUndefined();
    expect(seen.present).toBe(true);
    expect(seen.proto).toBeNull();
    expect(seen.has).toEqual([true, false]);
    expect(seen.extensible).toBe(true);
    await system.destroy();
  });
});
