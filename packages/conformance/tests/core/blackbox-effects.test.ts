// Ported from packages/core/src/core/__tests__/blackbox-effects.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// Black-box tests for effects, written to kill surviving mutants of
// effects.ts. Public API only: createModule / createSystem, the `effects`
// definitions, `system.effects.*`, plugin hooks and the error boundary.

afterEach(() => {
  vi.restoreAllMocks();
});

const schema = {
  facts: {
    count: t.number(),
    name: t.string(),
    flag: t.boolean(),
    obj: t.object<{ x: number }>(),
  },
  derivations: { doubled: t.number() },
};

interface Spy {
  runs: string[];
  errors: Array<[string, unknown]>;
  blocked: Array<[string, string]>;
}

function build(
  effects: Record<string, unknown>,
  options: Record<string, unknown> = {},
) {
  const spy: Spy = { runs: [], errors: [], blocked: [] };
  const mod = createModule("m", {
    schema,
    init: (facts: any) => {
      facts.count = 0;
      facts.name = "alice";
      facts.flag = false;
      facts.obj = { x: 1 };
    },
    derive: { doubled: (facts) => facts.count * 2 },
    effects: effects as never,
  });
  const system = createSystem({
    module: mod,
    plugins: [
      {
        name: "spy",
        onEffectRun: (id: string) => {
          spy.runs.push(id);
        },
        onEffectError: (id: string, error: unknown) => {
          spy.errors.push([id, error]);
        },
        onEffectWriteBlocked: (id: string, key: string) => {
          spy.blocked.push([id, key]);
        },
      },
    ],
    ...options,
  } as never);

  return { system: system as any, spy };
}

async function bump(
  system: { facts: any; settle: () => Promise<void> },
  key: string,
  value: unknown,
) {
  system.facts[key] = value;
  await system.settle();
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

function quiet() {
  return {
    warn: vi.spyOn(console, "warn").mockImplementation(() => undefined),
    error: vi.spyOn(console, "error").mockImplementation(() => undefined),
  };
}

// ============================================================================
// Which functions are handed the previous facts
// ============================================================================

// biome-ignore lint/complexity/useArrowFunction: `arguments` needs a function
function viaArguments(seen: unknown[]) {
  return function (this: unknown, facts: any) {
    void facts.count;
    // biome-ignore lint/style/noArguments: the point is a hidden second read
    seen.push(arguments[1]);
  };
}

function boundNative(seen: unknown[]) {
  // biome-ignore lint/complexity/useArrowFunction: `arguments` needs a function
  return function (_a: unknown, facts: any) {
    void facts.count;
    // biome-ignore lint/style/noArguments: the point is a hidden third read
    seen.push(arguments[2]);
  }.bind(null, 1);
}

describe("an effect that can read prevFacts is handed them", () => {
  const readers: Array<[string, (seen: unknown[]) => unknown]> = [
    [
      "two named parameters",
      (seen) => (facts: any, prev: any) => {
        void facts.count;
        seen.push(prev);
      },
    ],
    [
      "a defaulted second parameter",
      (seen) =>
        (facts: any, prev: any = undefined) => {
          void facts.count;
          seen.push(prev);
        },
    ],
    [
      "a rest second parameter",
      (seen) =>
        (facts: any, ...rest: any[]) => {
          void facts.count;
          seen.push(rest[0]);
        },
    ],
    [
      "only a rest parameter",
      (seen) =>
        (...args: any[]) => {
          void args[0].count;
          seen.push(args[1]);
        },
    ],
    [
      "a destructured first parameter and a defaulted second",
      (seen) =>
        ({ count }: any, prev: any = undefined) => {
          void count;
          seen.push(prev);
        },
    ],
    [
      "a first parameter with a default value and a second",
      (seen) =>
        (facts: any = {}, prev: any = undefined) => {
          void facts.count;
          seen.push(prev);
        },
    ],
    ["the arguments object", viaArguments],
    ["a bound function", boundNative],
    [
      "a method shorthand",
      (seen) =>
        ({
          run(facts: any, prev: any = undefined) {
            void facts.count;
            seen.push(prev);
          },
        }).run,
    ],
  ];

  for (const [label, make] of readers) {
    it(`when it has ${label}`, async () => {
      const seen: any[] = [];
      const { system } = build({ e: { run: make(seen) } });
      await system.start();

      expect(seen[0] ?? null).toBeNull();

      await bump(system, "count", 1);

      const last = seen[seen.length - 1];
      expect(last).not.toBeNull();
      expect(last).not.toBeUndefined();
      expect(last.count).toBe(0);
      await system.destroy();
    });

    it(`with explicit deps, when it has ${label}`, async () => {
      const seen: any[] = [];
      const { system } = build({ e: { deps: ["count"], run: make(seen) } });
      await system.start();
      await bump(system, "count", 1);
      await bump(system, "count", 2);

      const last = seen[seen.length - 1];
      expect(last.count).toBe(1);
      await system.destroy();
    });
  }

  it("when run is not a function the system still starts", async () => {
    const { system } = build({ e: { deps: ["count"], run: undefined } });
    quiet();
    await system.start();
    await bump(system, "count", 1);
    await system.destroy();
  });

  it("a namespaced effect gets prev when its own run takes it", async () => {
    const seen: any[] = [];
    const a = createModule("a", {
      schema: { facts: { n: t.number() } },
      init: (facts: any) => {
        facts.n = 0;
      },
      effects: {
        watch: {
          deps: ["n"],
          run: (facts: any, prev: any) => {
            seen.push([facts.n, prev?.n ?? null]);
          },
        },
      },
    });
    const b = createModule("b", {
      schema: { facts: { m: t.number() } },
      init: (facts: any) => {
        facts.m = 0;
      },
    });
    const system = createSystem({ modules: { a, b } } as never) as any;
    await system.start();
    system.facts.a.n = 4;
    await system.settle();

    expect(seen[seen.length - 1]).toEqual([4, 0]);
    await system.destroy();
  });

  it("a namespaced effect that ignores prev still runs", async () => {
    const seen: any[] = [];
    const a = createModule("a", {
      schema: { facts: { n: t.number() } },
      init: (facts: any) => {
        facts.n = 0;
      },
      effects: {
        watch: {
          deps: ["n"],
          run: (facts: any) => {
            seen.push(facts.n);
          },
        },
      },
    });
    const b = createModule("b", {
      schema: { facts: { m: t.number() } },
      init: (facts: any) => {
        facts.m = 0;
      },
    });
    const system = createSystem({ modules: { a, b } } as never) as any;
    await system.start();
    system.facts.a.n = 4;
    await system.settle();

    expect(seen[seen.length - 1]).toBe(4);
    await system.destroy();
  });
});

describe("prevFacts values", () => {
  it("is null on the first run and the previous pass's facts after", async () => {
    const seen: any[] = [];
    const { system } = build({
      e: {
        deps: ["count"],
        run: (facts: any, prev: any) => {
          seen.push([facts.count, prev ? prev.count : null]);
        },
      },
    });
    await system.start();
    await bump(system, "count", 1);
    await bump(system, "count", 5);
    await bump(system, "count", 6);

    expect(seen).toEqual([
      [0, null],
      [1, 0],
      [5, 1],
      [6, 5],
    ]);
    await system.destroy();
  });

  it("an effect registered later sees the facts as they were at registration", async () => {
    const seen: any[] = [];
    const { system } = build({
      plain: { deps: ["count"], run: (_facts: any) => undefined },
    });
    await system.start();
    await bump(system, "count", 3);
    system.effects.register("late", {
      deps: ["count"],
      run: (_facts: any, prev: any) => {
        seen.push(prev ? prev.count : null);
      },
    });
    await bump(system, "count", 9);

    expect(seen[seen.length - 1]).toBe(3);
    await system.destroy();
  });

  it("a reader registered after the last one left is backfilled", async () => {
    const seen: any[] = [];
    const { system } = build({
      reader: {
        deps: ["count"],
        run: (_facts: any, prev: any) => {
          seen.push(prev);
        },
      },
    });
    await system.start();
    system.effects.assign("reader", {
      deps: ["count"],
      run: (_facts: any) => undefined,
    });
    await bump(system, "count", 2);
    system.effects.assign("reader", {
      deps: ["count"],
      run: (_facts: any, prev: any) => {
        seen.push(prev ? prev.count : null);
      },
    });
    await bump(system, "count", 7);

    expect(seen[seen.length - 1]).toBe(2);
    await system.destroy();
  });

  it("a data gate on $changed works although the body reads no prev", async () => {
    const runs: number[] = [];
    const { system } = build({
      gated: {
        on: { count: { $changed: true } },
        run: (facts: any) => {
          runs.push(facts.count);
        },
      },
    });
    await system.start();
    const before = runs.length;
    await bump(system, "count", 1);
    expect(runs.length).toBe(before + 1);
    await bump(system, "name", "bob");
    expect(runs.length).toBe(before + 1);
    await bump(system, "count", 2);
    expect(runs.length).toBe(before + 2);
    expect(runs[runs.length - 1]).toBe(2);
    await system.destroy();
  });

  it("a data gate registered later fires only for a real change", async () => {
    const runs: number[] = [];
    const { system } = build({
      plain: { deps: ["name"], run: (_facts: any) => undefined },
    });
    await system.start();
    await bump(system, "count", 4);
    system.effects.register("gated", {
      on: { count: { $changed: true } },
      run: (facts: any) => {
        runs.push(facts.count);
      },
    });
    await bump(system, "name", "bob");
    expect(runs).toEqual([]);
    await bump(system, "count", 5);
    expect(runs).toEqual([5]);
    await system.destroy();
  });

  it("is refreshed after a pass whose effects are async", async () => {
    const seen: any[] = [];
    const { system } = build({
      e: {
        deps: ["count"],
        run: async (facts: any, prev: any) => {
          await Promise.resolve();
          seen.push([facts.count, prev ? prev.count : null]);
        },
      },
    });
    await system.start();
    await bump(system, "count", 1);
    await bump(system, "count", 2);

    expect(seen[seen.length - 1]).toEqual([2, 1]);
    await system.destroy();
  });

  it("is refreshed after a pass in which an effect threw", async () => {
    quiet();
    const seen: any[] = [];
    const { system } = build({
      e: {
        deps: ["count"],
        run: (facts: any, prev: any) => {
          seen.push(prev ? prev.count : null);
          if (facts.count === 1) {
            throw new Error("boom");
          }
        },
      },
    });
    await system.start();
    await bump(system, "count", 1);
    await bump(system, "count", 2);

    expect(seen[seen.length - 1]).toBe(1);
    await system.destroy();
  });
});

// ============================================================================
// Which effects run
// ============================================================================

describe("which effects run", () => {
  it("every enabled effect runs once at start, and a disabled one waits", async () => {
    const ran: string[] = [];
    const { system } = build({
      a: { deps: ["count"], run: () => void ran.push("a") },
      b: { run: (facts: any) => void ran.push(`b${facts.count}`) },
      c: { on: { count: { $gt: 100 } }, run: () => void ran.push("c") },
    });
    system.effects.disable("a");
    await system.start();

    expect(ran).toContain("b0");
    expect(ran).not.toContain("a");
    expect(system.effects.isEnabled("a")).toBe(false);
    expect(system.effects.isEnabled("b")).toBe(true);

    system.effects.enable("a");
    expect(system.effects.isEnabled("a")).toBe(true);
    await bump(system, "count", 1);
    expect(ran).toContain("a");
    await system.destroy();
  });

  it("explicit deps run for their own changes and not for others", async () => {
    const ran: number[] = [];
    const { system } = build({
      e: { deps: ["count"], run: (facts: any) => void ran.push(facts.count) },
    });
    await system.start();
    ran.length = 0;

    await bump(system, "name", "bob");
    await bump(system, "flag", true);
    expect(ran).toEqual([]);

    await bump(system, "count", 1);
    expect(ran).toEqual([1]);
    await bump(system, "count", 2);
    expect(ran).toEqual([1, 2]);
    await system.destroy();
  });

  it("an auto-tracked effect runs only for what it read", async () => {
    const ran: number[] = [];
    const { system } = build({
      e: { run: (facts: any) => void ran.push(facts.count) },
    });
    await system.start();
    ran.length = 0;

    await bump(system, "name", "bob");
    expect(ran).toEqual([]);
    await bump(system, "count", 3);
    expect(ran).toEqual([3]);
    await system.destroy();
  });

  it("an auto-tracked effect that read nothing runs on every change", async () => {
    let runs = 0;
    const { system } = build({
      e: {
        run: () => {
          runs++;
        },
      },
    });
    await system.start();
    const before = runs;
    await bump(system, "name", "bob");
    await bump(system, "flag", true);

    expect(runs).toBe(before + 2);
    await system.destroy();
  });

  it("a disabled effect is skipped, enabling brings it back", async () => {
    const ran: number[] = [];
    const { system } = build({
      e: { deps: ["count"], run: (facts: any) => void ran.push(facts.count) },
    });
    await system.start();
    system.effects.disable("e");
    await bump(system, "count", 1);
    expect(ran).toEqual([0]);

    system.effects.enable("e");
    await bump(system, "count", 2);
    expect(ran).toEqual([0, 2]);
    await system.destroy();
  });

  it("an effect disabled by an earlier one in the same pass does not run", async () => {
    const ran: string[] = [];
    const holder: { sys?: any } = {};
    const { system } = build({
      first: {
        deps: ["count"],
        run: () => {
          ran.push("first");
          holder.sys.effects.disable("second");
        },
      },
      second: { deps: ["count"], run: () => void ran.push("second") },
    });
    holder.sys = system;
    await system.start();
    ran.length = 0;
    system.effects.enable("second");
    await bump(system, "count", 1);

    expect(ran).toEqual(["first"]);
    await system.destroy();
  });

  it("a disabled effect drops the derivations it pinned", async () => {
    const ran: number[] = [];
    const { system } = build({
      e: {
        deps: ["doubled"],
        run: (_facts: any, _prev: any, derived: any) =>
          void ran.push(derived.doubled),
      },
    });
    await system.start();
    await bump(system, "count", 1);
    expect(ran[ran.length - 1]).toBe(2);
    system.effects.disable("e");
    await bump(system, "count", 2);
    system.effects.enable("e");
    await bump(system, "count", 3);

    expect(ran[ran.length - 1]).toBe(6);
    await system.destroy();
  });

  it("an async effect makes settle() wait for it", async () => {
    const gate = deferred();
    const done: string[] = [];
    const { system } = build({
      slow: {
        deps: ["count"],
        run: async (facts: any) => {
          if (facts.count === 0) {
            return;
          }
          await gate.promise;
          done.push("slow");
        },
      },
      fast: { deps: ["count"], run: () => void done.push("fast") },
    });
    await system.start();
    done.length = 0;
    system.facts.count = 1;
    const settled = system.settle().then(() => done.push("settled"));
    await flush();
    expect(done).toEqual(["fast"]);
    gate.resolve();
    await settled;

    expect(done).toEqual(["fast", "slow", "settled"]);
    await system.destroy();
  });

  it("an async auto-tracked effect makes settle() wait for it too", async () => {
    const gate = deferred();
    const done: string[] = [];
    const { system } = build({
      slow: {
        run: async (facts: any) => {
          const n = facts.count;
          if (n === 0) {
            return;
          }
          await gate.promise;
          done.push(`slow${n}`);
        },
      },
    });
    await system.start();
    system.facts.count = 1;
    const settled = system.settle().then(() => done.push("settled"));
    await flush();
    expect(done).toEqual([]);
    gate.resolve();
    await settled;

    expect(done).toEqual(["slow1", "settled"]);
    await system.destroy();
  });

  it("a synchronous effect has finished by the time the write settles", async () => {
    const ran: number[] = [];
    const { system } = build({
      e: { deps: ["count"], run: (facts: any) => void ran.push(facts.count) },
    });
    await system.start();
    system.facts.count = 4;
    await system.settle();

    expect(ran[ran.length - 1]).toBe(4);
    await system.destroy();
  });

  it("system.effects.call runs the effect now, even without a change", async () => {
    const ran: number[] = [];
    const { system } = build({
      e: { deps: ["count"], run: (facts: any) => void ran.push(facts.count) },
    });
    await system.start();
    ran.length = 0;
    await system.effects.call("e");
    await system.effects.call("e");

    expect(ran).toEqual([0, 0]);
    await system.destroy();
  });

  it("call on a disabled effect does nothing", async () => {
    const ran: number[] = [];
    const { system, spy } = build({
      e: { deps: ["count"], run: (facts: any) => void ran.push(facts.count) },
    });
    await system.start();
    ran.length = 0;
    spy.runs.length = 0;
    system.effects.disable("e");
    await system.effects.call("e");

    expect(ran).toEqual([]);
    expect(spy.runs).toEqual([]);
    await system.destroy();
  });

  it("call on an unknown effect names it", async () => {
    const { system } = build({});
    await system.start();

    await expect(system.effects.call("nope")).rejects.toThrow(/nope/);
    await system.destroy();
  });

  it("call reports a throw and an async rejection, and does not reject", async () => {
    const { error } = quiet();
    const { system, spy } = build({
      sync: {
        deps: ["count"],
        run: (facts: any) => {
          if (facts.count === 0) {
            return;
          }
          throw new Error("sync boom");
        },
      },
      asyn: {
        deps: ["count"],
        run: async (facts: any) => {
          if (facts.count === 0) {
            return;
          }
          throw new Error("async boom");
        },
      },
    });
    await system.start();
    system.effects.disable("sync");
    system.effects.disable("asyn");
    await bump(system, "count", 1);
    system.effects.enable("sync");
    system.effects.enable("asyn");
    spy.errors.length = 0;
    error.mockClear();

    await system.effects.call("sync");
    await system.effects.call("asyn");

    expect(spy.errors.map(([id]) => id)).toEqual(["sync", "asyn"]);
    expect((spy.errors[0]![1] as Error).message).toBe("sync boom");
    expect((spy.errors[1]![1] as Error).message).toBe("async boom");
    expect(error).toHaveBeenCalledTimes(2);
    expect(String(error.mock.calls[0]![0])).toContain("sync");
    await system.destroy();
  });

  it("a run reports itself to plugins and names the effect on the stack", async () => {
    const { system, spy } = build({
      a: { deps: ["count"], run: () => undefined },
      b: { deps: ["name"], run: () => undefined },
    });
    await system.start();
    spy.runs.length = 0;
    await bump(system, "count", 1);

    expect(spy.runs).toEqual(["a"]);
    await system.effects.call("b");
    expect(spy.runs).toEqual(["a", "b"]);
    await system.destroy();
  });
});

// ============================================================================
// Declared dependencies
// ============================================================================

describe("declared dependencies", () => {
  it("a derivation name runs the effect when the derivation changes", async () => {
    const seen: number[] = [];
    const { system } = build({
      e: {
        deps: ["doubled"],
        run: (_facts: any, _prev: any, derived: any) =>
          void seen.push(derived.doubled),
      },
    });
    await system.start();
    seen.length = 0;
    await bump(system, "name", "bob");
    expect(seen).toEqual([]);
    await bump(system, "count", 2);
    expect(seen).toEqual([4]);
    await system.destroy();
  });

  it("a derivation registered after the effect is picked up", async () => {
    const seen: number[] = [];
    const { system } = build({});
    await system.start();
    system.effects.register("e", {
      deps: ["late"],
      run: (facts: any) => void seen.push(facts.count),
    });
    await bump(system, "name", "bob");
    system.derive.register("late", (facts: any) => facts.count + 100);
    void system.derive.late;
    await bump(system, "name", "carol");
    await bump(system, "count", 4);
    seen.length = 0;
    await bump(system, "count", 5);

    expect(seen.length).toBeGreaterThan(0);
    await system.destroy();
  });

  it("one of several unresolved names becoming a derivation is enough", async () => {
    const seen: number[] = [];
    const { system } = build({});
    await system.start();
    system.effects.register("e", {
      deps: ["ghostA", "ghostB"],
      run: (facts: any) => void seen.push(facts.count),
    });
    await bump(system, "name", "bob");
    system.derive.register("ghostB", (facts: any) => facts.count + 1);
    void system.derive.ghostB;
    await bump(system, "name", "carol");
    await bump(system, "count", 4);
    seen.length = 0;
    await bump(system, "count", 5);

    expect(seen.length).toBeGreaterThan(0);
    await system.destroy();
  });

  it("an unresolved name never makes the effect run for unrelated changes", async () => {
    const seen: number[] = [];
    const { system } = build({});
    await system.start();
    system.effects.register("e", {
      deps: ["ghost"],
      run: (facts: any) => void seen.push(facts.count),
    });
    await bump(system, "name", "bob");
    await bump(system, "count", 1);
    await bump(system, "flag", true);

    expect(seen).toEqual([]);
    await system.destroy();
  });

  it("a fact name among unresolved ones keeps working", async () => {
    const seen: number[] = [];
    const { system } = build({
      e: {
        deps: ["count", "ghost"],
        run: (facts: any) => void seen.push(facts.count),
      },
    });
    await system.start();
    seen.length = 0;
    await bump(system, "count", 2);
    await bump(system, "name", "bob");

    expect(seen).toEqual([2]);
    await system.destroy();
  });

  it("an empty deps array means the effect never runs for a change", async () => {
    const seen: number[] = [];
    const { system } = build({
      e: { deps: [], run: (facts: any) => void seen.push(facts.count) },
    });
    await system.start();
    seen.length = 0;
    await bump(system, "count", 2);

    expect(seen).toEqual([]);
    await system.destroy();
  });
});

// ============================================================================
// Data-form `on`
// ============================================================================

describe("data-form on", () => {
  it("rejects a value that is not a predicate, by what it is", () => {
    const attempt = (on: unknown) => () =>
      build({ e: { on, run: () => undefined } });

    expect(attempt("nope")).toThrow(/effect on must be a FactPredicate spec/);
    expect(attempt(42)).toThrow(/got number/);
  });

  it("freezes the spec it was given", () => {
    const on = { count: { $gt: 1 } };
    build({ e: { on, run: () => undefined } });

    expect(Object.isFrozen(on)).toBe(true);
  });

  it("fires only when the gate holds, and only for changes to its facts", async () => {
    const ran: number[] = [];
    const { system } = build({
      e: {
        on: { count: { $gt: 5 } },
        run: (facts: any) => void ran.push(facts.count),
      },
    });
    await system.start();
    ran.length = 0;

    await bump(system, "count", 3);
    expect(ran).toEqual([]);
    await bump(system, "name", "bob");
    expect(ran).toEqual([]);
    await bump(system, "count", 9);
    expect(ran).toEqual([9]);
    await bump(system, "name", "carol");
    expect(ran).toEqual([9]);
    await system.destroy();
  });

  it("keeps the predicate's facts as its deps whatever the body reads", async () => {
    const ran: string[] = [];
    const { system } = build({
      e: {
        on: { count: { $gt: 0 } },
        run: (facts: any) => void ran.push(facts.name),
      },
    });
    await system.start();
    await bump(system, "count", 1);
    await bump(system, "count", 2);
    await bump(system, "count", 3);
    await bump(system, "count", 4);
    await bump(system, "count", 5);
    ran.length = 0;
    await bump(system, "name", "bob");

    expect(ran).toEqual([]);
    await system.destroy();
  });

  it("swapping to a function-form effect drops the old gate", async () => {
    const ran: number[] = [];
    const { system } = build({
      e: { on: { count: { $gt: 100 } }, run: () => undefined },
    });
    await system.start();
    system.effects.assign("e", {
      deps: ["count"],
      run: (facts: any) => void ran.push(facts.count),
    });
    await bump(system, "count", 1);

    expect(ran).toEqual([1]);
    await system.destroy();
  });

  it("swapping a function-form effect for a gated one installs the gate", async () => {
    const ran: number[] = [];
    const { system } = build({
      e: { deps: ["count"], run: () => undefined },
    });
    await system.start();
    system.effects.assign("e", {
      on: { count: { $gt: 100 } },
      run: (facts: any) => void ran.push(facts.count),
    });
    await bump(system, "count", 1);
    expect(ran).toEqual([]);
    await bump(system, "count", 101);
    expect(ran).toEqual([101]);
    await system.destroy();
  });

  it("unregistering a gated effect drops its gate", async () => {
    const ran: number[] = [];
    const { system } = build({});
    await system.start();
    system.effects.register("e", {
      on: { count: { $gt: 100 } },
      run: () => void ran.push(-1),
    });
    system.effects.unregister("e");
    system.effects.register("e", {
      deps: ["count"],
      run: (facts: any) => void ran.push(facts.count),
    });
    await bump(system, "count", 1);

    expect(ran).toEqual([1]);
    await system.destroy();
  });
});

// ============================================================================
// Cleanup
// ============================================================================

describe("cleanup", () => {
  it("runs before the next run, once, and not again", async () => {
    const order: string[] = [];
    const { system } = build({
      e: {
        deps: ["count"],
        run: (facts: any) => {
          const n = facts.count;
          order.push(`run ${n}`);

          return () => order.push(`cleanup ${n}`);
        },
      },
    });
    await system.start();
    await bump(system, "count", 1);
    await bump(system, "name", "bob");
    await bump(system, "count", 2);

    expect(order).toEqual([
      "run 0",
      "cleanup 0",
      "run 1",
      "cleanup 1",
      "run 2",
    ]);
    await system.destroy();
  });

  it("an auto-tracked effect's cleanup is stored too", async () => {
    const order: string[] = [];
    const { system } = build({
      e: {
        run: (facts: any) => {
          const n = facts.count;
          order.push(`run ${n}`);

          return () => order.push(`cleanup ${n}`);
        },
      },
    });
    await system.start();
    await bump(system, "count", 1);
    await bump(system, "count", 2);

    expect(order).toEqual([
      "run 0",
      "cleanup 0",
      "run 1",
      "cleanup 1",
      "run 2",
    ]);
    await system.destroy();
  });

  it("an async effect's cleanup is stored when it settles", async () => {
    const order: string[] = [];
    const { system } = build({
      e: {
        deps: ["count"],
        run: async (facts: any) => {
          const n = facts.count;
          await Promise.resolve();
          order.push(`run ${n}`);

          return () => order.push(`cleanup ${n}`);
        },
      },
    });
    await system.start();
    await bump(system, "count", 1);

    expect(order).toEqual(["run 0", "cleanup 0", "run 1"]);
    await system.destroy();
  });

  it("an async auto-tracked effect's cleanup is stored when it settles", async () => {
    const order: string[] = [];
    const { system } = build({
      e: {
        run: async (facts: any) => {
          const n = facts.count;
          await Promise.resolve();
          order.push(`run ${n}`);

          return () => order.push(`cleanup ${n}`);
        },
      },
    });
    await system.start();
    await bump(system, "count", 1);

    expect(order).toEqual(["run 0", "cleanup 0", "run 1"]);
    await system.destroy();
  });

  it("stop() runs every pending cleanup, once", async () => {
    const order: string[] = [];
    const { system } = build({
      a: { deps: ["count"], run: () => () => order.push("a") },
      b: {
        run: (facts: any) => {
          void facts.name;

          return () => order.push("b");
        },
      },
    });
    await system.start();
    await system.stop();

    expect(order.sort()).toEqual(["a", "b"]);
    await system.destroy();
    expect(order.sort()).toEqual(["a", "b"]);
  });

  it("destroy() runs pending cleanups", async () => {
    const order: string[] = [];
    const { system } = build({
      a: { deps: ["count"], run: () => () => order.push("a") },
    });
    await system.start();
    system.destroy();
    await flush();

    expect(order).toEqual(["a"]);
  });

  it("a cleanup that throws is reported and the effect still re-runs", async () => {
    const { error } = quiet();
    const ran: number[] = [];
    const { system, spy } = build({
      e: {
        deps: ["count"],
        run: (facts: any) => {
          ran.push(facts.count);

          return () => {
            throw new Error("cleanup boom");
          };
        },
      },
    });
    await system.start();
    await bump(system, "count", 1);

    expect(ran).toEqual([0, 1]);
    expect(spy.errors).toHaveLength(1);
    expect(spy.errors[0]![0]).toBe("e");
    expect((spy.errors[0]![1] as Error).message).toBe("cleanup boom");
    expect(error).toHaveBeenCalled();
    expect(String(error.mock.calls[0]![0])).toContain("cleanup");

    // the thrown cleanup is dropped, not retried on the next run
    await bump(system, "count", 2);
    expect(spy.errors).toHaveLength(2);
    await system.destroy();
  });

  it("an async effect settling after stop() has its cleanup called at once", async () => {
    const gate = deferred();
    const order: string[] = [];
    const { system } = build({
      e: {
        deps: ["count"],
        run: async (facts: any) => {
          if (facts.count === 0) {
            return undefined;
          }
          await gate.promise;

          return () => order.push("late cleanup");
        },
      },
    });
    await system.start();
    system.facts.count = 1;
    await flush();
    await system.stop();
    expect(order).toEqual([]);
    gate.resolve();
    await flush();

    expect(order).toEqual(["late cleanup"]);
    await system.destroy();
  });

  it("an auto-tracked effect settling after stop() is cleaned up at once", async () => {
    const gate = deferred();
    const order: string[] = [];
    const { system } = build({
      e: {
        run: async (facts: any) => {
          const n = facts.count;
          if (n === 0) {
            return undefined;
          }
          await gate.promise;

          return () => order.push("late cleanup");
        },
      },
    });
    await system.start();
    system.facts.count = 1;
    await flush();
    await system.stop();
    gate.resolve();
    await flush();

    expect(order).toEqual(["late cleanup"]);
    await system.destroy();
  });

  it("a late cleanup that throws is reported, and needs no listener", async () => {
    const { error } = quiet();
    const gate = deferred();
    const { system, spy } = build({
      e: {
        deps: ["count"],
        run: async (facts: any) => {
          if (facts.count === 0) {
            return undefined;
          }
          await gate.promise;

          return () => {
            throw new Error("late boom");
          };
        },
      },
    });
    await system.start();
    system.facts.count = 1;
    await flush();
    await system.stop();
    gate.resolve();
    await flush();

    expect(spy.errors.map(([id]) => id)).toContain("e");
    expect(error).toHaveBeenCalled();
    await system.destroy();
  });

  it("before stop(), a settling effect's cleanup is kept, not called", async () => {
    const order: string[] = [];
    const { system } = build({
      e: { deps: ["count"], run: async () => () => order.push("cleanup") },
    });
    await system.start();
    await flush();
    expect(order).toEqual([]);
    await system.destroy();
  });

  it("a returned value that is not a function is not kept as a cleanup", async () => {
    const { system, spy } = build({
      a: { deps: ["count"], run: () => 42 },
      b: { deps: ["count"], run: () => ({ not: "callable" }) },
      c: { deps: ["count"], run: async () => "text" },
    });
    await system.start();
    await bump(system, "count", 1);
    await bump(system, "count", 2);
    await system.stop();

    expect(spy.errors).toEqual([]);
    await system.destroy();
  });

  it("call stores a cleanup from a sync and from an async effect", async () => {
    const order: string[] = [];
    const { system } = build({
      s: { deps: ["name"], run: () => () => order.push("s") },
      a: { deps: ["name"], run: async () => () => order.push("a") },
    });
    await system.start();
    order.length = 0;
    await system.effects.call("s");
    await system.effects.call("a");
    expect(order).toEqual(["s", "a"]);
    await system.stop();

    expect(order.slice(2).sort()).toEqual(["a", "s"]);
    await system.destroy();
  });

  it("replacing a definition cleans up the old one first", async () => {
    const order: string[] = [];
    const { system } = build({
      e: { deps: ["count"], run: () => () => order.push("old cleanup") },
    });
    await system.start();
    system.effects.assign("e", {
      deps: ["count"],
      run: () => void order.push("new run"),
    });
    expect(order).toEqual(["old cleanup"]);
    await bump(system, "count", 1);

    expect(order).toEqual(["old cleanup", "new run"]);
    await system.destroy();
  });

  it("assign on an unknown effect says so", async () => {
    const { system } = build({});
    await system.start();

    expect(() =>
      system.effects.assign("ghost", { deps: ["count"], run: () => undefined }),
    ).toThrow(/ghost/);
    await system.destroy();
  });

  it("unregistering cleans up, and the effect no longer runs", async () => {
    const order: string[] = [];
    const { system } = build({});
    await system.start();
    system.effects.register("dyn", {
      deps: ["count"],
      run: () => {
        order.push("run");

        return () => order.push("cleanup");
      },
    });
    await bump(system, "count", 1);
    expect(order).toEqual(["run"]);
    expect(system.effects.isDynamic("dyn")).toBe(true);
    expect(system.effects.listDynamic()).toEqual(["dyn"]);

    system.effects.unregister("dyn");
    expect(order).toEqual(["run", "cleanup"]);
    expect(system.effects.isDynamic("dyn")).toBe(false);
    await bump(system, "count", 2);
    expect(order).toEqual(["run", "cleanup"]);
    expect(system.effects.listDynamic()).toEqual([]);
    await system.destroy();
  });

  it("unregistering an unknown effect is a no-op", async () => {
    quiet();
    const { system } = build({});
    await system.start();

    expect(() => system.effects.unregister("never")).not.toThrow();
    await system.destroy();
  });

  it("registering an id twice is refused", async () => {
    const { system } = build({});
    await system.start();
    system.effects.register("dyn", { deps: ["count"], run: () => undefined });

    expect(() =>
      system.effects.register("dyn", { deps: ["count"], run: () => undefined }),
    ).toThrow(/dyn/);
    await system.destroy();
  });

  it("a static effect cannot be unregistered", async () => {
    quiet();
    const ran: number[] = [];
    const { system } = build({
      e: { deps: ["count"], run: (facts: any) => void ran.push(facts.count) },
    });
    await system.start();
    system.effects.unregister("e");
    await bump(system, "count", 1);

    expect(ran).toEqual([0, 1]);
    await system.destroy();
  });
});

// ============================================================================
// Errors
// ============================================================================

describe("a throwing effect", () => {
  it("is reported to plugins and the console, naming the effect", async () => {
    const { error } = quiet();
    const { system, spy } = build({
      e: {
        deps: ["count"],
        run: (facts: any) => {
          if (facts.count > 0) {
            throw new Error("boom");
          }
        },
      },
    });
    await system.start();
    await bump(system, "count", 1);

    expect(spy.errors).toHaveLength(1);
    expect(spy.errors[0]![0]).toBe("e");
    expect((spy.errors[0]![1] as Error).message).toBe("boom");
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toContain('"e"');
    expect((error.mock.calls[0]![1] as Error).message).toBe("boom");
    await system.destroy();
  });

  it("is routed to the error boundary's callback with the error and id", async () => {
    quiet();
    const onEffectError = vi.fn();
    const { system } = build(
      {
        e: {
          deps: ["count"],
          run: (facts: any) => {
            if (facts.count > 0) {
              throw new Error("boom");
            }
          },
        },
      },
      { errorBoundary: { onEffectError } },
    );
    await system.start();
    await bump(system, "count", 1);

    expect(onEffectError).toHaveBeenCalledTimes(1);
    expect(onEffectError.mock.calls[0]![1]).toBe("e");
    expect(String(onEffectError.mock.calls[0]![0])).toContain("boom");
    await system.destroy();
  });

  it("does not stop the others, and is reported after every body has run", async () => {
    quiet();
    const order: string[] = [];
    const { system } = build(
      {
        bad: {
          deps: ["count"],
          run: (facts: any) => {
            order.push("bad body");
            if (facts.count > 0) {
              throw new Error("boom");
            }
          },
        },
        good: { deps: ["count"], run: () => void order.push("good body") },
      },
      {
        errorBoundary: {
          onEffectError: () => {
            order.push("reported");
          },
        },
      },
    );
    await system.start();
    order.length = 0;
    await bump(system, "count", 1);

    expect(order).toEqual(["bad body", "good body", "reported"]);
    await system.destroy();
  });

  it("is reported before an async neighbour settles", async () => {
    quiet();
    const gate = deferred();
    const order: string[] = [];
    const { system } = build(
      {
        slow: {
          deps: ["count"],
          run: async (facts: any) => {
            if (facts.count === 0) {
              return;
            }
            await gate.promise;
            order.push("slow done");
          },
        },
        bad: {
          deps: ["count"],
          run: (facts: any) => {
            if (facts.count > 0) {
              throw new Error("boom");
            }
          },
        },
      },
      {
        errorBoundary: {
          onEffectError: () => {
            order.push("reported");
          },
        },
      },
    );
    await system.start();
    system.facts.count = 1;
    const settled = system.settle();
    await flush();
    expect(order).toEqual(["reported"]);
    gate.resolve();
    await settled;

    expect(order).toEqual(["reported", "slow done"]);
    await system.destroy();
  });

  it("an async rejection is reported", async () => {
    const { error } = quiet();
    const { system, spy } = build({
      e: {
        deps: ["count"],
        run: async (facts: any) => {
          const n = facts.count;
          await Promise.resolve();
          if (n > 0) {
            throw new Error("async boom");
          }
        },
      },
    });
    await system.start();
    await bump(system, "count", 1);

    expect(spy.errors).toHaveLength(1);
    expect((spy.errors[0]![1] as Error).message).toBe("async boom");
    expect(String(error.mock.calls[0]![0])).toContain('"e"');
    await system.destroy();
  });

  it("an async auto-tracked rejection is reported", async () => {
    quiet();
    const { system, spy } = build({
      e: {
        run: async (facts: any) => {
          const n = facts.count;
          await Promise.resolve();
          if (n > 0) {
            throw new Error("async boom");
          }
        },
      },
    });
    await system.start();
    await bump(system, "count", 1);

    expect(spy.errors).toHaveLength(1);
    await system.destroy();
  });

  it("does not need a plugin or a boundary", async () => {
    const { error } = quiet();
    const mod = createModule("m", {
      schema,
      init: (facts: any) => {
        facts.count = 0;
      },
      effects: {
        e: {
          deps: ["count"],
          run: (facts: any) => {
            if (facts.count > 0) {
              throw new Error("boom");
            }
          },
        },
      },
    } as never);
    const system = createSystem({ module: mod }) as any;
    await system.start();
    system.facts.count = 1;
    await system.settle();

    expect(error).toHaveBeenCalledTimes(1);
    await system.destroy();
  });

  it("the disable strategy stops the effect until it is enabled again", async () => {
    quiet();
    const ran: number[] = [];
    const { system } = build(
      {
        e: {
          deps: ["count"],
          run: (facts: any) => {
            ran.push(facts.count);
            if (facts.count === 1) {
              throw new Error("boom");
            }
          },
        },
      },
      { errorBoundary: { onEffectError: "disable" } },
    );
    await system.start();
    await bump(system, "count", 1);
    expect(system.effects.isEnabled("e")).toBe(false);
    await bump(system, "count", 2);
    expect(ran).toEqual([0, 1]);

    system.effects.enable("e");
    await bump(system, "count", 3);
    expect(ran).toEqual([0, 1, 3]);
    await system.destroy();
  });

  it("the retry strategy runs it again, a bounded number of times", async () => {
    const warn = quiet().warn;
    let runs = 0;
    const { system } = build(
      {
        e: {
          deps: ["count"],
          run: (facts: any) => {
            if (facts.count === 0) {
              return;
            }
            runs++;
            throw new Error("always");
          },
        },
      },
      { errorBoundary: { onEffectError: "retry" } },
    );
    await system.start();
    await bump(system, "count", 1);
    for (let i = 0; i < 10; i++) {
      await system.settle();
      await flush();
    }

    expect(runs).toBeGreaterThan(1);
    expect(runs).toBeLessThanOrEqual(4);
    expect(warn.mock.calls.some((call) => /retr/i.test(String(call[0])))).toBe(
      true,
    );

    // it still runs on its next change
    const before = runs;
    await bump(system, "count", 2);
    expect(runs).toBeGreaterThan(before);
    await system.destroy();
  });

  it("the retry strategy recovers when the retry succeeds", async () => {
    quiet();
    let runs = 0;
    const { system } = build(
      {
        e: {
          deps: ["count"],
          run: (facts: any) => {
            if (facts.count === 0) {
              return;
            }
            runs++;
            if (runs === 1) {
              throw new Error("once");
            }
          },
        },
      },
      { errorBoundary: { onEffectError: "retry" } },
    );
    await system.start();
    await bump(system, "count", 1);
    for (let i = 0; i < 5; i++) {
      await system.settle();
      await flush();
    }

    expect(runs).toBe(2);
    await system.destroy();
  });

  it("an auto-tracked effect re-tracks what it reads after an error", async () => {
    quiet();
    const ran: string[] = [];
    const { system } = build({
      e: {
        run: (facts: any) => {
          if (facts.count === 3) {
            throw new Error("boom");
          }
          ran.push(facts.flag ? `name ${facts.name}` : `count ${facts.count}`);
        },
      },
    });
    await system.start();
    for (const n of [1, 2, 3, 4, 5, 6]) {
      await bump(system, "count", n);
    }
    await bump(system, "flag", true);
    ran.length = 0;
    await bump(system, "name", "bob");

    expect(ran).toEqual(["name bob"]);
    await system.destroy();
  });
});

// ============================================================================
// Auto-tracking
// ============================================================================

describe("auto-tracking", () => {
  it("picks up a new conditional read after many identical runs", async () => {
    const ran: string[] = [];
    const { system } = build({
      e: {
        run: (facts: any) => {
          ran.push(facts.flag ? `name ${facts.name}` : `count ${facts.count}`);
        },
      },
    });
    await system.start();
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      await bump(system, "count", n);
    }
    await bump(system, "flag", true);
    ran.length = 0;
    await bump(system, "name", "bob");
    expect(ran).toEqual(["name bob"]);
    await bump(system, "name", "carol");
    expect(ran).toEqual(["name bob", "name carol"]);
    await system.destroy();
  });

  it("an effect whose reads change from run to run keeps following them", async () => {
    const ran: string[] = [];
    const { system } = build({
      e: {
        run: (facts: any) => {
          // alternates which fact it reads on each run
          if (facts.count % 2 === 0) {
            ran.push(`count ${facts.count}`);
          } else {
            ran.push(`name ${facts.name}`);
          }
        },
      },
    });
    await system.start();
    for (let n = 1; n <= 8; n++) {
      await bump(system, "count", n);
    }
    ran.length = 0;
    await bump(system, "count", 9);
    expect(ran).toEqual(["name alice"]);
    await bump(system, "name", "bob");
    expect(ran).toEqual(["name alice", "name bob"]);
    await system.destroy();
  });

  it("a stable effect still reacts after the system sat idle", async () => {
    let runs = 0;
    const { system } = build({
      e: {
        run: (facts: any) => {
          void facts.count;
          runs++;
        },
      },
    });
    await system.start();
    for (let n = 1; n <= 6; n++) {
      await bump(system, "count", n);
    }
    const before = runs;
    await bump(system, "count", 100);

    expect(runs).toBe(before + 1);
    await bump(system, "name", "bob");
    expect(runs).toBe(before + 1);
    await system.destroy();
  });

  it("an explicitly declared effect keeps its deps through an error", async () => {
    quiet();
    const ran: number[] = [];
    const { system } = build({
      e: {
        deps: ["count"],
        run: (facts: any) => {
          ran.push(facts.count);
          if (facts.count === 1) {
            throw new Error("boom");
          }
        },
      },
    });
    await system.start();
    await bump(system, "count", 1);
    await bump(system, "count", 2);

    expect(ran).toEqual([0, 1, 2]);
    await system.destroy();
  });

  it("an effect reading a derivation reruns when it changes", async () => {
    const seen: number[] = [];
    const { system } = build({
      e: {
        run: (facts: any, _prev: any, derived: any) => {
          void facts.name;
          seen.push(derived.doubled);
        },
      },
    });
    await system.start();
    seen.length = 0;
    await bump(system, "count", 4);
    await bump(system, "name", "bob");

    expect(seen[seen.length - 1]).toBe(8);
    await system.destroy();
  });

  it("warns once when an async effect read nothing before its first await", async () => {
    const { warn } = quiet();
    const { system } = build({
      e: {
        run: async (facts: any) => {
          await Promise.resolve();
          void facts.count;
        },
      },
    });
    await system.start();
    await bump(system, "count", 1);
    await bump(system, "count", 2);

    const hits = warn.mock.calls.filter((call) =>
      /no dependencies/i.test(String(call[0])),
    );
    expect(hits).toHaveLength(1);
    expect(String(hits[0]![0])).toContain('"e"');
    await system.destroy();
  });

  it("does not warn about an async effect that did read something", async () => {
    const { warn } = quiet();
    const { system } = build({
      e: {
        run: async (facts: any) => {
          void facts.count;
          await Promise.resolve();
        },
      },
    });
    await system.start();
    await bump(system, "count", 1);

    expect(
      warn.mock.calls.filter((call) =>
        /no dependencies/i.test(String(call[0])),
      ),
    ).toEqual([]);
    await system.destroy();
  });

  it("does not warn about a synchronous effect that read nothing", async () => {
    const { warn } = quiet();
    const { system } = build({ e: { run: () => undefined } });
    await system.start();
    await bump(system, "count", 1);

    expect(
      warn.mock.calls.filter((call) =>
        /no dependencies/i.test(String(call[0])),
      ),
    ).toEqual([]);
    await system.destroy();
  });

  it("does not warn about an async effect with declared deps", async () => {
    const { warn } = quiet();
    const { system } = build({
      e: {
        deps: ["count"],
        run: async () => {
          await Promise.resolve();
        },
      },
    });
    await system.start();
    await bump(system, "count", 1);

    expect(
      warn.mock.calls.filter((call) =>
        /no dependencies/i.test(String(call[0])),
      ),
    ).toEqual([]);
    await system.destroy();
  });

  it("each async effect that read nothing is warned about separately", async () => {
    const { warn } = quiet();
    const { system } = build({
      a: {
        run: async () => {
          await Promise.resolve();
        },
      },
      b: {
        run: async () => {
          await Promise.resolve();
        },
      },
    });
    await system.start();
    await bump(system, "count", 1);

    const hits = warn.mock.calls
      .filter((call) => /no dependencies/i.test(String(call[0])))
      .map((call) => String(call[0]));
    expect(hits).toHaveLength(2);
    expect(hits.some((h) => h.includes('"a"'))).toBe(true);
    expect(hits.some((h) => h.includes('"b"'))).toBe(true);
    await system.destroy();
  });
});

// ============================================================================
// Reports to plugins and the trace
// ============================================================================

describe("what a run tells the trace", () => {
  it("lists declared deps, with derivations as derive.<id>", async () => {
    const { system } = build(
      {
        e: { deps: ["count", "doubled"], run: () => undefined },
      },
      { trace: true },
    );
    await system.start();
    await bump(system, "count", 1);
    const entries = system.trace.flatMap((entry: any) => entry.effectsRun);
    const mine = entries.filter((e: any) => e.id === "e");

    expect(mine.length).toBeGreaterThan(0);
    expect([...mine[mine.length - 1].triggeredBy].sort()).toEqual([
      "count",
      "derive.doubled",
    ]);
    await system.destroy();
  });

  it("an auto-tracked effect starts with none and then lists what it read", async () => {
    const { system } = build(
      {
        e: {
          run: (facts: any) => {
            void facts.count;
            void facts.name;
          },
        },
      },
      { trace: true },
    );
    await system.start();
    await bump(system, "count", 1);
    const entries = system.trace
      .flatMap((entry: any) => entry.effectsRun)
      .filter((e: any) => e.id === "e");

    expect(entries[0].triggeredBy).toEqual([]);
    expect([...entries[entries.length - 1].triggeredBy].sort()).toEqual([
      "count",
      "name",
    ]);
    await system.destroy();
  });

  it("call reports its deps too, and none when none are known", async () => {
    const { system } = build(
      {
        declared: { deps: ["count"], run: () => undefined },
        tracked: { run: () => undefined },
      },
      { trace: true },
    );
    await system.start();
    await system.effects.call("declared");
    await system.effects.call("tracked");
    const entries = system.trace.flatMap((entry: any) => entry.effectsRun);
    const declared = entries.filter((e: any) => e.id === "declared");
    const tracked = entries.filter((e: any) => e.id === "tracked");

    expect(declared[declared.length - 1].triggeredBy).toEqual(["count"]);
    expect(tracked[tracked.length - 1].triggeredBy).toEqual([]);
    await system.destroy();
  });

  it("records an effect error in the trace", async () => {
    quiet();
    const { system } = build(
      {
        e: {
          deps: ["count"],
          run: (facts: any) => {
            if (facts.count > 0) {
              throw new Error("traced boom");
            }
          },
        },
      },
      { trace: true },
    );
    await system.start();
    await bump(system, "count", 1);
    const errors = system.trace.flatMap((entry: any) => entry.effectErrors);

    expect(errors).toHaveLength(1);
    expect(errors[0].id).toBe("e");
    expect(errors[0].error).toContain("traced boom");
    await system.destroy();
  });

  it("works with no plugins and no trace", async () => {
    const ran: number[] = [];
    const mod = createModule("m", {
      schema,
      init: (facts: any) => {
        facts.count = 0;
      },
      effects: {
        e: { deps: ["count"], run: (facts: any) => void ran.push(facts.count) },
      },
    } as never);
    const system = createSystem({ module: mod }) as any;
    await system.start();
    system.facts.count = 1;
    await system.settle();
    await system.effects.call("e");

    expect(ran).toEqual([0, 1, 1]);
    await system.destroy();
  });
});

// ============================================================================
// History navigation
// ============================================================================

describe("effects after a history navigation", () => {
  async function navigable() {
    const log: string[] = [];
    const mod = createModule("m", {
      schema: { facts: { n: t.number() } },
      init: (facts: any) => {
        facts.n = 0;
      },
      effects: {
        view: {
          deps: ["n"],
          run: (facts: any) => void log.push(`view ${facts.n}`),
        },
        analytics: {
          deps: ["n"],
          onNavigate: "skip",
          run: (facts: any) => void log.push(`analytics ${facts.n}`),
        },
      },
    });
    const system = createSystem({
      module: mod,
      history: { maxSnapshots: 50 },
    }) as any;
    await system.start();
    for (let i = 1; i <= 3; i++) {
      system.facts.n = i;
      await system.settle();
    }
    log.length = 0;

    return { system, log };
  }

  it("re-runs a mirroring effect and sits out an onNavigate skip one", async () => {
    const { system, log } = await navigable();
    system.history.goBack();
    await system.settle();

    expect(log).toContain(`view ${system.facts.n}`);
    expect(log.some((l) => l.startsWith("analytics"))).toBe(false);
    await system.destroy();
  });

  it("an onNavigate skip effect still runs for a real change", async () => {
    const { system, log } = await navigable();
    system.facts.n = 50;
    await system.settle();

    expect(log).toContain("view 50");
    expect(log).toContain("analytics 50");
    await system.destroy();
  });

  it("a real change right after a navigation wakes both", async () => {
    const { system, log } = await navigable();
    system.history.goBack();
    system.facts.n = 77;
    await system.settle();

    expect(log).toContain("view 77");
    expect(log).toContain("analytics 77");
    await system.destroy();
  });
});

// ============================================================================
// What a snapshot of the previous facts costs
// ============================================================================

/** How many times the store was copied while one effect set ran three passes. */
async function copiesFor(
  effects: Record<string, unknown>,
  options: Record<string, unknown> = {},
): Promise<number> {
  quiet();
  const { system } = build(effects, options);
  const spy = vi.spyOn(system.facts.$store, "toObject");
  await system.start();
  for (let i = 1; i <= 3; i++) {
    system.facts.count = i;
    await system.settle();
  }
  const copies = spy.mock.calls.length;
  await system.destroy();

  return copies;
}

const readerEffects = {
  r: {
    run: (facts: any, prev: any) => {
      void facts.count;
      void prev;
    },
  },
};

const pick = (a: number, b: number) => `k${a + b}`;

describe("an effect that cannot read prevFacts costs no snapshot", () => {
  const nonReaders: Array<[string, unknown]> = [
    [
      "one named parameter",
      (facts: any) => {
        void facts.count;
      },
    ],
    ["a bare arrow parameter", new Function("return facts => facts.count")()],
    [
      "a destructured object",
      ({ count }: any) => {
        void count;
      },
    ],
    [
      "a destructured array",
      ([first, second]: any) => {
        void first;
        void second;
      },
    ],
    [
      "nested destructuring with commas",
      ({ obj: { x, y }, name, count }: any) => {
        void x;
        void y;
        void name;
        void count;
      },
    ],
    [
      "a computed key with a call inside",
      ({ [pick(1, 2)]: value, count }: any) => {
        void value;
        void count;
      },
    ],
    [
      "an async arrow",
      async (facts: any) => {
        void facts.count;
      },
    ],
    [
      "a function expression",
      // biome-ignore lint/complexity/useArrowFunction: the shape is the point
      function (facts: any) {
        void facts.count;
      },
    ],
    [
      "a method shorthand",
      {
        run(facts: any) {
          void facts.count;
        },
      }.run,
    ],
  ];

  for (const [label, run] of nonReaders) {
    it(`when it has ${label}`, async () => {
      const reader = await copiesFor(readerEffects);
      expect(reader).toBeGreaterThan(0);

      expect(await copiesFor({ e: { run } })).toBeLessThan(reader);
      expect(await copiesFor({ e: { deps: ["count"], run } })).toBeLessThan(
        reader,
      );
    });
  }

  it("when run is not a function at all it is treated as a reader", async () => {
    const reader = await copiesFor(readerEffects);

    expect(await copiesFor({ e: { deps: ["count"], run: undefined } })).toBe(
      reader,
    );
  });

  it("a data gate makes the snapshot even though the body ignores it", async () => {
    const plain = await copiesFor({
      e: { deps: ["count"], run: (facts: any) => void facts.count },
    });
    const gated = await copiesFor({
      e: {
        on: { count: { $gt: 0 } },
        run: (facts: any) => void facts.count,
      },
    });

    expect(gated).toBeGreaterThan(plain);
  });

  it("unregistering the last reader stops the copying", async () => {
    quiet();
    const { system } = build({});
    const spy = vi.spyOn(system.facts.$store, "toObject");
    await system.start();
    system.effects.register("dyn", {
      deps: ["count"],
      run: (facts: any, prev: any) => {
        void facts.count;
        void prev;
      },
    });
    const passes = async (from: number) => {
      const before = spy.mock.calls.length;
      for (let i = from; i < from + 3; i++) {
        system.facts.count = i;
        await system.settle();
      }

      return spy.mock.calls.length - before;
    };
    const during = await passes(1);
    system.effects.unregister("dyn");
    const after = await passes(10);

    expect(during).toBeGreaterThan(0);
    expect(after).toBeLessThan(during);
    await system.destroy();
  });

  it("assigning a non-reader over the last reader stops the copying", async () => {
    quiet();
    const { system } = build(readerEffects);
    const spy = vi.spyOn(system.facts.$store, "toObject");
    await system.start();
    const passes = async (from: number) => {
      const before = spy.mock.calls.length;
      for (let i = from; i < from + 3; i++) {
        system.facts.count = i;
        await system.settle();
      }

      return spy.mock.calls.length - before;
    };
    const during = await passes(1);
    system.effects.assign("r", {
      run: (facts: any) => {
        void facts.count;
      },
    });
    const after = await passes(10);

    expect(during).toBeGreaterThan(0);
    expect(after).toBeLessThan(during);
    await system.destroy();
  });

  it("a reader assigned over a non-reader is backfilled", async () => {
    const seen: any[] = [];
    const { system } = build({
      r: {
        run: (facts: any) => {
          void facts.count;
        },
      },
    });
    await system.start();
    await bump(system, "count", 3);
    system.effects.assign("r", {
      run: (facts: any, prev: any) => {
        void facts.count;
        seen.push(prev ? prev.count : null);
      },
    });
    await bump(system, "count", 9);

    expect(seen[seen.length - 1]).toBe(3);
    await system.destroy();
  });

  it("a module registered later brings its effects, and a reader is backfilled", async () => {
    const seen: any[] = [];
    const { system } = build({
      plain: {
        run: (facts: any) => {
          void facts.count;
        },
      },
    });
    await system.start();
    const second = createModule("second", {
      schema: { facts: { m: t.number() } },
      init: (facts: any) => {
        facts.m = 0;
      },
      effects: {
        watch: {
          deps: ["m"],
          run: (facts: any, prev: any) => {
            seen.push([facts.m, prev ? prev.m : null]);
          },
        },
      },
    });
    system.registerModule(second as never);
    await bump(system, "m", 5);
    await bump(system, "m", 6);

    expect(seen[seen.length - 2][0]).toBe(5);
    expect(seen[seen.length - 2][1]).not.toBeNull();
    expect(seen[seen.length - 1]).toEqual([6, 5]);
    await system.destroy();
  });
});

// ============================================================================
// More behaviours of the run loop
// ============================================================================

describe("more behaviour of the run loop", () => {
  it("a data gate with $changed ignores a write that left that fact alone", async () => {
    const runs: number[] = [];
    const { system } = build({
      gated: {
        on: { count: { $changed: true }, flag: true },
        run: (facts: any) => {
          runs.push(facts.count);
        },
      },
    });
    await system.start();
    const before = runs.length;
    await bump(system, "count", 1);
    await bump(system, "flag", true);
    expect(runs.length).toBe(before);

    await bump(system, "count", 2);
    expect(runs.length).toBe(before + 1);
    await system.destroy();
  });

  it("enable, disable and isEnabled on an unknown effect throw", async () => {
    const { system } = build({});
    await system.start();

    expect(() => system.effects.isEnabled("ghost")).toThrow();
    expect(() => system.effects.disable("ghost")).toThrow();
    expect(() => system.effects.enable("ghost")).toThrow();
    await system.destroy();
  });

  it("call on an unknown effect says it does not exist", async () => {
    const { system } = build({});
    await system.start();

    await expect(system.effects.call("nope")).rejects.toThrow(/does not exist/);
    await system.destroy();
  });

  it("settle waits for every async effect, whichever finishes last", async () => {
    const slow = deferred();
    const done: string[] = [];
    const { system } = build({
      first: {
        deps: ["count"],
        run: async (facts: any) => {
          if (facts.count === 0) {
            return;
          }
          await slow.promise;
          done.push("first");
        },
      },
      second: {
        deps: ["count"],
        run: async (facts: any) => {
          if (facts.count === 0) {
            return;
          }
          await Promise.resolve();
          done.push("second");
        },
      },
    });
    await system.start();
    system.facts.count = 1;
    const settled = system.settle().then(() => done.push("settled"));
    await flush();
    expect(done).toEqual(["second"]);
    slow.resolve();
    await settled;

    expect(done).toEqual(["second", "first", "settled"]);
    await system.destroy();
  });

  it("an effect that reads nothing and opts out of navigation sits a rewind out", async () => {
    const log: string[] = [];
    const mod = createModule("m", {
      schema: { facts: { n: t.number() } },
      init: (facts: any) => {
        facts.n = 0;
      },
      effects: {
        untracked: {
          onNavigate: "skip",
          run: () => {
            log.push("untracked");
          },
        },
        view: {
          deps: ["n"],
          run: (facts: any) => void log.push(`view ${facts.n}`),
        },
      },
    });
    const system = createSystem({
      module: mod,
      history: { maxSnapshots: 50 },
    }) as any;
    await system.start();
    for (let i = 1; i <= 3; i++) {
      system.facts.n = i;
      await system.settle();
    }
    log.length = 0;
    system.history.goBack();
    await system.settle();

    expect(log.some((l) => l.startsWith("view"))).toBe(true);
    expect(log).not.toContain("untracked");
    await system.destroy();
  });

  it("an effect that fails after being unregistered is not run again", async () => {
    quiet();
    const gate = deferred();
    let runs = 0;
    const { system, spy } = build(
      {},
      { errorBoundary: { onEffectError: "retry" } },
    );
    await system.start();
    system.effects.register("dyn", {
      deps: ["count"],
      run: async (facts: any) => {
        runs++;
        if (facts.count === 0) {
          return;
        }
        await gate.promise;
        throw new Error("late failure");
      },
    });
    system.facts.count = 1;
    await flush();
    const started = runs;
    system.effects.unregister("dyn");
    gate.resolve();
    await flush();
    await system.settle();
    await flush();

    expect(runs).toBe(started);
    expect(spy.errors.filter(([id]) => id === "dyn")).toHaveLength(1);
    await system.destroy();
  });
});
