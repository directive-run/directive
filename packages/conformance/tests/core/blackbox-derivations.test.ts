// Ported from packages/core/src/core/__tests__/blackbox-derivations.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

/**
 * Black-box conformance for derivation behaviour that mutation testing showed
 * was unpinned, and that the earlier files reached only through internals.
 * Public API only.
 */

import { createModule, createSystem, t } from "@directive-run/core";
import { describe, expect, it, vi } from "vitest";

// biome-ignore lint/suspicious/noExplicitAny: dynamic derivation and fact access is untyped by design
type Any = any;

function counterModule(derive: Record<string, Any>, id = "m") {
  return createModule(id, {
    schema: {
      facts: { n: t.number(), m: t.number() },
      derivations: Object.fromEntries(
        Object.keys(derive).map((k) => [k, t.any()]),
      ) as Any,
    },
    init: (f) => {
      f.n = 1;
      f.m = 0;
    },
    derive: derive as Any,
  });
}

function sys(mod: Any, plugins: Any[] = []): Any {
  const system = createSystem({ module: mod, plugins }) as Any;
  system.start();

  return system;
}

describe("a derivation is cached until something it read changes", () => {
  it("reads twice with one compute", () => {
    let runs = 0;
    const system = sys(
      counterModule({
        d: (f: Any) => {
          runs++;

          return f.n + 1;
        },
      }),
    );

    expect(system.derive.d).toBe(2);
    expect(system.derive.d).toBe(2);
    expect(system.derive.d).toBe(2);
    expect(runs).toBe(1);
    system.facts.n = 5;
    expect(system.derive.d).toBe(6);
    expect(system.derive.d).toBe(6);
    expect(runs).toBe(2);
    system.stop();
  });

  it("composed derivations share one compute of their input", () => {
    let inner = 0;
    const system = sys(
      counterModule({
        base: (f: Any) => {
          inner++;

          return f.n;
        },
        a: (_f: Any, d: Any) => d.base + 1,
        b: (_f: Any, d: Any) => d.base + 2,
      }),
    );

    expect(system.derive.a).toBe(2);
    expect(system.derive.b).toBe(3);
    expect(inner).toBe(1);
    system.stop();
  });
});

describe("a derivation that reads itself", () => {
  it("throws on read and recovers once the cycle is gone", () => {
    const system = sys(
      counterModule({
        loop: (f: Any, d: Any) => (f.n === 2 ? d.loop : f.n),
      }),
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(system.derive.loop).toBe(1);
    system.facts.n = 2;
    expect(() => system.derive.loop).toThrow(/ircular/);
    // The failed read left no half-finished state behind.
    expect(() => system.derive.loop).toThrow(/ircular/);
    system.facts.n = 7;
    expect(system.derive.loop).toBe(7);
    err.mockRestore();
    system.stop();
  });

  it("two derivations reading each other throw rather than hang", () => {
    const system = sys(
      counterModule({
        a: (f: Any, d: Any) => (f.n === 2 ? d.b : 0),
        b: (_f: Any, d: Any) => d.a,
      }),
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(system.derive.a).toBe(0);
    system.facts.n = 2;
    expect(() => system.derive.a).toThrow(/ircular/);
    err.mockRestore();
    system.stop();
  });
});

describe("a throwing derivation", () => {
  it("rethrows to the reader, reports to plugins, and recovers", () => {
    const reported: unknown[] = [];
    const system = sys(
      counterModule({
        bad: (f: Any) => {
          if (f.n === 2) {
            throw new Error("boom");
          }

          return f.n;
        },
      }),
      [{ name: "spy", onError: (e: unknown) => reported.push(e) }],
    );

    expect(system.derive.bad).toBe(1);
    system.facts.n = 2;
    expect(() => system.derive.bad).toThrow();
    expect(reported.length).toBeGreaterThan(0);
    system.facts.n = 3;
    expect(system.derive.bad).toBe(3);
    system.stop();
  });

  it("keeps working for the dependants of a recovered derivation", () => {
    const system = sys(
      counterModule({
        bad: (f: Any) => {
          if (f.n === 2) {
            throw new Error("boom");
          }

          return f.n;
        },
        user: (_f: Any, d: Any) => d.bad * 2,
      }),
    );

    expect(system.derive.user).toBe(2);
    system.facts.n = 2;
    expect(() => system.derive.user).toThrow();
    system.facts.n = 4;
    expect(system.derive.user).toBe(8);
    system.facts.n = 5;
    expect(system.derive.user).toBe(10);
    system.stop();
  });
});

describe("subscribing to derivations", () => {
  it("unsubscribing twice is harmless and stays unsubscribed", async () => {
    const system = sys(counterModule({ d: (f: Any) => f.n + 1 }));
    const seen: number[] = [];
    void system.derive.d;
    const stop = system.subscribe(["d"], () => seen.push(system.derive.d));

    system.facts.n = 2;
    await system.settle();
    expect(seen.length).toBeGreaterThan(0);

    expect(() => {
      stop();
      stop();
    }).not.toThrow();
    const after = seen.length;
    system.facts.n = 3;
    await system.settle();
    expect(seen.length).toBe(after);
    system.stop();
  });

  it("one unsubscribe leaves the other listener of the same derivation", async () => {
    const system = sys(counterModule({ d: (f: Any) => f.n + 1 }));
    let a = 0;
    let b = 0;
    void system.derive.d;
    const stopA = system.subscribe(["d"], () => {
      a++;
    });
    system.subscribe(["d"], () => {
      b++;
    });

    stopA();
    stopA();
    system.facts.n = 2;
    await system.settle();
    expect(a).toBe(0);
    expect(b).toBeGreaterThan(0);
    system.stop();
  });

  it("a new listener on a fully unsubscribed derivation is heard", async () => {
    const system = sys(counterModule({ d: (f: Any) => f.n + 1 }));
    void system.derive.d;
    const first = system.subscribe(["d"], () => {});
    first();
    let heard = 0;
    system.subscribe(["d"], () => {
      heard++;
    });

    system.facts.n = 9;
    await system.settle();
    expect(heard).toBeGreaterThan(0);
    system.stop();
  });
});

describe("the derived parameter is a read-only record", () => {
  function capture() {
    // biome-ignore lint/style/useConst: assigned from inside a derivation
    let held: Any;
    const system = sys(
      counterModule({
        one: (f: Any) => f.n,
        peek: (_f: Any, d: Any) => {
          held = d;

          return d.one;
        },
      }),
    );
    void system.derive.peek;

    return { held, system };
  }

  it("refuses to define properties, in either style", () => {
    const { held, system } = capture();

    expect(
      Reflect.defineProperty(held, "x", { value: 1, configurable: true }),
    ).toBe(false);
    expect(() =>
      Object.defineProperty(held, "x", { value: 1, configurable: true }),
    ).toThrow(TypeError);
    expect("x" in held).toBe(false);
    system.stop();
  });

  it("refuses to change its prototype and has none", () => {
    const { held, system } = capture();

    expect(Reflect.setPrototypeOf(held, { evil: true })).toBe(false);
    expect(() => Object.setPrototypeOf(held, { evil: true })).toThrow(
      TypeError,
    );
    expect(Object.getPrototypeOf(held)).toBeNull();
    expect((held as Any).evil).toBeUndefined();
    system.stop();
  });

  it("refuses assignment and deletion", () => {
    const { held, system } = capture();

    expect(Reflect.set(held, "one", 5)).toBe(false);
    expect(Reflect.deleteProperty(held, "one")).toBe(false);
    expect(() => {
      held.one = 5;
    }).toThrow(TypeError);
    expect(held.one).toBe(1);
    system.stop();
  });

  it("answers nothing for prototype-chain names or symbols", () => {
    const { held, system } = capture();

    expect(held.__proto__).toBeUndefined();
    expect(held.constructor).toBeUndefined();
    expect(held.prototype).toBeUndefined();
    expect(held[Symbol.iterator]).toBeUndefined();
    expect("constructor" in held).toBe(false);
    expect(Symbol.iterator in held).toBe(false);
    expect(
      Reflect.getOwnPropertyDescriptor(held, "constructor"),
    ).toBeUndefined();
    expect(Reflect.getOwnPropertyDescriptor(held, "nope")).toBeUndefined();
    system.stop();
  });

  it("lists the derivation names and reports them as real properties", () => {
    const { held, system } = capture();

    expect(Object.keys(held).sort()).toEqual(["one", "peek"]);
    const desc = Reflect.getOwnPropertyDescriptor(held, "one");
    expect(desc?.configurable).toBe(true);
    expect(desc?.enumerable).toBe(true);
    system.stop();
  });
});

describe("system.derive is a read-only record too", () => {
  it("answers nothing for prototype-chain names", () => {
    const system = sys(counterModule({ d: (f: Any) => f.n }));
    const d = system.derive as Any;

    expect(d.__proto__).toBeUndefined();
    expect(d.prototype).toBeUndefined();
    expect("prototype" in d).toBe(false);
    expect("d" in d).toBe(true);
    expect("nope" in d).toBe(false);
    system.stop();
  });
});

describe("registering and replacing derivations at runtime", () => {
  it("rejects a null or non-object compute", () => {
    const system = sys(counterModule({ d: (f: Any) => f.n }));

    expect(() => system.derive.register("bad", { compute: null })).toThrow();
    expect(() => system.derive.register("bad2", { compute: 42 })).toThrow();
    system.stop();
  });

  it("a function-valued entry and an object-form entry both run", () => {
    const mod = createModule("m", {
      schema: {
        facts: { n: t.number() },
        derivations: { plain: t.number(), wrapped: t.number() },
      },
      init: (f) => {
        f.n = 3;
      },
      derive: {
        plain: (f: Any) => f.n,
        wrapped: { compute: (f: Any) => f.n * 2, meta: { label: "W" } },
      } as Any,
    });
    const system = sys(mod);

    expect(system.derive.plain).toBe(3);
    expect(system.derive.wrapped).toBe(6);
    expect(system.meta.derivation("wrapped")?.label).toBe("W");
    expect(system.meta.derivation("plain")?.label).toBeUndefined();
    system.stop();
  });

  it("replacing a derivation wakes its subscribers and dependants with fresh values", async () => {
    const system = sys(
      counterModule({
        base: (f: Any) => f.n,
        top: (_f: Any, d: Any) => d.base + 100,
      }),
    );
    let heard = 0;
    expect(system.derive.top).toBe(101);
    system.subscribe(["top"], () => {
      heard++;
    });

    system.derive.assign("base", (f: Any) => f.n + 1000);
    await system.settle();
    expect(system.derive.top).toBe(1101);
    expect(heard).toBeGreaterThan(0);
    system.facts.n = 2;
    expect(system.derive.top).toBe(1102);
    system.stop();
  });

  it("a derivation registered after start is computed and tracked", async () => {
    const system = sys(counterModule({ d: (f: Any) => f.n }));

    system.derive.register("late", (f: Any) => f.n * 3);
    expect(system.derive.late).toBe(3);
    system.facts.n = 4;
    expect(system.derive.late).toBe(12);
    system.derive.unregister("late");
    expect("late" in (system.derive as Any)).toBe(false);
    system.stop();
  });
});
