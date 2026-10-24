// Ported from packages/core/src/core/__tests__/l1-gate-rest-production.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { afterEach, describe, expect, it, vi } from "vitest";

// Production build: the dev flag is the constant `false`.
vi.mock("#is-development", () => ({ default: false }));

const { createModule, t } = await import("@directive-run/core");

// Black-box tests: what createModule leaves unsaid in a production build. The
// same inputs warn in development (l1-gate-rest.test.ts), so a silent
// production build is a choice the build makes, not an input that was never
// wrong.

afterEach(() => {
  vi.restoreAllMocks();
});

const create = createModule as unknown as (id: unknown, config: unknown) => any;

describe("createModule in production, for a module built from facts, derivations and events", () => {
  it("does not warn about a badly formed module", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    // An id that is not kebab-case, with no schema at all.
    create("Not_Kebab", {});
    // An id that is not a string.
    create(5, { schema: { facts: { count: t.number() } } });
    // A derivation and an event declared in the schema with nothing behind
    // them, and an implementation the schema never declared.
    create("m", {
      schema: {
        facts: { count: t.number() },
        derivations: { doubled: t.number() },
        events: { declared: {} },
      },
      derive: { tripled: () => 3 },
      events: { other: () => undefined },
    });
    // Facts written bare, where `schema.facts` was meant.
    create("m", { schema: { count: t.number() } });

    expect(spy).not.toHaveBeenCalled();
  });

  it("still refuses what is structurally wrong, and still hands back the module", () => {
    expect(() =>
      create("m", { schema: { facts: { self: t.number() } } }),
    ).toThrow(/reserved/);

    const mod = create("m", { schema: { facts: { count: t.number() } } });

    expect(mod.id).toBe("m");
    expect(mod.derive).toEqual({});
    expect(mod.events).toEqual({});
  });
});
