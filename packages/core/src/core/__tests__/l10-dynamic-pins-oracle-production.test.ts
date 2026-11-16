import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Production build: the dev flag is the constant `false`.
vi.mock("#is-development", () => ({ default: false }));

const { createModule, createSystem, t } = await import("../../index.js");

// The production halves of the L10 RFC's U4, U9a, U9b, U10, U16, U20 and
// U22. The diff harness runs development builds only, so the production
// answers of its scenarios (U9a, U9b, U20) are pinned here. 1.35 keeps its
// refusal texts in production. Public API only.

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function probe() {
  return createModule("m", {
    schema: {
      facts: { a: t.number(), log: t.string() },
      derivations: { double: t.number() },
      events: {},
      requirements: { WORK: {} },
    },
    init: (facts: any) => {
      facts.a = 1;
      facts.log = "";
    },
    derive: { double: (facts: any) => facts.a * 2 },
  } as never);
}

function begin() {
  const system = createSystem({ module: probe() } as never) as any;
  system.start();

  return system;
}

describe("production: a subscriber to a name not registered yet (U4; row bn, declined)", () => {
  it("is never called, and nothing is printed", async () => {
    const system = begin();
    const heard: unknown[] = [];
    system.subscribe(["later"], () => heard.push(1));
    system.derive.register("later", (facts: any) => facts.a + 100);
    system.facts.a = 5;
    await wait(5);

    expect(system.read("later")).toBe(105);
    expect(heard).toEqual([]);
    expect(console.warn).not.toHaveBeenCalled();
    system.destroy();
  });
});

describe("production: unregistering a constraint while its resolver runs (U9a, U9b)", () => {
  for (const [delay, bound] of [
    [0, false],
    [5, false],
    [0, true],
    [5, true],
  ] as const) {
    it(`aborts the resolver's signal, and its write still lands (${delay} ms${bound ? ", bound with abortOn" : ""})`, async () => {
      const system = begin();
      await wait(1);
      let aborted: boolean | null = null;
      system.resolvers.register("work", {
        requirement: "WORK",
        resolve: async (_req: unknown, context: any) => {
          await wait(30);
          aborted = context.signal.aborted;
          context.facts.log = "done";
        },
      });
      system.constraints.register("dyn", {
        when: (facts: any) => facts.a > 1,
        require: { type: "WORK" },
        ...(bound ? { abortOn: ["a"] } : {}),
      });
      system.facts.a = 2;
      await wait(delay);
      system.constraints.unregister("dyn");

      expect(system.constraints.isDynamic("dyn")).toBe(false);
      await wait(60);
      await system.settle();
      expect(aborted).toBe(true);
      expect(system.facts.log).toBe("done");
      expect(system.inspect().unmet).toEqual([]);
      system.destroy();
    });
  }
});

describe("production: unregistering a static or unknown id (U10)", () => {
  it("returns and prints nothing", () => {
    const system = begin();

    expect(system.derive.unregister("double")).toBeUndefined();
    expect(system.effects.unregister("nope")).toBeUndefined();
    expect(system.constraints.unregister("nope")).toBeUndefined();
    expect(console.warn).not.toHaveBeenCalled();
    expect(system.read("double")).toBe(2);
    system.destroy();
  });
});

describe("production keeps 1.35's refusal texts (U16)", () => {
  it("for an id (D1)", () => {
    const system = begin();

    expect(() => system.derive.register("call", () => 0)).toThrow(
      '[Directive] Derivation ID "call" conflicts with a reserved derive method name.',
    );
    expect(() =>
      system.effects.register("my::effect", { run: () => {} }),
    ).toThrow(
      '[Directive] Definition ID "my::effect" cannot contain "::". This separator is reserved for namespacing.',
    );
    expect(() =>
      system.constraints.register("__proto__", {
        when: () => true,
        require: { type: "WORK" },
      }),
    ).toThrow(
      '[Directive] Security: Definition ID "__proto__" is a blocked property.',
    );
    expect(() =>
      system.constraints.register("", {
        when: () => true,
        require: { type: "WORK" },
      }),
    ).toThrow(
      "[Directive] Definition ID must be a non-empty string. Received: ",
    );
    system.destroy();
  });

  it("for a duplicate or a missing id (D2), and an unknown call", async () => {
    const system = begin();

    expect(() => system.derive.register("double", () => 0)).toThrow(
      '[Directive] Derivation "double" already exists. Use assign() to override.',
    );
    expect(() => system.derive.assign("ghost", () => 0)).toThrow(
      '[Directive] Derivation "ghost" does not exist. Use register() to create it.',
    );
    expect(() => system.effects.assign("ghost", { run: () => {} })).toThrow(
      '[Directive] Effect "ghost" does not exist. Use register() to create it.',
    );
    expect(() => system.derive.call("nope")).toThrow(
      '[Directive] Cannot call derivation "nope" — it does not exist.',
    );
    await expect(system.constraints.call("nope")).rejects.toThrow(
      '[Directive] Cannot call constraint "nope" — it does not exist.',
    );
    system.destroy();
  });

  it("on a destroyed system (D4)", () => {
    const system = begin();
    system.destroy();

    expect(() => system.derive.register("x", () => 0)).toThrow(
      '[Directive] Cannot register derivation "x" on a destroyed system.',
    );
    expect(() =>
      system.constraints.assign("x", {
        when: () => true,
        require: { type: "WORK" },
      }),
    ).toThrow(
      '[Directive] Cannot assign constraint "x" on a destroyed system.',
    );
    expect(() => system.constraints.unregister("x")).toThrow(
      '[Directive] Cannot unregister constraint "x" on a destroyed system.',
    );
    expect(() => system.derive.call("double")).toThrow(
      '[Directive] Cannot call derivation "double" on a destroyed system.',
    );
  });
});

describe("production: unregisterModule with a history window open (U20)", () => {
  async function withModule() {
    const m = createModule("m", {
      schema: { facts: { a: t.number() } },
      init: (facts: any) => {
        facts.a = 1;
      },
    } as never);
    const system = createSystem({
      modules: { m },
      history: true,
    } as never) as any;
    system.start();
    await wait(5);
    system.registerModule(
      "x",
      createModule("x", {
        schema: { facts: { c: t.number() } },
        init: (facts: any) => {
          facts.c = 10;
        },
      } as never),
    );
    await wait(5);

    return system;
  }

  it("inside a changeset: one snapshot at once, none at endChangeset", async () => {
    const system = await withModule();

    expect(system.history.snapshots.length).toBe(2);
    system.history.beginChangeset("cs");
    await system.unregisterModule("x");
    await wait(5);
    expect(system.history.snapshots.length).toBe(3);
    system.history.endChangeset();
    await wait(5);
    expect(system.history.snapshots.length).toBe(3);
    expect(system.facts.x).toBeUndefined();
    expect(Object.keys(system.history.snapshots.at(-1).facts)).toEqual([
      "m::a",
    ]);
    system.destroy();
  });

  it("started inside system.batch: the teardown runs, with one snapshot", async () => {
    const system = await withModule();
    let done: Promise<unknown> | undefined;
    system.batch(() => {
      done = system.unregisterModule("x");
    });
    await done;
    await wait(5);

    expect(system.facts.x).toBeUndefined();
    expect(system.history.snapshots.length).toBe(3);
    system.destroy();
  });
});

describe("production: getOriginal and restoreOriginal are not on a 1.35 system (U22; row bo, declined)", () => {
  it("a single-module system has neither member", () => {
    const system = begin();
    system.derive.assign("double", (facts: any) => facts.a * 10);

    expect(typeof system.getOriginal).toBe("undefined");
    expect(typeof system.restoreOriginal).toBe("undefined");
    system.destroy();
  });
});
