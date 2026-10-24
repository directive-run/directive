// Ported from packages/core/src/core/__tests__/l3-system-oracle.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Black-box tests for what createSystem does around the engine: argument
// checks, module ordering, the tick interval, SSR initial facts, the status
// properties, zeroConfig and the development-only diagnostics. Public API
// only; no message text and no Proxy trap results. A warning is asserted by
// whether it fires, never by what it says.

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const dep = {
  facts: { count: { _type: 0 } },
  derivations: {},
  events: {},
  requirements: {},
};

/** A module with one numeric fact; `inc` always, `tick` on request. */
function counter(
  id: string,
  opts: {
    tick?: boolean;
    deps?: Record<string, unknown>;
    onInit?: () => void;
  } = {},
) {
  return createModule(id, {
    schema: {
      facts: { count: t.number() },
      derivations: {},
      events: { inc: {}, ...(opts.tick ? { tick: {} } : {}) },
      requirements: {},
    },
    init: (facts: any) => {
      opts.onInit?.();
      facts.count = 0;
    },
    events: {
      inc: (facts: any) => {
        facts.count += 1;
      },
      ...(opts.tick
        ? {
            tick: (facts: any) => {
              facts.count += 1;
            },
          }
        : {}),
    },
    ...(opts.deps ? { crossModuleDeps: opts.deps } : {}),
  } as never);
}

function quietWarn() {
  return vi.spyOn(console, "warn").mockImplementation(() => {});
}

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }

  return undefined;
}

describe("createSystem refuses options that cannot build a system", () => {
  it.each([
    ["nothing at all", undefined],
    ["null", null],
    ["an empty object", {}],
    ["options naming neither module nor modules", { plugins: [] }],
  ])("%s: an Error of the library's own, not a runtime TypeError", (_, bad) => {
    const error = thrownBy(() => createSystem(bad as never));

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TypeError);
  });

  it.each([undefined, null])(
    "a module that is %s is refused the same way",
    (bad) => {
      const error = thrownBy(() => createSystem({ module: bad } as never));

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(TypeError);
    },
  );

  it("a lone module definition passed as modules is refused, not run", () => {
    const error = thrownBy(() =>
      createSystem({ modules: counter("solo") } as never),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TypeError);
  });

  it.each(["id", "schema"])(
    "a module may be registered under the namespace %s",
    (namespace) => {
      const system = createSystem({
        modules: { [namespace]: counter(`as-${namespace}`) },
      } as never) as any;
      system.start();

      expect(system.facts[namespace].count).toBe(0);

      system.destroy();
    },
  );
});

describe("module initialization order", () => {
  function pair(order: string[]) {
    return {
      dependent: counter("dependent", {
        deps: { base: dep },
        onInit: () => order.push("dependent"),
      }),
      base: counter("base", { onInit: () => order.push("base") }),
    };
  }

  it("follows crossModuleDeps by default", () => {
    const order: string[] = [];
    const system = createSystem({ modules: pair(order) } as never);
    system.start();

    expect(order).toEqual(["base", "dependent"]);

    system.destroy();
  });

  it('"declaration" follows the order the modules were written in', () => {
    const order: string[] = [];
    const system = createSystem({
      modules: pair(order),
      initOrder: "declaration",
    } as never);
    system.start();

    expect(order).toEqual(["dependent", "base"]);

    system.destroy();
  });

  it("a dependency on a module that does not exist is ignored when ordering, whatever its name", () => {
    quietWarn();
    for (const ghost of ["ghost", "toString", "hasOwnProperty"]) {
      const order: string[] = [];
      const system = createSystem({
        modules: {
          lonely: counter("lonely", {
            deps: { [ghost]: dep },
            onInit: () => order.push("lonely"),
          }),
        },
      } as never);
      system.start();

      expect(order).toEqual(["lonely"]);

      system.destroy();
    }
  });
});

describe("tickMs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it.each([
    ["single", (extra: object) => ({ module: counter("c"), ...extra })],
    [
      "namespaced",
      (extra: object) => ({ modules: { c: counter("c") }, ...extra }),
    ],
  ])(
    "%s: zero and negative values are refused, positive and absent ones are not",
    (_, options) => {
      quietWarn();

      expect(() => createSystem(options({ tickMs: 0 }) as never)).toThrow();
      expect(() => createSystem(options({ tickMs: -1 }) as never)).toThrow();
      expect(() =>
        createSystem(options({ tickMs: 50 }) as never),
      ).not.toThrow();
      expect(() =>
        createSystem(options({ tickMs: undefined }) as never),
      ).not.toThrow();
    },
  );

  it("single: dispatches tick every tickMs once started, and stops with the system", () => {
    const system = createSystem({
      module: counter("c", { tick: true }),
      tickMs: 100,
    } as never) as any;

    system.start();
    expect(system.facts.count).toBe(0);
    vi.advanceTimersByTime(99);
    expect(system.facts.count).toBe(0);
    vi.advanceTimersByTime(1);
    expect(system.facts.count).toBe(1);
    vi.advanceTimersByTime(200);
    expect(system.facts.count).toBe(3);

    system.stop();
    vi.advanceTimersByTime(500);
    expect(system.facts.count).toBe(3);

    system.destroy();
  });

  it("namespaced: tick goes to the first module that has one, not to the others", () => {
    const system = createSystem({
      modules: {
        quiet: counter("quiet"),
        first: counter("first", { tick: true }),
        second: counter("second", { tick: true }),
      },
      tickMs: 100,
    } as never) as any;
    system.start();
    vi.advanceTimersByTime(300);

    expect(system.facts.first.count).toBe(3);
    expect(system.facts.second.count).toBe(0);
    expect(system.facts.quiet.count).toBe(0);

    system.stop();
    vi.advanceTimersByTime(300);
    expect(system.facts.first.count).toBe(3);

    system.destroy();
  });

  it("destroy() ends the tick as stop() does", () => {
    const single = createSystem({
      module: counter("c", { tick: true }),
      tickMs: 100,
    } as never) as any;
    const named = createSystem({
      modules: { c: counter("c", { tick: true }) },
      tickMs: 100,
    } as never) as any;
    single.start();
    named.start();
    vi.advanceTimersByTime(100);
    single.destroy();
    named.destroy();
    vi.advanceTimersByTime(1000);

    expect(vi.getTimerCount()).toBe(0);
  });

  it("without a tick event there is no interval to run", () => {
    quietWarn();
    const single = createSystem({ module: counter("c"), tickMs: 100 } as never);
    const named = createSystem({
      modules: { c: counter("c") },
      tickMs: 100,
    } as never);
    single.start();
    named.start();

    expect(vi.getTimerCount()).toBe(0);

    single.destroy();
    named.destroy();
  });

  it("warns, in development, that no tick handler exists: single", () => {
    const warn = quietWarn();
    createSystem({ module: counter("c"), tickMs: 100 } as never);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("is quiet when the module has a tick handler, or no tickMs is set: single", () => {
    const warn = quietWarn();
    createSystem({
      module: counter("c", { tick: true }),
      tickMs: 100,
    } as never);
    createSystem({ module: counter("c") } as never);

    expect(warn).not.toHaveBeenCalled();
  });

  it("warns, in development, that no tick handler exists: namespaced", () => {
    const warn = quietWarn();
    createSystem({
      modules: { a: counter("a"), b: counter("b") },
      tickMs: 100,
    } as never);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("is quiet when any one module has a tick handler, or no tickMs is set: namespaced", () => {
    const warn = quietWarn();
    createSystem({
      modules: { a: counter("a"), b: counter("b", { tick: true }) },
      tickMs: 100,
    } as never);
    createSystem({
      modules: { a: counter("a", { tick: true }), b: counter("b") },
      tickMs: 100,
    } as never);
    createSystem({ modules: { a: counter("a"), b: counter("b") } } as never);

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("crossModuleDeps diagnostics in development", () => {
  it("a dependency on a module that does not exist warns once; the system still runs", () => {
    const warn = quietWarn();
    const system = createSystem({
      modules: { a: counter("a", { deps: { ghost: dep } }) },
    } as never) as any;
    system.start();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(system.facts.a.count).toBe(0);

    system.destroy();
  });

  it("a module depending on itself warns once", () => {
    const warn = quietWarn();
    createSystem({
      modules: { a: counter("a", { deps: { a: dep } }) },
      initOrder: "declaration",
    } as never);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a dependency on a module that exists, or none at all, does not warn", () => {
    const warn = quietWarn();
    createSystem({
      modules: {
        base: counter("base"),
        user: counter("user", { deps: { base: dep } }),
        plain: counter("plain"),
      },
    } as never);

    expect(warn).not.toHaveBeenCalled();
  });

  it("single module: declared crossModuleDeps are ignored, with a warning", () => {
    const warn = quietWarn();
    const system = createSystem({
      module: counter("c", { deps: { other: dep } }),
      initialFacts: { count: 5 },
    } as never) as any;
    system.start();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(system.facts.count).toBe(5);

    system.destroy();
  });

  it("single module: none declared, or an empty set, is quiet", () => {
    const warn = quietWarn();
    createSystem({ module: counter("c") } as never);
    createSystem({ module: counter("c", { deps: {} }) } as never);

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("initialFacts in a namespaced system", () => {
  it("applies each known namespace's facts at start", () => {
    const system = createSystem({
      modules: { a: counter("a"), b: counter("b") },
      initialFacts: { a: { count: 5 }, b: { count: 7 } },
    } as never) as any;

    expect(system.facts.a.count).toBeUndefined();
    system.start();

    expect(system.facts.a.count).toBe(5);
    expect(system.facts.b.count).toBe(7);

    system.destroy();
  });

  it("ignores a namespace the system does not have, with a warning in development", () => {
    const warn = quietWarn();
    const system = createSystem({
      modules: { a: counter("a") },
      initialFacts: { ghost: { count: 9 }, a: { count: 5 } },
    } as never) as any;
    system.start();

    expect(system.facts.a.count).toBe(5);
    expect(system.facts.ghost).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);

    system.destroy();
  });

  it("ignores a blocked namespace name such as __proto__, with a warning in development", () => {
    const warn = quietWarn();
    const system = createSystem({
      modules: { a: counter("a") },
      initialFacts: JSON.parse('{"__proto__":{"count":1},"a":{"count":5}}'),
    } as never) as any;
    system.start();

    expect(system.facts.a.count).toBe(5);
    expect(({} as any).count).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);

    system.destroy();
  });

  it("refuses facts carrying a prototype-pollution key when the system starts", () => {
    const system = createSystem({
      modules: { a: counter("a") },
      initialFacts: {
        a: JSON.parse('{"count":3,"__proto__":{"polluted":true}}'),
      },
    } as never);

    expect(() => system.start()).toThrow();
    expect(({} as any).polluted).toBeUndefined();
  });

  it("a known namespace with no facts changes nothing", () => {
    const system = createSystem({
      modules: { a: counter("a") },
      initialFacts: { a: {} },
    } as never) as any;
    system.start();

    expect(system.facts.a.count).toBe(0);

    system.destroy();
  });
});

describe("subscribing to a whole module", () => {
  function linked() {
    const a = createModule("a", {
      schema: {
        facts: { x: t.number() },
        derivations: { sum: t.number() },
        events: {},
        requirements: {},
      },
      crossModuleDeps: {
        b: {
          facts: { y: { _type: 0 } },
          derivations: {},
          events: {},
          requirements: {},
        },
      },
      init: (facts: any) => {
        facts.x = 1;
      },
      derive: {
        sum: (facts: any) => facts.self.x + (facts.b?.y ?? 0),
      },
    } as never);
    const b = createModule("b", {
      schema: {
        facts: { y: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts: any) => {
        facts.y = 10;
      },
    } as never);
    const system = createSystem({ modules: { a, b } } as never) as any;
    system.start();

    return system;
  }

  it("subscribeModule hears a derivation of the module that changed through another module's fact", async () => {
    const system = linked();
    const heard = vi.fn();
    system.subscribeModule("a", heard);

    system.facts.b.y = 20;
    await system.settle();

    expect(system.derive.a.sum).toBe(21);
    expect(heard).toHaveBeenCalled();

    system.destroy();
  });

  it('"module.*" hears the same, and its own facts too', async () => {
    const system = linked();
    const heard = vi.fn();
    system.subscribe(["a.*"], heard);

    system.facts.b.y = 20;
    await system.settle();
    expect(heard).toHaveBeenCalledTimes(1);

    system.facts.a.x = 2;
    await system.settle();
    expect(heard).toHaveBeenCalledTimes(2);

    system.destroy();
  });

  it("a namespace with nothing to watch, or none at all, gets a no-op unsubscribe and a warning", () => {
    const warn = quietWarn();
    const empty = createModule("empty", {
      schema: { facts: {}, derivations: {}, events: {}, requirements: {} },
    } as never);
    const system = createSystem({
      modules: { empty, a: counter("a") },
    } as never) as any;
    const heard = vi.fn();
    const unsubscribeEmpty = system.subscribeModule("empty", heard);
    const unsubscribeGhost = system.subscribeModule("ghost", heard);

    expect(typeof unsubscribeEmpty).toBe("function");
    expect(typeof unsubscribeGhost).toBe("function");
    expect(warn).toHaveBeenCalledTimes(2);
    expect(() => {
      unsubscribeEmpty();
      unsubscribeGhost();
    }).not.toThrow();
  });

  it("does not hear a module it did not subscribe to", async () => {
    const system = linked();
    const heard = vi.fn();
    system.subscribeModule("b", heard);

    system.facts.a.x = 5;
    await system.settle();

    expect(heard).not.toHaveBeenCalled();

    system.destroy();
  });
});

describe("the status properties", () => {
  const forms: [string, () => any][] = [
    ["single", () => createSystem({ module: counter("c") } as never)],
    [
      "namespaced",
      () => createSystem({ modules: { c: counter("c") } } as never),
    ],
  ];

  it.each(forms)("%s: enumerable, configurable accessors", (_, build) => {
    const system = build();

    for (const key of ["isRunning", "isSettled", "isInitialized", "isReady"]) {
      const descriptor = Object.getOwnPropertyDescriptor(system, key);

      expect(typeof descriptor?.get).toBe("function");
      expect(descriptor?.enumerable).toBe(true);
      expect(descriptor?.configurable).toBe(true);
      expect(Object.keys(system)).toContain(key);
    }

    system.destroy();
  });

  it.each(forms)("%s: follow the lifecycle", async (_, build) => {
    const system = build();

    expect(system.isRunning).toBe(false);
    expect(system.isInitialized).toBe(false);
    expect(system.isReady).toBe(false);

    system.start();
    await system.whenReady();
    await system.settle();

    expect(system.isRunning).toBe(true);
    expect(system.isInitialized).toBe(true);
    expect(system.isReady).toBe(true);
    expect(system.isSettled).toBe(true);

    system.stop();
    expect(system.isRunning).toBe(false);

    system.destroy();
  });
});

describe("a system that is never started", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "development");
  });

  const forms: [string, () => any][] = [
    ["single", () => createSystem({ module: counter("c") } as never)],
    [
      "namespaced",
      () => createSystem({ modules: { c: counter("c") } } as never),
    ],
  ];

  it.each(forms)("%s: is reported once, in development", (_, build) => {
    const warn = quietWarn();
    const system = build();

    expect(warn).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    expect(warn).toHaveBeenCalledTimes(1);

    system.destroy();
  });

  it.each(forms)("%s: is not reported once started", (_, build) => {
    const warn = quietWarn();
    const system = build();
    system.start();
    vi.runOnlyPendingTimers();

    expect(warn).not.toHaveBeenCalled();

    system.destroy();
  });

  it.each(forms)("%s: is not reported once initialized", (_, build) => {
    const warn = quietWarn();
    const system = build();
    system.initialize();
    vi.runOnlyPendingTimers();

    expect(warn).not.toHaveBeenCalled();

    system.destroy();
  });

  it.each(forms)("%s: is not reported under NODE_ENV=test", (_, build) => {
    vi.stubEnv("NODE_ENV", "test");
    const warn = quietWarn();
    const system = build();
    vi.runOnlyPendingTimers();

    expect(warn).not.toHaveBeenCalled();

    system.destroy();
  });

  it.each(forms)("%s: is reported where there is no process", (_, build) => {
    const warn = quietWarn();
    vi.stubGlobal("process", undefined);
    let system: any;
    try {
      system = build();
    } finally {
      vi.unstubAllGlobals();
    }
    vi.runOnlyPendingTimers();

    expect(warn).toHaveBeenCalledTimes(1);

    system.destroy();
  });
});

describe("a system that is never started, where process has no env", () => {
  it.each([
    ["single", () => createSystem({ module: counter("c") } as never)],
    [
      "namespaced",
      () => createSystem({ modules: { c: counter("c") } } as never),
    ],
  ] as [string, () => any][])("%s: is still reported", (_, build) => {
    vi.useFakeTimers();
    const warn = quietWarn();
    vi.stubGlobal("process", {});
    let system: any;
    try {
      system = build();
    } finally {
      vi.unstubAllGlobals();
    }
    vi.runOnlyPendingTimers();

    expect(warn).toHaveBeenCalledTimes(1);

    system.destroy();
  });
});

describe("zeroConfig", () => {
  function failing(options: object) {
    const recoveries: [string, string][] = [];
    const mod = createModule("boom", {
      schema: {
        facts: { n: t.number() },
        derivations: { bad: t.number() },
        events: {},
        requirements: { FIX: {} },
      },
      init: (facts: any) => {
        facts.n = 0;
      },
      derive: {
        bad: (facts: any) => {
          if (facts.n > 0) {
            throw new Error("derivation fails");
          }

          return 0;
        },
      },
      constraints: {
        broken: {
          when: () => {
            throw new Error("constraint fails");
          },
          require: { type: "NEVER" },
        },
        needs: { when: (facts: any) => facts.n >= 0, require: { type: "FIX" } },
      },
      resolvers: {
        fix: {
          requirement: "FIX",
          resolve: async () => {
            throw new Error("resolver fails");
          },
        },
      },
      effects: {
        eff: {
          run: () => {
            throw new Error("effect fails");
          },
        },
      },
    } as never);
    const system = createSystem({
      module: mod,
      plugins: [
        {
          name: "recoveries",
          onErrorRecovery: (error: any, strategy: string) => {
            recoveries.push([error.source, strategy]);
          },
        },
      ],
      ...options,
    } as never) as any;

    return { system, recoveries };
  }

  async function run(options: object) {
    const { system, recoveries } = failing(options);
    system.start();
    await system.settle();
    system.facts.n = 1;
    try {
      system.derive.bad;
    } catch {
      // A derivation that fails rethrows on read; the boundary has seen it.
    }
    await system.settle();
    system.destroy();

    return recoveries;
  }

  it("skips an error from each kind of source, without the unhandled-error warning", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = quietWarn();
    const recoveries = await run({ zeroConfig: true });

    for (const source of ["constraint", "resolver", "effect", "derivation"]) {
      expect(recoveries).toContainEqual([source, "skip"]);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("without zeroConfig the same errors skip too, but development says so once per source", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = quietWarn();
    const recoveries = await run({});

    for (const source of ["constraint", "resolver", "effect", "derivation"]) {
      expect(recoveries).toContainEqual([source, "skip"]);
    }
    expect(warn).toHaveBeenCalled();
  });

  it("an errorBoundary given alongside wins over the zeroConfig defaults", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    quietWarn();
    const recoveries = await run({
      zeroConfig: true,
      errorBoundary: { onResolverError: "disable" },
    });

    expect(recoveries).toContainEqual(["resolver", "disable"]);
    expect(recoveries).toContainEqual(["constraint", "skip"]);
  });
});
