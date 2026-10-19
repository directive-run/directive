/**
 * Black-box conformance for derivation behaviour that mutation testing showed
 * was unpinned. Public API only: systems, `derive`, `subscribe`, `inspect`,
 * plugins and `meta`. Nothing here reaches an engine module directly, so any
 * engine that honours the contract passes.
 *
 * No timers: every wait is `system.settle()`.
 */

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// biome-ignore lint/suspicious/noExplicitAny: dynamic derivation access is untyped by design
type Any = any;

afterEach(() => {
  vi.restoreAllMocks();
});

function metaText(system: Any, id: string): string {
  return JSON.stringify(system.meta.derivation(id) ?? null);
}

/** Register `dyn` and a dynamic `consumer` that reads it (or -1 when absent). */
function withDyn(system: Any, body: (f: Any) => number = (f) => f.n * 10) {
  system.derive.register("dyn", body);
  system.derive.register("consumer", (_f: Any, d: Any) => d.dyn ?? -1);
}

/** A module with one counter fact and `x = n * 2`. */
function counter(extraDerive: Record<string, Any> = {}) {
  return createModule("c", {
    schema: {
      facts: { n: t.number(), m: t.number() },
      derivations: { x: t.number() },
      requirements: { NOOP: {} },
    },
    init: (facts) => {
      facts.n = 1;
      facts.m = 0;
    },
    derive: {
      x: (facts: Any) => facts.n * 2,
      ...extraDerive,
    } as Any,
  });
}

// ---------------------------------------------------------------------------
// Object-form definitions
// ---------------------------------------------------------------------------

describe("derivations: object-form definitions", () => {
  it("freezes a predicate spec and a template spec at registration", () => {
    const predicate = { n: { $gte: 1 } };
    const template = { $template: "n=${n}" };
    const mod = createModule("spec", {
      schema: {
        facts: { n: t.number() },
        derivations: { big: t.boolean(), label: t.string() },
      },
      init: (facts) => {
        facts.n = 3;
      },
      derive: {
        big: { compute: predicate },
        label: { compute: template },
      } as Any,
    });
    const system = createSystem({ module: mod });
    system.start();

    expect(system.derive.big).toBe(true);
    expect(system.derive.label).toBe("n=3");
    expect(Object.isFrozen(predicate)).toBe(true);
    expect(Object.isFrozen(template)).toBe(true);
  });

  it("rejects a compute that is neither function, template nor predicate", () => {
    for (const bad of [5, null, true]) {
      expect(() => {
        const mod = createModule("bad", {
          schema: { facts: { n: t.number() }, derivations: { d: t.number() } },
          init: (facts) => {
            facts.n = 1;
          },
          derive: { d: { compute: bad } } as Any,
        });
        createSystem({ module: mod }).start();
      }).toThrow(/predicate must be a plain object or array/);
    }
  });

  it("registers object-form derivations at runtime with their meta", async () => {
    const system = createSystem({ module: counter() });
    system.start();
    await system.settle();
    (system.derive as Any).register("m1", {
      compute: (facts: Any) => facts.n + 100,
      meta: { label: "First" },
    });
    expect((system.derive as Any).m1).toBe(101);
    expect(metaText(system, "m1")).toContain("First");

    (system.derive as Any).register("tpl", {
      compute: { $template: "v${n}" },
    });
    expect((system.derive as Any).tpl).toBe("v1");
    (system.derive as Any).register("pred", { compute: { n: { $gte: 1 } } });
    expect((system.derive as Any).pred).toBe(true);
  });

  it("assign swaps the function and drops the old meta", async () => {
    const system = createSystem({ module: counter() });
    system.start();
    await system.settle();
    const d = system.derive as Any;
    d.register("m1", { compute: (f: Any) => f.n, meta: { label: "Old" } });
    expect(d.m1).toBe(1);

    // Plain function: new value, and the old meta must not linger.
    d.assign("m1", (f: Any) => f.n + 10);
    expect(d.m1).toBe(11);
    expect(metaText(system, "m1")).not.toContain("Old");
  });

  it("assign on a missing derivation throws", async () => {
    const system = createSystem({ module: counter() });
    system.start();
    await system.settle();
    expect(() => (system.derive as Any).assign("nope", () => 1)).toThrow(
      /does not exist/,
    );
    expect(() => (system.derive as Any).call("nope")).toThrow(/does not exist/);
  });
});

// ---------------------------------------------------------------------------
// Subscriptions and notification delivery
// ---------------------------------------------------------------------------

describe("derivations: subscriptions", () => {
  it("delivers to every subscriber, and unsubscribing one leaves the rest", () => {
    const system = createSystem({ module: counter() });
    system.start();
    expect(system.derive.x).toBe(2);

    const a = vi.fn();
    const b = vi.fn();
    const offA = system.subscribe(["x"], a);
    system.subscribe(["x"], b);

    system.facts.n = 2;
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    offA();
    expect(system.derive.x).toBe(4);
    system.facts.n = 3;
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("a throwing subscriber is reported and does not stop the others", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const system = createSystem({ module: counter() });
    system.start();
    expect(system.derive.x).toBe(2);

    const boom = new Error("boom");
    const after = vi.fn();
    system.subscribe(["x"], () => {
      throw boom;
    });
    system.subscribe(["x"], after);

    expect(() => {
      system.facts.n = 2;
    }).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledWith(
      "[Directive] Derivation subscriber error:",
      { derivation: "x", error: boom },
    );
  });

  it("a subscriber that keeps re-invalidating trips the loop guard", async () => {
    const system = createSystem({ module: counter() });
    system.start();
    await system.settle();
    const d = system.derive as Any;
    d.register("y", (f: Any) => f.n + f.m);

    let looping = true;
    let xCalls = 0;
    system.subscribe(["x"], () => {
      xCalls++;
      if (looping) {
        // Replacing a definition queues its announcement again.
        d.assign("x", (f: Any) => f.n * 2);
        d.assign("y", (f: Any) => f.n + f.m);
      }
    });
    system.subscribe(["y"] as Any, () => {});

    expect(() => d.assign("x", (f: Any) => f.n * 2)).toThrow(/loop/i);
    // Bounded: it ran, and it did not run away.
    expect(xCalls).toBeGreaterThan(1);
    expect(xCalls).toBeLessThanOrEqual(1000);

    // The abandoned queue is dropped, not carried into the next flush.
    const after = xCalls;
    looping = false;
    d.assign("y", (f: Any) => f.n + f.m);
    expect(xCalls).toBe(after);
  });
});

// ---------------------------------------------------------------------------
// Replacing and removing definitions
// ---------------------------------------------------------------------------

describe("derivations: assign", () => {
  it("assigning over a derivation nobody has read yet just works", async () => {
    const system = createSystem({ module: counter() });
    system.start();
    await system.settle();
    (system.derive as Any).assign("x", (f: Any) => f.n + 1000);
    expect(system.derive.x).toBe(1001);
  });

  it("notifies subscribers and recomputes dependents", async () => {
    const system = createSystem({ module: counter() });
    system.start();
    await system.settle();
    const d = system.derive as Any;
    withDyn(system);
    expect(d.consumer).toBe(10);

    const onDyn = vi.fn();
    const onConsumer = vi.fn();
    system.subscribe(["dyn"] as Any, onDyn);
    system.subscribe(["consumer"] as Any, onConsumer);

    d.assign("dyn", (f: Any) => f.n * 1000);
    expect(onDyn).toHaveBeenCalledTimes(1);
    expect(onConsumer).toHaveBeenCalledTimes(1);
    expect(d.consumer).toBe(1000);
  });

  it("announces the invalidation once per valid-to-stale edge", async () => {
    const seen: string[] = [];
    const system = createSystem({
      module: counter(),
      plugins: [
        {
          name: "spy",
          onDerivationInvalidate: (id: string) => {
            seen.push(id);
          },
        },
      ],
    });
    system.start();
    await system.settle();
    expect(system.derive.x).toBe(2);
    const d = system.derive as Any;

    d.assign("x", (f: Any) => f.n * 3);
    expect(seen).toEqual(["x"]);
    // Still stale: assigning again is not a new edge.
    d.assign("x", (f: Any) => f.n * 4);
    expect(seen).toEqual(["x"]);
    expect(system.derive.x).toBe(4);
    d.assign("x", (f: Any) => f.n * 5);
    expect(seen).toEqual(["x", "x"]);
  });

  it("wakes a constraint that gates on the replaced derivation", async () => {
    const fired = vi.fn();
    const mod = createModule("gate", {
      schema: {
        facts: { n: t.number() },
        derivations: { x: t.number() },
        requirements: { GO: {} },
      },
      init: (facts) => {
        facts.n = 1;
      },
      derive: { x: (facts) => facts.n },
      constraints: {
        big: {
          when: (_facts, derived) => derived.x > 100,
          require: { type: "GO" },
        },
      },
      resolvers: {
        go: {
          requirement: "GO",
          key: () => "go",
          resolve: async () => {
            fired();
          },
        },
      },
    });
    const system = createSystem({ module: mod });
    system.start();
    await system.settle();
    expect(fired).not.toHaveBeenCalled();

    (system.derive as Any).assign("x", () => 500);
    await system.settle();
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it("leaves notification batching intact afterwards", () => {
    const mod = createModule("pair", {
      schema: {
        facts: { a: t.number(), b: t.number() },
        derivations: { sum: t.number() },
      },
      init: (facts) => {
        facts.a = 0;
        facts.b = 0;
      },
      derive: { sum: (facts) => facts.a + facts.b },
    });
    const system = createSystem({ module: mod });
    system.start();
    (system.derive as Any).assign("sum", (f: Any) => f.a + f.b);
    expect(system.derive.sum).toBe(0);

    const seen: string[] = [];
    system.subscribe(["sum"], () => {
      seen.push(`${system.facts.a}:${system.facts.b}`);
    });

    // A batch notifies once, after both writes.
    system.batch(() => {
      system.facts.a = 1;
      system.facts.b = 1;
    });
    expect(seen).toEqual(["1:1"]);

    // And a plain write still notifies at all.
    expect(system.derive.sum).toBe(2);
    system.facts.a = 5;
    expect(seen).toEqual(["1:1", "5:1"]);
  });
});

describe("derivations: unregister", () => {
  it("recomputes and notifies dependents, and forgets the removed one", async () => {
    const system = createSystem({ module: counter() });
    system.start();
    await system.settle();
    const d = system.derive as Any;
    withDyn(system);
    expect(d.consumer).toBe(10);

    const onConsumer = vi.fn();
    system.subscribe(["consumer"] as Any, onConsumer);

    d.unregister("dyn");
    expect(onConsumer).toHaveBeenCalledTimes(1);
    expect(d.consumer).toBe(-1);
    expect(d.isDynamic("dyn")).toBe(false);

    // Registering the same name again is clean.
    d.register("dyn", (f: Any) => f.n * 7);
    expect(d.dyn).toBe(7);
    system.facts.n = 2;
    expect(d.dyn).toBe(14);
  });

  it("leaves no phantom dependent behind for a watcher to be told about", async () => {
    const mod = createModule("ghost", {
      schema: {
        facts: { n: t.number() },
        derivations: { x: t.number() },
        requirements: { NOOP: {} },
      },
      init: (facts) => {
        facts.n = 1;
      },
      derive: { x: (facts) => facts.n },
      constraints: {
        watch: {
          when: (_facts, derived) => derived.x > 1e9,
          require: { type: "NOOP" },
        },
      },
      resolvers: { noop: { requirement: "NOOP", resolve: async () => {} } },
    });
    const system = createSystem({ module: mod });
    system.start();
    await system.settle();
    const d = system.derive as Any;
    d.register("g", (f: Any) => f.n + 1);
    expect(d.g).toBe(2);
    d.unregister("g");

    system.facts.n = 2;
    // Exactly the one real dependent is pending, not it plus a dead name.
    expect(system.inspect().pendingInvalidations).toBeLessThanOrEqual(1);
    await system.settle();
    expect(system.inspect().pendingInvalidations).toBe(0);
  });

  it("answers membership checks fresh after a definition goes away", async () => {
    const system = createSystem({
      module: counter(),
    });
    system.start();
    await system.settle();
    const d = system.derive as Any;
    d.register("dyn", () => 1);
    d.register("hasDyn", (_f: Any, dd: Any) => "dyn" in dd);
    expect(d.hasDyn).toBe(true);
    d.unregister("dyn");
    expect(d.hasDyn).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The `derived` composition object
// ---------------------------------------------------------------------------

describe("derivations: the derived parameter behaves like a read-only record", () => {
  it("answers membership, descriptors and mutation attempts", () => {
    const mod = createModule("proxy", {
      schema: {
        facts: { n: t.number() },
        derivations: {
          a: t.number(),
          probe: t.object<Record<string, unknown>>(),
        },
      },
      init: (facts) => {
        facts.n = 4;
      },
      derive: {
        a: (facts) => facts.n + 1,
        probe: (_facts, derived) => {
          const dd = derived as Record<string | symbol, unknown>;
          const out: Record<string, unknown> = {};
          out.hasA = "a" in dd;
          out.hasMissing = "zzz" in dd;
          out.hasCtor = "constructor" in dd;
          out.hasProto = "__proto__" in dd;
          out.hasPrototype = "prototype" in dd;
          out.hasSymbol = Symbol.iterator in dd;
          out.getCtor = dd.constructor;
          out.getProto = dd.__proto__;
          out.getSymbol = dd[Symbol.iterator];
          out.getMissing = dd.zzz;
          out.keys = Object.keys(dd);
          out.descMissing = Object.getOwnPropertyDescriptor(dd, "zzz");
          out.descCtor = Object.getOwnPropertyDescriptor(dd, "constructor");
          out.descProto = Object.getOwnPropertyDescriptor(dd, "__proto__");
          out.descSymbol = Object.getOwnPropertyDescriptor(dd, Symbol.iterator);
          const desc = Object.getOwnPropertyDescriptor(dd, "a");
          out.descA = desc && {
            enumerable: desc.enumerable,
            configurable: desc.configurable,
            value: (desc.get as () => unknown)(),
          };
          const attempt = (fn: () => void) => {
            try {
              fn();

              return "ok";
            } catch (e) {
              return e instanceof TypeError ? "TypeError" : "other";
            }
          };
          out.set = attempt(() => {
            dd.a = 1;
          });
          out.del = attempt(() => {
            // biome-ignore lint/performance/noDelete: the delete trap is the subject
            delete dd.a;
          });

          return out;
        },
      },
    });
    const system = createSystem({ module: mod });
    system.start();
    const probe = system.derive.probe as Record<string, unknown>;

    expect(probe).toEqual({
      hasA: true,
      hasMissing: false,
      hasCtor: false,
      hasProto: false,
      hasPrototype: false,
      hasSymbol: false,
      getCtor: undefined,
      getProto: undefined,
      getSymbol: undefined,
      getMissing: undefined,
      keys: ["a", "probe"],
      descMissing: undefined,
      descCtor: undefined,
      descProto: undefined,
      descSymbol: undefined,
      descA: { enumerable: true, configurable: true, value: 5 },
      set: "TypeError",
      del: "TypeError",
    });
  });
});

// ---------------------------------------------------------------------------
// Which derivations count as watched from outside
// ---------------------------------------------------------------------------

describe("derivations: only outside readers make a derivation watched", () => {
  function watchedModule(
    when: (facts: Any, derived: Any) => boolean,
    extra: Record<string, Any> = {},
  ) {
    return createModule("w", {
      schema: {
        facts: { n: t.number() },
        derivations: { a: t.number(), b: t.number(), c: t.number() },
        requirements: { NOOP: {} },
      },
      init: (facts) => {
        facts.n = 1;
      },
      derive: {
        a: (facts: Any) => facts.n,
        b: (_f: Any, d: Any) => d.a + 1,
        c: (_f: Any, d: Any) => d.b + 1,
        ...extra,
      } as Any,
      constraints: {
        watch: { when: when as Any, require: { type: "NOOP" } },
      },
      resolvers: { noop: { requirement: "NOOP", resolve: async () => {} } },
    });
  }

  it("a derivation read only by another derivation is not watched", async () => {
    const system = createSystem({
      module: watchedModule((_f, d) => d.c > 1e9),
    });
    system.start();
    await system.settle();
    // `c` is read by the constraint; `a` and `b` only by derivations.
    expect(system.inspect().observedDerivations).toBe(1);

    // A recompute pulled from outside must not widen the set, even before the
    // next reconcile trims it.
    system.facts.n = 5;
    void system.derive.c;
    expect(system.inspect().observedDerivations).toBe(1);
  });

  it("a derivation read through system.derive from a body is not watched", async () => {
    // biome-ignore lint/style/useConst: the body closes over it before it exists
    let sys: Any;
    const system = createSystem({
      module: watchedModule((_f, d) => d.c > 1e9, {
        c: () => sys.derive.b + 1,
      }),
    });
    sys = system;
    system.start();
    await system.settle();
    expect(system.inspect().observedDerivations).toBe(1);

    system.facts.n = 5;
    void system.derive.c;
    expect(system.inspect().observedDerivations).toBe(1);
  });

  it("a membership test from a constraint makes the name watched", async () => {
    const system = createSystem({
      module: watchedModule((_f, d) => "b" in d && false),
    });
    system.start();
    await system.settle();
    expect(system.inspect().observedDerivations).toBe(1);
  });

  it("a membership test inside a derivation does not", async () => {
    const system = createSystem({
      module: watchedModule((_f, d) => d.c > 1e9, {
        c: (f: Any, d: Any) => f.n + ("a" in d ? 1 : 0),
      }),
    });
    system.start();
    await system.settle();
    expect(system.inspect().observedDerivations).toBe(1);

    system.facts.n = 5;
    void system.derive.c;
    expect(system.inspect().observedDerivations).toBe(1);
  });

  it("nothing pending when nothing is watched; one thing when one is", async () => {
    const quiet = createSystem({ module: counter() });
    quiet.start();
    expect(quiet.derive.x).toBe(2);
    quiet.facts.n = 2;
    expect(quiet.inspect().pendingInvalidations).toBe(0);

    const watched = createSystem({
      module: watchedModule((_f, d) => d.a > 1e9),
    });
    watched.start();
    await watched.settle();
    watched.facts.n = 2;
    expect(watched.inspect().pendingInvalidations).toBe(1);
    await watched.settle();
    expect(watched.inspect().pendingInvalidations).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Waking watchers
// ---------------------------------------------------------------------------

describe("derivations: waking constraints that read derivations", () => {
  it("wakes only the watcher whose derivation moved", async () => {
    const evals = { p: 0, q: 0 };
    const mod = createModule("two", {
      schema: {
        facts: { p: t.number(), q: t.number() },
        derivations: { dp: t.number(), dq: t.number() },
        requirements: { NOOP: {} },
      },
      init: (facts) => {
        facts.p = 0;
        facts.q = 0;
      },
      derive: { dp: (f) => f.p, dq: (f) => f.q },
      constraints: {
        cp: {
          when: (_f, d) => {
            evals.p++;

            return d.dp > 1e9;
          },
          require: { type: "NOOP" },
        },
        cq: {
          when: (_f, d) => {
            evals.q++;

            return d.dq > 1e9;
          },
          require: { type: "NOOP" },
        },
      },
      resolvers: { noop: { requirement: "NOOP", resolve: async () => {} } },
    });
    const system = createSystem({ module: mod });
    system.start();
    await system.settle();
    const before = { ...evals };

    system.facts.p = 1;
    await system.settle();
    expect(evals.p).toBe(before.p + 1);
    expect(evals.q).toBe(before.q);
  });

  it("reaches every watcher downstream of one change, through a diamond", async () => {
    const evals = { z: 0, d4: 0 };
    const mod = createModule("diamond", {
      schema: {
        facts: { f: t.number() },
        derivations: {
          z: t.number(),
          d1: t.number(),
          d2: t.number(),
          d3: t.number(),
          d4: t.number(),
        },
        requirements: { NOOP: {} },
      },
      init: (facts) => {
        facts.f = 0;
      },
      derive: {
        d1: (f) => f.f,
        z: (_f, d) => d.d1 + 1,
        d2: (_f, d) => d.d1 + 2,
        d3: (_f, d) => d.d1 + 3,
        d4: (_f, d) => d.d2 + d.d3,
      },
      constraints: {
        cz: {
          when: (_f, d) => {
            evals.z++;

            return d.z > 1e9;
          },
          require: { type: "NOOP" },
        },
        cd: {
          when: (_f, d) => {
            evals.d4++;

            return d.d4 > 1e9;
          },
          require: { type: "NOOP" },
        },
      },
      resolvers: { noop: { requirement: "NOOP", resolve: async () => {} } },
    });
    const system = createSystem({ module: mod });
    system.start();
    await system.settle();
    const before = { ...evals };

    system.facts.f = 1;
    await system.settle();
    expect(evals.z).toBe(before.z + 1);
    expect(evals.d4).toBe(before.d4 + 1);
  });
});

// ---------------------------------------------------------------------------
// Repeated recomputation
// ---------------------------------------------------------------------------

describe("derivations: call() recomputes every time", () => {
  it("keeps returning fresh values after many consecutive calls", () => {
    let tick = 0;
    const mod = createModule("stable", {
      schema: { facts: { n: t.number() }, derivations: { v: t.number() } },
      init: (facts) => {
        facts.n = 10;
      },
      derive: { v: (facts) => facts.n + tick },
    });
    const system = createSystem({ module: mod });
    system.start();
    expect(system.derive.v).toBe(10);
    const d = system.derive as Any;

    for (let i = 1; i <= 8; i++) {
      tick = i;
      expect(d.call("v")).toBe(10 + i);
    }
    // And a real fact change still invalidates it afterwards.
    system.facts.n = 20;
    expect(system.derive.v).toBe(28);
  });
});

// ---------------------------------------------------------------------------
// Metadata lookups
// ---------------------------------------------------------------------------

describe("derivations: meta for unknown names", () => {
  it("a name that is not a derivation carries no tags and does not throw", () => {
    const system = createSystem({ module: counter() });
    system.start();
    expect(system.meta.carriesTag("derivation", "nope", "pii")).toBeFalsy();
    expect(system.meta.derivation("nope")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Removing definitions: housekeeping that callers can see
// ---------------------------------------------------------------------------

describe("derivations: unregister housekeeping", () => {
  it("removing a derivation nobody has read is clean", async () => {
    const system = createSystem({ module: counter() });
    system.start();
    await system.settle();
    const d = system.derive as Any;
    d.register("fresh", (f: Any) => f.n);
    expect(() => d.unregister("fresh")).not.toThrow();
    expect(d.isDynamic("fresh")).toBe(false);
  });

  it("keeps notification batching intact after removing a depended-on one", async () => {
    const system = createSystem({ module: counter() });
    system.start();
    await system.settle();
    const d = system.derive as Any;
    withDyn(system);
    expect(d.consumer).toBe(10);
    d.unregister("dyn");
    expect(d.consumer).toBe(-1);

    d.register("sum", (f: Any) => f.n + f.m);
    expect(d.sum).toBe(1);
    const seen: string[] = [];
    system.subscribe(["sum"] as Any, () => {
      seen.push(`${system.facts.n}:${system.facts.m}`);
    });
    system.batch(() => {
      system.facts.n = 7;
      system.facts.m = 7;
    });
    expect(seen).toEqual(["7:7"]);
    expect(d.sum).toBe(14);
    system.facts.n = 8;
    expect(seen).toEqual(["7:7", "8:7"]);
  });

  it("a removed derivation stops counting as watched at once", async () => {
    const mod = createModule("watchdyn", {
      schema: {
        facts: { n: t.number() },
        derivations: { x: t.number() },
        requirements: { NOOP: {} },
      },
      init: (facts) => {
        facts.n = 1;
      },
      derive: { x: (facts) => facts.n },
      constraints: {
        watch: {
          when: (_facts, derived) =>
            derived.x > 1e9 || ((derived as Any).dyn ?? 0) > 1e9,
          require: { type: "NOOP" },
        },
      },
      resolvers: { noop: { requirement: "NOOP", resolve: async () => {} } },
    });
    const system = createSystem({ module: mod });
    system.start();
    await system.settle();
    const d = system.derive as Any;
    d.register("dyn", (f: Any) => f.n);
    system.facts.n = 2; // constraint re-reads x and dyn
    await system.settle();
    const observedBefore = system.inspect().observedDerivations;

    system.facts.n = 3;
    const pendingBefore = system.inspect().pendingInvalidations;
    d.unregister("dyn");
    expect(system.inspect().observedDerivations).toBeLessThan(observedBefore);
    expect(system.inspect().pendingInvalidations).toBeLessThan(pendingBefore);
  });
});

describe("derivations: odd definitions", () => {
  it("an object-form entry with no compute is tolerated at registration", () => {
    const mod = createModule("odd", {
      schema: { facts: { n: t.number() }, derivations: { d: t.number() } },
      init: (facts) => {
        facts.n = 1;
      },
      derive: { d: { compute: undefined, meta: { label: "empty" } } } as Any,
    });
    expect(() => createSystem({ module: mod })).not.toThrow();
  });
});

describe("derivations: replacing a live name through registerModule", () => {
  function setup() {
    const system = createSystem({ module: counter() });
    system.start();
    return system;
  }
  const other = () =>
    createModule("other", {
      schema: { facts: { k: t.number() }, derivations: {} },
      init: (facts) => {
        facts.k = 0;
      },
      derive: { dep: (f: Any) => f.k + 100 } as Any,
    });

  it("the new definition wins, the old meta goes, and everyone is told", async () => {
    const system = setup();
    await system.settle();
    const d = system.derive as Any;
    d.register("dep", { compute: (f: Any) => f.n, meta: { label: "Old" } });
    d.register("consumer", (_f: Any, dd: Any) => dd.dep * 2);
    expect(d.consumer).toBe(2);
    expect(metaText(system, "dep")).toContain("Old");

    const onDep = vi.fn();
    const onConsumer = vi.fn();
    system.subscribe(["dep"] as Any, onDep);
    system.subscribe(["consumer"] as Any, onConsumer);

    system.registerModule(other() as Any);

    expect(onDep).toHaveBeenCalled();
    expect(onConsumer).toHaveBeenCalled();
    expect(d.dep).toBe(100);
    expect(d.consumer).toBe(200);
    expect(metaText(system, "dep")).not.toContain("Old");
  });

  it("the old dependencies stop mattering and the new ones take over", async () => {
    const system = setup();
    await system.settle();
    const d = system.derive as Any;
    d.register("dep", (f: Any) => f.n);
    d.register("consumer", (_f: Any, dd: Any) => dd.dep * 2);
    expect(d.consumer).toBe(2);
    system.registerModule(other() as Any);
    expect(d.consumer).toBe(200);

    const onDep = vi.fn();
    system.subscribe(["dep"] as Any, onDep);
    // The replaced body read n; the new one does not.
    system.facts.n = 50;
    expect(d.dep).toBe(100);
    expect(onDep).not.toHaveBeenCalled();

    (system.facts as Any).k = 7;
    expect(d.dep).toBe(107);
    expect(d.consumer).toBe(214);
    expect(onDep).toHaveBeenCalled();
  });
});

describe("derivations: a body whose reads change shape stays fresh", () => {
  it.each([1, 2, 3, 4, 5, 8])(
    "after %i runs on one branch, then a flip",
    async (runs) => {
      const system = createSystem({ module: counter() });
      system.start();
      await system.settle();
      const d = system.derive as Any;
      let useM = false;
      d.register("pick", (f: Any) => (useM ? f.m : f.n));

      for (let i = 0; i < runs; i++) {
        system.facts.n = 100 + i;
        expect(d.pick).toBe(100 + i);
      }

      useM = true;
      system.facts.n = 500;
      expect(d.pick).toBe(system.facts.m);

      // Now the newly read fact is the one that has to wake it.
      system.facts.m = 77;
      expect(d.pick).toBe(77);
      system.facts.m = 78;
      expect(d.pick).toBe(78);
    },
  );
});

describe("derivations: housekeeping on replace and remove", () => {
  it("a replacement without meta still drops the previous meta", async () => {
    const system = createSystem({ module: counter() });
    system.start();
    await system.settle();
    const d = system.derive as Any;
    d.register("dep", { compute: (f: Any) => f.n, meta: { label: "Old" } });
    expect(metaText(system, "dep")).toContain("Old");

    const other = createModule("other", {
      schema: { facts: { k: t.number() }, derivations: {} },
      init: (facts) => {
        facts.k = 0;
      },
      derive: { dep: { compute: (f: Any) => f.k + 100 } } as Any,
    });
    system.registerModule(other as Any);
    expect(d.dep).toBe(100);
    expect(metaText(system, "dep")).not.toContain("Old");
  });

  it("an unregistered name leaves no meta and no old subscriber behind", async () => {
    const system = createSystem({ module: counter() });
    system.start();
    await system.settle();
    const d = system.derive as Any;
    d.register("dyn", { compute: (f: Any) => f.n, meta: { label: "Gone" } });
    expect(d.dyn).toBe(1);
    const stale = vi.fn();
    system.subscribe(["dyn"] as Any, stale);

    d.unregister("dyn");
    expect(metaText(system, "dyn")).not.toContain("Gone");

    d.register("dyn", (f: Any) => f.n * 3);
    expect(d.dyn).toBe(3);
    system.facts.n = 4;
    expect(d.dyn).toBe(12);
    expect(stale).not.toHaveBeenCalled();
  });

  it("entries that are not definitions at all are tolerated at registration", () => {
    for (const odd of [null, 7, "text"]) {
      const mod = createModule("odd2", {
        schema: { facts: { n: t.number() }, derivations: { d: t.number() } },
        init: (facts) => {
          facts.n = 1;
        },
        derive: { d: odd } as Any,
      });
      expect(() => createSystem({ module: mod })).not.toThrow();
    }
  });
});
