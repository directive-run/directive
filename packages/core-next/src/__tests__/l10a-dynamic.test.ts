/**
 * L10a: dynamic definitions, per definition (the L10 RFC's D1 to D10, K1
 * to K6, I3, and rows (bl) and (bm)). Each test names the code it pins: it
 * fails when that code is removed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

type Any = any;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

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

describe("the registry (dynamic.ts)", () => {
  it("the registry is built at the first read of a member: until then each is a getter every system shares", () => {
    const one = started();
    const two = started();
    const getter = (system: Any, kind: string) =>
      Object.getOwnPropertyDescriptor(system[kind], "register")?.get;
    for (const kind of ["constraints", "resolvers", "effects"]) {
      expect(getter(one, kind)).toBeTypeOf("function");
      expect(getter(one, kind)).toBe(getter(two, kind));
    }
    expect(Object.keys(one.effects)).toEqual(
      expect.arrayContaining(["register", "listDynamic"]),
    );
    expect(one.effects.listDynamic()).toEqual([]);
    expect(one.effects.register).toBe(one.effects.register);
    expect(one.effects.register).not.toBe(two.effects.register);
    one.destroy();
    two.destroy();
  });

  it("D1: refuses a blocked id, a namespaced id, an empty id and a reserved derive name", () => {
    const system = started();
    expect(() => system.effects.register("__proto__", { run() {} })).toThrow(
      '[Directive] Security: Definition ID "__proto__" is a blocked property.',
    );
    expect(() => system.effects.register("a::b", { run() {} })).toThrow(
      'cannot contain "::"',
    );
    expect(() => system.effects.register("", { run() {} })).toThrow(
      "non-empty string",
    );
    expect(() => system.derive.register("call", () => 0)).toThrow(
      'Derivation ID "call" conflicts with a reserved derive method name.',
    );
    system.destroy();
  });

  it("D2: a duplicate register and a missing assign are refused with 1.35's texts", () => {
    const system = started();
    expect(() => system.derive.register("double", () => 0)).toThrow(
      '[Directive] Derivation "double" already exists. Use assign() to override.',
    );
    expect(() =>
      system.constraints.assign("ghost", { when: () => false }),
    ).toThrow(
      '[Directive] Constraint "ghost" does not exist. Use register() to create it.',
    );
    system.destroy();
  });

  it("D3: unregistering a static id warns and keeps it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = started();
    system.derive.unregister("double");
    expect(warn.mock.calls.flat().join(" ")).toContain(
      'Cannot unregister static derivation "double"',
    );
    expect(system.derive.double).toBe(2);
    system.destroy();
  });

  it("D4: every call throws on a destroyed system", () => {
    const system = started();
    system.destroy();
    expect(() => system.derive.register("x", () => 0)).toThrow(
      '[Directive] Cannot register derivation "x" on a destroyed system.',
    );
    expect(() => system.effects.call("x")).toThrow(
      '[Directive] Cannot call effect "x" on a destroyed system.',
    );
  });

  it("D5: a registration inside an effect is applied where the pass ends", async () => {
    let inside: boolean | undefined;
    const system = started({
      effects: {
        late: {
          deps: ["n"],
          run: (facts: Any) => {
            if (facts.n === 2) {
              system.constraints.register("c", { when: () => false });
              inside = system.constraints.isDynamic("c");
            }
          },
        },
      },
    });
    await tick();
    system.facts.n = 2;
    await tick();
    await tick();
    expect(inside).toBe(false);
    expect(system.constraints.isDynamic("c")).toBe(true);
    system.destroy();
  });

  it("D6: plugins and meta.subscribe hear register, assign, unregister and call", async () => {
    const seen: string[] = [];
    const plugin = {
      name: "rec",
      onDefinitionRegister: (type: string, id: string) =>
        seen.push(`r:${type}:${id}`),
      onDefinitionAssign: (type: string, id: string) =>
        seen.push(`a:${type}:${id}`),
      onDefinitionUnregister: (type: string, id: string) =>
        seen.push(`u:${type}:${id}`),
      onDefinitionCall: (type: string, id: string) =>
        seen.push(`c:${type}:${id}`),
    };
    const system = started({}, { plugins: [plugin] });
    let told = 0;
    system.meta.subscribe(() => told++);
    system.derive.register("z", () => 1);
    system.derive.assign("z", () => 2);
    system.derive.call("z");
    system.derive.unregister("z");
    expect(seen).toEqual([
      "r:derivation:z",
      "a:derivation:z",
      "c:derivation:z",
      "u:derivation:z",
    ]);
    expect(told).toBe(3);
    system.destroy();
  });

  it("D8 and D9: call answers now or says it does not exist; isDynamic only for register", async () => {
    const system = started();
    expect(system.derive.call("double")).toBe(2);
    expect(() => system.derive.call("nope")).toThrow(
      '[Directive] Cannot call derivation "nope" — it does not exist.',
    );
    await expect(system.effects.call("nope")).rejects.toThrow(
      '[Directive] Cannot call effect "nope" — it does not exist.',
    );
    system.derive.register("z", () => 1);
    expect(system.derive.isDynamic("z")).toBe(true);
    expect(system.derive.isDynamic("double")).toBe(false);
    expect(system.derive.listDynamic()).toEqual(["z"]);
    system.destroy();
  });

  it("(bl): assign with { compute, meta } keeps the derivation readable, with the new meta", () => {
    const system = started();
    system.derive.assign("double", {
      compute: (f: Any) => f.n * 3,
      meta: { label: "T" },
    });
    expect(system.derive.double).toBe(3);
    expect(system.meta.derivation("double")?.label).toBe("T");
    system.destroy();
  });

  it("a definition another system registers stays out of a system sharing the module", () => {
    const shared = mod();
    const a = createSystem({ module: shared } as never) as Any;
    const b = createSystem({ module: shared } as never) as Any;
    a.derive.register("z", () => 1);
    expect(a.derive.z).toBe(1);
    expect("z" in b.derive).toBe(false);
    expect(b.inspect().derivations.map((d: Any) => d.id)).toEqual(["double"]);
    a.destroy();
    b.destroy();
  });
});

describe("the derivation seam (core.ts)", () => {
  it("replace keeps dependants and subscribers told, remove wakes what read it", () => {
    const system = started();
    system.derive.register("plus", (_f: Any, d: Any) => (d.double ?? 0) + 1);
    expect(system.derive.plus).toBe(3);
    let told = 0;
    system.subscribe(["plus"], () => told++);
    system.derive.assign("double", (f: Any) => f.n * 10);
    expect(system.derive.plus).toBe(11);
    expect(told).toBeGreaterThan(0);
    system.derive.register("reader", (_f: Any, d: Any) => d.plus);
    expect(system.derive.reader).toBe(11);
    system.derive.unregister("plus");
    expect(system.derive.reader).toBeUndefined();
    expect("plus" in system.derive).toBe(false);
    system.destroy();
  });

  it("(bm): a derivation that asked about a name before it existed sees it arrive", () => {
    const system = started();
    system.derive.register("asks", (_f: Any, d: Any) =>
      "later" in d ? "yes" : "no",
    );
    system.derive.register("reads", (_f: Any, d: Any) => d.later ?? "none");
    expect(system.derive.asks).toBe("no");
    expect(system.derive.reads).toBe("none");
    system.derive.register("later", () => "here");
    expect(system.derive.asks).toBe("yes");
    expect(system.derive.reads).toBe("here");
    system.destroy();
  });

  it("(bm): a constraint gated on a later registration fires once it arrives", async () => {
    const system = started({
      constraints: {
        gate: {
          when: (_f: Any, d: Any) => "later" in d,
          require: { type: "WORK" },
        },
      },
      resolvers: {
        work: {
          requirement: "WORK",
          resolve: async (_r: Any, ctx: Any) => {
            ctx.facts.log = ["ran"];
          },
        },
      },
    });
    await system.settle();
    expect(system.facts.log).toEqual([]);
    system.derive.register("later", () => 1);
    await system.settle();
    expect(system.facts.log).toEqual(["ran"]);
    system.destroy();
  });
});

describe("the parts' hooks", () => {
  it("K3 and I3: a constraint registered, then unregistered while its requirement is current, leaves the trace whole", async () => {
    const system = started(
      {
        resolvers: {
          work: {
            requirement: "WORK",
            resolve: async (_r: Any, ctx: Any) => {
              await new Promise((resolve) => setTimeout(resolve, 5));
              ctx.facts.log = ["done"];
            },
          },
        },
      },
      { trace: true },
    );
    await system.settle();
    system.constraints.register("c", {
      when: (f: Any) => f.n > 0,
      require: { type: "WORK" },
    });
    await tick();
    expect(
      system.inspect().unmet.length + system.inspect().inflight.length,
    ).toBeGreaterThan(0);
    system.constraints.unregister("c");
    await system.settle();
    expect(system.constraints.isDynamic("c")).toBe(false);
    expect(system.inspect().constraints.map((c: Any) => c.id)).not.toContain(
      "c",
    );
    system.destroy();
  });

  it("the reconcile part is built at the first constraint of a system that had none", async () => {
    const system = started({
      resolvers: undefined,
    });
    system.resolvers.register("work", {
      requirement: "WORK",
      resolve: async (_r: Any, ctx: Any) => {
        ctx.facts.log = ["late"];
      },
    });
    system.constraints.register("c", {
      when: (f: Any) => f.n === 1,
      require: { type: "WORK" },
    });
    await system.settle();
    expect(system.facts.log).toEqual(["late"]);
    system.destroy();
  });

  it("K5: a batched resolver registered later batches, and unregistering cancels its queue", async () => {
    const calls: string[][] = [];
    const canceled: string[] = [];
    const system = started(
      {
        constraints: {
          c: {
            when: (f: Any) => f.n === 2,
            require: [{ type: "WORK", k: "a" }],
          },
        },
      },
      {
        plugins: [
          {
            name: "p",
            onResolverCancel: (_r: string, req: Any) => canceled.push(req.id),
          },
        ],
      },
    );
    system.resolvers.register("b", {
      requirement: "WORK",
      batch: { enabled: true, windowMs: 50 },
      resolveBatch: async (reqs: Any[]) => {
        calls.push(reqs.map((r) => r.k));
      },
    });
    system.facts.n = 2;
    await tick();
    system.resolvers.unregister("b");
    expect(canceled.length).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(calls).toEqual([]);
    system.destroy();
  });

  it("K6: an effect's declared name links to a derivation registered after it; assign cleans up first", async () => {
    const log: string[] = [];
    const system = started({
      effects: {
        watcher: { deps: ["later"], run: () => void log.push("run") },
      },
    });
    await system.settle();
    log.length = 0;
    system.derive.register("later", (f: Any) => f.n);
    expect(system.derive.later).toBe(1);
    system.facts.n = 5;
    await system.settle();
    expect(log).toContain("run");
    system.effects.register("e", { run: () => () => void log.push("cleanup") });
    await system.effects.call("e");
    system.effects.assign("e", { run: () => {} });
    expect(log).toContain("cleanup");
    system.destroy();
  });
});

describe("inspect (inspect.ts)", () => {
  it("resolverDefs lists a resolver registered at runtime, and drops it on unregister", () => {
    const system = started();
    expect(system.inspect().resolverDefs).toEqual([]);
    system.resolvers.register("work", { requirement: "WORK", resolve() {} });
    expect(system.inspect().resolverDefs).toEqual([
      { id: "work", requirement: "WORK", meta: undefined },
    ]);
    system.resolvers.unregister("work");
    expect(system.inspect().resolverDefs).toEqual([]);
    system.destroy();
  });

  it("pendingInvalidations counts the derivations a write reaches, and a removed one at once", async () => {
    const system = started({
      constraints: {
        watch: {
          when: (_f: Any, d: Any) => d.double > 1e9 || (d.dyn ?? 0) > 1e9,
          require: { type: "WORK" },
        },
      },
      resolvers: { work: { requirement: "WORK", resolve() {} } },
    });
    system.derive.register("dyn", (f: Any) => f.n);
    system.facts.n = 2;
    await system.settle();
    system.facts.n = 3;
    expect(system.inspect().pendingInvalidations).toBe(2);
    system.derive.unregister("dyn");
    expect(system.inspect().pendingInvalidations).toBe(1);
    await system.settle();
    expect(system.inspect().pendingInvalidations).toBe(0);
    system.destroy();
  });
});

describe("parity with 1.35's registry (constraints.ts, dynamic.ts, effects.ts)", () => {
  it("constraint assign starts its state again: hitCount 0, lastActiveAt null", async () => {
    const system = started({
      constraints: {
        c: { when: (f: Any) => f.n === 1, require: { type: "WORK" } },
      },
      resolvers: { work: { requirement: "WORK", resolve() {} } },
    });
    await system.settle();
    expect(system.inspect().constraints[0].hitCount).toBe(1);
    system.constraints.assign("c", {
      when: () => false,
      require: { type: "WORK" },
    });
    expect(system.inspect().constraints[0]).toMatchObject({
      hitCount: 0,
      lastActiveAt: null,
    });
    system.destroy();
  });

  it("D7: a derivation assign with nothing watched asks for no pass", async () => {
    let passes = 0;
    const system = started(
      {},
      { plugins: [{ name: "p", onReconcileStart: () => void passes++ }] },
    );
    await system.settle();
    passes = 0;
    system.derive.assign("double", (f: Any) => f.n * 4);
    await system.settle();
    expect(passes).toBe(0);
    expect(system.derive.double).toBe(4);
    system.destroy();
  });

  it("D8: calling a sync effect answers on the next tick, as 1.35's callOne", async () => {
    const system = started({ effects: { e: { run() {} } } });
    let done = false;
    system.effects.call("e").then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(true);
    system.destroy();
  });
});

describe("parity with 1.35, the second finisher (constraints.ts, core.ts, dynamic.ts)", () => {
  it("D8: calling a sync constraint answers on the next tick, as 1.35's callOne", async () => {
    const system = started({
      constraints: { c: { when: () => false, require: { type: "WORK" } } },
      resolvers: { work: { requirement: "WORK", resolve() {} } },
    });
    await system.settle();
    let done = false;
    system.constraints.call("c").then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(true);
    system.destroy();
  });

  it("D7: a derivation registered that nobody asked about starts no pass", async () => {
    let passes = 0;
    const system = started(
      {},
      { plugins: [{ name: "p", onReconcileStart: () => void passes++ }] },
    );
    await system.settle();
    passes = 0;
    system.derive.register("later", (f: Any) => f.n + 1);
    await system.settle();
    expect(passes).toBe(0);
    expect(system.derive.later).toBe(2);
    system.destroy();
  });

  it("a history trigger names facts only, never a membership key", async () => {
    const triggers: string[] = [];
    const system = started(
      {
        effects: {
          e: {
            run: (_f: Any, _p: Any, d: Any) => void ("later" in d),
          },
        },
      },
      {
        history: true,
        plugins: [
          {
            name: "p",
            onSnapshot: (s: Any) => void triggers.push(s.trigger),
          },
        ],
      },
    );
    await system.settle();
    system.derive.register("later", (f: Any) => f.n + 1);
    system.facts.n = 2;
    await system.settle();
    expect(triggers.at(-1)).toBe("facts-changed:n");
    system.destroy();
  });

  it("(w): an effect that tested a name before it existed re-runs at the next pass, which the registration does not start", async () => {
    const log: boolean[] = [];
    const system = started({
      effects: {
        e: { run: (_f: Any, _p: Any, d: Any) => void log.push("later" in d) },
      },
    });
    await system.settle();
    system.derive.register("later", (f: Any) => f.n + 1);
    await system.settle();
    expect(log).toEqual([false]);
    system.facts.log = ["x"];
    await system.settle();
    expect(log).toEqual([false, true]);
    system.destroy();
  });

  it("a constraint registered without `after` ranks with the first, as 1.35's stale order", async () => {
    const order: string[] = [];
    const when = (f: Any) => f.n > 5;
    const system = started(
      {
        constraints: {
          a: { when, require: { type: "WORK" } },
          b: { when, require: { type: "WORK" } },
        },
        resolvers: { work: { requirement: "WORK", resolve() {} } },
      },
      {
        plugins: [
          { name: "p", onConstraintEvaluate: (id: string) => order.push(id) },
        ],
      },
    );
    await system.settle();
    order.length = 0;
    // The pass it asks for has no changed key, so it evaluates every one
    // in order: priority, then 1.35's `topologicalIndex.get(id) ?? 0`.
    system.constraints.register("z", { when, require: { type: "WORK" } });
    await system.settle();
    expect(order).toEqual(["a", "z", "b"]);
    system.destroy();
  });
});
