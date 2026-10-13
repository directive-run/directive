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

    const store = (
      system.facts as unknown as { $store: Record<string, unknown> }
    ).$store;
    const registerKeys = store.registerKeys as (
      s: Record<string, unknown>,
    ) => void;

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
    ).facts.email as { _meta?: unknown };

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

  it("never consults a caller's tags object when deciding what to screen", () => {
    // An Array subclass passes `Array.isArray` and can override `includes` to
    // answer differently on each call, which would make redaction depend on
    // when it was asked. The runtime copies `tags` into a plain array it owns,
    // so the override is never reached.
    //
    // Copying rather than rejecting the prototype is deliberate: an array from
    // another realm — a `vm` context, a worker, an iframe — has a different
    // `Array.prototype` while being perfectly ordinary, and rejecting it would
    // turn that into a startup failure.
    let consulted = 0;
    class Sometimes extends Array<string> {
      override includes(): boolean {
        consulted++;

        return false;
      }
    }
    const hostile = Sometimes.from(["pii"]) as string[];

    const system = createSystem({
      module: createModule("m", {
        schema: { facts: { email: t.string().meta({ tags: hostile }) } },
        init: (facts) => {
          facts.email = "a@b.test";
        },
      }),
    });
    system.start();

    expect(system.meta.carriesTag("fact", "email", "pii")).toBe(true);
    expect(consulted).toBe(0);

    system.stop();
  });

  it("rejects a tags value that is not an array of strings", () => {
    expect(() =>
      createSystem({
        module: createModule("m", {
          schema: {
            facts: { email: t.string().meta({ tags: "pii" as never }) },
          },
          init: () => {},
        }),
      }),
    ).toThrow(/tags/);
  });
});
