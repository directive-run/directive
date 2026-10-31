import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

// Black-box tests for what the views of a composed (namespaced) system show
// through ordinary operations: the names they list however a listing is
// asked for, `in` on an event view, what a resolver in each module gets to
// see of its own and its neighbours' facts, and how many warnings a
// development build prints for the same mistake.
// Public API only. Which object a read returns and how a view answers a
// descriptor or prototype query are not pinned; neither is warning wording.

afterEach(() => {
  vi.restoreAllMocks();
});

function quiet() {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

function profile(id: string) {
  return createModule(id, {
    schema: {
      facts: { name: t.string(), tags: t.array<string>() },
      derivations: { upper: t.string() },
      events: { rename: { to: t.string() } },
    },
    init: (facts: any) => {
      facts.name = id;
      facts.tags = ["a"];
    },
    derive: { upper: (facts: any) => facts.name.toUpperCase() },
    events: {
      rename: (facts: any, event: any) => {
        facts.name = event.to;
      },
    },
  } as any);
}

/** Every way to ask a view for its names, which must all agree. */
function listings(view: any) {
  return {
    keys: Object.keys(view).sort(),
    names: Object.getOwnPropertyNames(view).sort(),
    spread: Object.keys({ ...view }).sort(),
  };
}

function agree(view: any, expected: string[]) {
  expect(listings(view)).toEqual({
    keys: expected,
    names: expected,
    spread: expected,
  });
}

describe("every listing of a view's names agrees", () => {
  const authSchema = { facts: { token: t.string() } };

  async function build() {
    const seen: Record<string, any> = {};
    const auth = createModule("auth", {
      schema: { ...authSchema, events: { peek: {} } },
      init: (f: any) => {
        f.token = "tok";
      },
      events: {
        peek: (f: any) => {
          seen.handler = f;
        },
      },
    } as any);
    const notes = createModule("notes", {
      schema: {
        facts: { draft: t.string(), saved: t.boolean() },
        derivations: { shape: t.any() },
        events: {},
        requirements: { SAVE: {} },
      },
      crossModuleDeps: { auth: authSchema },
      init: (f: any) => {
        f.draft = "";
        f.saved = false;
      },
      derive: {
        shape: (f: any) => {
          seen.cross = f;
          seen.crossSelf = f.self;
          seen.crossAuth = f.auth;

          return f.self.draft;
        },
      },
      constraints: {
        save: {
          when: (f: any) => f.self.draft !== "" && !f.self.saved,
          require: { type: "SAVE" },
        },
      },
      resolvers: {
        save: {
          requirement: "SAVE",
          resolve: async (_req: unknown, ctx: any) => {
            seen.resolverFacts = ctx.facts;
            seen.resolverDeps = ctx.deps;
            seen.resolverDep = ctx.deps.auth;
            ctx.facts.saved = true;
          },
        },
      },
    } as any);
    const system = createSystem({ modules: { auth, notes } } as never) as any;
    system.start();
    system.facts.notes.draft = "hi";
    system.events.auth.peek();
    await system.settle();
    // The derivation runs on first read.
    expect(system.derive.notes.shape).toBe("hi");

    return { system, seen };
  }

  it("for a composed system's own views", async () => {
    const { system } = await build();

    agree(system.facts, ["auth", "notes"]);
    agree(system.facts.auth, ["token"]);
    agree(system.facts.notes, ["draft", "saved"]);
    agree(system.derive, ["auth", "notes"]);
    agree(system.derive.auth, []);
    agree(system.derive.notes, ["shape"]);
    agree(system.events, ["auth", "notes"]);
    // An event view lists nothing, however it is asked.
    agree(system.events.auth, []);
  });

  it("for the views a module's own code receives", async () => {
    const { seen } = await build();

    agree(seen.handler, ["token"]);
    agree(seen.cross, ["auth", "self"]);
    agree(seen.crossSelf, ["draft", "saved"]);
    agree(seen.crossAuth, ["token"]);
  });

  it("for the views a resolver receives", async () => {
    const { seen } = await build();

    agree(seen.resolverFacts, ["draft", "saved"]);
    agree(seen.resolverDeps, ["auth"]);
    agree(seen.resolverDep, ["token"]);
  });
});

describe("an event view answers `in` and reflection quietly", () => {
  it("answers `in` false for a name an event view was never asked for", async () => {
    const system = createSystem({
      modules: { one: profile("one"), two: profile("two") },
    } as never) as any;
    system.start();
    await system.settle();

    expect("nope" in system.events.one).toBe(false);
    expect("nope" in system.events).toBe(false);
    expect("one" in system.events).toBe(true);
  });

  it("lets a library ask an event view whether it owns a name", async () => {
    const system = createSystem({
      modules: { one: profile("one"), two: profile("two") },
    } as never) as any;
    system.start();
    await system.settle();

    expect(() => Object.hasOwn(system.events.one, "rename")).not.toThrow();
    expect(() =>
      Object.prototype.hasOwnProperty.call(system.events.one, "nope"),
    ).not.toThrow();
  });
});

describe("a resolver in each module of one system", () => {
  const authSchema = { facts: { token: t.string() } };

  function owner(id: string, deps: Record<string, unknown>, seen: any) {
    return createModule(id, {
      schema: {
        facts: { draft: t.string(), mark: t.string(), saved: t.boolean() },
        events: {},
        requirements: { [`SAVE_${id}`]: {} },
      },
      ...(Object.keys(deps).length > 0 ? { crossModuleDeps: deps } : {}),
      init: (f: any) => {
        f.draft = id;
        f.mark = "";
        f.saved = false;
      },
      constraints: {
        save: {
          when: (f: any) => {
            const own = Object.keys(deps).length > 0 ? f.self : f;

            return own.draft !== "" && !own.saved;
          },
          require: { type: `SAVE_${id}` },
        },
      },
      resolvers: {
        save: {
          requirement: `SAVE_${id}`,
          resolve: async (_req: unknown, ctx: any) => {
            ctx.facts.mark = `by ${id}`;
            seen[id] = {
              draft: ctx.facts.draft,
              deps: Object.keys(ctx.deps),
              token: ctx.deps.auth?.token,
              storeDraft: ctx.facts.$store.get("draft"),
              storeToken: ctx.facts.$store.get("auth::token"),
              snapshotDraft: ctx.facts.$snapshot().get("draft"),
              snapshotToken: ctx.facts.$snapshot().get("auth::token"),
            };
            ctx.facts.saved = true;
          },
        },
      },
    } as any);
  }

  it("each sees its own facts and its own dependencies", async () => {
    quiet();
    const seen: Record<string, any> = {};
    const auth = createModule("auth", {
      schema: authSchema,
      init: (f: any) => {
        f.token = "tok";
      },
    } as any);
    const system = createSystem({
      modules: {
        auth,
        left: owner("left", { auth: authSchema }, seen),
        right: owner("right", { auth: authSchema }, seen),
      },
    } as never) as any;
    system.start();
    await system.settle();

    expect(system.facts.left.mark).toBe("by left");
    expect(system.facts.right.mark).toBe("by right");
    for (const id of ["left", "right"]) {
      expect(seen[id]).toEqual({
        draft: id,
        deps: ["auth"],
        token: "tok",
        storeDraft: id,
        storeToken: undefined,
        snapshotDraft: id,
        snapshotToken: undefined,
      });
    }
  });

  it("each sees only the dependencies it declared", async () => {
    quiet();
    const seen: Record<string, any> = {};
    const auth = createModule("auth", {
      schema: authSchema,
      init: (f: any) => {
        f.token = "tok";
      },
    } as any);
    const prefs = createModule("prefs", {
      schema: { facts: { theme: t.string() } },
      init: (f: any) => {
        f.theme = "dark";
      },
    } as any);
    const system = createSystem({
      modules: {
        auth,
        prefs,
        left: owner("left", { auth: authSchema }, seen),
        right: owner(
          "right",
          { prefs: { facts: { theme: t.string() } } },
          seen,
        ),
      },
    } as never) as any;
    system.start();
    await system.settle();

    expect(seen.left.deps).toEqual(["auth"]);
    expect(seen.left.token).toBe("tok");
    expect(seen.right.deps).toEqual(["prefs"]);
    expect(seen.right.token).toBeUndefined();
  });
});

describe("a development build warns about the same mistake once", () => {
  it("for a non-JSON fact written through a module, once per fact", async () => {
    const warn = quiet();
    const m = createModule("dated", {
      schema: {
        facts: { first: t.any(), second: t.any() },
        events: {},
      },
      init: (f: any) => {
        f.first = 0;
        f.second = 0;
      },
    } as any);
    const system = createSystem({
      modules: { dated: m, other: profile("other") },
    } as never) as any;
    system.start();
    await system.settle();
    // Count warnings, not their wording: the first non-JSON write of a fact
    // warns, a repeat write of the same fact does not, another fact does.
    const count = () => warn.mock.calls.length;
    const start = count();
    system.facts.dated.first = new Date(1);
    const afterFirst = count();
    expect(afterFirst).toBeGreaterThan(start);
    system.facts.dated.first = new Date(2);
    expect(count()).toBe(afterFirst);
    system.facts.dated.second = new Date(3);
    const afterSecond = count();
    // Another fact's first write warns as much as the first fact's did.
    expect(afterSecond - afterFirst).toBe(afterFirst - start);
    system.facts.dated.second = new Date(4);
    expect(count()).toBe(afterSecond);
  });

  it("for a write through a cross-module view, once per name", async () => {
    const warn = quiet();
    const authSchema = { facts: { token: t.string() } };
    const auth = createModule("auth", {
      schema: authSchema,
      init: (f: any) => {
        f.token = "tok";
      },
    } as any);
    const app = createModule("app", {
      schema: {
        facts: { count: t.number() },
        derivations: { attempts: t.any() },
        events: {},
      },
      crossModuleDeps: { auth: authSchema },
      init: (f: any) => {
        f.count = 1;
      },
      derive: {
        attempts: (f: any) => {
          const out: boolean[] = [];
          for (const key of ["auth", "auth", "self", "self", "auth"]) {
            try {
              f[key] = {};
              out.push(false);
            } catch {
              out.push(true);
            }
          }

          return out;
        },
      },
    } as any);
    const system = createSystem({ modules: { auth, app } } as never) as any;
    // Counted around start, which runs the derivation: five refused writes to
    // two names give one warning for each name, whatever the text says.
    const before = warn.mock.calls.length;
    system.start();
    await system.settle();
    expect(system.derive.app.attempts).toEqual([true, true, true, true, true]);
    expect(warn.mock.calls.length - before).toBe(2);
  });
});
