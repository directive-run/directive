import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

// Black-box tests for the `system.facts` proxy object: what the usual
// reflection operations (in, delete, Object.keys, Reflect.*, util.inspect)
// report about it.

// biome-ignore lint/suspicious/noExplicitAny: facts are driven dynamically on purpose
type Any = any;

async function start(facts: Record<string, unknown>, init?: (f: Any) => void) {
  const mod = createModule("m", {
    schema: { facts: facts as Any },
    init: init ?? (() => {}),
  });
  const system = createSystem({ module: mod }) as Any;
  await system.start();

  return system;
}

afterEach(() => {
  vi.restoreAllMocks();
});

const INSPECT = Symbol.for("nodejs.util.inspect.custom");

describe("facts proxy: property access", () => {
  it("exposes the store and the untracked snapshot, and nothing else special", async () => {
    const system = await start({ n: t.number() }, (f) => {
      f.n = 1;
    });

    expect(typeof system.facts.$store.get).toBe("function");
    expect(typeof system.facts.$snapshot).toBe("function");
    expect(system.facts.$snapshot().get("n")).toBe(1);
    await system.stop();
  });

  it("hides prototype-pollution keys", async () => {
    const system = await start({ n: t.number() });

    expect(system.facts.__proto__).toBeUndefined();
    expect(system.facts.constructor).toBeUndefined();
    expect(system.facts.prototype).toBeUndefined();
    expect("__proto__" in system.facts).toBe(false);
    expect("constructor" in system.facts).toBe(false);
    expect("prototype" in system.facts).toBe(false);
    expect(Object.getOwnPropertyDescriptor(system.facts, "__proto__")).toBe(
      undefined,
    );
    expect(Object.getOwnPropertyDescriptor(system.facts, "constructor")).toBe(
      undefined,
    );
    await system.stop();
  });

  it("returns nothing for symbols other than the inspection hook", async () => {
    const system = await start({ n: t.number() });

    expect(system.facts[Symbol.iterator]).toBeUndefined();
    expect(system.facts[Symbol.toPrimitive]).toBeUndefined();
    expect(system.facts[Symbol.toStringTag]).toBeUndefined();
    expect(system.facts[Symbol("mine")]).toBeUndefined();
    expect(system.facts.$$typeof).toBeUndefined();
    await system.stop();
  });

  it("offers an inspection hook that yields the current values", async () => {
    const system = await start({ n: t.number(), s: t.string() }, (f) => {
      f.n = 1;
      f.s = "x";
    });

    const hook = system.facts[INSPECT];

    expect(typeof hook).toBe("function");
    expect(hook()).toEqual({ n: 1, s: "x" });
    system.facts.n = 2;
    expect(system.facts[INSPECT]()).toEqual({ n: 2, s: "x" });
    await system.stop();
  });

  it("does not make a derivation depend on a fact merely by inspecting facts", async () => {
    const system = await start({ n: t.number() }, (f) => {
      f.n = 1;
    });

    expect(() => system.facts[INSPECT]()).not.toThrow();
    await system.stop();
  });
});

describe("facts proxy: assignment refused", () => {
  it("throws when assigning a symbol key", async () => {
    const system = await start({ n: t.number() });

    expect(() => {
      system.facts[Symbol("x")] = 1;
    }).toThrow(TypeError);
    await system.stop();
  });

  it("reports a refused symbol assignment or deletion as a failure", async () => {
    const system = await start({ n: t.number() });
    const sym = Symbol("x");

    expect(Reflect.set(system.facts, sym, 1)).toBe(false);
    expect(Reflect.deleteProperty(system.facts, sym)).toBe(false);
    expect(Reflect.set(system.facts, "$store", 1)).toBe(false);
    expect(Reflect.set(system.facts, "__proto__", 1)).toBe(false);
    expect(Reflect.deleteProperty(system.facts, "$snapshot")).toBe(false);
    expect(Reflect.deleteProperty(system.facts, "constructor")).toBe(false);
    await system.stop();
  });

  it("throws when assigning the reserved accessors", async () => {
    const system = await start({ n: t.number() });

    expect(() => {
      system.facts.$store = {};
    }).toThrow(TypeError);
    expect(() => {
      system.facts.$snapshot = () => ({});
    }).toThrow(TypeError);
    expect(typeof system.facts.$store.get).toBe("function");
    await system.stop();
  });

  it("throws when assigning a prototype-pollution key", async () => {
    const system = await start({ n: t.number() });

    expect(() => {
      system.facts.__proto__ = { polluted: true };
    }).toThrow(TypeError);
    expect(() => {
      system.facts.constructor = 1;
    }).toThrow(TypeError);
    expect(() => {
      system.facts.prototype = 1;
    }).toThrow(TypeError);
    expect(({} as Any).polluted).toBeUndefined();
    await system.stop();
  });

  it("throws when deleting a symbol, a reserved accessor or a pollution key", async () => {
    const system = await start({ n: t.number() });

    expect(() => {
      delete system.facts[Symbol("x")];
    }).toThrow(TypeError);
    expect(() => {
      delete system.facts.$store;
    }).toThrow(TypeError);
    expect(() => {
      delete system.facts.$snapshot;
    }).toThrow(TypeError);
    expect(() => {
      delete system.facts.__proto__;
    }).toThrow(TypeError);
    expect(() => {
      delete system.facts.constructor;
    }).toThrow(TypeError);
    expect(typeof system.facts.$store.get).toBe("function");
    await system.stop();
  });

  it("deletes an ordinary fact and reports success", async () => {
    const system = await start({ n: t.number() }, (f) => {
      f.n = 1;
    });

    expect(Reflect.deleteProperty(system.facts, "n")).toBe(true);
    expect(system.facts.n).toBeUndefined();
    await system.stop();
  });

  it("reports assignment of an ordinary fact as successful", async () => {
    const system = await start({ n: t.number() });

    expect(Reflect.set(system.facts, "n", 5)).toBe(true);
    expect(system.facts.n).toBe(5);
    await system.stop();
  });
});

describe("facts proxy: reflection", () => {
  it("answers `in` for the reserved accessors and for facts that have a value", async () => {
    const system = await start({ n: t.number(), m: t.number() }, (f) => {
      f.n = 1;
    });

    expect("$store" in system.facts).toBe(true);
    expect("$snapshot" in system.facts).toBe(true);
    expect("n" in system.facts).toBe(true);
    expect("m" in system.facts).toBe(false);
    expect(Symbol.iterator in system.facts).toBe(false);
    expect(INSPECT in system.facts).toBe(false);
    await system.stop();
  });

  it("lists the schema's keys, enumerable and writable", async () => {
    const system = await start({ a: t.number(), b: t.string() });

    expect(Object.keys(system.facts)).toEqual(["a", "b"]);
    expect(Object.getOwnPropertyDescriptor(system.facts, "a")).toEqual({
      value: undefined,
      configurable: true,
      enumerable: true,
      writable: true,
    });
    await system.stop();
  });

  it("describes the reserved accessors as hidden and read-only", async () => {
    const system = await start({ a: t.number() });

    for (const key of ["$store", "$snapshot"]) {
      const d = Object.getOwnPropertyDescriptor(system.facts, key)!;
      expect(d.enumerable).toBe(false);
      expect(d.writable).toBe(false);
      expect(d.configurable).toBe(true);
    }
    expect(Object.keys(system.facts)).not.toContain("$store");
    await system.stop();
  });

  it("refuses to define properties or change the prototype", async () => {
    const system = await start({ a: t.number() });

    expect(Reflect.defineProperty(system.facts, "a", { value: 1 })).toBe(false);
    expect(Reflect.defineProperty(system.facts, "zzz", { value: 1 })).toBe(
      false,
    );
    expect(() =>
      Object.defineProperty(system.facts, "a", { value: 1 }),
    ).toThrow(TypeError);
    expect(Reflect.setPrototypeOf(system.facts, {})).toBe(false);
    expect(Reflect.setPrototypeOf(system.facts, null)).toBe(false);
    expect(Object.getPrototypeOf(system.facts)).toBeNull();
    expect(system.facts.a).toBeUndefined();
    await system.stop();
  });

  it("follows the schema when keys are added by a dynamically registered module", async () => {
    const system = await start({ a: t.number() });

    system.registerModule(
      createModule("extra", {
        schema: { facts: { b: t.number() } },
        init: () => {},
      }) as never,
    );

    expect(Object.keys(system.facts)).toEqual(["a", "b"]);
    system.facts.b = 3;
    expect(system.facts.b).toBe(3);
    await system.stop();
  });
});
