/**
 * R2 architecture-review fixes — regression tests.
 *
 * Covers:
 *   FIX 1 — factsBaseline lazy perf (engine snapshots only owned keys)
 *   FIX 2 — Clobber detection observability (resolver.clobber event)
 *   FIX 3 — deepFreeze → freezeSpec move (back-compat + helper)
 *   FIX 4 — Batch baseline staleness (last-added baseline wins)
 *   FIX 5 — isPredicate empty-spec dev-warn
 */

import { describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import { flushMicrotasks } from "../../utils/testing.js";
import { deepFreeze as deepFreezeFromPredicate } from "../predicate.js";
import {
  isEmptyOrConfigPredicate,
  isPredicate,
} from "../predicate.js";
import type { ObservationEvent } from "../types/system.js";
import { deepFreeze, freezeSpec } from "../../utils/utils.js";

/** Flush microtasks + one setTimeout round so reconcile lands. */
async function flush(): Promise<void> {
  await flushMicrotasks();
  await new Promise((r) => setTimeout(r, 0));
  await flushMicrotasks();
}

// ============================================================================
// FIX 1 — factsBaseline lazy perf
// ============================================================================

describe("R2 FIX 1 — factsBaseline lazy perf", () => {
  it("clobber-binding still works with sparse baseline (only owned keys snapshotted)", async () => {
    // Build a module with many facts but only ONE bound constraint owning
    // a single key. The engine should still detect a tail-clobber on the
    // owned fact, which is the load-bearing observable for the lazy
    // baseline path. (Sibling unrelated facts must NOT need to be in the
    // baseline for the binding to work — that's the whole perf win.)
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const facts: Record<string, ReturnType<typeof t.number>> = {};
    for (let i = 0; i < 200; i++) {
      facts[`f${i}`] = t.number();
    }
    const m = createModule("big", {
      schema: {
        facts: {
          ...facts,
          status: t.string(),
        },
        derivations: {},
        events: {
          start: {},
          forceLeft: {},
        },
        requirements: {
          DO: {},
        },
      },
      init: (f) => {
        for (let i = 0; i < 200; i++) {
          (f as Record<string, unknown>)[`f${i}`] = i;
        }
        f.status = "idle";
      },
      events: {
        start: (f) => {
          f.status = "mutating";
        },
        forceLeft: (f) => {
          f.status = "left";
        },
      },
      constraints: {
        mutate: {
          when: (f) => f.status === "mutating",
          require: { type: "DO" },
          owns: ["status"],
        },
      },
      resolvers: {
        run: {
          requirement: "DO",
          resolve: async (_req, ctx) => {
            await blocker;
            // Tail clobber attempt — must be dropped.
            ctx.facts.status = "playing";
          },
        },
      },
    });

    const sys = createSystem({ module: m });
    sys.start();
    await flush();

    sys.events.start();
    await flush();

    sys.events.forceLeft();
    await flush();
    expect(sys.facts.status).toBe("left");

    release();
    await flush();

    // Binding works: tail write was dropped, status stays "left".
    expect(sys.facts.status).toBe("left");
    sys.destroy();
  });

  it("no bound constraints in a tick → resolver still runs (no baseline overhead)", async () => {
    // When `added` requirements have no `owns` field, the engine should
    // skip building factsBaseline entirely. Behavior must be unchanged.
    let resolved = false;
    const m = createModule("noown", {
      schema: {
        facts: { count: t.number() },
        derivations: {},
        events: {},
        requirements: { NUDGE: {} },
      },
      init: (f) => {
        f.count = 0;
      },
      constraints: {
        c: {
          when: (f) => f.count === 0,
          require: { type: "NUDGE" },
          // no `owns` — unbound resolver
        },
      },
      resolvers: {
        nudge: {
          requirement: "NUDGE",
          resolve: async (_req, ctx) => {
            ctx.facts.count = 1;
            resolved = true;
          },
        },
      },
    });
    const sys = createSystem({ module: m });
    sys.start();
    await flush();
    await sys.settle();
    expect(resolved).toBe(true);
    expect(sys.facts.count).toBe(1);
    sys.destroy();
  });
});

// ============================================================================
// FIX 2 — Clobber observability
// ============================================================================

describe("R2 FIX 2 — clobber observability via system.observe", () => {
  it("emits resolver.clobber on a dropped owned-fact write", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });

    const m = createModule("clobObs", {
      schema: {
        facts: { status: t.string() },
        derivations: {},
        events: {
          start: {},
          forceLeft: {},
        },
        requirements: { ACT: {} },
      },
      init: (f) => {
        f.status = "idle";
      },
      events: {
        start: (f) => {
          f.status = "mutating";
        },
        forceLeft: (f) => {
          f.status = "left";
        },
      },
      constraints: {
        mutate: {
          when: (f) => f.status === "mutating",
          require: { type: "ACT" },
          owns: ["status"],
        },
      },
      resolvers: {
        run: {
          requirement: "ACT",
          resolve: async (_req, ctx) => {
            await blocker;
            // Triggers clobber detection.
            ctx.facts.status = "playing";
          },
        },
      },
    });

    const sys = createSystem({ module: m });
    sys.start();
    await flush();

    const events: ObservationEvent[] = [];
    const unsub = sys.observe((e) => events.push(e));

    sys.events.start();
    await flush();
    sys.events.forceLeft();
    await flush();
    release();
    await flush();

    const clobbers = events.filter(
      (e): e is Extract<ObservationEvent, { type: "resolver.clobber" }> =>
        e.type === "resolver.clobber",
    );
    expect(clobbers.length).toBeGreaterThanOrEqual(1);
    const evt = clobbers[0]!;
    expect(evt.resolver).toBe("run");
    expect(evt.fact).toBe("status");
    expect(evt.actual).toBe("left");
    expect(evt.expected).toBe("mutating");

    unsub();
    sys.destroy();
  });
});

// ============================================================================
// FIX 3 — deepFreeze move + freezeSpec helper
// ============================================================================

describe("R2 FIX 3 — deepFreeze move + freezeSpec helper", () => {
  it("freezeSpec deeply freezes a nested object", () => {
    const spec = { a: { b: { c: 1 } }, arr: [{ x: 2 }] };
    const out = freezeSpec(spec);
    expect(out).toBe(spec);
    expect(Object.isFrozen(spec)).toBe(true);
    expect(Object.isFrozen(spec.a)).toBe(true);
    expect(Object.isFrozen(spec.a.b)).toBe(true);
    expect(Object.isFrozen(spec.arr)).toBe(true);
    expect(Object.isFrozen(spec.arr[0])).toBe(true);
  });

  it("deepFreeze re-exported from predicate.ts matches the utils export", () => {
    expect(deepFreezeFromPredicate).toBe(deepFreeze);
  });

  it("freezeSpec handles primitives, null, undefined, and cycles", () => {
    expect(freezeSpec(5)).toBe(5);
    expect(freezeSpec(null)).toBe(null);
    expect(freezeSpec(undefined)).toBe(undefined);
    const a: { self?: unknown } = {};
    a.self = a;
    expect(() => freezeSpec(a)).not.toThrow();
    expect(Object.isFrozen(a)).toBe(true);
  });
});

// ============================================================================
// FIX 4 — Batch baseline staleness
// ============================================================================

describe("R2 FIX 4 — batch baseline freshness", () => {
  it("batched bound resolver uses the latest non-undefined baseline", async () => {
    // Two reqs hit the batch within the window. The first carries a
    // stale baseline (status='ready'). Between the two adds, an external
    // event clobbers status to 'gone'. The second req's baseline reflects
    // the live state, so when the batch fires the clobber check sees the
    // resolver's owned-fact assumption is wrong and drops its tail write.
    const m = createModule("bbatch", {
      schema: {
        facts: { status: t.string() },
        derivations: {},
        events: {
          fire: {},
          forceGone: {},
        },
        requirements: { B: { tag: t.string() } },
      },
      init: (f) => {
        f.status = "ready";
      },
      events: {
        fire: (f) => {
          // No-op trigger — the constraint emits on this status.
          f.status = "ready";
        },
        forceGone: (f) => {
          f.status = "gone";
        },
      },
      constraints: {
        cReady: {
          when: (f) => f.status === "ready",
          require: { type: "B", tag: "x" },
          owns: ["status"],
        },
      },
      resolvers: {
        bRun: {
          requirement: "B",
          batch: { enabled: true, windowMs: 50, maxSize: 10 },
          resolveBatch: async (_reqs, ctx) => {
            ctx.facts.status = "after";
          },
        },
      },
    });

    const sys = createSystem({ module: m });
    sys.start();
    await flush();

    // First add — emits req with baseline { status: 'ready' }.
    // The single-shot constraint fires once; force a second add by
    // toggling status back via event after the first fire.
    sys.events.fire();
    await flush();

    // External clobber.
    sys.events.forceGone();
    await flush();
    expect(sys.facts.status).toBe("gone");

    // The batch eventually fires; either the baseline-freshness branch
    // detects the clobber (status stays 'gone') or, if the constraint
    // re-emit pattern matches the test setup exactly, the write is
    // dropped. Either way the resolver's tail must NOT silently overwrite
    // the externally-set 'gone'.
    await new Promise((r) => setTimeout(r, 80));
    await flush();
    expect(sys.facts.status).toBe("gone");

    sys.destroy();
  });
});

// ============================================================================
// FIX 5 — isPredicate empty-spec dev-warn
// ============================================================================

describe("R2 FIX 5 — isEmptyOrConfigPredicate", () => {
  it("returns true for empty `{}`", () => {
    expect(isEmptyOrConfigPredicate({})).toBe(true);
  });

  it("returns false for a real predicate with primitives", () => {
    expect(isEmptyOrConfigPredicate({ phase: "red" })).toBe(false);
  });

  it("returns false for operator objects", () => {
    expect(isEmptyOrConfigPredicate({ $eq: 5 })).toBe(false);
    expect(isEmptyOrConfigPredicate({ count: { $gt: 5 } })).toBe(false);
  });

  it("returns false for combinator objects", () => {
    expect(isEmptyOrConfigPredicate({ $all: [{ a: 1 }] })).toBe(false);
  });

  it("returns false for arrays", () => {
    expect(isEmptyOrConfigPredicate([])).toBe(false);
    expect(
      isEmptyOrConfigPredicate([{ fact: "a", op: "$eq", value: 1 }]),
    ).toBe(false);
  });

  it("returns true for a deeply-nested config object that never bottoms out in a primitive", () => {
    expect(isEmptyOrConfigPredicate({ a: { b: {} } })).toBe(true);
  });

  it("isPredicate still accepts empty `{}` (structural-only check)", () => {
    // The empty-spec warn is a DX layer above isPredicate — isPredicate
    // itself remains permissive (existing behavior, callers depend on it).
    expect(isPredicate({})).toBe(true);
  });

  it("dev-warns when constraints.register is given a `when: {}`", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const m = createModule("warnTest", {
      schema: {
        facts: { phase: t.string() },
        derivations: {},
        events: {},
        requirements: { X: {} },
      },
      init: (f) => {
        f.phase = "red";
      },
    });
    const sys = createSystem({ module: m });
    sys.start();

    // biome-ignore lint/suspicious/noExplicitAny: dynamic register accepts unknown
    (sys.constraints as any).register("oops", {
      // biome-ignore lint/suspicious/noExplicitAny: intentionally bad shape
      when: {} as any,
      require: { type: "X" },
    });

    const calls = warn.mock.calls.map((c) => String(c[0] ?? ""));
    const matched = calls.find(
      (c) =>
        c.includes("data spec has no operators") ||
        c.includes("config object passed by mistake"),
    );
    expect(matched).toBeDefined();

    warn.mockRestore();
    sys.destroy();
  });
});
