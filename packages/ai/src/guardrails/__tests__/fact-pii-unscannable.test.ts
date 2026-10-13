/**
 * A member the cloner refuses must not switch the whole scan off.
 *
 * The walker sanitised by `structuredClone` and, when that threw, returned
 * "no match" — which the caller cannot tell from "scanned and clean". A single
 * function property, which any tool result or row wrapper may carry, therefore
 * committed every sibling value raw, with no event and no redaction.
 */

import { createModule, createSystem, t } from "@directive-run/core";
import { describe, expect, it, vi } from "vitest";
import { createFactPIIGuardrail } from "../fact-pii.js";

function systemWithPayload() {
  return createSystem({
    module: createModule("customer", {
      schema: {
        facts: {
          payload: t.object<Record<string, unknown>>().meta({ tags: ["pii"] }),
        },
      },
      init: (facts) => {
        facts.payload = {};
      },
    }),
    plugins: [createFactPIIGuardrail({ mode: "redact" })],
  });
}

describe("a value the cloner refuses", () => {
  it("is still scanned for what it does hold", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = systemWithPayload();
    system.start();
    const facts = system.facts as unknown as Record<string, unknown>;

    // The control: plain object, redacted.
    facts.payload = { email: "victim@example.com", ssn: "123-45-6789" };
    expect(JSON.stringify(facts.payload)).not.toContain("123-45-6789");

    // The same data, plus one member `structuredClone` refuses. Before: the
    // whole scan was skipped and both values committed raw.
    facts.payload = {
      email: "victim@example.com",
      ssn: "123-45-6789",
      retry: () => {},
    };
    expect(JSON.stringify(facts.payload)).not.toContain("123-45-6789");
    expect(JSON.stringify(facts.payload)).not.toContain("victim@example.com");

    system.stop();
  });
});
