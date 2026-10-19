// Ported from packages/core/src/core/__tests__/blackbox-facts-proxy.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, describe, expect, it, vi } from "vitest";

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

  it("reads unknown symbols as undefined", async () => {
    const system = await start({ n: t.number() });

    expect(system.facts[Symbol("mine")]).toBeUndefined();
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

  it("lists the schema's keys", async () => {
    const system = await start({ a: t.number(), b: t.string() });

    expect(Object.keys(system.facts)).toEqual(["a", "b"]);
    await system.stop();
  });

  it("refuses to define properties", async () => {
    const system = await start({ a: t.number() });

    expect(() =>
      Object.defineProperty(system.facts, "a", { value: 1 }),
    ).toThrow(TypeError);
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
