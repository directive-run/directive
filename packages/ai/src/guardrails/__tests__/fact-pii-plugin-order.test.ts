/**
 * Where the guardrail sits in the plugin list must not decide whether hydrated
 * facts are screened.
 *
 * `onInit` is awaited per plugin, so only the first plugin's runs before
 * `createSystem` returns. Everything after it resumes a microtask later — by
 * which point `start()` has synchronously applied `initialFacts` and any
 * hydrated state. A guardrail that needs its `onInit` to have run was therefore
 * blind to exactly the payload most likely to carry a real customer record.
 */

import { createModule, createSystem, t } from "@directive-run/core";
import type { Plugin } from "@directive-run/core";
import { describe, expect, it, vi } from "vitest";
import { createFactPIIGuardrail } from "../fact-pii";

function moduleWithTaggedFact() {
  return createModule("m", {
    schema: {
      facts: {
        ssn: t.string().meta({ tags: ["pii"] }),
        plain: t.string(),
      },
    },
    init: (facts) => {
      facts.ssn = "";
      facts.plain = "";
    },
  });
}

/** A plugin whose `onInit` awaits, pushing everything after it a tick later. */
const slowFirstPlugin: Plugin = {
  name: "slow-first",
  async onInit() {
    await Promise.resolve();
  },
};

describe("plugin order does not decide what gets screened", () => {
  it("screens a hydrated pii fact with the guardrail registered second", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const system = createSystem({
      module: moduleWithTaggedFact(),
      plugins: [slowFirstPlugin, createFactPIIGuardrail({ mode: "redact" })],
      initialFacts: { ssn: "123-45-6789" },
    });
    system.start();

    // No await: this is the window the exposure lives in.
    expect(system.facts.ssn).not.toContain("123-45-6789");

    warn.mockRestore();
    system.stop();
  });

  it("leaves an untagged fact alone in that same window", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const system = createSystem({
      module: moduleWithTaggedFact(),
      plugins: [slowFirstPlugin, createFactPIIGuardrail({ mode: "redact" })],
      initialFacts: { plain: "123-45-6789" },
    });
    system.start();

    // Over-screening is not the safe direction here: redact mode rewrites the
    // fact, so screening a key nobody tagged corrupts data.
    expect(system.facts.plain).toBe("123-45-6789");

    warn.mockRestore();
    system.stop();
  });
});
