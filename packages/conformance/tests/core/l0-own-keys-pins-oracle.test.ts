// Ported from packages/core/src/core/__tests__/l0-own-keys-pins-oracle.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
/**
 * Own keys only (derivations and createSystem): a key a definition map inherits is not a definition.
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

afterEach(() => {
  vi.restoreAllMocks();
  // A test that leaves a key on Object.prototype poisons every later one.
  for (const key of KEYS) {
    const left = key in {};
    delete P[key];
    expect(left).toBe(false);
  }
});

it("an inherited function is not a derivation", async () => {
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

it("an inherited object, resolver-shaped or not, does not stop createSystem", async () => {
  for (const value of [{ a: 1 }, evil([]), "text", 5, null]) {
    await polluted("__evil__", value, () => {
      const system = build();
      expect(Object.keys(system.derive)).toEqual(["double"]);
      expect(() => system.read("__evil__")).toThrow(
        "[Directive] Unknown derivation: __evil__",
      );
      expect(system.read("double")).toBe(2);
      system.destroy();
    });
  }
});

it("an inherited key adds no derivation to the module's own", async () => {
  const hit: string[] = [];
  await polluted("__evil__", evil(hit), () => {
    const system = build();
    expect(Object.keys(system.derive)).toEqual(["double"]);
    system.facts.n = 4;
    expect(system.read("double")).toBe(8);
    expect(hit).toEqual([]);
    system.destroy();
  });
});
