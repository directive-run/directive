/**
 * What a composed system's views do in a production build.
 *
 * `#is-development` is a build-time constant, `true` under the test build.
 * Mocking it to `false` runs the production branches for real: these tests
 * would fail if the behaviour they check sat inside a development-only gate.
 * A refused write stays refused; a write the development build rejects with an
 * error is ignored without one, and nothing is printed.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("#is-development", () => ({ default: false }));

const { createModule, createSystem, t } = await import("../../index.js");

afterEach(() => {
  vi.restoreAllMocks();
});

const settle = async (system: any) => {
  await system.settle();
  await new Promise((r) => setTimeout(r, 0));
  await system.settle();
};

const attempt = (fn: () => unknown) => {
  try {
    fn();

    return "ok";
  } catch {
    return "threw";
  }
};

describe("a composed system in a production build", () => {
  const authSchema = {
    facts: { token: t.string(), user: t.object<{ name: string }>() },
  };

  function build(seen: Record<string, unknown>) {
    const auth = createModule("auth", {
      schema: authSchema,
      init: (f: any) => {
        f.token = "tok";
        f.user = { name: "ann" };
      },
    } as any);
    const notes = createModule("notes", {
      schema: {
        facts: { draft: t.string(), saved: t.string() },
        derivations: { shape: t.any(), refused: t.any() },
        events: { save: {} },
        requirements: { SAVE: {} },
      },
      crossModuleDeps: { auth: authSchema },
      init: (f: any) => {
        f.draft = "d0";
        f.saved = "";
      },
      derive: {
        shape: (f: any) => ({ self: f.self.draft, other: f.other }),
        refused: (f: any) => {
          const out: Record<string, string> = {};
          for (const key of ["self", "auth", "other"]) {
            out[key] = attempt(() => {
              f[key] = {};
            });
          }

          return out;
        },
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
            seen.depRead = ctx.deps.auth.token;
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
            seen.storeSetForeign = attempt(() =>
              store.set("auth::token", "evil"),
            );
            seen.storeDeleteForeign = attempt(() =>
              store.delete("auth::token"),
            );
            seen.storeSetNonString = attempt(() => store.set(42, "evil"));
            seen.storeDeleteNonString = attempt(() => store.delete(42));
            seen.storeGetForeign = store.get("auth::token");
            store.set("draft", "own");
            seen.storeSetOwn = ctx.facts.draft;
            ctx.facts.saved = "done";
          },
        },
      },
    } as any);
    const cart = createModule("cart", {
      schema: {
        facts: { stamp: t.any(), n: t.number() },
        derivations: { total: t.number() },
        events: {},
      },
      init: (f: any) => {
        f.n = 1;
      },
      derive: { total: (f: any) => f.n },
    } as any);

    return createSystem({ modules: { auth, notes, cart } } as never) as any;
  }

  it("ignores a resolver's writes to a dependency without throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const seen: Record<string, unknown> = {};
    const system = build(seen);
    system.start();
    await settle(system);
    system.events.notes.save();
    await settle(system);

    expect(seen).toMatchObject({
      depRead: "tok",
      depWrite: "ok",
      depDelete: "ok",
      depsSet: "ok",
      depsUnknown: undefined,
      storeSetForeign: "ok",
      storeDeleteForeign: "ok",
      storeSetNonString: "ok",
      storeDeleteNonString: "ok",
      storeGetForeign: undefined,
      storeSetOwn: "own",
    });
    expect(system.facts.auth.token).toBe("tok");
    expect(system.facts.auth.user).toEqual({ name: "ann" });
    expect(system.facts.notes.saved).toBe("done");
    expect(warn).not.toHaveBeenCalled();
  });

  it("still refuses to replace a namespace through the cross-module view, silently", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const system = build({});
    system.start();
    await settle(system);

    expect(system.derive.notes.refused).toEqual({
      self: "threw",
      auth: "threw",
      other: "threw",
    });
    expect(system.derive.notes.shape).toEqual({
      self: "d0",
      other: undefined,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("prints nothing when a derivation name is read as a module, or a non-JSON value is written", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const system = build({});
    system.start();
    await settle(system);

    expect(system.derive.total).toBeUndefined();
    expect(system.derive.nope).toBeUndefined();
    system.facts.cart.stamp = new Date(0);
    system.facts.cart.stamp = new Date(1);
    await settle(system);

    expect(system.facts.cart.stamp).toEqual(new Date(1));
    expect(warn).not.toHaveBeenCalled();
  });

  it("still refuses a module with a prototype-walking key", () => {
    const bad = createModule("bad", {
      schema: {
        facts: { n: t.number() },
        derivations: {},
        events: {},
      },
      init: (f: any) => {
        f.n = 0;
      },
      events: { constructor: () => undefined },
    } as any);

    expect(() => createSystem({ modules: { bad } } as never)).toThrow(Error);
  });
});
