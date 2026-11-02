/**
 * L6b: the persistence plugin on core-next (RFC L6 rows P1–P9, decisions
 * (ai) and (ak)), development build. The black-box oracle is in
 * packages/conformance (persistence.test, l6-persistence-oracle,
 * hydration-scope, the L6 diff scenarios and the golden files).
 */
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { createModule } from "../api/core.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";
import type { Plugin } from "../api/types.js";
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
  it("are skipped with one development warning, the other keys restore, and they stay in storage", () => {
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
    expect(storage.raw("prefs")).toBe(
      '{"fps":2,"removedLater":true,"other":"saved"}',
    );
    const hits = warn.mock.calls.filter((c) => /removedLater/.test(String(c)));
    expect(hits).toHaveLength(1);
    expect(error).not.toHaveBeenCalled();
  });

  // Owner, 2026-11-02, "Keep them in storage": every save writes a dropped
  // key back unchanged, so an app rolled back to an older version keeps it.
  it("survive two saves unchanged, in their place", () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const storage = memoryStorage({ prefs: { fps: 2, removedLater: true } });
      const system: any = createSystem({
        module: scene(() => {}),
        plugins: [plugin(storage, { debounce: 10 })],
      });
      system.start();
      system.facts.fps = 3;
      vi.advanceTimersByTime(20);
      expect(storage.raw("prefs")).toBe('{"fps":3,"removedLater":true}');
      system.facts.fps = 4;
      vi.advanceTimersByTime(20);
      expect(storage.raw("prefs")).toBe('{"fps":4,"removedLater":true}');
      system.destroy();
      expect(storage.raw("prefs")).toBe('{"fps":4,"removedLater":true}');
    } finally {
      vi.useRealTimers();
    }
  });

  it("an older envelope at the plugin's key is written back as 1.35 production writes it (U10)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = memoryStorage({
      prefs: { v: 1, schema: { m: 1 }, facts: { fps: 6 } },
    });
    const system: any = createSystem({
      module: scene((facts) => {
        facts.fps = 1;
      }),
      plugins: [plugin(storage)],
    });
    system.start();
    system.destroy();
    expect(storage.raw("prefs")).toBe(
      '{"v":1,"schema":{"m":1},"facts":{"fps":6},"fps":1}',
    );
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

describe("the persistence plugin: one instance on two systems", () => {
  const abc = (init: (facts: any) => void) =>
    createModule("m", {
      schema: {
        facts: { a: t.number(), b: t.string(), c: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init,
    });
  const read = (system: any, keys: string[]) =>
    Object.fromEntries(keys.map((key) => [key, system.facts[key]]));

  it("both created before either initializes: each applies its own saved data, into itself", () => {
    const storage = memoryStorage({ prefs: { a: 5 } });
    const shared = plugin(storage);
    const s1: any = createSystem({
      module: abc((facts) => {
        facts.c = 1;
      }),
      plugins: [shared],
    });
    const s2: any = createSystem({
      module: abc((facts) => {
        facts.c = 2;
      }),
      plugins: [shared],
    });
    s1.initialize();
    expect(read(s1, ["a", "c"])).toEqual({ a: 5, c: 1 });
    // s2's saved data waits for s2's initialize() (ai), and s1's turn left it alone.
    expect(read(s2, ["a", "c"])).toEqual({ a: undefined, c: undefined });
    s2.initialize();
    expect(read(s1, ["a", "c"])).toEqual({ a: 5, c: 1 });
    expect(read(s2, ["a", "c"])).toEqual({ a: 5, c: 2 });
    s1.destroy();
    s2.destroy();
    // 1.35's save reads the system the shared instance saw last.
    expect(storage.raw("prefs")).toBe('{"a":5,"c":2}');
  });

  it("initialized in the other order: the first system keeps its saved data", () => {
    const storage = memoryStorage({ prefs: { a: 5, b: "s" } });
    const shared = plugin(storage, { include: ["a", "b"] });
    const s1: any = createSystem({
      module: abc((facts) => {
        facts.a = 1;
      }),
      plugins: [shared],
    });
    const s2: any = createSystem({ module: abc(() => {}), plugins: [shared] });
    s2.initialize();
    s1.initialize();
    // (ai): the saved value beats s1's init, as on one system.
    expect(read(s1, ["a", "b"])).toEqual({ a: 5, b: "s" });
    expect(read(s2, ["a", "b"])).toEqual({ a: 5, b: "s" });
    s1.destroy();
    s2.destroy();
  });

  it("a write before initialize() makes the key that system's own, not the other's", () => {
    const storage = memoryStorage({ prefs: { a: 5 } });
    const shared = plugin(storage);
    const s1: any = createSystem({ module: abc(() => {}), plugins: [shared] });
    const s2: any = createSystem({ module: abc(() => {}), plugins: [shared] });
    s2.facts.a = 9;
    s1.initialize();
    s2.initialize();
    expect(s1.facts.a).toBe(5);
    expect(s2.facts.a).toBe(9);
    s1.destroy();
    s2.destroy();
  });

  it("a save between the two turns writes the waiting system's own saved data", () => {
    vi.useFakeTimers();
    const storage = memoryStorage({ prefs: { a: 5, b: "s" } });
    const shared = plugin(storage, { debounce: 10 });
    const s1: any = createSystem({
      module: abc((facts) => {
        facts.c = 1;
      }),
      plugins: [shared],
    });
    const s2: any = createSystem({
      module: abc((facts) => {
        facts.c = 2;
      }),
      plugins: [shared],
    });
    s1.initialize();
    s1.facts.c = 3;
    vi.advanceTimersByTime(20);
    // 1.35's save reads the system the shared instance saw last (s2), whose
    // saved data still waits for its initialize() (ai).
    expect(storage.raw("prefs")).toBe('{"a":5,"b":"s"}');
    s1.destroy();
    s2.destroy();
    vi.useRealTimers();
  });
});

describe("the persistence plugin's types", () => {
  it("keeps 1.35's <M> type parameter", () => {
    const schema = {
      facts: { palette: t.string() },
      derivations: {},
      events: {},
      requirements: {},
    };
    const made = persistencePlugin<typeof schema>({
      storage: memoryStorage() as unknown as Storage,
      key: "prefs",
    });
    expectTypeOf(made).toMatchTypeOf<Plugin>();
    // @ts-expect-error: M must be a module schema, as 1.35's.
    persistencePlugin<string>({ storage: memoryStorage(), key: "prefs" });
  });
});
