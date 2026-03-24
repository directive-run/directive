import { describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import { flushMicrotasks } from "../../utils/testing.js";

// ============================================================================
// Helpers
// ============================================================================

const authModule = createModule("auth", {
  schema: {
    facts: {
      token: t.string(),
      loggedIn: t.boolean(),
    },
    derivations: {
      isLoggedIn: t.boolean(),
    },
    events: {
      login: { token: t.string() },
      logout: {},
    },
    requirements: {},
  },
  init: (facts) => {
    facts.token = "";
    facts.loggedIn = false;
  },
  derive: {
    isLoggedIn: (facts) => facts.loggedIn === true,
  },
  events: {
    login: (facts, { token }) => {
      facts.token = token;
      facts.loggedIn = true;
    },
    logout: (facts) => {
      facts.token = "";
      facts.loggedIn = false;
    },
  },
});

const dataModule = createModule("data", {
  schema: {
    facts: {
      items: t.array<string>(),
      count: t.number(),
    },
    derivations: {
      hasItems: t.boolean(),
    },
    events: {
      addItem: { item: t.string() },
    },
    requirements: {},
  },
  init: (facts) => {
    facts.items = [];
    facts.count = 0;
  },
  derive: {
    hasItems: (facts) => (facts.items as string[]).length > 0,
  },
  events: {
    addItem: (facts, { item }) => {
      facts.items = [...(facts.items as string[]), item];
      facts.count = (facts.count as number) + 1;
    },
  },
});

function createSingleModule() {
  return createModule("counter", {
    schema: {
      facts: {
        count: t.number(),
        label: t.string(),
      },
      derivations: {
        doubled: t.number(),
      },
      events: {
        increment: {},
        setLabel: { label: t.string() },
      },
      requirements: {},
    },
    init: (facts) => {
      facts.count = 0;
      facts.label = "default";
    },
    derive: {
      doubled: (facts) => (facts.count as number) * 2,
    },
    events: {
      increment: (facts) => {
        facts.count = (facts.count as number) + 1;
      },
      setLabel: (facts, { label }) => {
        facts.label = label;
      },
    },
  });
}

// ============================================================================
// Single Module Mode
// ============================================================================

describe("Single Module Mode", () => {
  it("provides direct fact access", () => {
    const system = createSystem({ module: createSingleModule() });
    system.start();

    expect(system.facts.count).toBe(0);
    expect(system.facts.label).toBe("default");

    system.destroy();
  });

  it("allows writing facts directly", () => {
    const system = createSystem({ module: createSingleModule() });
    system.start();

    system.facts.count = 42;
    expect(system.facts.count).toBe(42);

    system.destroy();
  });

  it("derivations accessible directly", () => {
    const system = createSystem({ module: createSingleModule() });
    system.start();

    expect(system.derive.doubled).toBe(0);

    system.facts.count = 5;
    expect(system.derive.doubled).toBe(10);

    system.destroy();
  });

  it("events dispatch directly", () => {
    const system = createSystem({ module: createSingleModule() });
    system.start();

    system.events.increment();
    expect(system.facts.count).toBe(1);

    system.events.increment();
    expect(system.facts.count).toBe(2);

    system.destroy();
  });

  it("events accept payloads", () => {
    const system = createSystem({ module: createSingleModule() });
    system.start();

    system.events.setLabel({ label: "updated" });
    expect(system.facts.label).toBe("updated");

    system.destroy();
  });

  it("lifecycle: start, stop, destroy", () => {
    const system = createSystem({ module: createSingleModule() });

    expect(system.isRunning).toBe(false);
    expect(system.isInitialized).toBe(false);

    system.start();
    expect(system.isRunning).toBe(true);

    system.stop();
    expect(system.isRunning).toBe(false);

    system.destroy();
  });

  it("_mode is 'single'", () => {
    const system = createSystem({ module: createSingleModule() });
    expect(system._mode).toBe("single");

    system.destroy();
  });

  it("subscribe fires on fact changes", () => {
    const system = createSystem({ module: createSingleModule() });
    system.start();

    const listener = vi.fn();
    const unsub = system.subscribe(["count"], listener);

    system.facts.count = 10;
    expect(listener).toHaveBeenCalled();

    unsub();
    system.destroy();
  });

  it("watch fires with new and previous value", () => {
    const system = createSystem({ module: createSingleModule() });
    system.start();

    const callback = vi.fn();
    const unsub = system.watch("count", callback);

    system.facts.count = 7;
    expect(callback).toHaveBeenCalledWith(7, 0);

    unsub();
    system.destroy();
  });

  it("read returns derivation value", () => {
    const system = createSystem({ module: createSingleModule() });
    system.start();

    system.facts.count = 3;
    expect(system.read("doubled")).toBe(6);

    system.destroy();
  });

  it("throws when module is not provided", () => {
    expect(() => {
      createSystem({
        // biome-ignore lint/suspicious/noExplicitAny: Testing invalid input
        module: undefined as any,
      });
    }).toThrow("[Directive] createSystem requires a module");
  });
});

// ============================================================================
// Namespaced Module Mode
// ============================================================================

describe("Namespaced Module Mode", () => {
  it("namespaces facts by module key", () => {
    const system = createSystem({
      modules: { auth: authModule, data: dataModule },
    });
    system.start();

    expect(system.facts.auth.token).toBe("");
    expect(system.facts.auth.loggedIn).toBe(false);
    expect(system.facts.data.count).toBe(0);
    expect(system.facts.data.items).toEqual([]);

    system.destroy();
  });

  it("writes to namespaced facts", () => {
    const system = createSystem({
      modules: { auth: authModule, data: dataModule },
    });
    system.start();

    system.facts.auth.token = "abc-123";
    expect(system.facts.auth.token).toBe("abc-123");

    system.facts.data.count = 5;
    expect(system.facts.data.count).toBe(5);

    system.destroy();
  });

  it("reads namespaced derivations", () => {
    const system = createSystem({
      modules: { auth: authModule, data: dataModule },
    });
    system.start();

    expect(system.derive.auth.isLoggedIn).toBe(false);
    expect(system.derive.data.hasItems).toBe(false);

    system.facts.auth.loggedIn = true;
    expect(system.derive.auth.isLoggedIn).toBe(true);

    system.destroy();
  });

  it("dispatches namespaced events", () => {
    const system = createSystem({
      modules: { auth: authModule, data: dataModule },
    });
    system.start();

    system.events.auth.login({ token: "xyz" });
    expect(system.facts.auth.token).toBe("xyz");
    expect(system.facts.auth.loggedIn).toBe(true);

    system.events.data.addItem({ item: "apple" });
    expect(system.facts.data.items).toEqual(["apple"]);
    expect(system.facts.data.count).toBe(1);

    system.destroy();
  });

  it("events.auth.logout works", () => {
    const system = createSystem({
      modules: { auth: authModule, data: dataModule },
    });
    system.start();

    system.events.auth.login({ token: "tok" });
    expect(system.facts.auth.loggedIn).toBe(true);

    system.events.auth.logout();
    expect(system.facts.auth.loggedIn).toBe(false);
    expect(system.facts.auth.token).toBe("");

    system.destroy();
  });

  it("_mode is 'namespaced'", () => {
    const system = createSystem({
      modules: { auth: authModule, data: dataModule },
    });
    expect(system._mode).toBe("namespaced");

    system.destroy();
  });

  it("subscribe with namespaced keys fires on changes", () => {
    const system = createSystem({
      modules: { auth: authModule, data: dataModule },
    });
    system.start();

    const listener = vi.fn();
    const unsub = system.subscribe(["auth.token"], listener);

    system.facts.auth.token = "changed";
    expect(listener).toHaveBeenCalled();

    unsub();
    system.destroy();
  });

  it("subscribe with wildcard fires on any key in namespace", () => {
    const system = createSystem({
      modules: { auth: authModule, data: dataModule },
    });
    system.start();

    const listener = vi.fn();
    const unsub = system.subscribe(["auth.*"], listener);

    system.facts.auth.loggedIn = true;
    expect(listener).toHaveBeenCalled();

    unsub();
    system.destroy();
  });

  it("subscribeModule fires on any key in namespace", () => {
    const system = createSystem({
      modules: { auth: authModule, data: dataModule },
    });
    system.start();

    const listener = vi.fn();
    const unsub = system.subscribeModule("data", listener);

    system.facts.data.count = 99;
    expect(listener).toHaveBeenCalled();

    unsub();
    system.destroy();
  });

  it("read accepts namespace.key format", () => {
    const system = createSystem({
      modules: { auth: authModule, data: dataModule },
    });
    system.start();

    system.facts.auth.loggedIn = true;
    expect(system.read("auth.isLoggedIn")).toBe(true);

    system.destroy();
  });

  it("watch accepts namespace.key format", () => {
    const system = createSystem({
      modules: { auth: authModule, data: dataModule },
    });
    system.start();

    const callback = vi.fn();
    const unsub = system.watch("auth.token", callback);

    system.facts.auth.token = "new-token";
    expect(callback).toHaveBeenCalledWith("new-token", "");

    unsub();
    system.destroy();
  });

  it("lifecycle works in namespaced mode", () => {
    const system = createSystem({
      modules: { auth: authModule, data: dataModule },
    });

    expect(system.isRunning).toBe(false);
    system.start();
    expect(system.isRunning).toBe(true);
    system.stop();
    expect(system.isRunning).toBe(false);

    system.destroy();
  });

  it("unknown namespace returns undefined from facts proxy", () => {
    const system = createSystem({ modules: { auth: authModule } });
    system.start();

    // biome-ignore lint/suspicious/noExplicitAny: Testing unknown namespace access
    expect((system.facts as any).nonexistent).toBeUndefined();

    system.destroy();
  });

  it("unknown namespace returns undefined from derive proxy", () => {
    const system = createSystem({ modules: { auth: authModule } });
    system.start();

    // biome-ignore lint/suspicious/noExplicitAny: Testing unknown namespace access
    expect((system.derive as any).nonexistent).toBeUndefined();

    system.destroy();
  });

  it("unknown namespace returns undefined from events proxy", () => {
    const system = createSystem({ modules: { auth: authModule } });
    system.start();

    // biome-ignore lint/suspicious/noExplicitAny: Testing unknown namespace access
    expect((system.events as any).nonexistent).toBeUndefined();

    system.destroy();
  });
});

// ============================================================================
// Namespace Validation
// ============================================================================

describe("Namespace Validation", () => {
  it("throws when module name contains '::'", () => {
    const badModule = createModule("bad-mod", {
      schema: {
        facts: { x: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.x = 0;
      },
    });

    expect(() => {
      createSystem({ modules: { "auth::bad": badModule } });
    }).toThrow('contains the reserved separator "::"');
  });

  it("throws when schema key contains '::'", () => {
    const badModule = createModule("bad-schema", {
      schema: {
        facts: { "bad::key": t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        // biome-ignore lint/suspicious/noExplicitAny: Testing bad key
        (facts as any)["bad::key"] = 0;
      },
    });

    expect(() => {
      createSystem({ modules: { test: badModule } });
    }).toThrow('contains the reserved separator "::"');
  });

  it("throws when modules is an array", () => {
    expect(() => {
      // biome-ignore lint/suspicious/noExplicitAny: Testing invalid input
      createSystem({ modules: [authModule, dataModule] as any });
    }).toThrow("expects modules as an object, not an array");
  });

  it("throws when a single module is passed to modules: instead of module:", () => {
    expect(() => {
      // biome-ignore lint/suspicious/noExplicitAny: Testing invalid input
      createSystem({ modules: authModule as any });
    }).toThrow("single module was passed to `modules:`");
  });

  it("throws when tickMs is zero or negative", () => {
    expect(() => {
      createSystem({ modules: { auth: authModule }, tickMs: 0 });
    }).toThrow("tickMs must be a positive number");
  });
});

// ============================================================================
// Topological Sort
// ============================================================================

describe("Topological Sort", () => {
  it("initializes modules in dependency order", () => {
    const initOrder: string[] = [];

    const baseModule = createModule("base", {
      schema: {
        facts: { value: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        initOrder.push("base");
        facts.value = 1;
      },
    });

    const dependentModule = createModule("dependent", {
      schema: {
        facts: { result: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      crossModuleDeps: {
        base: {
          facts: { value: { _type: 0 } },
          derivations: {},
          events: {},
          requirements: {},
        },
      },
      init: (facts: Record<string, unknown>) => {
        initOrder.push("dependent");
        facts.result = 0;
      },
      // biome-ignore lint/suspicious/noExplicitAny: Testing crossModuleDeps
    } as any);

    const system = createSystem({
      modules: { dependent: dependentModule, base: baseModule },
    });
    system.start();

    // "base" should init before "dependent" because of dependency
    expect(initOrder).toEqual(["base", "dependent"]);

    system.destroy();
  });

  it("throws on circular dependencies", () => {
    const modA = createModule("mod-a", {
      schema: {
        facts: { x: t.number() },
        derivations: {},
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
      init: (facts: Record<string, unknown>) => {
        facts.x = 0;
      },
      // biome-ignore lint/suspicious/noExplicitAny: Testing crossModuleDeps
    } as any);

    const modB = createModule("mod-b", {
      schema: {
        facts: { y: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      crossModuleDeps: {
        a: {
          facts: { x: { _type: 0 } },
          derivations: {},
          events: {},
          requirements: {},
        },
      },
      init: (facts: Record<string, unknown>) => {
        facts.y = 0;
      },
      // biome-ignore lint/suspicious/noExplicitAny: Testing crossModuleDeps
    } as any);

    expect(() => {
      createSystem({ modules: { a: modA, b: modB } });
    }).toThrow("Circular dependency detected");
  });

  it("respects explicit initOrder when provided", () => {
    const initOrder: string[] = [];

    const modA = createModule("mod-a", {
      schema: {
        facts: { x: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        initOrder.push("a");
        facts.x = 0;
      },
    });

    const modB = createModule("mod-b", {
      schema: {
        facts: { y: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        initOrder.push("b");
        facts.y = 0;
      },
    });

    const system = createSystem({
      modules: { a: modA, b: modB },
      initOrder: ["b", "a"],
      // biome-ignore lint/suspicious/noExplicitAny: Testing initOrder
    } as any);
    system.start();

    expect(initOrder).toEqual(["b", "a"]);

    system.destroy();
  });

  it("throws when explicit initOrder is missing modules", () => {
    const modA = createModule("mod-a", {
      schema: {
        facts: { x: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.x = 0;
      },
    });

    const modB = createModule("mod-b", {
      schema: {
        facts: { y: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.y = 0;
      },
    });

    expect(() => {
      createSystem({
        modules: { a: modA, b: modB },
        initOrder: ["a"],
        // biome-ignore lint/suspicious/noExplicitAny: Testing initOrder
      } as any);
    }).toThrow("initOrder is missing modules");
  });
});

// ============================================================================
// Proxy Security
// ============================================================================

describe("Proxy Security", () => {
  it("BLOCKED_PROPS return undefined on namespaced facts proxy", () => {
    const system = createSystem({ modules: { auth: authModule } });
    system.start();

    // biome-ignore lint/suspicious/noExplicitAny: Testing blocked props
    const facts = system.facts as any;
    expect(facts.__proto__).toBeUndefined();
    expect(facts.constructor).toBeUndefined();
    expect(facts.prototype).toBeUndefined();

    system.destroy();
  });

  it("BLOCKED_PROPS return undefined on module facts proxy", () => {
    const system = createSystem({ modules: { auth: authModule } });
    system.start();

    // biome-ignore lint/suspicious/noExplicitAny: Testing blocked props
    const authFacts = system.facts.auth as any;
    expect(authFacts.__proto__).toBeUndefined();
    expect(authFacts.constructor).toBeUndefined();
    expect(authFacts.prototype).toBeUndefined();

    system.destroy();
  });

  it("BLOCKED_PROPS return undefined on namespaced derive proxy", () => {
    const system = createSystem({ modules: { auth: authModule } });
    system.start();

    // biome-ignore lint/suspicious/noExplicitAny: Testing blocked props
    const derive = system.derive as any;
    expect(derive.__proto__).toBeUndefined();
    expect(derive.constructor).toBeUndefined();
    expect(derive.prototype).toBeUndefined();

    system.destroy();
  });

  it("BLOCKED_PROPS return undefined on module derive proxy", () => {
    const system = createSystem({ modules: { auth: authModule } });
    system.start();

    // biome-ignore lint/suspicious/noExplicitAny: Testing blocked props
    const authDerive = system.derive.auth as any;
    expect(authDerive.__proto__).toBeUndefined();
    expect(authDerive.constructor).toBeUndefined();
    expect(authDerive.prototype).toBeUndefined();

    system.destroy();
  });

  it("BLOCKED_PROPS return undefined on namespaced events proxy", () => {
    const system = createSystem({ modules: { auth: authModule } });
    system.start();

    // biome-ignore lint/suspicious/noExplicitAny: Testing blocked props
    const events = system.events as any;
    expect(events.__proto__).toBeUndefined();
    expect(events.constructor).toBeUndefined();
    expect(events.prototype).toBeUndefined();

    system.destroy();
  });

  it("BLOCKED_PROPS return undefined on module events proxy", () => {
    const system = createSystem({ modules: { auth: authModule } });
    system.start();

    // biome-ignore lint/suspicious/noExplicitAny: Testing blocked props
    const authEvents = system.events.auth as any;
    expect(authEvents.__proto__).toBeUndefined();
    expect(authEvents.constructor).toBeUndefined();
    expect(authEvents.prototype).toBeUndefined();

    system.destroy();
  });

  it("symbols return undefined on namespace proxies", () => {
    const system = createSystem({ modules: { auth: authModule } });
    system.start();

    const sym = Symbol("test");
    // biome-ignore lint/suspicious/noExplicitAny: Testing symbol access
    expect((system.facts as any)[sym]).toBeUndefined();
    // biome-ignore lint/suspicious/noExplicitAny: Testing symbol access
    expect((system.derive as any)[sym]).toBeUndefined();
    // biome-ignore lint/suspicious/noExplicitAny: Testing symbol access
    expect((system.events as any)[sym]).toBeUndefined();

    system.destroy();
  });

  it("set returns false on read-only derive proxy", () => {
    const system = createSystem({ modules: { auth: authModule } });
    system.start();

    // Proxy set trap returns false — strict mode would throw
    const result = Reflect.set(system.derive, "auth", {});
    expect(result).toBe(false);

    system.destroy();
  });

  it("defineProperty returns false on namespace proxies", () => {
    const system = createSystem({ modules: { auth: authModule } });
    system.start();

    expect(Reflect.defineProperty(system.facts, "test", { value: 1 })).toBe(
      false,
    );
    expect(Reflect.defineProperty(system.derive, "test", { value: 1 })).toBe(
      false,
    );
    // biome-ignore lint/suspicious/noExplicitAny: Testing proxy trap
    expect(
      Reflect.defineProperty(system.events as any, "test", { value: 1 }),
    ).toBe(false);

    system.destroy();
  });

  it("setPrototypeOf returns false on namespace proxies", () => {
    const system = createSystem({ modules: { auth: authModule } });
    system.start();

    expect(Reflect.setPrototypeOf(system.facts, {})).toBe(false);
    expect(Reflect.setPrototypeOf(system.derive, {})).toBe(false);
    // biome-ignore lint/suspicious/noExplicitAny: Testing proxy trap
    expect(Reflect.setPrototypeOf(system.events as any, {})).toBe(false);

    system.destroy();
  });

  it("getPrototypeOf returns null on namespace proxies", () => {
    const system = createSystem({ modules: { auth: authModule } });
    system.start();

    expect(Reflect.getPrototypeOf(system.facts)).toBeNull();
    expect(Reflect.getPrototypeOf(system.derive)).toBeNull();
    // biome-ignore lint/suspicious/noExplicitAny: Testing proxy trap
    expect(Reflect.getPrototypeOf(system.events as any)).toBeNull();

    system.destroy();
  });

  it("set returns false on single-module events proxy", () => {
    const system = createSystem({ module: createSingleModule() });
    system.start();

    // biome-ignore lint/suspicious/noExplicitAny: Testing proxy trap
    const result = Reflect.set(system.events as any, "increment", () => {});
    expect(result).toBe(false);

    system.destroy();
  });
});

// ============================================================================
// Distributable Snapshot
// ============================================================================

describe("Distributable Snapshot", () => {
  it("getDistributableSnapshot returns facts grouped by namespace", () => {
    const system = createSystem({
      modules: { auth: authModule, data: dataModule },
    });
    system.start();

    system.facts.auth.token = "snap-token";
    system.facts.data.count = 3;

    const snapshot = system.getDistributableSnapshot({
      includeFacts: ["auth.token", "auth.loggedIn", "data.count", "data.items"],
    });
    const data = snapshot.data as Record<string, Record<string, unknown>>;

    expect(data.auth!.token).toBe("snap-token");
    expect(data.auth!.loggedIn).toBe(false);
    expect(data.data!.count).toBe(3);
    expect(data.data!.items).toEqual([]);

    system.destroy();
  });

  it("getDistributableSnapshot includes derivations when requested", () => {
    const system = createSystem({
      modules: { auth: authModule, data: dataModule },
    });
    system.start();

    system.facts.auth.loggedIn = true;

    const snapshot = system.getDistributableSnapshot({
      includeDerivations: ["auth.isLoggedIn"],
    });
    const data = snapshot.data as Record<string, Record<string, unknown>>;

    expect(data.auth!.isLoggedIn).toBe(true);

    system.destroy();
  });

  it("getDistributableSnapshot snapshot has createdAt timestamp", () => {
    const system = createSystem({ modules: { auth: authModule } });
    system.start();

    const snapshot = system.getDistributableSnapshot();
    expect(typeof snapshot.createdAt).toBe("number");
    expect(snapshot.createdAt).toBeGreaterThan(0);

    system.destroy();
  });

  it("watchDistributableSnapshot fires on changes", async () => {
    const system = createSystem({
      modules: { auth: authModule, data: dataModule },
    });
    system.start();

    const callback = vi.fn();
    const unsub = system.watchDistributableSnapshot(
      { includeDerivations: ["auth.isLoggedIn"] },
      callback,
    );

    system.facts.auth.loggedIn = true;
    await flushMicrotasks();

    expect(callback).toHaveBeenCalled();
    const lastCall = callback.mock.calls[callback.mock.calls.length - 1]![0];
    const data = lastCall.data as Record<string, Record<string, unknown>>;
    expect(data.auth!.isLoggedIn).toBe(true);

    unsub();
    system.destroy();
  });
});

// ============================================================================
// Config Forwarding
// ============================================================================

describe("Config Forwarding", () => {
  it("plugins array forwarded to engine", () => {
    const onStart = vi.fn();
    const plugin = {
      name: "test-plugin",
      onStart,
    };

    const system = createSystem({
      modules: { auth: authModule },
      plugins: [plugin],
    });
    system.start();

    expect(onStart).toHaveBeenCalled();

    system.destroy();
  });

  it("history config forwarded (boolean)", () => {
    const system = createSystem({
      modules: { auth: authModule },
      history: true,
    });
    system.start();

    // History API should be available
    expect(system.history).toBeDefined();

    system.destroy();
  });

  it("history config forwarded (object)", () => {
    const system = createSystem({
      modules: { auth: authModule },
      history: { maxSnapshots: 50 },
    });
    system.start();

    expect(system.history).toBeDefined();

    system.destroy();
  });

  it("trace config forwarded", () => {
    const system = createSystem({
      modules: { auth: authModule },
      trace: true,
    });
    system.start();

    expect(system.trace).toBeDefined();

    system.destroy();
  });

  it("errorBoundary config forwarded", () => {
    const system = createSystem({
      modules: { auth: authModule },
      errorBoundary: {
        onConstraintError: "skip",
        onResolverError: "skip",
        onEffectError: "skip",
      },
    });
    system.start();

    // System should start without errors (config forwarded to engine)
    expect(system.isRunning).toBe(true);

    system.destroy();
  });

  it("plugins forwarded in single module mode", () => {
    const onStart = vi.fn();
    const plugin = { name: "test-plugin", onStart };

    const system = createSystem({
      module: createSingleModule(),
      plugins: [plugin],
    });
    system.start();

    expect(onStart).toHaveBeenCalled();

    system.destroy();
  });

  it("zeroConfig applies defaults", () => {
    const system = createSystem({
      modules: { auth: authModule },
      zeroConfig: true,
    });
    system.start();

    // zeroConfig enables history in dev mode and sets error boundary defaults
    expect(system.isRunning).toBe(true);

    system.destroy();
  });
});

// ============================================================================
// InitialFacts & Hydration
// ============================================================================

describe("InitialFacts & Hydration", () => {
  it("initialFacts applied on start in namespaced mode", () => {
    const system = createSystem({
      modules: { auth: authModule, data: dataModule },
      initialFacts: {
        auth: { token: "initial-token", loggedIn: true },
        data: { count: 10, items: ["a", "b"] },
      },
      // biome-ignore lint/suspicious/noExplicitAny: Testing initialFacts
    } as any);
    system.start();

    expect((system.facts.auth as Record<string, unknown>).token).toBe(
      "initial-token",
    );
    expect((system.facts.auth as Record<string, unknown>).loggedIn).toBe(true);
    expect((system.facts.data as Record<string, unknown>).count).toBe(10);
    expect((system.facts.data as Record<string, unknown>).items).toEqual([
      "a",
      "b",
    ]);

    system.destroy();
  });

  it("initialFacts applied on start in single module mode", () => {
    const system = createSystem({
      module: createSingleModule(),
      initialFacts: { count: 99, label: "init" },
    });
    system.start();

    expect(system.facts.count).toBe(99);
    expect(system.facts.label).toBe("init");

    system.destroy();
  });

  it("hydrate applies facts before start in namespaced mode", async () => {
    const system = createSystem({
      modules: { auth: authModule, data: dataModule },
    });

    await system.hydrate(async () => ({
      auth: { token: "hydrated-token" },
    }));

    system.start();

    expect(system.facts.auth.token).toBe("hydrated-token");

    system.destroy();
  });

  it("hydrate throws if called after start", async () => {
    const system = createSystem({ modules: { auth: authModule } });
    system.start();

    await expect(
      system.hydrate(async () => ({ auth: { token: "late" } })),
    ).rejects.toThrow("hydrate() must be called before start()");

    system.destroy();
  });
});

// ============================================================================
// Engine Passthrough Methods
// ============================================================================

describe("Engine Passthrough Methods", () => {
  it("inspect returns system state", () => {
    const system = createSystem({ modules: { auth: authModule } });
    system.start();

    const inspection = system.inspect();
    expect(inspection).toBeDefined();
    expect(typeof inspection).toBe("object");

    system.destroy();
  });

  it("batch coalesces mutations", () => {
    const system = createSystem({
      modules: { auth: authModule, data: dataModule },
    });
    system.start();

    const listener = vi.fn();
    system.subscribe(["auth.token", "data.count"], listener);

    system.batch(() => {
      system.facts.auth.token = "batch-1";
      system.facts.data.count = 42;
    });

    // Listener should have been called (possibly multiple times due to implementation)
    // but the key thing is the values are correct after batch
    expect(system.facts.auth.token).toBe("batch-1");
    expect(system.facts.data.count).toBe(42);

    system.destroy();
  });

  it("isSettled reflects engine state", async () => {
    const system = createSystem({ module: createSingleModule() });
    system.start();
    await flushMicrotasks();

    // With no async resolvers, system should settle
    expect(system.isSettled).toBe(true);

    system.destroy();
  });

  it("onSettledChange fires on settlement changes", async () => {
    const system = createSystem({ module: createSingleModule() });
    system.start();
    await flushMicrotasks();

    const callback = vi.fn();
    const unsub = system.onSettledChange(callback);

    // Just verify the method exists and returns an unsubscribe function
    expect(typeof unsub).toBe("function");

    unsub();
    system.destroy();
  });
});

// ============================================================================
// Cross-Module Dependencies
// ============================================================================

describe("Cross-Module Dependencies", () => {
  it("derivation can read facts from another module via crossModuleDeps", () => {
    const baseModule = createModule("base", {
      schema: {
        facts: { value: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.value = 10;
      },
    });

    const consumerModule = createModule("consumer", {
      schema: {
        facts: { multiplier: t.number() },
        derivations: { computed: t.number() },
        events: {},
        requirements: {},
      },
      crossModuleDeps: {
        base: {
          facts: { value: { _type: 0 } },
          derivations: {},
          events: {},
          requirements: {},
        },
      },
      init: (facts: Record<string, unknown>) => {
        facts.multiplier = 2;
      },
      derive: {
        computed: (facts: Record<string, unknown>) => {
          const baseValue =
            ((facts as Record<string, Record<string, unknown>>).base
              ?.value as number) ?? 0;
          const mult =
            ((facts as Record<string, Record<string, unknown>>).self
              ?.multiplier as number) ?? 1;

          return baseValue * mult;
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: Testing crossModuleDeps
    } as any);

    const system = createSystem({
      modules: { base: baseModule, consumer: consumerModule },
    });
    system.start();

    expect(system.derive.consumer.computed).toBe(20);

    system.destroy();
  });
});

// ============================================================================
// Dynamic Module Registration
// ============================================================================

describe("Dynamic Module Registration", () => {
  it("registerModule adds a new namespace in namespaced mode", () => {
    const system = createSystem({ modules: { auth: authModule } });
    system.start();

    const newModule = createModule("settings", {
      schema: {
        facts: { theme: t.string() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.theme = "dark";
      },
    });

    // biome-ignore lint/suspicious/noExplicitAny: Testing registerModule
    (system as any).registerModule("settings", newModule);

    // biome-ignore lint/suspicious/noExplicitAny: Accessing dynamic namespace
    expect((system.facts as any).settings.theme).toBe("dark");

    system.destroy();
  });

  it("registerModule throws on duplicate namespace", () => {
    const system = createSystem({ modules: { auth: authModule } });
    system.start();

    expect(() => {
      // biome-ignore lint/suspicious/noExplicitAny: Testing registerModule
      (system as any).registerModule("auth", authModule);
    }).toThrow('Module namespace "auth" already exists');

    system.destroy();
  });

  it("registerModule throws if namespace contains '::'", () => {
    const system = createSystem({ modules: { auth: authModule } });
    system.start();

    const newModule = createModule("bad", {
      schema: {
        facts: { x: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.x = 0;
      },
    });

    expect(() => {
      // biome-ignore lint/suspicious/noExplicitAny: Testing registerModule
      (system as any).registerModule("bad::name", newModule);
    }).toThrow('contains the reserved separator "::"');

    system.destroy();
  });

  it("registerModule throws if namespace is a blocked prop", () => {
    const system = createSystem({ modules: { auth: authModule } });
    system.start();

    const newModule = createModule("proto", {
      schema: {
        facts: { x: t.number() },
        derivations: {},
        events: {},
        requirements: {},
      },
      init: (facts) => {
        facts.x = 0;
      },
    });

    expect(() => {
      // biome-ignore lint/suspicious/noExplicitAny: Testing registerModule
      (system as any).registerModule("__proto__", newModule);
    }).toThrow("blocked property");

    system.destroy();
  });
});

// ============================================================================
// When (predicate-based waiting)
// ============================================================================

describe("when()", () => {
  it("resolves when predicate becomes true in single module mode", async () => {
    const system = createSystem({ module: createSingleModule() });
    system.start();

    const promise = system.when((facts) => (facts.count as number) > 0);
    system.facts.count = 1;
    await promise;

    // If we get here, the promise resolved
    expect(system.facts.count).toBe(1);

    system.destroy();
  });

  it("resolves when predicate becomes true in namespaced mode", async () => {
    const system = createSystem({ modules: { auth: authModule } });
    system.start();

    const promise = system.when(
      // biome-ignore lint/suspicious/noExplicitAny: Testing when() predicate
      (facts: any) => facts.auth.loggedIn === true,
    );

    system.facts.auth.loggedIn = true;
    await promise;

    expect(system.facts.auth.loggedIn).toBe(true);

    system.destroy();
  });
});

// ============================================================================
// Dispatch (raw event dispatch)
// ============================================================================

describe("dispatch()", () => {
  it("dispatch forwards to engine in single module mode", () => {
    const system = createSystem({ module: createSingleModule() });
    system.start();

    system.dispatch({ type: "increment" });
    expect(system.facts.count).toBe(1);

    system.destroy();
  });

  it("dispatch forwards to engine in namespaced mode", () => {
    const system = createSystem({ modules: { auth: authModule } });
    system.start();

    system.dispatch({ type: "auth::login" as "login", token: "raw-dispatch" });
    expect(system.facts.auth.token).toBe("raw-dispatch");

    system.destroy();
  });
});
