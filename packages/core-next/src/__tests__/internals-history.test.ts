/**
 * `./internals` createHistoryManager and createDisabledHistory (1.35's
 * utils/history.ts): the withHistory part's manager over 1.35's options
 * (api/history-manager.ts), and 1.35's no-op manager.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../api/schema-builders.js";
import {
  createDisabledHistory,
  createFacts,
  createHistoryManager,
} from "../internals.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const setup = (
  options: Partial<Parameters<typeof createHistoryManager>[0]> = {},
) => {
  const schema = { count: t.number(), name: t.string() };
  const { store, facts } = createFacts({ schema });
  facts.count = 0;
  facts.name = "init";
  const manager = createHistoryManager({
    historyOption: true,
    facts,
    store,
    ...options,
  } as Parameters<typeof createHistoryManager>[0]);

  return { facts, store, manager };
};

describe("createHistoryManager", () => {
  it("takes snapshots, tells onSnapshot, and stores each frozen", () => {
    const onSnapshot = vi.fn();
    const { manager, facts } = setup({ onSnapshot });
    expect(manager.isEnabled).toBe(true);
    facts.count = 1;
    const first = manager.takeSnapshot("one");
    facts.count = 2;
    manager.takeSnapshot("two");
    expect(first.id).toBe(1);
    expect(manager.snapshots.map((s) => s.facts.count)).toEqual([1, 2]);
    expect(manager.currentIndex).toBe(1);
    expect(onSnapshot).toHaveBeenCalledTimes(2);
    expect(onSnapshot.mock.calls[0]![0]).toBe(first);
    // (bd): a stored snapshot is frozen.
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.facts)).toBe(true);
  });

  it("navigates, restoring facts inside withNavigation and withRestoreOrigin, and tells onHistoryChange", () => {
    const order: string[] = [];
    const onHistoryChange = vi.fn();
    const { manager, facts, store } = setup({
      onHistoryChange,
      withNavigation: (fn) => {
        order.push("nav:start");
        fn();
        order.push("nav:end");
      },
      withRestoreOrigin: (fn) => {
        order.push("origin:start");
        fn();
        order.push("origin:end");
      },
    });
    for (const n of [1, 2, 3]) {
      facts.count = n;
      manager.takeSnapshot(`s${n}`);
    }
    store.subscribe(["count"], () => order.push("write"));
    manager.goBack();
    expect(facts.count).toBe(2);
    expect(manager.currentIndex).toBe(1);
    expect(onHistoryChange).toHaveBeenLastCalledWith(2, 1);
    // The writes land in one store batch, after the scoped assignments.
    expect(order).toEqual([
      "nav:start",
      "origin:start",
      "origin:end",
      "write",
      "nav:end",
    ]);
    manager.goForward();
    expect(facts.count).toBe(3);
    expect(onHistoryChange).toHaveBeenLastCalledWith(1, 2);
    manager.goTo(1);
    expect(facts.count).toBe(1);
    expect(onHistoryChange).toHaveBeenLastCalledWith(2, 0);
    expect(manager.isRestoring).toBe(false);
  });

  it("tells onHistoryChange on replay and import ((az))", () => {
    const onHistoryChange = vi.fn();
    const { manager, facts } = setup({ onHistoryChange });
    facts.count = 1;
    manager.takeSnapshot("a");
    facts.count = 2;
    manager.takeSnapshot("b");
    const json = manager.export();
    manager.replay();
    expect(facts.count).toBe(1);
    expect(onHistoryChange).toHaveBeenLastCalledWith(1, 0);
    manager.import(json);
    expect(facts.count).toBe(2);
    expect(onHistoryChange).toHaveBeenLastCalledWith(0, 1);
    // (ba): the next id follows the highest imported id.
    expect(manager.takeSnapshot("c").id).toBe(3);
  });

  it("with history off is inert, but pause still sets isPaused, as in 1.35", () => {
    const onSnapshot = vi.fn();
    const { manager, facts } = setup({ historyOption: false, onSnapshot });
    expect(manager.isEnabled).toBe(false);
    expect(manager.takeSnapshot("x").id).toBe(-1);
    manager.restore({
      id: 1,
      timestamp: 0,
      facts: { count: 9, name: "x" },
      trigger: "t",
    });
    expect(facts.count).toBe(0);
    expect(manager.snapshots).toEqual([]);
    expect(onSnapshot).not.toHaveBeenCalled();
    manager.pause();
    expect(manager.isPaused).toBe(true);
    manager.resume();
    expect(manager.isPaused).toBe(false);
    expect(JSON.parse(manager.export())).toEqual({
      version: 1,
      snapshots: [],
      currentIndex: -1,
    });
  });
});

describe("createDisabledHistory", () => {
  it("is inert: every method runs and nothing is recorded", () => {
    const manager = createDisabledHistory();
    expect(manager.isEnabled).toBe(false);
    expect(manager.isRestoring).toBe(false);
    expect(manager.takeSnapshot("x").id).toBe(-1);
    manager.refreshLatestSnapshot();
    manager.restore({ id: 1, timestamp: 0, facts: { a: 1 }, trigger: "" });
    manager.goBack();
    manager.goForward();
    manager.goTo(1);
    manager.replay();
    manager.import(
      JSON.stringify({ version: 1, snapshots: [], currentIndex: 0 }),
    );
    manager.beginChangeset("c");
    manager.endChangeset();
    manager.pause();
    expect(manager.isPaused).toBe(false);
    manager.resume();
    expect(manager.snapshots).toEqual([]);
    expect(manager.currentIndex).toBe(-1);
    expect(manager.export()).toBe("{}");
  });
});
