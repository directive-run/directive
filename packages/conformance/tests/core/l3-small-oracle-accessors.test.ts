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
    expect(Symbol.iterator in system.derive).toBe(false);
  });

  it("owns a property for each derivation and for nothing else", () => {
    const system = build();

    expect(Object.hasOwn(system.derive, "doubled")).toBe(true);
    expect(Object.hasOwn(system.derive, "nope")).toBe(false);
  });

  it("a derived value cannot be assigned", () => {
    const system = build();

    expect(() => {
      system.derive.doubled = 99;
    }).toThrow(TypeError);
    expect(system.derive.doubled).toBe(4);
  });
});
