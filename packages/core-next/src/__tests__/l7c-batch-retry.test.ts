/**
 * L7 batch-retry fixes, found by the L7 gate's fuzz (api/batch.ts).
 *
 * - A requirement is in a batch call at most once. Added again while it
 *   waits in the queue (the "retry" boundary's pass and quirk a's requeue,
 *   or a bound requirement retracted and raised again), it is not queued
 *   twice. 1.35 queues it twice in the second case.
 * - settle() waits for the pass a "retry" boundary owes a failed batch, so
 *   the re-dispatch runs before it returns ((as)); quirk a still bounds the
 *   re-dispatches (four calls, then the requirement waits unmet).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModule } from "../api/module.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

/**
 * Two batched requirements, `a` and `b`, wanted while `on > 0` and
 * `done === 0`. The handler's first `fails` calls throw; a later one sets
 * `done`. `slow`: each call writes `tick` at once, and an effect on `tick`
 * awaits a timer, so the pass the write starts is still open when the call
 * fails.
 */
function build(opts: {
  fails: number;
  boundary?: string;
  abortOn?: string[];
  slow?: boolean;
}) {
  const calls: string[][] = [];
  const log: string[] = [];
  const mod = createModule("m", {
    schema: {
      facts: { on: t.number(), done: t.number(), tick: t.number() },
      derivations: {},
      events: {},
      requirements: { FETCH: { id: t.string() } },
    },
    init: (f: any) => {
      f.on = 1;
      f.done = 0;
      f.tick = 0;
    },
    constraints: {
      fetch: {
        when: (f: any) => f.on > 0 && f.done === 0,
        require: () => [
          { type: "FETCH", id: "a" },
          { type: "FETCH", id: "b" },
        ],
        ...(opts.abortOn ? { abortOn: opts.abortOn } : {}),
      },
    },
    effects: opts.slow
      ? {
          slow: {
            run: async (f: any) => {
              f.tick;
              await new Promise((r) => setTimeout(r, 2));
            },
          },
        }
      : {},
    resolvers: {
      fetch: {
        requirement: "FETCH",
        key: (r: any) => r.id,
        batch: { enabled: true, windowMs: 5 },
        resolveBatch: async (reqs: Array<{ id: string }>, ctx: any) => {
          calls.push(reqs.map((r) => r.id));
          const n = calls.length;
          if (opts.slow) {
            ctx.facts.tick = n;
          }
          await 0;
          if (n <= opts.fails) {
            throw new Error(`attempt ${n}`);
          }
          ctx.facts.done = 1;
        },
      },
    },
  } as never);
  const system = createSystem({
    module: mod,
    ...(opts.boundary
      ? { errorBoundary: { onResolverError: opts.boundary } }
      : {}),
    plugins: [
      {
        name: "rec",
        onResolverComplete: (_r: string, req: { id: string }) =>
          log.push(`complete ${req.id.slice(-3)}`),
      },
    ],
  } as never) as any;
  system.start();

  return { system, calls, log };
}

describe("a requirement is in a batch call at most once", () => {
  it("under retry, the boundary's re-dispatch and quirk a's requeue queue it once", async () => {
    const { system, calls } = build({
      fails: 2,
      boundary: "retry",
      slow: true,
    });
    await advance(200);

    expect(calls).toEqual([
      ["a", "b"],
      ["a", "b"],
      ["a", "b"],
    ]);
    expect(system.facts.done).toBe(1);
    system.destroy();
  });

  it("a bound requirement retracted while queued and raised again is in the call once", async () => {
    const { system, calls, log } = build({ fails: 0, abortOn: ["tick"] });
    await advance(1);
    system.facts.on = 0;
    await advance(1);
    system.facts.on = 1;
    await advance(50);

    // 1.35 calls with [a, b, a, b] and completes each twice.
    expect(calls).toEqual([["a", "b"]]);
    expect(log).toEqual(["complete a", "complete b"]);
    system.destroy();
  });
});

describe("settle() waits for a failed batch's re-dispatch under retry", () => {
  it("returns after the call that succeeds", async () => {
    const { system, calls } = build({ fails: 2, boundary: "retry" });
    let seen: unknown;
    system.settle().then(() => {
      seen = [calls.length, system.facts.done];
    });
    await advance(100);

    // On main it returned after the first failure: [1, 0].
    expect(seen).toEqual([3, 1]);
    system.destroy();
  });

  it("quirk a bounds it: four calls, then settle() returns with both unmet", async () => {
    const { system, calls } = build({
      fails: Number.POSITIVE_INFINITY,
      boundary: "retry",
    });
    let seen: unknown;
    system.settle().then(() => {
      seen = calls.length;
    });
    await advance(100);

    expect(seen).toBe(4);
    await advance(500);
    expect(calls).toHaveLength(4);
    expect(system.inspect().unmet.map((r: { id: string }) => r.id)).toEqual([
      expect.stringContaining("a"),
      expect.stringContaining("b"),
    ]);
    system.destroy();
  });
});
