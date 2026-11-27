/**
 * L13a: `/testing` (T2 to T10 of the L13 RFC) and `/internals`
 * `safeStringify`, on core-next's own source. The conformance suite holds
 * 1.35's tests and pins (`testing`, `testing-utils`,
 * `testing-sees-batched-writes`, U1 to U9); this file is 2.0's side of row
 * (bz), the one approved difference, and the members it must leave alone.
 */
import { describe, expect, it, vi } from "vitest";
import { createModule } from "../api/core.js";
import { safeStringify as factsSafeStringify } from "../api/facts.js";
import { t } from "../api/schema-builders.js";
import { safeStringify } from "../internals.js";
import {
  createCoverageTracker,
  createTestObserver,
  createTestSystem,
  flushAsync,
  mockResolver,
  settleWithFakeTimers,
} from "../utils/testing.js";

const counter = () =>
  createModule("counter", {
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
      load: { when: (facts: any) => facts.go, require: { type: "LOAD" } },
    },
    resolvers: {
      LOAD: { requirement: "LOAD", resolve: async () => {} },
    },
  } as never);

const flags = (ts: any) => [ts.isRunning, ts.isInitialized, ts.isSettled];

describe.each(["single", "namespaced"])("row (bz), %s test system", (form) => {
  const build = (mocks: Record<string, unknown> = { LOAD: {} }): any =>
    createTestSystem(
      (form === "single"
        ? { module: counter(), mocks: { resolvers: mocks } }
        : {
            modules: { counter: counter() },
            mocks: { resolvers: mocks },
          }) as never,
    );
  const facts = (ts: any) => (form === "single" ? ts.facts : ts.facts.counter);

  it("isRunning, isInitialized and isSettled read the live system", async () => {
    const pending = mockResolver("LOAD");
    const ts = build({ LOAD: { resolve: pending.handler } });

    // 1.35's creation values.
    expect(flags(ts)).toEqual([false, false, true]);
    ts.start();
    expect([ts.isRunning, ts.isInitialized]).toEqual([true, true]);
    await ts.settle();
    expect(flags(ts)).toEqual([true, true, true]);
    facts(ts).go = true;
    await flushAsync();
    // The resolver is held open: 1.35 would still read true here.
    expect(pending.pending).toHaveLength(1);
    expect(ts.isSettled).toBe(false);
    pending.resolve();
    await ts.settle();
    expect(flags(ts)).toEqual([true, true, true]);
    ts.stop();
    expect(ts.isRunning).toBe(false);
    ts.destroy();
  });

  it("the three stay own enumerable members, as the spread left them, and cannot be assigned", () => {
    const ts = build();

    for (const flag of ["isRunning", "isInitialized", "isSettled"]) {
      const own = Object.getOwnPropertyDescriptor(ts, flag);
      expect(typeof own?.get, flag).toBe("function");
      expect(own?.set, flag).toBeUndefined();
      expect(own?.enumerable, flag).toBe(true);
    }
    // A copy of a test system is a snapshot again, as any spread is.
    expect(flags({ ...ts })).toEqual([false, false, true]);
    ts.destroy();
  });

  it("the row covers those three only: every other member is 1.35's spread", () => {
    const ts = build();
    const keys = Object.keys(ts);
    const ready = ts.isReady;

    ts.start();
    // 1.35: isReady and trace are read once, when the object is spread.
    expect(Object.getOwnPropertyDescriptor(ts, "isReady")?.get).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(ts, "trace")?.get).toBeUndefined();
    expect(ts.isReady).toBe(ready);
    // No member is added or dropped by the getters.
    expect(Object.keys(ts)).toEqual(keys);
    ts.destroy();
  });

  it("eventHistory still records dispatch only (row (ca), declined)", () => {
    const ts = build();

    const type = form === "single" ? "inc" : "counter::inc";

    ts.start();
    ts.dispatch({ type });
    (form === "single" ? ts.events : ts.events.counter).inc();
    expect(facts(ts).n).toBe(2);
    expect(ts.eventHistory).toEqual([{ type }]);
    ts.destroy();
  });
});

describe("/testing on core-next's hooks", () => {
  it("the coverage tracker and the observer read observe() and inspect()", async () => {
    const ts: any = createTestSystem({
      module: counter(),
      mocks: { resolvers: { LOAD: {} } },
    } as never);
    const coverage = createCoverageTracker(ts);
    const observer = createTestObserver(ts);

    ts.start();
    await coverage.run(async () => {
      ts.facts.go = true;
      await ts.settle();
    });
    const report = coverage.report();
    expect([...report.constraintsHit]).toEqual(["load"]);
    expect(report.constraintCoverage).toBe(1);
    expect(report.resolverCoverage).toBe(1);
    expect(observer.ofType("fact.change").map((e: any) => e.key)).toContain(
      "go",
    );
    observer.dispose();
    ts.destroy();
  });

  it("settleWithFakeTimers names the resolvers still in flight", async () => {
    const pending = mockResolver("LOAD");
    const ts: any = createTestSystem({
      module: counter(),
      mocks: { resolvers: { LOAD: { resolve: pending.handler } } },
    } as never);

    ts.start();
    ts.facts.go = true;
    await expect(
      settleWithFakeTimers(ts, () => {}, { totalTime: 30, stepSize: 10 }),
    ).rejects.toThrow(
      "[Directive] settleWithFakeTimers did not settle after 30ms. 1 resolvers still inflight: LOAD",
    );
    pending.resolve();
    await ts.settle();
    ts.destroy();
  });

  it("the facts history is capped, with one warning per test system", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ts: any = createTestSystem({
      module: counter(),
      maxFactsHistory: 3,
    } as never);

    ts.start();
    for (let i = 1; i <= 5; i++) {
      ts.facts.n = i;
    }
    expect(ts.getFactsHistory().map((r: any) => r.newValue)).toEqual([3, 4, 5]);
    expect(
      warn.mock.calls.filter((args) =>
        String(args[0]).includes("createTestSystem: kept the most recent 3"),
      ),
    ).toHaveLength(1);
    warn.mockRestore();
    ts.destroy();
  });
});

describe("/internals safeStringify (IN1)", () => {
  it("is the one function the facts store uses", () => {
    expect(safeStringify).toBe(factsSafeStringify);
  });

  it("prints bigint, undefined, a cycle and a long value as 1.35 does", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;

    expect(safeStringify({ a: 1n })).toBe('{\n  "a": "1n"\n}');
    expect(safeStringify(undefined)).toBe("[undefined]");
    expect(safeStringify(cycle)).toBe("[unserializable]");
    expect(safeStringify("x".repeat(20), 10)).toBe(
      `${'"xxxxxxxxx'}\n... (truncated, 22 chars total)`,
    );
  });
});
