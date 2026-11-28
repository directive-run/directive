/**
 * Own keys only (dynamic definitions and registerModule): a key a definition map inherits is not a definition.
 *
 * 1.35 merges every module's definitions into maps made with
 * `Object.create(null)` and walks them with `Object.keys`, so neither an
 * enumerable key another library left on `Object.prototype` nor a built-in
 * member's name (`toString`) is ever a fact, derivation, constraint, resolver
 * or effect. Each test pollutes inside `polluted`, which removes the key in
 * `finally`; `afterEach` fails the file if one is left behind. Not pinned:
 * `'toString' in system.derive` (1.35 true, 2.0 false).
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

type Any = any;
const P = Object.prototype as Any;
const KEYS = ["__polluted__", "__evil__"];

/** Runs `fn` with `Object.prototype[key] = value`, then removes the key. */
async function polluted<T>(
  key: string,
  value: unknown,
  fn: () => T | Promise<T>,
): Promise<T> {
  P[key] = value;
  try {
    return await fn();
  } finally {
    delete P[key];
  }
}

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
});

function build(extra: Any = {}) {
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
  } as never) as Any;
  system.start();

  return system;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const warned = () =>
  vi.mocked(console.warn).mock.calls.map((call: Any[]) => String(call[0]));

afterEach(() => {
  vi.restoreAllMocks();
  // A test that leaves a key on Object.prototype poisons every later one.
  for (const key of KEYS) {
    const left = key in {};
    delete P[key];
    expect(left).toBe(false);
  }
});

const KINDS = [
  ["constraints", "constraint"],
  ["resolvers", "resolver"],
  ["effects", "effect"],
] as const;

it("call: a built-in member's name does not exist (no pollution)", async () => {
  const system = build({ resolvers: {}, constraints: {}, effects: {} });
  for (const id of ["toString", "hasOwnProperty", "valueOf"]) {
    for (const [member, type] of KINDS) {
      await expect(system[member].call(id)).rejects.toThrow(
        `[Directive] Cannot call ${type} "${id}" — it does not exist.`,
      );
      expect(system[member].isDynamic(id)).toBe(false);
      expect(() => system[member].unregister(id)).not.toThrow();
    }
    expect(() => system.derive.call(id)).toThrow(
      `[Directive] Cannot call derivation "${id}" — it does not exist.`,
    );
  }
  system.destroy();
});

it("call: an inherited name does not exist", async () => {
  const hit: string[] = [];
  await polluted("__evil__", evil(hit), async () => {
    const system = build({ resolvers: {}, constraints: {}, effects: {} });
    for (const id of ["toString", "__evil__"]) {
      for (const [member, type] of KINDS) {
        await expect(system[member].call(id)).rejects.toThrow(
          `[Directive] Cannot call ${type} "${id}" — it does not exist.`,
        );
        expect(system[member].isDynamic(id)).toBe(false);
        expect(() => system[member].unregister(id)).not.toThrow();
      }
      expect(() => system.derive.call(id)).toThrow(
        `[Directive] Cannot call derivation "${id}" — it does not exist.`,
      );
    }
    expect(hit).toEqual([]);
    system.destroy();
  });
});

it("register and assign: an inherited name is free to register, and nothing to assign", async () => {
  await polluted("__evil__", evil([]), () => {
    const system = build({ resolvers: {}, constraints: {}, effects: {} });
    const id = "__evil__";
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
    system.destroy();
  });
});

it("registerModule: an inherited key is not a schema collision", async () => {
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
    expect(
      warned().filter((text: string) => text.includes("exists as both")),
    ).toEqual([]);
  });
  system.destroy();
});
