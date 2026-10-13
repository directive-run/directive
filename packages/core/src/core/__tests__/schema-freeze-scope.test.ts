/**
 * A foreign validator is a supported fact type, and freezing it breaks it.
 *
 * Fact tags decide what gets redacted, so the schema type holding them is
 * frozen — but only the ones this package builds. A Zod schema mutates itself
 * while validating (v3 caches its shape onto the instance on first parse, v4
 * re-defines properties on it), so freezing one turns the first validated write
 * into a TypeError. The freeze was briefly unconditional, which broke every
 * system using a Zod fact.
 */

import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index";

describe("the schema freeze covers our own types only", () => {
  it("leaves a self-caching validator writable", () => {
    const zodLike = {
      _def: { typeName: "ZodObject" },
      parse(v: unknown) {
        return v;
      },
      safeParse(this: Record<string, unknown>, v: unknown) {
        this._cached = { shape: {} };

        return { success: true, data: v };
      },
    };

    const system = createSystem({
      module: createModule("m", {
        schema: { facts: { profile: zodLike as never } },
        init: () => {},
      }),
    });
    system.start();

    expect(() => {
      (system.facts as unknown as Record<string, unknown>).profile = {
        name: "ok",
      };
    }).not.toThrow();

    system.stop();
  });

  it("still freezes the types we build, so a tag cannot be removed", () => {
    const module = createModule("m", {
      schema: { facts: { email: t.string().meta({ tags: ["pii"] }) } },
      init: (facts) => {
        facts.email = "a@b.test";
      },
    });
    const system = createSystem({ module });
    system.start();

    const st = (module.schema as unknown as { facts: Record<string, unknown> })
      .facts.email as { _meta?: unknown };
    try {
      st._meta = Object.freeze({ tags: [] });
    } catch {
      // strict mode
    }

    expect(system.meta.fact("email")?.tags).toEqual(["pii"]);

    system.stop();
  });

  it("answers a dotted fact key exactly, not by its first segment", () => {
    const system = createSystem({
      module: createModule("m", {
        schema: {
          facts: {
            user: t.string(),
            "user.email": t.string().meta({ tags: ["pii"] }),
          },
        },
        init: () => {},
      }),
    });
    system.start();

    expect(system.meta.carriesTag("fact", "user.email", "pii")).toBe(true);
    expect(system.meta.carriesTag("fact", "user", "pii")).toBe(false);

    system.stop();
  });
});
