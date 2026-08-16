/**
 * A guardrail that has stopped covering anything and one with nothing to report
 * look identical: both are silent. `guardrail.blocked` fires on a match, so
 * absence carries no information at all.
 *
 * `guardrail.coverage` is the other half — what is being screened, said when
 * the guardrail starts and again whenever the tag answers can have moved. The
 * digest stands in for the key names, because which facts a system holds under
 * a `pii` tag is part of what is being protected.
 */

import { createModule, createSystem, t } from "@directive-run/core";
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

function laterModule() {
  return createModule("later", {
    schema: { facts: { card: t.string().meta({ tags: ["pii"] }) } },
    init: (facts) => {
      facts.card = "";
    },
  });
}

describe("a guardrail says what it covers", () => {
  it("reports coverage when it starts", () => {
    const seen: Array<Record<string, unknown>> = [];
    const system = createSystem({
      module: moduleWithTaggedFact(),
      plugins: [createFactPIIGuardrail({ mode: "redact" })],
    });
    system.observe((event) => {
      if (event.type === "guardrail.coverage") {
        seen.push(event as unknown as Record<string, unknown>);
      }
    });
    system.start();

    expect(seen.length).toBeGreaterThan(0);
    const first = seen[0]!;
    expect(first.plugin).toBe("fact-pii-guardrail");
    expect(first.reason).toBe("start");
    expect(first.screenedCount).toBe(1);
    // A digest, never the key names.
    expect(String(first.screenedDigest)).not.toContain("ssn");

    system.stop();
  });

  it("reports again when a later module widens what it covers", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: Array<Record<string, unknown>> = [];
    const system = createSystem({
      module: moduleWithTaggedFact(),
      plugins: [createFactPIIGuardrail({ mode: "redact" })],
    });
    system.observe((event) => {
      if (event.type === "guardrail.coverage") {
        seen.push(event as unknown as Record<string, unknown>);
      }
    });
    system.start();
    const atStart = seen.length;

    system.registerModule(laterModule());

    const after = seen.slice(atStart);
    expect(after.length).toBeGreaterThan(0);
    expect(after.at(-1)!.reason).toBe("tags-changed");
    expect(after.at(-1)!.screenedCount).toBe(2);

    warn.mockRestore();
    system.stop();
  });
});
