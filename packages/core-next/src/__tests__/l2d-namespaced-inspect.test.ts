/**
 * L2d: namespaced constraints and resolvers (RFC row 15), the data-form
 * `$changed` refusal (row 16), inspect()'s L2 sections, and the last L2
 * gaps (a resolver with no resolve, requeue across stop, the effect chain
 * across stop and start). Each case is 1.35's behaviour.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

const flush = async (n = 40) => {
  for (let i = 0; i < n; i++) {
    await Promise.resolve();
  }
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** A module with one constraint `load` and one resolver `load`. */
function loader(name: string, deps?: Record<string, unknown>) {
  const seen: unknown[] = [];
  const mod = createModule(name, {
    schema: {
      facts: { go: t.boolean(), done: t.boolean() },
      derivations: {},
      events: {},
      requirements: { LOAD: {} },
    },
    crossModuleDeps: deps,
    init: (facts: any) => {
      facts.go = false;
      facts.done = false;
    },
    constraints: {
      load: {
        when: (facts: any) =>
          (deps ? facts.self.go : facts.go) &&
          !(deps ? facts.self.done : facts.done),
        require: { type: "LOAD", from: name },
      },
    },
    resolvers: {
      load: {
        requirement: (req: any) => req.type === "LOAD" && req.from === name,
        resolve: async (_req: unknown, context: any) => {
          seen.push({ facts: Object.keys(context.facts), deps: context.deps });
          context.facts.done = true;
        },
      },
    },
  } as never);

  return { mod, seen };
}

describe("namespaced constraints and resolvers", () => {
  it("qualifies every constraint, resolver and requirement id by its module", async () => {
    const a = loader("a");
    const b = loader("b");
    const started: unknown[] = [];
    const system: any = createSystem({
      modules: { a: a.mod, b: b.mod },
      plugins: [
        {
          name: "ids",
          onResolverStart: (resolver: string, req: any) =>
            started.push([resolver, req.fromConstraint]),
        },
      ],
    } as never);
    system.start();
    const view = system.inspect();
    expect(view.constraints.map((c: any) => c.id)).toEqual([
      "a::load",
      "b::load",
    ]);
    expect(view.resolverDefs).toEqual([
      { id: "a::load", requirement: "(predicate)", meta: undefined },
      { id: "b::load", requirement: "(predicate)", meta: undefined },
    ]);
    system.facts.a.go = true;
    system.facts.b.go = true;
    await system.settle();
    expect(started).toEqual([
      ["a::load", "a::load"],
      ["b::load", "b::load"],
    ]);
    expect(system.facts.a.done).toBe(true);
    expect(system.facts.b.done).toBe(true);
    system.destroy();
  });

  it("hands a resolver its own facts, and context.deps only with crossModuleDeps", async () => {
    const auth = createModule("auth", {
      schema: { facts: { token: t.string() }, derivations: {}, events: {} },
      init: (facts: any) => {
        facts.token = "t1";
      },
    } as never);
    const plain = loader("plain");
    const linked = loader("linked", { auth: auth.schema });
    const system: any = createSystem({
      modules: { auth, plain: plain.mod, linked: linked.mod },
    } as never);
    system.start();
    system.facts.plain.go = true;
    system.facts.linked.go = true;
    await system.settle();
    expect(plain.seen).toEqual([{ facts: ["go", "done"], deps: undefined }]);
    const [seen] = linked.seen as [{ facts: string[]; deps: any }];
    expect(seen.facts).toEqual(["go", "done"]);
    expect(Object.keys(seen.deps)).toEqual(["auth"]);
    system.destroy();
  });

  it("refuses a resolver's write to another module through context.deps", async () => {
    const auth = createModule("auth", {
      schema: { facts: { token: t.string() }, derivations: {}, events: {} },
      init: (facts: any) => {
        facts.token = "t1";
      },
    } as never);
    const errors: unknown[] = [];
    const notes = createModule("notes", {
      schema: {
        facts: { go: t.boolean() },
        derivations: {},
        events: {},
        requirements: { W: {} },
      },
      crossModuleDeps: { auth: auth.schema },
      init: (facts: any) => {
        facts.go = false;
      },
      constraints: {
        w: { when: (facts: any) => facts.self.go, require: { type: "W" } },
      },
      resolvers: {
        w: {
          requirement: "W",
          resolve: async (_req: unknown, context: any) => {
            context.facts.go = false;
            context.deps.auth.token = "stolen";
          },
        },
      },
    } as never);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const system: any = createSystem({
      modules: { auth, notes },
      plugins: [{ name: "e", onError: (e: unknown) => errors.push(e) }],
    } as never);
    system.start();
    system.facts.notes.go = true;
    await system.settle();
    expect(system.facts.auth.token).toBe("t1");
    expect(String((errors[0] as Error).message)).toContain(
      'a resolver wrote "auth.token"',
    );
    system.destroy();
  });
});

describe("a data-form when with $changed", () => {
  const withWhen = (when: unknown) =>
    createModule("m", {
      schema: {
        facts: { x: t.number() },
        derivations: {},
        events: {},
        requirements: { R: {} },
      },
      init: (facts: any) => {
        facts.x = 0;
      },
      constraints: { c: { when, require: { type: "R" } } },
      resolvers: { r: { requirement: "R", resolve: async () => {} } },
    } as never);

  it("is refused at createSystem, wherever the operator sits", () => {
    for (const when of [
      { x: { $changed: true } },
      { $all: [{ x: { $gt: 1 } }, { x: { $changed: true } }] },
      [{ fact: "x", op: "$changed", value: true }],
      { $changed: true },
    ]) {
      expect(() => createSystem({ module: withWhen(when) } as never)).toThrow(
        '[Directive] constraint "c": $changed is effects-only',
      );
    }
    expect(() =>
      createSystem({
        modules: { n: withWhen({ x: { $changed: true } }) },
      } as never),
    ).toThrow('[Directive] constraint "n::c": $changed is effects-only');
  });

  it("is not looked for inside an operand", () => {
    expect(() =>
      createSystem({
        module: withWhen({ x: { $eq: { $changed: true } } }),
      } as never),
    ).not.toThrow();
  });
});

describe("inspect() and the last L2 gaps", () => {
  it("reports a run pending as it starts, then running with its attempt", async () => {
    let release!: () => void;
    const statuses: unknown[] = [];
    const mod = createModule("m", {
      schema: {
        facts: { go: t.boolean() },
        derivations: {},
        events: {},
        requirements: { R: {} },
      },
      init: (facts: any) => {
        facts.go = false;
      },
      constraints: { c: { when: (f: any) => f.go, require: { type: "R" } } },
      resolvers: {
        r: {
          requirement: "R",
          resolve: () => new Promise<void>((done) => (release = done)),
        },
      },
    } as never);
    const holder: { system?: any } = {};
    const system: any = createSystem({
      module: mod,
      plugins: [
        {
          name: "s",
          onResolverStart: () =>
            statuses.push(holder.system.inspect().resolvers["R:{}"]),
        },
      ],
    } as never);
    holder.system = system;
    system.start();
    system.facts.go = true;
    await flush();
    expect(statuses).toMatchObject([{ state: "pending" }]);
    const view = system.inspect();
    expect(view.resolvers["R:{}"]).toMatchObject({
      state: "running",
      attempt: 1,
    });
    expect(view.unmet.map((r: any) => r.id)).toEqual(["R:{}"]);
    expect(view.inflight).toMatchObject([{ id: "R:{}", resolverId: "r" }]);
    expect(view.constraints).toMatchObject([
      { id: "c", active: true, disabled: false, priority: 0, hitCount: 1 },
    ]);
    release();
    system.destroy();
  });

  it("refuses a resolver with no resolve when the system is created", () => {
    const mod = createModule("m", {
      schema: { facts: {}, derivations: {}, events: {}, requirements: {} },
      resolvers: { r: { requirement: "R" } },
    } as never);
    expect(() => createSystem({ module: mod } as never)).toThrow(
      'Resolver "r" must define either resolve() or resolveBatch()',
    );
  });

  it("drops a requeue asked by a run that stop() canceled", async () => {
    let calls = 0;
    let release!: () => void;
    const mod = createModule("m", {
      schema: {
        facts: { go: t.boolean() },
        derivations: {},
        events: {},
        requirements: { R: {} },
      },
      init: (facts: any) => {
        facts.go = true;
      },
      constraints: { c: { when: (f: any) => f.go, require: { type: "R" } } },
      resolvers: {
        r: {
          requirement: "R",
          resolve: async (_req: unknown, context: any) => {
            calls++;
            if (calls === 1) {
              context.requeue();
            }
            await new Promise<void>((done) => (release = done));
          },
        },
      },
    } as never);
    const system: any = createSystem({ module: mod } as never);
    system.start();
    await flush();
    expect(calls).toBe(1);
    system.stop();
    system.start();
    await flush();
    // Quirk j: dispatched again once after start(), and only once.
    expect(calls).toBe(2);
    release();
    await flush();
    expect(calls).toBe(2);
    system.destroy();
  });

  it("starts the effect chain over on stop() and start(), as 1.35", async () => {
    let echo = 0;
    let cut = false;
    vi.spyOn(console, "warn").mockImplementation((message) => {
      if (String(message).includes("kept waking each other")) {
        cut = true;
      }
    });
    const mod = createModule("m", {
      schema: { facts: { n: t.number() }, events: { bump: {} } },
      init: (facts) => {
        facts.n = 0;
      },
      events: {
        bump: (facts) => {
          facts.n = facts.n + 1;
        },
      },
      effects: {
        echo: {
          run: (facts) => {
            if (facts.n > 0 && !cut) {
              echo++;
              if (facts.n === 60) {
                system.stop();
              }
              system.events.bump();
            }
          },
        },
      },
    });
    const system = createSystem({ module: mod });
    system.start();
    system.events.bump();
    for (let i = 0; i < 20 && system.isRunning; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(system.isRunning).toBe(false);
    expect(cut).toBe(false);
    const before = echo;
    system.start();
    for (let i = 0; i < 40 && !cut; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(cut).toBe(true);
    // 1.35 counts the chain from zero again: 101 more echo runs to the cut
    // (without the reset, 42).
    expect(echo - before).toBe(101);
    system.destroy();
  });
});
