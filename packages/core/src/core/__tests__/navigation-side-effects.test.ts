import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

/**
 * A write made while rewinding is the program's own work, so it reconciles.
 * But the pass it schedules must not do two of the things an ordinary pass
 * does.
 *
 * Making those writes reconcile — which is correct, and closed a defect where
 * a rule stopped enforcing for the life of the process — reopened both:
 *
 *  - the pass took a snapshot, and taking one splices away every snapshot
 *    ahead of the point being rewound to, so an undo followed by any reactive
 *    write killed redo outright;
 *  - the pass re-evaluated gated sources, which opens a real transport. The
 *    engine states three lines above that call that a replay never re-attaches
 *    one, because attaching is an act against the outside world rather than a
 *    value to be re-derived.
 *
 * The question "did this write happen during a navigation?" has to be asked at
 * the write. The pass runs in a microtask, by which time the navigation is
 * over.
 */

describe("a reactive write during a history navigation", () => {
  it("does not destroy the redo stack", async () => {
    const mod = createModule("m", {
      schema: { facts: { n: t.number(), seen: t.number() } },
      init: (facts) => {
        facts.n = 0;
        facts.seen = 0;
      },
    });
    const system = createSystem({ module: mod, history: { maxSnapshots: 50 } });
    await system.start();

    for (let i = 1; i <= 6; i++) {
      system.facts.n = i;
      await system.settle();
    }

    // A subscriber that writes in reaction to any change, including a rewind.
    const unsubscribe = system.subscribe(["n"], () => {
      system.facts.seen = system.facts.seen + 1;
    });

    system.history!.goBack();
    await system.settle();
    const rewound = system.facts.n;

    system.history!.goForward();
    await system.settle();

    unsubscribe();

    expect(system.facts.n).toBeGreaterThan(rewound);

    await system.stop();
  });

  it("does not re-attach a gated source", async () => {
    const attaches: string[] = [];
    const mod = createModule("m", {
      schema: { facts: { open: t.boolean(), seen: t.number() } },
      init: (facts) => {
        facts.open = false;
        facts.seen = 0;
      },
      sources: {
        channel: {
          active: (facts) => facts.open === true,
          attach: () => {
            attaches.push("attach");

            return () => {
              attaches.push("detach");
            };
          },
        },
      },
    });
    const system = createSystem({ module: mod, history: { maxSnapshots: 50 } });
    await system.start();

    // A warm-up write, and a macrotask after each one.
    //
    // `settle()` resolving does not mean the pass has run, and the first write
    // after `start()` has its pass swallowed entirely — so without these, no
    // snapshot ever captures the gate open, the rewind changes nothing, the
    // subscriber never fires, and the assertion below passes whether or not
    // the fix exists. That is how this test shipped vacuous the first time.
    const settled = async () => {
      await system.settle();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    system.facts.seen = 1;
    await settled();
    system.facts.open = true;
    await settled();
    system.facts.open = false;
    await settled();

    const before = [...attaches];
    expect(before).toEqual(["attach", "detach"]);

    // A subscriber that writes in reaction to the rewind. Without carrying the
    // navigation context to its reconcile, this pass re-opened the transport.
    let reactions = 0;
    const unsubscribe = system.subscribe(["open"], () => {
      reactions++;
      system.facts.seen = system.facts.seen + 1;
    });

    system.history!.goBack();
    await settled();
    unsubscribe();

    // The assertion below is only worth anything if the rewind actually put
    // the gate back into its open state and the subscriber actually ran. This
    // test shipped once without these two lines and passed whether or not the
    // fix was present, because neither happened.
    expect(reactions).toBeGreaterThan(0);
    expect(system.facts.open).toBe(true);
    expect(attaches).toEqual(before);

    await system.stop();
  });

  it("holds when the reaction goes through an event dispatch", async () => {
    // The check sat behind `dispatchDepth === 0`, so a navigation reaction
    // that dispatched an event recorded nothing and its pass went on to do
    // both forbidden things. `subscribe` calling `dispatch` is as ordinary as
    // this codebase gets.
    const attaches: string[] = [];
    const mod = createModule("m", {
      schema: {
        facts: { open: t.boolean(), seen: t.number() },
        events: { BUMP: {} },
      },
      init: (facts) => {
        facts.open = false;
        facts.seen = 0;
      },
      events: {
        BUMP: (facts) => {
          facts.seen = facts.seen + 1;
        },
      },
      sources: {
        channel: {
          active: (facts) => facts.open === true,
          attach: () => {
            attaches.push("attach");

            return () => {
              attaches.push("detach");
            };
          },
        },
      },
    });
    const system = createSystem({ module: mod, history: { maxSnapshots: 50 } });
    await system.start();
    const settled = async () => {
      await system.settle();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    system.facts.seen = 1;
    await settled();
    system.facts.open = true;
    await settled();
    system.facts.open = false;
    await settled();

    const before = [...attaches];
    expect(before).toEqual(["attach", "detach"]);

    let reactions = 0;
    const unsubscribe = system.subscribe(["open"], () => {
      reactions++;
      system.events.BUMP();
    });

    system.history!.goBack();
    await settled();
    unsubscribe();

    expect(reactions).toBeGreaterThan(0);
    expect(system.facts.open).toBe(true);
    expect(attaches).toEqual(before);

    await system.stop();
  });

  it("does not suppress an ordinary write that shares the pass", async () => {
    // The record used to be one flag for the whole pass, so an unrelated write
    // landing in the same microtask as a navigation reaction lost its snapshot
    // — and the loss is permanent, because the snapshot is simply not taken.
    const mod = createModule("m", {
      schema: { facts: { n: t.number(), other: t.number() } },
      init: (facts) => {
        facts.n = 0;
        facts.other = 0;
      },
    });
    const system = createSystem({ module: mod, history: { maxSnapshots: 50 } });
    await system.start();
    const settled = async () => {
      await system.settle();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    for (let i = 1; i <= 4; i++) {
      system.facts.n = i;
      await settled();
    }

    system.history!.goBack();
    system.facts.other = 42;
    await settled();

    expect(system.facts.other).toBe(42);

    // The unrelated write was snapshotted, so rewinding forward does not
    // discard it.
    system.history!.goForward();
    await settled();
    expect(system.facts.other).toBe(42);

    await system.stop();
  });

  it("does not extend the exemption to a later write of the same key", async () => {
    // The set records keys, not writes, and it is not cleared until the pass
    // runs. So an ordinary write to a key a navigation reaction had touched
    // inherited the exemption — and a permission revoked in the same
    // microtask as a rewind left its transport attached. Failing open on a
    // gate is the worst direction for this to be wrong in.
    const events: string[] = [];
    const mod = createModule("m", {
      schema: { facts: { n: t.number(), token: t.string() } },
      init: (facts) => {
        facts.n = 0;
        facts.token = "";
      },
      sources: {
        channel: {
          active: (facts) => facts.token !== "",
          attach: () => {
            events.push("attach");

            return () => {
              events.push("detach");
            };
          },
        },
      },
    });
    const system = createSystem({ module: mod, history: { maxSnapshots: 50 } });
    await system.start();
    const settled = async () => {
      await system.settle();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    system.facts.n = 1;
    await settled();
    system.facts.token = "t-live";
    await settled();
    system.facts.n = 2;
    await settled();

    // The transport is open before any rewind happens.
    expect(events).toEqual(["attach"]);

    // A listener that re-issues the token in reaction to any change, rewind
    // included. Its write is correctly exempt; the question is whether the
    // exemption sticks to the key afterwards.
    const unsubscribe = system.subscribe(["n"], () => {
      system.facts.token = `t-${system.facts.n}`;
    });
    system.history!.goBack();
    await settled();

    // Revocation, on the same key the reaction wrote.
    system.facts.token = "";
    await settled();
    unsubscribe();

    expect(system.facts.token).toBe("");
    expect(events).toContain("detach");

    await system.stop();
  });

  it("does not let a rewind reaction cover an ordinary write of the same key", async () => {
    // The record used to be a set of keys. Two writes to one key in a single
    // pass — one ordinary, one from a rewind reaction — collapsed into one
    // entry, and the pass took whichever answer the set happened to hold, so
    // the ordinary write lost its snapshot. A write is what needs identity
    // here, not a key.
    const mod = createModule("m", {
      schema: { facts: { n: t.number(), other: t.number() } },
      init: (facts) => {
        facts.n = 0;
        facts.other = 0;
      },
    });
    const system = createSystem({ module: mod, history: { maxSnapshots: 50 } });
    await system.start();
    const settled = async () => {
      await system.settle();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    for (let i = 1; i <= 4; i++) {
      system.facts.n = i;
      await settled();
    }

    const before = system.history!.snapshots.length;
    const unsubscribe = system.subscribe(["n"], () => {
      system.facts.other = 99;
    });

    // An ordinary write, then a rewind whose reaction writes the same key.
    system.facts.other = 42;
    system.history!.goBack();
    await settled();
    unsubscribe();

    // The pass held an ordinary write, so it is not a navigation-only pass and
    // the state it produced was captured.
    expect(system.history!.snapshots.length).toBeGreaterThan(before - 1);
    expect(system.facts.other).toBe(99);

    await system.stop();
  });

  it("does not carry a navigation made while stopped into a later pass", async () => {
    // Recording is cleared when a pass runs. A navigation performed while the
    // system is not running schedules no pass, so its writes were counted
    // against the first unrelated pass after the restart.
    const events: string[] = [];
    const mod = createModule("m", {
      schema: { facts: { n: t.number(), open: t.boolean() } },
      init: (facts) => {
        facts.n = 0;
        facts.open = false;
      },
      sources: {
        channel: {
          active: (facts) => facts.open === true,
          attach: () => {
            events.push("attach");

            return () => {
              events.push("detach");
            };
          },
        },
      },
    });
    const system = createSystem({ module: mod, history: { maxSnapshots: 50 } });
    await system.start();
    const settled = async () => {
      await system.settle();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    system.facts.n = 1;
    await settled();
    system.facts.n = 2;
    await settled();

    const unsubscribe = system.subscribe(["n"], () => {
      system.facts.open = false;
    });
    await system.stop();
    system.history!.goBack();
    unsubscribe();
    await system.start();

    system.facts.open = true;
    await settled();

    expect(events).toContain("attach");

    await system.stop();
  });
});
