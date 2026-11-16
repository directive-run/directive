import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

// Black-box pins for the gate=L9 mutation debt in 1.35's engine.ts: authored
// meta (frozen copies, system.meta's lookups, byTag, carriesTag, subscribe,
// destroy), the schema-type freeze, trace bookkeeping (fact changes and their
// meta, resolver meta, cancels, deps-free constraints, requirements with no
// resolver), observe()'s event records and explain()'s text. Each pins what
// 1.35 does today. Public API only.

beforeEach(() => {
  // Thrown constraints, failing resolvers and orphan requirements log; none
  // of that output is under test.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const wait = (ms = 0) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });

  return { promise, open };
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

interface MetaOptions {
  moduleMeta?: Record<string, unknown>;
}

/**
 * One definition of each kind tagged "x", one with meta but no tags, and one
 * with no meta at all. The derivation `inherits` reads the tagged fact.
 */
function metaModule(options: MetaOptions = {}) {
  const authored = {
    module: options.moduleMeta ?? { label: "Mod", tags: ["x"] },
    constraint: { label: "C", tags: ["x"] },
    resolver: { label: "R", tags: ["x"] },
    effect: { label: "E", tags: ["x"] },
  };
  const noMeta = {
    constraint: { when: () => false, require: { type: "NEVER" } },
    resolver: { requirement: "NEVER", resolve: async () => {} },
    effect: { run: () => {} },
  };
  const mod = createModule("m", {
    schema: {
      facts: {
        tagged: t.string().meta({ label: "F", tags: ["x"] }),
        list: t.array<number>().meta({ label: "L", tags: ["x"] }),
        shape: t.object<{ a: number }>().meta({ label: "O", tags: ["x"] }),
        flag: t.boolean().meta({ label: "B", tags: ["x"] }),
        plain: t.number(),
      },
      derivations: {
        authoredTag: t.number(),
        metaNoTags: t.number(),
        plainDerived: t.number(),
        inherits: t.string(),
      },
      events: { handled: {}, patched: {}, metaNoTags: {}, bare: {} },
      requirements: { NEVER: {} },
    },
    init: (f: any) => {
      f.tagged = "t";
      f.list = [];
      f.shape = { a: 1 };
      f.flag = false;
      f.plain = 0;
    },
    derive: {
      authoredTag: { compute: () => 1, meta: { tags: ["x"] } },
      metaNoTags: { compute: () => 2, meta: { label: "D" } },
      plainDerived: () => 3,
      inherits: (f: any) => f.tagged,
    },
    events: {
      handled: {
        handler: (f: any) => {
          f.plain = 1;
        },
        meta: { label: "H", tags: ["x"] },
      },
      patched: {
        patch: { $set: { plain: 2 } },
        meta: { label: "P", tags: ["x"] },
      },
      metaNoTags: { handler: () => {}, meta: { label: "N" } },
      bare: () => {},
    },
    constraints: {
      cTagged: {
        when: () => false,
        require: { type: "NEVER" },
        meta: authored.constraint,
      },
      cMetaNoTags: {
        when: () => false,
        require: { type: "NEVER" },
        meta: { label: "C2" },
      },
      cNoMeta: noMeta.constraint,
    },
    resolvers: {
      rTagged: {
        requirement: "NEVER",
        resolve: async () => {},
        meta: authored.resolver,
      },
      rMetaNoTags: {
        requirement: "NEVER",
        resolve: async () => {},
        meta: { label: "R2" },
      },
      rNoMeta: noMeta.resolver,
    },
    effects: {
      eTagged: { run: () => {}, meta: authored.effect },
      eMetaNoTags: { run: () => {}, meta: { label: "E2" } },
      eNoMeta: noMeta.effect,
    },
    meta: authored.module,
  } as never);

  return { mod, authored, noMeta };
}

function metaSystem(options: MetaOptions = {}) {
  const built = metaModule(options);
  const system = createSystem({ module: built.mod } as never) as any;
  system.start();

  return { system, ...built };
}

describe("system.meta reads back each definition's authored meta (L9 gate debt)", () => {
  it("as a frozen copy, for a module, a handler event, a patch event and each definition", () => {
    const { system, authored } = metaSystem();

    expect(system.meta.module("m")).toEqual({ label: "Mod", tags: ["x"] });
    expect(Object.isFrozen(system.meta.module("m"))).toBe(true);
    expect(system.meta.module("m")).not.toBe(authored.module);
    expect(system.meta.event("handled")).toEqual({ label: "H", tags: ["x"] });
    expect(Object.isFrozen(system.meta.event("handled"))).toBe(true);
    expect(system.meta.event("patched")).toEqual({ label: "P", tags: ["x"] });
    expect(Object.isFrozen(system.meta.event("patched"))).toBe(true);
    expect(system.meta.event("bare")).toBeUndefined();
    for (const [kind, id] of [
      ["constraint", "cTagged"],
      ["resolver", "rTagged"],
      ["effect", "eTagged"],
    ] as const) {
      const meta = system.meta[kind](id);
      expect(meta).toEqual(authored[kind]);
      expect(meta).not.toBe(authored[kind]);
      expect(Object.isFrozen(meta)).toBe(true);
    }
    expect(system.meta.fact("list")).toEqual({ label: "L", tags: ["x"] });
    expect(system.meta.fact("shape")).toEqual({ label: "O", tags: ["x"] });
    expect(system.meta.fact("flag")).toEqual({ label: "B", tags: ["x"] });
    system.destroy();
  });

  it("adds no meta key to a definition authored without one", () => {
    const { system, noMeta } = metaSystem();

    expect(Object.keys(noMeta.constraint)).toEqual(["when", "require"]);
    expect(Object.keys(noMeta.resolver)).toEqual(["requirement", "resolve"]);
    expect(Object.keys(noMeta.effect)).toEqual(["run"]);
    system.destroy();
  });

  it("byTag lists every tagged definition, in kind order, and filters by kind", () => {
    const { system } = metaSystem();
    const describe = (m: any) =>
      `${m.kind}:${m.id}:${m.tagOrigin}:${m.meta.label}`;

    expect(system.meta.byTag("x").map(describe)).toEqual([
      "module:m:authored:Mod",
      "fact:tagged:authored:F",
      "fact:list:authored:L",
      "fact:shape:authored:O",
      "fact:flag:authored:B",
      "event:handled:authored:H",
      "event:patched:authored:P",
      "constraint:cTagged:authored:C",
      "resolver:rTagged:authored:R",
      "effect:eTagged:authored:E",
      "derivation:authoredTag:authored:undefined",
      "derivation:inherits:inherited:undefined",
    ]);
    expect(system.meta.byTag("x", { kind: "event" }).map(describe)).toEqual([
      "event:handled:authored:H",
      "event:patched:authored:P",
    ]);
    expect(system.meta.byTag("x", { kind: "resolver" }).map(describe)).toEqual([
      "resolver:rTagged:authored:R",
    ]);
    system.destroy();
  });

  it("carriesTag answers true, false or undefined for each kind", () => {
    const { system } = metaSystem();
    const carries = (kind: string, id: string, tag = "x") =>
      system.meta.carriesTag(kind, id, tag);

    expect(carries("module", "m")).toBe(true);
    expect(carries("module", "m", "y")).toBe(false);
    expect(carries("event", "handled")).toBe(true);
    expect(carries("event", "metaNoTags")).toBe(false);
    expect(carries("event", "bare")).toBeUndefined();
    for (const [kind, prefix] of [
      ["constraint", "c"],
      ["resolver", "r"],
      ["effect", "e"],
    ] as const) {
      expect(carries(kind, `${prefix}Tagged`)).toBe(true);
      expect(carries(kind, `${prefix}Tagged`, "y")).toBe(false);
      expect(carries(kind, `${prefix}MetaNoTags`)).toBe(false);
      expect(carries(kind, `${prefix}NoMeta`)).toBe(false);
      expect(carries(kind, `${prefix}Missing`)).toBeUndefined();
    }
    expect(carries("derivation", "authoredTag")).toBe(true);
    expect(carries("derivation", "authoredTag", "y")).toBe(false);
    expect(carries("derivation", "metaNoTags")).toBe(false);
    expect(carries("derivation", "plainDerived")).toBe(false);
    expect(carries("derivation", "inherits")).toBe(true);
    system.destroy();
  });

  it("carriesTag on a module whose meta has no tags answers false", () => {
    const { system } = metaSystem({ moduleMeta: { label: "Untagged" } });

    expect(system.meta.carriesTag("module", "m", "x")).toBe(false);
    system.destroy();
  });

  it("subscribe with immediate calls the listener at once, in either form", () => {
    const { system } = metaSystem();
    const plain = vi.fn();
    const tagged = vi.fn();
    const quiet = vi.fn();
    system.meta.subscribe(plain, { immediate: true });
    system.meta.subscribe(["x"], tagged, { immediate: true });
    system.meta.subscribe(quiet);

    expect(plain).toHaveBeenCalledTimes(1);
    expect(tagged).toHaveBeenCalledTimes(1);
    expect(quiet).not.toHaveBeenCalled();
    system.destroy();
  });

  it("destroy() forgets module and event meta", () => {
    const { system } = metaSystem();
    system.destroy();

    expect(system.meta.module("m")).toBeUndefined();
    expect(system.meta.event("handled")).toBeUndefined();
  });

  it("destroyAsync() forgets module and event meta, and empties the trace", async () => {
    const mod = metaModule().mod;
    const system = createSystem({ module: mod, trace: true } as never) as any;
    system.start();
    system.facts.plain = 5;
    await system.settle();
    expect(system.trace.length).toBeGreaterThan(0);
    await system.destroyAsync();

    expect(system.meta.module("m")).toBeUndefined();
    expect(system.meta.event("handled")).toBeUndefined();
    expect(system.trace).toEqual([]);
  });
});

describe("the schema-type freeze at build (L9 gate debt)", () => {
  it("a module whose fact type carries meta builds a second system", () => {
    const { mod } = metaModule();
    const first = createSystem({ module: mod } as never) as any;

    expect(() => createSystem({ module: mod } as never)).not.toThrow();
    expect(first.meta.fact("tagged")).toEqual({ label: "F", tags: ["x"] });
    first.destroy();
  });

  it("freezes t's own types, leaves a Zod-like schema and a function type as given", () => {
    const zodLike = {
      _def: { typeName: "ZodNumber" },
      parse: (v: unknown) => v,
      safeParse: (v: unknown) => ({ success: true, data: v }),
    };
    const fnType = Object.assign(() => undefined, {
      _typeName: "fn",
      _validators: [],
    });
    // The freeze exists to make a schema type's meta tags unremovable (the
    // meta feature, L9), so the own type here carries meta.
    const own = t.number().meta({ label: "Own" });
    const mod = createModule("z", {
      schema: {
        facts: { zod: zodLike, fn: fnType, own },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (f: any) => {
        f.zod = 1;
      },
    } as never);
    const system = createSystem({ module: mod } as never) as any;
    system.start();
    system.facts.zod = 2;

    expect(system.facts.zod).toBe(2);
    expect(Object.isFrozen(own)).toBe(true);
    expect(system.meta.fact("own")).toEqual({ label: "Own" });
    expect(Object.isFrozen(zodLike)).toBe(false);
    expect(Object.keys(zodLike)).toEqual(["_def", "parse", "safeParse"]);
    expect(Object.isFrozen(fnType)).toBe(false);
    system.destroy();
  });
});

// ---------------------------------------------------------------------------
// Trace
// ---------------------------------------------------------------------------

describe("trace entries (L9 gate debt)", () => {
  function traced(extra: Record<string, unknown> = {}, plugins?: unknown[]) {
    const mod = createModule("m", {
      schema: {
        facts: {
          a: t.number().meta({ label: "A" }),
          b: t.number(),
          go: t.boolean(),
          fail: t.boolean(),
          orphan: t.boolean(),
        },
        derivations: {},
        events: {},
        requirements: { LOAD: {}, FAIL: {}, ORPHAN: {} },
      },
      init: (f: any) => {
        f.a = 0;
        f.b = 0;
        f.go = false;
        f.fail = false;
        f.orphan = false;
      },
      constraints: {
        load: { when: (f: any) => f.go, require: { type: "LOAD" } },
        failing: { when: (f: any) => f.fail, require: { type: "FAIL" } },
        orphaned: { when: (f: any) => f.orphan, require: { type: "ORPHAN" } },
        ...((extra.constraints as object) ?? {}),
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          resolve: (extra.load as never) ?? (async () => {}),
          meta: { label: "Loader" },
        },
        fail: {
          requirement: "FAIL",
          resolve: async () => {
            throw new Error("nope");
          },
          meta: { label: "Failer" },
        },
      },
    } as never);
    const system = createSystem({
      module: mod,
      trace: true,
      ...(plugins ? { plugins } : {}),
    } as never) as any;

    return system;
  }

  it("a batched write's changes are in the entry, with each fact's schema meta", async () => {
    const system = traced();
    system.start();
    await system.settle();
    system.batch(() => {
      system.facts.a = 1;
      system.facts.b = 2;
    });
    await system.settle();
    const entry = system.trace.at(-1);

    expect(entry.factChanges.map((c: any) => c.key)).toEqual(["a", "b"]);
    expect(entry.factChanges[0].meta).toEqual({ label: "A" });
    expect(entry.factChanges[1].meta).toBeUndefined();
    system.destroy();
  });

  it("a resolver's completion and its error carry the resolver's meta", async () => {
    const system = traced();
    system.start();
    system.facts.go = true;
    system.facts.fail = true;
    await wait(20);
    const completed = system.trace.flatMap((e: any) => e.resolversCompleted);
    const errored = system.trace.flatMap((e: any) => e.resolversErrored);

    expect(completed.map((c: any) => [c.resolver, c.meta])).toEqual([
      ["load", { label: "Loader" }],
    ]);
    expect(errored.map((c: any) => [c.resolver, c.meta])).toEqual([
      ["fail", { label: "Failer" }],
    ]);
    system.destroy();
  });

  it('a requirement no resolver takes is started by "unknown"', async () => {
    const system = traced();
    system.start();
    system.facts.orphan = true;
    await wait(10);
    const started = system.trace.flatMap((e: any) => e.resolversStarted);

    expect(started.map((s: any) => s.resolver)).toEqual(["unknown"]);
    system.destroy();
  });

  it("a constraint that reads no fact is hit with no deps, before and after disable()", async () => {
    const system = traced({
      constraints: {
        always: { when: () => true, require: { type: "ORPHAN" } },
      },
    });
    system.start();
    await wait(10);
    // disable() drops its dependency record; reading nothing, it gets none
    // back when enable() lets it run again.
    system.constraints.disable("always");
    await wait(10);
    system.constraints.enable("always");
    system.facts.b = 9;
    await wait(10);
    const hits = system.trace
      .flatMap((e: any) => e.constraintsHit)
      .filter((h: any) => h.id === "always");

    expect(hits.length).toBe(2);
    expect(hits.map((h: any) => h.deps)).toEqual([[], []]);
    system.destroy();
  });

  it("a canceled resolver settles the entry that started it, and observe hears the cancel", async () => {
    const g = gate();
    const system = traced({
      load: async () => {
        await g.promise;
      },
    });
    const events: any[] = [];
    system.observe((e: any) => events.push(e));
    system.start();
    system.facts.go = true;
    await wait(10);
    const entry = system.trace.find((e: any) => e.resolversStarted.length > 0);
    expect(entry.status).toBe("pending");
    system.facts.go = false;
    await wait(10);
    g.open();
    await wait(10);

    expect(system.trace.find((e: any) => e.id === entry.id).status).toBe(
      "settled",
    );
    const canceled = events.filter((e) => e.type === "requirement.canceled");
    expect(canceled).toHaveLength(1);
    expect(canceled[0]).toEqual({
      type: "requirement.canceled",
      id: entry.resolversStarted[0].requirementId,
    });
    system.destroy();
  });

  it("with no plugin configured, an observer hears no reconcile.end; with one it does", async () => {
    const ends = async (options: Record<string, unknown>) => {
      const mod = createModule("m", {
        schema: {
          facts: { n: t.number() },
          derivations: {},
          events: {},
          requirements: {},
        },
        init: (f: any) => {
          f.n = 0;
        },
      } as never);
      const system = createSystem({ module: mod, ...options } as never) as any;
      const types: string[] = [];
      system.observe((e: any) => types.push(e.type));
      system.start();
      system.facts.n = 1;
      await system.settle();
      system.destroy();

      return types.filter((type) => type === "reconcile.end").length;
    };

    expect(await ends({})).toBe(0);
    expect(await ends({ plugins: [] })).toBe(0);
    expect(await ends({ plugins: [{ name: "p" }] })).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// observe()
// ---------------------------------------------------------------------------

describe("observe() event records (L9 gate debt)", () => {
  it("a constraint that throws and a resolver that fails", async () => {
    const mod = createModule("m", {
      schema: {
        facts: { go: t.boolean() },
        derivations: {},
        events: {},
        requirements: { FAIL: {} },
      },
      init: (f: any) => {
        f.go = false;
      },
      constraints: {
        broken: {
          when: (f: any) => {
            if (f.go) {
              throw new Error("when broke");
            }

            return false;
          },
          require: { type: "FAIL" },
        },
        failing: { when: (f: any) => f.go, require: { type: "FAIL" } },
      },
      resolvers: {
        fail: {
          requirement: "FAIL",
          resolve: async () => {
            throw new Error("resolve broke");
          },
        },
      },
    } as never);
    const system = createSystem({ module: mod } as never) as any;
    const events: any[] = [];
    system.observe((e: any) => events.push(e));
    system.start();
    system.facts.go = true;
    await wait(20);

    const constraintErrors = events.filter(
      (e) => e.type === "constraint.error",
    );
    expect(constraintErrors.length).toBeGreaterThan(0);
    expect(constraintErrors[0]).toMatchObject({
      type: "constraint.error",
      id: "broken",
    });
    expect(Object.keys(constraintErrors[0])).toEqual(["type", "id", "error"]);
    const resolverErrors = events.filter((e) => e.type === "resolver.error");
    expect(resolverErrors.length).toBeGreaterThan(0);
    expect(resolverErrors[0]).toMatchObject({
      type: "resolver.error",
      resolver: "fail",
    });
    expect(Object.keys(resolverErrors[0])).toEqual([
      "type",
      "resolver",
      "requirementId",
      "error",
    ]);
    system.destroy();
  });

  it("ten clobbered writes, then one summary of the rest", async () => {
    const keys = Array.from({ length: 12 }, (_, i) => `c${i}`);
    const facts: Record<string, unknown> = { go: t.boolean() };
    for (const k of keys) {
      facts[k] = t.number();
    }
    const g = gate();
    const mod = createModule("m", {
      schema: {
        facts,
        derivations: {},
        events: {},
        requirements: { LOAD: {} },
      },
      init: (f: any) => {
        f.go = false;
        for (const k of keys) {
          f[k] = 0;
        }
      },
      constraints: {
        load: {
          when: (f: any) => f.go,
          require: { type: "LOAD" },
          abortOn: keys,
        },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          resolve: async (_req: unknown, context: any) => {
            await g.promise;
            for (const k of keys) {
              context.facts[k] = 1;
            }
          },
        },
      },
    } as never);
    const system = createSystem({ module: mod } as never) as any;
    const events: any[] = [];
    system.observe((e: any) => events.push(e));
    system.start();
    system.facts.go = true;
    await wait(10);
    for (const k of keys) {
      system.facts[k] = 100;
    }
    await wait(10);
    g.open();
    await wait(10);

    const rejected = events.filter((e) => e.type === "resolver.write.rejected");
    expect(rejected.filter((e) => e.kind === "rejection")).toHaveLength(10);
    const summaries = rejected.filter((e) => e.kind === "summary");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toEqual({
      type: "resolver.write.rejected",
      kind: "summary",
      resolver: "load",
      requirementId: rejected[0].requirementId,
      reason: "clobbered",
      dropped: 1,
    });
    system.destroy();
  });

  it("a source's attach, publish, drop, detach and attach error", async () => {
    let publish: ((name: string, payload?: unknown) => void) | undefined;
    const mod = createModule("m", {
      schema: {
        facts: { n: t.number() },
        derivations: {},
        events: { PING: {} },
        requirements: {},
      },
      init: (f: any) => {
        f.n = 0;
      },
      events: {
        PING: (f: any) => {
          f.n = f.n + 1;
        },
      },
      sources: {
        feed: {
          attach: (p: any) => {
            publish = p;

            return () => undefined;
          },
        },
        broken: {
          attach: () => {
            throw new Error("attach broke");
          },
        },
      },
    } as never);
    const system = createSystem({ module: mod } as never) as any;
    const events: any[] = [];
    system.observe((e: any) => {
      if (String(e.type).startsWith("source.")) {
        events.push(e);
      }
    });
    system.start();
    publish?.("PING");
    publish?.("__proto__");
    await system.settle();
    system.stop();
    const types = events.map((e) => `${e.type}:${e.id}`);

    expect(types).toContain("source.attach:feed");
    expect(types).toContain("source.publish:feed");
    expect(types).toContain("source.drop:feed");
    expect(types).toContain("source.error:broken");
    expect(types).toContain("source.detach:feed");
    for (const e of events) {
      expect(e.moduleId).toBeDefined();
      expect(e.localId).toBeDefined();
    }
    expect(events.find((e) => e.type === "source.publish")).toMatchObject({
      eventName: "PING",
    });
    expect(events.find((e) => e.type === "source.error")).toMatchObject({
      phase: "attach",
    });
    system.destroy();
  });

  it("notify.guardrailCoverage reaches the observer as guardrail.coverage", () => {
    const mod = createModule("m", {
      schema: {
        facts: { n: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (f: any) => {
        f.n = 0;
      },
    } as never);
    const system = createSystem({ module: mod } as never) as any;
    const events: any[] = [];
    system.observe((e: any) => events.push(e));
    system.notify.guardrailCoverage("guard", 3, "digest", "start");

    expect(events.filter((e) => e.type === "guardrail.coverage")).toEqual([
      {
        type: "guardrail.coverage",
        plugin: "guard",
        screenedCount: 3,
        screenedDigest: "digest",
        reason: "start",
      },
    ]);
    system.destroy();
  });
});

// ---------------------------------------------------------------------------
// explain()
// ---------------------------------------------------------------------------

describe("explain() of a requirement whose constraint has no dependency record (L9 gate debt)", () => {
  it("lists every fact, cuts a long value at 50 characters, and gives the description", async () => {
    const long = "y".repeat(60);
    const mod = createModule("m", {
      schema: {
        facts: { short: t.string(), long: t.string() },
        derivations: {},
        events: {},
        requirements: { ORPHAN: {} },
      },
      init: (f: any) => {
        f.short = "hi";
        f.long = long;
      },
      constraints: {
        always: {
          when: () => true,
          require: { type: "ORPHAN" },
          meta: { label: "Always", description: "Always on" },
        },
      },
    } as never);
    const system = createSystem({ module: mod } as never) as any;
    system.start();
    await wait(10);
    const id = system.inspect().unmet[0].id;
    // A disable() drops the constraint's dependency record at once; the
    // requirement stays until the next pass, so explain() falls back to
    // every fact.
    system.constraints.disable("always");
    const text: string = system.explain(id);

    expect(text).toContain("├─ Produced by constraint: Always");
    expect(text).toContain("├─ Description: Always on");
    expect(text).toContain("short = hi");
    expect(text).toContain(`long = ${"y".repeat(50)}...`);
    system.destroy();
  });
});
