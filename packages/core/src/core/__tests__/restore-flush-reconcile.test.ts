import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

/**
 * A restore has two gates, and they were not the same gate.
 *
 * `store.batch()` decrements its depth counter *before* it flushes, so every
 * listener that runs during a restore's flush writes on the unbatched path.
 * That path asked "is a restore in flight?" — and it is, for the whole of
 * `deserializeFacts` — so the write was committed and then dropped from
 * reconciliation.
 *
 * The consequence is that a constraint stops enforcing. Permanently: the fact
 * reads back correctly, the ledger records the write as the program's, and no
 * later write recovers it, because the key was never added to the changed set.
 *
 * The batched gate was moved to per-write provenance and this one was left
 * behind — so the fix covered the path a subscriber cannot reach and missed
 * the one it does.
 */

describe("a write made while a restore is flushing", () => {
  it("is reconciled, so anything waiting on it still runs", async () => {
    const fired: string[] = [];
    const mod = createModule("m", {
      schema: { facts: { n: t.number(), armed: t.boolean() } },
      init: (facts) => {
        facts.n = 0;
        facts.armed = false;
      },
      effects: {
        lockdown: {
          run: (facts) => {
            if (facts.armed === true) fired.push("lockdown");
          },
        },
      },
    });
    const system = createSystem({ module: mod, history: { maxSnapshots: 50 } });
    await system.start();

    system.facts.n = 1;
    await system.settle();
    system.facts.n = 2;
    await system.settle();

    const before = fired.length;

    // A subscriber that arms the system in reaction to a change. This runs
    // inside the restore's flush, on the unbatched path.
    const unsubscribe = system.subscribe(["n"], () => {
      if (!system.facts.armed) {
        system.facts.armed = true;
      }
    });

    system.history!.goBack();
    await system.settle();
    unsubscribe();

    expect(system.facts.armed).toBe(true);
    expect(fired.length).toBeGreaterThan(before);

    await system.stop();
  });
});
