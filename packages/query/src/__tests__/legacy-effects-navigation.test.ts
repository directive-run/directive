// @ts-nocheck – withQueries config typing, same as the sibling suites
import { createModule, createSystem, t } from "@directive-run/core";
import type { ModuleSchema } from "@directive-run/core";
import { describe, expect, it } from "vitest";
import { createSubscription, withQueries } from "../index.js";

/**
 * Query's stream, polling, focus, reconnect and expiry effects perform acts:
 * subscribing, arming a timer. A history rewind re-runs effects so views match
 * the rewound state, and these must sit that out, or every undo re-subscribes.
 */
describe("query effects and history navigation", () => {
  it("does not re-subscribe a stream on goBack or goForward", async () => {
    const opened: string[] = [];
    const sub = createSubscription({
      name: "price",
      key: (facts: Record<string, unknown>) =>
        facts.ticker ? { ticker: facts.ticker as string } : null,
      subscribe: (key: { ticker: string }) => {
        opened.push(key.ticker);

        return undefined;
      },
    });
    const mod = createModule(
      "test",
      withQueries([sub], {
        schema: {
          facts: { ticker: t.string() },
          derivations: {},
          events: {},
          requirements: {},
        } satisfies ModuleSchema,
        init: (facts) => {
          facts.ticker = "A";
        },
      }),
    );
    const system = createSystem({ module: mod, history: { maxSnapshots: 50 } });
    await system.start();
    await system.settle();
    system.facts.ticker = "B";
    await system.settle();
    system.facts.ticker = "C";
    await system.settle();
    const before = [...opened];
    expect(before).toEqual(["A", "B", "C"]);

    // Back until the ticker itself moves; the subscription's own state writes
    // take snapshots too.
    const history = system.history!;
    while (system.facts.ticker === "C" && history.currentIndex > 0) {
      history.goBack();
      await system.settle();
    }
    expect(system.facts.ticker).toBe("B");
    while (
      system.facts.ticker !== "C" &&
      history.currentIndex < history.snapshots.length - 1
    ) {
      history.goForward();
      await system.settle();
    }
    expect(system.facts.ticker).toBe("C");

    expect(opened).toEqual(before);

    await system.stop();
  });
});
