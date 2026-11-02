import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

// The L6 `t.*` corners on 1.35, development build: refine, transform and
// default (L6 RFC, "Untested behaviours" U8, U11, U12). Public API only.
// (al) and (am) are approved for 2.0, so their cases keep only what 1.35 and
// 2.0 share, and a diff scenario records the difference (the L2 precedent:
// l2-constraints-oracle "after a restart asks ..."); (an) and (aj) are
// declined, so theirs stay as 1.35 pins.

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

describe(".refine() refusing a write (U12, am)", () => {
  it("throws a development error that names the field, and keeps the value", () => {
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
    // Whether the error carries the refine's message is row (am): 1.35 leaves
    // it out, 2.0 adds it. Not pinned here; the diff scenario "t.* refine,
    // transform, brand and wrong types in development" records the
    // difference, and the L6 gate signs it.
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
  it("is stored on the builder, and a fact the init writes keeps its value", () => {
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
    // Whether a default fills a fact the init leaves undefined is row (al):
    // 1.35 never applies one: v and b stay undefined and out of the snapshot;
    // 2.0 does. Not pinned here; the diff scenario "a .default(): a fact init
    // leaves alone, one a ??= init sets, one it sets to undefined (U11)"
    // records the difference, and the L6 gate signs it.
    expect(system.facts.k).toBe(1);
    expect(Object.keys(system.getSnapshot().facts)).toContain("k");
  });

  it("an empty initialFacts leaves a defaulted fact as no initialFacts does", () => {
    const build = (initialFacts: boolean): any =>
      createSystem({
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
        ...(initialFacts ? { initialFacts: {} } : {}),
      } as any);
    const given = build(true);
    const plain = build(false);
    given.start();
    plain.start();
    // Whether the default is applied is row (al) (1.35: never, so v stays
    // undefined and out of the snapshot; 2.0: yes). Only that initialFacts
    // changes nothing is pinned; the diff scenario "a .default() with
    // initialFacts: one they give, one they leave out (U11)" records the
    // difference, and the L6 gate signs it.
    expect(given.facts.v).toBe(plain.facts.v);
    expect(Object.keys(given.getSnapshot().facts)).toEqual(
      Object.keys(plain.getSnapshot().facts),
    );
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
