import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

const cart = createModule("cart", {
  schema: {
    facts: {
      status: t.string<"idle" | "ready">(),
      items: t.array<string>().of(t.string()),
      lastUpdatedMs: t.number(),
      nowMs: t.number(),
    },
    derivations: {
      isReady: t.boolean(),
      itemCount: t.number(),
      topItem: t.string().nullable(),
      readyAndHasItems: t.boolean(),
      isStale: t.boolean(),
    },
    events: { TICK: {} },
    requirements: { TRIM_CART: {} },
  },

  init: (facts) => {
    facts.status = "idle";
    facts.items = [];
    facts.lastUpdatedMs = 0;
    facts.nowMs = 0;
  },

  events: {
    TICK: (facts) => {
      facts.nowMs = Date.now();
    },
  },

  derive: {
    isReady: (facts) => facts.status === "ready",
    itemCount: (facts) => facts.items.length,
    topItem: (facts) => facts.items[0] ?? null,
    readyAndHasItems: (_facts, derived) =>
      derived.isReady && derived.itemCount > 0,
    isStale: (facts) => facts.nowMs - facts.lastUpdatedMs > 5000,
  },

  effects: {
    warnOnLargeCart: {
      run: (facts, prev) => {
        if (
          prev?.items.length !== facts.items.length &&
          facts.items.length > 100
        ) {
          console.log("over 100");
        }
      },
    },
  },

  constraints: {
    trim: {
      when: (_facts, derived) => derived.itemCount > 100,
      require: { type: "TRIM_CART" },
    },
  },

  resolvers: {
    trim: {
      requirement: "TRIM_CART",
      resolve: async (_req, context) => {
        context.facts.items = context.facts.items.slice(0, 100);
      },
    },
  },
});

describe("docs/derivations.md — the example on that page must keep compiling", () => {
  it("compiles and composes", () => {
    const system = createSystem({ module: cart });
    system.start();

    system.facts.status = "ready";
    system.facts.items = ["a", "b"];

    expect(system.derive.isReady).toBe(true);
    expect(system.derive.itemCount).toBe(2);
    expect(system.derive.topItem).toBe("a");
    expect(system.derive.readyAndHasItems).toBe(true);
  });
});
