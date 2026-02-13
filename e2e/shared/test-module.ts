/**
 * Shared Directive module used by all 5 framework fixtures.
 * Exercises facts, derivations, events, constraints, resolvers, and time-travel.
 */
import { createModule, t, type ModuleSchema } from "directive";

const testSchema = {
  facts: {
    count: t.number(),
    name: t.string(),
    items: t.array(t.string()),
    status: t.string<"idle" | "loading" | "done" | "error">(),
  },
  derivations: {
    doubled: t.number(),
    isPositive: t.boolean(),
    itemCount: t.number(),
    summary: t.any<{ phase: string; doubled: number; isPositive: boolean }>(),
  },
  events: {
    increment: {},
    decrement: {},
    setName: { name: t.string() },
    addItem: { item: t.string() },
    reset: {},
    triggerLoad: {},
  },
  requirements: {
    LOAD_DATA: {},
  },
} satisfies ModuleSchema;

export const testModule = createModule("test", {
  schema: testSchema,

  init: (facts) => {
    facts.count = 0;
    facts.name = "hello";
    facts.items = [];
    facts.status = "idle";
  },

  derive: {
    doubled: (facts) => facts.count * 2,
    isPositive: (facts) => facts.count > 0,
    itemCount: (facts) => facts.items.length,
    summary: (facts, derive) => ({
      phase: facts.status,
      doubled: derive.doubled,
      isPositive: derive.isPositive,
    }),
  },

  events: {
    increment: (facts) => {
      facts.count = facts.count + 1;
    },
    decrement: (facts) => {
      facts.count = facts.count - 1;
    },
    setName: (facts, { name }) => {
      facts.name = name;
    },
    addItem: (facts, { item }) => {
      facts.items = [...facts.items, item];
    },
    reset: (facts) => {
      facts.count = 0;
      facts.name = "hello";
      facts.items = [];
      facts.status = "idle";
    },
    triggerLoad: (facts) => {
      facts.status = "loading";
    },
  },

  constraints: {
    loadWhenTriggered: {
      when: (facts) => facts.status === "loading",
      require: { type: "LOAD_DATA" },
    },
  },

  resolvers: {
    loadData: {
      requirement: "LOAD_DATA",
      resolve: async (_req, ctx) => {
        await new Promise((r) => setTimeout(r, 50));
        ctx.facts.items = [...ctx.facts.items, "loaded-item"];
        ctx.facts.status = "done";
      },
    },
  },
});

export type TestModule = typeof testModule;
