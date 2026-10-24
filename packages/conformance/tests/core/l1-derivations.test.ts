// Ported from packages/core/src/core/__tests__/l1-derivations.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { describe, expect, it } from "vitest";

// Black-box tests (L0/L1): how derivations compute, cache, track what they
// read, and notify. Public API only; no effect deps, plugins or registries.

function build(derive: Record<string, any>, extraFacts: string[] = []) {
  const facts: Record<string, any> = {
    a: t.number(),
    b: t.number(),
    flag: t.boolean(),
    x: t.number(),
    y: t.number(),
  };
  for (const k of extraFacts) {
    facts[k] = t.number();
  }
  const derivations: Record<string, any> = {};
  for (const k of Object.keys(derive)) {
    derivations[k] = t.any();
  }
  const mod = createModule("m", {
    schema: { facts, derivations } as never,
    init: (f: any) => {
      f.a = 1;
      f.b = 2;
      f.flag = true;
      f.x = 10;
      f.y = 20;
    },
    derive: derive as never,
  });
  const system = createSystem({ module: mod } as never) as any;
  system.start();

  return system;
}

describe("a derivation declared as { compute }", () => {
  it("computes like the bare function", () => {
    const system = build({
      sum: { compute: (f: any) => f.a + f.b },
      twice: { compute: (_f: any, d: any) => d.sum * 2 },
    });

    expect(system.derive.sum).toBe(3);
    expect(system.derive.twice).toBe(6);
    system.facts.a = 5;
    expect(system.derive.sum).toBe(7);
    expect(system.derive.twice).toBe(14);
  });
});

describe("caching and what a derivation depends on", () => {
  it("computes once until a fact it read changes", () => {
    let runs = 0;
    const system = build({
      sum: (f: any) => {
        runs++;

        return f.a + f.b;
      },
    });

    expect(system.derive.sum).toBe(3);
    expect(system.derive.sum).toBe(3);
    expect(runs).toBe(1);
    system.facts.a = 4;
    expect(system.derive.sum).toBe(6);
    expect(system.derive.sum).toBe(6);
    expect(runs).toBe(2);
  });

  it("a derivation read through another is computed once, not per reader", () => {
    let runs = 0;
    const system = build({
      base: (f: any) => {
        runs++;

        return f.a * 10;
      },
      p: (_f: any, d: any) => d.base + 1,
      q: (_f: any, d: any) => d.base + 2,
      both: (_f: any, d: any) => d.base + d.base,
    });

    expect(system.derive.p).toBe(11);
    expect(system.derive.q).toBe(12);
    expect(system.derive.both).toBe(20);
    expect(runs).toBe(1);
    system.facts.a = 2;
    expect(system.derive.both).toBe(40);
    expect(system.derive.p).toBe(21);
    expect(runs).toBe(2);
  });

  it("a derivation that switches what it reads stops following the old fact", () => {
    let runs = 0;
    const system = build({
      pick: (f: any) => {
        runs++;

        return f.flag ? f.x : f.y;
      },
    });

    expect(system.derive.pick).toBe(10);
    system.facts.flag = false;
    expect(system.derive.pick).toBe(20);
    const before = runs;
    system.facts.x = 11;
    expect(system.derive.pick).toBe(20);
    expect(runs).toBe(before);
    system.facts.y = 21;
    expect(system.derive.pick).toBe(21);
    expect(runs).toBe(before + 1);
  });

  it("a derivation that starts reading more follows the new fact", () => {
    const system = build({
      grow: (f: any) => (f.flag ? f.a : f.a + f.b),
    });

    expect(system.derive.grow).toBe(1);
    system.facts.flag = false;
    expect(system.derive.grow).toBe(3);
    system.facts.b = 7;
    expect(system.derive.grow).toBe(8);
  });

  it("a derivation that stops reading a fact stops following it, same count of reads", () => {
    let runs = 0;
    const system = build({
      shrink: (f: any) => {
        runs++;

        return f.flag ? f.a + f.b : f.a;
      },
    });

    expect(system.derive.shrink).toBe(3);
    system.facts.flag = false;
    expect(system.derive.shrink).toBe(1);
    const before = runs;
    system.facts.b = 50;
    expect(system.derive.shrink).toBe(1);
    expect(runs).toBe(before);
  });

  it("switching one dependency for another of the same count relinks", () => {
    let runs = 0;
    const system = build({
      swap: (f: any) => {
        runs++;

        return f.flag ? f.flag && f.a : f.x;
      },
    });

    expect(system.derive.swap).toBe(1);
    system.facts.flag = false;
    expect(system.derive.swap).toBe(10);
    const before = runs;
    system.facts.a = 99;
    expect(system.derive.swap).toBe(10);
    expect(runs).toBe(before);
    system.facts.x = 11;
    expect(system.derive.swap).toBe(11);
  });

  it("a derivation that now reads a different fact, same count, follows the new one", () => {
    let key = "a";
    const system = build({ pick: (f: any) => f[key] });

    expect(system.derive.pick).toBe(1);
    key = "x";
    system.facts.a = 2;
    expect(system.derive.pick).toBe(10);
    system.facts.x = 11;
    expect(system.derive.pick).toBe(11);
    system.facts.a = 3;
    expect(system.derive.pick).toBe(11);
  });

  it("a derived value reached through the derived chain follows facts two levels down", () => {
    const system = build({
      one: (f: any) => f.a + 1,
      two: (_f: any, d: any) => d.one + 1,
      three: (_f: any, d: any) => d.two + 1,
    });

    expect(system.derive.three).toBe(4);
    system.facts.a = 10;
    expect(system.derive.three).toBe(13);
    expect(system.derive.two).toBe(12);
  });

  it("a membership test on derived is a read that follows its target", () => {
    let runs = 0;
    const system = build({
      base: (f: any) => f.a,
      has: (_f: any, d: any) => {
        runs++;

        return "base" in d;
      },
    });

    expect(system.derive.has).toBe(true);
    system.facts.a = 2;
    expect(system.derive.has).toBe(true);
    expect(runs).toBe(2);
  });

  it("a derivation read from a closure over the system is a dependency", () => {
    const ref: { sys?: any } = {};
    const mod = createModule("m", {
      schema: {
        facts: { a: t.number() },
        derivations: { base: t.number(), outer: t.number() },
      } as never,
      init: (f: any) => {
        f.a = 1;
      },
      derive: {
        base: (f: any) => f.a * 2,
        outer: () => ref.sys.derive.base + 1,
      } as never,
    });
    const sys: any = createSystem({ module: mod } as never);
    ref.sys = sys;
    sys.start();

    expect(sys.derive.outer).toBe(3);
    sys.facts.a = 5;
    expect(sys.derive.outer).toBe(11);
  });
});

describe("the derived object a derivation reads through", () => {
  it("answers undefined for names that are not derivations, even inherited ones", () => {
    const seen: unknown[] = [];
    const system = build({
      probe: (_f: any, d: any) => {
        seen.push(
          d.constructor,
          d.__proto__,
          d.nope,
          d[Symbol.iterator],
          "constructor" in d,
          "__proto__" in d,
          "nope" in d,
          Object.getOwnPropertyDescriptor(d, "constructor"),
          Object.getOwnPropertyDescriptor(d, "nope"),
          Object.getOwnPropertyDescriptor(d, Symbol.iterator),
        );

        return 1;
      },
    });

    expect(system.derive.probe).toBe(1);
    expect(seen).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      false,
      false,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("lists derivations, and an enumerated getter yields the value", () => {
    const system = build({
      one: (f: any) => f.a,
      all: (_f: any, d: any) => {
        const desc = Object.getOwnPropertyDescriptor(d, "one");

        return {
          keys: Object.keys(d).sort(),
          enumerable: desc?.enumerable,
          value: (desc?.get as (() => unknown) | undefined)?.(),
        };
      },
    });

    expect(system.derive.all).toEqual({
      keys: ["all", "one"],
      enumerable: true,
      value: 1,
    });
  });

  it("cannot be written, deleted from or redefined", () => {
    const outcomes: unknown[] = [];
    const system = build({
      one: (f: any) => f.a,
      probe: (_f: any, d: any) => {
        for (const act of [
          () => {
            d.one = 5;
          },
          () => {
            delete d.one;
          },
          () => Object.defineProperty(d, "one", { value: 5 }),
        ]) {
          try {
            act();
            outcomes.push("allowed");
          } catch {
            outcomes.push("refused");
          }
        }

        return d.one;
      },
    });

    expect(system.derive.probe).toBe(1);
    expect(outcomes).toEqual(["refused", "refused", "refused"]);
  });
});

describe("circular derivations", () => {
  it("are reported, not run forever", () => {
    let error: unknown;
    try {
      const system = build({
        p: (_f: any, d: any) => d.q + 1,
        q: (_f: any, d: any) => d.p + 1,
      });
      void system.derive.p;
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(RangeError);
  });
});

describe("subscribing to derivations", () => {
  it("one batch of writes notifies each derivation once, after every derivation is current", () => {
    const system = build({
      sum: (f: any) => f.a + f.b,
      doubled: (_f: any, d: any) => d.sum * 2,
    });
    void system.derive.doubled;
    const seen: number[] = [];
    system.subscribe(["sum", "doubled"], () => {
      seen.push(system.derive.sum * 100 + system.derive.doubled);
    });

    system.batch(() => {
      system.facts.a = 10;
      system.facts.b = 20;
    });

    expect(seen).toEqual([3060, 3060]);
    expect(system.derive.doubled).toBe(60);
  });

  it("a write that changes nothing a derivation read does not notify it", () => {
    const system = build({ sum: (f: any) => f.a + f.b });
    void system.derive.sum;
    let calls = 0;
    system.subscribe(["sum"], () => {
      calls++;
      void system.derive.sum;
    });

    system.facts.x = 99;
    expect(calls).toBe(0);
    system.facts.a = 5;
    expect(calls).toBe(1);
  });

  it("unsubscribing twice is harmless and stops notifications", () => {
    const system = build({ sum: (f: any) => f.a + f.b });
    void system.derive.sum;
    let calls = 0;
    const off = system.subscribe(["sum"], () => {
      calls++;
      void system.derive.sum;
    });

    system.facts.a = 2;
    expect(calls).toBe(1);
    off();
    expect(() => off()).not.toThrow();
    system.facts.a = 3;
    expect(calls).toBe(1);
  });

  it("two subscribers to one derivation both hear it; leaving one keeps the other", () => {
    const system = build({ sum: (f: any) => f.a + f.b });
    void system.derive.sum;
    const heard: string[] = [];
    const offA = system.subscribe(["sum"], () => {
      heard.push("A");
      void system.derive.sum;
    });
    system.subscribe(["sum"], () => {
      heard.push("B");
      void system.derive.sum;
    });

    system.facts.a = 2;
    expect(heard.sort()).toEqual(["A", "B"]);
    offA();
    heard.length = 0;
    system.facts.a = 3;
    expect(heard).toEqual(["B"]);
  });

  it("a subscriber that keeps rewriting what it listens to is stopped", () => {
    const system = build({ n: (f: any) => f.a });
    void system.derive.n;
    let calls = 0;
    system.subscribe(["n"], () => {
      calls++;
      void system.derive.n;
      system.facts.a = system.facts.a + 1;
    });

    let error: unknown;
    try {
      system.facts.a = 100;
    } catch (e) {
      error = e;
    }
    expect(calls).toBeGreaterThan(1);
    expect(calls).toBeLessThan(10_000);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(RangeError);
  });
});
