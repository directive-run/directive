import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../index.js";
import {
  createFacts,
  createFactsProxy,
  createFactsStore,
} from "../../internals.js";

// Written to kill surviving Stryker mutants of facts.ts. Black-box only: the
// public entry and the `internals` subpath the facts tests already use.

afterEach(() => {
  vi.restoreAllMocks();
});

function messageOf(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }

  return "<did not throw>";
}

/** A minimal object that quacks like a Zod schema. */
function zodLike(overrides: Record<string, unknown> = {}) {
  return {
    safeParse: (v: unknown) =>
      typeof v === "number"
        ? { success: true }
        : { success: false, error: { message: "must be a number" } },
    parse: () => undefined,
    _def: { typeName: "ZodNumber" },
    ...overrides,
  };
}

function zodStore(schemaEntry: unknown, extra: Record<string, unknown> = {}) {
  return createFactsStore({
    schema: { k: schemaEntry } as never,
    validate: true,
    strictKeys: true,
    ...extra,
  }) as { set(k: string, v: unknown): void; get(k: string): unknown };
}

describe("validation message previews", () => {
  it("shows a JSON preview of an object value", () => {
    const store = createFactsStore({
      schema: { s: t.string() },
      validate: true,
    });

    expect(messageOf(() => store.set("s", { a: 1 } as never))).toContain(
      'got object {"a":1}',
    );
  });

  it("falls back to String() when the value has no JSON form", () => {
    const store = createFactsStore({
      schema: { s: t.string() },
      validate: true,
    });

    expect(messageOf(() => store.set("s", undefined as never))).toContain(
      "got undefined undefined",
    );
  });

  it("truncates the preview to 100 characters", () => {
    const store = createFactsStore({
      schema: { s: t.string() },
      validate: true,
    });
    const long = Array.from({ length: 200 }, (_, i) => i);
    const message = messageOf(() => store.set("s", long as never));
    const preview = JSON.stringify(long);

    expect(message).toContain(`got array ${preview.slice(0, 100)}`);
    expect(message).not.toContain(preview.slice(0, 101));
  });

  it("survives a value that cannot be serialized", () => {
    const store = createFactsStore({
      schema: { s: t.string() },
      validate: true,
    });
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(messageOf(() => store.set("s", circular as never))).toContain(
      "[circular or non-serializable]",
    );
  });

  it("labels null and arrays distinctly from other objects", () => {
    const store = createFactsStore({
      schema: { s: t.string() },
      validate: true,
    });

    expect(messageOf(() => store.set("s", null as never))).toContain(
      "got null null",
    );
    expect(messageOf(() => store.set("s", [] as never))).toContain(
      "got array []",
    );
    expect(messageOf(() => store.set("s", 7 as never))).toContain(
      "got number 7",
    );
  });

  it("redacts the value when redactErrors is on, and only then", () => {
    const redacting = createFactsStore({
      schema: { s: t.string() },
      validate: true,
      redactErrors: true,
    });
    const message = messageOf(() => redacting.set("s", 424242 as never));

    expect(message).toContain("[redacted]");
    expect(message).not.toContain("424242");

    const plain = createFactsStore({
      schema: { s: t.string() },
      validate: true,
    });

    expect(messageOf(() => plain.set("s", 424242 as never))).toContain(
      "424242",
    );
  });

  it("names which validator failed past the first, with a 1-based index", () => {
    const store = createFactsStore({
      schema: { n: t.number().min(1).max(5) },
      validate: true,
    });

    // first validator is the type check: no hint
    expect(messageOf(() => store.set("n", "x" as never))).not.toContain(
      "validator",
    );
    expect(messageOf(() => store.set("n", 0))).toContain(
      "(validator 2 failed)",
    );
    expect(messageOf(() => store.set("n", 9))).toContain(
      "(validator 3 failed)",
    );
  });

  it("reports the failing array element, then forgets it", () => {
    const store = createFactsStore({
      schema: { xs: t.array<number>().of(t.number()) },
      validate: true,
    });

    expect(messageOf(() => store.set("xs", ["a"] as never))).toContain(
      "(element at index 0 failed)",
    );
    expect(messageOf(() => store.set("xs", [1, 2, "c"] as never))).toContain(
      "(element at index 2 failed)",
    );
    // a failure that is not an element failure carries no stale index
    expect(messageOf(() => store.set("xs", "nope" as never))).not.toContain(
      "element at index",
    );
  });
});

describe("option defaults", () => {
  it("validates and throws on unknown keys by default in development", () => {
    const store = createFactsStore({ schema: { n: t.number() } });

    expect(messageOf(() => store.set("n", "x" as never))).toContain(
      "Validation failed",
    );
    expect(messageOf(() => store.set("zzz" as never, 1 as never))).toContain(
      'Unknown fact key: "zzz"',
    );
  });

  it("only warns about unknown keys when the schema is a bare type assertion", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = createFactsStore({ schema: {} as never });

    expect(() => store.set("anything" as never, 1 as never)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Unknown fact key: "anything"'),
    );
    expect(store.get("anything" as never)).toBe(1);
  });

  it("honours explicit strictKeys and validate settings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lax = createFactsStore({
      schema: { n: t.number() },
      strictKeys: false,
    });

    expect(() => lax.set("zzz" as never, 1 as never)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);

    const strictEmpty = createFactsStore({
      schema: {} as never,
      strictKeys: true,
    });

    expect(() => strictEmpty.set("zzz" as never, 1 as never)).toThrow(
      /Unknown fact key/,
    );

    const off = createFactsStore({
      schema: { n: t.number() },
      validate: false,
    });
    warn.mockClear();

    expect(() => off.set("n", "x" as never)).not.toThrow();
    expect(() => off.set("zzz" as never, 1 as never)).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
    expect(off.get("n")).toBe("x");
    expect(off.get("zzz" as never)).toBe(1);
  });

  it("accepts values that pass validation", () => {
    const store = createFactsStore({ schema: { n: t.number() } });
    store.set("n", 3);

    expect(store.get("n")).toBe(3);
  });
});

describe("schemas written with a safeParse method", () => {
  it("validates through safeParse and reports the lower-cased type name", () => {
    const store = zodStore(zodLike());

    expect(() => store.set("k", 1)).not.toThrow();
    const message = messageOf(() => store.set("k", "x"));

    expect(message).toContain('Validation failed for "k"');
    expect(message).toContain("expected number, got string");
    expect(message).toContain("must be a number");
  });

  it("only strips a leading Zod from the type name", () => {
    const store = zodStore(zodLike({ _def: { typeName: "MyZodString" } }));

    expect(messageOf(() => store.set("k", "x"))).toContain(
      "expected myzodstring,",
    );
  });

  it("reports an unknown type when the definition carries no name", () => {
    expect(
      messageOf(() => zodStore(zodLike({ _def: {} })).set("k", "x")),
    ).toContain("expected unknown,");
    expect(
      messageOf(() => zodStore(zodLike({ _def: null })).set("k", "x")),
    ).toContain("expected unknown,");
  });

  it("prefers an explicit _typeName", () => {
    const store = zodStore(zodLike({ _typeName: "custom" }));

    expect(messageOf(() => store.set("k", "x"))).toContain("expected custom,");
  });

  it("falls back from error.message to the first issue to a default", () => {
    const fail = (error: unknown) =>
      zodStore(
        zodLike({ safeParse: () => ({ success: false, error }) }),
      ).set.bind(null, "k", "x");

    expect(
      messageOf(fail({ message: "m1", issues: [{ message: "i1" }] })),
    ).toMatch(/\. m1$/);
    expect(messageOf(fail({ issues: [{ message: "i1" }] }))).toMatch(/\. i1$/);
    expect(messageOf(fail({ issues: [] }))).toMatch(/\. Validation failed$/);
    expect(messageOf(fail({}))).toMatch(/\. Validation failed$/);
    expect(messageOf(fail(undefined))).toMatch(/\. Validation failed$/);
  });

  it("redacts the value in a safeParse failure when asked", () => {
    const store = zodStore(zodLike(), { redactErrors: true });
    const message = messageOf(() => store.set("k", "secret-value"));

    expect(message).toContain("[redacted]");
    expect(message).not.toContain("secret-value");
  });

  it.each([
    ["no safeParse", { safeParse: undefined }],
    ["a non-function safeParse", { safeParse: "yes" }],
    ["no _def", { _def: undefined }],
    ["no parse", { parse: undefined }],
    ["a non-function parse", { parse: 1 }],
  ])("does not treat an object with %s as one", (_label, override) => {
    const schemaEntry = { ...zodLike(), ...override } as Record<
      string,
      unknown
    >;
    for (const key of Object.keys(override)) {
      if (override[key as keyof typeof override] === undefined) {
        delete schemaEntry[key];
      }
    }
    const store = zodStore(schemaEntry);

    // Not a schema we can run, so it validates nothing.
    expect(() => store.set("k", "anything")).not.toThrow();
    expect(store.get("k")).toBe("anything");
  });
});

describe("notification coalescing", () => {
  it("allows exactly 100 deferred rounds and then throws", () => {
    const run = (maxFirings: number) => {
      const store = createFactsStore({
        schema: { x: t.number() },
        validate: false,
      });
      let fired = 0;
      store.subscribe(["x"], () => {
        fired++;
        if (fired < maxFirings) {
          store.set("x", fired);
        }
      });

      return messageOf(() => store.set("x", -1));
    };

    expect(run(101)).toBe("<did not throw>");
    const message = run(102);

    expect(message).toContain(
      "Infinite notification loop detected after 100 iterations. A listener is repeatedly mutating facts",
    );
  });

  it("names the flush when the loop starts inside a batch", () => {
    const store = createFactsStore({
      schema: { x: t.number() },
      validate: false,
    });
    let n = 0;
    store.subscribe(["x"], () => {
      store.set("x", ++n);
    });

    expect(messageOf(() => store.batch(() => store.set("x", -1)))).toContain(
      "iterations during flush.",
    );
  });

  it("recovers after a runaway loop", () => {
    const store = createFactsStore({
      schema: { x: t.number() },
      validate: false,
    });
    let n = 0;
    let runaway = true;
    const seen: number[] = [];
    store.subscribe(["x"], () => {
      if (runaway) {
        store.set("x", ++n);
      } else {
        seen.push(store.get("x") as number);
      }
    });
    expect(() => store.set("x", -1)).toThrow();

    runaway = false;
    store.set("x", 1000);

    expect(seen).toEqual([1000]);
  });

  it("defers a write made by a listener during a batch flush until the listeners finish", () => {
    const store = createFactsStore({
      schema: { a: t.number(), b: t.number() },
      validate: false,
    });
    const order: string[] = [];
    store.subscribe(["a"], () => {
      order.push("a1");
      store.set("b", 1);
    });
    store.subscribe(["a"], () => {
      order.push("a2");
    });
    store.subscribe(["b"], () => {
      order.push("b");
    });

    store.batch(() => {
      store.set("a", 1);
    });

    expect(order).toEqual(["a1", "a2", "b"]);
  });

  it("notifies subscribeAll for a deferred write as well as the first", () => {
    const store = createFactsStore({
      schema: { x: t.number(), y: t.number() },
      validate: false,
    });
    const all = vi.fn();
    store.subscribeAll(all);
    store.subscribe(["x"], () => {
      store.set("y", 1);
    });

    store.set("x", 1);

    expect(all).toHaveBeenCalledTimes(2);
  });

  it("does not call onBatch for a batch that wrote nothing", () => {
    const onBatch = vi.fn();
    const store = createFactsStore({
      schema: { x: t.number() },
      validate: false,
      onBatch,
    });
    store.batch(() => {});
    expect(onBatch).not.toHaveBeenCalled();

    store.batch(() => store.set("x", 1));
    expect(onBatch).toHaveBeenCalledTimes(1);
  });
});

describe("batch hooks", () => {
  it("fires onBatchStart and onBatchEnd once for nested batches, end after onBatch", () => {
    const calls: string[] = [];
    const store = createFactsStore({
      schema: { x: t.number() },
      validate: false,
      onBatchStart: () => calls.push("start"),
      onBatch: () => calls.push("batch"),
      onBatchEnd: () => calls.push("end"),
    });

    store.batch(() => {
      store.batch(() => {
        store.set("x", 1);
      });
      calls.push("inner-done");
    });

    expect(calls).toEqual(["start", "inner-done", "batch", "end"]);
  });

  it("still fires onBatchEnd when the batch body throws", () => {
    const onBatchEnd = vi.fn();
    const store = createFactsStore({
      schema: { x: t.number() },
      validate: false,
      onBatchEnd,
    });

    expect(() =>
      store.batch(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(onBatchEnd).toHaveBeenCalledTimes(1);
  });

  it("reports onWrite at the moment of an in-batch write, set or delete", () => {
    const writes: string[] = [];
    const store = createFactsStore({
      schema: { a: t.number(), b: t.number() },
      validate: false,
      onWrite: (key) => writes.push(key),
    });
    store.set("a", 1);
    expect(writes).toEqual([]);

    store.batch(() => {
      store.set("a", 2);
      expect(writes).toEqual(["a"]);
      store.delete("b");
      expect(writes).toEqual(["a", "b"]);
    });
  });
});

describe("delete", () => {
  it("is deferred inside a batch and reported with its previous value and origin", () => {
    const onBatch = vi.fn();
    const listener = vi.fn();
    const store = createFactsStore({
      schema: { a: t.number() },
      validate: false,
      onBatch,
    });
    store.set("a", 5);
    store.subscribe(["a"], listener);

    store.batch(() => {
      store.delete("a");
      expect(listener).not.toHaveBeenCalled();
      expect(onBatch).not.toHaveBeenCalled();
      expect(store.has("a")).toBe(false);
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(onBatch).toHaveBeenCalledWith([
      {
        key: "a",
        value: undefined,
        prev: 5,
        type: "delete",
        origin: "authored",
      },
    ]);
  });

  it("stamps the origin asked for at the moment of the write", () => {
    const onBatch = vi.fn();
    let origin: "authored" | "restore" = "restore";
    const store = createFactsStore({
      schema: { a: t.number(), b: t.number() },
      validate: false,
      onBatch,
      originOf: () => origin,
    });
    store.set("a", 1);
    store.set("b", 1);

    store.batch(() => {
      store.delete("a");
      origin = "authored";
      store.delete("b");
    });

    const changes = onBatch.mock.calls[0]![0] as Array<{
      key: string;
      origin: string;
    }>;
    expect(changes.map((c) => [c.key, c.origin])).toEqual([
      ["a", "restore"],
      ["b", "authored"],
    ]);
  });

  it("notifies synchronously, with the previous value, outside a batch", () => {
    const onChange = vi.fn();
    const store = createFactsStore({
      schema: { a: t.number() },
      validate: false,
      onChange,
    });
    store.set("a", 5);
    onChange.mockClear();

    store.delete("a");

    expect(onChange).toHaveBeenCalledWith("a", undefined, 5);
    expect(store.has("a")).toBe(false);
  });
});

describe("subscriptions", () => {
  it("keeps every listener of a key, and only unsubscribes the one asked", () => {
    const store = createFactsStore({
      schema: { a: t.number() },
      validate: false,
    });
    const one = vi.fn();
    const two = vi.fn();
    const offOne = store.subscribe(["a"], one);
    store.subscribe(["a"], two);

    store.set("a", 1);
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).toHaveBeenCalledTimes(1);

    offOne();
    store.set("a", 2);
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).toHaveBeenCalledTimes(2);
  });

  it("tolerates unsubscribing twice and resubscribing afterwards", () => {
    const store = createFactsStore({
      schema: { a: t.number() },
      validate: false,
    });
    const first = vi.fn();
    const off = store.subscribe(["a"], first);
    off();

    expect(() => off()).not.toThrow();

    const second = vi.fn();
    store.subscribe(["a"], second);
    store.set("a", 1);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("subscribeAll's unsubscribe stops further calls", () => {
    const store = createFactsStore({
      schema: { a: t.number() },
      validate: false,
    });
    const all = vi.fn();
    const off = store.subscribeAll(all);
    store.set("a", 1);
    off();
    store.set("a", 2);

    expect(all).toHaveBeenCalledTimes(1);
  });
});

describe("facts proxy traps", () => {
  function make() {
    const schema = { n: t.number() };
    const { store, facts } = createFacts({ schema, validate: false });

    return { store, facts, schema };
  }

  it("refuses to assign the internal accessors and symbols", () => {
    const { facts } = make();
    const f = facts as unknown as Record<string | symbol, unknown>;

    expect(Reflect.set(f, "$store", 1)).toBe(false);
    expect(Reflect.set(f, "$snapshot", 1)).toBe(false);
    expect(Reflect.set(f, Symbol("s"), 1)).toBe(false);
    expect(Reflect.set(f, "__proto__", {})).toBe(false);
    expect(Reflect.set(f, "constructor", 1)).toBe(false);
    expect(typeof f.$snapshot).toBe("function");
    expect(f.$store).toBeDefined();
    expect(Object.keys(f)).not.toContain("$store");
  });

  it("refuses to delete the internal accessors and symbols", () => {
    const { facts } = make();
    const f = facts as unknown as Record<string | symbol, unknown>;

    expect(Reflect.deleteProperty(f, "$store")).toBe(false);
    expect(Reflect.deleteProperty(f, "$snapshot")).toBe(false);
    expect(Reflect.deleteProperty(f, Symbol("s"))).toBe(false);
    expect(Reflect.deleteProperty(f, "constructor")).toBe(false);
  });

  it("reports the accessors but no symbols or blocked names via `in`", () => {
    const { facts } = make();
    const f = facts as unknown as object;

    expect("$store" in f).toBe(true);
    expect("$snapshot" in f).toBe(true);
    expect(Symbol("s") in f).toBe(false);
    expect("__proto__" in f).toBe(false);
    expect("constructor" in f).toBe(false);
    expect("n" in f).toBe(false);
  });

  it("describes its own properties consistently with get/has", () => {
    const { facts, store } = make();
    store.set("n", 1);
    const f = facts as unknown as object;

    expect(Object.getOwnPropertyDescriptor(f, "__proto__")).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(f, "constructor")).toBeUndefined();
    expect(Object.hasOwn(f, "prototype")).toBe(false);
    expect(Object.getOwnPropertyDescriptor(f, "$store")).toMatchObject({
      configurable: true,
      enumerable: false,
      writable: false,
    });
    expect(Object.getOwnPropertyDescriptor(f, "$snapshot")).toMatchObject({
      configurable: true,
      enumerable: false,
      writable: false,
    });
    expect(Object.getOwnPropertyDescriptor(f, "n")).toMatchObject({
      configurable: true,
      enumerable: true,
      writable: true,
    });
    // a symbol key is not a blocked string, so it is described like any other
    expect(Object.getOwnPropertyDescriptor(f, Symbol.for("x"))).toMatchObject({
      enumerable: true,
    });
  });

  it("cannot be redefined or reparented", () => {
    const { facts } = make();
    const f = facts as unknown as object;

    expect(Reflect.defineProperty(f, "n", { value: 1 })).toBe(false);
    expect(() => Object.defineProperty(f, "n", { value: 1 })).toThrow(
      TypeError,
    );
    expect(Reflect.setPrototypeOf(f, {})).toBe(false);
    expect(Object.getPrototypeOf(f)).toBeNull();
  });

  it("enumerates schema keys live, including keys added later", () => {
    const schema: Record<string, unknown> = { n: t.number() };
    const { facts } = createFacts({ schema: schema as never, validate: false });
    schema.m = t.number();

    expect(Object.keys(facts)).toEqual(["n", "m"]);
  });

  it("passes snapshot reads through without a subscription", () => {
    const { facts, store } = make();
    store.set("n", 4);
    const snap = (
      facts as unknown as {
        $snapshot(): { get(k: string): unknown; has(k: string): boolean };
      }
    ).$snapshot();

    expect(snap.get("n")).toBe(4);
    expect(snap.has("n")).toBe(true);
    expect(snap.has("zzz")).toBe(false);
  });

  it("builds a proxy from a bare store", () => {
    const store = createFactsStore({
      schema: { n: t.number() },
      validate: false,
    });
    const facts = createFactsProxy(store, { n: t.number() });
    (facts as unknown as { n: number }).n = 2;

    expect(store.get("n")).toBe(2);
  });
});

describe("development nested-mutation warnings", () => {
  function make(initial: Record<string, unknown>) {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { facts } = createFacts({
      schema: { doc: t.object<Record<string, unknown>>() },
      validate: false,
    });
    const f = facts as unknown as { doc: Record<string | symbol, any> };
    f.doc = initial;
    warn.mockClear();

    return { f, warn };
  }

  it("warns once for a mutation two levels down, naming the path", () => {
    const { f, warn } = make({ inner: { x: 1 } });

    f.doc.inner.x = 2;

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("doc.inner.x");
  });

  it("does not warn for a symbol-keyed write", () => {
    const { f, warn } = make({ inner: { x: 1 } });

    f.doc.inner[Symbol("s")] = 2;

    expect(warn).not.toHaveBeenCalled();
  });

  it("hands back the same wrapper for the same nested object", () => {
    const { f } = make({ inner: { x: 1 } });

    expect(f.doc.inner).toBe(f.doc.inner);
  });

  it("does not stack wrappers when a read value is written straight back", () => {
    const { f, warn } = make({ inner: { x: 1 } });
    f.doc = { ...f.doc };
    f.doc = { ...f.doc };
    // biome-ignore lint/correctness/noSelfAssign: writing a read value straight back is the case under test
    f.doc = f.doc;
    warn.mockClear();

    f.doc.inner.x = 3;
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockClear();
    f.doc.y = 1;
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("hides blocked property names on nested objects", () => {
    const { f } = make({ inner: { x: 1 } });

    expect(f.doc.inner.constructor).toBeUndefined();
    expect(f.doc.inner.prototype).toBeUndefined();
    expect(f.doc.inner.__proto__).toBeUndefined();
  });

  it("returns null and symbol-keyed objects untouched", () => {
    const sym: symbol = Symbol("s");
    const keyed = { a: 1 };
    const { f } = make({ nothing: null, [sym]: keyed });

    expect(f.doc.nothing).toBeNull();
    expect(f.doc[sym]).toBe(keyed);
  });

  it("still warns for a null-prototype object", () => {
    const bare = Object.assign(Object.create(null), { x: 1 });
    const { f, warn } = make({ bare });

    f.doc.bare.x = 2;

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("still warns for a read-only but configurable property", () => {
    const doc: Record<string, unknown> = {};
    Object.defineProperty(doc, "inner", {
      value: { x: 1 },
      writable: false,
      configurable: true,
      enumerable: true,
    });
    const { f, warn } = make(doc);

    f.doc.inner.x = 2;

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("leaves a frozen container's nested values readable", () => {
    const { f } = make(Object.freeze({ inner: { x: 1 } }));

    expect(f.doc.inner.x).toBe(1);
  });

  it("leaves Map, Set and Date nested values with their methods", () => {
    const { f } = make({ m: new Map([["a", 1]]), d: new Date(5) });

    expect(f.doc.m.get("a")).toBe(1);
    expect(f.doc.d.getTime()).toBe(5);
  });
});
