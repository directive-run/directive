/**
 * L10 gate debt: three 1.35 rules the L10-pre-b oracle found 2.0 missing.
 * Each test fails when its line in meta.ts is removed.
 *
 * - destroy() and destroyAsync() clear meta.subscribe's listeners (1.35
 *   engine.ts:3505, 3553), so a module teardown that finishes after destroy
 *   tells no one.
 * - registerModule with a fact that has no schema type throws, after the key
 *   joined the schema and every new key's tags were recorded (1.35
 *   engine.ts:4509–4523: its WeakSet refuses the missing type). createSystem
 *   throws the same way (engine.ts:405–411).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

type Any = any;

afterEach(() => {
  vi.restoreAllMocks();
});

const wait = (ms = 0) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const base = () =>
  createModule("base", {
    schema: { facts: { n: t.number() } },
    init: (facts: Any) => {
      facts.n = 0;
    },
  } as never);

describe("destroy clears meta.subscribe's listeners (1.35 engine.ts:3505, 3553)", () => {
  for (const how of ["destroy", "destroyAsync"] as const) {
    it(`a module teardown that finishes after ${how}() calls no listener`, async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      let open!: () => void;
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      const system = createSystem({ module: base() } as never) as Any;
      system.start();
      system.registerModule({
        id: "extra",
        schema: { facts: {}, requirements: { WORK: {} } },
        constraints: { c: { when: () => true, require: { type: "WORK" } } },
        resolvers: {
          r: {
            requirement: "WORK",
            resolve: async () => {
              await gate;
            },
          },
        },
      });
      await wait(10);
      let calls = 0;
      system.meta.subscribe(() => {
        calls += 1;
      });

      const leaving = system.unregisterModule("extra").catch(() => {});
      const destroyed = system[how]();
      open();
      await Promise.allSettled([leaving, destroyed]);
      await wait(10);

      expect(calls).toBe(0);
    });
  }
});

describe("a fact with no schema type (1.35 engine.ts:405–411, 4509–4523)", () => {
  it("registerModule throws after the keys joined and their tags were recorded, and tells no listener", () => {
    const system = createSystem({ module: base() } as never) as Any;
    system.start();
    let calls = 0;
    system.meta.subscribe(() => {
      calls += 1;
    });

    expect(() =>
      system.registerModule({
        id: "extra",
        schema: { facts: { z: undefined, y: t.number() } },
      }),
    ).toThrow(TypeError);

    expect(system.inspect().facts).toEqual([
      { key: "n", meta: undefined },
      { key: "z", meta: undefined },
      { key: "y", meta: undefined },
    ]);
    // Recorded as untagged, the key after the missing type too; a key never
    // registered stays unanswered.
    expect(system.meta.carriesTag("fact", "z", "pii")).toBe(false);
    expect(system.meta.carriesTag("fact", "y", "pii")).toBe(false);
    expect(system.meta.carriesTag("fact", "q", "pii")).toBeUndefined();
    expect(calls).toBe(0);
  });

  it("createSystem throws", () => {
    expect(() =>
      createSystem({
        module: createModule("m", {
          schema: { facts: { z: undefined } },
        } as never),
      } as never),
    ).toThrow(TypeError);
  });
});
