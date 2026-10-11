import { describe, expect, it, vi } from "vitest";

// Production build: the dev flag is the constant `false`.
vi.mock("#is-development", () => ({ default: false }));

const { createModule, createSystem, t } = await import("../../index.js");

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
});
