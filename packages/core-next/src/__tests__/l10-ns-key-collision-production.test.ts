import { expect, it, vi } from "vitest";

// 1.35's namespaced key collision check is unconditional (engine.ts:314–349,
// "data integrity, not dev convenience"): production throws the same text.
vi.mock("#is-development", () => ({ default: false }));

const { createModule } = await import("../api/core.js");
const { t } = await import("../api/schema-builders.js");
const { createSystem } = await import("../api/system.js");

function mod(id: string, parts: Record<string, unknown>) {
  return createModule(id, {
    schema: { facts: {}, derivations: {}, events: {}, requirements: {} },
    init: () => {},
    ...parts,
  } as never);
}

it("production: a fact and a source collision still throw 1.35's text", () => {
  const fact = (key: string) =>
    mod("m", {
      schema: {
        facts: { [key]: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
    });
  expect(() =>
    createSystem({ modules: { a: fact(":x"), "a:": fact("x") } } as never),
  ).toThrow(
    '[Directive] Schema collision: Fact "a:::x" is defined in both module "a" and "a:". Use namespacing (e.g., "a:::a:::x") or merge into one module.',
  );

  const source = (key: string) =>
    mod("m", { sources: { [key]: { attach: () => () => {} } } });
  expect(() =>
    createSystem({ modules: { a: source(":x"), "a:": source("x") } } as never),
  ).toThrow(
    '[Directive] Definition collision: source "a:::x" is defined in both module "a" and "a:". Use namespacing or rename to avoid conflicts.',
  );
});
