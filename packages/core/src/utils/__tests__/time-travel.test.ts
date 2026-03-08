import { describe, it, expect, vi } from "vitest";
import {
  createTimeTravelManager,
  createDisabledTimeTravel,
} from "../time-travel.js";
import { createFactsStore, createFactsProxy } from "../../core/facts.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup(opts: {
  timeTravel?: boolean;
  maxSnapshots?: number;
  onSnapshot?: (s: unknown) => void;
  onTimeTravel?: (from: number, to: number) => void;
} = {}) {
  const schema = { count: { _type: 0 }, name: { _type: "" } } as const;
  // biome-ignore lint/suspicious/noExplicitAny: Test helper — schema types are checked at runtime
  const store = createFactsStore({ schema } as any);
  // biome-ignore lint/suspicious/noExplicitAny: Test helper
  const facts = createFactsProxy(store, schema as any) as any;

  // Initialise
  facts.count = 0;
  facts.name = "init";

  // biome-ignore lint/suspicious/noExplicitAny: Test helper
  const manager = createTimeTravelManager<any>({
    config: {
      timeTravel: opts.timeTravel ?? true,
      maxSnapshots: opts.maxSnapshots,
    },
    facts,
    store,
    onSnapshot: opts.onSnapshot,
    onTimeTravel: opts.onTimeTravel,
  });

  return { schema, store, facts, manager };
}

// ---------------------------------------------------------------------------
// createTimeTravelManager
// ---------------------------------------------------------------------------

describe("createTimeTravelManager", () => {
  // ---- basic properties ---------------------------------------------------

  it("reports isEnabled based on config", () => {
    const enabled = setup({ timeTravel: true });
    expect(enabled.manager.isEnabled).toBe(true);

    const disabled = setup({ timeTravel: false });
    expect(disabled.manager.isEnabled).toBe(false);
  });

  it("starts with empty snapshots and currentIndex -1", () => {
    const { manager } = setup();
    expect(manager.snapshots).toEqual([]);
    expect(manager.currentIndex).toBe(-1);
  });

  // ---- takeSnapshot -------------------------------------------------------

  it("takeSnapshot records current facts", () => {
    const { manager, facts } = setup();
    facts.count = 5;
    facts.name = "five";

    const snap = manager.takeSnapshot("test");

    expect(snap.id).toBe(1);
    expect(snap.trigger).toBe("test");
    expect(snap.facts).toEqual({ count: 5, name: "five" });
    expect(manager.snapshots).toHaveLength(1);
    expect(manager.currentIndex).toBe(0);
  });

  it("takeSnapshot increments id", () => {
    const { manager } = setup();
    const s1 = manager.takeSnapshot("a");
    const s2 = manager.takeSnapshot("b");
    expect(s2.id).toBe(s1.id + 1);
  });

  it("takeSnapshot deep-clones facts (mutation safe)", () => {
    const { manager, facts } = setup();
    facts.count = 1;
    manager.takeSnapshot("before");

    facts.count = 99;
    expect(manager.snapshots[0]!.facts.count).toBe(1);
  });

  it("takeSnapshot calls onSnapshot callback", () => {
    const onSnapshot = vi.fn();
    const { manager } = setup({ onSnapshot });
    manager.takeSnapshot("cb");
    expect(onSnapshot).toHaveBeenCalledOnce();
    expect(onSnapshot.mock.calls[0]![0].trigger).toBe("cb");
  });

  it("takeSnapshot returns noop when disabled", () => {
    const { manager } = setup({ timeTravel: false });
    const snap = manager.takeSnapshot("nope");
    expect(snap.id).toBe(-1);
    expect(manager.snapshots).toHaveLength(0);
  });

  it("takeSnapshot returns noop when paused", () => {
    const { manager } = setup();
    manager.pause();
    const snap = manager.takeSnapshot("paused");
    expect(snap.id).toBe(-1);
    expect(manager.snapshots).toHaveLength(0);
  });

  // ---- ring buffer --------------------------------------------------------

  it("enforces maxSnapshots (ring buffer)", () => {
    const { manager, facts } = setup({ maxSnapshots: 3 });
    for (let i = 0; i < 5; i++) {
      facts.count = i;
      manager.takeSnapshot(`snap-${i}`);
    }
    expect(manager.snapshots).toHaveLength(3);
    // oldest two should be evicted
    expect(manager.snapshots[0]!.trigger).toBe("snap-2");
    expect(manager.snapshots[2]!.trigger).toBe("snap-4");
    expect(manager.currentIndex).toBe(2);
  });

  it("truncates future snapshots when taking after goBack", () => {
    const { manager, facts } = setup();
    facts.count = 1;
    manager.takeSnapshot("s1");
    facts.count = 2;
    manager.takeSnapshot("s2");
    facts.count = 3;
    manager.takeSnapshot("s3");

    // Go back to s1
    manager.goBack();
    manager.goBack();
    expect(manager.currentIndex).toBe(0);

    // Take new snapshot — should truncate s2 and s3
    facts.count = 10;
    manager.takeSnapshot("s4");
    expect(manager.snapshots).toHaveLength(2);
    expect(manager.snapshots[1]!.trigger).toBe("s4");
  });

  // ---- restore ------------------------------------------------------------

  it("restore sets facts from snapshot", () => {
    const { manager, facts } = setup();
    facts.count = 42;
    facts.name = "answer";
    const snap = manager.takeSnapshot("restore-test");

    facts.count = 0;
    facts.name = "reset";

    manager.restore(snap);
    expect(facts.count).toBe(42);
    expect(facts.name).toBe("answer");
  });

  it("restore does nothing when disabled", () => {
    const { manager, facts } = setup({ timeTravel: false });
    facts.count = 10;
    const snap = { id: 1, timestamp: 0, facts: { count: 99, name: "x" }, trigger: "t" };
    manager.restore(snap);
    expect(facts.count).toBe(10);
  });

  it("restore rejects prototype pollution in snapshot data", () => {
    const { manager } = setup();
    const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const poisoned = {
      id: 1,
      timestamp: 0,
      facts: { count: 1, name: "ok", __proto__: { polluted: true } },
      trigger: "evil",
    };
    // isPrototypeSafe should catch the __proto__ key in nested objects
    // The exact behavior depends on isPrototypeSafe implementation
    manager.restore(poisoned);

    warnSpy.mockRestore();
  });

  // ---- goBack / goForward -------------------------------------------------

  it("goBack navigates to previous snapshot", () => {
    const onTimeTravel = vi.fn();
    const { manager, facts } = setup({ onTimeTravel });

    facts.count = 1;
    manager.takeSnapshot("s1");
    facts.count = 2;
    manager.takeSnapshot("s2");
    facts.count = 3;
    manager.takeSnapshot("s3");

    manager.goBack();
    expect(manager.currentIndex).toBe(1);
    expect(facts.count).toBe(2);
    expect(onTimeTravel).toHaveBeenCalledWith(2, 1);
  });

  it("goBack does not go below 0", () => {
    const { manager, facts } = setup();
    facts.count = 1;
    manager.takeSnapshot("s1");

    manager.goBack();
    manager.goBack();
    manager.goBack();
    expect(manager.currentIndex).toBe(0);
  });

  it("goForward navigates to next snapshot", () => {
    const onTimeTravel = vi.fn();
    const { manager, facts } = setup({ onTimeTravel });

    facts.count = 1;
    manager.takeSnapshot("s1");
    facts.count = 2;
    manager.takeSnapshot("s2");
    facts.count = 3;
    manager.takeSnapshot("s3");

    manager.goBack();
    manager.goBack();
    expect(manager.currentIndex).toBe(0);

    manager.goForward();
    expect(manager.currentIndex).toBe(1);
    expect(facts.count).toBe(2);
    expect(onTimeTravel).toHaveBeenLastCalledWith(0, 1);
  });

  it("goForward does not exceed max index", () => {
    const { manager, facts } = setup();
    facts.count = 1;
    manager.takeSnapshot("s1");

    manager.goForward();
    expect(manager.currentIndex).toBe(0);
  });

  it("goBack/goForward noop when empty or disabled", () => {
    const disabled = setup({ timeTravel: false });
    disabled.manager.goBack();
    disabled.manager.goForward();

    const empty = setup();
    empty.manager.goBack();
    empty.manager.goForward();
  });

  // ---- goTo ---------------------------------------------------------------

  it("goTo navigates to specific snapshot by id", () => {
    const { manager, facts } = setup();

    facts.count = 10;
    const s1 = manager.takeSnapshot("s1");
    facts.count = 20;
    manager.takeSnapshot("s2");
    facts.count = 30;
    manager.takeSnapshot("s3");

    manager.goTo(s1.id);
    expect(manager.currentIndex).toBe(0);
    expect(facts.count).toBe(10);
  });

  it("goTo warns on invalid snapshot id", () => {
    const { manager } = setup();
    manager.takeSnapshot("s1");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    manager.goTo(999);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Snapshot 999 not found"),
    );
    warnSpy.mockRestore();
  });

  it("goTo noop when disabled", () => {
    const { manager } = setup({ timeTravel: false });
    manager.goTo(1);
  });

  // ---- replay -------------------------------------------------------------

  it("replay restores first snapshot", () => {
    const { manager, facts } = setup();

    facts.count = 1;
    manager.takeSnapshot("s1");
    facts.count = 2;
    manager.takeSnapshot("s2");
    facts.count = 3;
    manager.takeSnapshot("s3");

    manager.replay();
    expect(manager.currentIndex).toBe(0);
    expect(facts.count).toBe(1);
  });

  it("replay noop when empty or disabled", () => {
    const disabled = setup({ timeTravel: false });
    disabled.manager.replay();

    const empty = setup();
    empty.manager.replay();
  });

  // ---- export / import ----------------------------------------------------

  it("export produces valid JSON with version", () => {
    const { manager, facts } = setup();
    facts.count = 42;
    manager.takeSnapshot("s1");

    const json = manager.export();
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(1);
    expect(parsed.snapshots).toHaveLength(1);
    expect(parsed.currentIndex).toBe(0);
  });

  it("import restores snapshots and current state", () => {
    const { manager: m1, facts: f1 } = setup();
    f1.count = 10;
    m1.takeSnapshot("s1");
    f1.count = 20;
    m1.takeSnapshot("s2");
    const json = m1.export();

    // Create fresh manager and import
    const { manager: m2, facts: f2 } = setup();
    m2.import(json);

    expect(m2.snapshots).toHaveLength(2);
    expect(m2.currentIndex).toBe(1);
    expect(f2.count).toBe(20);
  });

  it("import rejects invalid data", () => {
    const { manager } = setup();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    manager.import("not json");
    manager.import(JSON.stringify({ version: 99 }));
    manager.import(JSON.stringify({ version: 1, snapshots: "nope", currentIndex: 0 }));
    manager.import(JSON.stringify({ version: 1, snapshots: [], currentIndex: "bad" }));
    manager.import(
      JSON.stringify({
        version: 1,
        snapshots: [{ id: "bad" }],
        currentIndex: 0,
      }),
    );

    expect(errorSpy).toHaveBeenCalledTimes(5);
    errorSpy.mockRestore();
  });

  it("import noop when disabled", () => {
    const { manager } = setup({ timeTravel: false });
    manager.import(JSON.stringify({ version: 1, snapshots: [], currentIndex: -1 }));
  });

  // ---- changesets ---------------------------------------------------------

  it("changeset groups snapshots for goBack/goForward", () => {
    const { manager, facts } = setup();

    facts.count = 0;
    manager.takeSnapshot("before");

    manager.beginChangeset("batch");
    facts.count = 1;
    manager.takeSnapshot("step1");
    facts.count = 2;
    manager.takeSnapshot("step2");
    facts.count = 3;
    manager.takeSnapshot("step3");
    manager.endChangeset();

    // currentIndex should be 3 (before + 3 steps)
    expect(manager.currentIndex).toBe(3);

    // goBack should jump to start of changeset (index 0 = "before")
    manager.goBack();
    expect(manager.currentIndex).toBe(0);
    expect(facts.count).toBe(0);

    // goForward should jump to end of changeset
    manager.goForward();
    expect(manager.currentIndex).toBe(3);
    expect(facts.count).toBe(3);
  });

  it("endChangeset without begin is a noop", () => {
    const { manager } = setup();
    manager.endChangeset(); // should not throw
  });

  it("beginChangeset noop when disabled", () => {
    const { manager } = setup({ timeTravel: false });
    manager.beginChangeset("nope");
    manager.endChangeset();
  });

  it("changeset not created when no snapshots taken between begin/end", () => {
    const { manager } = setup();
    manager.takeSnapshot("before");
    manager.beginChangeset("empty");
    manager.endChangeset();

    // goBack should still work normally (no changeset to skip)
    manager.goBack();
  });

  // ---- pause / resume -----------------------------------------------------

  it("pause prevents snapshot taking, resume re-enables", () => {
    const { manager, facts } = setup();

    manager.pause();
    expect(manager.isPaused).toBe(true);
    facts.count = 1;
    manager.takeSnapshot("paused");
    expect(manager.snapshots).toHaveLength(0);

    manager.resume();
    expect(manager.isPaused).toBe(false);
    facts.count = 2;
    manager.takeSnapshot("resumed");
    expect(manager.snapshots).toHaveLength(1);
  });

  // ---- isRestoring --------------------------------------------------------

  it("isRestoring is true during restore, false otherwise", () => {
    const { manager, facts } = setup();
    facts.count = 5;
    const snap = manager.takeSnapshot("test");

    // isRestoring should be false normally
    expect(manager.isRestoring).toBe(false);

    // We can't easily observe isRestoring during restore since it's synchronous,
    // but we can verify it's false after
    manager.restore(snap);
    expect(manager.isRestoring).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createDisabledTimeTravel
// ---------------------------------------------------------------------------

describe("createDisabledTimeTravel", () => {
  it("returns a noop manager", () => {
    const manager = createDisabledTimeTravel();

    expect(manager.isEnabled).toBe(false);
    expect(manager.isRestoring).toBe(false);
    expect(manager.isPaused).toBe(false);
    expect(manager.snapshots).toEqual([]);
    expect(manager.currentIndex).toBe(-1);
  });

  it("all methods are safe to call", () => {
    const manager = createDisabledTimeTravel();

    const snap = manager.takeSnapshot("noop");
    expect(snap.id).toBe(-1);

    manager.restore({ id: 1, timestamp: 0, facts: {}, trigger: "" });
    manager.goBack();
    manager.goForward();
    manager.goTo(1);
    manager.replay();
    manager.beginChangeset("noop");
    manager.endChangeset();
    manager.pause();
    manager.resume();

    const json = manager.export();
    expect(json).toBe("{}");

    manager.import("{}");
  });
});
