// Ported from packages/core/src/core/__tests__/l10-gate-pins-oracle-production.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Production build: the dev flag is the constant `false`.
vi.mock("#is-development", () => ({ default: false }));

const { createModule, createSystem, t } = await import("@directive-run/core");

// The production halves of the L10 gate's pins (l10-gate-pins-oracle). Black-box pins the L10 gate adds for three paths the principal review found
// unguarded: a restore after unregisterModule, a retired resolver's write
// after the 10 s drain, and a history snapshot taken after registerModule.
// Each is what 1.35 does and what 2.0 does as built, so each passes on both
// engines; the late-write case keeps only what both share (row cd). Public
// API only.

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** Module m: a fact n and nothing else. */
function base() {
  return createModule("m", {
    schema: {
      facts: { n: t.number() },
      derivations: {},
      events: {},
      requirements: {},
    },
    init: (facts: any) => {
      facts.n = 1;
    },
  } as never);
}

/** The module registered later: a fact c, 10 at init. */
function extra(id = "x") {
  return createModule(id, {
    schema: {
      facts: { c: t.number() },
      derivations: {},
      events: {},
      requirements: {},
    },
    init: (facts: any) => {
      facts.c = 10;
    },
  } as never);
}

function logged() {
  return [
    ...vi.mocked(console.warn).mock.calls,
    ...vi.mocked(console.error).mock.calls,
  ];
}

describe("production: restore() after unregisterModule drops the retired keys silently (L10 gate)", () => {
  // 1.35's store drops a write to a retired key before it validates it
  // (core/facts.ts:521), so a restore of a snapshot taken before the
  // unregister writes the live keys and drops the retired ones, with no
  // throw and no log, in production as in development.
  it("single module: the retired key is dropped and the live one is written", async () => {
    const system = createSystem({ module: base() } as never) as any;
    system.start();
    system.registerModule(extra("c"));
    await wait();
    const snapshot = system.getSnapshot();

    expect(snapshot.facts.c).toBe(10);
    await system.unregisterModule("c");
    system.facts.n = 5;
    vi.mocked(console.warn).mockClear();
    vi.mocked(console.error).mockClear();

    expect(() => system.restore(snapshot)).not.toThrow();
    expect(system.facts.n).toBe(1);
    expect("c" in system.getSnapshot().facts).toBe(false);
    expect(logged()).toEqual([]);
    system.destroy();
  });

  it("namespaced: `x::c` is dropped after unregisterModule('x'), and `m::n` is written", async () => {
    const system = createSystem({ modules: { m: base() } } as never) as any;
    system.start();
    system.registerModule("x", extra());
    await wait();
    const snapshot = system.getSnapshot();

    expect(snapshot.facts["x::c"]).toBe(10);
    await system.unregisterModule("x");
    system.facts.m.n = 5;
    vi.mocked(console.warn).mockClear();
    vi.mocked(console.error).mockClear();

    expect(() => system.restore(snapshot)).not.toThrow();
    expect(system.facts.m.n).toBe(1);
    expect(system.facts.x).toBeUndefined();
    expect("x::c" in system.getSnapshot().facts).toBe(false);
    expect(logged()).toEqual([]);
    system.destroy();
  });
});

describe("production: a retired resolver's write after the 10 s drain (L10 gate; row cd)", () => {
  // unregisterModule waits at most 10 s for its resolvers (1.35's
  // DRAIN_TIMEOUT_MS). A resolver that ignores its abort and finishes after
  // that writes into a replacement module registered under the same name:
  // the key is declared again, so the write is not a retired one. 1.35
  // does this; 2.0 drops the write (row cd). The RFC's M7 says such a
  // write "cannot reach a replacement"; on 1.35 that holds only for a
  // write made inside the drain
  // (unregister-module "does not let a retired module's late write reach its
  // replacement", 30 ms).
  const leaky = (marker: number) =>
    createModule("leaky", {
      schema: {
        facts: { pending: t.boolean(), written: t.number() },
        derivations: {},
        events: {},
        requirements: { WORK: {} },
      },
      init: (facts: any) => {
        facts.pending = marker === 1;
        facts.written = 0;
      },
      constraints: {
        needsWork: {
          when: (facts: any) => facts.pending,
          require: { type: "WORK" },
        },
      },
      resolvers: {
        work: {
          requirement: "WORK",
          resolve: async (_req: unknown, context: any) => {
            // Ignores the abort signal and outlives the drain.
            await new Promise((resolve) => setTimeout(resolve, 15_000));
            context.facts.written = marker;
          },
        },
      },
    } as never);

  it("the drain gives up at 10 s and a same-key replacement starts from its own init", async () => {
    vi.useFakeTimers();
    const system = createSystem({
      modules: { leaky: leaky(1) },
    } as never) as any;
    system.start();
    await vi.advanceTimersByTimeAsync(0);

    let done = false;
    const unregistered = system.unregisterModule("leaky").then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(9_990);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    await unregistered;
    expect(done).toBe(true);
    expect(system.facts.leaky).toBeUndefined();

    system.registerModule("leaky", leaky(2));
    await vi.advanceTimersByTimeAsync(0);
    expect(system.facts.leaky.written).toBe(0);

    // Row (cd), approved on the owner's instruction "Approve all as
    // recommended (Recommended)", 2026-11-17: 1.35 lets the old resolver's
    // write land on the replacement (written becomes 1); 2.0 drops it. That is
    // 1.35's side only, so this case keeps what both engines share; 2.0's side
    // is pinned by core-next's l10-m7-late-write "row (cd): a retired
    // resolver's write never reaches a same-key replacement".
    await vi.advanceTimersByTimeAsync(5_000);
    system.destroy();
  });
});

describe("production: a history snapshot taken after registerModule carries the module's facts (L10 gate; the RFC's H1)", () => {
  it("registerModule's init takes a snapshot with `x::c`, and a write to it another", async () => {
    const system = createSystem({
      modules: { m: base() },
      history: true,
    } as never) as any;
    system.start();
    await system.settle();
    const before = system.history.snapshots.length;

    expect("x::c" in system.history.snapshots[before - 1].facts).toBe(false);
    system.registerModule("x", extra());
    await system.settle();
    const registered = system.history.snapshots;

    expect(registered).toHaveLength(before + 1);
    expect(registered[before].facts).toEqual({ "m::n": 1, "x::c": 10 });

    system.facts.x.c = 11;
    await system.settle();
    const written = system.history.snapshots;

    expect(written).toHaveLength(before + 2);
    expect(written[before + 1].facts).toEqual({ "m::n": 1, "x::c": 11 });
    expect(system.getSnapshot().facts["x::c"]).toBe(11);
    system.destroy();
  });

  it("goTo the registration's snapshot puts the module's fact back", async () => {
    const system = createSystem({
      modules: { m: base() },
      history: true,
    } as never) as any;
    system.start();
    await system.settle();
    system.registerModule("x", extra());
    await system.settle();
    const target = system.history.snapshots.at(-1);
    system.facts.x.c = 11;
    await system.settle();

    system.history.goTo(target.id);
    await system.settle();
    expect(system.facts.x.c).toBe(10);
    expect(system.facts.m.n).toBe(1);
    system.destroy();
  });
});
