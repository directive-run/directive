// L6c in production: (al) fills defaults as in development; (am) changes
// nothing, since production checks no write (1.35).

import { describe, expect, it, vi } from "vitest";

vi.mock("#is-development", () => ({ default: false }));

const { createModule } = await import("../api/core.js");
const { t } = await import("../api/schema-builders.js");
const { createSystem } = await import("../api/system.js");

describe("L6c in production", () => {
  it("(al) fills an untouched default; (am) a failing refine is not checked", () => {
    const system: any = createSystem({
      module: createModule("m", {
        schema: {
          facts: {
            c: t.number().refine((n: number) => n % 2 === 0, "must be even"),
            v: t.number().default(5),
            x: t.number().default(5),
          },
          derivations: {},
          events: {},
          requirements: {},
        },
        init: (facts: any) => {
          facts.c = 2;
          facts.x ??= 10;
        },
        derive: {},
        events: {},
      } as any),
    });
    system.start();
    expect(system.facts.v).toBe(5);
    expect(system.facts.x).toBe(10);
    system.facts.c = 3;
    expect(system.facts.c).toBe(3);
    system.destroy();
  });

  it("(al) copies an array default per system; fills a default that fails its validators", () => {
    const cart = createModule("cart", {
      schema: {
        facts: {
          items: t.array<string>().default([]),
          a: t.number().min(5).default(1),
        },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: () => {},
      derive: {},
      events: {},
    } as any);
    const carts: unknown[] = [];
    for (const user of ["alice", "bob"]) {
      const system: any = createSystem({ module: cart });
      system.start();
      system.facts.items.push(`${user}-item`);
      carts.push([...system.facts.items]);
      expect(system.facts.a).toBe(1);
      system.destroy();
    }
    expect(carts).toEqual([["alice-item"], ["bob-item"]]);
  });
});
