/**
 * L7a: batch resolvers, the `withBatch` part (api/batch.ts).
 *
 * The conformance suite pins 1.35's batch rules. These pin what it leaves
 * open and the three owner-approved changes: the binding takes the last
 * baseline when the adds came in different passes (W5), the window starts
 * at the first add ((ap)), settle() and its notification count a running
 * batch and its 5 s limit applies to one ((as)), the resolve() fallback's
 * runs are ordinary runs ((at)), and nothing is left behind by a stop.
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `want` lists the ids; one FETCH per id from `fetch`, keyed by the id. */
function build(resolver: Record<string, unknown>, abortOn?: string[]) {
  const t0 = Date.now();
  const log: string[] = [];
  const plugin = {
    name: "rec",
    onResolverStart: (_r: string, req: { id: string }) => {
      log.push(`start ${req.id} @${Date.now() - t0}`);
    },
    onResolverComplete: (_r: string, req: { id: string }) => {
      log.push(`complete ${req.id} @${Date.now() - t0}`);
    },
    onResolverCancel: (_r: string, req: { id: string }) => {
      log.push(`cancel ${req.id} @${Date.now() - t0}`);
    },
  };
  const mod = createModule("m", {
    schema: {
      facts: { want: t.array<string>(), status: t.string() },
      derivations: {},
      events: {},
      requirements: { FETCH: { id: t.string() } },
    },
    init: (f: any) => {
      f.want = [];
      f.status = "idle";
    },
    constraints: {
      fetch: {
        when: (f: any) => f.want.length > 0,
        require: (f: any) =>
          f.want.map((id: string) => ({ type: "FETCH", id })),
        ...(abortOn ? { abortOn } : {}),
      },
    },
    resolvers: {
      fetch: { requirement: "FETCH", key: (r: any) => r.id, ...resolver },
    },
  } as never);
  const system = createSystem({
    module: mod,
    plugins: [plugin],
  } as never) as any;
  system.start();

  return { system, log, at: () => Date.now() - t0 };
}

describe("the binding takes the last baseline (W5)", () => {
  it("adds from two passes with different baselines: the later one binds the batch", async () => {
    const calls: string[][] = [];
    const { system, log } = build(
      {
        batch: { enabled: true, windowMs: 50 },
        resolveBatch: async (reqs: Array<{ id: string }>, ctx: any) => {
          calls.push(reqs.map((r) => r.id));
          ctx.facts.status = "from-batch";
        },
      },
      ["status"],
    );
    system.facts.want = ["a"];
    await advance(10);
    // Between the adds: the bound key moves, so the two passes' baselines differ.
    system.facts.status = "mid";
    await advance(10);
    system.facts.want = ["a", "b"];
    await advance(100);

    expect(calls).toEqual([["a", "b"]]);
    // With the first baseline ("idle") the write would be a clobber, dropped.
    expect(system.facts.status).toBe("from-batch");
    expect(log).toEqual(["complete a @50", "complete b @50"]);
    system.destroy();
  });
});

describe("the window starts at the first add (ap)", () => {
  it("adds at 0, 40 and 80 with a 50 ms window run as two calls", async () => {
    const calls: Array<[string[], number]> = [];
    const { system, at } = build({
      batch: { enabled: true, windowMs: 50 },
      resolveBatch: async (reqs: Array<{ id: string }>) => {
        calls.push([reqs.map((r) => r.id), at()]);
      },
    });
    system.facts.want = ["a"];
    await advance(40);
    system.facts.want = ["a", "b"];
    await advance(40);
    system.facts.want = ["a", "b", "c"];
    await advance(200);

    expect(calls).toEqual([
      [["a", "b"], 50],
      [["c"], 130],
    ]);
    system.destroy();
  });
});

describe("settle() counts a running batch (as)", () => {
  it("waits for the batch, and the settled notification fires when it ends", async () => {
    const { system, log, at } = build({
      batch: { enabled: true, windowMs: 50 },
      resolveBatch: async () => {
        await sleep(100);
      },
    });
    const changes: Array<[boolean, number]> = [];
    system.onSettledChange(() => changes.push([system.isSettled, at()]));
    system.facts.want = ["a"];
    await advance(0);
    // Queued: not settled.
    expect(system.isSettled).toBe(false);
    let settledAt = -1;
    const done = system.settle().then(() => {
      settledAt = at();
    });
    await advance(0);
    // settle() ran the queue now; the batch is in flight.
    expect(system.isSettled).toBe(false);
    expect(system.inspect().inflight.map((r: { id: string }) => r.id)).toEqual([
      "a",
    ]);
    await advance(100);
    await done;

    expect(settledAt).toBe(100);
    expect(log).toEqual(["complete a @100"]);
    expect(system.isSettled).toBe(true);
    // The batch's end is heard as a settled change, settled by then.
    expect(changes.some(([settled, when]) => settled && when === 100)).toBe(
      true,
    );
    system.destroy();
  });

  it("rejects at its 5 s limit for a slow batch with no timeoutMs", async () => {
    const { system } = build({
      batch: { enabled: true, windowMs: 10 },
      resolveBatch: async () => {
        await sleep(60_000);
      },
    });
    system.facts.want = ["a"];
    await advance(0);
    const outcome = system.settle().then(
      () => "resolved",
      (error: Error) => error.message,
    );
    await advance(5_000);

    expect(await outcome).toMatch(
      /^\[Directive\] settle\(\) timed out after 5000ms/,
    );
    system.destroy();
  });
});

describe("the resolve() fallback runs ordinary runs (at)", () => {
  const fallback = () =>
    build({
      batch: { enabled: true, windowMs: 10 },
      resolve: async () => {
        await sleep(60);
      },
    });

  it("a retraction cancels its run", async () => {
    const { system, log } = fallback();
    system.facts.want = ["a", "b"];
    await advance(30);
    system.facts.want = ["a"];
    await advance(100);

    expect(log).toEqual([
      "start a @10",
      "start b @10",
      "cancel b @30",
      "complete a @70",
    ]);
    system.destroy();
  });

  it("stop() cancels its runs, and settle() waits for them", async () => {
    const { system, log } = fallback();
    system.facts.want = ["a", "b"];
    await advance(0);
    let settledAt = -1;
    const done = system.settle().then(() => {
      settledAt = Date.now();
    });
    await advance(30);
    expect(settledAt).toBe(-1);
    system.stop();
    await advance(100);
    await done;

    expect(log).toEqual([
      "start a @0",
      "start b @0",
      "cancel a @30",
      "cancel b @30",
    ]);
    system.destroy();
  });
});

describe("nothing is left behind", () => {
  it("retracted mid-window, then stopped: no timer, no outcome after the stop", async () => {
    const calls: string[][] = [];
    const { system, log } = build({
      batch: { enabled: true, windowMs: 50 },
      resolveBatch: async (reqs: Array<{ id: string }>) => {
        calls.push(reqs.map((r) => r.id));
      },
    });
    system.facts.want = ["a", "b"];
    await advance(10);
    system.facts.want = ["a"];
    await advance(10);
    system.stop();
    expect(vi.getTimerCount()).toBe(0);
    await advance(200);

    expect(calls).toEqual([]);
    expect(log).toEqual(["cancel b @10", "cancel a @20"]);
    system.destroy();
  });

  it("a running batch stopped mid-run reports one cancel each and its signal aborts", async () => {
    const signals: AbortSignal[] = [];
    const { system, log } = build({
      batch: { enabled: true, windowMs: 10 },
      resolveBatch: async (_reqs: unknown, ctx: any) => {
        signals.push(ctx.signal);
        await sleep(60);
      },
    });
    system.facts.want = ["a", "b"];
    await advance(30);
    system.stop();
    system.stop();
    await advance(200);

    expect(signals.map((s) => s.aborted)).toEqual([true]);
    expect(log).toEqual(["cancel a @30", "cancel b @30"]);
    expect(system.inspect().inflight).toEqual([]);
    system.destroy();
  });
});
