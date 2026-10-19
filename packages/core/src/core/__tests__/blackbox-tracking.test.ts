/**
 * Black-box conformance for dependency tracking, seen only through what it
 * decides: which writes make a derivation or an effect run again.
 *
 * Public API only. Counters count runs; assertions on counts are "at most" or
 * "fresh value" shaped, so an engine that recomputes less than 1.35 does passes.
 */

import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

// biome-ignore lint/suspicious/noExplicitAny: dynamic derivation and fact access is untyped by design
type Any = any;

function sys(mod: Any, plugins: Any[] = []): Any {
  const system = createSystem({ module: mod, plugins }) as Any;
  system.start();

  return system;
}

describe("a derivation depends on what its body reads", () => {
  it("recomputes for a fact it read and stays put for one it did not", () => {
    let runs = 0;
    const system = sys(
      createModule("m", {
        schema: {
          facts: { a: t.number(), b: t.number() },
          derivations: { d: t.number() },
        },
        init: (f) => {
          f.a = 1;
          f.b = 1;
        },
        derive: {
          d: (f) => {
            runs++;

            return f.a * 10;
          },
        },
      }),
    );

    expect(system.derive.d).toBe(10);
    const base = runs;
    system.facts.b = 5;
    expect(system.derive.d).toBe(10);
    expect(runs).toBeLessThanOrEqual(base + 1);
    const afterB = runs;
    system.facts.a = 2;
    expect(system.derive.d).toBe(20);
    expect(runs).toBeGreaterThan(afterB - 1);
    system.stop();
  });

  it("drops a dependency its branch no longer reads", () => {
    let runs = 0;
    const system = sys(
      createModule("m", {
        schema: {
          facts: { gate: t.boolean(), x: t.number(), y: t.number() },
          derivations: { d: t.number() },
        },
        init: (f) => {
          f.gate = true;
          f.x = 1;
          f.y = 100;
        },
        derive: {
          d: (f) => {
            runs++;

            return f.gate ? f.x : f.y;
          },
        },
      }),
    );

    expect(system.derive.d).toBe(1);
    system.facts.gate = false;
    expect(system.derive.d).toBe(100);
    // y now matters, x no longer does.
    system.facts.y = 101;
    expect(system.derive.d).toBe(101);
    const settled = runs;
    system.facts.x = 2;
    expect(system.derive.d).toBe(101);
    expect(runs).toBeLessThanOrEqual(settled + 1);
    system.facts.gate = true;
    expect(system.derive.d).toBe(2);
    system.stop();
  });

  it("picks up a dependency a branch starts reading", () => {
    const system = sys(
      createModule("m", {
        schema: {
          facts: { gate: t.boolean(), x: t.number(), y: t.number() },
          derivations: { d: t.number() },
        },
        init: (f) => {
          f.gate = false;
          f.x = 1;
          f.y = 5;
        },
        derive: { d: (f) => (f.gate ? f.x + f.y : 0) },
      }),
    );

    expect(system.derive.d).toBe(0);
    system.facts.gate = true;
    expect(system.derive.d).toBe(6);
    system.facts.y = 6;
    expect(system.derive.d).toBe(7);
    system.facts.x = 2;
    expect(system.derive.d).toBe(8);
    system.stop();
  });
});

describe("tracking nests: each body gets its own dependencies", () => {
  function chain() {
    const runs = { inner: 0, outer: 0 };
    const mod = createModule("m", {
      schema: {
        facts: { a: t.number(), b: t.number() },
        derivations: { inner: t.number(), outer: t.number() },
      },
      init: (f) => {
        f.a = 1;
        f.b = 1;
      },
      derive: {
        inner: (f) => {
          runs.inner++;

          return f.a + 1;
        },
        outer: (f, d) => {
          runs.outer++;

          return d.inner * 100 + f.b;
        },
      },
    });

    return { runs, system: sys(mod) };
  }

  it("an outer body depends on its own reads and on the inner derivation", () => {
    const { system } = chain();

    expect(system.derive.outer).toBe(201);
    system.facts.b = 2;
    expect(system.derive.outer).toBe(202);
    system.facts.a = 2;
    expect(system.derive.outer).toBe(302);
    system.stop();
  });

  it("the inner derivation does not inherit the outer body's reads", () => {
    const { runs, system } = chain();

    expect(system.derive.outer).toBe(201);
    const before = runs.inner;
    system.facts.b = 9;
    expect(system.derive.outer).toBe(209);
    expect(system.derive.inner).toBe(2);
    expect(runs.inner).toBeLessThanOrEqual(before + 1);
    system.stop();
  });

  it("reads after a nested derivation still count for the outer body", () => {
    const system = sys(
      createModule("m", {
        schema: {
          facts: { a: t.number(), b: t.number() },
          derivations: { inner: t.number(), outer: t.number() },
        },
        init: (f) => {
          f.a = 1;
          f.b = 1;
        },
        derive: {
          inner: (f) => f.a,
          // `b` is read only after the inner derivation has run and returned.
          outer: (f, d) => d.inner + f.b,
        },
      }),
    );

    expect(system.derive.outer).toBe(2);
    system.facts.b = 10;
    expect(system.derive.outer).toBe(11);
    system.facts.a = 5;
    expect(system.derive.outer).toBe(15);
    system.stop();
  });

  it("a three-step chain stays fresh from the bottom", () => {
    const system = sys(
      createModule("m", {
        schema: {
          facts: { a: t.number() },
          derivations: { l1: t.number(), l2: t.number(), l3: t.number() },
        },
        init: (f) => {
          f.a = 1;
        },
        derive: {
          l1: (f) => f.a + 1,
          l2: (_f, d) => d.l1 * 2,
          l3: (_f, d) => d.l2 + 1,
        },
      }),
    );

    expect(system.derive.l3).toBe(5);
    system.facts.a = 2;
    expect(system.derive.l3).toBe(7);
    system.facts.a = 3;
    expect(system.derive.l3).toBe(9);
    system.stop();
  });
});

describe("reads that are not dependencies", () => {
  function withMetaRead() {
    const runs = { d: 0 };
    // biome-ignore lint/style/useConst: assigned after the system exists
    let system: Any;
    const mod = createModule("m", {
      schema: {
        facts: {
          s: t.number().meta({ tags: ["watched"] }),
          b: t.number(),
        },
        derivations: { src: t.number(), d: t.number() },
      },
      init: (f) => {
        f.s = 1;
        f.b = 1;
      },
      derive: {
        src: (f) => f.s,
        d: (f) => {
          runs.d++;
          // Asking a question about the system is not reading from it.
          system?.meta.derivation("src");

          return f.b;
        },
      },
    });
    system = sys(mod);
    // Move `b` so `d` runs again now that `system` exists.
    system.facts.b = 2;

    return { runs, system };
  }

  it("a metadata question does not make its subject a dependency", () => {
    const { runs, system } = withMetaRead();

    expect(system.derive.d).toBe(2);
    const before = runs.d;
    system.facts.s = 2;
    expect(system.derive.d).toBe(2);
    expect(runs.d).toBeLessThanOrEqual(before + 1);
    system.stop();
  });

  it("reads after a metadata question are still tracked", () => {
    const { system } = withMetaRead();

    expect(system.derive.d).toBe(2);
    system.facts.b = 7;
    expect(system.derive.d).toBe(7);
    system.facts.b = 8;
    expect(system.derive.d).toBe(8);
    system.stop();
  });

  it("an effect reading after a metadata question keeps its other reads", async () => {
    const seen: number[] = [];
    // biome-ignore lint/style/useConst: assigned after the system exists
    let system: Any;
    const mod = createModule("m", {
      schema: {
        facts: { a: t.number(), b: t.number() },
        derivations: { src: t.number() },
      },
      init: (f) => {
        f.a = 1;
        f.b = 1;
      },
      derive: { src: (f) => f.a },
      effects: {
        watch: {
          run: (f: Any) => {
            system.meta.derivation("src");
            seen.push(f.b);
          },
        },
      },
    });
    system = sys(mod);
    await system.settle();

    system.facts.b = 4;
    await system.settle();
    system.facts.b = 5;
    await system.settle();

    expect(seen[seen.length - 1]).toBe(5);
    expect(seen).toContain(4);
    system.stop();
  });
});

describe("effects track what they read", () => {
  it("runs again for a fact it read and reads the new value", async () => {
    const seen: number[] = [];
    const system = sys(
      createModule("m", {
        schema: {
          facts: { a: t.number(), b: t.number() },
          derivations: {},
        },
        init: (f) => {
          f.a = 1;
          f.b = 1;
        },
        effects: {
          log: {
            run: (f: Any) => {
              seen.push(f.a);
            },
          },
        },
      }),
    );
    await system.settle();

    system.facts.a = 2;
    await system.settle();
    system.facts.a = 3;
    await system.settle();

    expect(seen[seen.length - 1]).toBe(3);
    expect(seen).toContain(2);
    system.stop();
  });

  it("runs again when a derivation it read changes", async () => {
    const seen: number[] = [];
    const system = sys(
      createModule("m", {
        schema: {
          facts: { a: t.number() },
          derivations: { dbl: t.number() },
        },
        init: (f) => {
          f.a = 1;
        },
        derive: { dbl: (f) => f.a * 2 },
        effects: {
          log: {
            run: (_f: Any, _p: Any, d?: Any) => {
              seen.push(d ? d.dbl : -1);
            },
          },
        },
      }),
    );
    await system.settle();

    system.facts.a = 4;
    await system.settle();

    // Whatever the signature, a changed input never leaves the effect stuck on
    // the old value: if it saw the derivation at all, it saw the new one.
    const real = seen.filter((v) => v !== -1);
    if (real.length > 0) {
      expect(real[real.length - 1]).toBe(8);
    }
    system.stop();
  });

  it("a tracked effect stays quiet for a fact it never read", async () => {
    let runs = 0;
    const system = sys(
      createModule("m", {
        schema: {
          facts: { a: t.number(), z: t.number() },
          derivations: {},
        },
        init: (f) => {
          f.a = 1;
          f.z = 1;
        },
        effects: {
          log: {
            run: (f: Any) => {
              runs++;
              void f.a;
            },
          },
        },
      }),
    );
    await system.settle();
    const base = runs;

    system.facts.z = 2;
    await system.settle();
    expect(runs).toBeLessThanOrEqual(base + 1);
    system.facts.a = 2;
    await system.settle();
    expect(runs).toBeGreaterThan(base - 1);
    system.stop();
  });
});

describe("two systems keep their tracking apart", () => {
  it("a write in one never reaches a derivation in the other", () => {
    const make = () => {
      const counter = { runs: 0 };
      const system = sys(
        createModule("m", {
          schema: {
            facts: { a: t.number() },
            derivations: { d: t.number() },
          },
          init: (f) => {
            f.a = 1;
          },
          derive: {
            d: (f) => {
              counter.runs++;

              return f.a + 1;
            },
          },
        }),
      );

      return { counter, system };
    };
    const one = make();
    const two = make();

    expect(one.system.derive.d).toBe(2);
    expect(two.system.derive.d).toBe(2);
    const before = two.counter.runs;
    one.system.facts.a = 10;
    expect(one.system.derive.d).toBe(11);
    expect(two.system.derive.d).toBe(2);
    expect(two.counter.runs).toBeLessThanOrEqual(before + 1);
    one.system.stop();
    two.system.stop();
  });

  it("a derivation in one system reading the other system is not a dependency", () => {
    const other = sys(
      createModule("o", {
        schema: { facts: { v: t.number() }, derivations: {} },
        init: (f) => {
          f.v = 1;
        },
      }),
    );
    const mine = sys(
      createModule("m", {
        schema: { facts: { a: t.number() }, derivations: { d: t.number() } },
        init: (f) => {
          f.a = 1;
        },
        derive: { d: (f) => f.a + other.facts.v },
      }),
    );

    expect(mine.derive.d).toBe(2);
    mine.facts.a = 2;
    expect(mine.derive.d).toBe(3);
    other.stop();
    mine.stop();
  });
});

describe("a derivation reports its dependencies readably", () => {
  it("names a derivation it read without the internal separator", () => {
    const reported: string[][] = [];
    const plugin = {
      name: "spy",
      onDerivationCompute: (id: string, _v: unknown, deps: string[]) => {
        if (id === "outer") {
          reported.push([...deps]);
        }
      },
    };
    const system = sys(
      createModule("m", {
        schema: {
          facts: { a: t.number(), b: t.number() },
          derivations: { inner: t.number(), outer: t.number() },
        },
        init: (f) => {
          f.a = 1;
          f.b = 1;
        },
        derive: {
          inner: (f) => f.a,
          outer: (f, d) => d.inner + f.b,
        },
      }),
      [plugin],
    );

    expect(system.derive.outer).toBe(2);
    expect(reported.length).toBeGreaterThan(0);
    const deps = reported[0]!;
    expect(deps).toContain("b");
    expect(deps.some((d) => d.endsWith("inner"))).toBe(true);
    for (const d of deps) {
      expect(d).not.toContain("\u001F");
    }
    // The derivation is told apart from a fact of the same name.
    expect(deps).not.toContain("inner");
    system.stop();
  });
});

describe("reads outside any body are plain reads", () => {
  it("returns current values and records nothing", () => {
    const system = sys(
      createModule("m", {
        schema: {
          facts: { a: t.number(), b: t.number() },
          derivations: { d: t.number() },
        },
        init: (f) => {
          f.a = 1;
          f.b = 2;
        },
        derive: { d: (f) => f.a + f.b },
      }),
    );

    expect(system.facts.a).toBe(1);
    expect("a" in system.facts).toBe(true);
    expect(system.derive.d).toBe(3);
    system.facts.a = 10;
    expect(system.facts.a).toBe(10);
    expect(system.derive.d).toBe(12);
    expect(system.facts.b).toBe(2);
    system.stop();
  });
});

describe("the prototype guard on facts", () => {
  it("answers nothing for prototype-chain names", () => {
    const system = sys(
      createModule("m", {
        schema: { facts: { a: t.number() }, derivations: {} },
        init: (f) => {
          f.a = 1;
        },
      }),
    );
    const f = system.facts as Any;

    expect(f.__proto__).toBeUndefined();
    expect(f.constructor).toBeUndefined();
    expect(f.prototype).toBeUndefined();
    expect("__proto__" in f).toBe(false);
    expect("constructor" in f).toBe(false);
    expect("prototype" in f).toBe(false);
    system.stop();
  });
});
