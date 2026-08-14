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
  it("fires when a resolver keeps feeding its own constraint", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Bounded deliberately. A genuinely unbounded chain cannot be tested here:
    // the passes are scheduled as microtasks, so they starve the timer phase
    // and no timeout can escape one. Sixty is past the ceiling of fifty and
    // still terminates, which is what makes the assertion below deterministic.
    const PASSES = 60;

    const module = createModule("spin", {
      schema: {
        facts: { n: t.number() },
        requirements: { BUMP: { at: t.number() } },
      },
      init: (facts) => {
        facts.n = 0;
      },
      constraints: {
        // Each pass emits a distinct requirement, so the resolver is genuinely
        // re-dispatched rather than deduped away by a stable identity.
        bump: {
          when: (facts) => facts.n < PASSES,
          require: (facts: { n: number }) => ({ type: "BUMP", at: facts.n }),
        },
      },
      resolvers: {
        bump: {
          requirement: "BUMP",
          resolve: async (_req, context) => {
            context.facts.n += 1;
          },
        },
      },
    });

    const system = createSystem({ module });
    system.start();
    await system.settle();

    expect(system.facts.n).toBe(PASSES);

    const tripped = warn.mock.calls.some((call) =>
      String(call[0]).includes("Reconcile loop exceeded"),
    );
    expect(tripped).toBe(true);

    system.stop();
  });

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
