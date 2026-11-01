/**
 * L4b: quirk (c) with (w), the reusable dependency sets (T1) and the effect
 * index (T2). See docs/rfc-l4-effects.md (p4/l4-rfc): "Quirk (c)", "Skip-
 * tracking that works per frame", U2 and U3.
 *
 * (c), effects only: `"d" in derived` inside an effect body depends on
 * whether `d` exists, not on its value, and watches nothing. (w): a name that
 * is not a derivation does the same, so the effect waits for it to exist.
 * Constraints and derivations keep 1.35's value tracking
 * (l3f-membership-watch.test.ts).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type SystemPart,
  createModule,
  createSystemCore,
} from "../api/core.js";
import { createEffectsManager, withEffects } from "../api/effects.js";
import {
  DERIVATION_DEP_PREFIX,
  MEMBER_DEP_PREFIX,
  type Tracker,
  createFacts,
} from "../api/facts.js";
import { withReconcile } from "../api/reconcile.js";
import { t } from "../api/schema-builders.js";

const flush = () => new Promise((r) => setTimeout(r, 0));
const D = DERIVATION_DEP_PREFIX + "d";

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A system whose effects run across three `a` writes and one `b` write; the
 * log has each write, whether `d` was in that pass's changed keys, and what
 * the effects pushed. `deps` holds what each run of an effect tracked.
 */
async function trace(
  effects: (log: unknown[], tracker: () => Tracker) => Record<string, unknown>,
) {
  const log: unknown[] = [];
  let tracker: Tracker;
  const spy: SystemPart = (ctx) => {
    tracker = ctx.tracker;
    const feature = (ctx.kernel.features as any).effects;
    const original = feature.runEffectsFast;
    feature.runEffectsFast = (keys: Set<string>) => {
      log.push(keys.has(D) ? "d in pass" : "-");
      return original.call(feature, keys);
    };
  };
  const system: any = createSystemCore(
    {
      module: createModule("m", {
        schema: {
          facts: { a: t.number(), b: t.number() },
          derivations: { d: t.number(), asks: t.number() },
          events: {},
          requirements: {},
        },
        init: (f: any) => {
          f.a = 0;
          f.b = 0;
        },
        derive: {
          d: (f: any) => f.a + 1,
          asks: (_f: any, dd: any) => ("d" in dd ? 1 : 0),
        },
        effects: effects(log, () => tracker),
      } as any),
    } as any,
    [withEffects, withReconcile, spy],
  );
  system.start();
  await flush();
  for (const [key, value] of [
    ["a", 1],
    ["a", 2],
    ["a", 3],
    ["b", 1],
  ] as const) {
    log.push(`${key}=${value}`);
    system.facts[key] = value;
    await flush();
  }
  system.destroy();

  return log;
}

describe("quirk (c) and (w): an effect's membership test (U2)", () => {
  it("a membership-only effect runs once, at none of the writes, and watches nothing", async () => {
    let tracked: string[] = [];
    const log = await trace((log, tracker) => ({
      e: {
        run: (_f: any, _p: any, dd: any) => {
          log.push(["run", "d" in dd]);
          tracked = [...tracker().deps!];
        },
      },
    }));
    // 1.35 runs it at all three `a` writes: it tracks `d`'s value.
    expect(log).toEqual([
      "-",
      ["run", true],
      "a=1",
      // `d`, computed at start, goes stale once; nothing watches it after.
      "d in pass",
      "a=2",
      "-",
      "a=3",
      "-",
      "b=1",
      "-",
    ]);
    // The membership key, written out in core.ts, is MEMBER_DEP_PREFIX's.
    expect(tracked).toEqual([MEMBER_DEP_PREFIX + "d"]);
  });

  it("(w): a name that is not a derivation answers false and waits for it to exist", async () => {
    let tracked: string[] = [];
    const log = await trace((log, tracker) => ({
      e: {
        run: (_f: any, _p: any, dd: any) => {
          log.push(["run", "nope" in dd]);
          tracked = [...tracker().deps!];
        },
      },
    }));
    // 1.35 tracks nothing, so the effect runs at every write.
    expect(log).toEqual([
      "-",
      ["run", false],
      "a=1",
      // `d`, computed at start, goes stale once; nothing watches it after.
      "d in pass",
      "a=2",
      "-",
      "a=3",
      "-",
      "b=1",
      "-",
    ]);
    expect(tracked).toEqual([MEMBER_DEP_PREFIX + "nope"]);
  });

  it("a symbol is no name: it answers false and records nothing", async () => {
    const log = await trace((log) => ({
      e: {
        run: (_f: any, _p: any, dd: any) => {
          log.push(["run", Symbol.iterator in dd]);
        },
      },
    }));
    // Read nothing: it runs on every change, as in 1.35.
    expect(log.filter((x) => Array.isArray(x))).toHaveLength(5);
  });

  it("a mixed effect (membership and a value read) re-runs at every value change", async () => {
    const log = await trace((log) => ({
      e: {
        run: (_f: any, _p: any, dd: any) => {
          log.push(["run", "d" in dd, dd.d]);
        },
      },
    }));
    expect(log).toEqual([
      "-",
      ["run", true, 1],
      "a=1",
      "d in pass",
      ["run", true, 2],
      "a=2",
      "d in pass",
      ["run", true, 3],
      "a=3",
      "d in pass",
      ["run", true, 4],
      "b=1",
      "-",
    ]);
  });

  it("a derivation computed inside an effect keeps 1.35's rule for its own membership test", async () => {
    // `asks` tests "d" in its own frame: as for a constraint that reads it
    // (l3f), its reader hears every change to what `d` reads, not `b`.
    const log = await trace((log) => ({
      e: {
        run: (_f: any, _p: any, dd: any) => {
          log.push(["run", dd.asks]);
        },
      },
    }));
    expect(log).toEqual([
      "-",
      ["run", 1],
      "a=1",
      // `d`, computed at start, goes stale once; nothing watches it after.
      "d in pass",
      ["run", 1],
      "a=2",
      "-",
      ["run", 1],
      "a=3",
      "-",
      ["run", 1],
      "b=1",
      "-",
    ]);
  });
});

/** An effects manager over facts `a`, `b`, `c` with its own tracker. */
function manager(definitions: Record<string, any>) {
  const tracker: Tracker = { deps: null };
  const { store, facts } = createFacts({
    schema: { a: t.number(), b: t.number(), c: t.number() },
    tracker,
  } as any);
  store.set("a" as any, 0 as any);
  store.set("b" as any, 0 as any);
  store.set("c" as any, 0 as any);
  const m = createEffectsManager({
    definitions,
    facts,
    store,
    tracker,
    onError: () => {},
  } as any);

  return { m, tracker };
}
const keys = (...k: string[]) => new Set(k);

describe("T1: two reusable dependency sets per auto-tracked effect", () => {
  it("10,000 runs with the same reads make no set after the first two", () => {
    const sets = new Set<unknown>();
    const made = manager({
      e: {
        run: (f: any) => {
          sets.add(made.tracker.deps);
          void f.a;
        },
      },
    });
    made.m.runAll();
    for (let i = 0; i < 10_000; i++) {
      made.m.runEffectsFast(keys("a"));
    }
    expect(sets.size).toBe(2);
  });

  it("different reads swap the two sets, and selection follows the last run", () => {
    const sets = new Set<unknown>();
    const runs: string[] = [];
    let flip = false;
    const made = manager({
      e: {
        run: (f: any) => {
          sets.add(made.tracker.deps);
          flip = !flip;
          runs.push(flip ? `a${f.a}` : `b${f.b}`);
        },
      },
    });
    made.m.runAll(); // reads a
    made.m.runEffectsFast(keys("b")); // not a dependency: no run
    made.m.runEffectsFast(keys("a")); // reads b
    made.m.runEffectsFast(keys("a")); // not any more
    made.m.runEffectsFast(keys("b")); // reads a
    for (let i = 0; i < 100; i++) {
      made.m.runEffectsFast(keys("a", "b"));
    }
    expect(runs.slice(0, 3)).toEqual(["a0", "b0", "a0"]);
    expect(runs).toHaveLength(103);
    expect(sets.size).toBe(2);
  });

  it("a throwing run keeps the last good run's dependencies, and makes no set (U3)", () => {
    const sets = new Set<unknown>();
    const runs: string[] = [];
    let fail = false;
    const made = manager({
      e: {
        run: (f: any) => {
          sets.add(made.tracker.deps);
          if (fail) {
            void f.b;
            runs.push("throw");
            throw new Error("boom");
          }
          void f.a;
          runs.push("a");
        },
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    made.m.runAll(); // good: depends on a
    fail = true;
    made.m.runEffectsFast(keys("a")); // reads b, throws
    // b, which only the throwing run read, does not wake it; a does.
    made.m.runEffectsFast(keys("b"));
    made.m.runEffectsFast(keys("a"));
    fail = false;
    made.m.runEffectsFast(keys("a"));
    // Nothing of the throwing run's reads survives into the good one's set.
    made.m.runEffectsFast(keys("b"));
    made.m.runEffectsFast(keys("a"));
    expect(runs).toEqual(["a", "throw", "throw", "a", "a"]);
    expect(sets.size).toBe(2);
  });

  it("an async body depends on what it read before its first await", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runs: number[] = [];
    const made = manager({
      e: {
        run: async (f: any) => {
          runs.push(f.a);
          await null;
          void f.b;
        },
      },
    });
    await made.m.runAll();
    await made.m.runEffectsFast(keys("b"));
    await made.m.runEffectsFast(keys("a"));
    await made.m.runEffectsFast(keys("a"));
    expect(runs).toEqual([0, 0, 0]);
    // The same reads twice keep the old set: it still read something.
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("T2: the effect index", () => {
  it("runs what the changed keys reach in declaration order, plus the dependency-free", () => {
    const log: string[] = [];
    const made = manager({
      e1: { run: (f: any) => void log.push(`e1 ${f.b}`) },
      e2: { run: (f: any) => void log.push(`e2 ${f.a}`) },
      e3: { run: (f: any) => void log.push(`e3 ${f.a + f.b}`) },
      e4: { run: () => void log.push("e4") },
      e5: { deps: ["b"], run: () => void log.push("e5") },
      e6: { deps: [], run: () => void log.push("e6") },
    });
    made.m.runAll();
    log.length = 0;
    made.m.runEffectsFast(keys("b", "a"));
    expect(log).toEqual(["e1 0", "e2 0", "e3 0", "e4", "e5"]);
    log.length = 0;
    made.m.runEffectsFast(keys("a"));
    expect(log).toEqual(["e2 0", "e3 0", "e4"]);
    log.length = 0;
    // More changed keys than indexed ones: the index side is walked.
    made.m.runEffectsFast(
      keys("c", ...Array.from({ length: 20 }, (_, i) => `x${i}`), "b"),
    );
    expect(log).toEqual(["e1 0", "e3 0", "e4", "e5"]);
    log.length = 0;
    // Asked to run again: whatever changed.
    made.m.rerun_("e2");
    made.m.runEffectsFast(keys("c"));
    expect(log).toEqual(["e2 0", "e4"]);
  });

  it("an effect that moves its reads mid-pass leaves the pass and the index whole", () => {
    const log: string[] = [];
    let moved = false;
    const made = manager({
      first: {
        run: (f: any) => {
          log.push("first");
          void (moved ? f.c : f.a);
        },
      },
      second: { run: (f: any) => void log.push(`second ${f.a}`) },
    });
    made.m.runAll();
    log.length = 0;
    moved = true;
    // `first` unlinks from `a` while `second`, also on `a`, waits its turn.
    made.m.runEffectsFast(keys("a"));
    made.m.runEffectsFast(keys("a"));
    made.m.runEffectsFast(keys("c"));
    expect(log).toEqual(["first", "second 0", "second 0", "first"]);
  });

  it("a disabled effect keeps its entries and is skipped; enable needs no re-index (y)", () => {
    const log: string[] = [];
    const made = manager({
      e: { run: (f: any) => void log.push(`e ${f.a}`) },
      f: { run: (f: any) => void log.push(`f ${f.a}`) },
    });
    made.m.runAll();
    log.length = 0;
    made.m.disable("e");
    made.m.runEffectsFast(keys("a"));
    made.m.enable("e");
    made.m.runEffectsFast(keys("a"));
    made.m.runEffectsFast(keys("b"));
    expect(log).toEqual(["f 0", "e 0", "f 0"]);
  });

  it.todo(
    "L8: a navigation-only pass wakes every effect but those with onNavigate: 'skip' (history does not exist in core-next yet; `reach` marks per key set)",
  );
  it.todo(
    "L10: a declared name that comes to exist is linked into the index when it resolves (refreshDeps does not exist in core-next yet)",
  );
});
