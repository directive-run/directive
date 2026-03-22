/**
 * Counter — The simplest Directive module.
 *
 * Demonstrates: facts, events, derivations, one constraint, one resolver.
 * Total: ~40 lines.
 */

import { createModule, createSystem, t, type ModuleSchema } from "@directive-run/core";

const schema = {
  facts: {
    count: t.number(),
  },
  derivations: {
    doubled: t.number(),
    isPositive: t.boolean(),
  },
  events: {
    increment: {},
    decrement: {},
    reset: {},
  },
  requirements: {
    CLAMP_TO_ZERO: {},
  },
} satisfies ModuleSchema;

export const counterModule = createModule("counter", {
  schema,

  init: (facts) => {
    facts.count = 0;
  },

  derive: {
    doubled: (facts) => facts.count * 2,
    isPositive: (facts) => facts.count > 0,
  },

  events: {
    increment: (facts) => { facts.count += 1; },
    decrement: (facts) => { facts.count -= 1; },
    reset: (facts) => { facts.count = 0; },
  },

  // When count goes negative, automatically fix it
  constraints: {
    noNegative: {
      when: (facts) => facts.count < 0,
      require: { type: "CLAMP_TO_ZERO" },
    },
  },

  resolvers: {
    clamp: {
      requirement: "CLAMP_TO_ZERO",
      resolve: async (req, context) => {
        context.facts.count = 0;
      },
    },
  },
});

export const system = createSystem({ module: counterModule });
