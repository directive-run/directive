// Ported from packages/core/src/core/__tests__/effect-readonly-facts-production.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { describe, expect, it, vi } from "vitest";

// Production build: the dev flag is the constant `false`.
vi.mock("#is-development", () => ({ default: false }));

const { createModule, createSystem, t } = await import("@directive-run/core");

describe("an effect writing a fact, in production", () => {
  it("is ignored without throwing", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let finished = false;
    const mod = createModule("m", {
      schema: { facts: { n: t.number(), pos: t.number() } },
      init: (facts) => {
        facts.n = 0;
        facts.pos = 0;
      },
      effects: {
        physics: {
          deps: ["n"],
          run: (facts) => {
            (facts as { pos: number }).pos = 99;
            finished = true;
          },
        },
      },
    });
    const system = createSystem({ module: mod });
    await system.start();
    system.facts.n = 1;
    await system.settle();

    expect(finished).toBe(true);
    expect(system.facts.pos).toBe(0);
    expect(errors).not.toHaveBeenCalled();

    await system.stop();
    errors.mockRestore();
  });

  it("still reports the dropped write to plugins", async () => {
    const blocked: Array<[string, string]> = [];
    const mod = createModule("m", {
      schema: { facts: { n: t.number(), pos: t.number() } },
      init: (facts) => {
        facts.n = 0;
        facts.pos = 0;
      },
      effects: {
        physics: {
          deps: ["n"],
          run: (facts) => {
            if (facts.n > 0) {
              (facts as { pos: number }).pos = 99;
            }
          },
        },
      },
    });
    const system = createSystem({
      module: mod,
      plugins: [
        {
          name: "watch",
          onEffectWriteBlocked: (id, key) => {
            blocked.push([id, key]);
          },
        },
      ],
    });
    await system.start();
    system.facts.n = 1;
    await system.settle();

    expect(blocked).toEqual([["physics", "pos"]]);

    await system.stop();
  });

  it("does not wrap nested values, so reads cost nothing extra", async () => {
    let seen: unknown = null;
    const pos = { x: 0 };
    const mod = createModule("m", {
      schema: { facts: { n: t.number(), pos: t.object<{ x: number }>() } },
      init: (facts) => {
        facts.n = 0;
        facts.pos = pos;
      },
      effects: {
        view: {
          deps: ["n"],
          run: (facts) => {
            seen = facts.pos;
          },
        },
      },
    });
    const system = createSystem({ module: mod });
    await system.start();
    await system.settle();

    expect(seen).toBe(pos);

    await system.stop();
  });
});
