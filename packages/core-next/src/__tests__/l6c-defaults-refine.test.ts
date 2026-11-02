// L6c, owner-approved changes from 1.35 (RFC rev. 2):
// (al) `.default()` fills each fact still undefined as the last step of
//      initialize(): after the module inits, the persistence plugin's restore,
//      initialFacts and hydrate. It never overwrites a value and never
//      double-writes, and a `??=` init still runs.
// (am) a failed `.refine()` adds its message to the development error, after
//      1.35's text.
// 1.35 applies no default and never shows the refine message (U11, U12).

import { describe, expect, it } from "vitest";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";
import type { Plugin } from "../api/types.js";
import { persistencePlugin } from "../plugins/index.js";

const memoryStorage = (initial: Record<string, string>) => {
  const map = new Map(Object.entries(initial));

  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
  } as Storage;
};

const moduleOf = (facts: Record<string, unknown>, init?: (f: any) => void) =>
  createModule("m", {
    schema: { facts, derivations: {}, events: {}, requirements: {} },
    init: init ?? (() => {}),
    derive: {},
    events: {},
  } as any);

describe("(al) .default() fills facts still undefined after initialize()", () => {
  it("a ??= init wins: the default fills after the inits, so the init still runs", () => {
    let seen: unknown = "not run";
    const system: any = createSystem({
      module: moduleOf({ x: t.number().default(5) }, (facts) => {
        seen = facts.x;
        facts.x ??= 10;
      }),
    });
    system.start();
    expect(seen).toBeUndefined();
    expect(system.facts.x).toBe(10);
    system.destroy();
  });

  it("a value the persistence plugin restored wins", () => {
    const system: any = createSystem({
      module: moduleOf({ y: t.number().default(5) }),
      plugins: [
        persistencePlugin({
          storage: memoryStorage({ k: JSON.stringify({ y: 7 }) }),
          key: "k",
        }),
      ],
    });
    system.start();
    expect(system.facts.y).toBe(7);
    system.destroy();
  });

  it("initialFacts and hydrate win", async () => {
    const system: any = createSystem({
      module: moduleOf({ z: t.number().default(5), w: t.number().default(5) }),
      initialFacts: { z: 3 },
    });
    await system.hydrate(() => ({ w: 4 }));
    system.start();
    expect(system.facts.z).toBe(3);
    expect(system.facts.w).toBe(4);
    system.destroy();
  });

  it("fills an untouched fact, a falsy default, and a function default, in one batch after every other write", () => {
    const batches: string[][] = [];
    const sets: string[] = [];
    const rec: Plugin = {
      name: "rec",
      onFactSet: (key: string) => void sets.push(key),
      onFactsBatch: (changes: { key: string }[]) =>
        void batches.push(changes.map((c) => c.key)),
    } as any;
    const system: any = createSystem({
      module: moduleOf(
        {
          k: t.number().default(5),
          v: t.number().default(5),
          b: t.boolean().default(false),
          f: t.array<number>().default(() => [1]),
          plain: t.number(),
        },
        (facts) => {
          facts.k = 1;
        },
      ),
      plugins: [rec],
    });
    system.initialize();
    expect(system.facts.k).toBe(1);
    expect(system.facts.v).toBe(5);
    expect(system.facts.b).toBe(false);
    expect(system.facts.f).toEqual([1]);
    expect(system.facts.plain).toBeUndefined();
    expect(Object.keys(system.getSnapshot().facts).sort()).toEqual([
      "b",
      "f",
      "k",
      "v",
    ]);
    // The init's batch, then one batch of defaults: no key written twice.
    expect(batches).toEqual([["k"], ["v", "b", "f"]]);
    expect(sets).toEqual([]);
    system.start();
    expect(batches).toHaveLength(2);
    system.destroy();
  });

  it("an init that leaves a fact undefined (explicitly or by a later write) gets the default", () => {
    const system: any = createSystem({
      module: moduleOf(
        {
          u: t.number().optional().default(5),
          u2: t.number().optional().default(5),
        },
        (facts) => {
          facts.u = undefined;
          facts.u2 = 1;
          facts.u2 = undefined;
        },
      ),
    });
    system.start();
    expect(system.facts.u).toBe(5);
    expect(system.facts.u2).toBe(5);
    system.destroy();
  });

  it("writes nothing when no fact declares a default, and runs once", () => {
    const batches: unknown[] = [];
    const system: any = createSystem({
      module: moduleOf({ a: t.number(), d: t.number().default(2) }, (f) => {
        f.a = 1;
      }),
      plugins: [{ name: "rec", onFactsBatch: (c: unknown) => batches.push(c) }],
    } as any);
    system.initialize();
    system.facts.d = 9;
    system.initialize();
    system.start();
    expect(system.facts.d).toBe(9);
    expect(batches).toHaveLength(2);
    const bare: any = createSystem({
      module: moduleOf({ a: t.number() }),
      plugins: [{ name: "rec", onFactsBatch: (c: unknown) => batches.push(c) }],
    } as any);
    bare.start();
    expect(batches).toHaveLength(2);
    system.destroy();
    bare.destroy();
  });

  it("fills a namespaced system's facts", () => {
    const system: any = createSystem({
      modules: {
        a: moduleOf(
          { n: t.number().default(5), m: t.number().default(6) },
          (f) => {
            f.m = 1;
          },
        ),
      },
    } as any);
    system.start();
    expect(system.facts.a.n).toBe(5);
    expect(system.facts.a.m).toBe(1);
    system.destroy();
  });
});

describe("(am) a failed .refine() shows its message in development", () => {
  it("after 1.35's text", () => {
    const system: any = createSystem({
      module: moduleOf(
        { c: t.number().refine((n: number) => n % 2 === 0, "must be even") },
        (facts) => {
          facts.c = 2;
        },
      ),
    });
    system.start();
    expect(() => {
      system.facts.c = 3;
    }).toThrow(
      '[Directive] Validation failed for "c": expected number, got number 3 (validator 2 failed). must be even',
    );
    expect(system.facts.c).toBe(2);
    // A failing type check names no refine message.
    expect(() => {
      system.facts.c = "x";
    }).toThrow(/got string "x"$/);
    system.destroy();
  });
});
