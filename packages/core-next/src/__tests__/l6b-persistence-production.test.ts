/**
 * L6b (ak) in production: a saved key the schema no longer has is skipped on
 * load with no warning, and every save writes it back unchanged, in its
 * place, as 1.35 production writes it (owner, 2026-11-02: "Keep them in
 * storage"; development drops it, "Drop stale keys in dev").
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("#is-development", () => ({ default: false }));

const { createModule } = await import("../api/core.js");
const { t } = await import("../api/schema-builders.js");
const { createSystem } = await import("../api/system.js");
const { persistencePlugin } = await import("../plugins/index.js");

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

describe("the persistence plugin (ak) in production: saved keys the schema dropped", () => {
  it("are not restored, warn nothing, and survive two saves unchanged, in their place", () => {
    vi.useFakeTimers();
    try {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const storage = memoryStorage({
        prefs: { fps: 2, removedLater: true, other: "saved" },
      });
      const system: any = createSystem({
        module: scene(() => {}),
        plugins: [plugin(storage, { debounce: 10 })],
      });
      system.start();
      expect(system.facts.fps).toBe(2);
      expect(system.facts.removedLater).toBeUndefined();
      system.facts.fps = 3;
      vi.advanceTimersByTime(20);
      expect(storage.raw("prefs")).toBe(
        '{"fps":3,"removedLater":true,"other":"saved"}',
      );
      system.facts.fps = 4;
      vi.advanceTimersByTime(20);
      expect(storage.raw("prefs")).toBe(
        '{"fps":4,"removedLater":true,"other":"saved"}',
      );
      system.destroy();
      expect(storage.raw("prefs")).toBe(
        '{"fps":4,"removedLater":true,"other":"saved"}',
      );
      expect(warn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("are written back by a save before initialize(), while the saved values are held (ai)", () => {
    const storage = memoryStorage({ prefs: { fps: 2, removedLater: true } });
    const system: any = createSystem({
      module: scene(() => {}),
      plugins: [plugin(storage)],
    });
    system.destroy();
    expect(storage.raw("prefs")).toBe('{"fps":2,"removedLater":true}');
  });

  it("an older envelope at the plugin's key is written back as 1.35 production writes it (U10)", () => {
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
