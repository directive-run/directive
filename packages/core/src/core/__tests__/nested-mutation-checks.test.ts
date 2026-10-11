import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

/**
 * Code that reads facts without owning them – an effect, a resolver reading a
 * dependency module, a source gate – cannot change them in place either. The
 * stored value is handed out as it is, so development checks afterwards and
 * names the first path that changed. One helper does it for all three.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

function quiet() {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
}

describe("an effect mutating a collection or date in place", () => {
  it("is reported for a Map, a Set and a Date", async () => {
    quiet();
    const blocked: string[] = [];
    const mod = createModule("m", {
      schema: {
        facts: {
          n: t.number(),
          lookup: t.object<Map<string, number>>(),
          tags: t.object<Set<string>>(),
          when: t.object<Date>(),
        },
      },
      init: (facts) => {
        facts.n = 0;
        facts.lookup = new Map([["a", 1]]);
        facts.tags = new Set(["x"]);
        facts.when = new Date(0);
      },
      effects: {
        mapValue: {
          deps: ["n"],
          run: (facts) => {
            if (facts.n > 0) {
              (facts.lookup as Map<string, number>).set("a", 2);
            }
          },
        },
        setAdd: {
          deps: ["n"],
          run: (facts) => {
            if (facts.n > 0) {
              (facts.tags as Set<string>).add("y");
            }
          },
        },
        dateSet: {
          deps: ["n"],
          run: (facts) => {
            if (facts.n > 0) {
              (facts.when as Date).setTime(5);
            }
          },
        },
        readsOnly: {
          deps: ["n"],
          run: (facts) => {
            void (facts.lookup as Map<string, number>).get("a");
            void (facts.tags as Set<string>).has("x");
            void (facts.when as Date).getTime();
          },
        },
      },
    });
    const system = createSystem({
      module: mod,
      plugins: [
        {
          name: "watch",
          onEffectWriteBlocked: (id, key) => {
            blocked.push(`${id}:${key}`);
          },
        },
      ],
    });
    await system.start();
    await system.settle();
    system.facts.n = 1;
    await system.settle();

    expect(blocked).toEqual(
      expect.arrayContaining([
        'mapValue:lookup.get("a")',
        "setAdd:tags (size 1 → 2)",
        "dateSet:when",
      ]),
    );
    expect(blocked.some((entry) => entry.startsWith("readsOnly:"))).toBe(false);
    await system.stop();
  });
});

describe("a resolver mutating a dependency module's value in place", () => {
  function build(mutate: (deps: Record<string, any>) => void) {
    const auth = createModule("auth", {
      schema: {
        facts: {
          user: t.object<{ name: string }>(),
          roles: t.object<Map<string, boolean>>(),
        },
      },
      init: (facts) => {
        facts.user = { name: "Ada" };
        facts.roles = new Map([["admin", false]]);
      },
    });
    const notes = createModule("notes", {
      schema: {
        facts: { draft: t.string(), saved: t.boolean() },
        requirements: { SAVE: {} },
      },
      crossModuleDeps: { auth: auth.schema },
      init: (facts) => {
        facts.draft = "";
        facts.saved = false;
      },
      constraints: {
        save: {
          when: (facts) => facts.self.draft !== "" && !facts.self.saved,
          require: { type: "SAVE" },
        },
      },
      resolvers: {
        save: {
          requirement: "SAVE",
          resolve: async (_req, context) => {
            await Promise.resolve();
            mutate((context as unknown as { deps: Record<string, any> }).deps);
            context.facts.saved = true;
          },
        },
      },
    });
    const errors: Array<{ resolver: string; error: unknown }> = [];
    const system = createSystem({
      modules: { auth, notes },
      plugins: [
        {
          name: "watch",
          onResolverError: (resolver, _req, error) => {
            errors.push({ resolver, error });
          },
        },
      ],
    });

    return { system, errors };
  }

  it("is reported after the resolver settles, naming the path", async () => {
    quiet();
    const { system, errors } = build((deps) => {
      deps.auth.user.name = "Mallory";
    });
    system.start();
    system.facts.notes.draft = "hi";
    await system.settle();

    expect(errors).toHaveLength(1);
    expect(String((errors[0]!.error as Error).message)).toContain(
      '"auth.user.name"',
    );
    system.destroy();
  });

  it("is reported for a Map changed in place", async () => {
    quiet();
    const { system, errors } = build((deps) => {
      deps.auth.roles.set("admin", true);
    });
    system.start();
    system.facts.notes.draft = "hi";
    await system.settle();

    expect(errors).toHaveLength(1);
    expect(String((errors[0]!.error as Error).message)).toContain(
      'auth.roles.get("admin")',
    );
    system.destroy();
  });

  it("is quiet for a resolver that only reads", async () => {
    quiet();
    let seen = "";
    const { system, errors } = build((deps) => {
      seen = deps.auth.user.name;
    });
    system.start();
    system.facts.notes.draft = "hi";
    await system.settle();

    expect(errors).toEqual([]);
    expect(seen).toBe("Ada");
    expect(system.facts.notes.saved).toBe(true);
    system.destroy();
  });
});

describe("a source gate mutating a value in place", () => {
  function gated(
    gate: (facts: Record<string, any>) => boolean,
    attached: string[],
  ) {
    return createModule("loop", {
      schema: {
        facts: { running: t.boolean(), cfg: t.object<{ hz: number }>() },
        events: { TICK: {} },
      },
      init: (facts) => {
        facts.running = true;
        facts.cfg = { hz: 60 };
      },
      events: { TICK: () => undefined },
      sources: {
        frame: {
          active: gate,
          attach: () => {
            attached.push("frame");

            return () => undefined;
          },
        },
      },
    });
  }

  it("is a gate error and the source stays detached, single-module", async () => {
    quiet();
    const attached: string[] = [];
    const system = createSystem({
      module: gated((facts) => {
        facts.cfg.hz += 1;

        return facts.running;
      }, attached),
    });
    system.start();
    await system.settle();

    expect(attached).toEqual([]);
    const row = system.inspect().sources.find((s) => s.id === "frame")!;
    expect(row.lastError?.phase).toBe("gate");
    expect(row.lastError?.message).toContain("cfg.hz");
    system.destroy();
  });

  it("is a gate error and the source stays detached, namespaced", async () => {
    quiet();
    const attached: string[] = [];
    const other = createModule("other", {
      schema: { facts: { n: t.number() } },
      init: (facts) => {
        facts.n = 0;
      },
    });
    const system = createSystem({
      modules: {
        loop: gated((facts) => {
          facts.cfg.hz += 1;

          return facts.running;
        }, attached),
        other,
      },
    });
    system.start();
    await system.settle();

    expect(attached).toEqual([]);
    const row = system.inspect().sources.find((s) => s.id === "loop::frame")!;
    expect(row.lastError?.phase).toBe("gate");
    expect(row.lastError?.message).toContain("cfg.hz");
    system.destroy();
  });

  it("a single-module gate's top-level write is refused", async () => {
    quiet();
    const attached: string[] = [];
    const system = createSystem({
      module: gated((facts) => {
        facts.running = false;

        return true;
      }, attached),
    });
    system.start();
    await system.settle();

    expect(attached).toEqual([]);
    expect(system.facts.running).toBe(true);
    const row = system.inspect().sources.find((s) => s.id === "frame")!;
    expect(row.lastError?.phase).toBe("gate");
    system.destroy();
  });

  it("a gate that only reads attaches", async () => {
    quiet();
    const attached: string[] = [];
    const system = createSystem({
      module: gated((facts) => facts.running && facts.cfg.hz > 0, attached),
    });
    system.start();
    await system.settle();

    expect(attached).toEqual(["frame"]);
    system.destroy();
  });
});
