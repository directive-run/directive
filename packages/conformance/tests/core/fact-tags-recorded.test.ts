// Ported from packages/core/src/core/__tests__/fact-tags-recorded.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

/**
 * "This fact carries no tag" and "I have not recorded this fact yet" are
 * different answers, and conflating them is how a redaction control fails open.
 *
 * The tag map started out holding only tagged keys, so an unrecorded key and an
 * untagged one were indistinguishable — both produced `false`, which a redactor
 * reads as "nothing to do". That mattered in two places: a module's schema
 * became visible one statement before its tags were recorded, and a key
 * registered through the store was never recorded at all.
 *
 * Every key is recorded now. Membership in the map is the answer; absence is
 * `undefined`, which every consumer treats as "screen it".
 */

import { createModule, createSystem, t } from "@directive-run/core";
import { describe, expect, it } from "vitest";

function baseModule() {
  return createModule("base", {
    schema: { facts: { plain: t.string() } },
    init: (facts) => {
      facts.plain = "";
    },
  });
}

describe("a fact's tags are recorded before the fact is reachable", () => {
  it("answers definitively for an untagged fact, and not at all for an unknown one", () => {
    const system = createSystem({ module: baseModule() });
    system.start();

    expect(system.meta.carriesTag("fact", "plain", "pii")).toBe(false);
    expect(system.meta.carriesTag("fact", "nope", "pii")).toBeUndefined();

    system.stop();
  });

  it("records a module's tags before a source it registers can publish", () => {
    const system = createSystem({ module: baseModule() });
    system.start();

    let answerDuringAttach: boolean | undefined | "not asked" = "not asked";

    system.registerModule(
      createModule("later", {
        schema: { facts: { ssn: t.string().meta({ tags: ["pii"] }) } },
        init: () => {},
        sources: {
          probe: {
            attach: () => {
              // Attach runs synchronously during registration. Anything it
              // publishes writes a fact, so the tag answer has to be right
              // already.
              answerDuringAttach = system.meta.carriesTag("fact", "ssn", "pii");

              return () => {};
            },
          },
        },
      }) as never,
    );

    expect(answerDuringAttach).toBe(true);

    system.stop();
  });

  it("records a key registered through the store, rather than leaving it unanswerable-as-untagged", () => {
    const system = createSystem({ module: baseModule() });
    system.start();

    const store = (
      system.facts as unknown as { $store: Record<string, unknown> }
    ).$store;
    (store.registerKeys as (s: Record<string, unknown>) => void)({
      ssn: t.string().meta({ tags: ["pii"] }),
    });

    expect(system.meta.carriesTag("fact", "ssn", "pii")).toBe(true);

    system.stop();
  });
});
