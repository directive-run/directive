/**
 * `system.constraints` on a system with no constraint and no resolver.
 *
 * 1.35 always puts `disable`, `enable` and `isDisabled` on
 * `system.constraints` (engine.ts:2610): with nothing to control, an id is
 * unknown (a warning, no throw) and nothing is disabled. 2.0 builds the
 * constraint feature only once a constraint or resolver exists, and the three
 * controls were added by that build, so a plain module had none of them and
 * `system.constraints.disable("x")` was a TypeError.
 *
 * The warning's text is development text in 2.0 (1.35 also prints it in
 * production); production here is silent, with or without constraints.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

type Any = any;
const load = async (development: boolean) => {
  vi.resetModules();
  vi.doMock("#is-development", () => ({ default: development }));
  const { createModule } = await import("../api/core.js");
  const { t } = await import("../api/schema-builders.js");
  const { createSystem } = await import("../api/system.js");
  const bare = () =>
    createModule("a", {
      schema: { facts: { count: t.number() }, requirements: { R: {} } },
      init: (f: Any) => {
        f.count = 0;
      },
    } as Any);

  return {
    flat: () => createSystem({ module: bare() } as Any) as Any,
    namespaced: () => createSystem({ modules: { a: bare() } } as Any) as Any,
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("#is-development");
});

describe.each([
  ["development", true],
  ["production", false],
] as const)("no constraint, no resolver (%s)", (_, development) => {
  describe.each(["flat", "namespaced"] as const)("%s", (shape) => {
    it.each([false, true])(
      "has 1.35's three controls (started: %s)",
      async (started) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const system = (await load(development))[shape]();
        started && system.start();

        expect(typeof system.constraints.disable).toBe("function");
        expect(typeof system.constraints.enable).toBe("function");
        expect(typeof system.constraints.isDisabled).toBe("function");
        expect(system.constraints.disable("x")).toBeUndefined();
        expect(system.constraints.isDisabled("x")).toBe(false);
        expect(system.constraints.enable("x")).toBeUndefined();
        expect(warn.mock.calls.map((call) => call[0])).toEqual(
          development
            ? [
                '[Directive] constraints.disable("x") — no such constraint',
                '[Directive] constraints.enable("x") — no such constraint',
              ]
            : [],
        );
        system.destroy();
      },
    );
  });

  it("controls a constraint registered later", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = (await load(development)).flat();
    const { disable, enable, isDisabled } = system.constraints;
    system.start();
    system.constraints.register("c", {
      when: (f: Any) => f.count > 5,
      require: { type: "R" },
    });

    // The controls read before the feature was built are the live ones.
    disable("c");
    expect(isDisabled("c")).toBe(true);
    expect(system.constraints.isDisabled("c")).toBe(true);
    enable("c");
    expect(isDisabled("c")).toBe(false);
    system.destroy();
  });
});
