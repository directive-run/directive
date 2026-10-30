// Ported from packages/core/src/core/__tests__/l3-small-oracle-accessors.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { describe, expect, it } from "vitest";

// Black-box tests for the derive view's plain behaviour: an unknown name reads
// as undefined, `in` tells a derivation from anything else, and a derived
// value cannot be written. Nothing about how the view is built.

function build() {
  const mod = createModule("m", {
    schema: {
      facts: { n: t.number() },
      derivations: { doubled: t.number() },
      events: {},
    },
    init: (facts: any) => {
      facts.n = 2;
    },
    derive: { doubled: (facts: any) => facts.n * 2 },
  });
  const system = createSystem({ module: mod } as never) as any;
  system.start();

  return system;
}

describe("system.derive", () => {
  it("reads a known derivation and gives undefined for an unknown name", () => {
    const system = build();

    expect(system.derive.doubled).toBe(4);
    expect(() => system.derive.nope).not.toThrow();
    expect(system.derive.nope).toBeUndefined();
    expect(system.derive.then).toBeUndefined();
  });

  it("`in` is true for a derivation and false for anything else", () => {
    const system = build();

    expect("doubled" in system.derive).toBe(true);
    expect("nope" in system.derive).toBe(false);
  });

  it("lists exactly the derivations when enumerated or spread", () => {
    const system = build();

    expect(Object.keys(system.derive)).toEqual(["doubled"]);
    expect({ ...system.derive }).toEqual({ doubled: 4 });
  });

  it("a derived value cannot be assigned", () => {
    const system = build();

    expect(() => {
      system.derive.doubled = 99;
    }).toThrow(TypeError);
    expect(system.derive.doubled).toBe(4);
  });
});

describe("system.derive reflection on names that are not derivations", () => {
  it("a symbol is never a derivation", () => {
    const system = build();

    expect(Symbol.iterator in system.derive).toBe(false);
    expect(Symbol.for("directive.test") in system.derive).toBe(false);
  });

  it("an unknown name is not an own key, and a derivation is", () => {
    const system = build();

    expect(Object.hasOwn(system.derive, "nope")).toBe(false);
    expect(Object.getOwnPropertyDescriptor(system.derive, "nope")).toBe(
      undefined,
    );
    expect(Object.hasOwn(system.derive, "doubled")).toBe(true);
  });

  it("the names that guard against prototype pollution are not derivations", () => {
    const system = build();

    for (const name of ["__proto__", "constructor", "prototype"]) {
      expect(name in system.derive).toBe(false);
      expect(Object.hasOwn(system.derive, name)).toBe(false);
      expect(system.derive[name]).toBeUndefined();
    }
  });
});
