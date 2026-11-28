// Ported from packages/core/src/core/__tests__/l2-controls-nullish-pins-oracle-production.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { afterEach, describe, expect, it, vi } from "vitest";

// Production build: the dev flag is the constant `false`.
vi.mock("#is-development", () => ({ default: false }));

const { createModule, createSystem, t } = await import("@directive-run/core");

// The production halves of l2-controls-nullish-pins-oracle and
// l1-unknown-event-pins-oracle: the controls are there and do nothing for an
// unknown id; an unknown event is a dispatcher that does nothing; an
// undefined or null effect, constraint or resolver is a TypeError at
// createSystem. No warning is pinned (2.0 is silent in production, 1.35 warns).

type Any = any;

afterEach(() => {
  vi.restoreAllMocks();
});

const definitions = (extra: Any = {}) =>
  createModule("a", {
    schema: {
      facts: { count: t.number() },
      events: { inc: {} },
      requirements: { R: {} },
    },
    init: (f: Any) => {
      f.count = 0;
    },
    events: {
      inc: (f: Any) => {
        f.count += 1;
      },
    },
    ...extra,
  } as Any);

it("a module with no constraints and no resolvers has the three controls", () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const system = createSystem({ module: definitions() } as Any) as Any;
  system.start();

  expect(system.constraints.disable("x")).toBeUndefined();
  expect(system.constraints.isDisabled("x")).toBe(false);
  expect(system.constraints.enable("x")).toBeUndefined();
  system.destroy();
});

it("an unknown event name is a dispatcher that does nothing", () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const system = createSystem({ module: definitions() } as Any) as Any;
  system.start();

  expect(typeof system.events.nope).toBe("function");
  expect(system.events.nope({ x: 1 })).toBeUndefined();
  expect("nope" in system.events).toBe(false);
  expect(Object.keys(system.events)).toEqual(["inc"]);
  expect(system.facts.count).toBe(0);
  system.destroy();
});

describe.each([
  ["undefined", undefined],
  ["null", null],
] as const)("a %s definition", (_, missing) => {
  it.each(["effects", "constraints", "resolvers"] as const)(
    "as one of %s: createSystem throws a TypeError",
    (kind) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const module = definitions({ [kind]: { x: missing } });

      expect(() => createSystem({ module } as Any)).toThrow(TypeError);
    },
  );
});
