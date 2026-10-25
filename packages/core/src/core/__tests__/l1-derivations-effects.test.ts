import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

// Black-box tests (L0): an effect that reads a derivation through its derived
// parameter is woken when that derivation changes, and only then. Facts,
// derivations and basic effects `run(facts, prev, derived)` only; no deps, no
// on, no plugins, no runtime registration.

function build(config: Record<string, unknown>) {
  const mod = createModule("m", config as never);
  const system = createSystem({ module: mod } as never) as any;
  system.start();

  return system;
}

/** Lets the effect pass that a settle schedules finish. */
async function settled(system: any) {
  await system.settle();
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

const last = <T>(xs: T[]) => xs[xs.length - 1];

describe("an effect reading a derivation", () => {
  it("re-runs when the derivation changes", async () => {
    const seen: number[] = [];
    const system = build({
      schema: {
        facts: { a: t.number(), b: t.number() },
        derivations: { sum: t.number() },
      },
      init: (f: any) => {
        f.a = 1;
        f.b = 2;
      },
      derive: { sum: (f: any) => f.a + f.b },
      effects: {
        watch: {
          run: (_f: any, _p: any, d: any) => {
            seen.push(d.sum);
          },
        },
      },
    });
    await settled(system);
    expect(last(seen)).toBe(3);

    system.facts.a = 10;
    await settled(system);
    expect(last(seen)).toBe(12);
    await system.stop();
  });

  it("re-runs when the end of a derivation chain changes", async () => {
    const seen: number[] = [];
    const system = build({
      schema: {
        facts: { a: t.number() },
        derivations: { d1: t.number(), d2: t.number() },
      },
      init: (f: any) => {
        f.a = 1;
      },
      derive: {
        d1: (f: any) => f.a + 1,
        d2: (_f: any, d: any) => d.d1 * 2,
      },
      effects: {
        watch: {
          run: (_f: any, _p: any, d: any) => {
            seen.push(d.d2);
          },
        },
      },
    });
    await settled(system);
    expect(last(seen)).toBe(4);

    system.facts.a = 5;
    await settled(system);
    expect(last(seen)).toBe(12);
    await system.stop();
  });

  it("is not re-run by a write the derivation does not depend on", async () => {
    let runs = 0;
    const system = build({
      schema: {
        facts: { a: t.number(), c: t.number() },
        derivations: { d1: t.number() },
      },
      init: (f: any) => {
        f.a = 1;
        f.c = 0;
      },
      derive: { d1: (f: any) => f.a + 1 },
      effects: {
        watch: {
          run: (_f: any, _p: any, d: any) => {
            runs++;
            void d.d1;
          },
        },
      },
    });
    await settled(system);
    const before = runs;

    system.facts.c = 5;
    await settled(system);
    expect(runs).toBe(before);
    await system.stop();
  });

  it("re-runs when it only tested the derivation's membership", async () => {
    let runs = 0;
    const system = build({
      schema: {
        facts: { a: t.number() },
        derivations: { d1: t.number() },
      },
      init: (f: any) => {
        f.a = 1;
      },
      derive: { d1: (f: any) => f.a + 1 },
      effects: {
        watch: {
          run: (_f: any, _p: any, d: any) => {
            runs++;
            void ("d1" in d);
          },
        },
      },
    });
    await settled(system);
    const before = runs;

    system.facts.a = 2;
    await settled(system);
    expect(runs).toBeGreaterThan(before);
    await system.stop();
  });

  it("then a fact depends on that fact too", async () => {
    const seen: number[] = [];
    const system = build({
      schema: {
        facts: { a: t.number(), b: t.number() },
        derivations: { d1: t.number() },
      },
      init: (f: any) => {
        f.a = 1;
        f.b = 10;
      },
      derive: { d1: (f: any) => f.a * 2 },
      effects: {
        watch: {
          run: (f: any, _p: any, d: any) => {
            seen.push(d.d1 + f.b);
          },
        },
      },
    });
    await settled(system);
    expect(last(seen)).toBe(12);

    system.facts.b = 100;
    await settled(system);
    expect(last(seen)).toBe(102);
    await system.stop();
  });
});

describe("two effects reading derivations", () => {
  it("of one fact are both re-run when it changes", async () => {
    const s1: number[] = [];
    const s2: number[] = [];
    const system = build({
      schema: {
        facts: { a: t.number() },
        derivations: { x: t.number(), y: t.number() },
      },
      init: (f: any) => {
        f.a = 1;
      },
      derive: { x: (f: any) => f.a + 1, y: (f: any) => f.a * 10 },
      effects: {
        e1: {
          run: (_f: any, _p: any, d: any) => {
            s1.push(d.x);
          },
        },
        e2: {
          run: (_f: any, _p: any, d: any) => {
            s2.push(d.y);
          },
        },
      },
    });
    await settled(system);

    system.facts.a = 5;
    await settled(system);
    expect(last(s1)).toBe(6);
    expect(last(s2)).toBe(50);
    await system.stop();
  });

  it("of different facts: a write to one re-runs only its effect", async () => {
    let r1 = 0;
    let r2 = 0;
    const system = build({
      schema: {
        facts: { a: t.number(), c: t.number() },
        derivations: { x: t.number(), z: t.number() },
      },
      init: (f: any) => {
        f.a = 1;
        f.c = 1;
      },
      derive: { x: (f: any) => f.a + 1, z: (f: any) => f.c + 1 },
      effects: {
        e1: {
          run: (_f: any, _p: any, d: any) => {
            r1++;
            void d.x;
          },
        },
        e2: {
          run: (_f: any, _p: any, d: any) => {
            r2++;
            void d.z;
          },
        },
      },
    });
    await settled(system);
    const b1 = r1;
    const b2 = r2;

    system.facts.a = 5;
    await settled(system);
    expect(r1).toBe(b1 + 1);
    expect(r2).toBe(b2);
    await system.stop();
  });
});

describe("a derivation reading a derivation", () => {
  it("then a fact depends on that fact too", () => {
    const system = build({
      schema: {
        facts: { a: t.number(), b: t.number() },
        derivations: { d1: t.number(), d2: t.number() },
      },
      init: (f: any) => {
        f.a = 1;
        f.b = 10;
      },
      derive: {
        d1: (f: any) => f.a * 2,
        d2: (f: any, d: any) => d.d1 + f.b,
      },
    });
    expect(system.derive.d2).toBe(12);

    system.facts.b = 100;
    expect(system.derive.d2).toBe(102);

    system.facts.a = 5;
    expect(system.derive.d2).toBe(110);
  });
});

describe("a derivation whose compute is not a function", () => {
  it("is refused when the system is built", () => {
    let error: unknown;
    try {
      const mod = createModule("m", {
        schema: {
          facts: { a: t.number() },
          derivations: { x: t.number() },
        },
        init: (f: any) => {
          f.a = 1;
        },
        derive: { x: { compute: 5 } },
      } as never);
      createSystem({ module: mod } as never);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
  });
});
