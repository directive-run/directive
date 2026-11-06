// Ported from packages/core/src/core/__tests__/l7-batch-gate-debt-oracle.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Black-box pins for the gate=L7 mutation debt in 1.35's batch paths
// (engine.ts jointPassWrites and settle(); resolvers.ts's batch retry loop
// exits and supersedeSatisfiedBatches). Public API
// only; a plugin records the resolver hooks in order, each with the fake time
// it ran at, and the handlers record their calls into the same log.

beforeEach(() => {
  vi.useFakeTimers();
  // Failing resolvers print a development warning; it is not under test.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Reqs = Array<{ id: string }>;
type Rec = { log: string[]; at: () => number };
const idsOf = (reqs: Reqs) => reqs.map((r) => r.id).join(",");

interface Options {
  /** The constraint `fetch`'s `abortOn`; omitted, it has none. */
  abortOn?: string[];
  /** Runs inside the plugin's onResolverRetry, after it is logged. */
  onRetry?: (system: any) => void;
}

/**
 * A system whose `want` fact lists the ids to fetch: one FETCH requirement per
 * id, keyed by that id, from the constraint `fetch`. Setting `status` to a
 * number of ms raises one SLOW requirement, resolved by a plain (unbatched)
 * resolver that waits that long and then sets `status` to "done".
 */
function build(
  resolver: (rec: Rec) => Record<string, unknown>,
  options: Options = {},
) {
  const t0 = Date.now();
  const at = () => Date.now() - t0;
  const log: string[] = [];
  // The plugin reaches the system it is part of through this holder.
  const holder: { system?: any } = {};
  const plugin = {
    name: "rec",
    onResolverComplete: (resolver: string, req: { id: string }) => {
      // The plain SLOW run only holds settle() open; it is not logged.
      if (resolver === "slow") {
        return;
      }
      log.push(`complete ${req.id} @${at()}`);
    },
    onResolverError: (_resolver: string, req: { id: string }) => {
      log.push(`error ${req.id} @${at()}`);
    },
    onResolverCancel: (_resolver: string, req: { id: string }) => {
      log.push(`cancel ${req.id} @${at()}`);
    },
    onResolverRetry: (
      _resolver: string,
      req: { id: string },
      attempt: number,
    ) => {
      log.push(`retry ${req.id} #${attempt} @${at()}`);
      options.onRetry?.(holder.system);
    },
  };
  const mod = createModule("m", {
    schema: {
      facts: { want: t.array<string>(), status: t.string() },
      derivations: {},
      events: {},
      requirements: { FETCH: { id: t.string() }, SLOW: {} },
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
        ...(options.abortOn ? { abortOn: options.abortOn } : {}),
      },
      slow: {
        when: (f: any) => /^\d+$/.test(f.status),
        require: { type: "SLOW" },
      },
    },
    resolvers: {
      fetch: {
        requirement: "FETCH",
        key: (req: { id: string }) => req.id,
        ...resolver({ log, at }),
      },
      slow: {
        requirement: "SLOW",
        resolve: async (_req: unknown, context: any) => {
          await sleep(Number(context.facts.status));
          context.facts.status = "done";
        },
      },
    },
  } as never);
  const system = createSystem({
    module: mod,
    plugins: [plugin],
  } as never) as any;
  holder.system = system;
  system.start();

  return { system, log, at };
}

describe("a batch that retracts all its requirements by one write", () => {
  it("completes each of them, with none canceled: the batch's runs own the write jointly", async () => {
    const { system, log } = build(() => ({
      batch: { enabled: true, windowMs: 10 },
      resolveBatch: async (_reqs: Reqs, ctx: any) => {
        ctx.facts.want = [];
        await sleep(40);
      },
    }));
    system.facts.want = ["a", "b"];
    await advance(100);

    expect(log).toEqual(["complete a @50", "complete b @50"]);
    system.destroy();
  });
});

describe("settle() leaves nothing subscribed once it has answered", () => {
  // settle() waits on the plain SLOW run; FETCH is batched with a 50 ms
  // window, which a settle() listener left behind would flush early.
  const batched = ({ log, at }: Rec) => ({
    batch: { enabled: true, windowMs: 50 },
    resolveBatch: async (reqs: Reqs) => {
      log.push(`call ${idsOf(reqs)} @${at()}`);
    },
  });

  it("after it resolves, a later batch still waits out its window", async () => {
    const { system, log, at } = build(batched);
    system.facts.status = "30";
    const settled = system.settle().then(() => log.push(`settled @${at()}`));
    await advance(30);
    await settled;
    system.facts.want = ["b"];
    await advance(100);

    expect(log).toEqual(["settled @30", "call b @80", "complete b @80"]);
    system.destroy();
  });

  it("after it times out, a later batch still waits out its window", async () => {
    const { system, log } = build(batched);
    system.facts.status = "200";
    const outcome = system.settle(20).then(
      () => "resolved",
      () => "rejected",
    );
    await advance(20);
    expect(await outcome).toBe("rejected");
    await advance(30);
    system.facts.want = ["b"];
    await advance(60);

    expect(log).toEqual(["call b @100", "complete b @100"]);
    system.destroy();
  });
});

describe("the batch retry loop's exits", () => {
  it("a batch aborted as its retry is announced never runs again", async () => {
    const { system, log } = build(
      ({ log, at }) => ({
        batch: { enabled: true, windowMs: 10 },
        retry: { attempts: 2, backoff: "exponential", initialDelay: 100 },
        resolveBatch: async (reqs: Reqs) => {
          log.push(`call ${idsOf(reqs)} @${at()}`);
          throw new Error("nope");
        },
      }),
      // The retry hook stops the system, which aborts the batch at once.
      { onRetry: (system) => system.stop() },
    );
    system.facts.want = ["a", "b"];
    await advance(400);

    expect(log).toEqual([
      "call a,b @10",
      "retry a #2 @110",
      "cancel a @110",
      "cancel b @110",
      "retry b #2 @110",
    ]);
    system.destroy();
  });

  it("an all-failed with-results batch that satisfied its requirements by its own write is not run again", async () => {
    const { system, log } = build(({ log, at }) => ({
      batch: { enabled: true, windowMs: 10 },
      retry: { attempts: 2, backoff: "none", initialDelay: 10 },
      resolveBatchWithResults: async (reqs: Reqs, ctx: any) => {
        log.push(`call ${idsOf(reqs)} @${at()}`);
        ctx.facts.want = [];
        await sleep(5);

        return reqs.map(() => ({ success: false, error: new Error("nope") }));
      },
    }));
    system.facts.want = ["a", "b"];
    await advance(200);

    expect(log.filter((l) => l.startsWith("call"))).toEqual(["call a,b @10"]);
    system.destroy();
  });
});

describe("a requirement back while a bound batch that was detached from it still runs", () => {
  it("leaves that batch running to completion: only a batch that satisfied it is superseded", async () => {
    const { system, log } = build(
      ({ log, at }) => ({
        batch: { enabled: true, windowMs: 10 },
        resolveBatch: async (reqs: Reqs) => {
          log.push(`call ${idsOf(reqs)} @${at()}`);
          await sleep(60);
        },
      }),
      { abortOn: ["status"] },
    );
    system.facts.want = ["a"];
    await advance(20);
    // An outside write retracts `a`: the bound batch is detached, not canceled.
    system.facts.want = [];
    await advance(10);
    system.facts.want = ["a"];
    await advance(200);

    expect(log).toEqual([
      "call a @10",
      "call a @40",
      "complete a @70",
      "complete a @100",
    ]);
    system.destroy();
  });
});
