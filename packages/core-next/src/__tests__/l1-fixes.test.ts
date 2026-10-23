import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../index.js";

afterEach(() => vi.restoreAllMocks());

describe("L1 fixes", () => {
  it("throws on a dangerous key in a module's events", () => {
    const events = Object.create(null);
    events.constructor = () => {};
    const mod = createModule("bad", {
      schema: {
        facts: { x: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      events,
    } as any);

    expect(() => createSystem({ module: mod })).toThrow("dangerous key");
  });

  it("warns when a fact and a derivation share a name", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = createModule("c", {
      schema: {
        facts: { shared: t.number() },
        derivations: { shared: t.number() },
        events: {},
        requirements: {},
      },
      derive: { shared: (f: any) => f.shared + 1 },
    } as any);
    createSystem({ module: mod });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("exists as both a fact and a derivation"),
    );
  });

  it("_mode is single for module:", () => {
    const mod = createModule("m", {
      schema: {
        facts: { x: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
    } as any);

    expect((createSystem({ module: mod }) as any)._mode).toBe("single");
  });
});
