import { describe, expect, it } from "vitest";
import { DEV_PROXY_TARGET } from "../facts.js";
import { createModule } from "../module.js";
import { t } from "../schema-builders.js";
import { createSystem } from "../system.js";

/**
 * Read-modify-write on an object fact must not accumulate proxy layers.
 *
 * In development the store hands back a warning-wrapped Proxy for a nested
 * object, and — as the wrapper's own comment acknowledges — those wrappers end up
 * *stored*, because the ordinary way to update an object fact is
 * `facts.map = { ...facts.map, k: v }`, which copies the wrapper into the new
 * object. Read it again and the wrapper gets wrapped.
 *
 * Nothing about that is visible; it is a read-cost problem that compounds
 * silently. Measured on an eight-key map before this was fixed: 5,000 full reads
 * took 38 ms after 8 writes, 1,400 ms after 48, and 8,164 ms after 108 — 211×
 * over a hundred writes, with the whole chain retained in memory.
 *
 * Asserted structurally rather than by timing, so the test states the invariant
 * instead of a threshold that drifts with the machine.
 */

function depth(value: unknown): number {
  let layers = 0;
  let current = value;
  while (
    current &&
    typeof current === "object" &&
    (current as { [DEV_PROXY_TARGET]?: object })[DEV_PROXY_TARGET]
  ) {
    layers++;
    current = (current as { [DEV_PROXY_TARGET]?: object })[DEV_PROXY_TARGET];
  }

  return layers;
}

function build() {
  const system = createSystem({
    module: createModule("m", {
      schema: { facts: { map: t.object<Record<string, { n: number }>>() } },
      init: (facts) => {
        facts.map = {};
      },
    }),
  });
  system.start();

  return system;
}

describe("nested fact proxies", () => {
  it("does not wrap a value that is already wrapped", () => {
    const system = build();
    system.facts.map = { ...system.facts.map, a: { n: 0 } };
    const once = depth(system.facts.map.a);

    for (let i = 1; i <= 50; i++) {
      // The ordinary update: spread the current value, which copies the wrapper
      // the store just handed back, and write it straight back in.
      system.facts.map = { ...system.facts.map, b: { n: i } };
    }

    expect(depth(system.facts.map.a)).toBe(once);
    system.destroy();
  });

  it("keeps a nested read at one layer however many writes preceded it", () => {
    const system = build();
    for (let i = 0; i < 100; i++) {
      system.facts.map = { ...system.facts.map, [`k${i % 8}`]: { n: i } };
    }

    for (const key of Object.keys(system.facts.map)) {
      expect(
        depth(system.facts.map[key]),
        `${key} is layered`,
      ).toBeLessThanOrEqual(1);
    }
    system.destroy();
  });

  it("still reads the right values through the wrapper", () => {
    // The guard must not break the thing it is guarding.
    const system = build();
    for (let i = 0; i < 20; i++) {
      system.facts.map = { ...system.facts.map, a: { n: i } };
    }

    expect(system.facts.map.a?.n).toBe(19);
    expect(Object.keys(system.facts.map)).toEqual(["a"]);
    system.destroy();
  });
});
