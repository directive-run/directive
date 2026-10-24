// Ported from packages/core/src/core/__tests__/l1-effects.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// Black-box tests for effects at the base of the ladder: an effect's run(facts),
// facts, events and derivations, with no plugins, no error boundary, no deps/on
// and no prev. Public API only. Where 2.0 may legitimately do less work the
// assertions say "at most".

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
  events: { bump: {}, rename: { name: t.string() } },
};

function build(defs: Record<string, unknown>) {
  // A bare function is shorthand for `{ run }`.
  const effects = Object.fromEntries(
    Object.entries(defs).map(([id, def]) => [
      id,
      typeof def === "function" ? { run: def } : def,
    ]),
  );
  const mod = createModule("m", {
    schema,
    init: (facts: any) => {
      facts.count = 0;
      facts.name = "alice";
      facts.flag = false;
      facts.obj = { x: 1 };
    },
    derive: { doubled: (facts: any) => facts.count * 2 },
    events: {
      bump: (facts: any) => {
        facts.count = facts.count + 1;
      },
      rename: (facts: any, payload: any) => {
        facts.name = payload.name;
      },
    },
    effects: effects as never,
  });

  return createSystem({ module: mod } as never) as any;
}

async function bump(system: any, key: string, value: unknown) {
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
  vi.spyOn(console, "warn").mockImplementation(() => undefined);

  return {
    error: vi.spyOn(console, "error").mockImplementation(() => undefined),
  };
}

describe("which effects run", () => {
  it("every enabled effect runs once at start, in declaration order", async () => {
    const ran: string[] = [];
    const system = build({
      a: (facts: any) => void ran.push(`a${facts.count}`),
      b: { run: (facts: any) => void ran.push(`b${facts.count}`) },
    });
    await system.start();

    expect(ran).toEqual(["a0", "b0"]);
    await system.destroy();
  });

  it("an effect runs only for what it read", async () => {
    const ran: number[] = [];
    const system = build({
      e: {
        run: (facts: any) => {
          ran.push(facts.count);
        },
      },
    });
    await system.start();
    await bump(system, "name", "bob");
    await bump(system, "flag", true);
    expect(ran).toEqual([0]);

    await bump(system, "count", 1);
    expect(ran).toEqual([0, 1]);
    await system.destroy();
  });

  it("an effect that read nothing runs on every change", async () => {
    let runs = 0;
    const system = build({
      e: {
        run: () => {
          runs++;
        },
      },
    });
    await system.start();
    expect(runs).toBe(1);

    await bump(system, "name", "bob");
    expect(runs).toBe(2);
    await bump(system, "count", 1);
    expect(runs).toBe(3);
    await system.destroy();
  });

  it("an effect that read a derivation runs when it changes", async () => {
    const seen: number[] = [];
    const system = build({
      e: {
        run: (facts: any) => {
          void facts.flag;
          seen.push(system.derive.doubled);
        },
      },
    });
    await system.start();
    await bump(system, "count", 2);
    await bump(system, "flag", true);

    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(4);
    await system.destroy();
  });

  it("a changed value the effect read wakes it, an equal write does not", async () => {
    const ran: number[] = [];
    const system = build({
      e: { run: (facts: any) => void ran.push(facts.count) },
    });
    await system.start();
    await bump(system, "count", 0);
    expect(ran).toEqual([0]);
    await bump(system, "count", 3);
    expect(ran).toEqual([0, 3]);
    await system.destroy();
  });

  it("a conditional read is followed, also after many identical runs", async () => {
    const seen: string[] = [];
    const system = build({
      e: {
        run: (facts: any) => {
          seen.push(facts.flag ? `name:${facts.name}` : `count:${facts.count}`);
        },
      },
    });
    await system.start();
    for (let i = 1; i <= 8; i++) {
      await bump(system, "count", i);
    }
    // not read yet, so not a reason to run
    const before = seen.length;
    await bump(system, "name", "bob");
    expect(seen.length).toBe(before);

    await bump(system, "flag", true);
    expect(seen.at(-1)).toBe("name:bob");
    const afterFlag = seen.length;
    await bump(system, "name", "carol");
    expect(seen.length).toBe(afterFlag + 1);
    expect(seen.at(-1)).toBe("name:carol");

    // count is no longer read
    await bump(system, "count", 99);
    expect(seen.length).toBe(afterFlag + 1);
    await system.destroy();
  });

  it("an effect keeps reacting after the system sat idle and many runs", async () => {
    const ran: number[] = [];
    const system = build({
      e: { run: (facts: any) => void ran.push(facts.count) },
    });
    await system.start();
    for (let i = 1; i <= 6; i++) {
      await bump(system, "count", i);
    }
    await flush();
    await bump(system, "count", 100);
    expect(ran.at(-1)).toBe(100);
    expect(ran).toEqual([0, 1, 2, 3, 4, 5, 6, 100]);
    await system.destroy();
  });

  it("an effect woken by an event sees the fact the event wrote", async () => {
    const ran: number[] = [];
    const system = build({
      e: { run: (facts: any) => void ran.push(facts.count) },
    });
    await system.start();
    system.dispatch({ type: "bump" });
    await system.settle();
    system.dispatch({ type: "rename", name: "zed" });
    await system.settle();

    expect(ran).toEqual([0, 1]);
    await system.destroy();
  });

  it("an async effect makes settle() wait for it", async () => {
    const gate = deferred();
    let finished = false;
    const system = build({
      e: async (facts: any) => {
        void facts.count;
        await gate.promise;
        finished = true;
      },
    });
    const started = system.start();
    await flush();
    gate.resolve();
    await started;
    await system.settle();

    expect(finished).toBe(true);
    await system.destroy();
  });

  it("settle() after a write waits for an async effect woken by it", async () => {
    const gate = deferred();
    let finished = false;
    let settled = false;
    const system = build({
      e: async (facts: any) => {
        if (facts.count === 0) {
          return;
        }
        await gate.promise;
        finished = true;
      },
    });
    await system.start();
    system.facts.count = 1;
    const waiting = system.settle().then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false);

    gate.resolve();
    await waiting;
    expect(finished).toBe(true);
    await system.destroy();
  });

  it("a throw next to an async effect is reported by the time settle() returns", async () => {
    const { error } = quiet();
    const gate = deferred();
    const system = build({
      bad: (facts: any) => {
        if (facts.count > 0) {
          throw new Error("boom");
        }
      },
      slow: async (facts: any) => {
        if (facts.count > 0) {
          await gate.promise;
        }
      },
    });
    await system.start();
    system.facts.count = 1;
    const waiting = system.settle();
    await flush();
    gate.resolve();
    await waiting;

    expect(error).toHaveBeenCalledTimes(1);
    await system.destroy();
  });

  it("an effect that read nothing coexists with one that read a derivation", async () => {
    const { error } = quiet();
    const seen: number[] = [];
    let blind = 0;
    const system = build({
      reader: (facts: any) => {
        void facts.flag;
        seen.push(system.derive.doubled);
      },
      blind: () => {
        blind++;
      },
    });
    await system.start();
    await bump(system, "count", 1);
    await bump(system, "count", 2);
    await bump(system, "flag", true);

    expect(seen.at(-1)).toBe(4);
    expect(blind).toBeGreaterThanOrEqual(3);
    expect(error).not.toHaveBeenCalled();
    await system.destroy();
  });

  it("a synchronous effect has finished by the time the write settles", async () => {
    let seen = -1;
    const system = build({
      e: (facts: any) => {
        seen = facts.count;
      },
    });
    await system.start();
    await bump(system, "count", 7);

    expect(seen).toBe(7);
    await system.destroy();
  });
});

describe("cleanup", () => {
  it("runs before the next run, once, and not again", async () => {
    const order: string[] = [];
    const system = build({
      e: (facts: any) => {
        const n = facts.count;
        order.push(`run ${n}`);

        return () => order.push(`cleanup ${n}`);
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

  it("an effect with no cleanup re-runs without one", async () => {
    const ran: number[] = [];
    const system = build({
      e: (facts: any) => {
        ran.push(facts.count);
      },
    });
    await system.start();
    await bump(system, "count", 1);

    expect(ran).toEqual([0, 1]);
    await system.destroy();
  });

  it("an async effect's cleanup is kept when it settles, and run before the next run", async () => {
    const order: string[] = [];
    const system = build({
      e: async (facts: any) => {
        const n = facts.count;
        await Promise.resolve();
        order.push(`run ${n}`);

        return () => order.push(`cleanup ${n}`);
      },
    });
    await system.start();
    await system.settle();
    expect(order).toEqual(["run 0"]);

    await bump(system, "count", 1);
    expect(order).toEqual(["run 0", "cleanup 0", "run 1"]);
    await system.destroy();
  });

  it("a returned value that is not a function is not kept as a cleanup", async () => {
    const { error } = quiet();
    const ran: number[] = [];
    const system = build({
      str: (facts: any) => {
        void facts.count;

        return "not a function";
      },
      obj: (facts: any) => {
        void facts.count;

        return { call: () => ran.push(1) };
      },
      num: (facts: any) => {
        void facts.count;

        return 42;
      },
      asyncStr: async (facts: any) => {
        void facts.count;

        return "still not a function";
      },
    });
    await system.start();
    await bump(system, "count", 1);
    await system.destroy();

    expect(ran).toEqual([]);
    expect(error).not.toHaveBeenCalled();
  });

  it("stop() runs every pending cleanup, once", async () => {
    const order: string[] = [];
    const system = build({
      a: (facts: any) => {
        void facts.count;

        return () => order.push("a");
      },
      b: (facts: any) => {
        void facts.name;

        return () => order.push("b");
      },
    });
    await system.start();
    await system.stop();

    expect([...order].sort()).toEqual(["a", "b"]);
    await system.destroy();
    expect([...order].sort()).toEqual(["a", "b"]);
  });

  it("destroy() runs pending cleanups", async () => {
    const order: string[] = [];
    const system = build({
      a: (facts: any) => {
        void facts.count;

        return () => order.push("a");
      },
    });
    await system.start();
    system.destroy();
    await flush();

    expect(order).toEqual(["a"]);
  });

  it("a cleanup that throws is reported and the effect still re-runs", async () => {
    const { error } = quiet();
    const ran: number[] = [];
    const system = build({
      e: (facts: any) => {
        ran.push(facts.count);

        return () => {
          throw new Error("cleanup boom");
        };
      },
    });
    await system.start();
    await bump(system, "count", 1);

    expect(ran).toEqual([0, 1]);
    expect(error).toHaveBeenCalledTimes(1);

    // the thrown cleanup is dropped, not retried on a pass that does not run it
    await bump(system, "name", "bob");
    expect(error).toHaveBeenCalledTimes(1);
    await system.destroy();
  });

  it("an async effect settling after stop() has its cleanup called at once", async () => {
    const gate = deferred();
    const order: string[] = [];
    const system = build({
      e: async (facts: any) => {
        if (facts.count === 0) {
          return undefined;
        }
        await gate.promise;

        return () => order.push("cleaned");
      },
    });
    await system.start();
    system.facts.count = 1;
    await flush();
    await system.stop();
    expect(order).toEqual([]);

    gate.resolve();
    await flush();
    expect(order).toEqual(["cleaned"]);
    await system.destroy();
  });

  it("a late cleanup that throws after stop() is reported", async () => {
    const { error } = quiet();
    const gate = deferred();
    const system = build({
      e: async (facts: any) => {
        if (facts.count === 0) {
          return undefined;
        }
        await gate.promise;

        return () => {
          throw new Error("late boom");
        };
      },
    });
    await system.start();
    system.facts.count = 1;
    await flush();
    await system.stop();
    gate.resolve();
    await flush();

    expect(error).toHaveBeenCalledTimes(1);
    await system.destroy();
  });

  it("before stop(), a settling effect's cleanup is kept, not called", async () => {
    const gate = deferred();
    const order: string[] = [];
    const system = build({
      e: async (facts: any) => {
        void facts.count;
        await gate.promise;

        return () => order.push("cleaned");
      },
    });
    const started = system.start();
    gate.resolve();
    await started;
    await flush();

    expect(order).toEqual([]);
    await system.destroy();
    expect(order).toEqual(["cleaned"]);
  });
});

describe("a throwing effect", () => {
  it("is reported to the console", async () => {
    const { error } = quiet();
    const system = build({
      e: (facts: any) => {
        if (facts.count > 0) {
          throw new Error("boom");
        }
      },
    });
    await system.start();
    expect(error).not.toHaveBeenCalled();
    await bump(system, "count", 1);

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]!.some((a) => a instanceof Error)).toBe(true);
    await system.destroy();
  });

  it("does not stop the others, and runs again on the next change", async () => {
    quiet();
    const ran: string[] = [];
    const system = build({
      bad: (facts: any) => {
        ran.push("bad");
        if (facts.count > 0) {
          throw new Error("boom");
        }
      },
      good: (facts: any) => {
        void facts.count;
        ran.push("good");
      },
    });
    await system.start();
    ran.length = 0;
    await bump(system, "count", 1);
    expect([...ran].sort()).toEqual(["bad", "good"]);

    ran.length = 0;
    await bump(system, "count", 2);
    expect([...ran].sort()).toEqual(["bad", "good"]);
    await system.destroy();
  });

  it("every body runs before a thrown error is announced", async () => {
    const order: string[] = [];
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => {
      order.push("reported");
    });
    const system = build({
      bad: (facts: any) => {
        order.push("bad");
        if (facts.count > 0) {
          throw new Error("boom");
        }
      },
      good: (facts: any) => {
        void facts.count;
        order.push("good");
      },
    });
    await system.start();
    order.length = 0;
    await bump(system, "count", 1);

    expect(order).toEqual(["bad", "good", "reported"]);
    await system.destroy();
  });

  it("an async rejection is reported and the effect keeps running", async () => {
    const { error } = quiet();
    const ran: number[] = [];
    const system = build({
      e: async (facts: any) => {
        const n = facts.count;
        ran.push(n);
        await Promise.resolve();
        if (n === 1) {
          throw new Error("late boom");
        }
      },
    });
    await system.start();
    await system.settle();
    expect(error).not.toHaveBeenCalled();
    await bump(system, "count", 1);
    expect(error).toHaveBeenCalledTimes(1);

    await bump(system, "count", 2);
    expect(ran).toEqual([0, 1, 2]);
    expect(error).toHaveBeenCalledTimes(1);
    await system.destroy();
  });

  it("an effect that threw runs again when what it read changes", async () => {
    quiet();
    const ran: string[] = [];
    const system = build({
      e: (facts: any) => {
        if (facts.flag) {
          ran.push(`name:${facts.name}`);
          throw new Error("boom");
        }
        ran.push("quiet");
      },
    });
    await system.start();
    for (let i = 0; i < 5; i++) {
      await bump(system, "flag", i % 2 === 1);
    }
    ran.length = 0;
    await bump(system, "flag", true);
    expect(ran).toEqual(["name:alice"]);
    await system.destroy();
  });

  it("a throw after reading nothing new does not wedge the effect", async () => {
    quiet();
    let runs = 0;
    const system = build({
      e: (facts: any) => {
        runs++;
        void facts.count;
        throw new Error("always");
      },
    });
    await system.start();
    for (let i = 1; i <= 5; i++) {
      await bump(system, "count", i);
    }

    expect(runs).toBe(6);
    await system.destroy();
  });
});

describe("what an effect may do with facts", () => {
  it("a write is refused: the fact is unchanged and the error reported", async () => {
    const { error } = quiet();
    const system = build({
      w: (facts: any) => {
        void facts.flag;
        facts.count = 99;
      },
    });
    await system.start();

    expect(system.facts.count).toBe(0);
    expect(error).toHaveBeenCalledTimes(1);
    await system.destroy();
  });

  it("a refused write names the effect and the fact", async () => {
    const { error } = quiet();
    const system = build({
      writer: (facts: any) => {
        void facts.flag;
        facts.count = 99;
      },
    });
    await system.start();

    const thrown = error.mock.calls[0]!.find((a) => a instanceof Error) as
      | Error
      | undefined;
    expect(thrown?.message).toContain("writer");
    expect(thrown?.message).toContain("count");
    expect(thrown?.message).not.toMatch(/in place/);
    await system.destroy();
  });

  it("a nested mutation names the effect and the fact, as a change in place", async () => {
    const { error } = quiet();
    const system = build({
      mutator: (facts: any) => {
        void facts.flag;
        facts.obj.x = 5;
      },
    });
    await system.start();

    const thrown = error.mock.calls[0]!.find((a) => a instanceof Error) as
      | Error
      | undefined;
    expect(thrown?.message).toContain("mutator");
    expect(thrown?.message).toContain("obj");
    expect(thrown?.message).toMatch(/in place/);
    await system.destroy();
  });

  it("a write in a later run is refused too", async () => {
    const { error } = quiet();
    const system = build({
      w: (facts: any) => {
        if (facts.flag) {
          facts.count = 99;
        }
      },
    });
    await system.start();
    expect(error).not.toHaveBeenCalled();
    await bump(system, "flag", true);

    expect(system.facts.count).toBe(0);
    expect(error).toHaveBeenCalledTimes(1);
    await system.destroy();
  });

  it("a nested value mutated in place is reported", async () => {
    const { error } = quiet();
    const system = build({
      m: (facts: any) => {
        void facts.flag;
        facts.obj.x = 5;
      },
    });
    await system.start();

    expect(error).toHaveBeenCalledTimes(1);
    await system.destroy();
  });

  it("reading a nested value without mutating it is fine", async () => {
    const { error } = quiet();
    const seen: number[] = [];
    const system = build({
      r: (facts: any) => {
        seen.push(facts.obj.x);
      },
    });
    await system.start();

    expect(seen).toEqual([1]);
    expect(error).not.toHaveBeenCalled();
    await system.destroy();
  });

  it("the store behind facts can be read but not written", async () => {
    const { error } = quiet();
    const seen: Record<string, unknown> = {};
    const system = build({
      r: (facts: any) => {
        const store = facts.$store;
        seen.get = store.get("count");
        seen.has = store.has("count");
        seen.hasNot = store.has("nope");
        seen.all = store.toObject();
        let batched = 0;
        store.batch(() => {
          batched++;
        });
        seen.batched = batched;
        seen.unsubscribe = typeof store.subscribe(["count"], () => undefined);
        seen.unsubscribeAll = typeof store.subscribeAll(() => undefined);
      },
    });
    await system.start();

    expect(seen.get).toBe(0);
    expect(seen.has).toBe(true);
    expect(seen.hasNot).toBe(false);
    expect((seen.all as any).name).toBe("alice");
    expect(seen.batched).toBe(1);
    expect(seen.unsubscribe).toBe("function");
    expect(seen.unsubscribeAll).toBe("function");
    expect(error).not.toHaveBeenCalled();
    await system.destroy();
  });

  it("a write through the store behind facts is refused", async () => {
    const { error } = quiet();
    const system = build({
      s: (facts: any) => {
        void facts.flag;
        facts.$store.set("count", 5);
      },
      d: (facts: any) => {
        void facts.flag;
        facts.$store.delete("name");
      },
    });
    await system.start();

    expect(system.facts.count).toBe(0);
    expect(system.facts.name).toBe("alice");
    expect(error).toHaveBeenCalledTimes(2);
    await system.destroy();
  });

  it("a read of every kind leaves the facts alone", async () => {
    quiet();
    let keys: string[] = [];
    const system = build({
      r: (facts: any) => {
        keys = Object.keys(facts).sort();
        void ("count" in facts);
      },
    });
    await system.start();

    expect(system.facts.count).toBe(0);
    expect(keys.length).toBeGreaterThan(0);
    await system.destroy();
  });
});

describe("enabling and disabling effects", () => {
  it("a disabled effect does not run at start, and runs again once enabled", async () => {
    const ran: string[] = [];
    const system = build({
      a: (facts: any) => void ran.push(`a${facts.count}`),
      b: (facts: any) => void ran.push(`b${facts.count}`),
    });
    system.effects.disable("a");
    await system.start();

    expect(ran).toContain("b0");
    expect(ran).not.toContain("a0");
    expect(system.effects.isEnabled("a")).toBe(false);
    expect(system.effects.isEnabled("b")).toBe(true);

    system.effects.enable("a");
    expect(system.effects.isEnabled("a")).toBe(true);
    await bump(system, "count", 1);
    expect(ran).toContain("a1");
    await system.destroy();
  });

  it("a disabled effect stays quiet through changes, and sees the latest value once enabled", async () => {
    const ran: number[] = [];
    const system = build({
      e: (facts: any) => void ran.push(facts.count),
    });
    await system.start();
    system.effects.disable("e");
    await bump(system, "count", 1);
    expect(ran).toEqual([0]);

    system.effects.enable("e");
    await bump(system, "count", 2);
    expect(ran[ran.length - 1]).toBe(2);
    await system.destroy();
  });

  it("an effect disabled by an earlier one in the same pass does not run", async () => {
    const ran: string[] = [];
    const holder: { sys?: any } = {};
    const system = build({
      first: (facts: any) => {
        void facts.count;
        ran.push("first");
        if (facts.count > 0) {
          holder.sys.effects.disable("second");
        }
      },
      second: (facts: any) => {
        void facts.count;
        ran.push("second");
      },
    });
    holder.sys = system;
    await system.start();
    ran.length = 0;
    await bump(system, "count", 1);

    expect(ran).toEqual(["first"]);
    await system.destroy();
  });

  it("a disabled effect that read a derivation sees its new value when enabled", async () => {
    const ran: number[] = [];
    const system = build({
      e: (facts: any, _prev: any, derived: any) =>
        void ran.push(derived.doubled),
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
});

describe("async effects that read nothing before their first await", () => {
  it("warns once per effect, and not for pre-await reads or sync effects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = build({
      bare: {
        run: async () => {
          await Promise.resolve();
        },
      },
      reads: {
        run: async (facts: any) => {
          void facts.count;
          await Promise.resolve();
        },
      },
      sync: { run: () => {} },
    });
    await system.start();
    await bump(system, "count", 1);
    await flush();
    const msgs = warn.mock.calls.map((c) => String(c[0]));

    expect(msgs.filter((m) => m.includes('"bare"'))).toHaveLength(1);
    expect(msgs.filter((m) => /"(reads|sync)"/.test(m))).toHaveLength(0);
    expect(msgs.find((m) => m.includes('"bare"'))).toContain(
      "recorded no dependencies",
    );
    await system.destroy();
  });
});
