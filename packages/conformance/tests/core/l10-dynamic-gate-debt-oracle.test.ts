// Ported from packages/core/src/core/__tests__/l10-dynamic-gate-debt-oracle.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Black-box pins for the gate=L10 mutation debt in 1.35's engine.ts: the
// cross-module collision check createSystem runs, registerModule's and
// unregisterModule's refusals and bookkeeping (history filters, module and
// source meta, requirement keys), meta.subscribe's notifications, what
// destroy() forgets, inspect() and explain() over runtime definitions, and
// evict()'s deadline. Each pins what 1.35 does today. Public API only.

beforeEach(() => {
  // Refusals, orphan requirements and failing resolvers log; only the
  // subscriber-error log and the fact/derivation warning are under test.
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

/**
 * A module with the given parts. Every module but a registered extra also
 * gets one numeric fact `n` (0 at start); an extra leaves it out, so its
 * schema cannot collide with the system's.
 */
function mod(
  id: string,
  parts: Record<string, unknown> = {},
  withN = !/^(extra|f|g|h)/.test(id),
) {
  const {
    facts = {},
    derivations = {},
    events = {},
    requirements = {},
  } = (parts.schema ?? {}) as Record<string, Record<string, unknown>>;

  return createModule(id, {
    ...parts,
    schema: {
      facts: { ...(withN ? { n: t.number() } : {}), ...facts },
      derivations,
      events,
      requirements,
    },
    init: (f: any) => {
      if (withN) f.n = 0;
      (parts.init as ((f: any) => void) | undefined)?.(f);
    },
  } as never);
}

async function single(parts: Record<string, unknown> = {}, options = {}) {
  const system = createSystem({ module: mod("m", parts), ...options } as never);
  system.start();
  await system.settle();

  return system as any;
}

// ---------------------------------------------------------------------------
// createSystem: two modules whose namespaced keys meet
// ---------------------------------------------------------------------------

describe("createSystem refuses two modules whose namespaced keys collide (L10 gate debt)", () => {
  // Neither "a" nor "a:" contains the separator, and neither do ":x" and
  // "x", yet "a" + "::" + ":x" and "a:" + "::" + "x" are both "a:::x".
  it("for a fact", () => {
    const a = mod("a", { schema: { facts: { ":x": t.number() } } });
    const b = mod("b", { schema: { facts: { x: t.number() } } });

    expect(() => createSystem({ modules: { a, "a:": b } })).toThrow(
      'Schema collision: Fact "a:::x" is defined in both module "a" and "a:"',
    );
  });

  const sections: Array<[string, (key: string) => Record<string, unknown>]> = [
    [
      "derivation",
      (key) => ({
        schema: { derivations: { [key]: t.number() } },
        derive: { [key]: () => 1 },
      }),
    ],
    ["effect", (key) => ({ effects: { [key]: { run: () => {} } } })],
    [
      "constraint",
      (key) => ({
        schema: { requirements: { NEVER: {} } },
        constraints: {
          [key]: { when: () => false, require: { type: "NEVER" } },
        },
      }),
    ],
    [
      "resolver",
      (key) => ({
        schema: { requirements: { NEVER: {} } },
        resolvers: { [key]: { requirement: "NEVER", resolve: async () => {} } },
      }),
    ],
    [
      "event",
      (key) => ({
        schema: { events: { [key]: {} } },
        events: { [key]: () => {} },
      }),
    ],
  ];

  for (const [section, parts] of sections) {
    it(`for a ${section}`, () => {
      const a = mod("a", parts(":x"));
      const b = mod("b", parts("x"));

      expect(() => createSystem({ modules: { a, "a:": b } })).toThrow(
        `Definition collision: ${section} "a:::x" is defined in both module "a" and "a:"`,
      );
    });
  }
});

describe("createSystem refuses two modules whose namespaced source keys collide (L10 gate debt)", () => {
  it("for a source", () => {
    const a = mod("a", { sources: { ":x": { attach: () => () => {} } } });
    const b = mod("b", { sources: { x: { attach: () => () => {} } } });

    expect(() => createSystem({ modules: { a, "a:": b } })).toThrow(
      'Definition collision: source "a:::x" is defined in both module "a" and "a:"',
    );
  });
});

// ---------------------------------------------------------------------------
// registerModule and unregisterModule on a single-module system
// ---------------------------------------------------------------------------

describe("registerModule's refusals (L10 gate debt)", () => {
  it("refuses during reconciliation, from an effect", async () => {
    const seen: string[] = [];
    const holder: { system?: any } = {};
    const system = await single({
      effects: {
        reg: {
          deps: ["n"],
          run: (f: any) => {
            if (f.n !== 1) return;
            try {
              holder.system.registerModule(
                mod("extra", { schema: { facts: { e: t.number() } } }),
              );
              seen.push("registered");
            } catch (error) {
              seen.push(String(error.message));
            }
          },
        },
      },
    });
    holder.system = system;
    system.facts.n = 1;
    await system.settle();

    expect(seen).toEqual([
      '[Directive] Cannot register module "extra" during reconciliation. Wait for the current reconciliation cycle to complete.',
    ]);
  });

  it("refuses on a destroyed system", async () => {
    const system = await single();
    system.destroy();

    expect(() => system.registerModule(mod("extra"))).toThrow(
      '[Directive] Cannot register module "extra" on a destroyed system.',
    );
  });

  it("refuses a blocked key and a $ schema key", async () => {
    const system = await single();

    expect(() =>
      system.registerModule(
        mod("extra", {
          schema: { events: { constructor: {} } },
          events: { constructor: () => {} },
        }),
      ),
    ).toThrow(
      '[Directive] Security: Module "extra" has dangerous key "constructor" in events.',
    );
    expect(() =>
      system.registerModule(
        mod("extra2", { schema: { facts: { $x: t.number() } } }),
      ),
    ).toThrow(
      '[Directive] Module "extra2" has schema key "$x" starting with "$". Keys starting with $ are reserved for internal accessors ($store, $snapshot).',
    );
  });

  it("warns when a registered derivation shares a fact's name", async () => {
    const system = await single();
    system.registerModule(
      mod("extra", {
        schema: { derivations: { n: t.number() } },
        derive: { n: () => 1 },
      }),
    );

    expect(console.warn).toHaveBeenCalledWith(
      '[Directive] "n" exists as both a fact and a derivation after registering module "extra".',
    );
  });
});

describe("unregisterModule's refusals and re-entry (L10 gate debt)", () => {
  it("names an id-less target <module> and rejects a name nothing registered", async () => {
    const system = await single();

    await expect(system.unregisterModule({})).rejects.toThrow(
      '[Directive] Cannot unregister module "<module>": no such module is registered.',
    );
    await expect(system.unregisterModule("nope")).rejects.toThrow(
      '[Directive] Cannot unregister module "nope": no such module is registered.',
    );
  });

  it("refuses during reconciliation, from an effect", async () => {
    const seen: Promise<void>[] = [];
    const holder: { system?: any } = {};
    const system = await single({
      effects: {
        unreg: {
          deps: ["n"],
          run: (f: any) => {
            if (f.n === 1) seen.push(holder.system.unregisterModule("extra"));
          },
        },
      },
    });
    holder.system = system;
    system.registerModule(
      mod("extra", { schema: { facts: { e: t.number() } } }),
    );
    system.facts.n = 1;
    await system.settle();

    expect(seen).toHaveLength(1);
    await expect(seen[0]).rejects.toThrow(
      '[Directive] Cannot unregister module "extra" during reconciliation. Wait for the current reconciliation cycle to complete.',
    );
  });

  it("runs the teardown once for two concurrent calls", async () => {
    const g = gate();
    const system = await single();
    const stops: string[] = [];
    system.registerModule(
      mod("extra", {
        schema: { requirements: { WORK: {} } },
        constraints: { c: { when: () => true, require: { type: "WORK" } } },
        resolvers: {
          r: {
            requirement: "WORK",
            resolve: async () => {
              await g.promise;
            },
          },
        },
        hooks: { onStop: () => stops.push("stop") },
      }),
    );
    await wait(10);
    const first = system.unregisterModule("extra");
    const second = system.unregisterModule("extra");
    g.open();
    await Promise.all([first, second]);

    expect(stops).toEqual(["stop"]);
  });
});

// ---------------------------------------------------------------------------
// registerModule's history filter
// ---------------------------------------------------------------------------

describe("registerModule merges history.snapshotEvents (L10 gate debt)", () => {
  /** Events e1 and e2 each add 1 to their own fact. */
  const evented = (id: string, names: string[], snapshotEvents?: string[]) =>
    mod(id, {
      schema: {
        facts: Object.fromEntries(names.map((e) => [`${e}c`, t.number()])),
        events: Object.fromEntries(names.map((e) => [e, {}])),
      },
      init: (f: any) => {
        for (const e of names) f[`${e}c`] = 0;
      },
      events: Object.fromEntries(
        names.map((e) => [
          e,
          (f: any) => {
            f[`${e}c`] += 1;
          },
        ]),
      ),
      ...(snapshotEvents ? { history: { snapshotEvents } } : {}),
    });

  async function snapshots(system: any, type: string) {
    const before = system.history.snapshots.length;
    system.dispatch({ type });
    await system.settle();

    return system.history.snapshots.length - before;
  }

  it("filters from the first module that names its events, keeps the earlier ones, and adds every event of a later unfiltered module", async () => {
    const system = createSystem({
      module: evented("m", ["e1"]),
      history: { maxSnapshots: 50 },
    } as never) as any;
    system.start();
    await system.settle();

    system.registerModule(evented("f", ["f1", "f2"], ["f1"]));
    system.registerModule(evented("g", ["g1", "g2"], ["g1"]));
    system.registerModule(evented("h", ["h1"]));

    const counts = {};
    for (const type of ["e1", "f1", "f2", "g1", "g2", "h1"]) {
      counts[type] = await snapshots(system, type);
    }

    expect(counts).toEqual({ e1: 1, f1: 1, f2: 0, g1: 1, g2: 0, h1: 1 });
  });
});

// ---------------------------------------------------------------------------
// Meta on registerModule
// ---------------------------------------------------------------------------

describe("registerModule records module and source meta (L10 gate debt)", () => {
  it("stores a module's meta frozen, and tells plugins a source's meta", async () => {
    const registered: unknown[] = [];
    const system = createSystem({
      modules: { base: mod("base") },
      plugins: [
        {
          name: "spy",
          onDefinitionRegister: (...args: unknown[]) => registered.push(args),
        },
      ],
    } as never) as any;
    system.start();
    await system.settle();

    system.registerModule(
      "extra",
      mod("extra", {
        meta: { label: "Extra" },
        sources: { s: { attach: () => () => {}, meta: { label: "S" } } },
      }),
    );

    expect(system.meta.module("extra")).toEqual({ label: "Extra" });
    expect(Object.isFrozen(system.meta.module("extra"))).toBe(true);
    expect(registered).toContainEqual([
      "source",
      "extra::s",
      { moduleId: "extra", meta: { label: "S" } },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Requirement keys
// ---------------------------------------------------------------------------

describe("unregisterModule drops a requirement key no surviving resolver owns (L10 gate debt)", () => {
  it("so a surviving constraint's requirement is keyed without it", async () => {
    const keyCalls: string[] = [];
    const one = createModule("one", {
      schema: { facts: {}, requirements: { SOLO: {} } },
      resolvers: {
        res: {
          requirement: "SOLO",
          key: () => {
            keyCalls.push("one");

            return "k-one";
          },
          resolve: async () => undefined,
        },
      },
    } as never);
    const two = createModule("two", {
      schema: { facts: { go: t.boolean() }, requirements: { SOLO: {} } },
      init: (f: any) => {
        f.go = false;
      },
      constraints: {
        c: { when: (f: any) => f.go, require: { type: "SOLO" } },
      },
    } as never);
    const system = createSystem({ modules: { one, two } } as never) as any;
    system.start();
    await system.unregisterModule("one");

    keyCalls.length = 0;
    system.facts.two.go = true;
    await system.settle();

    expect(keyCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// meta.subscribe
// ---------------------------------------------------------------------------

describe("meta.subscribe over runtime definitions (L10 gate debt)", () => {
  it("is told of a register, survives a listener that throws, and stops after unsubscribe", async () => {
    const system = await single();
    const calls: string[] = [];
    system.meta.subscribe(() => {
      calls.push("bad");
      throw new Error("listener");
    });
    const off = system.meta.subscribe(() => calls.push("good"));

    system.constraints.register("dyn", {
      when: () => false,
      require: { type: "NEVER" },
    });
    expect(calls).toEqual(["bad", "good"]);
    expect(console.error).toHaveBeenCalledWith(
      "[Directive] Metadata subscriber error:",
      { error: expect.objectContaining({ message: "listener" }) },
    );

    off();
    system.constraints.unregister("dyn");
    expect(calls).toEqual(["bad", "good", "bad"]);
  });

  for (const how of ["destroy", "destroyAsync"]) {
    it(`forgets its listeners on ${how}(), even for a module teardown that finishes later`, async () => {
      const g = gate();
      const extra = mod("extra", {
        schema: { requirements: { WORK: {} } },
        constraints: {
          c: { when: () => true, require: { type: "WORK" } },
        },
        resolvers: {
          r: {
            requirement: "WORK",
            resolve: async () => {
              await g.promise;
            },
          },
        },
      });
      const system = createSystem({
        modules: { base: mod("base") },
      } as never) as any;
      system.start();
      system.registerModule("extra", extra);
      await wait(10);

      let calls = 0;
      system.meta.subscribe(() => {
        calls += 1;
      });
      const unregistering = system.unregisterModule("extra").catch(() => {});
      const destroyed =
        how === "destroy" ? system.destroy() : system.destroyAsync();
      g.open();
      await Promise.allSettled([unregistering, destroyed]);
      await wait(10);

      expect(calls).toBe(0);
    });
  }
});

// ---------------------------------------------------------------------------
// destroy() forgets runtime definitions
// ---------------------------------------------------------------------------

describe("destroy() forgets runtime definitions (L10 gate debt)", () => {
  for (const how of ["destroy", "destroyAsync"]) {
    it(`listDynamic() is empty after ${how}()`, async () => {
      const system = await single();
      system.constraints.register("dyn", {
        when: () => false,
        require: { type: "NEVER" },
      });
      expect(system.constraints.listDynamic()).toEqual(["dyn"]);

      await system[how]();

      expect(system.constraints.listDynamic()).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// Runtime definitions in the engine's other paths
// ---------------------------------------------------------------------------

describe("runtime definitions (L10 gate debt)", () => {
  it("a runtime resolver that fails reaches no module hook and settles", async () => {
    const system = await single({ schema: { facts: { go: t.boolean() } } });
    system.resolvers.register("dyn", {
      requirement: "BOOM",
      retry: { attempts: 1 },
      resolve: async () => {
        throw new Error("boom");
      },
    });
    system.constraints.register("needs", {
      when: (f: any) => f.go === true,
      require: { type: "BOOM" },
    });
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    system.facts.go = true;
    await system.settle();
    await wait(20);
    process.off("unhandledRejection", onRejection);

    // It has no owner module, so there is no hook to look up.
    expect(rejections).toEqual([]);
  });

  it("inspect() lists a runtime constraint, and a fact a failed registerModule left with no schema type", async () => {
    const system = await single();
    system.constraints.register("dyn", {
      when: () => false,
      require: { type: "NEVER" },
    });
    // The schema-type freeze refuses a missing type, but only after the
    // schema was merged, so the key stays.
    expect(() =>
      system.registerModule(
        mod("extra", { schema: { facts: { z: undefined } } }),
      ),
    ).toThrow();
    const snapshot = system.inspect();

    expect(snapshot.facts).toContainEqual({ key: "z", meta: undefined });
    expect(snapshot.constraints.find((c) => c.id === "dyn")).toEqual({
      id: "dyn",
      active: false,
      disabled: false,
      priority: 0,
      hitCount: 0,
      lastActiveAt: null,
      meta: undefined,
    });
  });

  it("explain() says unknown for a requirement whose constraint was replaced", async () => {
    const g = gate();
    const system = await single({
      schema: { facts: { go: t.boolean() }, requirements: { WORK: {} } },
      constraints: {
        c: { when: (f: any) => f.go === true, require: { type: "WORK" } },
      },
      resolvers: {
        r: {
          requirement: "WORK",
          resolve: async () => {
            await g.promise;
          },
        },
      },
    });
    system.facts.go = true;
    await wait(10);
    system.constraints.assign("c", {
      when: () => true,
      require: { type: "WORK" },
    });
    const text = system.explain("WORK:{}");
    g.open();
    await system.settle();

    expect(text).toContain("├─ Constraint active: unknown");
  });
});

describe("an effect's deps across a fact that leaves (L10 gate debt)", () => {
  it("keeps a name that meant a fact when registered, after the fact leaves and a derivation of that name joins", async () => {
    const system = await single();
    system.registerModule(
      mod("extra", {
        schema: { facts: { e: t.number() } },
        init: (f: any) => {
          f.e = 0;
        },
      }),
    );
    let runs = 0;
    system.effects.register("watch", {
      deps: ["e"],
      run: () => {
        runs++;
      },
    });
    system.facts.n = 1;
    await system.settle();
    await system.unregisterModule("extra");
    system.registerModule(
      mod("extra2", {
        schema: { derivations: { e: t.number() } },
        derive: { e: (f: any) => f.n * 2 },
      }),
    );
    const before = runs;
    for (const n of [2, 3, 4]) {
      system.read("e");
      system.facts.n = n;
      await system.settle();
    }

    // `e` was settled as a fact when the effect was registered, so it is not
    // asked again: the effect never comes to watch the derivation.
    expect(runs - before).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// evict(deadline): evict is L5's
// ---------------------------------------------------------------------------

describe("evict(deadline) (L10 gate debt; evict is L5)", () => {
  const evicting = (onEvict: () => unknown) =>
    createSystem({
      module: mod("m", { sources: { s: { attach: () => () => {}, onEvict } } }),
    } as never) as any;

  it("waits for an eviction that finishes before the deadline", async () => {
    let done = false;
    const system = evicting(async () => {
      await wait(40);
      done = true;
    });
    system.start();
    await system.evict(Date.now() + 5000);

    expect(done).toBe(true);
  });

  it("returns at the deadline while the eviction is still running", async () => {
    const g = gate();
    const system = evicting(() => g.promise);
    system.start();
    const started = Date.now();
    const result = await Promise.race([
      system.evict(Date.now() + 30).then(() => "returned"),
      wait(2000).then(() => "hung"),
    ]);
    const took = Date.now() - started;
    g.open();

    expect(result).toBe("returned");
    expect(took).toBeGreaterThanOrEqual(20);
  });
});
