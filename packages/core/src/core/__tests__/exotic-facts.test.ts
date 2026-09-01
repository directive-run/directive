import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

/**
 * A `Map`, a `Set` or a `Date` in a fact must still work.
 *
 * The development-mode wrapper exists to warn about a nested mutation that would
 * skip reactivity — `facts.user.name = "x"`. That warning is about *properties*,
 * and a Map's contents are not properties: they live in an internal slot no proxy
 * can reach. So wrapping one buys no warning and costs the object's own methods,
 * because `Set.prototype.has` called on a Proxy throws "incompatible receiver".
 *
 * Dev-only, like every defect of this shape: the wrapper is tree-shaken out of
 * production, so the code works when it ships and throws in the test suite.
 */
describe("exotic objects in facts", () => {
  it("keeps a Set usable", () => {
    type Held = { ids: Set<string> };
    const system = createSystem({
      module: createModule("holder", {
        schema: { facts: { held: t.object<Held>() } },
        init: (facts) => {
          facts.held = { ids: new Set(["a"]) };
        },
      }),
    });
    system.start();

    expect(system.facts.held.ids.has("a")).toBe(true);
    expect(system.facts.held.ids.size).toBe(1);
  });

  it("keeps a Map usable", () => {
    type Held = { byId: Map<string, number> };
    const system = createSystem({
      module: createModule("holder", {
        schema: { facts: { held: t.object<Held>() } },
        init: (facts) => {
          facts.held = { byId: new Map([["a", 1]]) };
        },
      }),
    });
    system.start();

    expect(system.facts.held.byId.get("a")).toBe(1);
  });

  it("keeps a Date usable", () => {
    type Held = { at: Date };
    const system = createSystem({
      module: createModule("holder", {
        schema: { facts: { held: t.object<Held>() } },
        init: (facts) => {
          facts.held = { at: new Date(0) };
        },
      }),
    });
    system.start();

    expect(system.facts.held.at.getTime()).toBe(0);
  });

  it("still warns about a nested mutation of a plain object", () => {
    type Held = { inner: { a: number } };
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (message: string) => {
      warnings.push(message);
    };
    try {
      const system = createSystem({
        module: createModule("holder", {
          schema: { facts: { held: t.object<Held>() } },
          init: (facts) => {
            facts.held = { inner: { a: 1 } };
          },
        }),
      });
      system.start();
      system.facts.held.inner.a = 2;
    } finally {
      console.warn = original;
    }

    expect(warnings.some((line) => line.includes("held.inner.a"))).toBe(true);
  });
});
