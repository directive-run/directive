import { afterEach, expect, it, vi } from "vitest";

// L3b, E10 in production: a constraint or effect that throws under "throw"
// stops the pass, and nothing is logged (1.35's catch logs in development
// only). The write still returns and settle() still resolves.
vi.mock("#is-development", () => ({ default: false }));

const { createModule } = await import("../api/core.js");
const { t } = await import("../api/schema-builders.js");
const { createSystem } = await import("../api/system.js");

afterEach(() => {
  vi.restoreAllMocks();
});

it.each(["constraint", "effect"] as const)(
  'production: a %s that throws under "throw" logs nothing and reaches no host',
  async (src) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const recovery: string[] = [];
    const mod = createModule("m", {
      schema: { facts: { x: t.number() }, requirements: { GO: {} } },
      init: (f: any) => {
        f.x = 0;
      },
      constraints: {
        c: {
          when: (f: any) => {
            if (src === "constraint" && f.x > 0) {
              throw new Error("cboom");
            }

            return false;
          },
          require: { type: "GO" },
        },
      },
      effects: {
        e: {
          run: (f: any) => {
            if (src === "effect" && f.x > 0) {
              throw new Error("eboom");
            }
          },
        },
      },
    } as never);
    const sys: any = createSystem({
      module: mod,
      errorBoundary: {
        [src === "constraint" ? "onConstraintError" : "onEffectError"]: "throw",
      },
      plugins: [
        {
          name: "p",
          onErrorRecovery: (_e: unknown, s: string) => recovery.push(s),
        },
      ],
    } as never);
    sys.start();
    await sys.settle();
    sys.facts.x = 1;
    await expect(sys.settle()).resolves.toBeUndefined();

    expect(recovery).toEqual(["throw"]);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    sys.destroy();
  },
);
