import { describe, it, expect, vi } from "vitest";
import { module } from "../builder.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const counterSchema = {
  facts: { count: { _type: 0 }, label: { _type: "" } },
  derivations: { doubled: { _type: 0 } },
  events: { increment: {}, reset: {} },
  requirements: {},
};

// ---------------------------------------------------------------------------
// module() builder
// ---------------------------------------------------------------------------

describe("module() builder", () => {
  it("builds a minimal module with schema only", () => {
    const mod = module("minimal")
      .schema({
        facts: { x: { _type: 0 } },
        derivations: {},
        events: {},
        requirements: {},
      })
      .build();

    expect(mod.id).toBe("minimal");
    expect(mod.schema.facts).toEqual({ x: { _type: 0 } });
  });

  it("chains all builder methods and returns correct module def", () => {
    const initFn = vi.fn();
    const deriveFn = (f: any) => f.count * 2;
    const incFn = vi.fn();
    const resetFn = vi.fn();
    const effectDef = { log: { run: vi.fn() } };
    const constraintDef = {
      check: {
        when: () => true,
        require: { type: "DO" },
      },
    };
    const resolverDef = {
      doIt: {
        requirement: "DO",
        resolve: vi.fn(),
      },
    };
    const hooks = { onStart: vi.fn() };

    const mod = module("full")
      .schema(counterSchema)
      .init(initFn)
      .derive({ doubled: deriveFn })
      .events({ increment: incFn, reset: resetFn })
      .effects(effectDef)
      .constraints(constraintDef)
      .resolvers(resolverDef)
      .hooks(hooks)
      .build();

    expect(mod.id).toBe("full");
    expect(mod.schema).toBe(counterSchema);
    expect(mod.init).toBe(initFn);
    expect(mod.derive.doubled).toBe(deriveFn);
    expect(mod.events.increment).toBe(incFn);
    expect(mod.effects).toBe(effectDef);
    expect(mod.constraints).toBe(constraintDef);
    expect(mod.resolvers).toBe(resolverDef);
    expect(mod.hooks).toBe(hooks);
  });

  it("methods are chainable (return same builder)", () => {
    const b = module("chain");
    const b2 = b.schema(counterSchema);
    expect(b2).toBe(b);
    const b3 = b2.init(() => {});
    expect(b3).toBe(b);
  });

  // ---- validation ---------------------------------------------------------

  it("builds with default schema when .schema() not called (empty facts)", () => {
    // The builder initializes with a default empty schema, so build() succeeds
    const mod = module("no-schema").build();
    expect(mod.id).toBe("no-schema");
    expect(mod.schema.facts).toEqual({});
  });

  it("throws when build() called with schema missing facts", () => {
    expect(() =>
      module("no-facts")
        .schema({ derivations: {}, events: {}, requirements: {} } as any)
        .build(),
    ).toThrow(/requires a schema/);
  });

  it("throws when schema.derivations keys are missing from derive()", () => {
    expect(() =>
      module("missing-derive")
        .schema(counterSchema)
        .events({ increment: vi.fn(), reset: vi.fn() })
        .build(),
    ).toThrow(/missing derivation implementations.*doubled/);
  });

  it("throws when schema.events keys are missing from events()", () => {
    expect(() =>
      module("missing-events")
        .schema(counterSchema)
        .derive({ doubled: (f: any) => f.count * 2 })
        .build(),
    ).toThrow(/missing event handler implementations.*increment/);
  });

  it("does not throw when schema has empty derivations and events", () => {
    const mod = module("empty")
      .schema({
        facts: { x: { _type: 0 } },
        derivations: {},
        events: {},
        requirements: {},
      })
      .build();

    expect(mod.id).toBe("empty");
  });

  // ---- overwrite behavior -------------------------------------------------

  it("last call wins when setting same property twice", () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    const mod = module("overwrite")
      .schema(counterSchema)
      .init(fn1)
      .init(fn2)
      .derive({ doubled: (f: any) => f.count * 2 })
      .events({ increment: vi.fn(), reset: vi.fn() })
      .build();

    expect(mod.init).toBe(fn2);
  });

  // ---- optional sections --------------------------------------------------

  it("effects, constraints, resolvers, hooks default to undefined", () => {
    const mod = module("minimal-full")
      .schema(counterSchema)
      .derive({ doubled: (f: any) => f.count * 2 })
      .events({ increment: vi.fn(), reset: vi.fn() })
      .build();

    expect(mod.effects).toBeUndefined();
    expect(mod.constraints).toBeUndefined();
    expect(mod.resolvers).toBeUndefined();
    expect(mod.hooks).toBeUndefined();
  });
});
