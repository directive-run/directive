/**
 * A batch can begin while another is still open, and the hold has to survive it.
 *
 * `onFactsBatch` is broadcast to plugins before the outer batch's derivation
 * hold is released, so a plugin that writes in response to a batch opens a
 * nested one from inside that window. The engine kept a single release closure,
 * so the nested hold overwrote the outer one and the outer release was lost.
 * The manager's depth counter never returned to zero, and from that moment
 * every derivation notification was held forever.
 *
 * What that looks like from outside: `watch` and `subscribe` stop firing for
 * the life of the process while the derived values themselves still read
 * correctly on demand. Nothing throws. A screen stops updating and the runtime
 * looks fine, so it gets reported against whatever renders it.
 */

import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import type { Plugin } from "../types/plugins.js";

function makeModule() {
  return createModule("hold", {
    schema: {
      facts: { n: t.number(), log: t.number() },
      derivations: { doubled: t.number() },
      events: { BUMP: {} },
    },
    init: (facts) => {
      facts.n = 0;
      facts.log = 0;
    },
    derive: { doubled: (facts) => facts.n * 2 },
    events: {
      BUMP: (facts) => {
        facts.n = facts.n + 1;
      },
    },
  });
}

describe("derivation hold re-entrancy", () => {
  it("survives a plugin that opens a batch from inside onFactsBatch", async () => {
    let host: ReturnType<typeof createSystem> | undefined;
    let written = false;

    // A plugin reacting to a batch by writing is ordinary — a mirror, a
    // counter, an outbox. It is also the one thing that opens a batch while
    // the outer hold is still outstanding.
    const writer: Plugin = {
      name: "writer",
      onInit: (system) => {
        host = system as ReturnType<typeof createSystem>;
      },
      onFactsBatch: () => {
        if (written || !host) {
          return;
        }
        written = true;
        host.batch(() => {
          (host as { facts: Record<string, unknown> }).facts.log = 1;
        });
      },
    };

    const system = createSystem({ module: makeModule(), plugins: [writer] });
    system.start();
    await system.settle();

    let fired = 0;
    system.watch("doubled", () => {
      fired += 1;
    });

    const seen: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      system.events.BUMP();
      await system.settle();
      seen.push(fired);
    }

    // Every change is announced. Before the fix this was [0, 0, 0, 0] — and
    // `doubled` still read 8, which is why the failure is so hard to place.
    expect(seen).toEqual([1, 2, 3, 4]);
    expect(system.derive.doubled).toBe(8);

    system.destroy();
  });

  it("still announces once per batch when nothing nests", async () => {
    const system = createSystem({ module: makeModule() });
    system.start();
    await system.settle();

    let fired = 0;
    system.watch("doubled", () => {
      fired += 1;
    });

    system.batch(() => {
      system.facts.n = 1;
      system.facts.log = 1;
    });
    await system.settle();

    // The point of the hold is that a batch announces once, not per write.
    // Making it re-entrant must not turn one announcement into two.
    expect(fired).toBe(1);

    system.destroy();
  });
});
