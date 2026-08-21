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

    system.facts.open = true;
    await system.settle();
    system.facts.open = false;
    await system.settle();

    const before = [...attaches];

    // A subscriber that writes in reaction to the rewind. Without carrying the
    // navigation context to its reconcile, this pass re-opened the transport.
    const unsubscribe = system.subscribe(["open"], () => {
      system.facts.seen = system.facts.seen + 1;
    });

    system.history!.goBack();
    await system.settle();
    unsubscribe();

    expect(attaches).toEqual(before);

    await system.stop();
  });
});
