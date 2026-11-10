/**
 * A batched requirement raised again while a batch holding it still runs,
 * found by the L7 gate's fuzz (case 1967; api/resolvers.ts `resolve()`).
 *
 * A bound (`abortOn`) requirement retracted while queued stays queued and
 * runs in a batch (as 1.35). Raised again while that batch runs, it is
 * queued again: 1.35's resolve() asks only single runs, so it never waits
 * on the batch. Before the fix the running batch blocked the dispatch, its
 * write was clobbered, and the requirement stayed unmet for good.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModule } from "../api/module.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const tick = async (n = 10) => {
  for (let i = 0; i < n; i++) {
    await Promise.resolve();
  }
};

describe("a batched requirement raised again while its batch runs", () => {
  it("is queued again and met, the handler called twice (1.35)", async () => {
    const calls: string[][] = [];
    const met: string[] = [];
    const mod = createModule("m", {
      schema: {
        facts: { want: t.boolean(), out: t.number() },
        derivations: {},
        events: {},
        requirements: { FETCH: { id: t.string() } },
      },
      init: (f: any) => {
        f.want = false;
        f.out = 0;
      },
      constraints: {
        fetch: {
          when: (f: any) => f.want,
          require: () => [{ type: "FETCH", id: "x" }],
          abortOn: ["out"],
        },
      },
      resolvers: {
        fetch: {
          requirement: "FETCH",
          key: (r: any) => r.id,
          batch: { enabled: true, windowMs: 1000, maxSize: 2 },
          resolveBatch: async (reqs: any[], ctx: any) => {
            calls.push(reqs.map((r) => r.id));
            await new Promise((r) => setTimeout(r, 20));
            ctx.facts.out = calls.length * 10;
          },
        },
      },
    } as never);
    const system = createSystem({
      module: mod,
      plugins: [
        { name: "rec", onRequirementMet: (req: any) => met.push(req.id) },
      ],
    });
    system.start();
    await tick();
    const facts = system.facts as any;
    facts.want = true; // x queued
    await tick();
    facts.want = false; // retracted; bound, so it stays queued
    await tick();
    const settled = system.settle(1500).then(
      () => "resolved",
      (e: Error) => `rejected: ${e.message}`,
    );
    await tick(); // settle's start runs the queue: batch #1 holds x
    facts.out = 99; // batch #1's later write is clobbered
    facts.want = true; // x raised again while batch #1 runs
    await vi.advanceTimersByTimeAsync(1300);
    expect(await settled).toBe("resolved");
    expect(calls).toEqual([["x"], ["x"]]);
    expect(met).toEqual(["x"]);
    expect(facts.out).toBe(20);
    system.stop();
  });
});
