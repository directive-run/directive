// Ported from packages/core/src/core/__tests__/blackbox-cross-module-deps.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// Black-box tests: which modules a module can see through crossModuleDeps, and
// that each declared name maps to the right module. Four modules (a, b, c, d)
// hold different values so a swapped or leaked view changes what is read.
// Public API only.

const vSchema = { facts: { v: t.number() } };

function leaf(name: string, value: number) {
  return createModule(name, {
    schema: vSchema,
    init: (f) => {
      f.v = value;
    },
  });
}

function warnings(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((c) => String(c[0])).join("\n");
}

function build(deps: Record<string, typeof vSchema>, extra: object = {}) {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const seen: Record<string, unknown> = {};
  const a = createModule("a", {
    schema: {
      facts: { v: t.number(), tick: t.number() },
      derivations: { view: t.any() },
      events: { poke: {} },
    },
    crossModuleDeps: deps,
    init: (f: any) => {
      f.v = 10;
      f.tick = 0;
    },
    derive: {
      view: (f: any) => ({
        self: f.self?.v,
        b: f.b?.v,
        c: f.c?.v,
        d: f.d?.v,
        flat: f.v,
      }),
    },
    effects: {
      watch: {
        deps: ["tick"],
        run: (f: any) => {
          seen.self = f.self?.v;
          seen.b = f.b?.v;
          seen.c = f.c?.v;
          seen.d = f.d?.v;
        },
      },
    },
    events: {
      poke: (f: any) => {
        f.tick = f.tick + 1;
      },
    },
    ...extra,
  } as never);
  const system = createSystem({
    modules: { a, b: leaf("b", 20), c: leaf("c", 30), d: leaf("d", 40) },
  } as never) as any;
  system.start();

  return { system, seen, warn };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a module sees exactly its declared dependencies", () => {
  it("a derivation reads declared deps and not an undeclared module", async () => {
    const { system, warn } = build({ b: vSchema });
    await system.settle();

    const view = system.read("a.view");
    expect(view.self).toBe(10);
    expect(view.b).toBe(20);
    // c and d exist in the system but were not declared.
    expect(view.c).toBeUndefined();
    expect(view.d).toBeUndefined();
    expect(warnings(warn)).toMatch(/undeclared cross-module/);
    system.destroy();
  });

  it("an effect reads declared deps and not an undeclared module", async () => {
    const { system, seen } = build({ b: vSchema });
    await system.settle();

    expect(seen).toMatchObject({ self: 10, b: 20 });
    expect(seen.c).toBeUndefined();
    expect(seen.d).toBeUndefined();
    system.destroy();
  });

  it("the flat own-fact name is not a view in a module with deps", async () => {
    const { system } = build({ b: vSchema });
    await system.settle();

    expect(system.read("a.view").flat).toBeUndefined();
    system.destroy();
  });

  it("an event handler sees its own facts flat and no dependency views", async () => {
    const got: Record<string, unknown> = {};
    const { system } = build(
      { b: vSchema },
      {
        events: {
          poke: (f: any) => {
            got.own = f.v;
            got.b = f.b;
            got.d = f.d;
            f.tick = f.tick + 1;
          },
        },
      },
    );
    system.events.a.poke();
    await system.settle();

    expect(got).toEqual({ own: 10, b: undefined, d: undefined });
    system.destroy();
  });

  it("a resolver reads declared deps through ctx.deps and not others", async () => {
    const got: Record<string, unknown> = {};
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const a = createModule("a", {
      schema: {
        facts: { go: t.boolean() },
        requirements: { LOOK: {} },
      },
      crossModuleDeps: { b: vSchema },
      init: (f: any) => {
        f.go = true;
      },
      constraints: {
        look: { when: (f: any) => f.self.go, require: { type: "LOOK" } },
      },
      resolvers: {
        look: {
          requirement: "LOOK",
          resolve: async (_req: unknown, ctx: any) => {
            got.b = ctx.deps.b?.v;
            got.c = ctx.deps.c?.v;
            ctx.facts.go = false;
          },
        },
      },
    } as never);
    const system = createSystem({
      modules: { a, b: leaf("b", 20), c: leaf("c", 30) },
    } as never) as any;
    system.start();
    await system.settle();

    expect(got.b).toBe(20);
    expect(got.c).toBeUndefined();
    expect(warnings(warn)).toMatch(/not in crossModuleDeps/);
    system.destroy();
  });
});

describe("each dependency name maps to the right module", () => {
  it("two declared deps are not swapped, in either declaration order", async () => {
    for (const deps of [
      { b: vSchema, c: vSchema },
      { c: vSchema, b: vSchema },
    ]) {
      const { system, seen } = build(deps);
      await system.settle();

      const view = system.read("a.view");
      expect(view).toMatchObject({ self: 10, b: 20, c: 30 });
      expect(view.d).toBeUndefined();
      expect(seen).toMatchObject({ self: 10, b: 20, c: 30 });
      system.destroy();
    }
  });

  it("a view follows later writes to the module it names", async () => {
    const { system } = build({ b: vSchema, c: vSchema });
    await system.settle();

    system.facts.c.v = 31;
    await system.settle();

    expect(system.read("a.view")).toMatchObject({ self: 10, b: 20, c: 31 });
    system.destroy();
  });
});

describe("self is not confused with a dependency", () => {
  it("self reads this module and deps read the others, same fact name", async () => {
    const { system } = build({ b: vSchema, c: vSchema });
    await system.settle();

    system.facts.a.v = 11;
    await system.settle();

    // All four modules own a fact named `v`; only self moved.
    expect(system.read("a.view")).toMatchObject({ self: 11, b: 20, c: 30 });
    system.destroy();
  });
});

describe("writes through a dependency view", () => {
  it("an effect cannot write a dependency, itself or an undeclared name", async () => {
    const errors: string[] = [];
    const { system } = build(
      { b: vSchema },
      {
        effects: {
          writer: {
            deps: ["tick"],
            run: (f: any) => {
              for (const write of [
                () => {
                  f.b.v = 99;
                },
                () => {
                  f.self.v = 98;
                },
                () => {
                  f.d = { v: 1 };
                },
              ]) {
                try {
                  write();
                } catch (e) {
                  errors.push((e as Error).message);
                }
              }
            },
          },
        },
      },
    );
    await system.settle();

    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatch(/cannot change facts/);
    expect(errors[1]).toMatch(/cannot change facts/);
    expect(system.facts.b.v).toBe(20);
    expect(system.facts.a.v).toBe(10);
    expect(system.facts.d.v).toBe(40);
    system.destroy();
  });

  it("a resolver cannot write a dependency through ctx.deps", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const a = createModule("a", {
      schema: { facts: { go: t.boolean() }, requirements: { WRITE: {} } },
      crossModuleDeps: { b: vSchema },
      init: (f: any) => {
        f.go = true;
      },
      constraints: {
        w: { when: (f: any) => f.self.go, require: { type: "WRITE" } },
      },
      resolvers: {
        w: {
          requirement: "WRITE",
          resolve: async (_req: unknown, ctx: any) => {
            ctx.deps.b.v = 99;
          },
        },
      },
    } as never);
    const system = createSystem({
      modules: { a, b: leaf("b", 20) },
    } as never) as any;
    system.start();
    await system.settle();

    expect(system.facts.b.v).toBe(20);
    void warn;
    system.destroy();
  });
});
