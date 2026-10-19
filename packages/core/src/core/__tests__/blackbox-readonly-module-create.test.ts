import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createModule,
  createModuleFactory,
  createSystem,
  t,
} from "../../index.js";

// Black-box tests: createModule – what it hands back, what it refuses, and
// what it warns about in development. Public API only. Warnings are matched by
// a key phrase, never by their full text.

afterEach(() => {
  vi.restoreAllMocks();
});

function warnings() {
  const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

  return {
    all: () => spy.mock.calls.map((call) => String(call[0])),
    matching: (re: RegExp) =>
      spy.mock.calls.map((call) => String(call[0])).filter((m) => re.test(m)),
  };
}

const base = {
  schema: {
    facts: { count: t.number() },
  },
};

const create = createModule as unknown as (id: unknown, config: unknown) => any;

describe("what createModule hands back", () => {
  it("keeps the id, schema, init, meta and history it was given", () => {
    const init = () => undefined;
    const meta = { label: "Counter" };
    const history = { snapshotEvents: ["bump"] };
    const mod = create("counter", {
      schema: { facts: { count: t.number() }, events: { bump: {} } },
      init,
      events: { bump: () => undefined },
      meta,
      history,
    });

    expect(mod.id).toBe("counter");
    expect(mod.schema.facts.count).toBeDefined();
    expect(mod.init).toBe(init);
    expect(mod.meta).toEqual({ label: "Counter" });
    expect(mod.history).toEqual({ snapshotEvents: ["bump"] });
  });

  it("fills in empty derive and events when none are given", () => {
    const mod = create("plain", base);

    expect(mod.derive).toEqual({});
    expect(mod.events).toEqual({});
  });

  it("leaves the optional parts undefined when they are not given", () => {
    const mod = create("plain", base);

    expect(mod.effects).toBeUndefined();
    expect(mod.constraints).toBeUndefined();
    expect(mod.resolvers).toBeUndefined();
    expect(mod.hooks).toBeUndefined();
    expect(mod.meta).toBeUndefined();
    expect(mod.history).toBeUndefined();
    expect(mod.crossModuleDeps).toBeUndefined();
    expect(mod.init).toBeUndefined();
  });

  it("passes derive, events, effects, constraints, resolvers and hooks through", () => {
    const derive = { double: (facts: any) => facts.count * 2 };
    const events = { bump: () => undefined };
    const effects = { log: { run: () => undefined } };
    const constraints = {
      low: { when: () => false, require: { type: "TOP_UP" } },
    };
    const resolvers = {
      topUp: { requirement: "TOP_UP", resolve: async () => undefined },
    };
    const hooks = { onResolverError: () => undefined };
    const mod = create("full", {
      schema: {
        facts: { count: t.number() },
        derivations: { double: t.number() },
        events: { bump: {} },
        requirements: { TOP_UP: {} },
      },
      derive,
      events,
      effects,
      constraints,
      resolvers,
      hooks,
    });

    expect(mod.derive).toBe(derive);
    expect(mod.events).toBe(events);
    expect(mod.effects).toBe(effects);
    expect(mod.constraints).toBe(constraints);
    expect(mod.resolvers).toBe(resolvers);
    expect(mod.hooks).toBe(hooks);
  });

  it("keeps crossModuleDeps when given", () => {
    const authSchema = { facts: { token: t.string() } };
    const mod = create("data", {
      schema: { facts: { items: t.array<string>() } },
      crossModuleDeps: { auth: authSchema },
    });

    expect(mod.crossModuleDeps).toEqual({ auth: authSchema });
  });

  it("builds a working module", async () => {
    const mod = createModule("counter", {
      schema: {
        facts: { count: t.number() },
        derivations: { double: t.number() },
        events: { bump: {} },
      },
      init: (facts) => {
        facts.count = 1;
      },
      derive: { double: (facts) => facts.count * 2 },
      events: {
        bump: (facts) => {
          facts.count += 1;
        },
      },
    });
    const system = createSystem({ module: mod });
    await system.start();
    system.events.bump();
    await system.settle();

    expect(system.facts.count).toBe(2);
    expect(system.derive.double).toBe(4);
    await system.destroy();
  });

  it("a module factory makes one module per name", () => {
    const factory = createModuleFactory(base as never) as (name: string) => any;
    const one = factory("one");
    const two = factory("two");

    expect(one.id).toBe("one");
    expect(two.id).toBe("two");
    expect(one.schema).toBe(two.schema);
  });

  it("a module factory keeps crossModuleDeps", () => {
    const factory = createModuleFactory({
      schema: { facts: { x: t.number() } },
      crossModuleDeps: { auth: { facts: { token: t.string() } } },
    } as never) as (name: string) => any;

    expect(Object.keys(factory("a").crossModuleDeps)).toEqual(["auth"]);
  });
});

describe("definitions createModule refuses, in every build", () => {
  it.each(["self", "prev", "current"])("a fact named %s", (name) => {
    expect(() =>
      create("m", { schema: { facts: { [name]: t.number() } } }),
    ).toThrow(/reserved/);
  });

  it("a fact named after a crossModuleDeps namespace", () => {
    expect(() =>
      create("m", {
        schema: { facts: { auth: t.number() } },
        crossModuleDeps: { auth: { facts: { token: t.string() } } },
      }),
    ).toThrow(/auth/);
  });

  it("a fact that is not named after a namespace is fine", () => {
    expect(() =>
      create("m", {
        schema: { facts: { user: t.number() } },
        crossModuleDeps: { auth: { facts: { token: t.string() } } },
      }),
    ).not.toThrow();
  });

  it("an explicitly undefined crossModuleDeps is the same as none", () => {
    expect(() =>
      create("m", { ...base, crossModuleDeps: undefined }),
    ).not.toThrow();
  });

  it("a fact name with spaces is an ordinary name", () => {
    expect(() =>
      create("m", { schema: { facts: { "Stryker was here": t.number() } } }),
    ).not.toThrow();
  });

  it("a module with no facts at all", () => {
    expect(() => create("m", { schema: { facts: {} } })).not.toThrow();
  });

  it.each(["__proto__", "constructor", "prototype", "$store"])(
    "an abortOn entry %s",
    (key) => {
      expect(() =>
        create("m", {
          ...base,
          constraints: {
            c: { when: () => false, require: { type: "X" }, abortOn: [key] },
          },
        }),
      ).toThrow(/abortOn/);
    },
  );

  it.each(["__proto__", "constructor", "prototype", "$store"])(
    "a bind entry %s",
    (key) => {
      expect(() =>
        create("m", {
          ...base,
          constraints: {
            c: { when: () => false, require: { type: "X" }, bind: [key] },
          },
        }),
      ).toThrow(/bind/);
    },
  );

  it("an ordinary abortOn and bind are fine", () => {
    expect(() =>
      create("m", {
        ...base,
        constraints: {
          c: {
            when: () => false,
            require: { type: "X" },
            abortOn: ["count"],
            bind: ["count"],
          },
        },
      }),
    ).not.toThrow();
  });

  it("constraints that are empty or have no abortOn or bind are fine", () => {
    expect(() =>
      create("m", {
        ...base,
        constraints: { c: undefined, d: null, e: { when: () => false } },
      }),
    ).not.toThrow();
    expect(() => create("m", { ...base, constraints: {} })).not.toThrow();
  });

  it("a fact key carrying the unit separator", () => {
    expect(() =>
      create("m", { schema: { facts: { "a\u001Fb": t.number() } } }),
    ).toThrow(/fact key '/);
  });

  it("a derivation name carrying the unit separator", () => {
    expect(() =>
      create("m", { ...base, derive: { "\u001Fx": () => 1 } }),
    ).toThrow(/derivation '/);
  });
});

describe("what createModule warns about in development", () => {
  it("a module id that is not a non-empty string", () => {
    for (const id of ["", 5, undefined, null, {}]) {
      const w = warnings();
      create(id, base);

      expect(w.matching(/non-empty string/i)).toHaveLength(1);
      expect(w.matching(/kebab/i)).toHaveLength(0);
      vi.restoreAllMocks();
    }
  });

  it("a module id that is not kebab-case", () => {
    for (const id of ["My_Module", "9lives", "has space", "a.b", "-lead"]) {
      const w = warnings();
      create(id, base);

      expect(w.matching(/kebab/i)).toHaveLength(1);
      vi.restoreAllMocks();
    }
  });

  it("module ids that are fine", () => {
    for (const id of [
      "counter",
      "my-module",
      "Counter",
      "a1-b2",
      "__internal",
      "__internal-mod_2",
      "__a-b_c",
    ]) {
      const w = warnings();
      create(id, base);

      expect(w.all()).toEqual([]);
      vi.restoreAllMocks();
    }
  });

  it("a missing schema", () => {
    const w = warnings();
    create("m", {});

    expect(w.matching(/schema is required/i)).toHaveLength(1);
    expect(w.matching(/facts is required/i)).toHaveLength(0);
  });

  it("a schema without facts", () => {
    const w = warnings();
    create("m", { schema: { derivations: { x: t.number() } } });

    expect(w.matching(/facts is required/i)).toHaveLength(1);
    expect(w.matching(/directly/i)).toHaveLength(0);
  });

  it("facts declared directly under schema", () => {
    const w = warnings();
    create("m", { schema: { count: t.number(), name: t.string() } });

    expect(w.matching(/directly/i)).toHaveLength(1);
    expect(w.matching(/facts is required/i)).toHaveLength(1);
  });

  it("facts declared directly, among other things", () => {
    for (const schema of [
      { first: 5, count: t.number() },
      { first: null, count: t.number() },
      { first: "text", second: undefined, count: t.number() },
      { first: () => 1, count: t.number() },
      { first: {}, count: t.number() },
    ]) {
      const w = warnings();
      create("m", { schema });

      expect(w.matching(/directly/i)).toHaveLength(1);
      vi.restoreAllMocks();
    }
  });

  it("a schema without facts and nothing that looks like one", () => {
    for (const schema of [
      { a: 5, b: "text" },
      { a: null },
      { a: { notAType: 1 }, b: [] },
    ]) {
      const w = warnings();
      create("m", { schema });

      expect(w.matching(/directly/i)).toHaveLength(0);
      expect(w.matching(/facts is required/i)).toHaveLength(1);
      vi.restoreAllMocks();
    }
  });

  it("a derivation with no declaration, and a declaration with no derivation", () => {
    const w = warnings();
    create("m", {
      schema: {
        facts: { count: t.number() },
        derivations: { unbuilt: t.number() },
      },
      derive: { orphan: () => 1 },
    });

    expect(
      w.matching(/"orphan" not declared in schema\.derivations/i),
    ).toHaveLength(1);
    expect(w.matching(/schema\.derivations\["unbuilt"\]/)).toHaveLength(1);
  });

  it("derivations that line up", () => {
    const w = warnings();
    create("m", {
      schema: {
        facts: { count: t.number() },
        derivations: { double: t.number() },
      },
      derive: { double: () => 1 },
    });

    expect(w.all()).toEqual([]);
  });

  it("an event with no declaration, and a declaration with no handler", () => {
    const w = warnings();
    create("m", {
      schema: { facts: { count: t.number() }, events: { unbuilt: {} } },
      events: { orphan: () => undefined },
    });

    expect(w.matching(/"orphan" not declared in schema\.events/i)).toHaveLength(
      1,
    );
    expect(w.matching(/schema\.events\["unbuilt"\]/)).toHaveLength(1);
  });

  it("history.snapshotEvents naming an event the schema does not declare", () => {
    const w = warnings();
    create("m", {
      schema: {
        facts: { count: t.number() },
        events: { bump: {}, reset: {} },
      },
      events: { bump: () => undefined, reset: () => undefined },
      history: { snapshotEvents: ["bump", "typo"] },
    });
    const found = w.matching(/snapshotEvents/);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/typo/);
    expect(found[0]).toMatch(/bump/);
    expect(found[0]).toMatch(/reset/);
  });

  it("history.snapshotEvents naming an event when no events are declared", () => {
    const w = warnings();
    create("m", {
      schema: { facts: { count: t.number() } },
      history: { snapshotEvents: ["typo"] },
    });
    const found = w.matching(/snapshotEvents/);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/none/i);
  });

  it("an empty history.snapshotEvents", () => {
    const w = warnings();
    create("m", { ...base, history: { snapshotEvents: [] } });

    expect(w.matching(/empty/i).length).toBeGreaterThanOrEqual(1);
  });

  it("history.snapshotEvents that are all declared", () => {
    const w = warnings();
    create("m", {
      schema: { facts: { count: t.number() }, events: { bump: {} } },
      events: { bump: () => undefined },
      history: { snapshotEvents: ["bump"] },
    });

    expect(w.matching(/snapshotEvents/)).toEqual([]);
    expect(w.all()).toEqual([]);
  });

  it("history.snapshotEvents with no schema at all warns instead of throwing", () => {
    const w = warnings();

    expect(() =>
      create("m", { history: { snapshotEvents: ["bump"] } }),
    ).not.toThrow();
    expect(w.matching(/schema is required/i)).toHaveLength(1);
  });

  it("a resolver for a requirement the schema does not declare", () => {
    const w = warnings();
    create("m", {
      schema: {
        facts: { count: t.number() },
        requirements: { TOP_UP: {}, DRAIN: {} },
      },
      resolvers: {
        typo: { requirement: "TOP_UPP", resolve: async () => undefined },
      },
    });
    const found = w.matching(/TOP_UPP/);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/typo/);
    expect(found[0]).toMatch(/TOP_UP\b/);
    expect(found[0]).toMatch(/DRAIN/);
  });

  it("a resolver for a requirement when none are declared", () => {
    const w = warnings();
    create("m", {
      schema: { facts: { count: t.number() }, requirements: {} },
      resolvers: {
        r: { requirement: "ANY", resolve: async () => undefined },
      },
    });
    const found = w.matching(/ANY/);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/none/i);
  });

  it("resolvers whose requirement is declared, or not named by a string", () => {
    const w = warnings();
    create("m", {
      schema: {
        facts: { count: t.number() },
        requirements: { TOP_UP: {} },
      },
      resolvers: {
        ok: { requirement: "TOP_UP", resolve: async () => undefined },
        byFn: {
          requirement: (req: { type: string }) => req.type === "TOP_UP",
          resolve: async () => undefined,
        },
        unnamed: { resolve: async () => undefined },
      },
    });

    expect(w.all()).toEqual([]);
  });

  it("resolvers with no schema at all do not throw", () => {
    warnings();

    expect(() =>
      create("m", {
        resolvers: { r: { requirement: "X", resolve: async () => undefined } },
      }),
    ).not.toThrow();
  });

  it("a well-formed module warns about nothing", () => {
    const w = warnings();
    create("m", {
      schema: {
        facts: { count: t.number() },
        derivations: { double: t.number() },
        events: { bump: {} },
        requirements: { TOP_UP: {} },
      },
      init: () => undefined,
      derive: { double: () => 2 },
      events: { bump: () => undefined },
      constraints: {
        low: { when: () => false, require: { type: "TOP_UP" } },
      },
      resolvers: {
        topUp: { requirement: "TOP_UP", resolve: async () => undefined },
      },
      history: { snapshotEvents: ["bump"] },
    });

    expect(w.all()).toEqual([]);
  });
});
