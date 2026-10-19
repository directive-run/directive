// Ported from packages/core/src/core/__tests__/mutants-effects.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { t } from "@directive-run/core";
import {
  createEffectsManager,
  createFacts,
} from "@directive-run/core/internals";
import { afterEach, describe, expect, it, vi } from "vitest";

// Written to kill surviving Stryker mutants of effects.ts. Black-box only: the
// effects manager from the `internals` subpath, driven through its methods.
// Where a test counts store copies it only asks whether a copy was made at all.

afterEach(() => {
  vi.restoreAllMocks();
});

const schema = {
  count: t.number(),
  name: t.string(),
  flag: t.boolean(),
  obj: t.object<{ x: number }>(),
};

/** The marker a derivation dependency carries in a changed-key set. */
const dd = (id: string) => `\u001F${id}`;

function setup(
  definitions: Record<string, any> = {},
  options: Record<string, unknown> = {},
) {
  const { store, facts } = createFacts({ schema });
  facts.count = 0;
  facts.name = "alice";
  facts.flag = false;
  facts.obj = { x: 1 };

  const manager = createEffectsManager({
    definitions: definitions as never,
    facts: facts as never,
    store: store as never,
    ...options,
  } as never);

  return { store, facts, manager };
}

function quiet() {
  return {
    warn: vi.spyOn(console, "warn").mockImplementation(() => undefined),
    error: vi.spyOn(console, "error").mockImplementation(() => undefined),
  };
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
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

function messageOf(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }

  return "<did not throw>";
}

// ============================================================================
// Whether an effect can read prevFacts
// ============================================================================

/** How many times the store was copied across two passes of one effect. */
async function copiesFor(run: unknown): Promise<number> {
  quiet();
  const { store, facts, manager } = setup({ e: { run } });
  const spy = vi.spyOn(store, "toObject");
  facts.count = 1;
  await manager.runEffects(new Set(["count"]));
  facts.count = 2;
  await manager.runEffects(new Set(["count"]));

  return spy.mock.calls.length;
}

const bare = new Function("return facts => 1")() as unknown;
const withArguments = function (this: unknown, _facts: unknown) {
  // biome-ignore lint/style/noArguments: the point is a hidden read
  return arguments[1];
};
// biome-ignore lint/complexity/useArrowFunction: `arguments` needs a function
const boundNative = function (_a: unknown, _facts: unknown) {
  // biome-ignore lint/style/noArguments: the point is a hidden read
  return arguments[2];
}.bind(null, 1);

describe("an effect that can read prevFacts gets a snapshot", () => {
  const readers: Array<[string, unknown]> = [
    ["two named parameters", (_f: unknown, _p: unknown) => undefined],
    ["a defaulted second parameter", (_f: unknown, _p = null) => undefined],
    ["a rest second parameter", (_f: unknown, ..._r: unknown[]) => undefined],
    ["only a rest parameter", (...args: unknown[]) => args],
    [
      "a destructured first parameter then rest",
      ({ count }: { count: number }, ..._r: unknown[]) => count,
    ],
    [
      "an array-destructured first parameter then rest",
      ([a]: number[], ..._r: unknown[]) => a,
    ],
    ["a body that reaches for arguments", withArguments],
    ["a bound function", boundNative],
  ];

  for (const [label, run] of readers) {
    it(`when it has ${label}`, async () => {
      expect(await copiesFor(run)).toBeGreaterThan(0);
    });
  }

  it("when run is not a function at all", async () => {
    const { warn, error } = quiet();
    const onError = vi.fn();
    const { store, facts, manager } = setup(
      { e: { run: 42 } },
      { onError: onError },
    );
    const spy = vi.spyOn(store, "toObject");
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));

    expect(spy.mock.calls.length).toBeGreaterThan(0);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    void warn;
  });

  it("a wrapper that says it reads prevFacts overrides its own arity", async () => {
    const run = (_f: unknown) => undefined;
    (run as any)[Symbol.for("directive.effect.readsPrevFacts")] = true;

    expect(await copiesFor(run)).toBeGreaterThan(0);
  });
});

describe("an effect that cannot read prevFacts costs no snapshot", () => {
  const nonReaders: Array<[string, unknown]> = [
    ["one named parameter", (_f: unknown) => undefined],
    ["a bare single-parameter arrow", bare],
    [
      "a destructured parameter with commas",
      ({ count, name }: { count: number; name: string }) => [count, name],
    ],
    ["an array-destructured parameter", ([a, b]: number[]) => [a, b]],
    ["an async function", async (_f: unknown) => undefined],
    ["a call with commas in the body", (_f: unknown) => Math.max(1, 2, 3)],
  ];

  for (const [label, run] of nonReaders) {
    it(`when it has ${label}`, async () => {
      expect(await copiesFor(run)).toBe(0);
    });
  }

  it("a wrapper that says it does not read prevFacts overrides its arity", async () => {
    const run = (_f: unknown, _p: unknown) => undefined;
    (run as any)[Symbol.for("directive.effect.readsPrevFacts")] = false;

    expect(await copiesFor(run)).toBe(0);
  });
});

describe("prevFacts values", () => {
  it("is null on the first run and the previous pass's facts after", async () => {
    const seen: unknown[] = [];
    const { facts, manager } = setup({
      e: {
        run: (_f: unknown, prev: any) => {
          seen.push(prev === null ? null : prev.count);
        },
      },
    });

    facts.count = 1;
    await manager.runEffects(new Set(["count"]));
    facts.count = 2;
    await manager.runEffects(new Set(["count"]));
    facts.count = 3;
    await manager.runEffects(new Set(["count"]));

    expect(seen).toEqual([null, 1, 2]);
  });

  it("is refreshed after a pass run through runEffectsFast, sync or async", async () => {
    const seen: unknown[] = [];
    const gate = deferred();
    let slow = false;
    const { facts, manager } = setup({
      e: {
        run: (_f: unknown, prev: any) => {
          seen.push(prev === null ? null : prev.count);
          if (slow) {
            return gate.promise;
          }
        },
      },
    });

    facts.count = 1;
    expect(manager.runEffectsFast(new Set(["count"]))).toBeUndefined();
    facts.count = 2;
    slow = true;
    const pending = manager.runEffectsFast(new Set(["count"]));
    facts.count = 3;
    gate.resolve();
    await pending;
    slow = false;
    facts.count = 4;
    manager.runEffectsFast(new Set(["count"]));

    expect(seen).toEqual([null, 1, 3]);
  });

  it("is refreshed after runAll", async () => {
    const seen: unknown[] = [];
    const { facts, manager } = setup({
      e: {
        run: (_f: unknown, prev: any) => {
          seen.push(prev === null ? null : prev.count);
        },
      },
    });

    facts.count = 5;
    await manager.runAll();
    facts.count = 6;
    await manager.runAll();

    expect(seen).toEqual([null, 5]);
  });

  it("an effect registered later sees the facts as they were at registration", async () => {
    const seen: unknown[] = [];
    const { facts, manager } = setup({
      first: { run: (_f: unknown) => undefined },
    });
    await manager.runEffects(new Set(["count"]));

    facts.count = 1;
    manager.registerDefinitions({
      second: {
        run: (_f: unknown, prev: any) => {
          seen.push(prev === null ? null : prev.count);
        },
      },
    } as never);
    facts.count = 2;
    await manager.runEffects(new Set(["count"]));

    expect(seen).toEqual([1]);
  });

  it("registering another reader does not refresh an existing snapshot", async () => {
    const seen: unknown[] = [];
    const { facts, manager } = setup({
      first: { run: (_f: unknown, _p: unknown) => undefined },
    });
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));

    facts.count = 5;
    manager.registerDefinitions({
      second: {
        run: (_f: unknown, prev: any) => {
          seen.push(prev === null ? null : prev.count);
        },
      },
    } as never);
    await manager.runEffects(new Set(["count"]));

    expect(seen).toEqual([1]);
  });

  it("a data gate reads prevFacts even when the effect body does not", async () => {
    const run = vi.fn();
    const { facts, manager } = setup({
      gated: {
        on: { count: { $changed: true } },
        run: (_f: unknown) => {
          run();
        },
      },
    });

    facts.count = 1;
    await manager.runEffects(new Set(["count"]));
    expect(run).toHaveBeenCalledTimes(1);

    await manager.runEffects(new Set(["count"]));
    expect(run).toHaveBeenCalledTimes(1);

    facts.count = 2;
    await manager.runEffects(new Set(["count"]));
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("unregistering the last reader stops copying", async () => {
    const { store, facts, manager } = setup({
      reader: { run: (_f: unknown, _p: unknown) => undefined },
      plain: { run: (_f: unknown) => undefined },
    });
    manager.unregisterDefinition("reader");
    await manager.runEffects(new Set(["count"]));
    const spy = vi.spyOn(store, "toObject");
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));

    expect(spy).not.toHaveBeenCalled();
  });
});

// ============================================================================
// The read-only view
// ============================================================================

describe("the facts an effect reads through", () => {
  function capture() {
    const captured: { facts?: any } = {};
    const onWriteBlocked = vi.fn();
    const ctx = setup(
      {
        e: {
          deps: ["count"],
          run: (facts: any) => {
            captured.facts = facts;
          },
        },
      },
      { onWriteBlocked },
    );

    return { ...ctx, captured, onWriteBlocked };
  }

  it("a write names the effect and the key, and is reported", async () => {
    const { manager, captured, onWriteBlocked } = capture();
    await manager.runAll();

    const message = messageOf(() => {
      captured.facts.count = 9;
    });

    expect(message).toContain('effect "e" tried to write "count"');
    expect(onWriteBlocked).toHaveBeenCalledWith("e", "count");
  });

  it("a refused write still says why when nobody is listening", async () => {
    const captured: { facts?: any } = {};
    const { manager } = setup({
      e: {
        deps: ["count"],
        run: (facts: any) => {
          captured.facts = facts;
        },
      },
    });
    await manager.runAll();

    expect(
      messageOf(() => {
        captured.facts.count = 9;
      }),
    ).toContain('effect "e" tried to write "count"');
    expect(
      messageOf(() => {
        captured.facts.$store.set("count", 1);
      }),
    ).toContain('effect "e" tried to write "count"');
    expect(
      messageOf(() => {
        captured.facts.$store.delete("count");
      }),
    ).toContain('effect "e" tried to write "count"');
  });

  it("the store behind it refuses set and delete and reports them", async () => {
    const { manager, captured, onWriteBlocked } = capture();
    await manager.runAll();
    const store = captured.facts.$store;

    expect(messageOf(() => store.set("count", 3))).toContain(
      'tried to write "count"',
    );
    expect(messageOf(() => store.delete("name"))).toContain(
      'tried to write "name"',
    );
    expect(onWriteBlocked).toHaveBeenCalledWith("e", "count");
    expect(onWriteBlocked).toHaveBeenCalledWith("e", "name");
  });

  it("the store behind it still reads, batches and subscribes", async () => {
    const { facts, manager, captured } = capture();
    await manager.runAll();
    const store = captured.facts.$store;

    expect(store).toBe(captured.facts.$store);
    expect(store.get("count")).toBe(0);
    expect(store.get("name")).toBe("alice");
    expect(store.has("count")).toBe(true);
    expect(store.has("nope")).toBe(false);
    expect(store.toObject()).toMatchObject({ count: 0, name: "alice" });

    const inBatch = vi.fn();
    store.batch(inBatch);
    expect(inBatch).toHaveBeenCalledTimes(1);

    const keyed = vi.fn();
    const all = vi.fn();
    const offKeyed = store.subscribe(["count"], keyed);
    const offAll = store.subscribeAll(all);
    facts.count = 4;
    await flush();
    expect(keyed).toHaveBeenCalled();
    expect(all).toHaveBeenCalled();
    offKeyed();
    offAll();
    const before = [keyed.mock.calls.length, all.mock.calls.length];
    facts.count = 5;
    await flush();
    expect([keyed.mock.calls.length, all.mock.calls.length]).toEqual(before);
  });

  it("reads see live values", async () => {
    const { facts, manager, captured } = capture();
    await manager.runAll();
    facts.count = 41;

    expect(captured.facts.count).toBe(41);
  });
});

describe("prevFacts and derived are read-only in development", () => {
  it("writing prevFacts names it", async () => {
    const onWriteBlocked = vi.fn();
    const onError = vi.fn();
    quiet();
    const { facts, manager } = setup(
      {
        e: {
          run: (_f: unknown, prev: any) => {
            if (prev !== null) {
              prev.count = 99;
            }
          },
        },
      },
      { onWriteBlocked, onError },
    );
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));
    facts.count = 2;
    await manager.runEffects(new Set(["count"]));

    expect(onWriteBlocked).toHaveBeenCalledWith("e", "prevFacts.count");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]![1])).toContain("prevFacts.count");
  });

  it("writing derived names it", async () => {
    const onWriteBlocked = vi.fn();
    quiet();
    const { facts, manager } = setup(
      {
        e: {
          deps: ["count"],
          run: (_f: unknown, _p: unknown, derived: any) => {
            derived.total = 1;
          },
        },
      },
      { onWriteBlocked, derived: { total: 5 } },
    );
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));

    expect(onWriteBlocked).toHaveBeenCalledWith("e", "derived.total");
  });

  it("derived is readable and the first run's prevFacts is null, not a view", async () => {
    const seen: unknown[] = [];
    const { facts, manager } = setup(
      {
        e: {
          deps: ["count"],
          run: (_f: unknown, prev: unknown, derived: any) => {
            seen.push(prev, derived.total);
          },
        },
      },
      { derived: { total: 5 } },
    );
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));

    expect(seen).toEqual([null, 5]);
  });

  it("an in-place mutation of a nested fact is reported to onError", async () => {
    const onError = vi.fn();
    const onWriteBlocked = vi.fn();
    quiet();
    const { facts, manager } = setup(
      {
        e: {
          deps: ["count"],
          run: (f: any) => {
            f.obj.x = 2;
          },
        },
      },
      { onError, onWriteBlocked },
    );
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));

    expect(onWriteBlocked).toHaveBeenCalledWith("e", "obj.x");
    expect(String(onError.mock.calls[0]![1])).toContain('"obj.x" in place');
  });

  it("an in-place mutation after an await is reported too", async () => {
    const onError = vi.fn();
    quiet();
    const { facts, manager } = setup(
      {
        e: {
          deps: ["count"],
          run: async (f: any) => {
            await Promise.resolve();
            f.obj.x = 3;
          },
        },
      },
      { onError },
    );
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]![1])).toContain("in place");
  });

  it("an in-place mutation by an auto-tracked effect is reported", async () => {
    const onError = vi.fn();
    quiet();
    const { facts, manager } = setup(
      {
        e: {
          run: (f: any) => {
            void f.count;
            f.obj.x = 4;
          },
        },
      },
      { onError },
    );
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("two overlapping async runs of one effect both finish quietly", async () => {
    const onError = vi.fn();
    quiet();
    const first = deferred();
    const second = deferred();
    const gates = [first, second];
    let n = 0;
    const { facts, manager } = setup(
      {
        e: {
          deps: ["count"],
          run: async () => {
            await gates[n++]!.promise;
          },
        },
      },
      { onError },
    );
    facts.count = 1;
    const a = manager.runEffects(new Set(["count"]));
    facts.count = 2;
    const b = manager.runEffects(new Set(["count"]));
    first.resolve();
    second.resolve();
    await Promise.all([a, b]);

    expect(onError).not.toHaveBeenCalled();
  });

  it("callOne reports an in-place mutation", async () => {
    const onError = vi.fn();
    quiet();
    const { manager } = setup(
      {
        e: {
          deps: ["count"],
          run: (f: any) => {
            f.obj.x = 7;
          },
        },
      },
      { onError },
    );
    await manager.callOne("e");

    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]![1])).toContain("in place");
  });
});

// ============================================================================
// onRun and the dependency list it reports
// ============================================================================

describe("onRun", () => {
  it("reports declared deps by default, derivations as derive.<id>", async () => {
    const onRun = vi.fn();
    const { facts, manager } = setup(
      { e: { deps: ["count", "doubled"], run: () => undefined } },
      { onRun, isDerivation: (n: string) => n === "doubled" },
    );
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));

    expect(onRun).toHaveBeenCalledWith("e", ["count", "derive.doubled"]);
  });

  it("reports nothing when the caller says it will not read them", async () => {
    const onRun = vi.fn();
    const { facts, manager } = setup(
      { e: { deps: ["count"], run: () => undefined } },
      { onRun, wantsRunDeps: () => false },
    );
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));

    expect(onRun).toHaveBeenCalledWith("e", []);
  });

  it("reports an empty list on the first run of an auto-tracked effect", async () => {
    const onRun = vi.fn();
    const { facts, manager } = setup(
      {
        e: {
          run: (f: any) => {
            void f.count;
          },
        },
      },
      { onRun },
    );
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));
    facts.count = 2;
    await manager.runEffects(new Set(["count"]));

    expect(onRun.mock.calls).toEqual([
      ["e", []],
      ["e", ["count"]],
    ]);
  });

  it("works without a callback", async () => {
    const run = vi.fn();
    const { facts, manager } = setup({ e: { deps: ["count"], run } });
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));
    manager.runEffectsFast(new Set(["count"]));
    await manager.callOne("e");

    expect(run).toHaveBeenCalledTimes(3);
  });

  it("callOne reports its dependencies, empty when none are known", async () => {
    const onRun = vi.fn();
    const { manager } = setup(
      {
        declared: { deps: ["count", "name"], run: () => undefined },
        auto: { run: () => undefined },
      },
      { onRun },
    );
    await manager.callOne("declared");
    await manager.callOne("auto");

    expect(onRun.mock.calls).toEqual([
      ["declared", ["count", "name"]],
      ["auto", []],
    ]);
  });
});

// ============================================================================
// Declared deps, resolved late
// ============================================================================

describe("declared dependencies", () => {
  it("a name that becomes a derivation later is picked up", async () => {
    let known = false;
    const run = vi.fn();
    const { manager } = setup(
      { e: { deps: ["late"], run } },
      {
        isDerivation: (n: string) => known && n === "late",
        isFactKey: () => false,
      },
    );

    await manager.runEffects(new Set([dd("late")]));
    expect(run).not.toHaveBeenCalled();

    known = true;
    await manager.runEffects(new Set([dd("late")]));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("one of several unresolved names becoming known is enough", async () => {
    let known = false;
    const run = vi.fn();
    const { manager } = setup(
      { e: { deps: ["a", "b"], run } },
      {
        isDerivation: (n: string) => known && n === "a",
        isFactKey: () => false,
      },
    );
    known = true;
    await manager.runEffects(new Set([dd("a")]));

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a name that is a fact is not rewritten", async () => {
    const run = vi.fn();
    const { manager } = setup(
      { e: { deps: ["count"], run } },
      { isDerivation: () => false, isFactKey: (n: string) => n === "count" },
    );
    await manager.runEffects(new Set(["count"]));

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("reports derivations among collectObservedDerivations, not facts", async () => {
    const { manager } = setup(
      {
        a: { deps: ["count", "doubled"], run: () => undefined },
        b: { deps: ["tripled"], run: () => undefined },
        gone: { deps: ["quad"], run: () => undefined },
      },
      { isDerivation: (n: string) => n !== "count" },
    );
    manager.disable("gone");
    const into = new Set<string>();
    manager.collectObservedDerivations(into);

    expect([...into].sort()).toEqual(["doubled", "tripled"]);
  });

  it("an auto-tracked effect's derivation reads are collected once it has run", async () => {
    const { facts, manager } = setup({
      e: {
        run: (f: any) => {
          void f.count;
        },
      },
    });
    const before = new Set<string>();
    manager.collectObservedDerivations(before);
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));
    const after = new Set<string>();
    manager.collectObservedDerivations(after);

    expect([...before, ...after]).toEqual([]);
  });
});

// ============================================================================
// Data-form `on`
// ============================================================================

describe("data-form on", () => {
  it("rejects a value that is not a predicate, by name", () => {
    expect(
      messageOf(() => setup({ e: { on: "nope", run: () => undefined } })),
    ).toContain("effect on must be a FactPredicate spec; got string");
    expect(
      messageOf(() => setup({ e: { on: 42, run: () => undefined } })),
    ).toContain("effect on must be a FactPredicate spec; got number");
  });

  it("freezes the spec it was given", () => {
    const on = { count: { $gt: 1 } };
    setup({ e: { on, run: () => undefined } });

    expect(Object.isFrozen(on)).toBe(true);
  });

  it("fires only when the gate holds, and only for changes to its facts", async () => {
    const run = vi.fn();
    const { facts, manager } = setup({
      e: { on: { count: { $gt: 5 } }, run },
    });

    facts.count = 3;
    await manager.runEffects(new Set(["count"]));
    expect(run).not.toHaveBeenCalled();

    facts.count = 9;
    await manager.runEffects(new Set(["name"]));
    expect(run).not.toHaveBeenCalled();

    await manager.runEffects(new Set(["count"]));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keeps the predicate's facts as its deps whatever the body reads", async () => {
    const onRun = vi.fn();
    const { facts, manager } = setup(
      {
        e: {
          on: { count: { $gt: 0 } },
          run: (f: any) => {
            void f.name;
          },
        },
      },
      { onRun },
    );
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));
    await manager.runEffects(new Set(["count"]));

    expect(onRun.mock.calls.map((c) => c[1])).toEqual([["count"], ["count"]]);

    await manager.runEffects(new Set(["name"]));
    expect(onRun).toHaveBeenCalledTimes(2);
  });

  it("swapping to a function-form effect drops the old gate", async () => {
    const run = vi.fn();
    const { facts, manager } = setup({
      e: { on: { count: { $gt: 100 } }, run: () => undefined },
    });
    manager.assignDefinition("e", { deps: ["count"], run } as never);
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));

    expect(run).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Cleanup
// ============================================================================

describe("cleanup", () => {
  it("runs before the next run, once, and not again", async () => {
    const order: string[] = [];
    const { facts, manager } = setup({
      e: {
        deps: ["count"],
        run: (f: any) => {
          order.push(`run ${f.count}`);

          return () => order.push(`cleanup ${f.count}`);
        },
      },
    });
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));
    facts.count = 2;
    await manager.runEffects(new Set(["count"]));
    manager.cleanupAll();
    manager.cleanupAll();

    expect(order).toEqual(["run 1", "cleanup 2", "run 2", "cleanup 2"]);
  });

  it("an auto-tracked effect's cleanup is stored too", async () => {
    const cleanup = vi.fn();
    const { facts, manager } = setup({
      e: {
        run: (f: any) => {
          void f.count;

          return cleanup;
        },
      },
    });
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));
    expect(cleanup).not.toHaveBeenCalled();
    manager.cleanupAll();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("an async effect's cleanup is stored when it settles", async () => {
    const cleanup = vi.fn();
    const gate = deferred();
    const { facts, manager } = setup({
      declared: {
        deps: ["count"],
        run: async () => {
          await gate.promise;

          return cleanup;
        },
      },
    });
    facts.count = 1;
    const pass = manager.runEffects(new Set(["count"]));
    gate.resolve();
    await pass;
    manager.cleanupAll();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("an async auto-tracked effect's cleanup is stored when it settles", async () => {
    const cleanup = vi.fn();
    const gate = deferred();
    quiet();
    const { facts, manager } = setup({
      e: {
        run: async (f: any) => {
          void f.count;
          await gate.promise;

          return cleanup;
        },
      },
    });
    facts.count = 1;
    const pass = manager.runEffects(new Set(["count"]));
    gate.resolve();
    await pass;
    manager.cleanupAll();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("a cleanup that throws is reported and the effect still re-runs", async () => {
    const { error } = quiet();
    const onError = vi.fn();
    const run = vi.fn(() => () => {
      throw new Error("cleanup boom");
    });
    const { facts, manager } = setup(
      { e: { deps: ["count"], run } },
      { onError },
    );
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));
    facts.count = 2;
    await manager.runEffects(new Set(["count"]));

    expect(run).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]![1])).toContain("cleanup boom");
    expect(error).toHaveBeenCalledWith(
      '[Directive] Effect "e" cleanup threw an error:',
      expect.any(Error),
    );
  });

  it("a cleanup that throws with nobody listening does not escape", async () => {
    quiet();
    const { facts, manager } = setup({
      e: {
        deps: ["count"],
        run: () => () => {
          throw new Error("cleanup boom");
        },
      },
    });
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));

    expect(() => manager.cleanupAll()).not.toThrow();
  });

  it("an effect settling after cleanupAll has its cleanup called at once", async () => {
    const cleanup = vi.fn();
    const gate = deferred();
    const { facts, manager } = setup({
      e: {
        deps: ["count"],
        run: async () => {
          await gate.promise;

          return cleanup;
        },
      },
    });
    facts.count = 1;
    const pass = manager.runEffects(new Set(["count"]));
    manager.cleanupAll();
    gate.resolve();
    await pass;

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("a late cleanup that throws is reported", async () => {
    const { error } = quiet();
    const onError = vi.fn();
    const gate = deferred();
    const { facts, manager } = setup(
      {
        e: {
          deps: ["count"],
          run: async () => {
            await gate.promise;

            return () => {
              throw new Error("late boom");
            };
          },
        },
      },
      { onError },
    );
    facts.count = 1;
    const pass = manager.runEffects(new Set(["count"]));
    manager.cleanupAll();
    gate.resolve();
    await pass;

    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]![1])).toContain("late boom");
    expect(error).toHaveBeenCalled();
  });

  it("before cleanupAll, a settling effect's cleanup is kept, not called", async () => {
    const cleanup = vi.fn();
    const { facts, manager } = setup({
      e: { deps: ["count"], run: () => cleanup },
    });
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));

    expect(cleanup).not.toHaveBeenCalled();
  });

  it("callOne stores a cleanup from a sync and from an async effect", async () => {
    const syncCleanup = vi.fn();
    const asyncCleanup = vi.fn();
    const { manager } = setup({
      s: { deps: ["count"], run: () => syncCleanup },
      a: { deps: ["count"], run: async () => asyncCleanup },
    });
    await manager.callOne("s");
    await manager.callOne("a");
    expect(syncCleanup).not.toHaveBeenCalled();
    expect(asyncCleanup).not.toHaveBeenCalled();

    await manager.callOne("s");
    await manager.callOne("a");
    expect(syncCleanup).toHaveBeenCalledTimes(1);
    expect(asyncCleanup).toHaveBeenCalledTimes(1);
  });

  it("replacing a definition cleans up the old one first", async () => {
    const cleanup = vi.fn();
    const { facts, manager } = setup({
      e: { deps: ["count"], run: () => cleanup },
    });
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));
    manager.assignDefinition("e", {
      deps: ["count"],
      run: () => undefined,
    } as never);

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("unregistering cleans up, and the effect no longer runs", async () => {
    const cleanup = vi.fn();
    const run = vi.fn(() => cleanup);
    const { facts, manager } = setup({ e: { deps: ["count"], run } });
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));
    manager.unregisterDefinition("e");
    manager.unregisterDefinition("e");
    manager.unregisterDefinition("never-existed");
    facts.count = 2;
    await manager.runEffects(new Set(["count"]));

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Errors
// ============================================================================

describe("a throwing effect", () => {
  it("is reported through onError and console.error, in the awaited path", async () => {
    const { error } = quiet();
    const onError = vi.fn();
    const boom = new Error("boom");
    const { facts, manager } = setup(
      {
        sync: {
          deps: ["count"],
          run: () => {
            throw boom;
          },
        },
        asynch: {
          deps: ["count"],
          run: async () => {
            throw boom;
          },
        },
        auto: {
          run: () => {
            throw boom;
          },
        },
      },
      { onError },
    );
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));

    expect(onError.mock.calls.map((c) => c[0]).sort()).toEqual([
      "asynch",
      "auto",
      "sync",
    ]);
    expect(error).toHaveBeenCalledWith(
      '[Directive] Effect "sync" threw an error:',
      boom,
    );
  });

  it("does not need an onError", async () => {
    const { error } = quiet();
    const { facts, manager } = setup({
      sync: {
        deps: ["count"],
        run: () => {
          throw new Error("boom");
        },
      },
      asynch: {
        deps: ["count"],
        run: async () => {
          throw new Error("boom");
        },
      },
    });
    facts.count = 1;

    await expect(
      manager.runEffects(new Set(["count"])),
    ).resolves.toBeUndefined();
    expect(() => manager.runEffectsFast(new Set(["count"]))).not.toThrow();
    await flush();
    await manager.callOne("sync");
    await manager.callOne("asynch");
    expect(error).toHaveBeenCalled();
  });

  it("does not stop the others, and is reported after every body has run", async () => {
    quiet();
    const order: string[] = [];
    const { facts, manager } = setup(
      {
        a: {
          deps: ["count"],
          run: () => {
            order.push("a");
            throw new Error("a failed");
          },
        },
        b: {
          deps: ["count"],
          run: () => {
            order.push("b");
          },
        },
      },
      {
        onError: (id: string) => {
          order.push(`error ${id}`);
        },
      },
    );
    facts.count = 1;
    const result = manager.runEffectsFast(new Set(["count"]));

    expect(result).toBeUndefined();
    expect(order).toEqual(["a", "b", "error a"]);
  });

  it("is reported before an async neighbour settles", async () => {
    quiet();
    const gate = deferred();
    const order: string[] = [];
    const { facts, manager } = setup(
      {
        a: {
          deps: ["count"],
          run: () => {
            throw new Error("a failed");
          },
        },
        slow: {
          deps: ["count"],
          run: async () => {
            await gate.promise;
            order.push("slow done");
          },
        },
      },
      {
        onError: (id: string) => {
          order.push(`error ${id}`);
        },
      },
    );
    facts.count = 1;
    const pending = manager.runEffectsFast(new Set(["count"]));

    expect(pending).toBeInstanceOf(Promise);
    expect(order).toEqual(["error a"]);
    gate.resolve();
    await pending;
    expect(order).toEqual(["error a", "slow done"]);
  });

  it("an async rejection in the fast path is reported", async () => {
    quiet();
    const onError = vi.fn();
    const { facts, manager } = setup(
      {
        a: {
          deps: ["count"],
          run: async () => {
            throw new Error("late");
          },
        },
      },
      { onError },
    );
    facts.count = 1;
    await manager.runEffectsFast(new Set(["count"]));

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("callOne reports a sync throw, an async rejection and nothing more", async () => {
    const { error } = quiet();
    const onError = vi.fn();
    const { manager } = setup(
      {
        s: {
          deps: ["count"],
          run: () => {
            throw new Error("s");
          },
        },
        a: {
          deps: ["count"],
          run: async () => {
            throw new Error("a");
          },
        },
      },
      { onError },
    );
    await expect(manager.callOne("s")).resolves.toBeUndefined();
    await expect(manager.callOne("a")).resolves.toBeUndefined();

    expect(onError.mock.calls.map((c) => c[0])).toEqual(["s", "a"]);
    expect(error).toHaveBeenCalledWith(
      '[Directive] Effect "a" threw an error:',
      expect.any(Error),
    );
  });
});

// ============================================================================
// Running
// ============================================================================

describe("which effects run", () => {
  it("runEffects waits for an async effect, declared or auto-tracked", async () => {
    quiet();
    const done: string[] = [];
    const g1 = deferred();
    const g2 = deferred();
    const { facts, manager } = setup({
      declared: {
        deps: ["count"],
        run: async () => {
          await g1.promise;
          await flush();
          done.push("declared");
        },
      },
      auto: {
        run: async (f: any) => {
          void f.count;
          await g2.promise;
          await flush();
          done.push("auto");
        },
      },
    });
    facts.count = 1;
    const pass = manager.runEffects(new Set(["count"]));
    await flush();
    expect(done).toEqual([]);
    g1.resolve();
    g2.resolve();
    await pass;

    expect(done.sort()).toEqual(["auto", "declared"]);
  });

  it("runEffectsFast waits for every async effect, and only async ones make it return a promise", async () => {
    const done: string[] = [];
    const g1 = deferred();
    const g2 = deferred();
    const { facts, manager } = setup({
      one: {
        deps: ["count"],
        run: async () => {
          await g1.promise;
          done.push("one");
        },
      },
      two: {
        deps: ["count"],
        run: async () => {
          await g2.promise;
          done.push("two");
        },
      },
    });
    facts.count = 1;
    const pending = manager.runEffectsFast(new Set(["count"]));
    expect(pending).toBeInstanceOf(Promise);
    g1.resolve();
    await flush();
    let settled = false;
    void pending!.then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false);
    g2.resolve();
    await pending;

    expect(done.sort()).toEqual(["one", "two"]);
    expect(manager.runEffectsFast(new Set(["name"]))).toBeUndefined();
  });

  it("an effect disabled by an earlier one in the same pass does not run", async () => {
    const ranB = vi.fn();
    const ranC = vi.fn();
    const { facts, manager } = setup({
      a: {
        deps: ["count"],
        run: () => {
          manager.disable("b");
          manager.disable("c");
        },
      },
      b: { deps: ["count"], run: ranB },
      c: { run: ranC },
    });
    facts.count = 1;
    manager.runEffectsFast(new Set(["count"]));
    expect(ranB).not.toHaveBeenCalled();
    expect(ranC).not.toHaveBeenCalled();
  });

  it("a disabled effect is skipped, enabling brings it back", async () => {
    const run = vi.fn();
    const { facts, manager } = setup({ e: { deps: ["count"], run } });
    expect(manager.isEnabled("e")).toBe(true);
    manager.disable("e");
    expect(manager.isEnabled("e")).toBe(false);
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));
    await manager.runAll();
    await manager.callOne("e");
    expect(run).not.toHaveBeenCalled();

    manager.enable("e");
    expect(manager.isEnabled("e")).toBe(true);
    await manager.runEffects(new Set(["count"]));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs only effects whose deps changed; with no deps known, on any change", async () => {
    const onCount = vi.fn();
    const onName = vi.fn();
    const anything = vi.fn();
    const { manager } = setup({
      onCount: { deps: ["count"], run: onCount },
      onName: { deps: ["name"], run: onName },
      anything: { run: anything },
    });
    await manager.runEffects(new Set(["count"]));

    expect(onCount).toHaveBeenCalledTimes(1);
    expect(onName).not.toHaveBeenCalled();
    expect(anything).toHaveBeenCalledTimes(1);
  });

  it("an auto-tracked effect that read nothing runs on every change", async () => {
    const run = vi.fn();
    const { manager } = setup({ e: { run } });
    await manager.runEffects(new Set(["count"]));
    await manager.runEffects(new Set(["name"]));
    await manager.runEffects(new Set(["flag"]));

    expect(run).toHaveBeenCalledTimes(3);
  });

  it("an auto-tracked effect re-runs only for what it read", async () => {
    const run = vi.fn((f: any) => {
      void f.count;
    });
    const { manager } = setup({ e: { run } });
    await manager.runEffects(new Set(["count"]));
    await manager.runEffects(new Set(["name"]));
    await manager.runEffects(new Set(["count"]));

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("runAll runs every enabled effect regardless of deps", async () => {
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    const { manager } = setup({
      a: { deps: ["count"], run: a },
      b: { deps: ["name"], run: b },
      c: { run: c },
    });
    manager.disable("b");
    await manager.runAll();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(c).toHaveBeenCalledTimes(1);
  });

  it("runningEffect names the effect on the stack and nothing after", async () => {
    const seen: Array<string | null> = [];
    const { manager } = setup({
      outer: {
        deps: ["count"],
        run: () => {
          seen.push(manager.runningEffect());
          manager.callOne("inner");
          seen.push(manager.runningEffect());
        },
      },
      inner: {
        deps: ["count"],
        run: () => {
          seen.push(manager.runningEffect());
        },
      },
    });
    expect(manager.runningEffect()).toBeNull();
    await manager.callOne("outer");
    await flush();

    expect(seen).toEqual(["outer", "inner", "outer"]);
    expect(manager.runningEffect()).toBeNull();
  });
});

describe("unknown effects", () => {
  it("callOne says which one", async () => {
    const { manager } = setup({});

    await expect(manager.callOne("ghost")).rejects.toThrow(
      '[Directive] Cannot call effect "ghost" — it does not exist.',
    );
  });

  it("assignDefinition says which one", () => {
    const { manager } = setup({});

    expect(() =>
      manager.assignDefinition("ghost", { run: () => undefined } as never),
    ).toThrow(
      '[Directive] Cannot assign effect "ghost" — it does not exist. Use register() to create it.',
    );
  });

  it("asking about one that was never defined throws", () => {
    const { manager } = setup({});

    expect(() => manager.isEnabled("ghost")).toThrow(
      "[Directive] Unknown effect: ghost",
    );
  });

  it("registerDefinitions adds effects that then run", async () => {
    const run = vi.fn();
    const { facts, manager } = setup({});
    manager.registerDefinitions({ late: { deps: ["count"], run } } as never);
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));

    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("requestRerun", () => {
  it("runs the effect on the next pass whatever changed, once", async () => {
    const run = vi.fn();
    const { manager } = setup({ e: { deps: ["count"], run } });
    expect(manager.hasPendingReruns()).toBe(false);
    manager.requestRerun("e");
    manager.requestRerun("ghost");
    expect(manager.hasPendingReruns()).toBe(true);

    await manager.runEffects(new Set(["name"]));
    expect(run).toHaveBeenCalledTimes(1);
    expect(manager.hasPendingReruns()).toBe(false);

    await manager.runEffects(new Set(["name"]));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("ignores an unknown effect", () => {
    const { manager } = setup({});
    manager.requestRerun("ghost");

    expect(manager.hasPendingReruns()).toBe(false);
  });

  it("does not wake a disabled effect", async () => {
    const run = vi.fn();
    const { manager } = setup({ e: { deps: ["count"], run } });
    manager.disable("e");
    manager.requestRerun("e");
    await manager.runEffects(new Set(["name"]));
    expect(run).not.toHaveBeenCalled();
  });

  it("works through the fast path as well", () => {
    const run = vi.fn();
    const { manager } = setup({ e: { deps: ["count"], run } });
    manager.requestRerun("e");
    manager.runEffectsFast(new Set());

    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("navigation keys", () => {
  it("wake effects like a change", async () => {
    const run = vi.fn();
    const { manager } = setup({ e: { deps: ["count"], run } });
    await manager.runEffects(new Set(), new Set(["count"]));
    manager.runEffectsFast(new Set(), new Set(["count"]));

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("combine with ordinary changes", async () => {
    const onCount = vi.fn();
    const onName = vi.fn();
    const { manager } = setup({
      onCount: { deps: ["count"], run: onCount },
      onName: { deps: ["name"], run: onName },
    });
    await manager.runEffects(new Set(["name"]), new Set(["count"]));

    expect(onCount).toHaveBeenCalledTimes(1);
    expect(onName).toHaveBeenCalledTimes(1);
  });

  it("onNavigate skip sits out a pure navigation but not a real change", async () => {
    const skipper = vi.fn();
    const mirror = vi.fn();
    const { manager } = setup({
      skipper: { deps: ["count"], onNavigate: "skip", run: skipper },
      mirror: { deps: ["count"], run: mirror },
    });
    await manager.runEffects(new Set(), new Set(["count"]));
    expect(skipper).not.toHaveBeenCalled();
    expect(mirror).toHaveBeenCalledTimes(1);

    await manager.runEffects(new Set(["count"]), new Set(["count"]));
    expect(skipper).toHaveBeenCalledTimes(1);

    await manager.runEffects(new Set(["name"]), new Set(["count"]));
    expect(skipper).toHaveBeenCalledTimes(1);
  });

  it("an empty set changes nothing", async () => {
    const run = vi.fn();
    const { manager } = setup({ e: { deps: ["count"], run } });
    await manager.runEffects(new Set(["count"]), new Set());
    await manager.runEffects(new Set(["count"]), null);
    await manager.runEffects(new Set(["count"]), undefined);

    expect(run).toHaveBeenCalledTimes(3);
  });
});

// ============================================================================
// Auto-tracking
// ============================================================================

describe("auto-tracking", () => {
  /** An effect that reads `flag`, then `a`-ish or `b`-ish depending on it. */
  function conditional() {
    const onRun = vi.fn();
    const ctx = setup(
      {
        e: {
          run: (f: any) => {
            if (f.flag) {
              void f.name;
            } else {
              void f.count;
            }
          },
        },
      },
      { onRun },
    );

    return { ...ctx, onRun };
  }

  it("picks up a new conditional read after many identical runs", async () => {
    const { facts, manager, onRun } = conditional();
    for (let i = 1; i <= 6; i++) {
      facts.count = i;
      await manager.runEffects(new Set(["count"]));
    }
    facts.flag = true;
    await manager.runEffects(new Set(["flag"]));
    onRun.mockClear();

    await manager.runEffects(new Set(["name"]));
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun.mock.calls[0]![1].sort()).toEqual(["flag", "name"]);
    onRun.mockClear();

    await manager.runEffects(new Set(["count"]));
    expect(onRun).not.toHaveBeenCalled();
  });

  it("runAll re-tracks after the reads have settled", async () => {
    const { facts, manager, onRun } = conditional();
    for (let i = 1; i <= 6; i++) {
      facts.count = i;
      await manager.runEffects(new Set(["count"]));
    }
    facts.flag = true;
    await manager.runAll();
    onRun.mockClear();

    await manager.runEffects(new Set(["name"]));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("an effect whose reads change from run to run is always re-tracked on a rerun", async () => {
    const reads: string[][] = [];
    let which = 0;
    const onRun = vi.fn();
    const { facts, manager } = setup(
      {
        e: {
          run: (f: any) => {
            if (which % 2 === 0) {
              void f.count;
            } else {
              void f.name;
            }
          },
        },
      },
      { onRun },
    );
    for (; which < 6; which++) {
      await manager.runEffects(new Set(["count", "name"]));
    }
    which = 7;
    manager.requestRerun("e");
    await manager.runEffects(new Set());
    manager.requestRerun("e");
    onRun.mockClear();
    await manager.runEffects(new Set());
    reads.push(onRun.mock.calls[0]![1]);

    expect(reads).toEqual([["name"]]);
    void facts;
  });

  it("an error resets what it knew, so the next run re-tracks", async () => {
    quiet();
    let mode: "ok" | "throw" | "b" = "ok";
    const onRun = vi.fn();
    const { facts, manager } = setup(
      {
        e: {
          run: (f: any) => {
            void f.count;
            if (mode === "throw") {
              throw new Error("boom");
            }
            if (mode === "b") {
              void f.name;
            }
          },
        },
      },
      { onRun },
    );
    for (let i = 1; i <= 6; i++) {
      facts.count = i;
      await manager.runEffects(new Set(["count"]));
    }
    mode = "throw";
    manager.requestRerun("e");
    await manager.runEffects(new Set());
    mode = "b";
    manager.requestRerun("e");
    await manager.runEffects(new Set());
    onRun.mockClear();

    await manager.runEffects(new Set(["name"]));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("an explicitly declared effect keeps its deps through an error", async () => {
    quiet();
    const run = vi.fn((_f: any) => {
      throw new Error("boom");
    });
    const { manager } = setup({ e: { deps: ["count"], run } });
    await manager.runEffects(new Set(["count"]));
    await manager.runEffects(new Set(["name"]));
    await manager.runEffects(new Set(["count"]));

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("warns once when an async effect read nothing before its first await", async () => {
    const { warn } = quiet();
    const { facts, manager } = setup({
      lost: {
        run: async (f: any) => {
          await Promise.resolve();
          void f.count;
        },
      },
      fine: {
        run: async (f: any) => {
          void f.count;
          await Promise.resolve();
        },
      },
    });
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));
    facts.count = 2;
    await manager.runEffects(new Set(["count"]));

    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.length).toBe(1);
    expect(messages[0]).toContain(
      'Async effect "lost" recorded no dependencies',
    );
  });

  it("does not warn about a synchronous effect that read nothing", async () => {
    const { warn } = quiet();
    const { manager } = setup({ e: { run: () => undefined } });
    await manager.runEffects(new Set(["count"]));

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("more run behaviour", () => {
  it("an effect disabled by an earlier one is skipped in the awaited pass too", async () => {
    const ranB = vi.fn();
    const ranC = vi.fn();
    const { facts, manager } = setup({
      a: {
        deps: ["count"],
        run: () => {
          manager.disable("b");
          manager.disable("c");
        },
      },
      b: { deps: ["count"], run: ranB },
      c: { run: ranC },
    });
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));

    expect(ranB).not.toHaveBeenCalled();
    expect(ranC).not.toHaveBeenCalled();
  });

  it("a returned value that is not a function is not kept as a cleanup", async () => {
    const onError = vi.fn();
    const { facts, manager } = setup(
      { e: { deps: ["count"], run: () => ({ not: "a function" }) } },
      { onError },
    );
    facts.count = 1;
    await manager.runEffects(new Set(["count"]));
    facts.count = 2;
    await manager.runEffects(new Set(["count"]));
    manager.cleanupAll();

    expect(onError).not.toHaveBeenCalled();
  });

  it("a late cleanup that throws needs no onError", async () => {
    quiet();
    const gate = deferred();
    const { facts, manager } = setup({
      e: {
        deps: ["count"],
        run: async () => {
          await gate.promise;

          return () => {
            throw new Error("late boom");
          };
        },
      },
    });
    facts.count = 1;
    const pass = manager.runEffects(new Set(["count"]));
    manager.cleanupAll();
    gate.resolve();

    await expect(pass).resolves.toBeUndefined();
  });

  it("swapping in an effect that reads prevFacts gives it a snapshot", async () => {
    const seen: unknown[] = [];
    const { facts, manager } = setup({
      e: { deps: ["count"], run: (_f: unknown) => undefined },
    });
    await manager.runEffects(new Set(["count"]));
    facts.count = 1;
    manager.assignDefinition("e", {
      deps: ["count"],
      run: (_f: unknown, prev: any) => {
        seen.push(prev === null ? null : prev.count);
      },
    } as never);
    facts.count = 2;
    await manager.runEffects(new Set(["count"]));

    expect(seen).toEqual([1]);
  });
});
