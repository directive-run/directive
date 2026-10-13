/**
 * The screened-key set must survive a fault while rebuilding.
 *
 * The rebuild advanced its revision marker and emptied the set before asking
 * the system which keys to screen. One throw from that question — swallowed,
 * as plugin callbacks are — left the screen holding nothing with the marker
 * already moved, so every later write took the early return. A transient fault
 * became permanent, silent exposure.
 */

import { createModule, createSystem, t } from "@directive-run/core";
import { describe, expect, it, vi } from "vitest";
import { createFactPIIGuardrail } from "../fact-pii.js";

describe("a metadata lookup that answers with nothing", () => {
  it("does not latch the screen open either", () => {
    const system = createSystem({
      module: createModule("customer", {
        schema: { facts: { ssn: t.string().meta({ tags: ["pii"] }) } },
        init: (facts) => {
          facts.ssn = "";
        },
      }),
      plugins: [createFactPIIGuardrail({ mode: "redact" })],
    });
    system.start();

    const facts = system.facts as unknown as Record<string, string>;
    facts.ssn = "123-45-6789";
    expect(facts.ssn).not.toContain("123-45-6789");

    // Not a throw — an empty answer. This is the half the try/catch cannot
    // cover, and the half the swap ordering exists for: clearing the live set
    // and advancing the marker before the answer arrives means an empty answer
    // latches the screen open for good.
    const meta = (system as unknown as { meta: { byTag: unknown } }).meta;
    const realByTag = meta.byTag as (tag: string) => unknown;
    let starved = true;
    meta.byTag = (tag: string) =>
      starved ? undefined : realByTag.call(meta, tag);

    system.registerModule(
      createModule("vendor", {
        schema: { facts: { contact: t.string() } },
        init: (f) => {
          f.contact = "";
        },
      }),
    );

    facts.ssn = "111-22-3333";
    starved = false;
    meta.byTag = realByTag;

    facts.ssn = "999-88-7777";
    expect(facts.ssn).not.toContain("999-88-7777");

    system.stop();
  });
});

describe("a fault while rebuilding the screened set", () => {
  it("does not latch the screen open", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const system = createSystem({
      module: createModule("customer", {
        schema: { facts: { ssn: t.string().meta({ tags: ["pii"] }) } },
        init: (facts) => {
          facts.ssn = "";
        },
      }),
      plugins: [createFactPIIGuardrail({ mode: "redact" })],
    });
    system.start();

    const facts = system.facts as unknown as Record<string, string>;

    facts.ssn = "123-45-6789";
    expect(facts.ssn).not.toContain("123-45-6789");

    // One transient fault from the metadata lookup, then recovery. Registering
    // a module moves the revision, which is what makes the guardrail re-ask.
    const meta = (system as unknown as { meta: { byTag: unknown } }).meta;
    const realByTag = meta.byTag as (tag: string) => unknown;
    let thrown = false;
    meta.byTag = (tag: string) => {
      if (!thrown) {
        thrown = true;

        throw new Error("metadata unavailable");
      }

      return realByTag.call(meta, tag);
    };

    system.registerModule(
      createModule("vendor", {
        schema: { facts: { contact: t.string() } },
        init: (f) => {
          f.contact = "";
        },
      }),
    );

    try {
      facts.ssn = "111-22-3333";
    } catch {
      // Surfacing the fault is acceptable; latching is not.
    }

    meta.byTag = realByTag;

    // Screening must resume once the fault clears. Before: it never did — the
    // marker had advanced past a set that was never built.
    facts.ssn = "999-88-7777";
    expect(facts.ssn).not.toContain("999-88-7777");

    system.stop();
  });
});
