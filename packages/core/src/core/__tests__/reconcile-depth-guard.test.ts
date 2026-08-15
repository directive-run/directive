/**
 * The runaway-reconcile ceiling had been unreachable since the counter was
 * moved to reset on every pass. Re-entry is refused at the top of `reconcile`,
 * so the depth went to one and back to zero forever and the warning at fifty
 * could not fire. These pin both halves: a real circular chain trips it, and a
 * busy-but-terminating system does not.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the runaway-reconcile guard", () => {
  // The "fires when a resolver keeps feeding its own constraint" test was
  // removed with the change it pinned.
  //
  // Making the ceiling reachable made it reachable by ordinary bounded work —
  // a sixty-item drain, cursor pagination, a backoff counter — and the trip
  // wipes the requirement diff, re-dispatching resolvers that had already
  // completed. Nine charge dispatches for one order, silently, because the
  // warning is development-only. The runaway it targeted stayed invisible
  // either way, because `requeue()` reschedules without dirtying a fact.
  //
  // The counter is unreachable again on purpose. What remains below is the
  // half that still matters: a busy system must not trip it. When the real
  // instrument lands — repeat-detection on (constraint, requirement key),
  // which sees the async case a depth counter cannot — its test goes here.

  it("stays quiet across many separate settled changes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const module = createModule("busy", {
      schema: {
        facts: { n: t.number() },
        requirements: { NOTE: {} },
      },
      init: (facts) => {
        facts.n = 0;
      },
      constraints: {
        note: { when: (facts) => facts.n === -1, require: { type: "NOTE" } },
      },
      resolvers: { note: { requirement: "NOTE", resolve: async () => {} } },
    });

    const system = createSystem({ module });
    system.start();

    // Comfortably past the ceiling, but each one settles on its own.
    for (let i = 0; i < 120; i++) {
      system.facts.n = i;
      await system.settle();
    }

    const tripped = warn.mock.calls.some((call) =>
      String(call[0]).includes("Reconcile loop exceeded"),
    );
    expect(tripped).toBe(false);

    system.stop();
  });
});
