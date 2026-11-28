/**
 * A definition map with an undefined or null entry (flat).
 *
 * 1.35's createSystem reads `meta` of every effect, constraint and resolver
 * definition (engine.ts:386-396), so `effects: { x: undefined }` is the
 * platform's TypeError where the system is created. 2.0 built the system and
 * listed `x` as an enabled effect, and its production build did the same for
 * `resolvers: { x: undefined }`.
 *
 * What is matched is the error's class and when it is thrown. The message is
 * an accident of which property each engine reads first ('meta' in 1.35), so
 * it is not asserted.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

type Any = any;
const load = async (development: boolean) => {
  vi.resetModules();
  vi.doMock("#is-development", () => ({ default: development }));
  const { createModule } = await import("../api/core.js");
  const { t } = await import("../api/schema-builders.js");
  const { createSystem } = await import("../api/system.js");

  return (definitions: Any) => {
    const module = createModule("a", {
      schema: { facts: { count: t.number() }, requirements: { R: {} } },
      init: (f: Any) => {
        f.count = 0;
      },
      ...definitions,
    } as Any);

    return () => createSystem({ module } as Any);
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("#is-development");
});

describe.each([
  ["development", true],
  ["production", false],
] as const)("a missing definition (%s)", (_, development) => {
  describe.each([
    ["undefined", undefined],
    ["null", null],
  ] as const)("%s", (_, missing) => {
    it("as an effect: createSystem throws a TypeError", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const system = await load(development);

      expect(system({ effects: { x: missing } })).toThrow(TypeError);
      expect(
        system({ effects: { ok: { run: () => {} }, x: missing } }),
      ).toThrow(TypeError);
    });

    it("as a resolver: createSystem throws a TypeError", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const system = await load(development);

      expect(system({ resolvers: { x: missing } })).toThrow(TypeError);
    });
  });

  it("a module with whole definitions is built", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = await load(development);

    expect(
      system({
        effects: { ok: { run: () => {} } },
        resolvers: { r: { requirement: "R", resolve: async () => {} } },
      }),
    ).not.toThrow();
  });
});
