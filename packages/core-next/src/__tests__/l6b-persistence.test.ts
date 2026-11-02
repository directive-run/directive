/**
 * L6b: the persistence plugin on core-next (RFC L6 rows P1–P9, decisions
 * (ai) and (ak)), development build. The black-box oracle is in
 * packages/conformance (persistence.test, l6-persistence-oracle,
 * hydration-scope, the L6 diff scenarios and the golden files).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";
import { persistencePlugin } from "../plugins/index.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function memoryStorage(initial: Record<string, unknown> = {}) {
  const map = new Map<string, string>(
    Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]),
  );

  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    raw: (key: string) => map.get(key),
  };
}

const scene = (init: (facts: any) => void) =>
  createModule("scene", {
    schema: {
      facts: { palette: t.string(), fps: t.number(), other: t.string() },
      derivations: {},
      events: {},
      requirements: {},
    },
    init,
  });

const plugin = (storage: ReturnType<typeof memoryStorage>, extra = {}) =>
  persistencePlugin({
    storage: storage as unknown as Storage,
    key: "prefs",
    ...extra,
  });

describe("the persistence plugin (ai): applied inside initialize()", () => {
  it("an init that sets a persisted fact no longer overwrites the saved value", () => {
    const storage = memoryStorage({ prefs: { palette: "sodium" } });
    const system: any = createSystem({
      module: scene((facts) => {
        facts.palette = "aperture";
        facts.fps = 1;
      }),
      plugins: [plugin(storage, { include: ["palette"] })],
    });
    // Not applied until initialize() (the second visible change).
    expect(system.facts.palette).toBeUndefined();
    system.initialize();
    expect(system.facts.palette).toBe("sodium");
    system.start();
    system.destroy();
    expect(storage.raw("prefs")).toBe('{"palette":"sodium"}');
  });

  it("initialFacts and hydrate still beat saved data", async () => {
    const storage = memoryStorage({ prefs: { palette: "sodium", fps: 9 } });
    const system: any = createSystem({
      module: scene(() => {}),
      plugins: [plugin(storage)],
      initialFacts: { palette: "init-facts" },
    });
    await system.hydrate(() => ({ fps: 30 }));
    system.start();
    expect(system.facts.palette).toBe("init-facts");
    expect(system.facts.fps).toBe(30);
    system.destroy();
  });

  it("before initialize(), a save keeps the saved values, in 1.35's key order, and a key the program wrote is the program's", () => {
    const storage = memoryStorage({ prefs: { palette: "sodium", fps: 9 } });
    const system: any = createSystem({
      module: scene((facts) => {
        facts.palette = "aperture";
        facts.fps = 1;
      }),
      plugins: [plugin(storage)],
    });
    system.facts.fps = 5;
    system.facts.other = "x";
    system.destroy();
    expect(storage.raw("prefs")).toBe(
      '{"palette":"sodium","fps":5,"other":"x"}',
    );

    const again: any = createSystem({
      module: scene(() => {}),
      plugins: [plugin(storage)],
    });
    again.facts.fps = 7;
    again.initialize();
    expect(again.facts.palette).toBe("sodium");
    expect(again.facts.fps).toBe(7);
    again.destroy();
  });
});

describe("the persistence plugin (ak): saved keys the schema dropped", () => {
  it("are skipped with one development warning, and the other keys restore", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const storage = memoryStorage({
      prefs: { fps: 2, removedLater: true, other: "saved" },
    });
    const system: any = createSystem({
      module: scene((facts) => {
        facts.fps ??= 0;
      }),
      plugins: [plugin(storage)],
    });
    system.start();
    expect(system.facts.fps).toBe(2);
    expect(system.facts.other).toBe("saved");
    system.destroy();
    expect(storage.raw("prefs")).toBe('{"fps":2,"other":"saved"}');
    const hits = warn.mock.calls.filter((c) => /removedLater/.test(String(c)));
    expect(hits).toHaveLength(1);
    expect(error).not.toHaveBeenCalled();
  });
});

describe("the persistence plugin and (ah)", () => {
  it("the lab's flow (namespaced, include, initialize then start) restores and warns nothing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const storage = memoryStorage({ prefs: { "scene::palette": "sodium" } });
    const make = (): any =>
      createSystem({
        modules: {
          scene: scene((facts) => {
            facts.palette = "aperture";
            facts.fps = 60;
          }),
        },
        plugins: [plugin(storage, { include: ["scene::palette"] })],
      });
    const system = make();
    system.initialize();
    expect(system.facts.scene.palette).toBe("sodium");
    system.start();
    system.facts.scene.palette = "neon";
    system.facts.scene.fps = 30;
    system.destroy();
    expect(storage.raw("prefs")).toBe('{"scene::palette":"neon"}');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
