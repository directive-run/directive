// Ported from packages/core/src/core/__tests__/batched-resolver-retracting-own-requirement.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

/**
 * Same race as resolver-retracting-own-requirement.test.ts, for a batched
 * resolver. Batched runs are not counted by getInflightCount(), so the
 * engine takes the synchronous effects path while one runs, and the pass its
 * own write schedules reports it canceled. Passes on fix/1.35-integration,
 * FAILS on perf/1.35-cost @ 78d2d131 (50 of 50 canceled).
 *
 * Lives at packages/core/src/core/__tests__/.
 */

import { createModule, createSystem, t } from "@directive-run/core";
import { expect, it } from "vitest";

it("a batched resolver whose own write retracts its requirement is not canceled", async () => {
  let completed = 0;
  let canceled = 0;
  for (let i = 0; i < 50; i++) {
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
      // A synchronous effect: the shape that takes the synchronous path.
      effects: {
        mirror: {
          run: (facts) => {
            void facts.done;
          },
        },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          batch: { enabled: true, windowMs: 0 },
          resolveBatch: async (_reqs, ctx) => {
            await Promise.resolve();
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
    await new Promise((resolve) => setTimeout(resolve, 5));
    system.destroy();
  }

  expect(completed).toBe(50);
  expect(canceled).toBe(0);
});
