/**
 * Two modules whose namespaced keys meet once joined. Neither "a" nor "a:"
 * holds the "::" separator, nor ":x" nor "x", yet "a" + "::" + ":x" and
 * "a:" + "::" + "x" are both "a:::x". 1.35 refuses that at createSystem
 * (engine.ts:314–349): facts by one map, every definition section by
 * another. The L10 gate-debt oracle pins the fact (L2) and source (L5)
 * cases; these pin them, and the rest of 1.35's check, on core-next.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSystem } from "../api/system.js";
import { createModule, t } from "../index.js";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const NEVER = { requirements: { NEVER: {} } };
const PARTS: Record<string, (key: string) => Record<string, unknown>> = {
  fact: (key) => ({ schema: { facts: { [key]: t.number() } } }),
  derivation: (key) => ({
    schema: { derivations: { [key]: t.number() } },
    derive: { [key]: () => 1 },
  }),
  effect: (key) => ({ effects: { [key]: { run: () => {} } } }),
  source: (key) => ({ sources: { [key]: { attach: () => () => {} } } }),
  constraint: (key) => ({
    schema: NEVER,
    constraints: { [key]: { when: () => false, require: { type: "NEVER" } } },
  }),
  resolver: (key) => ({
    schema: NEVER,
    resolvers: { [key]: { requirement: "NEVER", resolve: async () => {} } },
  }),
  event: (key) => ({
    schema: { events: { [key]: {} } },
    events: { [key]: () => {} },
  }),
};

function mod(id: string, parts: Record<string, unknown>) {
  const schema = (parts.schema ?? {}) as Record<string, unknown>;

  return createModule(id, {
    ...parts,
    schema: {
      facts: {},
      derivations: {},
      events: {},
      requirements: {},
      ...schema,
    },
    init: () => {},
  } as never);
}

const build = (modules: Record<string, unknown>) => () =>
  createSystem({ modules } as never);

describe("createSystem refuses two modules whose namespaced keys collide", () => {
  it("for a fact, with 1.35's text", () => {
    const a = mod("a", PARTS.fact!(":x"));
    const b = mod("b", PARTS.fact!("x"));

    expect(build({ a, "a:": b })).toThrow(
      '[Directive] Schema collision: Fact "a:::x" is defined in both module "a" and "a:". Use namespacing (e.g., "a:::a:::x") or merge into one module.',
    );
  });

  it("for a source, with 1.35's text", () => {
    const a = mod("a", PARTS.source!(":x"));
    const b = mod("b", PARTS.source!("x"));

    expect(build({ a, "a:": b })).toThrow(
      '[Directive] Definition collision: source "a:::x" is defined in both module "a" and "a:". Use namespacing or rename to avoid conflicts.',
    );
  });

  for (const section of [
    "derivation",
    "effect",
    "constraint",
    "resolver",
    "event",
  ]) {
    it(`for a ${section}`, () => {
      const a = mod("a", PARTS[section]!(":x"));
      const b = mod("b", PARTS[section]!("x"));

      expect(build({ a, "a:": b })).toThrow(
        `[Directive] Definition collision: ${section} "a:::x" is defined in both module "a" and "a:". Use namespacing or rename to avoid conflicts.`,
      );
    });
  }

  it("names the earlier module in init order as the owner", () => {
    const a = mod("a", PARTS.fact!(":x"));
    const b = mod("b", PARTS.fact!("x"));

    expect(build({ "a:": b, a })).toThrow(
      'Fact "a:::x" is defined in both module "a:" and "a". Use namespacing (e.g., "a::a:::x")',
    );
  });

  it("shares one owner map across definition sections, as 1.35 does", () => {
    const a = mod("a", PARTS.source!(":x"));
    const b = mod("b", PARTS.derivation!("x"));

    expect(build({ a, "a:": b })).toThrow(
      'Definition collision: derivation "a:::x" is defined in both module "a" and "a:"',
    );
  });

  it("keeps facts apart from definitions, and one module's own keys apart", () => {
    const a = mod("a", PARTS.fact!(":x"));
    const b = mod("b", {
      ...PARTS.derivation!("x"),
      ...PARTS.effect!("x"),
    });

    expect(build({ a, "a:": b })).not.toThrow();
  });
});
