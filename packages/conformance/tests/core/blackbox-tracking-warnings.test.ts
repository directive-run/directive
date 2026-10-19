// Ported from packages/core/src/core/__tests__/blackbox-tracking-warnings.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

/**
 * Black-box conformance for the development-mode warning a fact earns when it
 * is assigned a value that cannot be tracked for reactivity (a Date, Set, Map,
 * File, or a class instance).
 *
 * Public API only: a system, a fact write and the console. Which kind of value
 * was found is read from the warning naming it; the rest of the wording is not
 * asserted.
 *
 * Development builds only: production builds do not warn, so this file does
 * not run in the production projects.
 */

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// biome-ignore lint/suspicious/noExplicitAny: facts are assigned arbitrary values on purpose
type Any = any;

afterEach(() => {
  vi.restoreAllMocks();
});

let slot = "slot";

/** A system with room for any number of facts, all typed `any`. */
let seq = 0;
function open() {
  // The warning memory outlives a system, so every test uses a fresh path.
  slot = `slot${seq++}`;
  const mod = createModule("w", {
    schema: { facts: { [slot]: t.any() }, derivations: {} },
    init: () => {},
  });
  const system = createSystem({ module: mod });
  system.start();

  return system;
}

function spy() {
  return vi.spyOn(console, "warn").mockImplementation(() => {});
}

function warnedText(s: ReturnType<typeof spy>): string {
  return s.mock.calls.map((c) => String(c[0])).join("\n");
}

/** Facts on a system built with arbitrary keys, assigned through the proxy. */
function assign(system: Any, key: string, value: unknown) {
  system.facts[key] = value;
}

class Thing {
  n = 1;
}

describe("assigning an untrackable value warns once per path and kind", () => {
  const cases: Array<[string, () => unknown]> = [
    ["Date", () => new Date(0)],
    ["Set", () => new Set([1])],
    ["Map", () => new Map([[1, 2]])],
    ["ClassInstance", () => new Thing()],
  ];

  for (const [label, make] of cases) {
    it(`names a ${label}`, () => {
      const warn = spy();
      const system = open();
      assign(system, slot, make());

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warnedText(warn)).toContain(label);
      // Kinds are told apart: the others are not named instead.
      for (const [other] of cases) {
        if (other !== label && other !== "ClassInstance") {
          expect(warnedText(warn)).not.toContain(`a ${other} instance`);
        }
      }
      system.stop();
    });
  }

  it("names a File when the runtime has one", () => {
    if (typeof File === "undefined") {
      return;
    }
    const warn = spy();
    const system = open();
    assign(system, slot, new File(["x"], "x.txt"));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warnedText(warn)).toContain("File");
    system.stop();
  });

  it("does not warn for values that round-trip as JSON", () => {
    const warn = spy();
    const system = open();
    const quiet: unknown[] = [
      null,
      undefined,
      1,
      "s",
      true,
      { a: 1 },
      [1, 2, 3],
      [],
      Object.create(null),
    ];
    for (const v of quiet) {
      assign(system, slot, v);
    }

    expect(warn).not.toHaveBeenCalled();
    system.stop();
  });

  it("does not repeat a warning for the same path and kind", () => {
    const warn = spy();
    const system = open();
    assign(system, slot, new Date(1));
    assign(system, slot, new Date(2));
    assign(system, slot, new Date(3));

    expect(warn).toHaveBeenCalledTimes(1);
    system.stop();
  });

  it("warns again for the same path with a different kind", () => {
    const warn = spy();
    const system = open();
    assign(system, slot, new Date(1));
    assign(system, slot, new Set([1]));

    expect(warn).toHaveBeenCalledTimes(2);
    const text = warnedText(warn);
    expect(text).toContain("Date");
    expect(text).toContain("Set");
    system.stop();
  });

  it("warns for each distinct path", () => {
    const warn = spy();
    const mod = createModule("p", {
      schema: { facts: { a: t.any(), b: t.any() }, derivations: {} },
      init: () => {},
    });
    const system = createSystem({ module: mod });
    system.start();
    const f = system.facts as Any;
    f.a = new Map();
    f.b = new Map();

    expect(warn).toHaveBeenCalledTimes(2);
    system.stop();
  });
});

describe("the warning memory is bounded", () => {
  it("stops growing: far more unique paths than any sane bound do not all stay remembered", () => {
    // The exact size is a 1.x implementation detail. The contract is only
    // that memory is bounded: after many unique paths the oldest are
    // forgotten (they warn again) while the newest stay quiet.
    const N = 12000;
    const facts: Record<string, ReturnType<typeof t.any>> = {};
    for (let i = 0; i < N; i++) {
      facts[`bounded${i}`] = t.any();
    }
    const mod = createModule("b", {
      schema: { facts, derivations: {} } as Any,
      init: () => {},
    });
    const system = createSystem({ module: mod }) as Any;
    system.start();

    const warn = spy();
    for (let i = 0; i < N; i++) {
      system.facts[`bounded${i}`] = new Date(i);
    }
    expect(warn).toHaveBeenCalledTimes(N);

    warn.mockClear();
    // The newest paths are still remembered, whatever the bound is.
    system.facts[`bounded${N - 1}`] = new Date(-1);
    system.facts[`bounded${N - 2}`] = new Date(-2);
    expect(warn).not.toHaveBeenCalled();

    // The very first path was forgotten long ago, so it warns again.
    system.facts.bounded0 = new Date(-5);
    expect(warn).toHaveBeenCalledTimes(1);
    system.stop();
  });
});
