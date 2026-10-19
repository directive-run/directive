import { describe, expect, it, vi } from "vitest";

// Production build: the dev flag is the constant `false`.
vi.mock("#is-development", () => ({ default: false }));

const { t } = await import("../../index.js");
const internals = await import("../../internals.js");
const { createFacts, createFactsStore } = internals;

describe("the facts store in production", () => {
  it("does not validate, even when asked to", () => {
    const store = createFactsStore({
      schema: { n: t.number() },
      validate: true,
      strictKeys: true,
    });

    expect(() => store.set("n", "not a number" as never)).not.toThrow();
    expect(() => store.set("zzz" as never, 1 as never)).not.toThrow();
    expect(store.get("n")).toBe("not a number");
  });

  it("defaults to no validation and no unknown-key warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = createFactsStore({ schema: { n: t.number() } });

    expect(() => store.set("n", "x" as never)).not.toThrow();
    expect(() => store.set("zzz" as never, 1 as never)).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("neither warns about non-JSON values nor wraps nested objects", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { facts } = createFacts({
      schema: { d: t.object<unknown>(), o: t.object<{ x: number }>() },
    });
    const f = facts as unknown as { d: unknown; o: { x: number } };
    const original = { x: 1 };

    f.d = new Date(1);
    f.o = original;
    f.o.x = 2;

    expect(warn).not.toHaveBeenCalled();
    expect(f.o).toBe(original);
    warn.mockRestore();
  });
});
