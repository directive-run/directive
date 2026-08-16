/**
 * A tag on a fact is a claim that anything can act on — a redactor, an audit
 * filter, a compliance sweep. Once written, nobody gets to take it back.
 *
 * "Meta is frozen at registration" was only ever half true. `freezeMeta` froze
 * the meta OBJECT, but the schema type holding it stayed extensible, and
 * `mergedSchema[key]` is the same reference the module object holds. So a
 * `_meta` reassignment, or a `registerKeys` call naming a key that already
 * exists, silently untagged a fact.
 *
 * That was survivable only by accident: every consumer cached the tagged-key
 * set at startup, so the untag arrived too late to matter. Reading tags per
 * write is the right design and it makes the hole live, so the hole closes
 * first.
 */

import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index";

function taggedModule() {
  return createModule("m", {
    schema: {
      facts: { email: t.string().meta({ tags: ["pii"] }) },
    },
    init: (facts) => {
      facts.email = "a@b.test";
    },
  });
}

describe("a fact's tags cannot be taken back", () => {
  it("refuses a re-registration of a key that already exists", () => {
    const system = createSystem({ module: taggedModule() });
    system.start();

    const store = (system.facts as unknown as { $store: Record<string, unknown> })
      .$store;
    const registerKeys = store.registerKeys as (s: Record<string, unknown>) => void;

    expect(() => registerKeys({ email: {} })).toThrow(/email/);
    expect(system.meta.fact("email")?.tags).toEqual(["pii"]);

    system.stop();
  });

  it("refuses a _meta reassignment on the live schema type", () => {
    const module = taggedModule();
    const system = createSystem({ module });
    system.start();

    const schemaType = (
      module.schema as unknown as { facts: Record<string, { _meta?: unknown }> }
    ).facts.email;

    // Frozen, so the assignment is a no-op in sloppy mode and a TypeError in
    // strict. Either way the tag survives; the assertion is on the outcome.
    try {
      schemaType._meta = Object.freeze({ tags: [] });
    } catch {
      // strict mode — expected
    }

    expect(system.meta.fact("email")?.tags).toEqual(["pii"]);

    system.stop();
  });

  it("refuses a tags value that is not a plain array", () => {
    // An Array subclass passes `Array.isArray` and can override `includes`, so
    // it would decide per call whether a given write is redacted.
    class Sometimes extends Array<string> {
      override includes(): boolean {
        return Math.random() < 0.5;
      }
    }
    const hostile = Sometimes.from(["pii"]) as string[];

    expect(() =>
      createSystem({
        module: createModule("m", {
          schema: { facts: { email: t.string().meta({ tags: hostile }) } },
          init: (facts) => {
            facts.email = "a@b.test";
          },
        }),
      }),
    ).toThrow(/tags/);
  });
});
