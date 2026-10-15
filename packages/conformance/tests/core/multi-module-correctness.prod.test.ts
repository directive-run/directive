// Ported from packages/core/src/core/__tests__/multi-module-correctness.prod.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

/**
 * Multi-module correctness in a production build.
 *
 * `#is-development` is a build-time constant, `true` under the test build.
 * Mocking it to `false` runs the production branches for real: these tests
 * would fail if the behavior they check sat inside a dev-only gate.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("#is-development", () => ({ default: false }));

const { createModule, createSystem, t } = await import("@directive-run/core");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("production build", () => {
  it("still records a publish with no handler as an unknown-event drop", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let publish: ((event: string) => void) | null = null;
    const loop = createModule("loop", {
      schema: { facts: { running: t.boolean() }, events: { START: {} } },
      init: (f) => {
        f.running = false;
      },
      events: {
        START: (f) => {
          f.running = true;
        },
      },
      sources: {
        boot: {
          attach: (p) => {
            publish = p;

            return () => undefined;
          },
        },
      },
    });
    const system = createSystem({ modules: { loop } });
    system.start();
    publish!("NOPE");
    publish!("START");
    await system.settle();

    const row = system.inspect().sources.find((s) => s.id === "loop::boot")!;
    expect(row.dropCount).toBe(1);
    expect(row.lastDropReason).toBe("unknown-event");
    expect(row.publishCount).toBe(1);
    expect(system.facts.loop.running).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    system.destroy();
  });

  it("ignores a resolver's $store write to a dependency key without throwing", async () => {
    const authSchema = { facts: { token: t.string() } };
    const auth = createModule("auth", {
      schema: authSchema,
      init: (f) => {
        f.token = "tok";
      },
    });
    const notes = createModule("notes", {
      schema: {
        facts: { draft: t.string() },
        events: { submit: { text: t.string() } },
        requirements: { SAVE: {} },
      },
      crossModuleDeps: { auth: authSchema },
      init: (f) => {
        f.draft = "";
      },
      events: {
        submit: (f, e) => {
          f.draft = e.text;
        },
      },
      constraints: {
        save: {
          when: (f) => f.self.draft !== "",
          require: { type: "SAVE" },
        },
      },
      resolvers: {
        save: {
          requirement: "SAVE",
          resolve: async (_req, context) => {
            const store = context.facts.$store as any;
            store.set("auth::token", "stolen");
            store.batch(() => store.set("auth::token", "stolen-again"));
            store.set("draft", "");
          },
        },
      },
    });
    const system = createSystem({ modules: { auth, notes } });
    system.start();
    system.events.notes.submit({ text: "hi" });
    await system.settle();

    expect(system.facts.auth.token).toBe("tok");
    expect(system.facts.notes.draft).toBe("");
    expect(system.inspect().unmet).toEqual([]);
    system.destroy();
  });

  it("ignores a resolver's write to a dependency module without throwing", async () => {
    const authSchema = { facts: { token: t.string() } };
    const auth = createModule("auth", {
      schema: authSchema,
      init: (f) => {
        f.token = "tok";
      },
    });
    const notes = createModule("notes", {
      schema: {
        facts: { draft: t.string() },
        events: { submit: { text: t.string() } },
        requirements: { SAVE: {} },
      },
      crossModuleDeps: { auth: authSchema },
      init: (f) => {
        f.draft = "";
      },
      events: {
        submit: (f, e) => {
          f.draft = e.text;
        },
      },
      constraints: {
        save: {
          when: (f) => f.self.draft !== "",
          require: { type: "SAVE" },
        },
      },
      resolvers: {
        save: {
          requirement: "SAVE",
          resolve: async (_req, context) => {
            (context.deps.auth as { token: string }).token = "stolen";
            context.facts.draft = "";
          },
        },
      },
    });
    const system = createSystem({ modules: { auth, notes } });
    system.start();
    system.events.notes.submit({ text: "hi" });
    await system.settle();

    expect(system.facts.auth.token).toBe("tok");
    expect(system.facts.notes.draft).toBe("");
    expect(system.inspect().unmet).toEqual([]);
    system.destroy();
  });
});
