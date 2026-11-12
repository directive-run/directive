// Ported from packages/core/src/core/__tests__/l8-history-pins-oracle.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Black-box pins of 1.35's history behaviour that no other test states (the L8
// RFC, "Untested behaviours" U1 to U3, U6, U8 to U12 and U18). Each pins what
// 1.35 does today. Where a candidate row of the RFC would change it (aw, ax,
// ba, bb, bc, bd, be, bf), the case keeps 1.35's side and names the row; the
// signed entry that shows the difference is added with the row. Public API
// only. A fact write is one snapshot once the pass settles, so every write
// below is followed by `settle()`.

beforeEach(() => {
  // Date and class-instance facts, and in-place edits, print development
  // warnings; none of them is under test.
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
      facts: {
        n: t.number(),
        d: t.any(),
        m: t.any(),
        s: t.any(),
        mix: t.any(),
        cls: t.any(),
        late: t.any(),
        email: t.any(),
        obj: t.any(),
      },
      derivations: {},
      events: {},
      requirements: {},
    },
    init: (f: any) => {
      f.n = 0;
      f.email = "a@b.c";
      f.obj = { v: 0 };
    },
  } as never);
}

/** A started system with history, settled: one snapshot (id 1, index 0). */
async function begin(history: unknown = true) {
  const system = createSystem({
    module: counter(),
    history,
  } as never) as any;
  system.start();
  await system.settle();

  return system;
}

/** Writes one fact and settles: one snapshot. */
async function write(system: any, key: string, value: unknown) {
  system.facts[key] = value;
  await system.settle();
}

/** `n = 1`, `n = 2`, ... each its own snapshot. */
async function count(system: any, to: number, from = 1) {
  for (let i = from; i <= to; i++) {
    await write(system, "n", i);
  }
}

/** Where history is: the index and the value of `n`. */
function at(system: any) {
  return { index: system.history.currentIndex, n: system.facts.n };
}

/** Goes back or forward and settles. */
async function go(system: any, dir: "goBack" | "goForward", steps?: number) {
  system.history[dir](steps);
  await system.settle();
}

describe("export and import of a Date, a Map and a Set (U1)", () => {
  async function exported() {
    const a = await begin();
    a.facts.d = new Date(1000);
    a.facts.m = new Map([["k", 1]]);
    a.facts.s = new Set([1]);
    a.facts.n = 1;
    await a.settle();
    const json = a.history.export();
    a.destroy();

    return json;
  }

  it("export writes a Date as an ISO string and a Map and a Set as {}", async () => {
    const data = JSON.parse(await exported());
    const last = data.snapshots[data.snapshots.length - 1].facts;

    expect(last.n).toBe(1);
    expect(last.d).toBe("1970-01-01T00:00:01.000Z");
    expect(last.m).toEqual({});
    expect(last.s).toEqual({});
  });

  it("import writes that string and those empty objects into the facts", async () => {
    const json = await exported();
    const b = await begin();
    b.history.import(json);
    await b.settle();

    expect(b.facts.n).toBe(1);
    expect(typeof b.facts.d).toBe("string");
    expect(b.facts.d).toBe("1970-01-01T00:00:01.000Z");
    expect(b.facts.m instanceof Map).toBe(false);
    expect(b.facts.m).toEqual({});
    expect(b.facts.s instanceof Set).toBe(false);
    expect(b.facts.s).toEqual({});
    b.destroy();
  });
});

describe("what a snapshot keeps of a Date, a function and a class instance (U2)", () => {
  it("a fact mixing a Date with a function is copied through JSON: the Date comes back as a string and the function is gone", async () => {
    const system = await begin();
    system.facts.mix = { when: new Date(1000), cb: () => 1 };
    await system.settle();
    await write(system, "n", 1);
    await go(system, "goBack");

    expect(system.history.currentIndex).toBe(1);
    expect(system.facts.mix).toEqual({ when: "1970-01-01T00:00:01.000Z" });
    expect("cb" in system.facts.mix).toBe(false);
    system.destroy();
  });

  it("a class instance comes back as a plain object when the whole record clones", async () => {
    const system = await begin();
    await write(system, "cls", new Point(4));
    await write(system, "n", 1);
    await go(system, "goBack");

    expect(system.facts.cls).toEqual({ x: 4 });
    expect(system.facts.cls instanceof Point).toBe(false);
    expect(Object.getPrototypeOf(system.facts.cls)).toBe(Object.prototype);
    system.destroy();
  });

  it("a class instance comes back as a plain object in the per-fact tier and in the JSON tier", async () => {
    const system = await begin();
    // `mix` holds a function, so the whole record cannot clone: `cls` clones
    // alone, and `mix` falls to JSON, which also strips the instance in it.
    system.facts.cls = new Point(4);
    system.facts.mix = { cb: () => 1, point: new Point(5) };
    await system.settle();
    await write(system, "n", 1);
    await go(system, "goBack");

    expect(system.facts.cls).toEqual({ x: 4 });
    expect(Object.getPrototypeOf(system.facts.cls)).toBe(Object.prototype);
    expect(system.facts.mix).toEqual({ point: { x: 5 } });
    expect(Object.getPrototypeOf(system.facts.mix.point)).toBe(
      Object.prototype,
    );
    system.destroy();
  });
});

describe("a stored snapshot is the same object the caller holds (U3)", () => {
  it("a value changed through the snapshots list is what the next goTo restores", async () => {
    const system = await begin();
    await count(system, 2);
    const target = system.history.snapshots[1];
    target.facts.n = 99;

    expect(system.history.snapshots[1].facts.n).toBe(99);
    system.history.goTo(target.id);
    await system.settle();
    expect(system.facts.n).toBe(99);
    expect(system.history.snapshots[1].facts.n).toBe(99);
    system.destroy();
  });

  it("a nested value edited in place on a restored fact edits the stored snapshot too", async () => {
    const system = await begin();
    await write(system, "obj", { v: 1 });
    await write(system, "obj", { v: 2 });
    await go(system, "goBack");
    const index = system.history.currentIndex;
    expect(system.facts.obj.v).toBe(1);
    const stored = system.history.snapshots[index];

    system.facts.obj.v = 42;
    await system.settle();

    expect(system.facts.obj.v).toBe(42);
    expect(stored.facts.obj.v).toBe(42);
    expect(system.history.snapshots[index].facts.obj.v).toBe(42);
    system.destroy();
  });
});

describe("snapshot ids after an import (U6)", () => {
  /** Four snapshots, ids 1 to 4, index 3: `n` is 0, 1, 2, 3. */
  async function fourSnapshots() {
    const a = await begin();
    await count(a, 3);
    const json = a.history.export();
    a.destroy();

    return json;
  }

  const ids = (system: any) => system.history.snapshots.map((s: any) => s.id);

  it("repeat when the system's counter is behind the imported ids, and goTo finds the first", async () => {
    const json = await fourSnapshots();
    const b = await begin();
    b.history.import(json);
    await b.settle();
    expect(ids(b)).toEqual([1, 2, 3, 4]);

    await write(b, "n", 9);
    expect(ids(b)).toEqual([1, 2, 3, 4, 2]);

    b.history.goTo(2);
    await b.settle();
    expect(b.history.currentIndex).toBe(1);
    expect(b.facts.n).toBe(1);
    b.destroy();
  });

  it("do not repeat when the system is already past the imported ids", async () => {
    const json = await fourSnapshots();
    const c = await begin();
    await count(c, 5);
    expect(ids(c)).toEqual([1, 2, 3, 4, 5, 6]);

    c.history.import(json);
    await c.settle();
    await write(c, "n", 9);

    expect(ids(c)).toEqual([1, 2, 3, 4, 7]);
    c.destroy();
  });
});

describe("a changeset and goBack(steps) (U8)", () => {
  /**
   * `n` is 0, 1, 2 at indexes 0 to 2; a changeset over indexes 2 to 4 (`n` 3
   * and 4); then, when `after` is set, `n` = 5 at index 5.
   */
  async function withChangeset(after: boolean) {
    const system = await begin();
    await count(system, 2);
    system.history.beginChangeset("c");
    await count(system, 4, 3);
    system.history.endChangeset();
    if (after) {
      await write(system, "n", 5);
    }

    return system;
  }

  it("(a) goBack(2) from inside a changeset lands on its start: the second step is dropped", async () => {
    const system = await withChangeset(false);
    expect(at(system)).toEqual({ index: 4, n: 4 });

    await go(system, "goBack", 2);

    expect(at(system)).toEqual({ index: 2, n: 2 });
    system.destroy();
  });

  it("(b) goBack(2) from outside, into a changeset, stops inside it", async () => {
    const system = await withChangeset(true);
    expect(at(system)).toEqual({ index: 5, n: 5 });

    await go(system, "goBack", 2);

    expect(at(system)).toEqual({ index: 3, n: 3 });
    system.destroy();
  });

  describe("(c) at a changeset's start", () => {
    /**
     * `n` = 1 at index 1; changeset A over 1 to 3; `n` = 4 and 5 at indexes 4
     * and 5; changeset B over 5 to 7. goBack from index 7 lands on B's
     * start, index 5.
     */
    async function twoChangesets() {
      const system = await begin();
      await write(system, "n", 1);
      system.history.beginChangeset("A");
      await count(system, 3, 2);
      system.history.endChangeset();
      await count(system, 5, 4);
      system.history.beginChangeset("B");
      await count(system, 7, 6);
      system.history.endChangeset();
      await go(system, "goBack");
      expect(at(system)).toEqual({ index: 5, n: 5 });

      return system;
    }

    it("goBack(steps) jumps to the start of an earlier changeset whose end is within steps", async () => {
      const system = await twoChangesets();

      await go(system, "goBack", 2);

      expect(at(system)).toEqual({ index: 1, n: 1 });
      system.destroy();
    });

    it("goBack(steps) moves steps snapshots when no earlier changeset ends within them", async () => {
      const system = await twoChangesets();

      await go(system, "goBack", 1);

      expect(at(system)).toEqual({ index: 4, n: 4 });
      system.destroy();
    });
  });
});

describe("an import with a currentIndex outside the list (U9)", () => {
  it("is accepted, changes no fact, and goBack from it restores nothing", async () => {
    const system = await begin();
    await count(system, 2);
    const data = JSON.parse(system.history.export());
    data.currentIndex = 99;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    system.history.import(JSON.stringify(data));
    await system.settle();

    expect(error).not.toHaveBeenCalled();
    expect(system.history.currentIndex).toBe(99);
    expect(system.history.snapshots.length).toBe(3);
    expect(system.facts.n).toBe(2);

    await go(system, "goBack");

    expect(system.history.currentIndex).toBe(98);
    expect(system.facts.n).toBe(2);
    system.destroy();
  });
});

describe("going back over a fact the snapshot did not hold (U10)", () => {
  it("leaves a fact set after the snapshot at its current value", async () => {
    const system = await begin();
    await write(system, "n", 1);
    await write(system, "late", "x");
    expect("late" in system.history.snapshots[1].facts).toBe(false);

    await go(system, "goBack");

    expect(system.history.currentIndex).toBe(1);
    expect(system.facts.n).toBe(1);
    expect(system.facts.late).toBe("x");
    system.destroy();
  });

  it("goForward does not delete a fact again: delete n, goBack gives 1, goForward is still 1", async () => {
    const system = await begin();
    await write(system, "n", 1);
    delete system.facts.n;
    system.facts.email = "z";
    await system.settle();
    expect(system.facts.n).toBeUndefined();
    expect(system.history.currentIndex).toBe(2);

    await go(system, "goBack");
    expect(system.facts.n).toBe(1);
    expect(system.facts.email).toBe("a@b.c");

    await go(system, "goForward");
    expect(system.history.currentIndex).toBe(2);
    expect(system.facts.email).toBe("z");
    expect(system.facts.n).toBe(1);
    system.destroy();
  });
});

describe("redactSnapshot and a navigation (U11)", () => {
  it("a navigation writes the redacted value into the live fact", async () => {
    const system = await begin({
      maxSnapshots: 10,
      redactSnapshot: (facts: Record<string, unknown>) => ({
        ...facts,
        email: "[REDACTED]",
      }),
    });
    await count(system, 2);
    expect(system.facts.email).toBe("a@b.c");
    expect(system.history.snapshots[2].facts.email).toBe("[REDACTED]");

    await go(system, "goBack");

    expect(system.facts.n).toBe(1);
    expect(system.facts.email).toBe("[REDACTED]");
    system.destroy();
  });
});

describe("the members of system.history (U12)", () => {
  it("carries takeSnapshot, restore, refreshLatestSnapshot, isEnabled and isRestoring", async () => {
    const system = await begin();
    const history = system.history;

    expect(typeof history.takeSnapshot).toBe("function");
    expect(typeof history.restore).toBe("function");
    expect(typeof history.refreshLatestSnapshot).toBe("function");
    expect(history.isEnabled).toBe(true);
    expect(history.isRestoring).toBe(false);
    system.destroy();
  });

  it("takeSnapshot takes one snapshot now, with the trigger it is given", async () => {
    const system = await begin();
    expect(system.history.snapshots.map((s: any) => s.id)).toEqual([1]);

    const snapshot = system.history.takeSnapshot("manual");

    expect(snapshot.id).toBe(2);
    expect(snapshot.trigger).toBe("manual");
    expect(snapshot.facts.n).toBe(0);
    expect(system.history.snapshots.map((s: any) => s.id)).toEqual([1, 2]);
    expect(system.history.currentIndex).toBe(1);
    system.destroy();
  });

  it("is null when history is not asked for", async () => {
    const system = createSystem({ module: counter() } as never) as any;
    system.start();

    expect(system.history).toBeNull();
    system.destroy();
  });
});

describe("pause() inside a changeset (U18)", () => {
  it("records no range when the only write was paused, so goBack moves one snapshot", async () => {
    const system = await begin();
    await write(system, "n", 1);
    system.history.beginChangeset("c");
    system.history.pause();
    await write(system, "n", 2);
    system.history.endChangeset();
    system.history.resume();
    expect(system.history.snapshots.length).toBe(2);

    await go(system, "goBack");

    expect(at(system)).toEqual({ index: 0, n: 0 });
    system.destroy();
  });

  it("a later goBack from two snapshots past it still moves one snapshot, not to the changeset's start", async () => {
    const system = await begin();
    await write(system, "n", 1);
    system.history.beginChangeset("c");
    system.history.pause();
    await write(system, "n", 2);
    system.history.endChangeset();
    system.history.resume();
    await count(system, 4, 3);
    expect(at(system)).toEqual({ index: 3, n: 4 });

    await go(system, "goBack");

    expect(at(system)).toEqual({ index: 2, n: 3 });
    system.destroy();
  });
});
