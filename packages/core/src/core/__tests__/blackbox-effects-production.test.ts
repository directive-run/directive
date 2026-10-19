import { describe, expect, it, vi } from "vitest";

// Production build: the dev flag is the constant `false`.
vi.mock("#is-development", () => ({ default: false }));

const { createModule, createSystem, t } = await import("../../index.js");

const schema = {
  facts: {
    count: t.number(),
    name: t.string(),
    obj: t.object<{ x: number }>(),
  },
  derivations: { doubled: t.number() },
};

function build(effects: Record<string, unknown>) {
  const errors: Array<[string, unknown]> = [];
  const blocked: Array<[string, string]> = [];
  const mod = createModule("m", {
    schema,
    init: (facts: any) => {
      facts.count = 0;
      facts.name = "alice";
      facts.obj = { x: 1 };
    },
    derive: { doubled: (facts) => facts.count * 2 },
    effects: effects as never,
  });
  const system = createSystem({
    module: mod,
    plugins: [
      {
        name: "spy",
        onEffectError: (id: string, error: unknown) => {
          errors.push([id, error]);
        },
        onEffectWriteBlocked: (id: string, key: string) => {
          blocked.push([id, key]);
        },
      },
    ],
  } as never);

  return { system: system as any, errors, blocked };
}

describe("effects in production", () => {
  it("drops a write to facts, reports it to plugins, and does not throw", async () => {
    const { system, errors, blocked } = build({
      w: {
        deps: ["count"],
        run: (facts: any) => {
          facts.name = "mallory";
          facts.$store.set("name", "mallory");
          facts.$store.delete("name");
        },
      },
    });
    await system.start();

    expect(errors).toEqual([]);
    expect(system.facts.name).toBe("alice");
    expect(blocked).toEqual([
      ["w", "name"],
      ["w", "name"],
      ["w", "name"],
    ]);
    await system.destroy();
  });

  it("drops a write quietly when nobody is listening", async () => {
    const mod = createModule("m", {
      schema,
      init: (facts: any) => {
        facts.count = 0;
        facts.name = "alice";
      },
      effects: {
        w: {
          deps: ["count"],
          run: (facts: any) => {
            facts.name = "mallory";
          },
        },
      },
    } as never);
    const system = createSystem({ module: mod }) as any;
    await system.start();

    expect(system.facts.name).toBe("alice");
    await system.destroy();
  });

  it("does not check for an in-place mutation, sync, async or via call()", async () => {
    const { system, errors, blocked } = build({
      s: {
        deps: ["count"],
        run: (facts: any) => {
          facts.obj.x = 5;
        },
      },
      a: {
        deps: ["count"],
        run: async (facts: any) => {
          await Promise.resolve();
          facts.obj.x = 6;
        },
      },
      t: {
        run: (facts: any) => {
          void facts.count;
          facts.obj.x = 7;
        },
      },
    });
    await system.start();
    system.facts.count = 1;
    await system.settle();
    await system.effects.call("s");

    expect(errors).toEqual([]);
    expect(blocked).toEqual([]);
    await system.destroy();
  });

  it("hands prev and derived through untouched", async () => {
    const seen: any[] = [];
    const { system, errors } = build({
      r: {
        deps: ["count"],
        run: (_facts: any, prev: any, derived: any) => {
          seen.push([prev ? prev.count : null, derived.doubled]);
        },
      },
    });
    await system.start();
    system.facts.count = 2;
    await system.settle();

    expect(errors).toEqual([]);
    expect(seen).toEqual([
      [null, 0],
      [0, 4],
    ]);
    await system.destroy();
  });

  it("does not warn about an async effect that read nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { system } = build({
      e: {
        run: async () => {
          await Promise.resolve();
        },
      },
    });
    await system.start();
    system.facts.count = 1;
    await system.settle();

    expect(
      warn.mock.calls.filter((call) =>
        /no dependencies/i.test(String(call[0])),
      ),
    ).toEqual([]);
    warn.mockRestore();
    await system.destroy();
  });

  it("a retried failing effect does not warn when the retries run out", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let runs = 0;
    const mod = createModule("m", {
      schema,
      init: (facts: any) => {
        facts.count = 0;
      },
      effects: {
        e: {
          deps: ["count"],
          run: (facts: any) => {
            if (facts.count === 0) {
              return;
            }
            runs++;
            throw new Error("always");
          },
        },
      },
    } as never);
    const system = createSystem({
      module: mod,
      errorBoundary: { onEffectError: "retry" },
    } as never) as any;
    await system.start();
    system.facts.count = 1;
    for (let i = 0; i < 10; i++) {
      await system.settle();
      await Promise.resolve();
    }

    expect(runs).toBeGreaterThan(1);
    expect(runs).toBeLessThanOrEqual(4);
    expect(
      warn.mock.calls.filter((call) => /retr/i.test(String(call[0]))),
    ).toEqual([]);
    await system.destroy();
  });
});
