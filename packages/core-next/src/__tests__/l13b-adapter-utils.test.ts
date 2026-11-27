/**
 * L13b: `/adapter-utils` and `/migration` on core-next (the L13 RFC's AU1 to
 * AU8 and MG1). The conformance pins (U10 to U12, U17) compare every export
 * with 1.35; these cover what is core-next's own: the selector borrows the
 * system's tracker through `scopes`, for both system shapes, and leaves the
 * tracker as it found it.
 */
import { describe, expect, it } from "vitest";
import {
  type SystemLike,
  runTrackedSelector,
  shallowEqual,
} from "../adapter-utils.js";
import { createModule } from "../api/core.js";
import { scopes } from "../api/plugins.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";
import { shallowEqual as rootShallowEqual } from "../index.js";
import { analyzeReduxSlice, generateModuleCode } from "../migration.js";

type Any = any;

const counter = () =>
  createModule("counter", {
    schema: {
      facts: { n: t.number(), other: t.number() },
      derivations: { double: t.number() },
    },
    init: (facts: Any) => {
      facts.n = 2;
      facts.other = 7;
    },
    derive: { double: (facts: Any) => facts.n * 2 },
  } as Any);

describe("L13b /adapter-utils: runTrackedSelector reads the system's tracker", () => {
  it("records proxy reads, with the prefixed derivation key (AU6)", () => {
    const system = createSystem({ module: counter() } as Any) as Any;
    system.start();

    const result = runTrackedSelector(
      system as SystemLike,
      new Set(["double"]),
      (state) => (state.double as number) + (state.n as number),
    );

    expect(result).toEqual({
      value: 6,
      factKeys: ["\u001Fdouble", "n"],
      deriveKeys: ["double"],
    });
    system.destroy();
  });

  it("records a read the selector makes outside the proxy, as 1.35's global tracker does", () => {
    const system = createSystem({ module: counter() } as Any) as Any;
    system.start();

    const result = runTrackedSelector(
      system as SystemLike,
      new Set(),
      () => system.facts.other as number,
    );

    expect(result.value).toBe(7);
    expect(result.factKeys).toEqual(["other"]);
    system.destroy();
  });

  it("tracks a namespaced system: the object createSystem returns is the one in scopes", () => {
    const system = createSystem({ modules: { c: counter() } } as Any) as Any;
    system.start();
    expect(scopes.has(system)).toBe(true);

    // Read through the system: a namespaced system has no `facts.$store`, on
    // 1.35 as here, so the state proxy cannot serve it (same TypeError).
    const result = runTrackedSelector(system as SystemLike, new Set(), () => [
      system.facts.c.n,
      system.derive.c.double,
    ]);

    // 1.35's output for the same call, run against packages/core's dist.
    expect(result).toEqual({
      value: [2, 4],
      factKeys: ["c::n", "\u001Fc::double"],
      deriveKeys: [],
    });
    expect(() =>
      runTrackedSelector(
        system as SystemLike,
        new Set(),
        (state) => state["c::n"],
      ),
    ).toThrow(TypeError);
    system.destroy();
  });

  it("restores the tracker's frame, when the selector returns and when it throws", () => {
    const system = createSystem({ module: counter() } as Any) as Any;
    system.start();
    const tracker = scopes.get(system)!.tracker;
    expect(tracker.deps).toBeNull();

    runTrackedSelector(system as SystemLike, new Set(), (state) => state.n);
    expect(tracker.deps).toBeNull();
    expect(() =>
      runTrackedSelector(system as SystemLike, new Set(), () => {
        throw new Error("selector boom");
      }),
    ).toThrow("selector boom");
    expect(tracker.deps).toBeNull();
    system.destroy();
  });

  it("runs over an object no system made, recording nothing", () => {
    const fake = {
      isSettled: true,
      history: null,
      facts: {
        $store: {
          get: (key: string) => (key === "a" ? 1 : undefined),
          has: (key: string) => key === "a",
          toObject: () => ({ a: 1 }),
        },
      },
      read: (key: string) => `derived:${key}`,
      inspect: () => ({}) as Any,
    } as SystemLike;

    const result = runTrackedSelector(fake, new Set(["d"]), (state) => [
      state.a,
      state.d,
      Object.keys(state),
      "a" in state,
    ]);

    expect(result).toEqual({
      value: [1, "derived:d", ["a", "d"], true],
      factKeys: [],
      deriveKeys: ["d"],
    });
  });

  it("shallowEqual is the root's (the RFC's section C)", () => {
    expect(shallowEqual).toBe(rootShallowEqual);
  });
});

describe("L13b /migration is built (MG1)", () => {
  it("prints a module for a Redux slice", () => {
    const code = generateModuleCode(
      analyzeReduxSlice({
        name: "counter",
        initialState: { value: 0 },
        reducers: { increment: () => {}, incrementByAmount: () => {} },
      }),
    );

    expect(code).toContain("const counterModule = createModule('counter', {");
    expect(code).toContain("      value: t.number(),");
    expect(code).toContain("      incrementByAmount: { payload: t.object() },");
    expect(code).toContain("    facts.value = 0;");
  });
});
