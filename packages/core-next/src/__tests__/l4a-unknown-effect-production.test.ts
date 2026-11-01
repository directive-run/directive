import { expect, it, vi } from "vitest";

// C1 in production: an unknown effect id still throws 1.35's error
// (effects.ts:828–832 is a plain throw, not a development message).
vi.mock("#is-development", () => ({ default: false }));

const { createModule } = await import("../api/core.js");
const { t } = await import("../api/schema-builders.js");
const { createSystem } = await import("../api/system.js");

it("production: enable, disable and isEnabled on an unknown effect throw", () => {
  const system: any = createSystem({
    module: createModule("m", {
      schema: { facts: { a: t.number() }, derivations: {}, events: {} },
      init: (f: any) => {
        f.a = 0;
      },
      effects: { e: { run: () => {} } },
    } as any),
  } as any);
  for (const method of ["disable", "enable", "isEnabled"]) {
    expect(() => system.effects[method]("ghost")).toThrow(
      "[Directive] Unknown effect: ghost",
    );
  }
  expect(system.effects.isEnabled("e")).toBe(true);
  system.destroy();
});
