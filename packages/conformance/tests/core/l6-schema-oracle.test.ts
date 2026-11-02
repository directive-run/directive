// Ported from packages/core/src/core/__tests__/l6-schema-oracle.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// The L6 `t.*` corners on 1.35, development build: refine, transform and
// default (L6 RFC, "Untested behaviours" U8, U11, U12). Public API only.
// (al) and (am) are approved for 2.0, so the cases titled with them are where
// 2.0's difference will show; (an) and (aj) are declined, so theirs stay.

afterEach(() => {
  vi.restoreAllMocks();
});

/** A one-module system over the given facts, with an optional init. */
function systemOf(facts: Record<string, unknown>, init?: (facts: any) => void) {
  return createSystem({
    module: createModule("m", {
      schema: { facts, derivations: {}, events: {}, requirements: {} },
      init: init ?? (() => {}),
      derive: {},
      events: {},
    } as any),
  }) as any;
}

describe(".refine() on a base builder (U12)", () => {
  it("keeps the type check, adds its predicate, and records { predicate, message }", () => {
    const predicate = (value: boolean) => value === true;
    const schema: any = t.boolean().refine(predicate, "must be true");
    expect(schema._refinements).toHaveLength(1);
    expect(schema._refinements[0].predicate).toBe(predicate);
    expect(schema._refinements[0].message).toBe("must be true");

    const system = systemOf({ flag: schema }, (facts) => {
      facts.flag = true;
    });
    system.start();
    expect(() => {
      system.facts.flag = false;
    }).toThrow(/flag/);
    expect(() => {
      system.facts.flag = "yes";
    }).toThrow(/flag/);
    expect(system.facts.flag).toBe(true);
  });

  it("chained twice records both refinements in order, and both predicates run", () => {
    const schema: any = t
      .enum("a", "b", "c")
      .refine((value: string) => value !== "b", "not b")
      .refine((value: string) => value !== "c", "not c");
    expect(schema._refinements.map((r: any) => r.message)).toEqual([
      "not b",
      "not c",
    ]);

    const system = systemOf({ letter: schema }, (facts) => {
      facts.letter = "a";
    });
    system.start();
    expect(() => {
      system.facts.letter = "b";
    }).toThrow(/letter/);
    expect(() => {
      system.facts.letter = "c";
    }).toThrow(/letter/);
    expect(() => {
      system.facts.letter = "z";
    }).toThrow(/letter/);
    expect(system.facts.letter).toBe("a");
  });
});

describe(".refine()'s message (U12, am)", () => {
  it("is not in the development error, which names the field", () => {
    const system = systemOf(
      { c: t.number().refine((n: number) => n % 2 === 0, "must be even") },
      (facts) => {
        facts.c = 2;
      },
    );
    system.start();
    let message = "";
    try {
      system.facts.c = 3;
    } catch (error) {
      message = String((error as Error).message);
    }
    expect(message).toMatch(/"c"/);
    expect(message).not.toMatch(/must be even/);
    expect(system.facts.c).toBe(2);
    system.facts.c = 4;
    expect(system.facts.c).toBe(4);
  });
});

describe(".transform() (U12, an declined)", () => {
  it("drops every check before it, the type check included, and is never applied to a write", () => {
    const system = systemOf(
      {
        a: t
          .number()
          .min(0)
          .transform((n: number) => n * 2),
      },
      (facts) => {
        facts.a = 1;
      },
    );
    system.start();
    expect(system.facts.a).toBe(1);
    system.facts.a = -1;
    expect(system.facts.a).toBe(-1);
    system.facts.a = "7";
    expect(system.facts.a).toBe("7");
    system.facts.a = 3;
    expect(system.facts.a).toBe(3);
  });
});

describe(".default() (U11, al)", () => {
  it("is stored on the builder and never applied: the fact stays undefined and out of the snapshot", () => {
    const schema: any = t.number().default(5);
    expect(schema._default).toBe(5);
    const system = systemOf(
      {
        v: schema,
        b: t.boolean().default(true),
        k: t.number(),
      },
      (facts) => {
        facts.k = 1;
      },
    );
    system.start();
    expect(system.facts.v).toBeUndefined();
    expect(system.facts.b).toBeUndefined();
    expect(Object.keys(system.getSnapshot().facts)).toEqual(["k"]);
  });

  it("is not applied with initialFacts either", () => {
    const system: any = createSystem({
      module: createModule("m", {
        schema: {
          facts: { v: t.number().default(5) },
          derivations: {},
          events: {},
          requirements: {},
        },
        init: () => {},
        derive: {},
        events: {},
      } as any),
      initialFacts: {},
    } as any);
    system.start();
    expect(system.facts.v).toBeUndefined();
    expect(Object.keys(system.getSnapshot().facts)).toEqual([]);
  });
});

describe("a Date fact read through system.facts (U8, aj declined)", () => {
  it("cannot be read as a Date in development: getTime() and JSON.stringify throw", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = systemOf({ when: t.date() }, (facts) => {
      facts.when = new Date(0);
    });
    system.start();
    expect(() => system.facts.when.getTime()).toThrow();
    expect(() => JSON.stringify(system.facts.when)).toThrow();
  });
});
