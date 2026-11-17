import { expect, it, vi } from "vitest";

// 1.35's "no such module is registered" is unconditional (engine.ts:4686–
// 4694), and its single-module wrapper registers a copy (system.ts:1338):
// production refuses the caller's module object with the same text.
vi.mock("#is-development", () => ({ default: false }));

const { createModule } = await import("../api/core.js");
const { t } = await import("../api/schema-builders.js");
const { createSystem } = await import("../api/system.js");

it("production: unregisterModule refuses a module object with 1.35's text", async () => {
  const system = createSystem({
    module: createModule("m", {
      schema: { facts: { n: t.number() } },
    } as never),
  } as never) as any;
  system.start();
  const z = createModule("z", {
    schema: { facts: { q: t.number() } },
  } as never);
  system.registerModule(z);
  await expect(system.unregisterModule(z)).rejects.toThrow(
    '[Directive] Cannot unregister module "z": no such module is registered.',
  );
  await system.unregisterModule("z");
  system.destroy();
});
