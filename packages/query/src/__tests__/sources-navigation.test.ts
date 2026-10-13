// @ts-nocheck – withQueries config typing, same as the sibling suites
import { createModule, createSystem, t } from "@directive-run/core";
import type { ModuleSchema } from "@directive-run/core";
import { describe, expect, it } from "vitest";
import { createQuery, createSubscription, withQueries } from "../index.js";

/**
 * Query's stream, polling, focus, reconnect and expiry are sources: each one
 * performs an act, subscribing or arming a timer. A history rewind re-runs
 * effects so views match the rewound state, but it never re-attaches a
 * source, so no undo re-subscribes a stream or re-arms a timer.
 */
describe("query sources and history navigation", () => {
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

  it("does not re-arm the polling timer on goBack", async () => {
    const intervals: number[] = [];
    const realSetInterval = globalThis.setInterval;
    globalThis.setInterval = ((fn: () => void, ms: number) => {
      intervals.push(ms);

      return realSetInterval(fn, ms);
    }) as typeof setInterval;
    try {
      const query = createQuery({
        name: "user",
        key: (f) => (f.userId ? { userId: f.userId as string } : null),
        fetcher: async (p) => ({ id: p.userId }),
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchInterval: 10_000,
      });
      const mod = createModule(
        "test",
        withQueries([query], {
          schema: {
            facts: { userId: t.string(), other: t.number() },
            derivations: {},
            events: {},
            requirements: {},
          } satisfies ModuleSchema,
          init: (facts) => {
            facts.userId = "1";
            facts.other = 0;
          },
        }),
      );
      const system = createSystem({
        module: mod,
        history: { maxSnapshots: 50 },
      });
      await system.start();
      await system.settle();
      system.facts.other = 1;
      await system.settle();
      const armed = intervals.filter((ms) => ms === 10_000).length;
      expect(armed).toBe(1);

      system.history!.goBack();
      await system.settle();
      expect(intervals.filter((ms) => ms === 10_000).length).toBe(armed);

      await system.stop();
    } finally {
      globalThis.setInterval = realSetInterval;
    }
  });
});
