/**
 * ctx.requeue() must survive a resolver that is still running when the
 * pass its own write scheduled reaches the end.
 *
 * The requeue used to be applied at the end of the very next pass. If the
 * requeuing resolver had not finished by then, the follow-up pass
 * re-dispatched a requirement whose resolver was still in flight, the
 * dispatch was dropped as a duplicate, and the requeue was lost for good.
 * Microtask timing hid it for a resolver that returned straight after
 * requeue(); any resolver that does more work after requeue() lost it.
 *
 * Lives at packages/core/src/core/__tests__/.
 */

import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

function build(afterRequeue: () => Promise<void>) {
  const runs: string[] = [];
  const mod = createModule("chain", {
    schema: {
      facts: { status: t.string(), kind: t.string() },
      derivations: {},
      events: { start: {} },
      requirements: { PROCESS: {} },
    },
    init: (facts) => {
      facts.status = "idle";
      facts.kind = "";
    },
    events: {
      start: (facts) => {
        facts.status = "processing";
        facts.kind = "first";
      },
    },
    constraints: {
      process: {
        // Same requirement id for both steps, so only requeue() re-fires it.
        when: (facts) => facts.status === "processing" && facts.kind !== "",
        require: { type: "PROCESS" },
      },
    },
    resolvers: {
      process: {
        requirement: "PROCESS",
        resolve: async (_req, ctx) => {
          const kind = ctx.facts.kind;
          runs.push(kind);
          if (kind === "first") {
            ctx.facts.kind = "second";
            ctx.requeue();
            // Still running when the pass the write above scheduled ends.
            await afterRequeue();

            return;
          }
          ctx.facts.status = "done";
          ctx.facts.kind = "";
        },
      },
    },
  });
  const system = createSystem({ module: mod });

  return { system, runs };
}

describe("ctx.requeue() while the requeuing resolver is still in flight", () => {
  it("re-fires once the resolver finishes (macrotask after requeue)", async () => {
    const { system, runs } = build(
      () => new Promise((resolve) => setTimeout(resolve, 10)),
    );
    system.start();
    await system.settle();
    system.events.start();
    await system.settle();

    expect(runs).toEqual(["first", "second"]);
    expect(system.facts.status).toBe("done");
    system.destroy();
  });

  it("re-fires once the resolver finishes (a few microtasks after requeue)", async () => {
    const { system, runs } = build(async () => {
      for (let i = 0; i < 8; i++) {
        await Promise.resolve();
      }
    });
    system.start();
    await system.settle();
    system.events.start();
    await system.settle();

    expect(runs).toEqual(["first", "second"]);
    expect(system.facts.status).toBe("done");
    system.destroy();
  });

  it("does not re-fire a requeue twice", async () => {
    const { system, runs } = build(
      () => new Promise((resolve) => setTimeout(resolve, 10)),
    );
    system.start();
    await system.settle();
    system.events.start();
    await system.settle();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await system.settle();

    expect(runs).toEqual(["first", "second"]);
    system.destroy();
  });
});
