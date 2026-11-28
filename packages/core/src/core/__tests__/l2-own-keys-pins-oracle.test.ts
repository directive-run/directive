/**
 * Own keys only (constraints and resolvers): a key a definition map inherits is not a definition.
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
const tick = () => new Promise((r) => setTimeout(r, 15));

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

const need = (n: number) => ({
  need: { when: (f: Any) => f.n === n, require: { type: "X" } },
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const warned = () =>
  vi.mocked(console.warn).mock.calls.map((call: Any[]) => String(call[0]));
const unmet = (system: Any) => system.inspect().unmet.length;

afterEach(() => {
  vi.restoreAllMocks();
  // A test that leaves a key on Object.prototype poisons every later one.
  for (const key of KEYS) {
    const left = key in {};
    delete P[key];
    expect(left).toBe(false);
  }
});

it("an inherited object shaped like a resolver handles nothing", async () => {
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

it("an inherited object shaped like a constraint is never asked", async () => {
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
    // A second start asks every constraint again.
    system.stop();
    system.start();
    system.events.inc();
    await tick();
    expect(hit).toEqual([]);
    system.destroy();
  });
});

it("an inherited resolver-shaped object does not stop createSystem", async () => {
  const hit: string[] = [];
  await polluted("__evil__", evil(hit), async () => {
    const system = build({ resolvers: {}, constraints: need(1) });
    await tick();
    expect(hit).toEqual([]);
    expect(unmet(system)).toBe(1);
    system.destroy();
  });
});

it("disable, enable and isDisabled know only a constraint's own ids", async () => {
  const hit: string[] = [];
  await polluted("__evil__", evil(hit), async () => {
    const system = build({ resolvers: {}, constraints: need(1) });
    await tick();
    for (const id of ["toString", "__evil__"]) {
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
    expect(unmet(system)).toBe(1);
    expect(hit).toEqual([]);
    system.destroy();
  });
});
