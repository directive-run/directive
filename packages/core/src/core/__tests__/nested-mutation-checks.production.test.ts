import { describe, expect, it, vi } from "vitest";

// Production build: the dev flag is the constant `false`.
vi.mock("#is-development", () => ({ default: false }));

const { createModule, createSystem, t } = await import("../../index.js");

/**
 * Production does not record what was read, so an in-place mutation through a
 * resolver's dependency view or a source gate goes unchecked and costs
 * nothing. The values handed out are the stored values themselves.
 */
describe("nested mutation checks, in production", () => {
  it("a resolver reading a dependency gets the stored value and no check", async () => {
    const auth = createModule("auth", {
      schema: { facts: { user: t.object<{ name: string }>() } },
      init: (facts) => {
        facts.user = { name: "Ada" };
      },
    });
    let seen: unknown = null;
    const notes = createModule("notes", {
      schema: {
        facts: { go: t.boolean(), done: t.boolean() },
        requirements: { RUN: {} },
      },
      crossModuleDeps: { auth: auth.schema },
      init: (facts) => {
        facts.go = false;
        facts.done = false;
      },
      constraints: {
        run: {
          when: (facts) => facts.self.go && !facts.self.done,
          require: { type: "RUN" },
        },
      },
      resolvers: {
        run: {
          requirement: "RUN",
          resolve: async (_req, context) => {
            const deps = (context as unknown as { deps: Record<string, any> })
              .deps;
            seen = deps.auth.user;
            deps.auth.user.name = "Mallory";
            context.facts.done = true;
          },
        },
      },
    });
    const system = createSystem({ modules: { auth, notes } });
    system.start();
    system.facts.notes.go = true;
    await system.settle();

    expect(system.facts.notes.done).toBe(true);
    expect(seen).toBe(system.facts.auth.user);
    system.destroy();
  });

  it("a gate mutating a value in place still attaches", async () => {
    const attached: string[] = [];
    const mod = createModule("loop", {
      schema: { facts: { cfg: t.object<{ hz: number }>() } },
      init: (facts) => {
        facts.cfg = { hz: 60 };
      },
      sources: {
        frame: {
          active: (facts: Record<string, any>) => {
            facts.cfg.hz = 30;

            return true;
          },
          attach: () => {
            attached.push("frame");

            return () => undefined;
          },
        },
      },
    });
    const system = createSystem({ module: mod });
    system.start();
    await system.settle();

    expect(attached).toEqual(["frame"]);
    system.destroy();
  });
});
