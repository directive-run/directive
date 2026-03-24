import { describe, expect, it, vi } from "vitest";
import { t } from "../../index.js";
import {
  createFacts,
  createFactsProxy,
  createFactsStore,
} from "../../internals.js";

// ============================================================================
// Store Core
// ============================================================================

describe("createFactsStore", () => {
  describe("get and set", () => {
    it("stores and retrieves a value", () => {
      const store = createFactsStore({
        schema: { count: t.number() },
        validate: false,
      });

      store.set("count", 10);

      expect(store.get("count")).toBe(10);
    });

    it("returns undefined for keys that have not been set", () => {
      const store = createFactsStore({
        schema: { name: t.string() },
        validate: false,
      });

      expect(store.get("name")).toBeUndefined();
    });

    it("overwrites a previously set value", () => {
      const store = createFactsStore({
        schema: { count: t.number() },
        validate: false,
      });

      store.set("count", 1);
      store.set("count", 2);

      expect(store.get("count")).toBe(2);
    });

    it("skips notification when value has not changed (Object.is)", () => {
      const store = createFactsStore({
        schema: { count: t.number() },
        validate: false,
      });

      store.set("count", 5);
      const listener = vi.fn();
      store.subscribe(["count"], listener);

      store.set("count", 5);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("has", () => {
    it("returns true for a key that has been set", () => {
      const store = createFactsStore({
        schema: { active: t.boolean() },
        validate: false,
      });

      store.set("active", true);

      expect(store.has("active")).toBe(true);
    });

    it("returns false for a key that has not been set", () => {
      const store = createFactsStore({
        schema: { active: t.boolean() },
        validate: false,
      });

      expect(store.has("active")).toBe(false);
    });
  });

  describe("delete", () => {
    it("removes a key so get returns undefined and has returns false", () => {
      const store = createFactsStore({
        schema: { name: t.string() },
        validate: false,
      });

      store.set("name", "hello");
      store.delete("name");

      expect(store.get("name")).toBeUndefined();
      expect(store.has("name")).toBe(false);
    });

    it("notifies subscribers when a key is deleted", () => {
      const store = createFactsStore({
        schema: { name: t.string() },
        validate: false,
      });

      store.set("name", "hello");
      const listener = vi.fn();
      store.subscribe(["name"], listener);

      store.delete("name");

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("toObject", () => {
    it("returns a plain object snapshot of all set keys", () => {
      const store = createFactsStore({
        schema: { a: t.string(), b: t.number() },
        validate: false,
      });

      store.set("a", "hello");
      store.set("b", 42);

      expect(store.toObject()).toEqual({ a: "hello", b: 42 });
    });

    it("excludes deleted keys", () => {
      const store = createFactsStore({
        schema: { a: t.string(), b: t.number() },
        validate: false,
      });

      store.set("a", "hello");
      store.set("b", 42);
      store.delete("b");

      expect(store.toObject()).toEqual({ a: "hello" });
    });

    it("returns an empty object when nothing has been set", () => {
      const store = createFactsStore({
        schema: { x: t.string() },
        validate: false,
      });

      expect(store.toObject()).toEqual({});
    });
  });

  describe("batch", () => {
    it("coalesces notifications — subscriber fires once, not per-set", () => {
      const store = createFactsStore({
        schema: { a: t.string(), b: t.number() },
        validate: false,
      });

      const listener = vi.fn();
      store.subscribeAll(listener);

      store.batch(() => {
        store.set("a", "x");
        store.set("b", 1);
      });

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("fires key-specific listeners once per dirty key after batch", () => {
      const store = createFactsStore({
        schema: { a: t.string(), b: t.number() },
        validate: false,
      });

      const listenerA = vi.fn();
      const listenerB = vi.fn();
      store.subscribe(["a"], listenerA);
      store.subscribe(["b"], listenerB);

      store.batch(() => {
        store.set("a", "x");
        store.set("b", 1);
      });

      expect(listenerA).toHaveBeenCalledTimes(1);
      expect(listenerB).toHaveBeenCalledTimes(1);
    });

    it("does not notify if batch makes no changes", () => {
      const store = createFactsStore({
        schema: { a: t.string() },
        validate: false,
      });

      const listener = vi.fn();
      store.subscribeAll(listener);

      store.batch(() => {
        // no-op
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it("nested batch — notifications fire after outermost batch ends", () => {
      const store = createFactsStore({
        schema: { a: t.string(), b: t.number() },
        validate: false,
      });

      const listener = vi.fn();
      store.subscribeAll(listener);

      store.batch(() => {
        store.set("a", "outer");

        store.batch(() => {
          store.set("b", 99);
          // inner batch ends, but outer is still open
          expect(listener).not.toHaveBeenCalled();
        });

        // still inside outer batch — inner flush should have been suppressed
        expect(listener).not.toHaveBeenCalled();
      });

      // outer batch ends, now notifications fire
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("calls onBatch callback with change records", () => {
      const onBatch = vi.fn();
      const store = createFactsStore({
        schema: { a: t.string(), b: t.number() },
        validate: false,
        onBatch,
      });

      store.batch(() => {
        store.set("a", "hello");
        store.set("b", 42);
      });

      expect(onBatch).toHaveBeenCalledTimes(1);
      const changes = onBatch.mock.calls[0]![0];
      expect(changes).toHaveLength(2);
      expect(changes[0]).toMatchObject({
        key: "a",
        value: "hello",
        type: "set",
      });
      expect(changes[1]).toMatchObject({ key: "b", value: 42, type: "set" });
    });
  });

  describe("subscribe", () => {
    it("fires listener when a subscribed key changes", () => {
      const store = createFactsStore({
        schema: { x: t.number() },
        validate: false,
      });

      const listener = vi.fn();
      store.subscribe(["x"], listener);

      store.set("x", 1);

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("does not fire listener for unrelated key changes", () => {
      const store = createFactsStore({
        schema: { x: t.number(), y: t.number() },
        validate: false,
      });

      const listener = vi.fn();
      store.subscribe(["x"], listener);

      store.set("y", 99);

      expect(listener).not.toHaveBeenCalled();
    });

    it("fires for multiple subscribed keys", () => {
      const store = createFactsStore({
        schema: { a: t.string(), b: t.string() },
        validate: false,
      });

      const listener = vi.fn();
      store.subscribe(["a", "b"], listener);

      store.set("a", "one");
      store.set("b", "two");

      expect(listener).toHaveBeenCalledTimes(2);
    });

    it("returns an unsubscribe function that prevents further notifications", () => {
      const store = createFactsStore({
        schema: { x: t.number() },
        validate: false,
      });

      const listener = vi.fn();
      const unsub = store.subscribe(["x"], listener);

      store.set("x", 1);
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
      store.set("x", 2);

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("subscribeAll", () => {
    it("fires listener on any key change", () => {
      const store = createFactsStore({
        schema: { a: t.string(), b: t.number() },
        validate: false,
      });

      const listener = vi.fn();
      store.subscribeAll(listener);

      store.set("a", "hello");
      store.set("b", 1);

      expect(listener).toHaveBeenCalledTimes(2);
    });

    it("returns an unsubscribe function that works", () => {
      const store = createFactsStore({
        schema: { a: t.string() },
        validate: false,
      });

      const listener = vi.fn();
      const unsub = store.subscribeAll(listener);

      store.set("a", "one");
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
      store.set("a", "two");

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("registerKeys", () => {
    it("adds new schema keys to the store", () => {
      const schema = { a: t.string() };
      const store = createFactsStore({ schema, validate: false });

      // registerKeys is an internal method patched onto the store
      const storeWithRegister = store as unknown as {
        registerKeys: (s: Record<string, unknown>) => void;
      };
      storeWithRegister.registerKeys({ b: t.number() });

      store.set("b" as never, 42 as never);

      expect(store.get("b" as never)).toBe(42);
    });

    it("blocks prototype pollution keys", () => {
      const schema = { a: t.string() };
      const store = createFactsStore({ schema, validate: false });

      const storeWithRegister = store as unknown as {
        registerKeys: (s: Record<string, unknown>) => void;
      };
      storeWithRegister.registerKeys({
        __proto__: t.string(),
        constructor: t.string(),
        prototype: t.string(),
      });

      // These keys should have been skipped
      expect(Object.keys(schema)).not.toContain("__proto__");
      expect(Object.keys(schema)).not.toContain("constructor");
      expect(Object.keys(schema)).not.toContain("prototype");
    });
  });

  describe("onChange callback", () => {
    it("fires onChange for each non-batched set", () => {
      const onChange = vi.fn();
      const store = createFactsStore({
        schema: { x: t.number() },
        validate: false,
        onChange,
      });

      store.set("x", 10);

      expect(onChange).toHaveBeenCalledWith("x", 10, undefined);
    });
  });
});

// ============================================================================
// Proxy
// ============================================================================

describe("createFactsProxy", () => {
  function makeProxy() {
    const schema = { phase: t.string(), count: t.number() };
    const store = createFactsStore({ schema, validate: false });
    const facts = createFactsProxy(store, schema);

    return { store, facts, schema };
  }

  describe("get", () => {
    it("reads from the underlying store", () => {
      const { store, facts } = makeProxy();

      store.set("phase", "red");

      expect(facts.phase).toBe("red");
    });

    it("returns undefined for unset keys", () => {
      const { facts } = makeProxy();

      expect(facts.phase).toBeUndefined();
    });
  });

  describe("set", () => {
    it("writes to the underlying store", () => {
      const { store, facts } = makeProxy();

      facts.phase = "green";

      expect(store.get("phase")).toBe("green");
    });
  });

  describe("has (in operator)", () => {
    it("returns true for keys present in the store", () => {
      const { facts } = makeProxy();

      facts.phase = "red";

      expect("phase" in facts).toBe(true);
    });

    it("returns false for keys not in the store", () => {
      const { facts } = makeProxy();

      expect("phase" in facts).toBe(false);
    });

    it("returns true for $store and $snapshot", () => {
      const { facts } = makeProxy();

      expect("$store" in facts).toBe(true);
      expect("$snapshot" in facts).toBe(true);
    });
  });

  describe("deleteProperty", () => {
    it("removes a key from the store", () => {
      const { store, facts } = makeProxy();

      facts.phase = "red";
      // biome-ignore lint/performance/noDelete: Testing proxy deleteProperty trap
      delete (facts as Record<string, unknown>).phase;

      expect(store.has("phase")).toBe(false);
      expect(store.get("phase")).toBeUndefined();
    });
  });

  describe("ownKeys", () => {
    it("returns schema keys", () => {
      const { facts } = makeProxy();

      const keys = Object.keys(facts);

      expect(keys).toContain("phase");
      expect(keys).toContain("count");
      expect(keys).toHaveLength(2);
    });
  });

  describe("$store", () => {
    it("returns the underlying store", () => {
      const { store, facts } = makeProxy();

      expect(facts.$store).toBe(store);
    });
  });

  describe("$snapshot", () => {
    it("returns a snapshot function", () => {
      const { facts } = makeProxy();

      expect(typeof facts.$snapshot).toBe("function");
    });

    it("snapshot reads values without tracking", () => {
      const { facts } = makeProxy();

      facts.phase = "red";
      const snap = facts.$snapshot();

      expect(snap.get("phase")).toBe("red");
      expect(snap.has("phase")).toBe(true);
    });
  });

  describe("BLOCKED_PROPS", () => {
    it("returns undefined for __proto__", () => {
      const { facts } = makeProxy();

      expect(
        (facts as unknown as Record<string, unknown>).__proto__,
      ).toBeUndefined();
    });

    it("returns undefined for constructor", () => {
      const { facts } = makeProxy();

      expect(
        (facts as unknown as Record<string, unknown>).constructor,
      ).toBeUndefined();
    });

    it("returns undefined for prototype", () => {
      const { facts } = makeProxy();

      expect(
        (facts as unknown as Record<string, unknown>).prototype,
      ).toBeUndefined();
    });

    it("returns false for set on __proto__", () => {
      const { facts } = makeProxy();

      const result = Reflect.set(facts, "__proto__", "bad");

      expect(result).toBe(false);
    });

    it("returns false for set on constructor", () => {
      const { facts } = makeProxy();

      const result = Reflect.set(facts, "constructor", "bad");

      expect(result).toBe(false);
    });

    it("returns false for set on prototype", () => {
      const { facts } = makeProxy();

      const result = Reflect.set(facts, "prototype", "bad");

      expect(result).toBe(false);
    });

    it("returns false for has on blocked props", () => {
      const { facts } = makeProxy();

      expect("__proto__" in facts).toBe(false);
      expect("constructor" in facts).toBe(false);
      expect("prototype" in facts).toBe(false);
    });
  });

  describe("symbol properties", () => {
    it("returns undefined for symbol get", () => {
      const { facts } = makeProxy();
      const sym = Symbol("test");

      expect(
        (facts as unknown as Record<symbol, unknown>)[sym],
      ).toBeUndefined();
    });

    it("returns false for symbol set", () => {
      const { facts } = makeProxy();
      const sym = Symbol("test");

      const result = Reflect.set(facts, sym, "value");

      expect(result).toBe(false);
    });

    it("returns false for symbol has", () => {
      const { facts } = makeProxy();
      const sym = Symbol("test");

      expect(Reflect.has(facts, sym)).toBe(false);
    });
  });

  describe("defineProperty", () => {
    it("returns false — prevents bypassing set trap", () => {
      const { facts } = makeProxy();

      const result = Reflect.defineProperty(facts, "phase", {
        value: "injected",
      });

      expect(result).toBe(false);
    });
  });

  describe("getPrototypeOf", () => {
    it("returns null", () => {
      const { facts } = makeProxy();

      expect(Reflect.getPrototypeOf(facts as object)).toBeNull();
    });
  });

  describe("setPrototypeOf", () => {
    it("returns false", () => {
      const { facts } = makeProxy();

      const result = Reflect.setPrototypeOf(facts as object, {});

      expect(result).toBe(false);
    });
  });

  describe("deleteProperty on special keys", () => {
    it("returns false for $store", () => {
      const { facts } = makeProxy();

      const result = Reflect.deleteProperty(facts, "$store");

      expect(result).toBe(false);
    });

    it("returns false for $snapshot", () => {
      const { facts } = makeProxy();

      const result = Reflect.deleteProperty(facts, "$snapshot");

      expect(result).toBe(false);
    });

    it("returns false for blocked props", () => {
      const { facts } = makeProxy();

      expect(Reflect.deleteProperty(facts, "__proto__")).toBe(false);
      expect(Reflect.deleteProperty(facts, "constructor")).toBe(false);
      expect(Reflect.deleteProperty(facts, "prototype")).toBe(false);
    });
  });
});

// ============================================================================
// Schema Validators (dev mode)
// ============================================================================

describe("schema validators (t.*)", () => {
  describe("t.string()", () => {
    it("accepts strings", () => {
      const store = createFactsStore({
        schema: { s: t.string() },
        validate: true,
      });

      store.set("s", "hello");

      expect(store.get("s")).toBe("hello");
    });

    it("rejects non-strings", () => {
      const store = createFactsStore({
        schema: { s: t.string() },
        validate: true,
      });

      expect(() => store.set("s", 123 as never)).toThrow(
        /Validation failed.*expected string/,
      );
    });
  });

  describe("t.number()", () => {
    it("accepts numbers", () => {
      const store = createFactsStore({
        schema: { n: t.number() },
        validate: true,
      });

      store.set("n", 42);

      expect(store.get("n")).toBe(42);
    });

    it("rejects non-numbers", () => {
      const store = createFactsStore({
        schema: { n: t.number() },
        validate: true,
      });

      expect(() => store.set("n", "nope" as never)).toThrow(
        /Validation failed.*expected number/,
      );
    });

    it("validates min constraint", () => {
      const store = createFactsStore({
        schema: { n: t.number().min(0) },
        validate: true,
      });

      expect(() => store.set("n", -1)).toThrow(/Validation failed/);
      store.set("n", 0);

      expect(store.get("n")).toBe(0);
    });

    it("validates max constraint", () => {
      const store = createFactsStore({
        schema: { n: t.number().max(100) },
        validate: true,
      });

      expect(() => store.set("n", 101)).toThrow(/Validation failed/);
      store.set("n", 100);

      expect(store.get("n")).toBe(100);
    });
  });

  describe("t.boolean()", () => {
    it("accepts booleans", () => {
      const store = createFactsStore({
        schema: { b: t.boolean() },
        validate: true,
      });

      store.set("b", true);

      expect(store.get("b")).toBe(true);
    });

    it("rejects non-booleans", () => {
      const store = createFactsStore({
        schema: { b: t.boolean() },
        validate: true,
      });

      expect(() => store.set("b", "yes" as never)).toThrow(
        /Validation failed.*expected boolean/,
      );
    });
  });

  describe("t.array()", () => {
    it("accepts arrays", () => {
      const store = createFactsStore({
        schema: { arr: t.array<string>() },
        validate: true,
      });

      store.set("arr", ["a", "b"]);

      expect(store.get("arr")).toEqual(["a", "b"]);
    });

    it("rejects non-arrays", () => {
      const store = createFactsStore({
        schema: { arr: t.array<string>() },
        validate: true,
      });

      expect(() => store.set("arr", "not-array" as never)).toThrow(
        /Validation failed.*expected array/,
      );
    });

    it("validates element types with .of()", () => {
      const store = createFactsStore({
        schema: { arr: t.array<number>().of(t.number()) },
        validate: true,
      });

      expect(() => store.set("arr", ["a", "b"] as never)).toThrow(
        /Validation failed/,
      );
      store.set("arr", [1, 2, 3]);

      expect(store.get("arr")).toEqual([1, 2, 3]);
    });
  });

  describe("t.nullable()", () => {
    it("accepts null", () => {
      const store = createFactsStore({
        schema: { val: t.nullable(t.string()) },
        validate: true,
      });

      store.set("val", null);

      expect(store.get("val")).toBeNull();
    });

    it("accepts the inner type", () => {
      const store = createFactsStore({
        schema: { val: t.nullable(t.string()) },
        validate: true,
      });

      store.set("val", "hello");

      expect(store.get("val")).toBe("hello");
    });

    it("rejects non-null non-matching values", () => {
      const store = createFactsStore({
        schema: { val: t.nullable(t.string()) },
        validate: true,
      });

      expect(() => store.set("val", 42 as never)).toThrow(/Validation failed/);
    });
  });

  describe("t.optional()", () => {
    it("accepts undefined", () => {
      const store = createFactsStore({
        schema: { val: t.optional(t.number()) },
        validate: true,
      });

      store.set("val", undefined);

      expect(store.get("val")).toBeUndefined();
    });

    it("accepts the inner type", () => {
      const store = createFactsStore({
        schema: { val: t.optional(t.number()) },
        validate: true,
      });

      store.set("val", 5);

      expect(store.get("val")).toBe(5);
    });

    it("rejects non-undefined non-matching values", () => {
      const store = createFactsStore({
        schema: { val: t.optional(t.number()) },
        validate: true,
      });

      expect(() => store.set("val", "nope" as never)).toThrow(
        /Validation failed/,
      );
    });
  });

  describe("t.object()", () => {
    it("accepts plain objects", () => {
      const store = createFactsStore({
        schema: { obj: t.object<{ id: number }>() },
        validate: true,
      });

      store.set("obj", { id: 1 });

      expect(store.get("obj")).toEqual({ id: 1 });
    });

    it("rejects arrays", () => {
      const store = createFactsStore({
        schema: { obj: t.object<{ id: number }>() },
        validate: true,
      });

      expect(() => store.set("obj", [1, 2] as never)).toThrow(
        /Validation failed.*expected object/,
      );
    });

    it("rejects null", () => {
      const store = createFactsStore({
        schema: { obj: t.object<{ id: number }>() },
        validate: true,
      });

      expect(() => store.set("obj", null as never)).toThrow(
        /Validation failed.*expected object/,
      );
    });
  });

  describe("strictKeys", () => {
    it("throws on unknown keys when strictKeys is true", () => {
      const store = createFactsStore({
        schema: { known: t.string() },
        validate: true,
        strictKeys: true,
      });

      expect(() => store.set("unknown" as never, "val" as never)).toThrow(
        /Unknown fact key.*"unknown"/,
      );
    });
  });
});

// ============================================================================
// Re-entrance Guards
// ============================================================================

describe("re-entrance guards", () => {
  it("notifyNonBatched coalesces — store.set during notification is deferred", () => {
    const store = createFactsStore({
      schema: { a: t.number(), b: t.number() },
      validate: false,
    });

    const callOrder: string[] = [];

    // Subscribe to "a" — when notified, mutate "b"
    store.subscribe(["a"], () => {
      callOrder.push("a-listener");
      store.set("b", 100);
    });

    // Subscribe to "b" — track that it fires
    store.subscribe(["b"], () => {
      callOrder.push("b-listener");
    });

    store.set("a", 1);

    // a-listener fires first (synchronous), then b-listener fires
    // in the deferred cycle — NOT interleaved
    expect(callOrder).toEqual(["a-listener", "b-listener"]);

    // Both values should be set
    expect(store.get("a")).toBe(1);
    expect(store.get("b")).toBe(100);
  });

  it("deferred changes during batch flush are also processed", () => {
    const store = createFactsStore({
      schema: { a: t.number(), b: t.number() },
      validate: false,
    });

    const callOrder: string[] = [];

    store.subscribe(["a"], () => {
      callOrder.push("a-listener");
      store.set("b", 200);
    });

    store.subscribe(["b"], () => {
      callOrder.push("b-listener");
    });

    store.batch(() => {
      store.set("a", 10);
    });

    expect(callOrder).toEqual(["a-listener", "b-listener"]);
    expect(store.get("b")).toBe(200);
  });

  it("throws on infinite notification loops", () => {
    const store = createFactsStore({
      schema: { x: t.number() },
      validate: false,
    });

    let counter = 0;
    store.subscribe(["x"], () => {
      counter++;
      // Endlessly re-trigger by setting a new value each time
      store.set("x", counter);
    });

    expect(() => store.set("x", 0)).toThrow(
      /Infinite notification loop detected/,
    );
  });
});

// ============================================================================
// createFacts (combined factory)
// ============================================================================

describe("createFacts", () => {
  it("returns both store and facts proxy", () => {
    const { store, facts } = createFacts({
      schema: { name: t.string(), age: t.number() },
      validate: false,
    });

    facts.name = "Alice";
    facts.age = 30;

    expect(store.get("name")).toBe("Alice");
    expect(store.get("age")).toBe(30);
    expect(facts.name).toBe("Alice");
    expect(facts.age).toBe(30);
  });

  it("proxy $store matches the returned store", () => {
    const { store, facts } = createFacts({
      schema: { x: t.number() },
      validate: false,
    });

    expect(facts.$store).toBe(store);
  });

  it("validates through the proxy when validate is true", () => {
    const { facts } = createFacts({
      schema: { count: t.number() },
      validate: true,
    });

    expect(() => {
      (facts as Record<string, unknown>).count = "bad";
    }).toThrow(/Validation failed/);
  });
});

// ============================================================================
// Nested Mutation Detection (dev mode)
// ============================================================================

describe("nested mutation detection (dev mode)", () => {
  it("warns when setting a nested property on an object fact", () => {
    const { facts } = createFacts({
      schema: { user: t.object<{ name: string; age: number }>() },
      validate: false,
    });

    facts.user = { name: "Alice", age: 30 };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    (facts.user as { name: string }).name = "Bob";

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Nested mutation on "facts.user.name"'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("will not trigger reactivity"),
    );
    warnSpy.mockRestore();
  });

  it("warns on deeply nested mutations", () => {
    const { facts } = createFacts({
      schema: {
        config: t.object<{ db: { host: string; port: number } }>(),
      },
      validate: false,
    });

    facts.config = { db: { host: "localhost", port: 5432 } };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    (facts.config as { db: { host: string } }).db.host = "remote";

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Nested mutation on "facts.config.db.host"'),
    );
    warnSpy.mockRestore();
  });

  it("includes spread pattern suggestion in warning", () => {
    const { facts } = createFacts({
      schema: { user: t.object<{ name: string }>() },
      validate: false,
    });

    facts.user = { name: "Alice" };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    (facts.user as { name: string }).name = "Bob";

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("facts.user = { ...facts.user, ... }"),
    );
    warnSpy.mockRestore();
  });

  it("does not warn on top-level assignment (normal reactivity)", () => {
    const { facts } = createFacts({
      schema: { user: t.object<{ name: string }>() },
      validate: false,
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    facts.user = { name: "Alice" };

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("does not wrap primitive values", () => {
    const { facts } = createFacts({
      schema: { count: t.number(), label: t.string() },
      validate: false,
    });

    facts.count = 5;
    facts.label = "test";

    // Primitives can't have properties set on them — just verify no error
    expect(facts.count).toBe(5);
    expect(facts.label).toBe("test");
  });

  it("does not wrap null values", () => {
    const { facts } = createFacts({
      schema: { data: t.nullable(t.object<{ x: number }>()) },
      validate: false,
    });

    facts.data = null;

    // null should pass through without wrapping
    expect(facts.data).toBeNull();
  });

  it("warns on array index mutation", () => {
    const { facts } = createFacts({
      schema: { items: t.array<string>() },
      validate: false,
    });

    facts.items = ["a", "b", "c"];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    (facts.items as string[])[0] = "z";

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Nested mutation on "facts.items.0"'),
    );
    warnSpy.mockRestore();
  });

  it("the actual mutation still takes effect (non-breaking)", () => {
    const { facts, store } = createFacts({
      schema: { user: t.object<{ name: string }>() },
      validate: false,
    });

    facts.user = { name: "Alice" };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    (facts.user as { name: string }).name = "Bob";

    // The mutation happens on the underlying object (just no reactivity)
    const raw = store.get("user") as { name: string };
    expect(raw.name).toBe("Bob");
    warnSpy.mockRestore();
  });

  it("reads through the warning proxy return correct values", () => {
    const { facts } = createFacts({
      schema: {
        user: t.object<{ name: string; address: { city: string } }>(),
      },
      validate: false,
    });

    facts.user = { name: "Alice", address: { city: "NYC" } };

    // Reading nested values should work normally
    expect((facts.user as { name: string }).name).toBe("Alice");
    expect((facts.user as { address: { city: string } }).address.city).toBe(
      "NYC",
    );
  });
});
