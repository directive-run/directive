// Ported from packages/core/src/core/__tests__/l6-persistence-oracle.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { persistencePlugin } from "@directive-run/core/plugins";
import { afterEach, describe, expect, it, vi } from "vitest";

// The persistence plugin on a real 1.35 system, development build (L6 RFC,
// "Untested behaviours" U7, U8, U15). Public API only. (ai) is approved for
// 2.0 and reorders the restore against the module init: only the outcomes it
// keeps are pinned here (an init that leaves the fact alone or uses `??=`,
// and initialFacts beating saved data); the outcomes it changes are a diff
// scenario. (aj) is declined, so the Date save stays as 1.35 does it.

afterEach(() => {
  vi.restoreAllMocks();
});

/** An in-memory Storage. */
function memoryStorage(initial: Record<string, unknown> = {}) {
  const map = new Map<string, string>(
    Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]),
  );

  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  } as unknown as Storage;
}

/** A scene module: `palette` is persisted, `fps` is not; `init` is the test's. */
function scene(init: (facts: any) => void) {
  return createModule("scene", {
    schema: {
      facts: { palette: t.string(), fps: t.number() },
      derivations: {},
      events: {},
      requirements: {},
    },
    init,
    derive: {},
    events: {},
  } as any);
}

describe("saved data against the module init and initialFacts (U7)", () => {
  it("an init that leaves the persisted fact alone keeps the saved value", () => {
    const storage = memoryStorage({ prefs: { palette: "sodium" } });
    const system: any = createSystem({
      module: scene((facts) => {
        facts.fps = 1;
      }),
      plugins: [persistencePlugin({ storage, key: "prefs" })],
    });
    system.initialize();
    system.start();
    expect(system.facts.palette).toBe("sodium");
    expect(system.facts.fps).toBe(1);
  });

  it("an init that uses ??= keeps the saved value", () => {
    const storage = memoryStorage({ prefs: { palette: "sodium" } });
    const system: any = createSystem({
      module: scene((facts) => {
        facts.palette ??= "aperture";
        facts.fps = 1;
      }),
      plugins: [persistencePlugin({ storage, key: "prefs" })],
    });
    system.initialize();
    system.start();
    expect(system.facts.palette).toBe("sodium");
  });

  it("initialFacts beat the saved value", () => {
    const storage = memoryStorage({ prefs: { palette: "sodium" } });
    const system: any = createSystem({
      module: scene((facts) => {
        facts.fps = 1;
      }),
      plugins: [persistencePlugin({ storage, key: "prefs" })],
      initialFacts: { palette: "init-facts" },
    } as any);
    system.start();
    expect(system.facts.palette).toBe("init-facts");
  });
});

describe("a namespaced system persists flat ns::key keys (U15)", () => {
  it("saves an included key under its flat name, and restores it from there", () => {
    const storage = memoryStorage();
    const make = (): any =>
      createSystem({
        modules: {
          scene: scene((facts) => {
            facts.fps = 1;
          }),
        },
        plugins: [
          persistencePlugin({
            storage,
            key: "prefs",
            include: ["scene::palette"],
            debounce: 0,
          }),
        ],
      });
    const first = make();
    first.start();
    first.facts.scene.palette = "sodium";
    first.facts.scene.fps = 30;
    first.destroy();
    expect(JSON.parse(storage.getItem("prefs") as string)).toEqual({
      "scene::palette": "sodium",
    });

    const second = make();
    second.start();
    expect(second.facts.scene.palette).toBe("sodium");
    expect(second.facts.scene.fps).toBe(1);
  });
});

describe("a Date fact in a development save (U8, aj declined)", () => {
  it("saves nothing, and only onError hears", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = memoryStorage();
    const errors: Error[] = [];
    const saved: unknown[] = [];
    const system: any = createSystem({
      module: createModule("m", {
        schema: {
          facts: { when: t.date(), n: t.number() },
          derivations: {},
          events: {},
          requirements: {},
        },
        init: (facts: any) => {
          facts.n = 0;
        },
        derive: {},
        events: {},
      } as any),
      plugins: [
        persistencePlugin({
          storage,
          key: "k",
          debounce: 0,
          onError: (error) => errors.push(error),
          onSave: (data) => saved.push(data),
        }),
      ],
    });
    system.start();
    system.facts.when = new Date(5);
    system.facts.n = 1;
    system.destroy();
    expect(storage.getItem("k")).toBeNull();
    expect(saved).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
  });
});
