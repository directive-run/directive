// Ported from packages/core/src/core/__tests__/resolver-retracting-own-requirement.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

/**
 * A resolver that finishes by writing the fact that retracts its own
 * requirement completes; it is not canceled by the pass that write starts.
 *
 * c16ce1f8 made a pass whose effects are all synchronous run without
 * yielding. The pass the resolver's write scheduled then reached the
 * requirement diff before the resolver's promise settled, saw the
 * requirement gone, and aborted it: 200 of 200 runs reported
 * onResolverCancel (and still onResolverComplete) instead of only
 * onResolverComplete. 9dae092e keeps the awaited effects timing while a
 * resolver is in flight.
 *
 * Lives at packages/core/src/core/__tests__/.
 */

import { createModule, createSystem, t } from "@directive-run/core";
import { describe, expect, it } from "vitest";

type Shape = "no-effects" | "sync-effect" | "await-before-write";

async function runOnce(shape: Shape) {
  let completed = 0;
  let canceled = 0;
  const mod = createModule("load", {
    schema: {
      facts: { go: t.boolean(), done: t.boolean() },
      derivations: {},
      events: {},
      requirements: { LOAD: {} },
    },
    init: (facts) => {
      facts.go = false;
      facts.done = false;
    },
    constraints: {
      load: {
        when: (facts) => facts.go && !facts.done,
        require: { type: "LOAD" },
      },
    },
    effects:
      shape === "sync-effect"
        ? {
            mirror: {
              run: (facts) => {
                void facts.done;
              },
            },
          }
        : {},
    resolvers: {
      load: {
        requirement: "LOAD",
        resolve: async (_req, ctx) => {
          if (shape === "await-before-write") {
            await Promise.resolve();
          }
          ctx.facts.done = true;
        },
      },
    },
  });
  const system = createSystem({
    module: mod,
    plugins: [
      {
        name: "count",
        onResolverComplete: () => {
          completed++;
        },
        onResolverCancel: () => {
          canceled++;
        },
      },
    ],
  });
  system.start();
  await system.settle();
  system.facts.go = true;
  await system.settle();
  await new Promise((resolve) => setTimeout(resolve, 0));
  system.destroy();

  return { completed, canceled };
}

describe("a resolver whose own write retracts its requirement", () => {
  for (const shape of [
    "no-effects",
    "sync-effect",
    "await-before-write",
  ] as const) {
    it(`completes and is never canceled (${shape})`, async () => {
      let completed = 0;
      let canceled = 0;
      for (let i = 0; i < 50; i++) {
        const r = await runOnce(shape);
        completed += r.completed;
        canceled += r.canceled;
      }

      expect(completed).toBe(50);
      expect(canceled).toBe(0);
    });
  }
});
