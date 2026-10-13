import { describe, expect, it } from "vitest";
import type { FactChange } from "../../core/types/facts.js";
import type { Plugin } from "../../core/types/plugins.js";
import { createModule, createSystem, t } from "../../index.js";
import { persistencePlugin } from "../persistence.js";

/**
 * Marking a write as hydration is a capability, not a convenience. The audit
 * ledger files entries by that answer, so an answer a consumer can set is not
 * worth filing by.
 *
 * Two ways the first attempt failed, both found by review:
 *
 *  - it was parked on the system under a non-enumerable symbol, and
 *    `Object.getOwnPropertySymbols` hands those over — while every plugin is
 *    given the system;
 *  - it was installed after plugin init began, so the plugin at index zero saw
 *    nothing and fell back to writing unmarked. `plugins: [persistencePlugin()]`
 *    is the documented single-plugin shape, so the common arrangement was the
 *    broken one.
 *
 * The second passed review the first time because nothing asserted the origin
 * of a restored value — only that the value arrived.
 */

function storageWith(data: Record<string, unknown>) {
  const store = new Map<string, string>([["app", JSON.stringify(data)]]);

  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

function makeModule() {
  return createModule("m", {
    schema: { facts: { token: t.string() } },
    init: (facts) => {
      facts.token = "seed";
    },
  });
}

describe("the hydration capability", () => {
  it("is not reachable from a consumer plugin", async () => {
    const found: string[] = [];
    const thief: Plugin = {
      name: "thief",
      onInit: (sys) => {
        for (const symbol of Object.getOwnPropertySymbols(sys)) {
          found.push(String(symbol));
        }
      },
    };
    const system = createSystem({ module: makeModule(), plugins: [thief] });
    await system.start();

    expect(found).toEqual([]);

    await system.stop();
  });

  it("marks restored values as hydration with persistence listed first", async () => {
    // Index zero is the case that was broken, and the one the docs show.
    const seen: FactChange[] = [];
    const watcher: Plugin = {
      name: "watcher",
      onFactsBatch: (changes) => {
        seen.push(...changes);
      },
    };
    const system = createSystem({
      module: makeModule(),
      plugins: [
        persistencePlugin({
          storage: storageWith({ token: "from-disk" }) as unknown as Storage,
          key: "app",
        }),
        watcher,
      ],
    });
    await system.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Not asserting the surviving value: module `init` runs after plugin init
    // in this arrangement and overwrites it. What matters here is how the
    // restored write was filed, not who wrote last.
    const restored = seen.filter((c) => c.value === "from-disk");
    expect(restored.length).toBeGreaterThan(0);
    expect(restored.every((c) => c.origin === "hydrate")).toBe(true);

    await system.stop();
  });

  it("marks them the same way whatever position the plugin is in", async () => {
    const seen: FactChange[] = [];
    const watcher: Plugin = {
      name: "watcher",
      onFactsBatch: (changes) => {
        seen.push(...changes);
      },
    };
    const system = createSystem({
      module: makeModule(),
      plugins: [
        { name: "inert" },
        persistencePlugin({
          storage: storageWith({ token: "from-disk" }) as unknown as Storage,
          key: "app",
        }),
        watcher,
      ],
    });
    await system.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const restored = seen.filter((c) => c.value === "from-disk");
    expect(restored.length).toBeGreaterThan(0);
    expect(restored.every((c) => c.origin === "hydrate")).toBe(true);

    await system.stop();
  });
});
