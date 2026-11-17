/**
 * L10b: dynamic definitions, per module (the L10 RFC's M1 to M7, H1 to H4,
 * the store's registerKeys and unregisterKeys), and the `after` gap L10a's
 * fix-check found. Each test names the code it pins: it fails when that code
 * is removed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";
import { Flags } from "../graph.js";

type Any = any;

const mod = (extra: Record<string, unknown> = {}) =>
  createModule("m", {
    schema: {
      facts: { n: t.number(), log: t.array<string>() },
      derivations: { double: t.number() },
      requirements: { WORK: {} },
    },
    init: (facts: Any) => {
      facts.n = 1;
      facts.log = [];
    },
    derive: { double: (facts: Any) => facts.n * 2 },
    ...extra,
  } as never);
const started = (extra?: Record<string, unknown>, options = {}) => {
  const system = createSystem({
    module: mod(extra),
    ...options,
  } as never) as Any;
  system.start();

  return system;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the core's copy of the graph's bits (core.ts const enum F)", () => {
  it("each bit the core inlines is graph.ts's Flags value", () => {
    expect([Flags.Dirty, Flags.Running, Flags.Errored]).toEqual([4, 16, 512]);
  });
});

describe("`after` on a dependency registered later (constraints.ts blocks)", () => {
  it("a dependency that resolved before does not hold its dependent for being asked later in the pass, as 1.35's resolvedConstraints", async () => {
    const order: string[] = [];
    const on = (f: Any) => f.n > 0;
    const system = started(
      {
        constraints: {
          cb: { when: on, require: { type: "WORK", k: "b" }, after: ["dyn"] },
        },
        resolvers: { work: { requirement: "WORK", resolve() {} } },
      },
      {
        plugins: [
          {
            name: "p",
            onConstraintEvaluate: (id: string) => void order.push(id),
          },
        ],
      },
    );
    await system.settle();
    system.constraints.register("dyn", {
      when: on,
      require: { type: "WORK", k: "d" },
    });
    await system.settle();
    order.length = 0;
    system.facts.n = 2;
    await system.settle();
    // `dyn` ranks with the first (no resort), so `cb` comes before it; 1.35
    // asks `cb` in its place because `dyn` resolved before.
    expect(order).toEqual(["cb", "dyn"]);
    system.destroy();
  });
});

const extra = (hooks: Record<string, unknown> = {}, more = {}) =>
  createModule("x", {
    schema: {
      facts: { c: t.number() },
      derivations: { twice: t.number() },
      events: { bump: {} },
      requirements: { GO: {} },
    },
    init: (facts: Any) => {
      facts.c = 10;
    },
    derive: { twice: (facts: Any) => facts.c * 2 },
    events: {
      bump: (facts: Any) => {
        facts.c += 1;
      },
    },
    effects: { see: { run: () => undefined } },
    sources: { feed: { attach: () => () => undefined } },
    constraints: {
      go: { when: (facts: Any) => facts.c > 100, require: { type: "GO" } },
    },
    resolvers: { go: { requirement: "GO", resolve() {} } },
    hooks,
    ...more,
  } as never);
const watched = (seen: string[], options = {}) =>
  started(
    {},
    {
      plugins: [
        {
          name: "p",
          onDefinitionRegister: (type: string, id: string) =>
            void seen.push(`+${type}:${id}`),
          onDefinitionUnregister: (type: string, id: string) =>
            void seen.push(`-${type}:${id}`),
          onModuleRegistered: (id: string) => void seen.push(`+module ${id}`),
          onModuleUnregistered: (id: string) => void seen.push(`-module ${id}`),
        },
      ],
      ...options,
    },
  );

describe("registerModule (dynamic.ts modules, M1 to M3)", () => {
  it("merges every section, runs init in a batch, and tells plugins in 1.35's order", async () => {
    const seen: string[] = [];
    const hooks = { onInit: vi.fn(), onStart: vi.fn() };
    const system = watched(seen);
    // Each notification of `n`: two writes in one batch are heard once,
    // with the last value, as 1.35's store.batch around init (engine.ts:4627–4632).
    const batches: number[] = [];
    system.subscribe(["n"], () => void batches.push(system.facts.n));
    system.registerModule(
      extra(hooks, {
        init: (facts: Any) => {
          facts.n = 7;
          facts.n = 8;
          facts.c = 10;
        },
      }),
    );
    expect(system.facts.c).toBe(10);
    expect(system.derive.twice).toBe(20);
    system.events.bump();
    expect(system.facts.c).toBe(11);
    const seenBy = system.inspect();
    expect(seenBy.resolverDefs).toEqual([{ id: "go", requirement: "GO" }]);
    expect(seenBy.constraints.map((c: Any) => c.id)).toEqual(["go"]);
    expect(seenBy.effects).toEqual([{ id: "see" }]);
    expect(seenBy.modules.map((m: Any) => m.id)).toEqual(["m", "x"]);
    expect(seen).toEqual(["+source:feed", "+module x"]);
    expect(hooks.onInit).toHaveBeenCalledTimes(1);
    expect(hooks.onStart).toHaveBeenCalledTimes(1);
    expect(batches).toEqual([8]);
    system.facts.c = 200;
    await system.settle();
    expect(system.inspect().sources.map((s: Any) => s.id)).toEqual(["feed"]);
    system.destroy();
  });

  it("refuses a fact that exists, a blocked key and a `$` key, with 1.35's texts", () => {
    const system = started();
    expect(() =>
      system.registerModule(
        createModule("y", { schema: { facts: { n: t.number() } } } as never),
      ),
    ).toThrow(
      '[Directive] Schema collision: Fact "n" already exists. Cannot register module "y".',
    );
    expect(() =>
      system.registerModule({
        id: "z",
        schema: { facts: {} },
        events: JSON.parse('{"__proto__": 1}'),
      }),
    ).toThrow(
      '[Directive] Security: Module "z" has dangerous key "__proto__" in events.',
    );
    expect(() =>
      system.registerModule({ id: "z", schema: { facts: { $a: t.number() } } }),
    ).toThrow('Module "z" has schema key "$a" starting with "$"');
    system.destroy();
    expect(() => system.registerModule(extra())).toThrow(
      '[Directive] Cannot register module "x" on a destroyed system.',
    );
  });

  it("M2: a derivation the module names that exists is replaced, with no warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = started();
    system.registerModule({
      id: "y",
      schema: { facts: {} },
      derive: { double: () => -1 },
    });
    expect(system.derive.double).toBe(-1);
    expect(warn).not.toHaveBeenCalled();
    system.destroy();
  });

  it("M2: a derivation that read the one replaced computes again (the kind's replace_, not a second add_)", () => {
    const system = createSystem({
      module: createModule("m", {
        schema: {
          facts: { n: t.number() },
          derivations: { double: t.number(), quad: t.number() },
        },
        init: (facts: Any) => {
          facts.n = 1;
        },
        derive: {
          double: (facts: Any) => facts.n * 2,
          quad: (_facts: Any, derived: Any) => derived.double * 2,
        },
      } as never),
    } as never) as Any;
    system.start();
    expect(system.derive.quad).toBe(4);
    system.registerModule({
      id: "y",
      schema: { facts: {} },
      derive: { double: () => -1 },
    });
    expect(system.derive.quad).toBe(-2);
    system.destroy();
  });

  it("inspect lists each module as { id, meta } only (inspect.ts modules)", () => {
    const system = started();
    system.registerModule(extra({}, { meta: { label: "X" } }));
    const rows = system.inspect().modules;
    expect(rows.map((row: Any) => Object.keys(row))).toEqual([
      ["id", "meta"],
      ["id", "meta"],
    ]);
    expect(rows[1]).toEqual({ id: "x", meta: { label: "X" } });
    system.destroy();
  });

  it("meta.subscribe hears registerModule twice: the store's keys, then the module", () => {
    const system = started();
    let heard = 0;
    system.meta.subscribe(() => void heard++);
    system.registerModule(extra());
    expect(heard).toBe(2);
    system.destroy();
  });
});

describe("unregisterModule (dynamic.ts modules, M5 to M7)", () => {
  it("refuses the caller's module object, as 1.35 registers a copy (system.ts:1338–1352, engine.ts:4686–4694)", async () => {
    const initial = mod();
    const system = createSystem({ module: initial } as never) as Any;
    system.start();
    const z = createModule("z", {
      schema: { facts: { q: t.number() } },
    } as never);
    system.registerModule(z);
    const missing = (label: string) =>
      `[Directive] Cannot unregister module "${label}": no such module is registered.`;
    await expect(system.unregisterModule(z)).rejects.toThrow(missing("z"));
    await expect(system.unregisterModule(initial)).rejects.toThrow(
      missing("m"),
    );
    await expect(system.unregisterModule({})).rejects.toThrow(
      missing("<module>"),
    );
    expect(Object.keys(system.facts)).toContain("q");
    await system.unregisterModule("z");
    expect(Object.keys(system.facts)).not.toContain("q");
    system.destroy();
    // Namespaced: 1.35's namespace lookup (system.ts:857–862) finds no object.
    const ns = createSystem({ modules: { m: mod() } } as never) as Any;
    ns.start();
    await expect(ns.unregisterModule(mod())).rejects.toThrow(
      '[Directive] Cannot unregister module "[object Object]": no such module namespace.',
    );
    expect(ns.facts.m.n).toBe(1);
    ns.destroy();
  });

  it("tears down in 1.35's order, drops the facts, and refuses a second call", async () => {
    const seen: string[] = [];
    const onStop = vi.fn();
    const system = watched(seen);
    system.registerModule(extra({ onStop }));
    seen.length = 0;
    await system.unregisterModule("x");
    expect(seen).toEqual([
      "-source:feed",
      "-resolver:go",
      "-constraint:go",
      "-effect:see",
      "-derivation:twice",
      "-module:x",
      "-module x",
    ]);
    expect("c" in system.facts).toBe(false);
    expect("twice" in system.derive).toBe(false);
    expect(system.inspect().modules.map((m: Any) => m.id)).toEqual(["m"]);
    expect(onStop).toHaveBeenCalledTimes(1);
    system.stop();
    expect(onStop).toHaveBeenCalledTimes(1);
    await expect(system.unregisterModule("x")).rejects.toThrow(
      '[Directive] Cannot unregister module "x": no such module is registered.',
    );
    system.destroy();
  });

  it("detaches the module's sources at once (sources.ts remove_)", async () => {
    const detach = vi.fn();
    const attach = vi.fn(() => detach);
    const system = started();
    system.registerModule(extra({}, { sources: { feed: { attach } } }));
    await system.settle();
    expect(attach).toHaveBeenCalledTimes(1);
    expect(detach).not.toHaveBeenCalled();
    await system.unregisterModule("x");
    expect(detach).toHaveBeenCalledTimes(1);
    system.destroy();
    expect(detach).toHaveBeenCalledTimes(1);
  });

  it("a second call joins the first, and onStop's throw is logged, not raised", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const onStop = vi.fn(() => {
      throw new Error("no");
    });
    const system = started();
    system.registerModule(extra({ onStop }));
    await Promise.all([
      system.unregisterModule("x"),
      system.unregisterModule("x"),
    ]);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]![0]).toBe(
      '[Directive] Module "x" hooks.onStop threw during unregister:',
    );
    system.destroy();
  });

  it("waits for an in-flight resolver, whose late write is dropped (M7)", async () => {
    let finish = () => {};
    let late = (_n: number) => {};
    const system = started();
    system.registerModule({
      id: "w",
      schema: { facts: { go: t.boolean(), out: t.number() } },
      init: (facts: Any) => {
        facts.go = true;
      },
      constraints: {
        work: { when: (f: Any) => f.go, require: { type: "WORK" } },
      },
      resolvers: {
        work: {
          requirement: "WORK",
          resolve: (_r: Any, ctx: Any) =>
            new Promise<void>((resolve) => {
              late = (n) => {
                ctx.facts.out = n;
              };
              finish = resolve;
            }),
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    let done = false;
    const going = system.unregisterModule("w").then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(done).toBe(false);
    finish();
    await going;
    late(5);
    expect(system.facts.out).toBeUndefined();
    system.destroy();
  });

  it("gives up waiting after 10 s on a resolver that never settles", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = started();
    system.registerModule({
      id: "w",
      schema: { facts: { go: t.boolean() } },
      init: (facts: Any) => {
        facts.go = true;
      },
      constraints: {
        hang: { when: (f: Any) => f.go, require: { type: "HANG" } },
      },
      resolvers: {
        hang: { requirement: "HANG", resolve: () => new Promise(() => {}) },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    vi.useFakeTimers();
    try {
      let done = false;
      const going = system.unregisterModule("w").then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(9_000);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1_100);
      await going;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    system.destroy();
  });

  it("keeps a requirement key another resolver still declares", async () => {
    const keyed: string[] = [];
    const make = (name: string) =>
      createModule(name, {
        schema: { facts: { go: t.boolean() }, requirements: { SHARED: {} } },
        init: (facts: Any) => {
          facts.go = false;
        },
        constraints: {
          [`c_${name}`]: {
            when: (f: Any) => f.go,
            require: { type: "SHARED" },
          },
        },
        resolvers: {
          [`r_${name}`]: {
            requirement: "SHARED",
            key: () => {
              keyed.push(name);

              return `k-${name}`;
            },
            resolve: async () => undefined,
          },
        },
      } as never);
    const system = createSystem({
      modules: { one: make("one"), two: make("two") },
    } as never) as Any;
    system.start();
    await system.unregisterModule("one");
    keyed.length = 0;
    system.facts.two.go = true;
    await system.settle();
    expect(keyed).toContain("two");
    system.destroy();
  });
});

describe("the store's registerKeys and unregisterKeys (dynamic.ts)", () => {
  it("refuses to re-declare a key, records a new one, and drops writes to a key taken away", () => {
    const system = started();
    const store = system.facts.$store;
    expect(() => store.registerKeys({ n: t.string() })).toThrow(
      '[Directive] Cannot re-declare fact "n".',
    );
    store.registerKeys({ k: t.number() });
    expect(Object.keys(system.facts)).toContain("k");
    store.unregisterKeys(["k"]);
    expect(Object.keys(system.facts)).not.toContain("k");
    system.facts.k = 3;
    expect(system.facts.k).toBeUndefined();
    store.registerKeys({ k: t.number() });
    system.facts.k = 4;
    expect(system.facts.k).toBe(4);
    system.destroy();
  });
});

describe("namespaced registerModule and unregisterModule (namespaced.ts)", () => {
  const ns = () => createSystem({ modules: { m: mod() } } as never) as Any;

  it("refuses a duplicate, a `::` and a blocked name; a failed registration frees the name", async () => {
    const system = ns();
    system.start();
    expect(() => system.registerModule("m", mod())).toThrow(
      '[Directive] Module namespace "m" already exists. Cannot register a duplicate namespace.',
    );
    expect(() => system.registerModule("a::b", mod())).toThrow(
      'Module name "a::b" contains the reserved separator "::".',
    );
    expect(() => system.registerModule("constructor", mod())).toThrow(
      '[Directive] Module name "constructor" is a blocked property.',
    );
    // The engine refuses "a:" (its `a:::x` is taken), and "a:" is free again,
    // as 1.35's rollback (system.ts:837–854).
    const key = (id: string) =>
      createModule(id, { schema: { facts: { [id]: t.number() } } } as never);
    system.registerModule("a", key(":x"));
    expect(() => system.registerModule("a:", key("x"))).toThrow(
      '[Directive] Schema collision: Fact "a:::x" already exists. Cannot register module "a:".',
    );
    expect(Object.keys(system.facts)).not.toContain("a:");
    system.registerModule("a:", key("y"));
    system.facts["a:"].y = 3;
    expect(system.facts["a:"].y).toBe(3);
    await system.unregisterModule("a:");
    expect(Object.keys(system.facts)).not.toContain("a:");
    system.registerModule("bad", extra());
    expect(system.facts.bad.c).toBe(10);
    await system.unregisterModule("bad");
    expect(system.facts.bad).toBeUndefined();
    await expect(system.unregisterModule("bad")).rejects.toThrow(
      '[Directive] Cannot unregister module "bad": no such module namespace.',
    );
    system.destroy();
    // The engine refuses; the namespace is rolled back.
    expect(() => system.registerModule("late", extra())).toThrow(
      "on a destroyed system",
    );
    expect(Object.keys(system.facts)).not.toContain("late");
  });

  it("a refused registration leaves a resolver's owner as it was (1.35's engine.ts:4598, after its checks)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const hits: string[] = [];
    const a = createModule("a", {
      schema: {
        facts: { ":x": t.number() },
        events: { go: {} },
        requirements: { R: {} },
      },
      init: (facts: Any) => {
        facts[":x"] = 0;
      },
      events: {
        go: (facts: Any) => {
          facts[":x"] = 1;
        },
      },
      constraints: {
        c: { when: (facts: Any) => facts[":x"] === 1, require: { type: "R" } },
      },
      resolvers: {
        ":r": {
          requirement: "R",
          resolve() {
            throw new Error("boom");
          },
        },
      },
      hooks: { onResolverError: () => void hits.push("a") },
    } as never);
    // Its resolver `r` is `a:::r` too, and its fact `x` is taken.
    const refused = createModule("refused", {
      schema: { facts: { x: t.number() }, requirements: { R: {} } },
      resolvers: { r: { requirement: "R", resolve() {} } },
      hooks: { onResolverError: () => void hits.push("refused") },
    } as never);
    const system = createSystem({ modules: { a } } as never) as Any;
    system.start();
    expect(() => system.registerModule("a:", refused)).toThrow(
      "Schema collision",
    );
    system.events.a.go();
    await vi.waitFor(() => expect(hits).toEqual(["a"]));
    system.destroy();
  });

  it("a module registered later reads and writes its own namespaced facts", async () => {
    const system = ns();
    system.start();
    system.registerModule("x", extra());
    system.events.x.bump();
    expect(system.facts.x.c).toBe(11);
    expect(system.read("x.twice")).toBe(22);
    await system.unregisterModule("m");
    expect(system.facts.m).toBeUndefined();
    expect(system.facts.x.c).toBe(11);
    system.destroy();
  });
});
