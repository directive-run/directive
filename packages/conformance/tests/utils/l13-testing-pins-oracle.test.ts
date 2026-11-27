// Ported from packages/core/src/utils/__tests__/l13-testing-pins-oracle.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import {
  assertDynamic,
  assertNotDynamic,
  createFakeTimers,
  createTestSystem,
  mockResolver,
  settleWithFakeTimers,
} from "@directive-run/core/testing";
import { describe, expect, it, vi } from "vitest";

// The L13 RFC's probe pins for /testing (development): U1 to U9. Each pins
// 1.35's behaviour. U1, U2 and U3 are where the rows (bz), (ca) and (cb)
// live: (bz) is approved (L13a signs it), (ca) and (cb) are declined, so U2
// and U3 pin 1.35 for good and U1 pins 1.35 until (bz)'s entry is signed.
// U10 to U12 are the /adapter-utils pins and U13 to U15 the worker's; U16
// and U17 are diff scenarios ("L13 pins").

/** A counter with a constraint that asks for LOAD once `go` is true. */
function counter() {
  return createModule("counter", {
    schema: {
      facts: { n: t.number(), go: t.boolean() },
      derivations: { double: t.number() },
      events: { inc: {} },
      requirements: { LOAD: {} },
    },
    init: (facts: any) => {
      facts.n = 0;
      facts.go = false;
    },
    derive: { double: (facts: any) => facts.n * 2 },
    events: {
      inc: (facts: any) => {
        facts.n = facts.n + 1;
      },
    },
    constraints: {
      load: {
        when: (facts: any) => facts.go,
        require: { type: "LOAD" },
      },
    },
    resolvers: {
      LOAD: {
        requirement: "LOAD",
        resolve: async (_req: any, ctx: any) => {
          ctx.facts.n = 99;
        },
      },
    },
  } as never);
}

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function single(extra: Record<string, unknown> = {}): any {
  return createTestSystem({
    module: counter(),
    mocks: { resolvers: { LOAD: {} } },
    ...extra,
  } as never);
}

function message(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }

  return "did not throw";
}

describe("L13 probe pins: /testing (development)", () => {
  it("U1: start() works on a test system: the constraint fires and the mock resolver runs", async () => {
    const ts = single();

    ts.start();
    ts.facts.go = true;
    await ts.settle();
    ts.assertResolverCalled("LOAD", 1);
    expect(ts.facts.n).toBe(0);
    ts.destroy();
  });

  it("U1: a test system's isRunning, isInitialized and isSettled keep their creation values after start() (shows bz)", async () => {
    const ts = single();

    expect([ts.isRunning, ts.isInitialized, ts.isSettled]).toEqual([
      false,
      false,
      true,
    ]);
    ts.start();
    ts.facts.go = true;
    // read after start() and before settle(): still the creation values
    expect([ts.isRunning, ts.isInitialized, ts.isSettled]).toEqual([
      false,
      false,
      true,
    ]);
    await ts.settle();
    // The flags were read once, when the object was spread.
    expect([ts.isRunning, ts.isInitialized, ts.isSettled]).toEqual([
      false,
      false,
      true,
    ]);
    ts.destroy();
  });

  it("U1: a namespaced test system's flags are frozen the same way (shows bz)", async () => {
    const ts = createTestSystem({
      modules: { counter: counter() },
      mocks: { resolvers: { LOAD: {} } },
    } as never) as any;

    const read = () => [ts.isRunning, ts.isInitialized, ts.isSettled];
    const before = read();
    ts.start();
    ts.facts.counter.go = true;
    expect(read()).toEqual(before);
    await ts.settle();
    expect(read()).toEqual(before);
    expect(before).toEqual([false, false, true]);
    ts.destroy();
  });

  it("U2: eventHistory records dispatch only; events.* changes the fact and is not recorded (shows ca)", () => {
    const ts = single();
    ts.start();
    ts.dispatch({ type: "inc" });
    ts.events.inc();
    ts.events.inc();

    expect(ts.facts.n).toBe(3);
    expect(ts.eventHistory).toEqual([{ type: "inc" }]);
    ts.destroy();
  });

  it("U3: createFakeTimers has no way to add a timer: advance, next and runAll only move the clock (shows cb)", async () => {
    const timers: any = createFakeTimers();
    expect(Object.keys(timers).sort()).toEqual([
      "advance",
      "next",
      "now",
      "reset",
      "runAll",
    ]);
    let fired = 0;
    const real = setTimeout(() => {
      fired++;
    }, 5);

    expect(timers.now()).toBe(0);
    await timers.advance(1000);
    expect(timers.now()).toBe(1000);
    await timers.next();
    await timers.runAll();
    expect(timers.now()).toBe(1000);
    expect(fired).toBe(0);
    await wait(10);
    // only real time fired the real timer
    expect(fired).toBe(1);
    clearTimeout(real);
    timers.reset();
    expect(timers.now()).toBe(0);
  });

  it("U4: settleWithFakeTimers throws its message, naming the in-flight resolvers, when time runs out", async () => {
    const mod = createModule("slow", {
      schema: {
        facts: { go: t.boolean() },
        derivations: {},
        events: {},
        requirements: { SLOW: {} },
      },
      init: (facts: any) => {
        facts.go = true;
      },
      constraints: {
        slow: { when: (facts: any) => facts.go, require: { type: "SLOW" } },
      },
      resolvers: {
        SLOW: {
          requirement: "SLOW",
          resolve: () => new Promise<void>(() => {}),
        },
      },
    } as never);
    const system = createSystem({ module: mod } as never) as any;
    system.start();
    let advanced = 0;
    const error = await settleWithFakeTimers(
      system,
      (ms) => {
        advanced += ms;
      },
      { totalTime: 100, stepSize: 10 },
    ).then(
      () => null,
      (e: Error) => e,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toMatch(
      /^\[Directive\] settleWithFakeTimers did not settle after 100ms\. 1 resolvers still inflight: .*SLOW/,
    );
    expect(advanced).toBe(100);
    system.destroy();
  });

  it("U4: settleWithFakeTimers returns at once when nothing is in flight, advancing nothing", async () => {
    const system = createSystem({ module: counter() } as never) as any;
    system.start();
    let advanced = 0;
    await settleWithFakeTimers(system, (ms) => {
      advanced += ms;
    });

    expect(advanced).toBe(0);
    system.destroy();
  });

  it("U5: mockResolver's calls and pending are plain properties holding the live arrays", async () => {
    const mock: any = mockResolver("LOAD");
    const ts = createTestSystem({
      module: counter(),
      mocks: { resolvers: { LOAD: { resolve: mock.handler } } },
    } as never) as any;
    ts.start();
    ts.facts.go = true;
    await wait();

    expect(Object.getOwnPropertyDescriptor(mock, "calls")?.get).toBe(undefined);
    expect(mock.calls).toHaveLength(1);
    expect(mock.pending).toHaveLength(1);
    const liveCalls = mock.calls;
    const livePending = mock.pending;
    mock.resolve();
    await wait();
    expect(mock.pending).toHaveLength(0);
    // the same arrays, emptied in place
    expect(mock.pending).toBe(livePending);
    expect(mock.calls).toBe(liveCalls);
    expect(mock.calls).toHaveLength(1);
    mock.reset();
    expect(liveCalls).toHaveLength(0);
    ts.destroy();
  });

  it("U6: the init write is the first getFactsHistory() row", () => {
    const ts = single();
    ts.start();
    const rows = ts.getFactsHistory();

    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].key).toBe("n");
    expect(rows[0].newValue).toBe(0);
    expect(rows[1].key).toBe("go");
    ts.facts.n = 5;
    expect(ts.getFactsHistory().at(-1)).toMatchObject({
      key: "n",
      previousValue: 0,
      newValue: 5,
    });
    ts.resetFactsHistory();
    expect(ts.getFactsHistory()).toEqual([]);
    ts.destroy();
  });

  it("U7: assertFactSet(key, undefined) passes for any write of the key", () => {
    const ts = single();
    ts.start();
    ts.facts.n = 7;

    expect(() => ts.assertFactSet("n", undefined)).not.toThrow();
    expect(() => ts.assertFactSet("n")).not.toThrow();
    expect(() => ts.assertFactSet("n", 7)).not.toThrow();
    expect(message(() => ts.assertFactSet("n", 8))).toMatch(
      /^\[Directive\] Expected fact "n" to be set to 8 but got: /,
    );
    expect(message(() => ts.assertFactSet("nope"))).toBe(
      '[Directive] Expected fact "nope" to be set but it was not',
    );
    expect(message(() => ts.assertFactChanges("n", 99))).toMatch(
      /^\[Directive\] Expected fact "n" to change 99 times but it changed \d+ times$/,
    );
    ts.destroy();
  });

  it("U8: a namespaced test system records the module as the namespace and matches a short or a full key", () => {
    // The RFC's construction (a fact named "a::b") is refused by the schema:
    // keys may not contain "::". So the split is pinned where it can be seen.
    const mod = (name: string) =>
      createModule(name, {
        schema: {
          facts: { c: t.number() },
          derivations: {},
          events: {},
          requirements: {},
        },
        init: (facts: any) => {
          facts.c = 0;
        },
      } as never);
    const ts = createTestSystem({
      modules: { m: mod("m"), o: mod("o") },
    } as never) as any;
    ts.start();
    ts.facts.m.c = 4;
    ts.facts.o.c = 5;
    const rows = ts.getFactsHistory();
    const m = rows.find((r: any) => r.newValue === 4);
    const o = rows.find((r: any) => r.newValue === 5);

    expect(m).toMatchObject({ namespace: "m", key: "c", fullKey: "m::c" });
    expect(o).toMatchObject({ namespace: "o", key: "c", fullKey: "o::c" });
    expect(() => ts.assertFactSet("c", 4)).not.toThrow();
    expect(() => ts.assertFactSet("m::c", 4)).not.toThrow();
    expect(message(() => ts.assertFactSet("m::c", 5))).toMatch(
      /^\[Directive\] Expected fact "m::c" to be set to 5 but got: /,
    );
    // the short key counts both modules' writes (two inits and two writes)
    expect(() => ts.assertFactChanges("c", 4)).not.toThrow();
    expect(() => ts.assertFactChanges("m::c", 2)).not.toThrow();
    ts.destroy();
  });

  it("U8: a module registered after creation is not a known namespace, so its key keeps the whole name and no namespace", () => {
    const ts = createTestSystem({
      modules: {
        m: createModule("m", {
          schema: {
            facts: { c: t.number() },
            derivations: {},
            events: {},
            requirements: {},
          },
          init: (facts: any) => {
            facts.c = 0;
          },
        } as never),
      },
    } as never) as any;
    ts.start();
    ts.registerModule(
      "late",
      createModule("late", {
        schema: {
          facts: { c: t.number() },
          derivations: {},
          events: {},
          requirements: {},
        },
        init: (facts: any) => {
          facts.c = 0;
        },
      } as never),
    );
    ts.facts.late.c = 9;
    const row = ts.getFactsHistory().find((r: any) => r.newValue === 9);

    expect(row).toMatchObject({ key: "late::c", fullKey: "late::c" });
    expect(row.namespace).toBeUndefined();
    expect(message(() => ts.assertFactSet("c", 9))).toMatch(
      /^\[Directive\] Expected fact "c" to be set to 9 but got: /,
    );
    expect(() => ts.assertFactSet("late::c", 9)).not.toThrow();
    ts.destroy();
  });

  it("U9: assertDynamic and assertNotDynamic switch over the four registries, with their messages", () => {
    const system = createSystem({ module: counter() } as never) as any;
    system.start();
    const kinds = ["constraint", "resolver", "derivation", "effect"] as const;
    const ids = {
      constraint: "load",
      resolver: "LOAD",
      derivation: "double",
      effect: "nothing",
    };

    for (const kind of kinds) {
      expect(() => assertNotDynamic(system, kind, ids[kind])).not.toThrow();
      expect(message(() => assertDynamic(system, kind, ids[kind]))).toBe(
        `[Directive] Expected ${kind} "${ids[kind]}" to be dynamic, but it is not.`,
      );
    }
    const stub: any = {};
    const calls: string[] = [];
    for (const registry of ["constraints", "resolvers", "derive", "effects"]) {
      stub[registry] = {
        isDynamic: (id: string) => {
          calls.push(`${registry}:${id}`);

          return true;
        },
      };
    }
    for (const kind of kinds) {
      assertDynamic(stub, kind, "x");
      expect(message(() => assertNotDynamic(stub, kind, "x"))).toBe(
        `[Directive] Expected ${kind} "x" to NOT be dynamic, but it is.`,
      );
    }
    expect(calls.filter((_c, i) => i % 2 === 0)).toEqual([
      "constraints:x",
      "resolvers:x",
      "derive:x",
      "effects:x",
    ]);
    system.destroy();
  });
});

describe("L13 probe pins: the spread keeps what the system defines", () => {
  it("a test system has the system's own enumerable keys, plus its own members", () => {
    const ts = single();
    const system = createSystem({ module: counter() } as never) as any;
    const extra = [
      "eventHistory",
      "resolverCalls",
      "allRequirements",
      "getFactsHistory",
      "resetFactsHistory",
      "waitForIdle",
      "assertRequirement",
      "assertResolverCalled",
      "assertFactSet",
      "assertFactChanges",
    ];

    expect(Object.keys(ts).sort()).toEqual(
      [...new Set([...Object.keys(system), ...extra])].sort(),
    );
    ts.destroy();
    system.destroy();
    vi.restoreAllMocks();
  });
});
