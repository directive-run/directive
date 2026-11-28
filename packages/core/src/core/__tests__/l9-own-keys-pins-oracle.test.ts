/**
 * Own keys only (meta): a key a definition map inherits is not a definition.
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
  meta: { tags: ["pii"], label: "evil" },
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

const need = (n: number) => ({
  need: { when: (f: Any) => f.n === n, require: { type: "X" } },
});

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

it("an inherited key is no meta row and answers no lookup", async () => {
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
