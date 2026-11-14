import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

// Black-box pins for the gate=L8 mutation debt in 1.35's history bookkeeping
// (engine.ts: snapshot labels, the snapshotEvents filter, the per-write
// navigation record, effect passes folded into the previous snapshot, the
// navigation pass's effect wake-up, and onHistoryChange). Each pins what 1.35
// does today. Public API only. A fact write is one snapshot once its pass
// settles, so every write below is followed by `settle()`.

beforeEach(() => {
  // The effect-chain cut prints a development warning; it is not under test.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const KEYS = ["n", "m", "a", "b", "c", "y", "k1", "k2", "k3", "k4", "k5", "k6"];

interface Options {
  /** The module's `history.snapshotEvents`; omitted, every event snapshots. */
  snapshotEvents?: string[];
  /** Effects, given the system so a body can write through it. */
  effects?: (system: () => any) => Record<string, unknown>;
  /** Leave every fact unset at start. */
  noInit?: boolean;
}

/**
 * A system whose facts are all numbers (0 at start). Events: `listed` adds 1
 * to `a`, `unlisted` adds 1 to `c`, and `ping` writes nothing. A derivation
 * `d` is `n * 2`.
 */
function build(options: Options = {}) {
  const holder: { system?: any } = {};
  const facts = Object.fromEntries(KEYS.map((k) => [k, t.number()]));
  const mod = createModule("m", {
    schema: {
      facts,
      derivations: { d: t.number() },
      events: { listed: {}, unlisted: {}, ping: {} },
      requirements: {},
    },
    init: options.noInit
      ? undefined
      : (f: any) => {
          for (const k of KEYS) {
            f[k] = 0;
          }
        },
    derive: { d: (f: any) => (f.n ?? 0) * 2 },
    events: {
      listed: (f: any) => {
        f.a = (f.a ?? 0) + 1;
      },
      unlisted: (f: any) => {
        f.c = (f.c ?? 0) + 1;
      },
      ping: () => {},
    },
    effects: options.effects?.(() => holder.system),
    history: options.snapshotEvents
      ? { snapshotEvents: options.snapshotEvents }
      : undefined,
  } as never);
  const system = createSystem({
    module: mod,
    history: { maxSnapshots: 50 },
  } as never) as any;
  holder.system = system;

  return system;
}

async function started(options: Options = {}) {
  const system = build(options);
  system.start();
  await system.settle();

  return system;
}

const latest = (system: any) => system.history.snapshots.at(-1);
const triggers = (system: any) =>
  system.history.snapshots.map((s: any) => s.trigger);

describe("a snapshot's label", () => {
  it("names the keys its pass changed, up to five, then counts the rest", async () => {
    const system = await started();
    system.facts.a = 1;
    await system.settle();
    system.batch(() => {
      for (const k of ["k1", "k2", "k3", "k4", "k5"]) {
        system.facts[k] = 1;
      }
    });
    await system.settle();
    system.batch(() => {
      for (const k of ["k1", "k2", "k3", "k4", "k5", "k6"]) {
        system.facts[k] = 2;
      }
    });
    await system.settle();

    expect(triggers(system).slice(-3)).toEqual([
      "facts-changed:a",
      "facts-changed:k1,k2,k3,k4,k5",
      "facts-changed:k1,k2,k3,k4,k5+1more",
    ]);
    system.destroy();
  });
});

describe("onHistoryChange", () => {
  it("is told of each snapshot and each navigation, until it unsubscribes", async () => {
    const system = await started();
    const calls: number[] = [];
    const stop = system.onHistoryChange(() =>
      calls.push(system.history.currentIndex),
    );
    system.facts.a = 1;
    await system.settle();
    system.history.goBack();
    await system.settle();
    expect(calls).toEqual([1, 0]);

    stop();
    system.facts.a = 2;
    await system.settle();
    system.history.goBack();
    await system.settle();
    expect(calls).toEqual([1, 0]);
    system.destroy();
  });

  it("is not told of a navigation after destroy()", async () => {
    const system = await started();
    let calls = 0;
    system.onHistoryChange(() => {
      calls++;
    });
    system.facts.a = 1;
    await system.settle();
    expect(calls).toBe(1);

    system.destroy();
    system.history.goBack();
    expect(calls).toBe(1);
  });

  it("is not told of a navigation after destroyAsync()", async () => {
    const system = await started();
    let calls = 0;
    system.onHistoryChange(() => {
      calls++;
    });
    system.facts.a = 1;
    await system.settle();
    expect(calls).toBe(1);

    await system.destroyAsync();
    system.history.goBack();
    expect(calls).toBe(1);
  });

  it("a write it makes while a snapshot is taken gets a snapshot of its own", async () => {
    const system = await started();
    let once = false;
    system.onHistoryChange(() => {
      if (!once) {
        once = true;
        system.facts.b = 1;
      }
    });
    system.facts.a = 1;
    await system.settle();

    expect(triggers(system).slice(-2)).toEqual([
      "facts-changed:a",
      "facts-changed:b",
    ]);
    system.destroy();
  });
});

describe("history.snapshotEvents and writes outside an event", () => {
  it("a write inside system.batch() takes a snapshot", async () => {
    const system = await started({ snapshotEvents: ["listed"] });
    const before = system.history.snapshots.length;
    system.batch(() => {
      system.facts.y = 1;
    });
    await system.settle();

    expect(system.history.snapshots.length).toBe(before + 1);
    expect(latest(system).trigger).toBe("facts-changed:y");
    system.destroy();
  });

  it("a listener's write during an unlisted event takes no snapshot", async () => {
    const system = await started({ snapshotEvents: ["listed"] });
    system.subscribe(["c"], () => {
      system.facts.b = system.facts.c * 10;
    });
    const before = system.history.snapshots.length;
    system.dispatch({ type: "unlisted" });
    await system.settle();

    expect(system.facts.b).toBe(10);
    expect(system.history.snapshots.length).toBe(before);
    system.destroy();
  });

  it("with no fact set at start, an unlisted event takes no snapshot", async () => {
    const system = await started({ snapshotEvents: ["listed"], noInit: true });
    const before = system.history.snapshots.length;
    system.dispatch({ type: "unlisted" });
    await system.settle();

    expect(system.facts.c).toBe(1);
    expect(system.history.snapshots.length).toBe(before);
    system.destroy();
  });
});

describe("a navigation leaves no snapshot request behind", () => {
  it("an unlisted event after goBack() takes no snapshot and keeps redo", async () => {
    const system = await started({ snapshotEvents: ["listed"] });
    system.dispatch({ type: "listed" });
    await system.settle();
    system.history.goBack();
    await system.settle();
    const before = system.history.snapshots.length;
    system.dispatch({ type: "unlisted" });
    await system.settle();

    expect(system.history.snapshots.length).toBe(before);
    expect(system.history.currentIndex).toBe(before - 2);
    system.destroy();
  });

  it("nor does a listed event a listener dispatches during the rewind", async () => {
    const system = await started({ snapshotEvents: ["listed", "ping"] });
    system.dispatch({ type: "listed" });
    await system.settle();
    let armed = false;
    system.subscribe(["a"], () => {
      if (armed) {
        system.dispatch({ type: "ping" });
      }
    });
    armed = true;
    system.history.goBack();
    armed = false;
    await system.settle();
    const before = system.history.snapshots.length;
    system.dispatch({ type: "unlisted" });
    await system.settle();

    expect(system.history.snapshots.length).toBe(before);
    expect(system.history.currentIndex).toBe(before - 2);
    system.destroy();
  });
});

describe("an effect's writes fold into the snapshot of the pass that ran it", () => {
  it("an unlisted event an effect dispatches synchronously refreshes the snapshot", async () => {
    // The effect's dispatch is flushed after its handler's depth is down, so
    // its write counts as one made outside an event.
    const system = await started({
      snapshotEvents: ["listed"],
      effects: (sys) => ({
        relay: {
          deps: ["a"],
          run: (f: any) => {
            if (f.a === 1) {
              sys().dispatch({ type: "unlisted" });
            }
          },
        },
      }),
    });
    const before = system.history.snapshots.length;
    system.dispatch({ type: "listed" });
    await system.settle();

    expect(system.history.snapshots.length).toBe(before + 1);
    expect(latest(system).trigger).toBe("facts-changed:a");
    expect(latest(system).facts.c).toBe(1);
    system.destroy();
  });

  it("an unlisted event an effect dispatches after an await does not refresh it", async () => {
    const system = await started({
      snapshotEvents: ["listed"],
      effects: (sys) => ({
        relay: {
          deps: ["a"],
          run: async (f: any) => {
            if (f.a === 1) {
              await Promise.resolve();
              sys().dispatch({ type: "unlisted" });
            }
          },
        },
      }),
    });
    const before = system.history.snapshots.length;
    system.dispatch({ type: "listed" });
    await system.settle();

    expect(system.facts.c).toBe(1);
    expect(system.history.snapshots.length).toBe(before + 1);
    expect(latest(system).trigger).toBe("facts-changed:a");
    expect(latest(system).facts.a).toBe(1);
    expect(latest(system).facts.c).toBe(0);
    system.destroy();
  });

  it("an effect's own write under a filter refreshes the snapshot, not a new one", async () => {
    const system = await started({
      snapshotEvents: ["listed"],
      effects: (sys) => ({
        mirror: {
          deps: ["a"],
          run: (f: any) => {
            if (f.a > 0) {
              sys().facts.b = f.a * 10;
            }
          },
        },
      }),
    });
    const before = system.history.snapshots.length;
    system.dispatch({ type: "listed" });
    await system.settle();

    expect(system.history.snapshots.length).toBe(before + 1);
    expect(latest(system).facts.b).toBe(10);
    system.destroy();
  });

  it("after a pass that took no snapshot, an effect's write refreshes none", async () => {
    const system = await started({
      snapshotEvents: ["listed"],
      effects: (sys) => ({
        mirror: {
          deps: ["c"],
          run: (f: any) => {
            if (f.c > 0) {
              sys().facts.b = f.c * 10;
            }
          },
        },
      }),
    });
    const before = system.history.snapshots.length;
    system.dispatch({ type: "unlisted" });
    await system.settle();

    expect(system.facts.b).toBe(10);
    expect(system.history.snapshots.length).toBe(before);
    expect(latest(system).facts.c).toBe(0);
    expect(latest(system).facts.b).toBe(0);
    system.destroy();
  });

  it("a chain of two effect passes both fold into the first pass's snapshot", async () => {
    const system = await started({
      effects: (sys) => ({
        one: {
          deps: ["a"],
          run: (f: any) => {
            if (f.a > 0) {
              sys().facts.b = f.a * 10;
            }
          },
        },
        two: {
          deps: ["b"],
          run: (f: any) => {
            if (f.b > 0) {
              sys().facts.c = f.b * 10;
            }
          },
        },
      }),
    });
    const before = system.history.snapshots.length;
    system.facts.a = 1;
    await system.settle();

    expect(system.history.snapshots.length).toBe(before + 1);
    expect(latest(system).facts.b).toBe(10);
    expect(latest(system).facts.c).toBe(100);
    system.destroy();
  });

  it("an effect re-run for a navigation does not refresh the snapshot a same-tick write took", async () => {
    const system = await started({
      effects: (sys) => ({
        stamp: {
          deps: ["n"],
          run: () => {
            sys().facts.m = sys().facts.m + 1;
          },
        },
      }),
    });
    system.facts.n = 1;
    await system.settle();
    system.history.goBack();
    system.facts.y = 5;
    await system.settle();

    expect(latest(system).trigger).toBe("facts-changed:y");
    expect(latest(system).facts.n).toBe(0);
    expect(latest(system).facts.y).toBe(5);
    expect(system.facts.m).toBe(latest(system).facts.m + 1);
    system.destroy();
  });
});

describe("a batched write in the same tick as a navigation", () => {
  it("takes its snapshot", async () => {
    const system = await started();
    system.facts.n = 1;
    await system.settle();
    system.facts.n = 2;
    await system.settle();
    system.history.goBack();
    system.batch(() => {
      system.facts.y = 5;
    });
    await system.settle();

    expect(latest(system).trigger).toBe("facts-changed:y");
    expect(system.history.currentIndex).toBe(
      system.history.snapshots.length - 1,
    );
    system.destroy();
  });
});

describe("effects after a navigation", () => {
  it("an effect on a derivation re-runs with the rewound value", async () => {
    const log: number[] = [];
    const system = await started({
      effects: (sys) => ({
        view: {
          run: () => void log.push(sys().derive.d),
        },
      }),
    });
    system.facts.n = 1;
    await system.settle();
    log.length = 0;
    system.history.goBack();
    await system.settle();

    expect(log).toEqual([0]);
    system.destroy();
  });

  it("an onNavigate skip effect on a derivation sits out the rewind", async () => {
    // A derivation the rewind moved wakes effects as a navigation, not as a
    // change, so a skip effect that reads it does not run.
    const log: number[] = [];
    const system = await started({
      effects: (sys) => ({
        view: {
          onNavigate: "skip",
          run: () => void log.push(sys().derive.d),
        },
      }),
    });
    system.facts.n = 1;
    await system.settle();
    expect(log.at(-1)).toBe(2);
    log.length = 0;
    system.history.goBack();
    await system.settle();

    expect(system.derive.d).toBe(0);
    expect(log).toEqual([]);
    system.destroy();
  });

  it("a rewind made while a pass awaits an effect wakes effects once it ends", async () => {
    const log: number[] = [];
    let gate: Promise<void> | null = null;
    let release = () => {};
    const system = await started({
      effects: () => ({
        slow: {
          deps: ["n"],
          run: () => {
            const held = gate;
            gate = null;

            return held ?? undefined;
          },
        },
        view: {
          deps: ["n"],
          run: (f: any) => void log.push(f.n),
        },
      }),
    });
    gate = new Promise<void>((r) => {
      release = r;
    });
    system.facts.n = 1;
    await new Promise((r) => setTimeout(r, 0));
    system.history.goBack();
    release();
    await system.settle();
    await new Promise((r) => setTimeout(r, 0));
    await system.settle();

    expect(system.facts.n).toBe(0);
    expect(log.at(-1)).toBe(0);
    system.destroy();
  });

  it("after an effect chain is cut, a listener's write during a rewind keeps redo", async () => {
    const system = await started({
      effects: (sys) => ({
        loop: {
          deps: ["c"],
          onNavigate: "skip",
          run: (f: any) => {
            if (f.c > 0) {
              sys().facts.c = f.c + 1;
            }
          },
        },
      }),
    });
    system.facts.c = 1;
    await system.settle();
    expect(system.facts.c).toBeGreaterThan(100);
    let armed = false;
    system.subscribe(["c"], () => {
      if (armed) {
        system.facts.b = system.facts.c + 7;
      }
    });
    const last = latest(system).id;
    armed = true;
    system.history.goBack();
    armed = false;
    await system.settle();

    expect(system.facts.b).toBe(7);
    expect(system.history.currentIndex).toBe(
      system.history.snapshots.length - 2,
    );
    expect(latest(system).id).toBe(last);
    system.destroy();
  });

  it("start() after a navigation made while stopped does not treat its first pass as a rewind", async () => {
    const log: string[] = [];
    const system = await started({
      effects: (sys) => ({
        view: {
          deps: ["n"],
          run: (f: any) => void log.push(`view ${f.n}`),
        },
        stamp: {
          deps: ["n"],
          run: () => {
            sys().facts.m = sys().facts.m + 1;
          },
        },
      }),
    });
    system.facts.n = 1;
    await system.settle();
    system.stop();
    system.history.goBack();
    log.length = 0;
    const before = system.history.snapshots.length;
    system.start();
    await system.settle();

    expect({
      log,
      snapshots: system.history.snapshots.length - before,
    }).toEqual({ log: [], snapshots: 0 });
    system.destroy();
  });
});
