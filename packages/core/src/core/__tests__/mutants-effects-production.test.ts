import { describe, expect, it, vi } from "vitest";

// Production build: the dev flag is the constant `false`.
vi.mock("#is-development", () => ({ default: false }));

const { t } = await import("../../index.js");
const internals = await import("../../internals.js");
const { createEffectsManager, createFacts } = internals;

const schema = {
  count: t.number(),
  obj: t.object<{ x: number }>(),
};

function setup(
  definitions: Record<string, any>,
  options: Record<string, unknown> = {},
) {
  const { store, facts } = createFacts({ schema });
  facts.count = 0;
  facts.obj = { x: 1 };
  const manager = createEffectsManager({
    definitions: definitions as never,
    facts: facts as never,
    store: store as never,
    ...options,
  } as never);

  return { store, facts, manager };
}

describe("effects in production", () => {
  it("drops a write to facts, reports it, and does not throw", async () => {
    const onWriteBlocked = vi.fn();
    const onError = vi.fn();
    const { facts, manager } = setup(
      {
        e: {
          deps: ["count"],
          run: (f: any) => {
            f.count = 99;
            f.$store.set("count", 98);
            f.$store.delete("count");
          },
        },
      },
      { onWriteBlocked, onError },
    );
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));

    expect(onError).not.toHaveBeenCalled();
    expect(facts.count).toBe(1);
    expect(onWriteBlocked).toHaveBeenCalledWith("e", "count");
    expect(onWriteBlocked).toHaveBeenCalledTimes(3);
  });

  it("drops a write quietly when nobody is listening", async () => {
    const onError = vi.fn();
    const { facts, manager } = setup(
      {
        e: {
          deps: ["count"],
          run: (f: any) => {
            f.count = 99;
          },
        },
      },
      { onError },
    );
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));

    expect(onError).not.toHaveBeenCalled();
    expect(facts.count).toBe(1);
  });

  it("does not check for an in-place mutation, sync, async or via callOne", async () => {
    const onError = vi.fn();
    const onWriteBlocked = vi.fn();
    const { facts, manager } = setup(
      {
        sync: {
          deps: ["count"],
          run: (f: any) => {
            f.obj.x = 2;
          },
        },
        asynch: {
          deps: ["count"],
          run: async (f: any) => {
            await Promise.resolve();
            f.obj.x = 3;
          },
        },
        auto: {
          run: (f: any) => {
            void f.count;
            f.obj.x = 4;
          },
        },
      },
      { onError, onWriteBlocked },
    );
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));
    await manager.callOne("sync");
    await manager.callOne("asynch");

    expect(onError).not.toHaveBeenCalled();
    expect(onWriteBlocked).not.toHaveBeenCalled();
    expect(facts.obj.x).toBe(3);
  });

  it("hands prevFacts and derived through untouched", async () => {
    const derived = { total: 5 };
    const seen: unknown[] = [];
    const onError = vi.fn();
    const { facts, manager } = setup(
      {
        e: {
          run: (_f: unknown, prev: any, d: unknown) => {
            seen.push(prev === null ? null : prev.count, d);
            if (prev !== null) {
              prev.count = 123;
            }
          },
        },
      },
      { derived, onError },
    );
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));
    facts.count = 2;
    await manager.runEffects(new Set(["count"]));

    expect(onError).not.toHaveBeenCalled();
    expect(seen).toEqual([null, derived, 1, derived]);
    expect(seen[1]).toBe(derived);
  });

  it("does not warn about an async effect that read nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { manager } = setup({
      e: {
        run: async () => {
          await Promise.resolve();
        },
      },
    });
    await manager.runEffects(new Set(["count"]));

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
