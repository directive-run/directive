// Ported from packages/core/src/core/__tests__/l3-proxies-oracle.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// Black-box tests for what a composed (namespaced) system hands out: the views
// onto each module's facts, derivations and events, the facts a module's own
// code receives, and the views a resolver receives. Public API only. What is
// pinned is what a user can see: reads, writes, deletes, `in`, key lists,
// spreads, and refused writes. Which object a read returns, how a view
// answers a descriptor or prototype query, and message text are not pinned.

afterEach(() => {
  vi.restoreAllMocks();
});

function quiet() {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

const BLOCKED = ["__proto__", "constructor", "prototype"];

function profile(id: string) {
  return createModule(id, {
    schema: {
      facts: {
        name: t.string(),
        tags: t.array<string>(),
        extra: t.object<Record<string, number>>(),
      },
      derivations: { upper: t.string() },
      events: { rename: { to: t.string() } },
    },
    init: (facts: any) => {
      facts.name = id;
      facts.tags = ["a"];
      facts.extra = { v: 1 };
    },
    derive: { upper: (facts: any) => facts.name.toUpperCase() },
    events: {
      rename: (facts: any, event: any) => {
        facts.name = event.to;
      },
    },
  } as any);
}

async function composed() {
  const system = createSystem({
    modules: { left: profile("left"), right: profile("right") },
  } as never) as any;
  system.start();
  await system.settle();

  return system;
}

function reflect(target: any, present: string) {
  return {
    keys: Object.keys(target).sort(),
    inPresent: present in target,
    inNope: "nope" in target,
    spreadKeys: Object.keys({ ...target }).sort(),
    json: JSON.parse(JSON.stringify(target)),
    unknown: target.nope,
    entries: Object.entries(target).length,
  };
}

describe("a composed system's views answer reflection", () => {
  it("lists a module's facts, and the module names at the top", async () => {
    const system = await composed();
    const left = { name: "left", tags: ["a"], extra: { v: 1 } };
    const right = { name: "right", tags: ["a"], extra: { v: 1 } };

    expect(reflect(system.facts.left, "name")).toEqual({
      keys: ["extra", "name", "tags"],
      inPresent: true,
      inNope: false,
      spreadKeys: ["extra", "name", "tags"],
      json: left,
      unknown: undefined,
      entries: 3,
    });
    expect(reflect(system.facts, "left")).toEqual({
      keys: ["left", "right"],
      inPresent: true,
      inNope: false,
      spreadKeys: ["left", "right"],
      json: { left, right },
      unknown: undefined,
      entries: 2,
    });
  });

  it("lists a module's derivations, and the module names at the top", async () => {
    const system = await composed();

    expect(reflect(system.derive.right, "upper")).toEqual({
      keys: ["upper"],
      inPresent: true,
      inNope: false,
      spreadKeys: ["upper"],
      json: { upper: "RIGHT" },
      unknown: undefined,
      entries: 1,
    });
    expect(reflect(system.derive, "left")).toEqual({
      keys: ["left", "right"],
      inPresent: true,
      inNope: false,
      spreadKeys: ["left", "right"],
      json: { left: { upper: "LEFT" }, right: { upper: "RIGHT" } },
      unknown: undefined,
      entries: 2,
    });
  });

  it("lists the module names under events and dispatches into the named module", async () => {
    const system = await composed();

    expect(Object.keys(system.events).sort()).toEqual(["left", "right"]);
    expect("left" in system.events).toBe(true);
    expect("nope" in system.events).toBe(false);
    expect(system.events.nope).toBeUndefined();
    expect(typeof system.events.left.rename).toBe("function");

    system.events.right.rename({ to: "R" });
    await system.settle();

    expect(system.facts.right.name).toBe("R");
    expect(system.facts.left.name).toBe("left");
    expect(system.derive.right.upper).toBe("R");
    expect(system.read("right.upper")).toBe("R");
    expect(system.read("right::upper")).toBe("R");
  });

  it("dispatches an event addressed by its namespaced type", async () => {
    const system = await composed();

    system.dispatch({ type: "left::rename", to: "typed" });
    await system.settle();

    expect(system.facts.left.name).toBe("typed");
    expect(system.facts.right.name).toBe("right");
  });
});

describe("a composed system's facts", () => {
  it("writes land in the owning module and nowhere else", async () => {
    const system = await composed();

    system.facts.left.name = "l";
    system.facts.right.tags = ["x", "y"];

    expect(system.facts.left.name).toBe("l");
    expect(system.facts.right.name).toBe("right");
    expect(system.facts.left.tags).toEqual(["a"]);
    expect(system.facts.right.tags).toEqual(["x", "y"]);
    expect(system.derive.left.upper).toBe("L");
    expect(system.derive.right.upper).toBe("RIGHT");
  });

  it("deletes a fact from its own module only", async () => {
    const system = await composed();

    delete system.facts.left.tags;

    expect("tags" in system.facts.left).toBe(false);
    expect(system.facts.left.tags).toBeUndefined();
    expect(Object.keys(system.facts.left).sort()).toEqual(["extra", "name"]);
    expect("tags" in system.facts.right).toBe(true);
    expect(system.facts.right.tags).toEqual(["a"]);
  });

  it("refuses to replace or remove a namespace", async () => {
    const system = await composed();

    expect(() => {
      system.facts.left = { name: "x" };
    }).toThrow(TypeError);
    expect(() => {
      delete system.facts.left;
    }).toThrow(TypeError);
    expect(() => {
      system.derive.left = {};
    }).toThrow(TypeError);
    expect(() => {
      system.facts.nope.name = "x";
    }).toThrow(TypeError);
    expect(Object.keys(system.facts).sort()).toEqual(["left", "right"]);
    expect(system.facts.left.name).toBe("left");
  });

  it("never exposes or accepts the prototype-walking keys", async () => {
    const system = await composed();
    const views = [
      system.facts,
      system.facts.left,
      system.derive,
      system.derive.left,
      system.events,
    ];

    for (const view of views) {
      for (const key of BLOCKED) {
        expect(key in view).toBe(false);
        expect(view[key]).toBeUndefined();
      }
    }

    const facts = system.facts.left;
    for (const key of BLOCKED) {
      expect(() => {
        facts[key] = { polluted: true };
      }).toThrow(TypeError);
      expect(() => {
        delete facts[key];
      }).toThrow(TypeError);
    }

    expect(Object.keys(facts).sort()).toEqual(["extra", "name", "tags"]);
    expect(({} as any).polluted).toBeUndefined();
  });

  it("never treats a symbol as a fact", async () => {
    const system = await composed();
    const sym = Symbol("probe");

    for (const view of [system.facts, system.facts.left, system.derive.left]) {
      expect(Reflect.has(view, sym)).toBe(false);
      expect(view[sym]).toBeUndefined();
      Reflect.set(view, sym, 1);
      expect(view[sym]).toBeUndefined();
      Reflect.deleteProperty(view, sym);
      expect(Reflect.has(view, sym)).toBe(false);
    }

    expect(Object.keys(system.facts.left).sort()).toEqual([
      "extra",
      "name",
      "tags",
    ]);
  });
});

describe("the derivations a module's own code receives", () => {
  function sibling(id: string) {
    return createModule(id, {
      schema: {
        facts: { n: t.number() },
        derivations: { base: t.number(), probe: t.any() },
        events: {},
      },
      init: (f: any) => {
        f.n = id === "one" ? 1 : 2;
      },
      derive: {
        base: (f: any) => f.n,
        probe: (_f: any, derived: any) => ({
          keys: Object.keys(derived).sort(),
          hasBase: "base" in derived,
          hasNope: "nope" in derived,
          base: derived.base,
          unknown: derived.nope,
        }),
      },
    } as any);
  }

  it("are this module's derivations by their bare names, not its siblings'", async () => {
    const system = createSystem({
      modules: { one: sibling("one"), two: sibling("two") },
    } as never) as any;
    system.start();
    await system.settle();

    for (const [ns, base] of [
      ["one", 1],
      ["two", 2],
    ] as const) {
      expect(system.derive[ns].probe).toEqual({
        keys: ["base", "probe"],
        hasBase: true,
        hasNope: false,
        base,
        unknown: undefined,
      });
    }
  });
});

describe("the facts a module with crossModuleDeps receives", () => {
  const authSchema = { facts: { token: t.string() } };

  function build(onEvaluate?: (view: any) => void) {
    const auth = createModule("auth", {
      schema: authSchema,
      init: (f: any) => {
        f.token = "tok";
      },
    } as any);
    const other = createModule("other", {
      schema: { facts: { secret: t.string() } },
      init: (f: any) => {
        f.secret = "s";
      },
    } as any);
    const app = createModule("app", {
      schema: {
        facts: { count: t.number() },
        derivations: { shape: t.any(), refused: t.any() },
        events: {},
      },
      crossModuleDeps: { auth: authSchema },
      init: (f: any) => {
        f.count = 1;
      },
      derive: {
        shape: (f: any) => {
          onEvaluate?.(f);

          return {
            keys: Object.keys(f),
            self: f.self.count,
            token: f.auth.token,
            hasSelf: "self" in f,
            hasAuth: "auth" in f,
            hasCount: "count" in f,
            hasOther: "other" in f,
            undeclared: f.other,
          };
        },
        refused: (f: any) => {
          const out: Record<string, boolean> = {};
          for (const key of ["self", "auth", "other"]) {
            try {
              f[key] = {};
              out[key] = false;
            } catch {
              out[key] = true;
            }
          }

          return out;
        },
      },
    } as any);

    return createSystem({ modules: { auth, other, app } } as never) as any;
  }

  it("sees itself and its declared dependencies, and nothing else", async () => {
    quiet();
    const system = build();
    system.start();
    await system.settle();

    expect(system.derive.app.shape).toEqual({
      keys: ["self", "auth"],
      self: 1,
      token: "tok",
      hasSelf: true,
      hasAuth: true,
      hasCount: false,
      hasOther: false,
      undeclared: undefined,
    });
  });

  it("cannot replace a namespace through the view", async () => {
    quiet();
    const system = build();
    system.start();
    await system.settle();

    expect(system.derive.app.refused).toEqual({
      self: true,
      auth: true,
      other: true,
    });
    expect(system.facts.auth.token).toBe("tok");
    expect(system.facts.app.count).toBe(1);
  });
});

describe("the facts a module's event handler receives", () => {
  it("are its own facts, with the store behind them reachable as in a single-module system", async () => {
    const seen: Record<string, unknown> = {};
    const m = createModule("m", {
      schema: {
        facts: { n: t.number() },
        derivations: {},
        events: { peek: {} },
      },
      init: (f: any) => {
        f.n = 1;
      },
      events: {
        peek: (f: any) => {
          seen.n = f.n;
          seen.store = typeof f.$store;
          seen.snapshot = typeof f.$snapshot;
        },
      },
    } as any);
    const system = createSystem({
      modules: { m, other: profile("other") },
    } as never) as any;
    system.start();
    await system.settle();
    system.events.m.peek();
    await system.settle();

    expect(seen).toEqual({ n: 1, store: "object", snapshot: "function" });
  });
});

describe("the facts a resolver receives", () => {
  const authSchema = {
    facts: { token: t.string(), user: t.object<{ name: string }>() },
  };

  function build(seen: Record<string, unknown>) {
    const attempt = (fn: () => unknown) => {
      try {
        fn();

        return "ok";
      } catch {
        return "threw";
      }
    };
    const auth = createModule("auth", {
      schema: authSchema,
      init: (f: any) => {
        f.token = "tok";
        f.user = { name: "ann" };
      },
    } as any);
    const notes = createModule("notes", {
      schema: {
        facts: { draft: t.string(), saved: t.string(), scratch: t.string() },
        derivations: {},
        events: { save: {} },
        requirements: { SAVE: {} },
      },
      crossModuleDeps: { auth: authSchema },
      init: (f: any) => {
        f.draft = "d0";
        f.saved = "";
      },
      events: {
        save: (f: any) => {
          f.saved = "request";
        },
      },
      constraints: {
        wantSave: {
          when: (f: any) => f.self.saved === "request",
          require: { type: "SAVE" },
        },
      },
      resolvers: {
        save: {
          requirement: "SAVE",
          resolve: async (_req: unknown, ctx: any) => {
            seen.ownRead = ctx.facts.draft;
            ctx.facts.draft = "d1";
            seen.ownWrite = ctx.facts.draft;
            seen.ownIn = ["draft" in ctx.facts, "token" in ctx.facts];
            ctx.facts.scratch = "created";
            seen.ownKeys = Object.keys(ctx.facts).sort();
            delete ctx.facts.scratch;
            seen.afterDelete = Object.keys(ctx.facts).sort();

            seen.depRead = ctx.deps.auth.token;
            seen.depUserRead = ctx.deps.auth.user.name;
            seen.depWrite = attempt(() => {
              ctx.deps.auth.token = "evil";
            });
            seen.depDelete = attempt(() => {
              delete ctx.deps.auth.token;
            });
            seen.depsSet = attempt(() => {
              ctx.deps.extra = 1;
            });
            seen.depsUnknown = ctx.deps.nope;

            const store = ctx.facts.$store;
            seen.getBare = store.get("draft");
            seen.getPrefixed = store.get("notes::draft");
            seen.getForeign = store.get("auth::token");
            seen.getNonString = store.get(42);
            seen.has = [
              store.has("draft"),
              store.has("notes::draft"),
              store.has("auth::token"),
              store.has("nope"),
            ];
            store.set("draft", "d2");
            seen.setBare = ctx.facts.draft;
            store.set("notes::draft", "d3");
            seen.setPrefixed = ctx.facts.draft;
            seen.setForeign = attempt(() => store.set("auth::token", "evil"));
            seen.setNonString = attempt(() => store.set(42, "evil"));
            seen.deleteForeign = attempt(() => store.delete("auth::token"));
            seen.deleteNonString = attempt(() => store.delete(42));
            seen.toObject = store.toObject();
            seen.toObjectKeys = Object.keys(store.toObject()).sort();
            store.set("scratch", "s");
            const scratchSet = store.has("scratch");
            store.delete("scratch");
            seen.storeScratch = [
              scratchSet,
              store.has("scratch"),
              ctx.facts.scratch,
            ];

            const tick = () => new Promise((r) => setTimeout(r, 0));
            const calls: string[] = [];
            const stopOwn = store.subscribe(["draft"], () => calls.push("own"));
            const stopForeign = store.subscribe(["auth::token"], () =>
              calls.push("foreign"),
            );
            const stopAll = store.subscribeAll(() => calls.push("all"));
            ctx.facts.draft = "d4";
            await tick();
            seen.calls = [...new Set(calls)].sort();
            const heard = calls.length;
            stopOwn();
            stopForeign();
            stopAll();
            ctx.facts.draft = "d5";
            await tick();
            seen.heardAfterStop = calls.length - heard;

            store.batch(() => {
              ctx.facts.draft = "d6";
            });
            seen.batched = ctx.facts.draft;

            ctx.facts.saved = "done";
          },
        },
      },
    } as any);

    return createSystem({ modules: { auth, notes } } as never) as any;
  }

  it("reads and writes its own module's facts, reads dependencies, and cannot write them", async () => {
    quiet();
    const seen: Record<string, unknown> = {};
    const system = build(seen);
    system.start();
    await system.settle();
    system.events.notes.save();
    await system.settle();

    expect(seen).toMatchObject({
      ownRead: "d0",
      ownWrite: "d1",
      ownIn: [true, false],
      ownKeys: ["draft", "saved", "scratch"],
      afterDelete: ["draft", "saved"],
      depRead: "tok",
      depUserRead: "ann",
      depWrite: "threw",
      depDelete: "threw",
      depsSet: "threw",
      depsUnknown: undefined,
    });
    expect(system.facts.auth.token).toBe("tok");
    expect(system.facts.auth.user).toEqual({ name: "ann" });
    expect(system.facts.notes.saved).toBe("done");
  });

  it("scopes the store a resolver reaches through its facts to its own module", async () => {
    quiet();
    const seen: Record<string, unknown> = {};
    const system = build(seen);
    system.start();
    await system.settle();
    system.events.notes.save();
    await system.settle();

    expect(seen).toMatchObject({
      getBare: "d1",
      getPrefixed: "d1",
      getForeign: undefined,
      getNonString: undefined,
      has: [true, true, false, false],
      setBare: "d2",
      setPrefixed: "d3",
      setForeign: "threw",
      setNonString: "threw",
      deleteForeign: "threw",
      deleteNonString: "threw",
      toObject: { draft: "d3", saved: "request" },
      toObjectKeys: ["draft", "saved"],
      storeScratch: [true, false, undefined],
      calls: ["all", "own"],
      heardAfterStop: 0,
      batched: "d6",
    });
    expect(system.facts.auth.token).toBe("tok");
    expect(system.facts.notes.draft).toBe("d6");
  });

  it("keeps a dependency's subscription quiet when only its own facts change", async () => {
    quiet();
    const seen: Record<string, unknown> = {};
    let foreign = 0;
    const authSchema2 = { facts: { token: t.string() } };
    const auth = createModule("auth", {
      schema: authSchema2,
      init: (f: any) => {
        f.token = "tok";
      },
    } as any);
    const notes = createModule("notes", {
      schema: {
        facts: { draft: t.string() },
        derivations: {},
        events: { go: {} },
        requirements: { GO: {} },
      },
      crossModuleDeps: { auth: authSchema2 },
      init: (f: any) => {
        f.draft = "d0";
      },
      events: {
        go: (f: any) => {
          f.draft = "go";
        },
      },
      constraints: {
        wantGo: {
          when: (f: any) => f.self.draft === "go",
          require: { type: "GO" },
        },
      },
      resolvers: {
        go: {
          requirement: "GO",
          resolve: async (_req: unknown, ctx: any) => {
            ctx.facts.$store.subscribe(["auth::token"], () => {
              foreign += 1;
            });
            ctx.facts.draft = "went";
            seen.ran = true;
          },
        },
      },
    } as any);
    const system = createSystem({ modules: { auth, notes } } as never) as any;
    system.start();
    await system.settle();
    system.events.notes.go();
    await system.settle();

    expect(seen.ran).toBe(true);
    system.facts.auth.token = "changed";
    await system.settle();

    expect(foreign).toBe(0);
  });
});
