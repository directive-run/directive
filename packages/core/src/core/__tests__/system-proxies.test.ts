import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SEPARATOR,
  createCrossModuleFactsProxy,
  createModuleDeriveProxy,
  createModuleFactsProxy,
  createNamespacedDeriveProxy,
  createNamespacedEventsProxy,
  createNamespacedFactsProxy,
  denormalizeFlatKeys,
  toInternalKey,
} from "../system-proxies.js";

// ============================================================================
// SEPARATOR constant
// ============================================================================

describe("SEPARATOR", () => {
  it("is '::'", () => {
    expect(SEPARATOR).toBe("::");
  });
});

// ============================================================================
// Shared security hardening helpers
// ============================================================================

/**
 * Run the standard security-hardening assertions on any proxy.
 * Covers symbol access, BLOCKED_PROPS, defineProperty, prototype traps.
 */
function assertSecurityHardening(
  proxy: Record<string, unknown>,
  options: { readonly: boolean } = { readonly: false },
) {
  // Symbol access → undefined (except util.inspect.custom hook)
  it("returns undefined for symbol access", () => {
    expect((proxy as any)[Symbol("x")]).toBeUndefined();
    expect((proxy as any)[Symbol.iterator]).toBeUndefined();
    expect((proxy as any)[Symbol.toPrimitive]).toBeUndefined();
  });

  // Inspection hook (util.inspect.custom) returns a snapshot function so
  // pretty-format / console.log don't trap on the proxy reflectively.
  it("returns a snapshot function for util.inspect.custom", () => {
    const inspectSym = Symbol.for("nodejs.util.inspect.custom");
    expect(typeof (proxy as any)[inspectSym]).toBe("function");
  });

  // BLOCKED_PROPS → undefined on get
  it("returns undefined for __proto__", () => {
    expect((proxy as any).__proto__).toBeUndefined();
  });
  it("returns undefined for constructor", () => {
    expect((proxy as any).constructor).toBeUndefined();
  });
  it("returns undefined for prototype", () => {
    expect((proxy as any).prototype).toBeUndefined();
  });

  // BLOCKED_PROPS → false on `in`
  it("returns false for __proto__ in has trap", () => {
    expect("__proto__" in proxy).toBe(false);
  });
  it("returns false for constructor in has trap", () => {
    expect("constructor" in proxy).toBe(false);
  });
  it("returns false for prototype in has trap", () => {
    expect("prototype" in proxy).toBe(false);
  });

  // defineProperty → false
  it("rejects defineProperty", () => {
    expect(Reflect.defineProperty(proxy, "evil", { value: 1 })).toBe(false);
  });

  // getPrototypeOf → null
  it("returns null for getPrototypeOf", () => {
    expect(Object.getPrototypeOf(proxy)).toBeNull();
  });

  // setPrototypeOf → false
  it("rejects setPrototypeOf", () => {
    expect(Reflect.setPrototypeOf(proxy, {})).toBe(false);
  });

  // Symbol set → false
  it("rejects symbol set", () => {
    expect(Reflect.set(proxy, Symbol("x"), 1)).toBe(false);
  });

  // Symbol delete → false
  it("rejects symbol delete", () => {
    expect(Reflect.deleteProperty(proxy, Symbol("x"))).toBe(false);
  });

  // Symbol in → false
  it("rejects symbol in has trap", () => {
    expect(Reflect.has(proxy, Symbol("x"))).toBe(false);
  });

  // BLOCKED_PROPS set → false
  it("rejects set on __proto__", () => {
    expect(Reflect.set(proxy, "__proto__", 1)).toBe(false);
  });
  it("rejects set on constructor", () => {
    expect(Reflect.set(proxy, "constructor", 1)).toBe(false);
  });

  // BLOCKED_PROPS delete → false
  it("rejects delete on __proto__", () => {
    expect(Reflect.deleteProperty(proxy, "__proto__")).toBe(false);
  });

  if (options.readonly) {
    it("rejects set on any property (read-only)", () => {
      expect(Reflect.set(proxy, "anyKey", 42)).toBe(false);
    });

    it("rejects deleteProperty on any property (read-only)", () => {
      expect(Reflect.deleteProperty(proxy, "anyKey")).toBe(false);
    });
  }
}

// ============================================================================
// createModuleFactsProxy
// ============================================================================

describe("createModuleFactsProxy", () => {
  let facts: Record<string, unknown>;

  beforeEach(() => {
    facts = { "auth::token": "abc", "auth::role": "admin" };
  });

  it("reads unprefixed key via prefixed internal key", () => {
    const proxy = createModuleFactsProxy(facts, "auth");

    expect(proxy.token).toBe("abc");
    expect(proxy.role).toBe("admin");
  });

  it("returns undefined for keys not in the store", () => {
    const proxy = createModuleFactsProxy(facts, "auth");

    expect(proxy.missing).toBeUndefined();
  });

  it("sets unprefixed key as prefixed in the store", () => {
    const proxy = createModuleFactsProxy(facts, "auth");
    proxy.token = "xyz";

    expect(facts["auth::token"]).toBe("xyz");
  });

  it("supports has check via 'in' operator", () => {
    const proxy = createModuleFactsProxy(facts, "auth");

    expect("token" in proxy).toBe(true);
    expect("missing" in proxy).toBe(false);
  });

  it("supports delete", () => {
    const proxy = createModuleFactsProxy(facts, "auth");
    // biome-ignore lint/performance/noDelete: Testing proxy deleteProperty trap
    delete proxy.token;

    expect(facts["auth::token"]).toBeUndefined();
    expect("auth::token" in facts).toBe(false);
  });

  it("passes through $store", () => {
    const storeObj = { getAll: () => ({}) };
    facts.$store = storeObj;
    const proxy = createModuleFactsProxy(facts, "auth");

    expect(proxy.$store).toBe(storeObj);
  });

  it("passes through $snapshot", () => {
    const snap = { frozen: true };
    facts.$snapshot = snap;
    const proxy = createModuleFactsProxy(facts, "auth");

    expect(proxy.$snapshot).toBe(snap);
  });

  it("does NOT prefix $store or $snapshot", () => {
    facts.$store = "real";
    facts["auth::$store"] = "wrong";
    const proxy = createModuleFactsProxy(facts, "auth");

    expect(proxy.$store).toBe("real");
  });

  describe("caching", () => {
    it("returns the same proxy instance for same facts + namespace", () => {
      const p1 = createModuleFactsProxy(facts, "auth");
      const p2 = createModuleFactsProxy(facts, "auth");

      expect(p1).toBe(p2);
    });

    it("returns different proxies for different namespaces", () => {
      const p1 = createModuleFactsProxy(facts, "auth");
      const p2 = createModuleFactsProxy(facts, "data");

      expect(p1).not.toBe(p2);
    });

    it("returns different proxies for different facts stores", () => {
      const facts2: Record<string, unknown> = {};
      const p1 = createModuleFactsProxy(facts, "auth");
      const p2 = createModuleFactsProxy(facts2, "auth");

      expect(p1).not.toBe(p2);
    });
  });

  describe("security hardening", () => {
    beforeEach(() => {
      createModuleFactsProxy(
        { "ns::key": "val" } as Record<string, unknown>,
        "ns",
      );
    });

    assertSecurityHardening(
      // Lazy — tests reference the `proxy` variable set in beforeEach
      // We need a stable reference, so build once outside:
      createModuleFactsProxy({ "s::k": 1 } as Record<string, unknown>, "s"),
    );
  });
});

// ============================================================================
// createNamespacedFactsProxy
// ============================================================================

describe("createNamespacedFactsProxy", () => {
  let facts: Record<string, unknown>;
  let modulesMap: Record<string, unknown>;
  let getModuleNames: () => string[];

  beforeEach(() => {
    facts = { "auth::token": "abc", "data::users": [1, 2] };
    modulesMap = { auth: {}, data: {} };
    getModuleNames = () => Object.keys(modulesMap);
  });

  it("returns a module facts proxy for a valid namespace", () => {
    const proxy = createNamespacedFactsProxy(
      facts,
      modulesMap as any,
      getModuleNames,
    );

    expect(proxy.auth!.token).toBe("abc");
    expect(proxy.data!.users).toEqual([1, 2]);
  });

  it("returns undefined for unknown namespace", () => {
    const proxy = createNamespacedFactsProxy(
      facts,
      modulesMap as any,
      getModuleNames,
    );

    expect(proxy.unknown).toBeUndefined();
  });

  it("supports has check for known namespaces", () => {
    const proxy = createNamespacedFactsProxy(
      facts,
      modulesMap as any,
      getModuleNames,
    );

    expect("auth" in proxy).toBe(true);
    expect("missing" in proxy).toBe(false);
  });

  it("ownKeys returns module names", () => {
    const proxy = createNamespacedFactsProxy(
      facts,
      modulesMap as any,
      getModuleNames,
    );

    expect(Object.keys(proxy)).toEqual(["auth", "data"]);
  });

  describe("caching", () => {
    it("returns the same proxy for the same facts store", () => {
      const p1 = createNamespacedFactsProxy(
        facts,
        modulesMap as any,
        getModuleNames,
      );
      const p2 = createNamespacedFactsProxy(
        facts,
        modulesMap as any,
        getModuleNames,
      );

      expect(p1).toBe(p2);
    });
  });

  describe("security hardening", () => {
    assertSecurityHardening(
      createNamespacedFactsProxy(
        { "a::b": 1 } as Record<string, unknown>,
        { a: {} } as any,
        () => ["a"],
      ) as any,
      { readonly: true },
    );
  });
});

// ============================================================================
// createCrossModuleFactsProxy
// ============================================================================

describe("createCrossModuleFactsProxy", () => {
  let facts: Record<string, unknown>;

  beforeEach(() => {
    facts = {
      "users::list": [1, 2, 3],
      "auth::token": "secret",
      "billing::plan": "pro",
    };
  });

  it("maps 'self' to own module namespace", () => {
    const proxy = createCrossModuleFactsProxy(facts, "users", ["auth"]);

    expect(proxy.self!.list).toEqual([1, 2, 3]);
  });

  it("maps declared dependency namespaces", () => {
    const proxy = createCrossModuleFactsProxy(facts, "users", ["auth"]);

    expect(proxy.auth!.token).toBe("secret");
  });

  it("returns undefined for undeclared namespaces", () => {
    const proxy = createCrossModuleFactsProxy(facts, "users", ["auth"]);

    expect(proxy.billing).toBeUndefined();
  });

  it("emits dev-mode warning for undeclared cross-module access", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const proxy = createCrossModuleFactsProxy(facts, "users", ["auth"]);
    proxy.billing;

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Module "users" accessed undeclared cross-module property "billing"',
      ),
    );

    warnSpy.mockRestore();
    process.env.NODE_ENV = originalEnv;
  });

  // Production warning suppression is now compile-time via #is-development
  // import mapping — not testable at runtime. Warnings are eliminated by bundler.
  it.skip("does not warn in production (compile-time, not runtime testable)", () => {});

  it("supports has check for self", () => {
    const proxy = createCrossModuleFactsProxy(facts, "users", ["auth"]);

    expect("self" in proxy).toBe(true);
  });

  it("supports has check for declared deps", () => {
    const proxy = createCrossModuleFactsProxy(facts, "users", ["auth"]);

    expect("auth" in proxy).toBe(true);
    expect("billing" in proxy).toBe(false);
  });

  it("ownKeys returns self + dep namespaces", () => {
    const proxy = createCrossModuleFactsProxy(facts, "users", [
      "auth",
      "billing",
    ]);

    expect(Object.keys(proxy)).toEqual(["self", "auth", "billing"]);
  });

  it("handles multiple dep namespaces", () => {
    const proxy = createCrossModuleFactsProxy(facts, "users", [
      "auth",
      "billing",
    ]);

    expect(proxy.auth!.token).toBe("secret");
    expect(proxy.billing!.plan).toBe("pro");
  });

  it("handles empty dep list", () => {
    const proxy = createCrossModuleFactsProxy(facts, "users", []);

    expect(proxy.self!.list).toEqual([1, 2, 3]);
    expect(Object.keys(proxy)).toEqual(["self"]);
  });

  describe("caching", () => {
    it("returns the same proxy for same facts + self + deps", () => {
      const p1 = createCrossModuleFactsProxy(facts, "users", ["auth"]);
      const p2 = createCrossModuleFactsProxy(facts, "users", ["auth"]);

      expect(p1).toBe(p2);
    });

    it("returns different proxies for different dep lists", () => {
      const p1 = createCrossModuleFactsProxy(facts, "users", ["auth"]);
      const p2 = createCrossModuleFactsProxy(facts, "users", [
        "auth",
        "billing",
      ]);

      expect(p1).not.toBe(p2);
    });

    it("returns different proxies for different self namespaces", () => {
      const p1 = createCrossModuleFactsProxy(facts, "users", ["auth"]);
      const p2 = createCrossModuleFactsProxy(facts, "billing", ["auth"]);

      expect(p1).not.toBe(p2);
    });
  });

  describe("security hardening", () => {
    assertSecurityHardening(
      createCrossModuleFactsProxy(
        { "u::x": 1 } as Record<string, unknown>,
        "u",
        [],
      ) as any,
      { readonly: true },
    );
  });
});

// ============================================================================
// createModuleDeriveProxy
// ============================================================================

describe("createModuleDeriveProxy", () => {
  let derive: Record<string, unknown>;

  beforeEach(() => {
    derive = { "auth::isLoggedIn": true, "auth::role": "admin" };
  });

  it("reads unprefixed key via prefixed internal key", () => {
    const proxy = createModuleDeriveProxy(derive, "auth");

    expect(proxy.isLoggedIn).toBe(true);
    expect(proxy.role).toBe("admin");
  });

  it("returns undefined for missing keys", () => {
    const proxy = createModuleDeriveProxy(derive, "auth");

    expect(proxy.missing).toBeUndefined();
  });

  it("supports has check", () => {
    const proxy = createModuleDeriveProxy(derive, "auth");

    expect("isLoggedIn" in proxy).toBe(true);
    expect("missing" in proxy).toBe(false);
  });

  it("is read-only — set returns false", () => {
    const proxy = createModuleDeriveProxy(derive, "auth");

    expect(Reflect.set(proxy, "isLoggedIn", false)).toBe(false);
  });

  it("is read-only — deleteProperty returns false", () => {
    const proxy = createModuleDeriveProxy(derive, "auth");

    expect(Reflect.deleteProperty(proxy, "isLoggedIn")).toBe(false);
  });

  describe("caching", () => {
    it("returns the same proxy for same derive + namespace", () => {
      const p1 = createModuleDeriveProxy(derive, "auth");
      const p2 = createModuleDeriveProxy(derive, "auth");

      expect(p1).toBe(p2);
    });

    it("returns different proxies for different namespaces", () => {
      const p1 = createModuleDeriveProxy(derive, "auth");
      const p2 = createModuleDeriveProxy(derive, "data");

      expect(p1).not.toBe(p2);
    });
  });

  describe("security hardening", () => {
    assertSecurityHardening(
      createModuleDeriveProxy({ "d::k": 1 } as Record<string, unknown>, "d"),
      { readonly: true },
    );
  });
});

// ============================================================================
// createNamespacedDeriveProxy
// ============================================================================

describe("createNamespacedDeriveProxy", () => {
  let derive: Record<string, unknown>;
  let modulesMap: Record<string, unknown>;
  let getModuleNames: () => string[];

  beforeEach(() => {
    derive = { "auth::isLoggedIn": true, "data::count": 42 };
    modulesMap = { auth: {}, data: {} };
    getModuleNames = () => Object.keys(modulesMap);
  });

  it("returns a module derive proxy for a valid namespace", () => {
    const proxy = createNamespacedDeriveProxy(
      derive,
      modulesMap as any,
      getModuleNames,
    );

    expect(proxy.auth!.isLoggedIn).toBe(true);
    expect(proxy.data!.count).toBe(42);
  });

  it("returns undefined for unknown namespace", () => {
    const proxy = createNamespacedDeriveProxy(
      derive,
      modulesMap as any,
      getModuleNames,
    );

    expect(proxy.unknown).toBeUndefined();
  });

  it("supports has check", () => {
    const proxy = createNamespacedDeriveProxy(
      derive,
      modulesMap as any,
      getModuleNames,
    );

    expect("auth" in proxy).toBe(true);
    expect("missing" in proxy).toBe(false);
  });

  it("ownKeys returns module names", () => {
    const proxy = createNamespacedDeriveProxy(
      derive,
      modulesMap as any,
      getModuleNames,
    );

    expect(Object.keys(proxy)).toEqual(["auth", "data"]);
  });

  describe("caching", () => {
    it("returns the same proxy for the same derive store", () => {
      const p1 = createNamespacedDeriveProxy(
        derive,
        modulesMap as any,
        getModuleNames,
      );
      const p2 = createNamespacedDeriveProxy(
        derive,
        modulesMap as any,
        getModuleNames,
      );

      expect(p1).toBe(p2);
    });
  });

  describe("security hardening", () => {
    assertSecurityHardening(
      createNamespacedDeriveProxy(
        { "x::y": 1 } as Record<string, unknown>,
        { x: {} } as any,
        () => ["x"],
      ) as any,
      { readonly: true },
    );
  });
});

// ============================================================================
// createNamespacedEventsProxy
// ============================================================================

describe("createNamespacedEventsProxy", () => {
  let engine: { dispatch: ReturnType<typeof vi.fn> };
  let modulesMap: Record<string, unknown>;
  let getModuleNames: () => string[];

  beforeEach(() => {
    engine = { dispatch: vi.fn() };
    modulesMap = { auth: {}, billing: {} };
    getModuleNames = () => Object.keys(modulesMap);
  });

  it("dispatches namespaced event with payload", () => {
    const proxy = createNamespacedEventsProxy(
      engine,
      modulesMap as any,
      getModuleNames,
    );
    proxy.auth!.login!({ token: "abc" });

    expect(engine.dispatch).toHaveBeenCalledWith({
      type: "auth::login",
      token: "abc",
    });
  });

  it("dispatches namespaced event without payload", () => {
    const proxy = createNamespacedEventsProxy(
      engine,
      modulesMap as any,
      getModuleNames,
    );
    proxy.auth!.logout!();

    expect(engine.dispatch).toHaveBeenCalledWith({
      type: "auth::logout",
    });
  });

  it("returns undefined for unknown namespace", () => {
    const proxy = createNamespacedEventsProxy(
      engine,
      modulesMap as any,
      getModuleNames,
    );

    expect(proxy.unknown).toBeUndefined();
  });

  it("supports has check for known namespaces", () => {
    const proxy = createNamespacedEventsProxy(
      engine,
      modulesMap as any,
      getModuleNames,
    );

    expect("auth" in proxy).toBe(true);
    expect("missing" in proxy).toBe(false);
  });

  it("ownKeys returns module names", () => {
    const proxy = createNamespacedEventsProxy(
      engine,
      modulesMap as any,
      getModuleNames,
    );

    expect(Object.keys(proxy)).toEqual(["auth", "billing"]);
  });

  it("different event names on same module produce correct dispatch", () => {
    const proxy = createNamespacedEventsProxy(
      engine,
      modulesMap as any,
      getModuleNames,
    );
    proxy.billing!.charge!({ amount: 100 });
    proxy.billing!.refund!({ amount: 50 });

    expect(engine.dispatch).toHaveBeenCalledWith({
      type: "billing::charge",
      amount: 100,
    });
    expect(engine.dispatch).toHaveBeenCalledWith({
      type: "billing::refund",
      amount: 50,
    });
  });

  describe("inner proxy caching", () => {
    it("returns the same inner module proxy on repeated access", () => {
      const proxy = createNamespacedEventsProxy(
        engine,
        modulesMap as any,
        getModuleNames,
      );
      const inner1 = proxy.auth;
      const inner2 = proxy.auth;

      expect(inner1).toBe(inner2);
    });
  });

  describe("security hardening (outer proxy)", () => {
    assertSecurityHardening(
      createNamespacedEventsProxy(
        { dispatch: vi.fn() },
        { m: {} } as any,
        () => ["m"],
      ) as any,
      { readonly: true },
    );
  });

  describe("security hardening (inner module proxy)", () => {
    const outerProxy = createNamespacedEventsProxy(
      { dispatch: vi.fn() },
      { m: {} } as any,
      () => ["m"],
    );
    const innerProxy = outerProxy.m as any;

    assertSecurityHardening(innerProxy, { readonly: true });
  });
});

// ============================================================================
// toInternalKey
// ============================================================================

describe("toInternalKey", () => {
  it("converts dot-separated key to separator format", () => {
    expect(toInternalKey("auth.status")).toBe("auth::status");
  });

  it("passes through already-prefixed keys unchanged", () => {
    expect(toInternalKey("auth::status")).toBe("auth::status");
  });

  it("passes through simple keys unchanged", () => {
    expect(toInternalKey("status")).toBe("status");
  });

  it("handles multi-segment dot keys", () => {
    expect(toInternalKey("auth.nested.deep")).toBe("auth::nested::deep");
  });

  it("handles empty string", () => {
    expect(toInternalKey("")).toBe("");
  });

  it("handles key with leading dot", () => {
    // `.foo` splits into ["", "foo"]
    expect(toInternalKey(".foo")).toBe("::foo");
  });

  it("handles key with trailing dot", () => {
    // `foo.` splits into ["foo", ""]
    expect(toInternalKey("foo.")).toBe("foo::");
  });
});

// ============================================================================
// denormalizeFlatKeys
// ============================================================================

describe("denormalizeFlatKeys", () => {
  it("groups prefixed keys by namespace", () => {
    const result = denormalizeFlatKeys({
      "auth::token": "abc",
      "auth::role": "admin",
      "data::users": [1, 2],
    });

    expect(result).toEqual({
      auth: { token: "abc", role: "admin" },
      data: { users: [1, 2] },
    });
  });

  it("puts keys without separator under _root", () => {
    const result = denormalizeFlatKeys({
      globalFlag: true,
      version: 3,
    });

    expect(result).toEqual({
      _root: { globalFlag: true, version: 3 },
    });
  });

  it("handles mixed prefixed and unprefixed keys", () => {
    const result = denormalizeFlatKeys({
      "auth::token": "x",
      standalone: "y",
    });

    expect(result).toEqual({
      auth: { token: "x" },
      _root: { standalone: "y" },
    });
  });

  it("returns empty object for empty input", () => {
    expect(denormalizeFlatKeys({})).toEqual({});
  });

  it("handles values of various types", () => {
    const result = denormalizeFlatKeys({
      "ns::str": "hello",
      "ns::num": 42,
      "ns::bool": false,
      "ns::null": null,
      "ns::arr": [1, 2, 3],
      "ns::obj": { nested: true },
    });

    expect(result.ns).toEqual({
      str: "hello",
      num: 42,
      bool: false,
      null: null,
      arr: [1, 2, 3],
      obj: { nested: true },
    });
  });

  it("handles multiple namespaces", () => {
    const result = denormalizeFlatKeys({
      "a::x": 1,
      "b::y": 2,
      "c::z": 3,
    });

    expect(Object.keys(result).sort()).toEqual(["a", "b", "c"]);
    expect(result.a).toEqual({ x: 1 });
    expect(result.b).toEqual({ y: 2 });
    expect(result.c).toEqual({ z: 3 });
  });

  it("does not confuse :: in the local key name", () => {
    // Only the first :: is the separator, since indexOf finds first occurrence
    const result = denormalizeFlatKeys({
      "ns::key::extra": "val",
    });

    expect(result.ns).toEqual({ "key::extra": "val" });
  });
});

// ============================================================================
// getOwnPropertyDescriptor trap
// ============================================================================

describe("getOwnPropertyDescriptor trap", () => {
  it("returns configurable+enumerable for existing module facts keys", () => {
    const facts: Record<string, unknown> = { "auth::token": "abc" };
    const proxy = createModuleFactsProxy(facts, "auth");
    const desc = Object.getOwnPropertyDescriptor(proxy, "token");

    expect(desc?.configurable).toBe(true);
    expect(desc?.enumerable).toBe(true);
  });

  it("returns undefined for missing keys", () => {
    const facts: Record<string, unknown> = {};
    const proxy = createModuleFactsProxy(facts, "auth");
    const desc = Object.getOwnPropertyDescriptor(proxy, "missing");

    expect(desc).toBeUndefined();
  });

  it("returns undefined for symbol properties", () => {
    const facts: Record<string, unknown> = {};
    const proxy = createModuleFactsProxy(facts, "auth");
    const desc = Object.getOwnPropertyDescriptor(proxy, Symbol("x") as any);

    expect(desc).toBeUndefined();
  });
});

// ============================================================================
// ownKeys trap
// ============================================================================

describe("ownKeys trap", () => {
  it("returns empty array for proxies without ownKeys config", () => {
    // Module derive proxy has `has` but no `ownKeys`
    const derive: Record<string, unknown> = { "ns::a": 1 };
    const proxy = createModuleDeriveProxy(derive, "ns");

    expect(Object.keys(proxy)).toEqual([]);
  });

  it("returns module names for namespaced facts proxy", () => {
    const facts: Record<string, unknown> = { "a::x": 1, "b::y": 2 };
    const modulesMap = { a: {}, b: {} };
    const proxy = createNamespacedFactsProxy(facts, modulesMap as any, () => [
      "a",
      "b",
    ]);

    expect(Object.keys(proxy)).toEqual(["a", "b"]);
  });

  it("reflects dynamic module registration via getModuleNames", () => {
    const facts: Record<string, unknown> = {};
    const modulesMap: Record<string, unknown> = { a: {} };
    let names = ["a"];

    const proxy = createNamespacedFactsProxy(
      facts,
      modulesMap as any,
      () => names,
    );

    expect(Object.keys(proxy)).toEqual(["a"]);

    // Simulate dynamic registration
    modulesMap.b = {};
    names = ["a", "b"];

    expect(Object.keys(proxy)).toEqual(["a", "b"]);
  });
});

// ============================================================================
// Cross-proxy interaction edge cases
// ============================================================================

describe("cross-proxy interaction", () => {
  it("module facts proxy set is visible through namespaced proxy", () => {
    const facts: Record<string, unknown> = {};
    const modulesMap = { auth: {} };

    const moduleProxy = createModuleFactsProxy(facts, "auth");
    const nsProxy = createNamespacedFactsProxy(facts, modulesMap as any, () => [
      "auth",
    ]);

    moduleProxy.token = "hello";

    expect(nsProxy.auth!.token).toBe("hello");
  });

  it("cross-module proxy self writes are visible in namespaced proxy", () => {
    const facts: Record<string, unknown> = {};
    const modulesMap = { users: {}, auth: {} };

    const crossProxy = createCrossModuleFactsProxy(facts, "users", ["auth"]);
    const nsProxy = createNamespacedFactsProxy(facts, modulesMap as any, () => [
      "users",
      "auth",
    ]);

    crossProxy.self!.count = 5;

    expect(nsProxy.users!.count).toBe(5);
    expect(facts["users::count"]).toBe(5);
  });
});

// ============================================================================
// Inspection hook on hardened proxies (Item 3 — pretty-format crash)
// ============================================================================

describe("hardened proxy util.inspect.custom hook", () => {
  const inspectSym = Symbol.for("nodejs.util.inspect.custom");

  it("module facts proxy renders snapshot via util.inspect.custom", () => {
    const facts: Record<string, unknown> = {
      "auth::token": "abc",
      "auth::role": "admin",
    };
    const proxy = createModuleFactsProxy(facts, "auth");

    const inspect = (proxy as unknown as Record<symbol, unknown>)[inspectSym];
    // No ownKeys configured on createModuleFactsProxy → snapshot is empty
    // but the function exists and does not throw on access.
    expect(typeof inspect).toBe("function");
    expect((inspect as () => unknown)()).toEqual({});
  });

  it("namespaced facts proxy snapshot enumerates module namespaces", () => {
    const facts: Record<string, unknown> = { "auth::token": "abc" };
    const modulesMap = { auth: {} };
    const proxy = createNamespacedFactsProxy(
      facts,
      modulesMap as any,
      () => ["auth"],
    );

    const inspect = (proxy as unknown as Record<symbol, unknown>)[inspectSym];
    expect(typeof inspect).toBe("function");
    const snap = (inspect as () => unknown)() as Record<string, unknown>;
    // Snapshot delegates: top-level key is the namespace, value is the
    // per-module proxy (we don't deep-snapshot inner proxies — printers
    // handle that recursively).
    expect(Object.keys(snap)).toEqual(["auth"]);
  });

  it("node:util inspect on namespaced proxy does not throw", async () => {
    const { inspect } = await import("node:util");
    const facts: Record<string, unknown> = { "auth::token": "abc" };
    const modulesMap = { auth: {} };
    const proxy = createNamespacedFactsProxy(
      facts,
      modulesMap as any,
      () => ["auth"],
    );

    // Just ensure inspection completes without crashing — exact format
    // is not asserted (varies by node version).
    expect(() => inspect(proxy)).not.toThrow();
  });
});
