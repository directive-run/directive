/**
 * L8 history rows (ba), (bc) and (be): 2.0's side (api/history.ts; L8 RFC
 * rev 2, owner decision 2026-11-10, "Approve all as recommended
 * (Recommended)").
 *
 * The conformance tests U6, U8 and U9 keep only what 1.35 and 2.0 share at
 * these rows (the L8 gate), so 2.0's side is pinned here, each case the mirror
 * of the 1.35 assertion the gate dropped. The scenarios are theirs.
 *
 * (ba): after an import the next snapshot id follows the highest imported id.
 * (bc): an import whose `currentIndex` is outside the list fails like any bad
 *       field, and changes nothing.
 * (be): `goBack` takes each step in turn, and a changeset is one of them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModule } from "../api/module.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function counter() {
  return createModule("m", {
    schema: {
      facts: { n: t.number() },
      derivations: {},
      events: {},
      requirements: {},
    },
    init: (f: any) => {
      f.n = 0;
    },
  } as never);
}

/** A started, settled system with history: one snapshot (id 1, index 0). */
async function begin() {
  const system = createSystem({
    module: counter(),
    history: true,
  } as never) as any;
  system.start();
  await system.settle();

  return system;
}

/** `n = from`, then each next, up to `to`, each its own snapshot. */
async function count(system: any, to: number, from = 1) {
  for (let i = from; i <= to; i++) {
    system.facts.n = i;
    await system.settle();
  }
}

/** Where history is: the index and the value of `n`. */
const at = (system: any) => ({
  index: system.history.currentIndex,
  n: system.facts.n,
});

const ids = (system: any) => system.history.snapshots.map((s: any) => s.id);

// Row (ba), owner decision 2026-11-10, "Approve all as recommended
// (Recommended)": the next id follows the highest imported id.
describe("(ba) snapshot ids continue after an import (U6)", () => {
  /** Four snapshots, ids 1 to 4, index 3: `n` is 0, 1, 2, 3. */
  async function fourSnapshots() {
    const a = await begin();
    await count(a, 3);
    const json = a.history.export();
    a.destroy();

    return json;
  }

  // 1.35: the next id repeats an imported one ([1, 2, 3, 4, 2]).
  it("the next id into a system whose counter is behind is the highest imported id plus one", async () => {
    const json = await fourSnapshots();
    const b = await begin();
    b.history.import(json);
    await b.settle();
    expect(ids(b)).toEqual([1, 2, 3, 4]);

    b.facts.n = 9;
    await b.settle();

    expect(ids(b)).toEqual([1, 2, 3, 4, 5]);
    b.destroy();
  });

  // 1.35: goTo(2) finds the first of two snapshots with id 2 (the imported one).
  it("each id names one snapshot: goTo finds the imported snapshot and the new one", async () => {
    const json = await fourSnapshots();
    const b = await begin();
    b.history.import(json);
    await b.settle();
    b.facts.n = 9;
    await b.settle();

    b.history.goTo(2);
    await b.settle();
    expect(at(b)).toEqual({ index: 1, n: 1 });

    b.history.goTo(5);
    await b.settle();
    expect(at(b)).toEqual({ index: 4, n: 9 });
    b.destroy();
  });

  // A system already past the imported ids keeps its own counter: the next id
  // is the larger of the two, so it never moves back.
  it("a system already past the imported ids keeps its own counter", async () => {
    const json = await fourSnapshots();
    const c = await begin();
    await count(c, 5);
    expect(ids(c)).toEqual([1, 2, 3, 4, 5, 6]);

    c.history.import(json);
    await c.settle();
    c.facts.n = 9;
    await c.settle();

    expect(ids(c)).toEqual([1, 2, 3, 4, 7]);
    c.destroy();
  });
});

// Row (bc), owner decision 2026-11-10, "Approve all as recommended
// (Recommended)": an index outside the list fails the import, as any bad field.
describe("(bc) an import with a currentIndex outside the list is refused (U9)", () => {
  /** Three snapshots, `n` 0, 1, 2, at index 2: the export, parsed. */
  async function threeSnapshots() {
    const system = await begin();
    await count(system, 2);

    return { system, data: JSON.parse(system.history.export()) };
  }

  // 1.35: accepts it (no log, index 99), and a goBack then moves to 98 and
  // restores nothing.
  it("logs 'Failed to import history data', and the index stays", async () => {
    const { system, data } = await threeSnapshots();
    data.currentIndex = 99;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    system.history.import(JSON.stringify(data));
    await system.settle();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]![0]).toBe(
      "[Directive] Failed to import history data:",
    );
    expect(String(error.mock.calls[0]![1])).toContain("currentIndex");
    expect(system.history.currentIndex).toBe(2);
    expect(system.history.snapshots.length).toBe(3);
    expect(system.facts.n).toBe(2);
    system.destroy();
  });

  it("navigation keeps working: goBack goes to index 1 and restores its fact", async () => {
    const { system, data } = await threeSnapshots();
    data.currentIndex = 99;
    vi.spyOn(console, "error").mockImplementation(() => {});
    system.history.import(JSON.stringify(data));
    await system.settle();

    system.history.goBack();
    await system.settle();

    expect(at(system)).toEqual({ index: 1, n: 1 });
    system.destroy();
  });

  it("changes nothing: a longer imported list with an index past its end leaves the old list", async () => {
    const { system } = await threeSnapshots();
    const before = ids(system);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const other = await begin();
    await count(other, 5);
    const longer = JSON.parse(other.history.export());
    other.destroy();
    longer.currentIndex = longer.snapshots.length;

    system.history.import(JSON.stringify(longer));
    await system.settle();

    expect(ids(system)).toEqual(before);
    expect(at(system)).toEqual({ index: 2, n: 2 });
    system.destroy();
  });

  it("refuses a negative index and an index that names no snapshot", async () => {
    for (const bad of [-1, 1.5, 3]) {
      const { system, data } = await threeSnapshots();
      data.currentIndex = bad;
      const error = vi.spyOn(console, "error").mockImplementation(() => {});

      system.history.import(JSON.stringify(data));
      await system.settle();

      expect(error).toHaveBeenCalledTimes(1);
      expect(at(system)).toEqual({ index: 2, n: 2 });
      error.mockRestore();
      system.destroy();
    }
  });

  it("still accepts an index inside the list, at either end", async () => {
    for (const good of [0, 1, 2]) {
      const { system, data } = await threeSnapshots();
      data.currentIndex = good;
      const error = vi.spyOn(console, "error").mockImplementation(() => {});

      system.history.import(JSON.stringify(data));
      await system.settle();

      expect(error).not.toHaveBeenCalled();
      expect(at(system)).toEqual({ index: good, n: good });
      error.mockRestore();
      system.destroy();
    }
  });
});

// Row (be), owner decision 2026-11-10, "Approve all as recommended
// (Recommended)": a changeset counts as one of the steps.
describe("(be) goBack(2) across a changeset takes it as one step (U8)", () => {
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
      system.facts.n = 5;
      await system.settle();
    }

    return system;
  }

  // 1.35: from index 5 it takes one jump of two, to index 3, inside the
  // changeset.
  it("from outside, into a changeset: one plain step to its end, then across it to its start", async () => {
    const system = await withChangeset(true);
    expect(at(system)).toEqual({ index: 5, n: 5 });

    system.history.goBack(2);
    await system.settle();

    expect(at(system)).toEqual({ index: 2, n: 2 });
    system.destroy();
  });

  // 1.35: from inside it lands on the start (index 2) and drops the second
  // step. On 2.0 the first step lands on the start, and the second moves one
  // snapshot before it. (The RFC's row text says "still lands on the start";
  // its gate comment, and this run, say index 1.)
  it("from inside, a step lands on the start and the step left goes on from there", async () => {
    const system = await withChangeset(false);
    expect(at(system)).toEqual({ index: 4, n: 4 });

    system.history.goBack(2);
    await system.settle();

    expect(at(system)).toEqual({ index: 1, n: 1 });
    system.destroy();
  });

  it("goBack(3) from outside takes the changeset as one of its steps", async () => {
    const system = await withChangeset(true);

    system.history.goBack(3);
    await system.settle();

    // One step to the end (4), one across the changeset (2), one plain (1).
    expect(at(system)).toEqual({ index: 1, n: 1 });
    system.destroy();
  });
});
