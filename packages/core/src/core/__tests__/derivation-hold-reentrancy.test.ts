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
        host = system as unknown as ReturnType<typeof createSystem>;
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

describe("a nested batch cannot release its parent's hold", () => {
  it("announces once per batch even when a plugin batches inside the broadcast", async () => {
    let host: ReturnType<typeof createSystem> | undefined;
    let nested = 0;
    const writer: Plugin = {
      name: "writer",
      onInit: (system) => {
        host = system as unknown as ReturnType<typeof createSystem>;
      },
      onFactsBatch: () => {
        // Writes on EVERY batch it is told about, including the ones its own
        // write causes — a mirror or an outbox behaves exactly like this. The
        // cap only stops the test running forever; it is not the guard that
        // makes the defect appear. Writing once per outer batch does NOT
        // reproduce it, which is why the first version of this test passed
        // against the broken code.
        if (nested >= 8 || !host) {
          return;
        }
        nested += 1;
        host.batch(() => {
          (host as { facts: Record<string, unknown> }).facts.log = nested;
        });
      },
    };

    const system = createSystem({ module: makeModule(), plugins: [writer] });
    system.start();
    await system.settle();

    // Counted through `subscribe`, deliberately, not `watch`. `watch` compares
    // the new value with `Object.is` and swallows a repeat — so a second
    // announcement carrying the same value is invisible to it, which is
    // exactly the extra announcement this test exists to catch.
    let announced = 0;
    system.subscribe(["doubled"], () => {
      announced += 1;
      void system.derive.doubled;
    });

    for (let i = 0; i < 4; i += 1) {
      nested = 0;
      system.events.BUMP();
      await system.settle();
    }

    expect(announced).toBe(4);

    system.destroy();
  });

  it("does not let a listener observe a value before every plugin has seen it", async () => {
    // The ordering a redaction plugin depends on: every plugin sees a batch
    // before any listener runs, so a guardrail registered after a plugin that
    // writes still redacts before consumer code can read.
    //
    // A guard, not a reproduction. A review reached this with the real PII
    // guardrail across two packages and saw an unredacted value observed one
    // tick early; this in-package version passes with or without the fix, so it
    // pins the invariant rather than proving the bug. Said plainly because a
    // test that cannot fail is worth less than it looks, and this file already
    // shipped one of those.
    const order: string[] = [];
    let host: ReturnType<typeof createSystem> | undefined;
    let nested = 0;

    const batcher: Plugin = {
      name: "batcher",
      onInit: (system) => {
        host = system as unknown as ReturnType<typeof createSystem>;
      },
      onFactsBatch: () => {
        order.push("batcher");
        // Every batch, for the same reason as the test above: writing once per
        // outer batch does not reach the path where the enclosing hold is
        // released early.
        if (nested >= 8 || !host) {
          return;
        }
        nested += 1;
        host.batch(() => {
          (host as { facts: Record<string, unknown> }).facts.log = 1;
        });
      },
    };
    const later: Plugin = {
      name: "later",
      onFactsBatch: () => {
        order.push("later");
      },
    };

    const system = createSystem({
      module: makeModule(),
      plugins: [batcher, later],
    });
    system.start();
    await system.settle();

    system.subscribe(["doubled"], () => {
      order.push("listener");
    });

    order.length = 0;
    system.batch(() => {
      system.facts.n = 5;
    });
    await system.settle();

    // Every plugin sees the batch before any listener runs.
    const firstListener = order.indexOf("listener");
    const lastPlugin = Math.max(
      order.lastIndexOf("batcher"),
      order.lastIndexOf("later"),
    );
    expect(firstListener).toBeGreaterThan(lastPlugin);

    system.destroy();
  });
});
