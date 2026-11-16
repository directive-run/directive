/**
 * L8b, history rows (bb) and (bd) (api/history.ts; L8 RFC rev 2, owner
 * decision 2026-11-10, "Approve all as recommended (Recommended)").
 *
 * (bb): the changesets follow the snapshots. A buffer drop shifts every
 * range, and drops one whose start falls off; a new snapshot after a goBack
 * drops a range that starts in the cut part and cuts back one that only ends
 * in it; an import clears them. The open changeset follows the same rules.
 *
 * (bd): a stored snapshot is not shared. A restore of one writes copies of its
 * object values; a snapshot the caller built is written as given; each stored
 * snapshot and its `facts` record are frozen.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModule } from "../api/module.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

beforeEach(() => {
  // Class-instance facts and in-place edits print development warnings.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

class Point {
  constructor(public x: number) {}
}

function counter() {
  return createModule("m", {
    schema: {
      facts: { n: t.number(), obj: t.any(), cls: t.any(), fn: t.any() },
      derivations: {},
      events: {},
      requirements: {},
    },
    init: (f: any) => {
      f.n = 0;
      f.obj = { v: 0 };
    },
  } as never);
}

/** A system with history, not started: start it with `go`. */
function make(history: unknown = true, plugins: unknown[] = []) {
  return createSystem({ module: counter(), history, plugins } as never) as any;
}

/** Starts and settles: one snapshot (index 0, n 0). */
async function go(system: any) {
  system.start();
  await system.settle();

  return system;
}

/** Each `n` written and settled: one snapshot each. */
async function write(system: any, ...ns: number[]) {
  for (const n of ns) {
    system.facts.n = n;
    await system.settle();
  }
}

/** One goBack, then the restored `n`. */
const back = (system: any) => {
  system.history.goBack();

  return system.facts.n;
};

/** The raw stored value of `key`, not the development wrapper. */
const raw = (system: any, key: string) => system.getSnapshot().facts[key];

describe("(bb) the changesets follow the snapshots", () => {
  it("a buffer drop shifts every range by one", async () => {
    const system = await go(make({ maxSnapshots: 5 }));
    await write(system, 1);
    system.history.beginChangeset("a");
    await write(system, 2, 3);
    system.history.endChangeset();
    // n 5 drops n 0: the range n 1 to n 3 is now indexes 0 to 2.
    await write(system, 4, 5);
    expect([back(system), back(system), back(system)]).toEqual([4, 3, 1]);
  });

  it("a buffer drop drops a range whose start falls off", async () => {
    const system = await go(make({ maxSnapshots: 4 }));
    system.history.beginChangeset("a");
    await write(system, 1, 2);
    system.history.endChangeset();
    await write(system, 3, 4);
    expect([back(system), back(system), back(system)]).toEqual([3, 2, 1]);
    expect(system.history.currentIndex).toBe(0);
  });

  it("a new snapshot after a goBack drops a range that starts in the cut part", async () => {
    const system = await go(make());
    await write(system, 1, 2);
    system.history.beginChangeset("a");
    await write(system, 3, 4);
    system.history.endChangeset();
    // n 4 and the range back to n 2, then one more step to n 1.
    expect([back(system), back(system)]).toEqual([2, 1]);
    await write(system, 9, 10, 11);
    expect([back(system), back(system)]).toEqual([10, 9]);
  });

  it("a range that only ends in the cut part is cut back to the current snapshot", async () => {
    const system = await go(make());
    await write(system, 1);
    system.history.beginChangeset("a");
    await write(system, 2, 3, 4);
    system.history.endChangeset();
    system.history.goTo(system.history.snapshots[2].id);
    expect(system.facts.n).toBe(2);
    // The range n 1 to n 4 becomes n 1 to n 2.
    await write(system, 9);
    expect([back(system), back(system)]).toEqual([2, 1]);
  });

  it("an import clears every range", async () => {
    const other = await go(make());
    await write(other, 10, 11, 12);
    const json = other.history.export();
    const system = await go(make());
    await write(system, 1);
    system.history.beginChangeset("a");
    await write(system, 2, 3);
    system.history.endChangeset();
    system.history.import(json);
    expect(system.facts.n).toBe(12);
    expect([back(system), back(system)]).toEqual([11, 10]);
  });

  it("an import drops the open changeset, so its end records nothing", async () => {
    const other = await go(make());
    await write(other, 10);
    const json = other.history.export();
    const system = await go(make());
    await write(system, 1);
    system.history.beginChangeset("a");
    system.history.import(json);
    await write(system, 20, 21);
    system.history.endChangeset();
    expect([back(system), back(system)]).toEqual([20, 10]);
  });

  it("the open changeset's start moves with the buffer", async () => {
    const system = await go(make({ maxSnapshots: 4 }));
    await write(system, 1, 2);
    system.history.beginChangeset("a");
    // n 4 and n 5 drop n 0 and n 1: the start (n 2) is now index 0.
    await write(system, 3, 4, 5);
    system.history.endChangeset();
    expect(back(system)).toBe(2);
  });

  it("the open changeset is dropped when its start falls off", async () => {
    const system = await go(make({ maxSnapshots: 3 }));
    system.history.beginChangeset("a");
    await write(system, 1, 2, 3);
    system.history.endChangeset();
    expect([back(system), back(system)]).toEqual([2, 1]);
    expect(system.history.currentIndex).toBe(0);
  });

  it("the open changeset is dropped when its start is cut off", async () => {
    const system = await go(make());
    await write(system, 1, 2);
    system.history.beginChangeset("a");
    await write(system, 3);
    expect([back(system), back(system)]).toEqual([2, 1]);
    await write(system, 9, 10, 11);
    system.history.endChangeset();
    expect([back(system), back(system)]).toEqual([10, 9]);
  });

  it("a range begun before the first snapshot is kept until a drop, as in 1.35", async () => {
    const system = make();
    system.history.beginChangeset("a");
    await go(system);
    await write(system, 1);
    system.history.endChangeset();
    await write(system, 2);
    // From n 2 one step to n 1, then the range's start, before the first.
    expect(back(system)).toBe(1);
    system.history.goBack();
    expect(system.history.currentIndex).toBe(-1);
  });
});

describe("(bd) a stored snapshot is not shared", () => {
  it("a restore writes copies: a restored value changed in place leaves the snapshot alone", async () => {
    const system = await go(make());
    system.facts.obj = { v: 1 };
    await system.settle();
    system.history.goBack();
    const stored = system.history.snapshots[0].facts.obj;
    expect(raw(system, "obj")).not.toBe(stored);
    system.facts.obj.v = 42;
    expect(raw(system, "obj").v).toBe(42);
    expect(system.history.snapshots[0].facts.obj.v).toBe(0);
  });

  it("history.restore of a stored snapshot, from the snapshots list, still writes copies", async () => {
    const system = await go(make());
    system.facts.obj = { v: 1 };
    await system.settle();
    const first = system.history.snapshots[0];
    system.history.restore(first);
    expect(raw(system, "obj")).toEqual({ v: 0 });
    expect(raw(system, "obj")).not.toBe(first.facts.obj);
  });

  it("history.restore writes a snapshot the caller built as given: a class instance keeps its prototype", async () => {
    const system = await go(make());
    const cls = new Point(3);
    system.history.restore({
      id: 99,
      timestamp: 0,
      trigger: "x",
      facts: { cls },
    });
    expect(raw(system, "cls")).toBe(cls);
    expect(system.facts.cls).toBeInstanceOf(Point);
  });

  it("history.restore writes a caller-built value that cannot clone (it holds a function), so nothing is half-written", async () => {
    const system = await go(make());
    const fn = { call: () => 1 };
    system.history.restore({
      id: 99,
      timestamp: 0,
      trigger: "x",
      facts: { n: 7, fn },
    });
    expect(system.facts.n).toBe(7);
    expect(raw(system, "fn")).toBe(fn);
  });

  it("each stored snapshot and its facts are frozen, taken or imported; the list hands them out", async () => {
    const system = await go(make());
    await write(system, 1);
    const [first] = system.history.snapshots;
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.facts)).toBe(true);
    expect(() => {
      first.facts.n = 5;
    }).toThrow(TypeError);
    system.history.import(system.history.export());
    for (const snapshot of system.history.snapshots) {
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.facts)).toBe(true);
    }
  });

  it("the facts record frozen is one the clone made, never the redactor's own", async () => {
    const mine = { n: 1, obj: { v: 1 } };
    const system = await go(make({ redactSnapshot: () => mine }));
    expect(Object.isFrozen(system.history.snapshots[0].facts)).toBe(true);
    expect(Object.isFrozen(mine)).toBe(false);
  });

  it("the export is unchanged: export, import, export round-trips byte for byte", async () => {
    const system = await go(make());
    await write(system, 1, 2);
    system.facts.obj = { v: [1, { w: "x" }] };
    await system.settle();
    const json = system.history.export();
    const copy = await go(make());
    copy.history.import(json);
    expect(copy.history.export()).toBe(json);
  });
});
