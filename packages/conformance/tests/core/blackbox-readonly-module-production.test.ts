// Ported from packages/core/src/core/__tests__/blackbox-readonly-module-production.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { afterEach, describe, expect, it, vi } from "vitest";

// Production build: the dev flag is the constant `false`.
vi.mock("#is-development", () => ({ default: false }));

const { createModule, createSystem, t } = await import("@directive-run/core");

// Black-box tests: read-only views and createModule in a production build.

afterEach(() => {
  vi.restoreAllMocks();
});

const create = createModule as unknown as (id: unknown, config: unknown) => any;

describe("createModule in production", () => {
  it("does not warn about a badly formed module", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    create("Not_Kebab", {});
    create(5, { schema: { count: t.number() } });
    create("m", {
      schema: {
        facts: { count: t.number() },
        events: { declared: {} },
        requirements: { A: {} },
      },
      events: { other: () => undefined },
      resolvers: { r: { requirement: "B", resolve: async () => undefined } },
      history: { snapshotEvents: [] },
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it("still refuses what is structurally wrong", () => {
    expect(() =>
      create("m", { schema: { facts: { self: t.number() } } }),
    ).toThrow(/reserved/);
    expect(() =>
      create("m", {
        schema: { facts: { x: t.number() } },
        constraints: {
          c: { when: () => false, require: { type: "X" }, abortOn: ["$x"] },
        },
      }),
    ).toThrow(/abortOn/);
    expect(() =>
      create("m", {
        schema: { facts: { x: t.number() } },
        constraints: {
          c: { when: () => false, require: { type: "X" }, bind: ["__proto__"] },
        },
      }),
    ).toThrow(/bind/);
    expect(() =>
      create("m", { schema: { facts: { "a\u001Fb": t.number() } } }),
    ).toThrow(/separator|U\+001F/);
  });

  it("still hands back the module", () => {
    const mod = create("m", { schema: { facts: { count: t.number() } } });

    expect(mod.id).toBe("m");
    expect(mod.derive).toEqual({});
    expect(mod.events).toEqual({});
  });
});

describe("the facts an effect reads through, in production", () => {
  function build(act: (facts: any, prev: any, derived: any) => unknown) {
    const blocked: Array<[string, string]> = [];
    const errors: unknown[] = [];
    const mod = createModule("m", {
      schema: {
        facts: { count: t.number(), obj: t.object<{ x: number }>() },
        derivations: { doubled: t.number() },
      },
      init: (facts: any) => {
        facts.count = 0;
        facts.obj = { x: 1 };
      },
      derive: { doubled: (facts) => facts.count * 2 },
      effects: {
        e: { deps: ["count"], run: act },
      } as never,
    });
    const system = createSystem({
      module: mod,
      plugins: [
        {
          name: "spy",
          onEffectError: (_id: string, error: unknown) => {
            errors.push(error);
          },
          onEffectWriteBlocked: (id: string, key: string) => {
            blocked.push([id, key]);
          },
        },
      ],
    } as never);

    return { system: system as any, blocked, errors };
  }

  it("a delete and a definition are dropped quietly, and reported", async () => {
    const out: Record<string, unknown> = {};
    const { system, blocked, errors } = build((facts) => {
      out.deleted = Reflect.deleteProperty(facts, "count");
      out.defined = Reflect.defineProperty(facts, "count", { value: 9 });
      out.assigned = Reflect.set(facts, "count", 9);
    });
    await system.start();

    expect(errors).toEqual([]);
    expect(system.facts.count).toBe(0);
    expect(out.deleted).toBe(true);
    expect(out.defined).toBe(true);
    expect(out.assigned).toBe(true);
    expect(blocked.map(([, key]) => key)).toEqual(["count", "count", "count"]);
    await system.destroy();
  });

  it("it cannot be made non-extensible or re-prototyped", async () => {
    const out: Record<string, unknown> = {};
    const { system } = build((facts) => {
      try {
        Reflect.preventExtensions(facts);
        Reflect.setPrototypeOf(facts, { inherited: true });
      } catch {
        // a throw or a quiet refusal are both fine
      }
      out.count = facts.count;
      out.inherited = facts.inherited;
    });
    await system.start();

    expect(out.count).toBe(0);
    expect(out.inherited).toBeUndefined();
    expect(system.facts.count).toBe(0);
    await system.destroy();
  });

  it("it lists and tests keys", async () => {
    const out: Record<string, unknown> = {};
    const { system } = build((facts) => {
      out.keys = Object.keys(facts);
      out.has = "count" in facts;
      out.hasNot = "zzz" in facts;
    });
    await system.start();

    expect(out.keys).toEqual(expect.arrayContaining(["count", "obj"]));
    expect(out.has).toBe(true);
    expect(out.hasNot).toBe(false);
    await system.destroy();
  });

  it("null, primitive and nested values read as stored", async () => {
    const seen: unknown[] = [];
    const { system } = build((facts) => {
      seen.push(facts.count, facts.obj);
    });
    await system.start();

    expect(seen[0]).toBe(0);
    expect(seen[1]).toEqual({ x: 1 });
    await system.destroy();
  });

  it("a nested change is not checked for", async () => {
    const { system, blocked, errors } = build((facts) => {
      facts.obj.x = 7;
    });
    await system.start();

    expect(errors).toEqual([]);
    expect(blocked).toEqual([]);
    await system.destroy();
  });
});
