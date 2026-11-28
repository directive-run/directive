/**
 * Own keys only: a key a definition map inherits is not a definition.
 *
 * 1.35 merges every module's definitions into maps made with
 * `Object.create(null)` (engine.ts:265–275) and walks them with
 * `Object.keys`, so neither an enumerable key another library left on
 * `Object.prototype` nor a built-in member's name (`toString`) is ever a
 * fact, derivation, constraint, resolver or effect. 2.0 reads the module's
 * own objects, which do have a prototype, so each walk and each lookup by
 * a caller's id has to ask for own keys.
 *
 * Every test that pollutes does so inside `polluted`, which removes the
 * key in `finally`; `afterEach` fails the run if one is left behind.
 */
import { afterEach, expect, it, vi } from "vitest";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

type Any = any;
const P = Object.prototype as Any;
const KEYS = ["__polluted__", "__evil__", "__foreign__"];
const tick = () => new Promise((r) => setTimeout(r, 15));

/** Runs `fn` with `Object.prototype[key] = value`, then removes the key. */
const polluted = async <T>(
  key: string,
  value: unknown,
  fn: () => T | Promise<T>,
): Promise<T> => {
  P[key] = value;
  try {
    return await fn();
  } finally {
    delete P[key];
  }
};
/** An object any definition map could mistake for one of its own. */
const evil = (hit: string[]) => ({
  requirement: "X",
  resolve: async () => {
    hit.push("resolver.resolve");
  },
  when: () => {
    hit.push("constraint.when");

    return true;
  },
  require: { type: "X" },
  run: () => {
    hit.push("effect.run");
  },
  compute: () => {
    hit.push("derivation.compute");

    return 1;
  },
  handler: () => {
    hit.push("event.handler");
  },
  meta: { tags: ["pii"], label: "evil" },
  _meta: { tags: ["pii"] },
});
const build = (extra: Any = {}, options: Any = {}) => {
  const system = createSystem({
    module: createModule("m", {
      schema: {
        facts: { n: t.number() },
        derivations: { double: t.number() },
        events: { inc: {} },
        requirements: { X: {} },
      },
      init: (f: Any) => {
        f.n = 1;
      },
      derive: { double: (f: Any) => f.n * 2 },
      events: {
        inc: (f: Any) => {
          f.n++;
        },
      },
      ...extra,
    } as never),
    ...options,
  } as never) as Any;
  system.start();

  return system;
};
const need = (n: number) => ({
  need: { when: (f: Any) => f.n === n, require: { type: "X" } },
});
const unmet = (system: Any) => system.inspect().unmet.length;

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
const warned = () => warn.mock.calls.map((call: Any[]) => String(call[0]));
afterEach(() => {
  warn?.mockRestore();
  error?.mockRestore();
  for (const key of KEYS) {
    expect(key in {}).toBe(false);
  }
});
const quiet = () => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
};

it("derive: an inherited function is not a derivation", async () => {
  quiet();
  let calls = 0;
  await polluted(
    "__polluted__",
    () => {
      calls++;

      return "from-prototype";
    },
    () => {
      const system = build();
      expect(() => system.read("__polluted__")).toThrow(
        "[Directive] Unknown derivation: __polluted__",
      );
      expect(system.derive.__polluted__).toBeUndefined();
      expect(Object.keys(system.derive)).toEqual(["double"]);
      expect(system.read("double")).toBe(2);
      system.destroy();
    },
  );
  expect(calls).toBe(0);
});

it("derive: an inherited value that is no function does not stop createSystem", async () => {
  quiet();
  await polluted("__evil__", evil([]), () => {
    const system = build();
    expect(Object.keys(system.derive)).toEqual(["double"]);
    system.destroy();
  });
});

it("resolvers: an inherited object shaped like a resolver handles nothing", async () => {
  quiet();
  const hit: string[] = [];
  const system = build({ resolvers: {}, constraints: need(5) });
  await polluted("__evil__", evil(hit), async () => {
    system.facts.n = 5;
    await tick();
    expect(hit).toEqual([]);
    expect(unmet(system)).toBe(1);
    expect(system.inspect().inflight).toEqual([]);
  });
  system.destroy();
});

it("constraints: an inherited object shaped like a constraint is never asked", async () => {
  quiet();
  const hit: string[] = [];
  await polluted("__evil__", evil(hit), async () => {
    const system = build({ resolvers: {}, constraints: need(2) });
    await tick();
    system.events.inc();
    await tick();
    expect(hit).toEqual([]);
    expect(unmet(system)).toBe(1);
    expect(system.inspect().constraints.map((c: Any) => c.id)).toEqual([
      "need",
    ]);
    // A second start marks every constraint to be asked again (markAllDirty).
    system.stop();
    system.start();
    system.events.inc();
    await tick();
    system.events.inc();
    await tick();
    expect(hit).toEqual([]);
    system.destroy();
  });
});

it("constraints: disable, enable and `after` know only their own ids", async () => {
  quiet();
  const hit: string[] = [];
  await polluted("__evil__", evil(hit), async () => {
    const system = build({
      resolvers: {},
      constraints: {
        need: {
          after: ["toString", "__evil__"],
          when: (f: Any) => f.n === 1,
          require: { type: "X" },
        },
      },
    });
    await tick();
    expect(unmet(system)).toBe(1);
    for (const id of ["toString", "__evil__"]) {
      expect(
        warned().some((text: string) =>
          text.includes(`references unknown constraint "${id}"`),
        ),
      ).toBe(true);
      system.constraints.disable(id);
      expect(system.constraints.isDisabled(id)).toBe(false);
      system.constraints.enable(id);
      expect(warned()).toContain(
        `[Directive] constraints.disable("${id}") — no such constraint`,
      );
      expect(warned()).toContain(
        `[Directive] constraints.enable("${id}") — no such constraint`,
      );
    }
    await tick();
    expect(hit).toEqual([]);
    system.destroy();
  });
});

it("meta: an inherited key is no row and answers no lookup", async () => {
  quiet();
  await polluted("__evil__", evil([]), () => {
    const system = build({ resolvers: {}, constraints: need(9), effects: {} });
    expect(system.meta.byTag("pii")).toEqual([]);
    for (const kind of [
      "fact",
      "event",
      "constraint",
      "resolver",
      "effect",
      "derivation",
    ]) {
      expect(system.meta[kind]("__evil__")).toBeUndefined();
    }
    system.destroy();
  });
});

it("namespaced modules: two modules do not collide on an inherited key", async () => {
  quiet();
  const hit: string[] = [];
  await polluted("__evil__", evil(hit), async () => {
    const a = createModule("a", {
      schema: {
        facts: { n: t.number() },
        derivations: { d: t.number() },
        requirements: { X: {} },
      },
      init: (f: Any) => {
        f.n = 1;
      },
      derive: { d: (f: Any) => f.n + 1 },
      constraints: need(1),
    } as never);
    const b = createModule("b", {
      schema: { facts: { z: t.number() } },
      init: (f: Any) => {
        f.z = 2;
      },
    } as never);
    const system = createSystem({ modules: { a, b } } as never) as Any;
    system.start();
    await tick();
    expect([system.facts.a.n, system.facts.b.z, system.derive.a.d]).toEqual([
      1, 2, 2,
    ]);
    expect(unmet(system)).toBe(1);
    system.registerModule(
      "c",
      createModule("c", {
        schema: { facts: { q: t.number() } },
        init: (f: Any) => {
          f.q = 3;
        },
      } as never),
    );
    expect(system.facts.c.q).toBe(3);
    expect(hit).toEqual([]);
    expect(JSON.stringify(system.inspect())).not.toContain("__evil__");
    system.destroy();
  });
});

it("registerModule: an inherited key is not a schema collision", async () => {
  quiet();
  const system = build();
  await polluted("__evil__", evil([]), () => {
    system.registerModule(
      createModule("m2", {
        schema: {
          facts: { z: t.number() },
          derivations: { twice: t.number() },
        },
        init: (f: Any) => {
          f.z = 1;
        },
        derive: { twice: (f: Any) => f.z * 2 },
      } as never),
    );
    expect(system.facts.z).toBe(1);
    expect(system.read("twice")).toBe(2);
    // Development: no inherited key is "both a fact and a derivation".
    expect(
      warned().filter((text: string) => text.includes("exists as both")),
    ).toEqual([]);
  });
  system.destroy();
});

it("the definition members: an inherited key adds no member to the system", async () => {
  quiet();
  const plain = build();
  const members = Reflect.ownKeys(plain).map(String).sort();
  plain.destroy();
  for (const value of [() => "from-prototype", "constraints", "derive"]) {
    await polluted("__polluted__", value, () => {
      const system = build();
      expect(Reflect.ownKeys(system).map(String).sort()).toEqual(members);
      expect(Object.keys(system.derive)).toEqual(["double"]);
      expect(system.constraints.isDynamic("need")).toBe(false);
      system.destroy();
    });
  }
});

it("dynamic call: an inherited name does not exist", async () => {
  quiet();
  const hit: string[] = [];
  await polluted("__evil__", evil(hit), async () => {
    const system = build({ resolvers: {}, constraints: {}, effects: {} });
    for (const id of ["toString", "hasOwnProperty", "valueOf", "__evil__"]) {
      for (const [member, type] of [
        ["constraints", "constraint"],
        ["resolvers", "resolver"],
        ["effects", "effect"],
      ]) {
        await expect(system[member!].call(id)).rejects.toThrow(
          `[Directive] Cannot call ${type} "${id}" — it does not exist.`,
        );
        expect(system[member!].isDynamic(id)).toBe(false);
        expect(() => system[member!].unregister(id)).not.toThrow();
      }
      expect(() => system.derive.call(id)).toThrow(
        `[Directive] Cannot call derivation "${id}" — it does not exist.`,
      );
    }
    expect(hit).toEqual([]);
    system.destroy();
  });
});

it("dynamic register and assign: an inherited name is free to register, and nothing to assign", async () => {
  quiet();
  await polluted("__evil__", evil([]), () => {
    const system = build({ resolvers: {}, constraints: {}, effects: {} });
    for (const id of ["toString", "__evil__"]) {
      const constraint = { when: () => false, require: { type: "X" } };
      expect(() => system.constraints.assign(id, constraint)).toThrow(
        `[Directive] Constraint "${id}" does not exist. Use register() to create it.`,
      );
      system.constraints.register(id, constraint);
      expect(system.constraints.isDynamic(id)).toBe(true);
      expect(() => system.effects.assign(id, { run: () => {} })).toThrow(
        `[Directive] Effect "${id}" does not exist. Use register() to create it.`,
      );
      system.effects.register(id, { run: () => {} });
      expect(system.effects.isDynamic(id)).toBe(true);
      expect(() => system.derive.assign(id, () => 1)).toThrow(
        `[Directive] Derivation "${id}" does not exist. Use register() to create it.`,
      );
      system.derive.register(id, () => 7);
      expect(system.read(id)).toBe(7);
      system.resolvers.register(id, {
        requirement: "Q",
        resolve: async () => {},
      });
      expect(system.resolvers.isDynamic(id)).toBe(true);
      system.constraints.unregister(id);
      expect(system.constraints.isDynamic(id)).toBe(false);
    }
    system.destroy();
  });
});

it("subscribe and watch: an inherited name is an unknown key", async () => {
  quiet();
  const system = build();
  system.subscribe(["toString"], () => {})();
  expect(warned()).toContain('[Directive] subscribe: unknown key "toString"');
  system.watch("hasOwnProperty", () => {})();
  expect(warned()).toContain('[Directive] watch: unknown key "hasOwnProperty"');
  system.destroy();
});

it("trace: an entry's freeze does not reach a value on the prototype", async () => {
  quiet();
  const foreign = { inner: { x: 1 } };
  await polluted("__foreign__", foreign, async () => {
    const system = build({}, { trace: true });
    system.events.inc();
    await tick();
    expect(system.trace.length).toBeGreaterThan(0);
    expect(Object.isFrozen(foreign)).toBe(false);
    expect(Object.isFrozen(foreign.inner)).toBe(false);
    system.destroy();
  });
});
