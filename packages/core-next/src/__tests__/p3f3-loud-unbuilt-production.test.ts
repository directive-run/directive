/**
 * P3-F3 in production: silent for options, codes not text for stubs.
 * - The trace option, built in L9b, warns nothing and makes `system.trace`
 *   the trace (null without it). The history option, built in L8, makes `system.history` the
 *   manager; with it off, history is null and onHistoryChange never fires.
 * - The unbuilt system members are left out (their names alone would put the
 *   minimal app past its 28,800 B ceiling): a call is the platform's
 *   TypeError, as before this slice.
 * - A `/plugins` or `/testing` stub throws E_FEATURE_MISSING with the code
 *   and the export's name as its message, none of the development text.
 * - `plugins: [undefined]` throws 1.35's production TypeError (reading
 *   'name'), not a mangled one at the first hook.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("#is-development", () => ({ default: false }));

const { createModule } = await import("../api/core.js");
const { FEATURE_MISSING } = await import("../api/missing.js");
const { t } = await import("../api/schema-builders.js");
const { createSystem } = await import("../api/system.js");
const plugins = await import("../plugins/index.js");
const testing = await import("../utils/testing.js");

afterEach(() => {
  vi.restoreAllMocks();
});

const mod = () =>
  createModule("m", {
    schema: { facts: { n: t.number() }, derivations: {}, events: {} },
    init: (f: any) => {
      f.n = 0;
    },
  } as any);

const thrown = (fn: () => unknown): any => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
};

describe.each(["single", "namespaced"])("production, %s system", (form) => {
  const build = (options: Record<string, unknown> = {}): any =>
    form === "single"
      ? createSystem({ module: mod(), ...options } as any)
      : createSystem({ modules: { m: mod() }, ...options } as any);

  it("the trace option warns nothing and turns the trace on; history off is null", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = build({ history: false, trace: true });
    system.start();
    expect(warn).not.toHaveBeenCalled();
    expect(system.history).toBeNull();
    expect(system.trace).toEqual([]);
    const listener = vi.fn();
    const off = system.onHistoryChange(listener);
    (form === "single" ? system.facts : system.facts.m).n = 1;
    off();
    expect(listener).not.toHaveBeenCalled();
    system.destroy();
  });

  it("with history set, system.history is the manager and nothing warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = build({ history: { maxSnapshots: 10 }, trace: true });
    system.start();
    expect(warn).not.toHaveBeenCalled();
    expect(system.history).not.toBeNull();
    expect(typeof system.history.goBack).toBe("function");
    expect(system.trace).toEqual([]);
    system.destroy();
  });

  it("no member is left unbuilt: L12a built the distributable snapshot calls", () => {
    const system = build();
    // L10b built registerModule and unregisterModule.
    expect(typeof system.getDistributableSnapshot()).toBe("object");
    expect(typeof system.watchDistributableSnapshot({}, () => {})).toBe(
      "function",
    );
    system.destroy();
  });
});

describe("production stub exports", () => {
  it("throw E_FEATURE_MISSING with the code and the name, no development text", () => {
    for (const [stub, name, layer] of [
      [plugins.devtoolsPlugin, "devtoolsPlugin", 12],
      [plugins.createAuditLedger, "createAuditLedger", 12],
      [testing.createTestSystem, "createTestSystem", 13],
      [testing.mockResolver, "mockResolver", 13],
    ] as const) {
      const error = thrown(() => (stub as (...a: unknown[]) => unknown)({}));
      expect(error).toMatchObject({
        code: FEATURE_MISSING,
        feature: name,
        layer,
      });
      expect(error.message).toBe(`[Directive] ${FEATURE_MISSING} ${name}`);
      expect(error.message).not.toContain("2.0.0-alpha");
    }
  });
});

describe("production plugins: [undefined]", () => {
  it("throws 1.35's TypeError, reading 'name'", () => {
    const error = thrown(() =>
      createSystem({ module: mod(), plugins: [undefined] } as any),
    );
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toContain("reading 'name'");
    expect(error.code).toBeUndefined();
  });
});
