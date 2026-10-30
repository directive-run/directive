import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

// Black-box tests for the facts a composed system hands to code that only
// reads: a source's `key` / `active` gate, and a resolver's `ctx.deps`. Public
// API only. What is pinned is what that code can see: reads, `in`, key lists,
// refused writes and deletes, and the batch resolvers of a namespaced module.
// Which object a read returns, how a view answers a descriptor query, the
// development warnings and the message text are not pinned.

afterEach(() => {
  vi.restoreAllMocks();
});

function quiet() {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
}

/** True when `fn` throws. */
function throws(fn: () => void): boolean {
  try {
    fn();

    return false;
  } catch {
    return true;
  }
}

describe("a source gate in a composed system", () => {
  function gated(
    observe: (f: any) => void,
    counts: { on: number; off: number },
  ) {
    return createModule("watch", {
      schema: {
        facts: { on: t.boolean(), room: t.string() },
        events: { flip: {} },
      },
      init: (f: any) => {
        f.on = true;
        f.room = "one";
      },
      events: {
        flip: (f: any) => {
          f.on = !f.on;
        },
      },
      sources: {
        feed: {
          key: (f: any) => {
            observe(f);

            return f.on ? f.room : null;
          },
          attach: () => {
            counts.on++;

            return () => {
              counts.off++;
            };
          },
        },
      },
    } as never);
  }

  it("reads the module's own facts by bare name, and reflects them", async () => {
    quiet();
    const seen: Record<string, unknown> = {};
    const counts = { on: 0, off: 0 };
    const other = createModule("other", {
      schema: { facts: { n: t.number() } },
      init: (f: any) => {
        f.n = 0;
      },
    } as never);
    const system = createSystem({
      modules: {
        watch: gated((f) => {
          seen.room = f.room;
          seen.inOn = "on" in f;
          seen.inNope = "nope" in f;
          seen.keys = Object.keys(f).sort();
          seen.unknown = f.nope;
          seen.writeKnown = throws(() => {
            f.on = false;
          });
          seen.writeNew = throws(() => {
            f.fresh = 1;
          });
          seen.deleteKnown = throws(() => {
            delete f.on;
          });
          seen.deleteNew = throws(() => {
            delete f.fresh;
          });
        }, counts),
        other,
      },
    } as never) as any;
    system.start();
    await system.settle();

    expect(seen).toEqual({
      room: "one",
      inOn: true,
      inNope: false,
      keys: ["on", "room"],
      unknown: undefined,
      writeKnown: true,
      writeNew: true,
      deleteKnown: true,
      deleteNew: true,
    });
    expect(system.facts.watch.on).toBe(true);
    expect("fresh" in system.facts.watch).toBe(false);
    // The gate chose the key from the fact it read, and the source attached.
    expect(counts).toEqual({ on: 1, off: 0 });

    system.events.watch.flip();
    await system.settle();

    expect(counts).toEqual({ on: 1, off: 1 });
    system.destroy();
  });

  it("with crossModuleDeps reads under self and the dependency's name", async () => {
    quiet();
    const seen: Record<string, unknown> = {};
    const counts = { on: 0, off: 0 };
    const other = createModule("other", {
      schema: { facts: { n: t.number() } },
      init: (f: any) => {
        f.n = 0;
      },
    } as never);
    const watch = createModule("watch", {
      schema: { facts: { on: t.boolean(), room: t.string() } },
      crossModuleDeps: { other: other.schema },
      init: (f: any) => {
        f.on = true;
        f.room = "one";
      },
      sources: {
        feed: {
          active: (f: any) => {
            seen.self = f.self.on;
            seen.dep = f.other.n;
            seen.bare = f.on;
            seen.unknown = f.nope;
            seen.inSelf = "self" in f;
            seen.inOther = "other" in f;
            seen.inBare = "on" in f;
            seen.keys = Object.keys(f).sort();
            seen.selfKeys = Object.keys(f.self).sort();
            seen.otherKeys = Object.keys(f.other).sort();
            seen.inSelfFact = "room" in f.self;
            seen.inDepFact = "room" in f.other;
            seen.writeSelf = throws(() => {
              f.self.on = false;
            });
            seen.writeDep = throws(() => {
              f.other.n = 99;
            });
            seen.writeTop = throws(() => {
              f.fresh = 1;
            });
            seen.deleteSelf = throws(() => {
              delete f.self.on;
            });
            seen.deleteDep = throws(() => {
              delete f.other.n;
            });
            seen.deleteTop = throws(() => {
              delete f.fresh;
            });

            return f.self.on && f.other.n > 0;
          },
          attach: () => {
            counts.on++;

            return () => {
              counts.off++;
            };
          },
        },
      },
    } as never);
    const system = createSystem({ modules: { other, watch } } as never) as any;
    system.start();
    await system.settle();

    expect(counts).toEqual({ on: 0, off: 0 });
    system.facts.other.n = 2;
    await system.settle();

    expect(counts).toEqual({ on: 1, off: 0 });
    expect(seen).toEqual({
      self: true,
      dep: 2,
      bare: undefined,
      unknown: undefined,
      inSelf: true,
      inOther: true,
      inBare: false,
      keys: ["other", "self"],
      selfKeys: ["on", "room"],
      otherKeys: ["n"],
      inSelfFact: true,
      inDepFact: false,
      writeSelf: true,
      writeDep: true,
      writeTop: true,
      deleteSelf: true,
      deleteDep: true,
      deleteTop: true,
    });
    expect(system.facts.watch.on).toBe(true);
    expect(system.facts.other.n).toBe(2);
    system.destroy();
  });
});

describe("a resolver's ctx.deps", () => {
  function build(body: (ctx: any) => void, options: { second?: boolean } = {}) {
    const auth = createModule("auth", {
      schema: {
        facts: {
          token: t.string(),
          user: t.object<{ name: string }>(),
        },
      },
      init: (f: any) => {
        f.token = "tok";
        f.user = { name: "Ada" };
      },
    } as never);
    const prefs = createModule("prefs", {
      schema: { facts: { list: t.array<string>() } },
      init: (f: any) => {
        f.list = ["a"];
      },
    } as never);
    const notes = createModule("notes", {
      schema: {
        facts: { draft: t.string(), saved: t.boolean() },
        requirements: { SAVE: {} },
      },
      crossModuleDeps: options.second
        ? { auth: auth.schema, prefs: prefs.schema }
        : { auth: auth.schema },
      init: (f: any) => {
        f.draft = "";
        f.saved = false;
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
            await Promise.resolve();
            body(ctx);
            ctx.facts.saved = true;
          },
        },
      },
    } as never);
    const errors: unknown[] = [];
    const system = createSystem({
      modules: options.second ? { auth, prefs, notes } : { auth, notes },
      plugins: [
        {
          name: "watch",
          onResolverError: (
            _resolver: string,
            _req: unknown,
            error: unknown,
          ) => {
            errors.push(error);
          },
        },
      ],
    } as never) as any;

    return { system, errors };
  }

  async function run(system: any) {
    system.start();
    system.facts.notes.draft = "hi";
    await system.settle();
  }

  it("lists the declared dependencies, and each one's facts", async () => {
    quiet();
    const seen: Record<string, unknown> = {};
    const { system, errors } = build((ctx) => {
      seen.keys = Object.keys(ctx.deps).sort();
      seen.inAuth = "auth" in ctx.deps;
      seen.inNotes = "notes" in ctx.deps;
      seen.inNope = "nope" in ctx.deps;
      seen.authKeys = Object.keys(ctx.deps.auth).sort();
      seen.inToken = "token" in ctx.deps.auth;
      seen.inDraft = "draft" in ctx.deps.auth;
      seen.token = ctx.deps.auth.token;
      seen.unknown = ctx.deps.nope;
    });
    await run(system);

    expect(errors).toEqual([]);
    expect(seen).toEqual({
      keys: ["auth"],
      inAuth: true,
      inNotes: false,
      inNope: false,
      authKeys: ["token", "user"],
      inToken: true,
      inDraft: false,
      token: "tok",
      unknown: undefined,
    });
    expect(system.facts.notes.saved).toBe(true);
    system.destroy();
  });

  it("reports an in-place change to the second dependency read", async () => {
    quiet();
    const { system, errors } = build(
      (ctx) => {
        void ctx.deps.auth.user.name;
        ctx.deps.prefs.list.push("b");
      },
      { second: true },
    );
    await run(system);

    expect(errors).toHaveLength(1);
    expect(String((errors[0] as Error).message)).toContain("prefs.list");
    system.destroy();
  });

  it("reports an in-place change made before the dependency is read again", async () => {
    quiet();
    const { system, errors } = build((ctx) => {
      ctx.deps.auth.user.name = "Mallory";
      void ctx.deps.auth.user.name;
    });
    await run(system);

    expect(errors).toHaveLength(1);
    expect(String((errors[0] as Error).message)).toContain("auth.user.name");
    system.destroy();
  });
});

describe("a view of a composed system refuses a symbol-keyed write", () => {
  it("throws on assign and on delete", async () => {
    const make = (id: string) =>
      createModule(id, {
        schema: { facts: { name: t.string() } },
        init: (f: any) => {
          f.name = id;
        },
      } as never);
    const system = createSystem({
      modules: { left: make("left"), right: make("right") },
    } as never) as any;
    system.start();
    await system.settle();
    const sym = Symbol("probe");

    for (const view of [system.facts, system.facts.left]) {
      expect(
        throws(() => {
          view[sym] = 1;
        }),
      ).toBe(true);
      expect(
        throws(() => {
          delete view[sym];
        }),
      ).toBe(true);
    }
    expect(system.facts.left.name).toBe("left");
    system.destroy();
  });
});

describe("batch resolvers in a composed system", () => {
  function build(resolver: Record<string, unknown>) {
    const m = createModule("m", {
      schema: {
        facts: { want: t.array<string>(), done: t.array<string>() },
        requirements: { FETCH: { id: t.string() } },
      },
      init: (f: any) => {
        f.want = [];
        f.done = [];
      },
      constraints: {
        fetch: {
          when: (f: any) => f.want.length > 0,
          require: (f: any) =>
            f.want.map((id: string) => ({ type: "FETCH", id })),
        },
      },
      resolvers: {
        fetch: {
          requirement: "FETCH",
          key: (req: { id: string }) => req.id,
          batch: { enabled: true, windowMs: 5 },
          ...resolver,
        },
      },
    } as never);
    const other = createModule("other", {
      schema: { facts: { n: t.number() } },
      init: (f: any) => {
        f.n = 0;
      },
    } as never);
    const system = createSystem({ modules: { m, other } } as never) as any;
    system.start();

    return system;
  }

  it("resolveBatch writes through the module's own facts", async () => {
    const system = build({
      resolveBatch: async (reqs: Array<{ id: string }>, ctx: any) => {
        ctx.facts.done = [...ctx.facts.done, ...reqs.map((r) => r.id)];
      },
    });
    system.facts.m.want = ["a", "b"];

    await vi.waitFor(() => {
      expect([...system.facts.m.done].sort()).toEqual(["a", "b"]);
    });
    system.destroy();
  });

  it("resolveBatchWithResults writes through the module's own facts", async () => {
    const system = build({
      resolveBatchWithResults: async (
        reqs: Array<{ id: string }>,
        ctx: any,
      ) => {
        ctx.facts.done = [...ctx.facts.done, ...reqs.map((r) => r.id)];

        return reqs.map(() => ({ success: true }));
      },
    });
    system.facts.m.want = ["a", "b"];

    await vi.waitFor(() => {
      expect([...system.facts.m.done].sort()).toEqual(["a", "b"]);
    });
    system.destroy();
  });
});
