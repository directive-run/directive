/**
 * Tests for ctx.requeue() — explicit constraint re-trigger after the
 * resolver mutates state in a way that re-satisfies the SAME constraint.
 *
 * Default behavior: when a resolver writes facts that cause its owning
 * constraint to re-emit the same requirement ID, Directive's diff
 * suppresses the re-fire (the requirement is "unchanged" between
 * reconciliation passes). ctx.requeue() opts that single requirement
 * out of the suppression for one cycle.
 */

import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";
import { flushMicrotasks } from "../../utils/testing.js";

/** Flush microtasks + a couple of setTimeout rounds for chained reconciles. */
async function flush(): Promise<void> {
  await flushMicrotasks();
  await new Promise((r) => setTimeout(r, 0));
  await flushMicrotasks();
  await new Promise((r) => setTimeout(r, 0));
  await flushMicrotasks();
}

describe("ctx.requeue() — explicit constraint re-trigger", () => {
  it("re-fires the same constraint when ctx.requeue() is called", async () => {
    const processedKinds: string[] = [];

    const mod = createModule("chain", {
      schema: {
        facts: {
          status: t.string(),
          // String discriminator (instead of a nested object) — keeps
          // the test free of `t.object<T>()` generic noise from the
          // pre-existing tree mods.
          pendingKind: t.string(),
          finalCount: t.number(),
        },
        derivations: {},
        events: { start: {} },
        requirements: { PROCESS: {} },
      },
      init: (facts) => {
        facts.status = "idle";
        facts.pendingKind = "";
        facts.finalCount = 0;
      },
      events: {
        start: (facts) => {
          facts.status = "processing";
          facts.pendingKind = "first";
        },
      },
      constraints: {
        process: {
          // Same `when` for both kinds — produces the SAME requirement ID
          // on each evaluation. Without requeue() the resolver would fire
          // only once.
          when: (facts) =>
            facts.status === "processing" && facts.pendingKind !== "",
          require: { type: "PROCESS" },
        },
      },
      resolvers: {
        processOne: {
          requirement: "PROCESS",
          resolve: async (_req, ctx) => {
            const kind = ctx.facts.pendingKind;
            if (!kind) return;

            processedKinds.push(kind);
            ctx.facts.finalCount = ctx.facts.finalCount + 1;

            if (kind === "first") {
              // Chain to the second step — write the next discriminator
              // and request the constraint be re-evaluated with it.
              ctx.facts.pendingKind = "second";
              ctx.requeue();
              return;
            }

            // 'second' is the terminal step
            ctx.facts.status = "done";
            ctx.facts.pendingKind = "";
          },
        },
      },
    });

    const system = createSystem({ module: mod });
    system.start();

    await flush();
    system.events.start();
    await flush();

    expect(processedKinds).toEqual(["first", "second"]);
    expect(system.facts.status).toBe("done");
    expect(system.facts.finalCount).toBe(2);

    system.destroy();
  });

  it("WITHOUT ctx.requeue(), default suppression prevents re-fire (BC guarantee)", async () => {
    const processedKinds: string[] = [];

    const mod = createModule("noRequeue", {
      schema: {
        facts: {
          status: t.string(),
          pendingKind: t.string(),
          finalCount: t.number(),
        },
        derivations: {},
        events: { start: {} },
        requirements: { PROCESS: {} },
      },
      init: (facts) => {
        facts.status = "idle";
        facts.pendingKind = "";
        facts.finalCount = 0;
      },
      events: {
        start: (facts) => {
          facts.status = "processing";
          facts.pendingKind = "first";
        },
      },
      constraints: {
        process: {
          when: (facts) =>
            facts.status === "processing" && facts.pendingKind !== "",
          require: { type: "PROCESS" },
        },
      },
      resolvers: {
        processOne: {
          requirement: "PROCESS",
          // Same logic as above but WITHOUT calling ctx.requeue()
          resolve: async (_req, ctx) => {
            const kind = ctx.facts.pendingKind;
            if (!kind) return;

            processedKinds.push(kind);
            ctx.facts.finalCount = ctx.facts.finalCount + 1;

            if (kind === "first") {
              ctx.facts.pendingKind = "second";
              // NO ctx.requeue() — same requirement ID is suppressed.
              return;
            }

            ctx.facts.status = "done";
            ctx.facts.pendingKind = "";
          },
        },
      },
    });

    const system = createSystem({ module: mod });
    system.start();

    await flush();
    system.events.start();
    await flush();

    // Only "first" is processed; "second" is suppressed.
    expect(processedKinds).toEqual(["first"]);
    expect(system.facts.finalCount).toBe(1);
    expect(system.facts.status).toBe("processing");

    system.destroy();
  });

  it("ctx.requeue() supports a counted drain chain", async () => {
    const processedCount = { current: 0 };

    const mod = createModule("drain", {
      schema: {
        facts: {
          status: t.string(),
          remaining: t.number(),
        },
        derivations: {},
        events: { start: {} },
        requirements: { DRAIN: {} },
      },
      init: (facts) => {
        facts.status = "idle";
        facts.remaining = 3;
      },
      events: {
        start: (facts) => {
          facts.status = "draining";
        },
      },
      constraints: {
        drain: {
          when: (facts) => facts.status === "draining" && facts.remaining > 0,
          require: { type: "DRAIN" },
        },
      },
      resolvers: {
        drainOne: {
          requirement: "DRAIN",
          resolve: async (_req, ctx) => {
            processedCount.current += 1;
            ctx.facts.remaining = ctx.facts.remaining - 1;
            if (ctx.facts.remaining > 0) {
              ctx.requeue();
            } else {
              ctx.facts.status = "done";
            }
          },
        },
      },
    });

    const system = createSystem({ module: mod });
    system.start();

    await flush();
    system.events.start();
    await flush();

    expect(processedCount.current).toBe(3);
    expect(system.facts.remaining).toBe(0);
    expect(system.facts.status).toBe("done");

    system.destroy();
  });

  it("ctx.requeue() is a no-op when the constraint no longer fires", async () => {
    const processedKinds: string[] = [];

    const mod = createModule("noLongerActive", {
      schema: {
        facts: {
          status: t.string(),
          pendingKind: t.string(),
        },
        derivations: {},
        events: { start: {} },
        requirements: { PROCESS: {} },
      },
      init: (facts) => {
        facts.status = "idle";
        facts.pendingKind = "";
      },
      events: {
        start: (facts) => {
          facts.status = "processing";
          facts.pendingKind = "only";
        },
      },
      constraints: {
        process: {
          when: (facts) =>
            facts.status === "processing" && facts.pendingKind !== "",
          require: { type: "PROCESS" },
        },
      },
      resolvers: {
        processOne: {
          requirement: "PROCESS",
          resolve: async (_req, ctx) => {
            const kind = ctx.facts.pendingKind;
            if (!kind) return;
            processedKinds.push(kind);
            // Resolver finishes the work here AND calls requeue — but the
            // constraint's `when` no longer holds because pendingKind was
            // cleared. Engine should not loop.
            ctx.facts.pendingKind = "";
            ctx.facts.status = "done";
            ctx.requeue();
          },
        },
      },
    });

    const system = createSystem({ module: mod });
    system.start();

    await flush();
    system.events.start();
    await flush();

    expect(processedKinds).toEqual(["only"]);
    expect(system.facts.status).toBe("done");

    system.destroy();
  });
});
