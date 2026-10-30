import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

// Black-box tests for what happens to a module when it joins a composed
// (namespaced) system: dangerous keys are refused, and constraint, event,
// derivation, effect and resolver definitions keep their meaning under the
// module's name. Data forms (predicate `when`, `patch`, `compute`) are left to
// the layers that build them.
// Public API only; outcomes, not message text.

afterEach(() => {
  vi.restoreAllMocks();
});

function quiet() {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

const settle = async (system: any) => {
  await system.settle();
  await new Promise((r) => setTimeout(r, 0));
  await system.settle();
};

const BLOCKED = ["__proto__", "constructor", "prototype"];

function config(over: Record<string, unknown> = {}, facts: object = {}) {
  return {
    schema: {
      facts: { n: t.number(), ...facts },
      derivations: {},
      events: {},
      requirements: {},
    },
    init: (f: any) => {
      f.n = 0;
    },
    ...over,
  };
}

// The dangerous key goes in after createModule, which would turn some of these
// away itself in development: what is under test is the composed system.
const SECTIONS: Record<string, (mod: any, key: string) => any> = {
  "schema facts": (mod, key) => ({
    ...mod,
    schema: {
      ...mod.schema,
      facts: { ...mod.schema.facts, [key]: t.number() },
    },
  }),
  events: (mod, key) => ({
    ...mod,
    schema: { ...mod.schema, events: { [key]: {} } },
    events: { [key]: () => undefined },
  }),
  derive: (mod, key) => ({
    ...mod,
    schema: { ...mod.schema, derivations: { [key]: t.number() } },
    derive: { [key]: () => 1 },
  }),
  effects: (mod, key) => ({
    ...mod,
    effects: { [key]: { run: () => undefined } },
  }),
  constraints: (mod, key) => ({
    ...mod,
    constraints: { [key]: { when: () => false, require: { type: "X" } } },
  }),
  resolvers: (mod, key) => ({
    ...mod,
    resolvers: {
      [key]: { requirement: "X", resolve: async () => undefined },
    },
  }),
};

describe("a module joining a composed system", () => {
  it("builds when no section holds a prototype-walking key", () => {
    expect(() =>
      createSystem({
        modules: { m: createModule("m", config() as any) },
      } as never),
    ).not.toThrow();
  });

  for (const [section, make] of Object.entries(SECTIONS)) {
    for (const key of BLOCKED) {
      it(`is refused for "${key}" in ${section}`, () => {
        const bad = make(createModule("m", config() as any), key);

        expect(() => createSystem({ modules: { m: bad } } as never)).toThrow(
          Error,
        );
      });
    }
  }

  it("is refused when only the second module is dangerous", () => {
    const good = createModule("good", config() as any);
    const make = SECTIONS.events as (mod: any, key: string) => any;
    const bad = make(createModule("bad", config() as any), "constructor");

    expect(() => createSystem({ modules: { good, bad } } as never)).toThrow(
      Error,
    );
  });
});

describe("function-form constraints in a composed system", () => {
  it("hands `when` and `require` the module's own facts and its dependencies by name", async () => {
    const fired: string[] = [];
    const authSchema = { facts: { token: t.string() } };
    const auth = createModule("auth", {
      schema: authSchema,
      init: (f: any) => {
        f.token = "tok";
      },
    } as any);
    const traffic = createModule("traffic", {
      schema: {
        facts: { phase: t.string(), elapsed: t.number() },
        derivations: {},
        events: {},
        requirements: { FIRE: { name: t.string() } },
      },
      crossModuleDeps: { auth: authSchema },
      init: (f: any) => {
        f.phase = "red";
        f.elapsed = 31;
      },
      constraints: {
        fn: {
          when: (f: any) => f.self.phase === "red" && f.auth.token === "tok",
          require: (f: any) => ({ type: "FIRE", name: `fn-${f.self.elapsed}` }),
        },
      },
      resolvers: {
        fire: {
          requirement: "FIRE",
          resolve: async (req: any) => {
            fired.push(req.name);
          },
        },
      },
    } as any);
    const system = createSystem({ modules: { auth, traffic } } as never) as any;
    system.start();
    await settle(system);
    expect(fired).toEqual(["fn-31"]);

    system.facts.traffic.phase = "green";
    await settle(system);
    system.facts.traffic.elapsed = 40;
    system.facts.traffic.phase = "red";
    await settle(system);
    expect(fired).toEqual(["fn-31", "fn-40"]);

    system.facts.auth.token = "other";
    await settle(system);
    system.facts.traffic.elapsed = 50;
    await settle(system);
    expect(fired).toEqual(["fn-31", "fn-40"]);
  });
});

describe("data-form constraint `when` in a composed system", () => {
  const authSchema = { facts: { token: t.string() } };

  function build(fired: string[]) {
    const auth = createModule("auth", {
      schema: authSchema,
      init: (f: any) => {
        f.token = "tok";
      },
    } as any);
    const clause = (name: string, when: unknown) => [
      name,
      { when, require: { type: "FIRE", name } },
    ];
    const traffic = createModule("traffic", {
      schema: {
        facts: { phase: t.string(), elapsed: t.number() },
        derivations: {},
        events: {},
        requirements: { FIRE: { name: t.string() } },
      },
      crossModuleDeps: { auth: authSchema },
      init: (f: any) => {
        f.phase = "red";
        f.elapsed = 31;
      },
      constraints: Object.fromEntries([
        clause("object", { phase: "red", elapsed: { $gte: 30 } }),
        clause("any", {
          $any: [{ phase: "yellow" }, { elapsed: { $gte: 60 } }],
        }),
        clause("notGreen", { $not: { phase: "green" } }),
        clause("allFalse", {
          $all: [{ phase: "red" }, { elapsed: { $lt: 10 } }],
        }),
        clause("array", [
          { fact: "phase", op: "$eq", value: "red" },
          { fact: "elapsed", op: "$gte", value: 30 },
        ]),
        clause("arrayPrefixed", [
          { fact: "auth::token", op: "$eq", value: "tok" },
        ]),
        clause("selfPivot", { self: { phase: "red" } }),
        clause("depPivot", { auth: { token: { $exists: true } } }),
        clause("prefixed", { "auth::token": { $ne: "" } }),
        clause("nested", {
          $all: [{ $not: { phase: "green" } }, { self: { elapsed: 31 } }],
        }),
        [
          "fn",
          {
            when: (f: any) => f.self.phase === "red",
            require: (f: any) => ({
              type: "FIRE",
              name: `fn-${f.self.elapsed}`,
            }),
          },
        ],
      ]),
      resolvers: {
        fire: {
          requirement: "FIRE",
          resolve: async (req: any) => {
            fired.push(req.name);
          },
        },
      },
    } as any);

    return createSystem({ modules: { auth, traffic } } as never) as any;
  }

  it("evaluates every form against the module's own facts", async () => {
    const fired: string[] = [];
    const system = build(fired);
    system.start();
    await settle(system);

    expect([...fired].sort()).toEqual([
      "array",
      "arrayPrefixed",
      "depPivot",
      "fn-31",
      "nested",
      "notGreen",
      "object",
      "prefixed",
      "selfPivot",
    ]);
  });

  it("re-evaluates when the facts it reads change", async () => {
    const fired: string[] = [];
    const system = build(fired);
    system.start();
    await settle(system);
    fired.length = 0;

    system.facts.traffic.elapsed = 70;
    await settle(system);
    expect(fired).toContain("any");
    expect(fired).not.toContain("allFalse");

    fired.length = 0;
    system.facts.traffic.phase = "green";
    await settle(system);
    system.facts.traffic.phase = "red";
    await settle(system);
    expect(fired).toContain("notGreen");
    expect(fired).toContain("object");
    expect(fired).not.toContain("allFalse");
  });

  it("does not read another module's fact of the same name", async () => {
    const fired: string[] = [];
    const system = build(fired);
    system.start();
    await settle(system);
    fired.length = 0;

    system.facts.auth.token = "";
    await settle(system);
    system.facts.auth.token = "again";
    await settle(system);

    expect(fired).toContain("prefixed");
    expect(fired).not.toContain("depPivot");
    expect(fired).not.toContain("allFalse");
  });
});

describe("object-form events in a composed system", () => {
  function build() {
    const m = createModule("m", {
      schema: {
        facts: { status: t.string(), count: t.number(), flag: t.boolean() },
        derivations: {},
        events: {
          both: { value: t.string() },
          viaHandler: { value: t.string() },
          plain: {},
        },
      },
      init: (f: any) => {
        f.status = "";
        f.count = 0;
        f.flag = false;
      },
      events: {
        both: {
          handler: (f: any, e: any) => {
            f.status = `handler:${e.value}`;
          },
          patch: { $set: { status: "patch" } },
        },
        viaHandler: {
          handler: (f: any, e: any) => {
            f.status = `object:${e.value}`;
          },
        },
        plain: (f: any) => {
          f.count = f.count + 1;
        },
      },
    } as any);
    const other = createModule("other", config() as any);

    return createSystem({ modules: { m, other } } as never) as any;
  }

  it("keeps the handler when an event gives both a handler and a patch", async () => {
    quiet();
    const system = build();
    system.start();
    await settle(system);

    system.events.m.both({ value: "x" });
    await settle(system);

    expect(system.facts.m.status).toBe("handler:x");
  });

  it("runs an event given as an object with a handler, and a bare function", async () => {
    quiet();
    const system = build();
    system.start();
    await settle(system);

    system.events.m.viaHandler({ value: "y" });
    system.events.m.plain();
    system.events.m.plain();
    await settle(system);

    expect(system.facts.m.status).toBe("object:y");
    expect(system.facts.m.count).toBe(2);
  });
});

describe("derivations, effects and flat access in a composed system", () => {
  it("computes a derivation given as an object with a compute function", async () => {
    const m = createModule("m", {
      schema: {
        facts: { n: t.number() },
        derivations: { doubled: t.number(), plain: t.number() },
        events: {},
      },
      init: (f: any) => {
        f.n = 4;
      },
      derive: {
        doubled: { compute: (f: any) => f.n * 2 },
        plain: (f: any) => f.n,
      },
    } as any);
    const system = createSystem({
      modules: { m, other: createModule("other", config() as any) },
    } as never) as any;
    system.start();
    await settle(system);

    expect(system.derive.m.doubled).toBe(8);
    expect(system.derive.m.plain).toBe(4);
    system.facts.m.n = 5;
    expect(system.derive.m.doubled).toBe(10);
  });

  it("runs a module's effect against its own facts and reruns it on change", async () => {
    const seen: number[] = [];
    const m = createModule("m", {
      schema: { facts: { n: t.number() }, derivations: {}, events: {} },
      init: (f: any) => {
        f.n = 0;
      },
      effects: {
        watch: {
          run: (f: any) => {
            seen.push(f.n);
          },
        },
      },
    } as any);
    const system = createSystem({
      modules: { m, other: createModule("other", config() as any) },
    } as never) as any;
    system.start();
    await settle(system);
    system.facts.m.n = 1;
    await settle(system);
    system.facts.other.n = 9;
    await settle(system);
    system.facts.m.n = 2;
    await settle(system);

    expect(seen).toEqual([0, 1, 2]);
  });

  it("reads a module's own facts by bare name when crossModuleDeps is empty", async () => {
    const m = createModule("m", {
      schema: {
        facts: { n: t.number() },
        derivations: { flat: t.any() },
        events: {},
      },
      crossModuleDeps: {},
      init: (f: any) => {
        f.n = 4;
      },
      derive: { flat: (f: any) => f.n },
    } as any);
    const system = createSystem({
      modules: { m, other: createModule("other", config() as any) },
    } as never) as any;
    system.start();
    await settle(system);

    expect(system.derive.m.flat).toBe(4);
  });
});

describe("constraints and resolvers in a composed system", () => {
  it("re-evaluates a constraint with explicit deps only when those facts change", async () => {
    const evals: string[] = [];
    const job = createModule("job", {
      schema: {
        facts: { count: t.number(), noise: t.number() },
        derivations: {},
        events: {},
        requirements: { RUN: {} },
      },
      init: (f: any) => {
        f.count = 0;
        f.noise = 0;
      },
      constraints: {
        watched: {
          deps: ["count"],
          when: () => {
            evals.push("watched");

            return false;
          },
          require: { type: "RUN" },
        },
      },
      resolvers: {
        run: { requirement: "RUN", resolve: async () => undefined },
      },
    } as any);
    const system = createSystem({
      modules: { job, other: createModule("other", config() as any) },
    } as never) as any;
    system.start();
    await settle(system);
    const baseline = evals.length;
    expect(baseline).toBeGreaterThan(0);

    system.facts.job.noise = 1;
    await settle(system);
    expect(evals.length).toBe(baseline);

    system.facts.job.count = 1;
    await settle(system);
    expect(evals.length).toBeGreaterThan(baseline);
  });

  it("holds a constraint back until the constraints it follows have resolved", async () => {
    const order: string[] = [];
    const gate = createModule("gate", {
      schema: {
        facts: { go: t.boolean() },
        derivations: {},
        events: {},
        requirements: { STEP: { name: t.string() } },
      },
      init: (f: any) => {
        f.go = true;
      },
      constraints: {
        first: {
          when: (f: any) => f.go,
          require: { type: "STEP", name: "first" },
        },
        second: {
          after: ["first"],
          when: (f: any) => f.go,
          require: { type: "STEP", name: "second" },
        },
      },
      resolvers: {
        step: {
          requirement: "STEP",
          resolve: async (req: any) => {
            order.push(`start:${req.name}`);
            await new Promise((r) =>
              setTimeout(r, req.name === "first" ? 30 : 0),
            );
            order.push(`end:${req.name}`);
          },
        },
      },
    } as any);
    const system = createSystem({
      modules: { gate, other: createModule("other", config() as any) },
    } as never) as any;
    system.start();
    await vi.waitFor(() => expect(order.length).toBe(4), { timeout: 5000 });
    await settle(system);

    expect(order).toEqual([
      "start:first",
      "end:first",
      "start:second",
      "end:second",
    ]);
  });

  it("hands a resolver its own facts, and ctx.deps only when the module declares dependencies", async () => {
    const seen: Record<string, unknown> = {};
    const authSchema = { facts: { token: t.string() } };
    const auth = createModule("auth", {
      schema: authSchema,
      init: (f: any) => {
        f.token = "tok";
      },
    } as any);
    const make = (id: string, deps: boolean) =>
      createModule(id, {
        schema: {
          facts: { n: t.number() },
          derivations: {},
          events: {},
          requirements: { [`GO_${id}`]: {} },
        },
        ...(deps ? { crossModuleDeps: { auth: authSchema } } : {}),
        init: (f: any) => {
          f.n = 1;
        },
        constraints: {
          go: {
            when: (f: any) => (deps ? f.self.n === 1 : f.n === 1),
            require: { type: `GO_${id}` },
          },
        },
        resolvers: {
          go: {
            requirement: `GO_${id}`,
            resolve: async (_req: unknown, ctx: any) => {
              seen[id] = {
                hasDeps: "deps" in ctx,
                depToken: ctx.deps?.auth?.token,
                n: ctx.facts.n,
                signal: ctx.signal instanceof AbortSignal,
              };
              ctx.facts.n = 2;
            },
          },
        },
      } as any);
    const system = createSystem({
      modules: {
        auth,
        withDeps: make("withDeps", true),
        plain: make("plain", false),
      },
    } as never) as any;
    system.start();
    await settle(system);

    expect(seen.withDeps).toEqual({
      hasDeps: true,
      depToken: "tok",
      n: 1,
      signal: true,
    });
    expect(seen.plain).toEqual({
      hasDeps: false,
      depToken: undefined,
      n: 1,
      signal: true,
    });
    expect(system.facts.withDeps.n).toBe(2);
    expect(system.facts.plain.n).toBe(2);
  });
});

describe("more than one module with crossModuleDeps in a composed system", () => {
  it("gives each module its own view of itself and of what it declared", async () => {
    const vSchema = { facts: { v: t.number() } };
    const make = (id: string, value: number, deps: string[]) => {
      const crossModuleDeps = Object.fromEntries(deps.map((d) => [d, vSchema]));

      return createModule(id, {
        schema: {
          facts: { v: t.number() },
          derivations: { view: t.any() },
          events: {},
        },
        ...(deps.length > 0 ? { crossModuleDeps } : {}),
        init: (f: any) => {
          f.v = value;
        },
        derive: {
          view: (f: any) =>
            deps.length > 0
              ? {
                  self: f.self.v,
                  seen: Object.fromEntries(deps.map((d) => [d, f[d]?.v])),
                  keys: Object.keys(f),
                }
              : { self: f.v },
        },
      } as any);
    };
    const system = createSystem({
      modules: {
        base: make("base", 1, []),
        a: make("a", 2, ["base"]),
        b: make("b", 3, ["base", "a"]),
        c: make("c", 4, ["a", "b"]),
      },
    } as never) as any;
    system.start();
    await settle(system);

    expect(system.derive.a.view).toEqual({
      self: 2,
      seen: { base: 1 },
      keys: ["self", "base"],
    });
    expect(system.derive.b.view).toEqual({
      self: 3,
      seen: { base: 1, a: 2 },
      keys: ["self", "base", "a"],
    });
    expect(system.derive.c.view).toEqual({
      self: 4,
      seen: { a: 2, b: 3 },
      keys: ["self", "a", "b"],
    });
    system.facts.a.v = 20;
    expect(system.derive.b.view.seen).toEqual({ base: 1, a: 20 });
    expect(system.derive.c.view.seen).toEqual({ a: 20, b: 3 });
  });
});

describe("a bare module in a composed system", () => {
  it("joins with no init, derivations, events, effects, constraints or resolvers", async () => {
    const bare = createModule("bare", {
      schema: { facts: { n: t.number() } },
    } as any);
    const system = createSystem({
      modules: { bare, other: createModule("other", config() as any) },
    } as never) as any;
    system.start();
    await settle(system);

    expect(system.facts.bare.n).toBeUndefined();
    system.facts.bare.n = 3;
    expect(system.facts.bare.n).toBe(3);
    expect(Object.keys(system.derive.bare)).toEqual([]);
    expect(Object.keys(system.facts.other)).toEqual(["n"]);
  });
});
