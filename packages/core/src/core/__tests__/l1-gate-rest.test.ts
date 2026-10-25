import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

// Black-box tests for the rest of the base of the ladder: what a batch of fact
// writes announces, what stays tracked after an untracked read, what a body
// that has already awaited can still read, and what createModule says about a
// module that is badly formed. Public API only, no plugins, no observers.

afterEach(() => {
  vi.restoreAllMocks();
});

type Any = any;

async function start(
  facts: Record<string, unknown>,
  init?: (facts: Any) => void,
) {
  const mod = createModule("m", {
    schema: { facts: facts as Any },
    init: init ?? (() => {}),
  });
  const system = createSystem({ module: mod } as Any) as Any;
  await system.start();

  return system;
}

// A bare function stands for `{ run }`. These effects read `derived`, the third
// parameter, and nothing here looks at `prev`.
function effectsOf(defs: Record<string, Any>): Any {
  return Object.fromEntries(
    Object.entries(defs).map(([id, run]) => [id, { run }]),
  );
}

const flush = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

// ---------------------------------------------------------------------------
// A batch announces what it wrote, once
// ---------------------------------------------------------------------------

describe("a batch announces only what it wrote", () => {
  it("a batch that wrote nothing, or only what was already stored, notifies nobody", async () => {
    const system = await start({ n: t.number() }, (f) => {
      f.n = 1;
    });
    const everything = vi.fn();
    const key = vi.fn();
    system.facts.$store.subscribeAll(everything);
    system.subscribe(["n"], key);

    system.batch(() => {});
    system.batch(() => {
      system.facts.n = 1;
    });

    expect(everything).not.toHaveBeenCalled();
    expect(key).not.toHaveBeenCalled();
    await system.stop();
  });

  it("a later batch does not announce the keys an earlier one wrote", async () => {
    const system = await start({ a: t.number(), b: t.number() });
    const heardA = vi.fn();
    const heardB = vi.fn();
    const everything = vi.fn();
    system.subscribe(["a"], heardA);
    system.subscribe(["b"], heardB);
    system.facts.$store.subscribeAll(everything);

    system.batch(() => {
      system.facts.a = 1;
    });

    expect(heardA).toHaveBeenCalledTimes(1);
    expect(heardB).not.toHaveBeenCalled();
    expect(everything).toHaveBeenCalledTimes(1);

    system.batch(() => {
      system.facts.b = 1;
    });

    expect(heardA).toHaveBeenCalledTimes(1);
    expect(heardB).toHaveBeenCalledTimes(1);
    expect(everything).toHaveBeenCalledTimes(2);

    // And a batch after that, which wrote nothing, says nothing.
    system.batch(() => {});

    expect(heardA).toHaveBeenCalledTimes(1);
    expect(heardB).toHaveBeenCalledTimes(1);
    expect(everything).toHaveBeenCalledTimes(2);
    await system.stop();
  });

  it("an empty batch inside a listener does not end the deferral of the listener's own writes", async () => {
    const system = await start({ a: t.number(), b: t.number() });
    const order: string[] = [];
    system.subscribe(["b"], () => {
      order.push("b heard");
    });
    system.subscribe(["a"], () => {
      order.push("a start");
      system.batch(() => {});
      system.facts.b = 1;
      order.push("a end");
    });

    system.facts.a = 1;

    // The write to b made inside a's listener waits for a's listener to
    // finish; an empty batch in the middle does not change that.
    expect(order).toEqual(["a start", "a end", "b heard"]);
    await system.stop();
  });
});

// ---------------------------------------------------------------------------
// createModule, in development
// ---------------------------------------------------------------------------

describe("createModule in development, for a module built from facts, derivations and events", () => {
  const create = createModule as unknown as (
    id: unknown,
    config: unknown,
  ) => Any;

  it("warns about a badly formed module", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    create("Not_Kebab", {});
    const afterId = spy.mock.calls.length;
    expect(afterId).toBeGreaterThan(0);

    create(5, { schema: { facts: { count: t.number() } } });
    const afterType = spy.mock.calls.length;
    expect(afterType).toBeGreaterThan(afterId);

    create("m", {
      schema: {
        facts: { count: t.number() },
        derivations: { doubled: t.number() },
        events: { declared: {} },
      },
      derive: { tripled: () => 3 },
      events: { other: () => undefined },
    });
    const afterKeys = spy.mock.calls.length;
    expect(afterKeys).toBeGreaterThan(afterType);

    create("m", { schema: { count: t.number() } });
    expect(spy.mock.calls.length).toBeGreaterThan(afterKeys);
  });

  it("stays quiet about a module that is well formed", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    create("well-formed", {
      schema: {
        facts: { count: t.number() },
        derivations: { doubled: t.number() },
        events: { bump: {} },
      },
      derive: { doubled: (f: Any) => f.count * 2 },
      events: { bump: (f: Any) => void (f.count = f.count + 1) },
    });

    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

describe("tracking: what is read after an untracked read", () => {
  it("a derivation keeps tracking the reads that follow a $snapshot read", async () => {
    let computes = 0;
    const mod = createModule("m", {
      schema: {
        facts: { a: t.number(), b: t.number() },
        derivations: { sum: t.number() },
      },
      init: (f: Any) => {
        f.a = 1;
        f.b = 10;
      },
      derive: {
        sum: (f: Any) => {
          computes++;
          // Not a dependency: a snapshot read never is.
          const a = f.$snapshot().get("a");

          // Still a dependency, though it comes after.
          return a + f.b;
        },
      },
    });
    const system = createSystem({ module: mod } as Any) as Any;
    system.start();
    await system.settle();

    expect(system.derive.sum).toBe(11);
    expect(computes).toBe(1);

    system.facts.b = 20;
    expect(system.derive.sum).toBe(21);
    expect(computes).toBe(2);

    system.facts.b = 30;
    expect(system.derive.sum).toBe(31);
    expect(computes).toBe(3);
    await system.stop();
  });

  it("a derivation keeps tracking the reads that follow a $snapshot membership test", async () => {
    const mod = createModule("m", {
      schema: {
        facts: { a: t.number(), b: t.number() },
        derivations: { label: t.string() },
      },
      init: (f: Any) => {
        f.a = 1;
        f.b = 10;
      },
      derive: {
        label: (f: Any) => `${f.$snapshot().has("a")}:${f.b}`,
      },
    });
    const system = createSystem({ module: mod } as Any) as Any;
    system.start();
    await system.settle();

    expect(system.derive.label).toBe("true:10");

    system.facts.b = 11;
    expect(system.derive.label).toBe("true:11");
    await system.stop();
  });
});

describe("tracking: a body that has already awaited", () => {
  it("an effect still reads derivations after it awaits", async () => {
    // Development warns that auto-tracking cannot see across an await.
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const seen: number[] = [];
    const mod = createModule("m", {
      schema: {
        facts: { count: t.number() },
        derivations: { doubled: t.number() },
      },
      init: (f: Any) => {
        f.count = 2;
      },
      derive: { doubled: (f: Any) => f.count * 2 },
      effects: effectsOf({
        later: async (_facts: Any, _prev: Any, derived: Any) => {
          await Promise.resolve();
          seen.push(derived.doubled);
        },
      }),
    });
    const system = createSystem({ module: mod } as Any) as Any;
    system.start();
    await system.settle();
    await flush();

    // An effect with nothing tracked may run again on a later reconcile; every
    // run reads the same value.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((value) => value === 4)).toBe(true);
    await system.stop();
  });

  it("a derivation handle kept from an effect's run still reads after the run has finished", async () => {
    const kept: { derived?: Any } = {};
    const mod = createModule("m", {
      schema: {
        facts: { count: t.number() },
        derivations: { doubled: t.number() },
      },
      init: (f: Any) => {
        f.count = 3;
      },
      derive: { doubled: (f: Any) => f.count * 2 },
      effects: effectsOf({
        keep: (_facts: Any, _prev: Any, derived: Any) => {
          kept.derived = derived;
        },
      }),
    });
    const system = createSystem({ module: mod } as Any) as Any;
    system.start();
    await system.settle();

    expect(kept.derived.doubled).toBe(6);
    expect("doubled" in kept.derived).toBe(true);

    system.facts.count = 4;
    expect(kept.derived.doubled).toBe(8);
    await system.stop();
  });
});
