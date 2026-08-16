/**
 * A subscriber that throws must not take a write's plugins down with it.
 *
 * Derivation invalidation flushes listeners, and those listeners are
 * `system.subscribe` / `system.watch` callbacks — consumer code. Once
 * invalidation runs before the plugin announcement (so a plugin reading
 * metadata sees the write it is being told about), an unguarded throw from one
 * of those callbacks would propagate out of the store's `onChange` before
 * `emitFactSet`, and every plugin behind it — including a guardrail deciding
 * whether the value it just committed needs redacting — would never run.
 *
 * The plugin manager already isolates its own hooks this way. Derivation
 * listeners did not.
 */

import { describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index";
import type { Plugin } from "../../index";

function counterModule() {
  return createModule("m", {
    schema: {
      facts: { count: t.number() },
      derivations: { doubled: t.number() },
    },
    init: (facts) => {
      facts.count = 0;
    },
    derive: { doubled: (facts) => facts.count * 2 },
  });
}

describe("a throwing subscriber is contained", () => {
  it("still announces the write to plugins", () => {
    const announced: string[] = [];
    const plugin: Plugin = {
      name: "announce-probe",
      onFactSet(key) {
        announced.push(String(key));
      },
    };

    const system = createSystem({ module: counterModule(), plugins: [plugin] });
    system.start();
    announced.length = 0;

    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    system.watch("doubled", () => {
      throw new Error("subscriber blew up");
    });

    // The write itself must not throw, and the plugin must still hear about it.
    expect(() => {
      system.facts.count = 1;
    }).not.toThrow();

    expect(announced).toContain("count");
    expect(system.facts.count).toBe(1);

    err.mockRestore();
    system.stop();
  });

  it("keeps notifying the subscribers that did not throw", () => {
    const reached: string[] = [];
    const system = createSystem({ module: counterModule() });
    system.start();

    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    system.watch("doubled", () => {
      throw new Error("first one blew up");
    });
    system.watch("doubled", () => {
      reached.push("second");
    });

    system.facts.count = 1;

    expect(reached).toEqual(["second"]);

    err.mockRestore();
    system.stop();
  });
});
