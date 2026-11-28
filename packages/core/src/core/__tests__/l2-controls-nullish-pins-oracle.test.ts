/**
 * Two small L2 pins, both about what a module without definitions has.
 *
 * Controls: `system.constraints` always has `disable`, `enable` and
 * `isDisabled`, even with no constraint and no resolver; an unknown id is a
 * development warning and nothing else. Not pinned: the warning in
 * production (2.0 is silent there, 1.35 warns).
 *
 * Nullish: `effects: { x: undefined }` and `{ x: null }` make createSystem
 * throw a TypeError, as does a constraint. The class is asserted, not the
 * message. Resolver shapes are not pinned: 1.35 development throws at
 * createModule, 2.0 at createSystem.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

type Any = any;

afterEach(() => {
  vi.restoreAllMocks();
});

const bare = () =>
  createModule("a", {
    schema: { facts: { count: t.number() }, requirements: { R: {} } },
    init: (f: Any) => {
      f.count = 0;
    },
  } as Any);

describe.each(["flat", "namespaced"] as const)("controls, %s", (shape) => {
  const make = () =>
    shape === "flat"
      ? (createSystem({ module: bare() } as Any) as Any)
      : (createSystem({ modules: { a: bare() } } as Any) as Any);

  it.each([false, true])(
    "a module with no constraints and no resolvers has the three controls (started: %s)",
    (started) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const system = make();
      started && system.start();

      expect(typeof system.constraints.disable).toBe("function");
      expect(typeof system.constraints.enable).toBe("function");
      expect(typeof system.constraints.isDisabled).toBe("function");
      expect(system.constraints.disable("x")).toBeUndefined();
      expect(system.constraints.isDisabled("x")).toBe(false);
      expect(system.constraints.enable("x")).toBeUndefined();
      expect(warn.mock.calls.map((call) => call[0])).toEqual([
        '[Directive] constraints.disable("x") — no such constraint',
        '[Directive] constraints.enable("x") — no such constraint',
      ]);
      system.destroy();
    },
  );
});

describe.each([
  ["undefined", undefined],
  ["null", null],
] as const)("a %s definition", (_, missing) => {
  const system = (definitions: Any) => {
    const module = createModule("a", {
      schema: { facts: { count: t.number() }, requirements: { R: {} } },
      init: (f: Any) => {
        f.count = 0;
      },
      ...definitions,
    } as Any);

    return () => createSystem({ module } as Any);
  };

  it("as an effect: createSystem throws a TypeError", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(system({ effects: { x: missing } })).toThrow(TypeError);
    expect(system({ effects: { ok: { run: () => {} }, x: missing } })).toThrow(
      TypeError,
    );
  });

  it("as a constraint: createSystem throws a TypeError", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(system({ constraints: { x: missing } })).toThrow(TypeError);
  });
});

it("a module with whole effects and resolvers is built", () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});

  expect(() =>
    createSystem({
      module: createModule("a", {
        schema: { facts: { count: t.number() }, requirements: { R: {} } },
        init: (f: Any) => {
          f.count = 0;
        },
        effects: { ok: { run: () => {} } },
        resolvers: { r: { requirement: "R", resolve: async () => {} } },
      } as Any),
    } as Any),
  ).not.toThrow();
});
