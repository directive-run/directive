import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

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
