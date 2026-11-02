/**
 * P3-F3 in development: what 2.0 has not built says so. An option for an
 * unbuilt feature warns once per system, naming the feature and its layer,
 * and the system runs as 1.35 does with the option off; a member 1.35 always
 * provides throws `featureMissing` (code E_FEATURE_MISSING); a `/plugins` or
 * `/testing` export not built yet is a stub that throws when called; a plugin
 * entry that is not a plugin object is a clear error. Codes are asserted,
 * not wording.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule } from "../api/core.js";
import { FEATURE_MISSING } from "../api/missing.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";
import * as plugins from "../plugins/index.js";
import * as testing from "../utils/testing.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const mod = (extra: Record<string, unknown> = {}) =>
  createModule("m", {
    schema: { facts: { n: t.number() }, derivations: {}, events: {} },
    init: (f: any) => {
      f.n = 0;
    },
    ...extra,
  } as any);

const build = (options: Record<string, unknown> = {}, form = "single"): any =>
  form === "single"
    ? createSystem({ module: mod(), ...options } as any)
    : createSystem({ modules: { m: mod() }, ...options } as any);

/** The console.warn calls that are this slice's option warning. */
const optionWarnings = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls
    .map((args) => String(args[0]))
    .filter((text) => text.includes("not in 2.0.0-alpha yet"));

/** Calls `fn` and returns what it threw. */
const thrown = (fn: () => unknown): any => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
};

describe.each(["single", "namespaced"])("%s system", (form) => {
  it("the history and trace options each warn once, naming the feature and its layer", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = build({ history: { maxSnapshots: 10 }, trace: true }, form);
    const warnings = optionWarnings(warn);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/`history`.*layer 8/);
    expect(warnings[1]).toMatch(/`trace`.*layer 9/);
    // Once per system: running it warns no more.
    system.start();
    system.stop();
    expect(optionWarnings(warn)).toHaveLength(2);
    system.destroy();
  });

  it("no option, or an option turned off, warns nothing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    build({}, form).destroy();
    build({ history: false, trace: false }, form).destroy();
    expect(optionWarnings(warn)).toHaveLength(0);
  });

  it("with the options set, the system runs as 1.35 does with them off", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const options of [{}, { history: true, trace: true }]) {
      const system = build(options, form);
      // 1.35: history is null and trace is null without the option
      // (engine.ts:2605); onHistoryChange subscribes and never fires.
      expect(system.history).toBeNull();
      expect(system.trace).toBeNull();
      const listener = vi.fn();
      const off = system.onHistoryChange(listener);
      system.start();
      (form === "single" ? system.facts : system.facts.m).n = 1;
      expect(typeof off).toBe("function");
      off();
      expect(listener).not.toHaveBeenCalled();
      system.destroy();
    }
  });

  it("an unbuilt member throws featureMissing with its code, feature and layer", () => {
    const system = build({}, form);
    const cases: [() => unknown, string, number][] = [
      [() => system.registerModule(mod()), "registerModule", 10],
      [() => system.unregisterModule("m"), "unregisterModule", 10],
      [() => system.constraints.register("c", {}), "constraints.register", 10],
      [() => system.resolvers.assign("r", {}), "resolvers.assign", 10],
      [() => system.effects.call("e"), "effects.call", 10],
      [() => system.effects.listDynamic(), "effects.listDynamic", 10],
      [() => system.meta.fact("n"), "meta.fact", 9],
      [() => system.meta.byTag("pii"), "meta.byTag", 9],
      [() => system.getDistributableSnapshot(), "getDistributableSnapshot", 12],
      [
        () => system.watchDistributableSnapshot({}, () => {}),
        "watchDistributableSnapshot",
        12,
      ],
    ];
    for (const [call, feature, layer] of cases) {
      const error = thrown(call);
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({ code: FEATURE_MISSING, feature, layer });
      expect(error.message).toContain(feature);
    }
    system.destroy();
  });
});

describe("built members are left alone", () => {
  it("constraints, effects and explain keep their built behaviour", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const system: any = createSystem({
      module: mod({
        constraints: {
          c: { when: () => false, require: { type: "R" } },
        },
        resolvers: { r: { requirement: "R", resolve: async () => {} } },
        effects: { e: { run: () => {} } },
      }),
    } as any);
    system.start();
    system.constraints.disable("c");
    expect(system.constraints.isDisabled("c")).toBe(true);
    system.constraints.enable("c");
    expect(system.constraints.isDisabled("c")).toBe(false);
    system.effects.disable("e");
    expect(system.effects.isEnabled("e")).toBe(false);
    expect(system.explain("nothing")).toBeNull();
    expect(typeof system.restore).toBe("function");
    expect(optionWarnings(warn)).toHaveLength(0);
    // The dynamic controls sit beside the built ones.
    expect(thrown(() => system.constraints.register("x", {})).code).toBe(
      FEATURE_MISSING,
    );
    system.destroy();
  });
});

describe("stub exports", () => {
  it("every /plugins export 1.35 has is defined, and the unbuilt ones throw when called", () => {
    for (const name of [
      "clobberAlertPlugin",
      "clobberLoopPlugin",
      "createAgentMetrics",
      "createAuditLedger",
      "createCircuitBreaker",
      "createOTLPExporter",
      "createObservability",
      "devtoolsPlugin",
      "emitDevToolsEvent",
      "loggingPlugin",
      "memorySink",
      "normalizeTokenUsage",
      "performancePlugin",
    ]) {
      const stub = (plugins as Record<string, unknown>)[name];
      expect(typeof stub, name).toBe("function");
      const error = thrown(() => (stub as (...a: unknown[]) => unknown)({}));
      expect(error).toMatchObject({ code: FEATURE_MISSING, feature: name });
      expect(error.layer).toBe(12);
    }
    expect(thrown(() => new plugins.CircuitBreakerOpenError("b", 1)).code).toBe(
      FEATURE_MISSING,
    );
    // 1.35's constant, not a feature.
    expect(plugins.DEVTOOLS_EVENT_NAME).toBe("directive-devtools-event");
    // Built: the persistence plugin is a plugin, not a stub.
    expect(
      typeof plugins.persistencePlugin({ storage: {} as any, key: "k" }),
    ).toBe("object");
  });

  it("every /testing export 1.35 has is defined, and the unbuilt ones throw when called", async () => {
    for (const name of [
      "assertDynamic",
      "assertNotDynamic",
      "createCoverageTracker",
      "createFakeTimers",
      "createMockResolver",
      "createTestObserver",
      "createTestSystem",
      "flushAsync",
      "mockResolver",
      "settleWithFakeTimers",
    ]) {
      const stub = (testing as Record<string, unknown>)[name];
      expect(typeof stub, name).toBe("function");
      const error = thrown(() => (stub as (...a: unknown[]) => unknown)({}));
      expect(error).toMatchObject({
        code: FEATURE_MISSING,
        feature: name,
        layer: 13,
      });
    }
    // Built: flushMicrotasks still works.
    await expect(testing.flushMicrotasks()).resolves.toBeUndefined();
  });
});

describe("plugins: [undefined]", () => {
  it.each([undefined, null, 42, "logging"])(
    "a plugin entry %s is a clear error with code E_INVALID_PLUGIN",
    (entry) => {
      const error = thrown(() => build({ plugins: [entry] }));
      expect(error.code).toBe("E_INVALID_PLUGIN");
      expect(error.message).toContain(String(entry));
    },
  );

  it("a plugin object still registers", () => {
    const onStart = vi.fn();
    const system = build({ plugins: [{ name: "p", onStart }] });
    system.start();
    expect(onStart).toHaveBeenCalledTimes(1);
    system.destroy();
  });
});
