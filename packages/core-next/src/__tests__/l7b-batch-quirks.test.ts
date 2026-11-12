/**
 * L7b: the approved batch changes from 1.35 (GATE-1 quirks g, h, i and k;
 * (aq) and (ar), 2026-11-05). The diff harness shows each against 1.35
 * (l7-batch-pins U2 to U6 and U11); these pin 2.0's rule, and the cases the
 * diff does not reach: a retry with a retraction or stop() in it, a sibling
 * whose write satisfied its own requirement, `shouldRetry` saying no, and a
 * mixed batch whose requirements came in different passes.
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
type Ids = Array<{ id: string }>;
const idsOf = (reqs: Ids) => reqs.map((r) => r.id).join(",");

/**
 * `want` (constraint c1) and `want2` (c2) list ids, one FETCH each. With
 * `bind`, c1 is bound to `x` and c2 to `y`.
 */
function build(resolver: Record<string, unknown>, bind = false) {
  const t0 = Date.now();
  const log: string[] = [];
  const cancels: Array<Record<string, unknown>> = [];
  const at = () => Date.now() - t0;
  const plugin = {
    name: "rec",
    onResolverComplete: (_r: string, req: { id: string }) => {
      log.push(`complete ${req.id} @${at()}`);
    },
    onResolverError: (_r: string, req: { id: string }, error: Error) => {
      log.push(`error ${req.id} ${error.message} @${at()}`);
    },
    onResolverCancel: (_r: string, req: Record<string, unknown>) => {
      log.push(`cancel ${req.id as string} @${at()}`);
      cancels.push(req);
    },
    onResolverRetry: (_r: string, req: { id: string }, attempt: number) => {
      log.push(`retry ${req.id} #${attempt} @${at()}`);
    },
  };
  const source = (key: string, abortOn: string) => ({
    when: (f: any) => f[key].length > 0,
    require: (f: any) => f[key].map((id: string) => ({ type: "FETCH", id })),
    ...(bind ? { abortOn: [abortOn] } : {}),
  });
  const mod = createModule("m", {
    schema: {
      facts: {
        want: t.array<string>(),
        want2: t.array<string>(),
        x: t.string(),
        y: t.string(),
      },
      derivations: {},
      events: {},
      requirements: { FETCH: { id: t.string() } },
    },
    init: (f: any) => {
      f.want = [];
      f.want2 = [];
      f.x = "idle";
      f.y = "idle";
    },
    constraints: { c1: source("want", "x"), c2: source("want2", "y") },
    resolvers: {
      fetch: { requirement: "FETCH", key: (r: any) => r.id, ...resolver },
    },
  } as never);
  const system = createSystem({
    module: mod,
    plugins: [plugin],
  } as never) as any;
  system.start();

  return { system, log, cancels, at };
}

describe("quirk g and (aq): retracting one requirement of a running batch", () => {
  it("cancels only that one, with the whole requirement; the rest complete and the signal stays clean", async () => {
    const signals: AbortSignal[] = [];
    const { system, log, cancels } = build({
      batch: { enabled: true, windowMs: 10 },
      resolveBatch: async (_reqs: Ids, ctx: any) => {
        signals.push(ctx.signal);
        await sleep(60);
        ctx.facts.x = "from-batch";
      },
    });
    system.facts.want = ["a", "b", "c"];
    await advance(30);
    system.facts.want = ["a", "c"];
    await advance(100);

    expect(log).toEqual(["cancel b @30", "complete a @70", "complete c @70"]);
    expect(Object.keys(cancels[0]!).sort()).toEqual([
      "fromConstraint",
      "id",
      "requirement",
    ]);
    expect(cancels[0]!.requirement).toEqual({ type: "FETCH", id: "b" });
    expect(signals.map((s) => s.aborted)).toEqual([false]);
    expect(system.facts.x).toBe("from-batch");
    system.destroy();
  });

  it("aborts the signal when the last one leaves, each canceled once", async () => {
    const signals: AbortSignal[] = [];
    const { system, log, cancels } = build({
      batch: { enabled: true, windowMs: 10 },
      resolveBatch: async (_reqs: Ids, ctx: any) => {
        signals.push(ctx.signal);
        await sleep(60);
      },
    });
    system.facts.want = ["a", "b"];
    await advance(20);
    system.facts.want = ["a"];
    await advance(10);
    expect(signals[0]!.aborted).toBe(false);
    system.facts.want = [];
    await advance(100);

    expect(log).toEqual(["cancel b @20", "cancel a @30"]);
    expect(cancels.map((req) => req.requirement)).toEqual([
      { type: "FETCH", id: "b" },
      { type: "FETCH", id: "a" },
    ]);
    expect(signals[0]!.aborted).toBe(true);
    system.destroy();
  });
});

describe("quirk h and (ar): an all-failed with-results batch", () => {
  const failing = (calls: string[], asked: string[]) => ({
    batch: { enabled: true, windowMs: 10 },
    retry: {
      attempts: 3,
      backoff: "exponential",
      initialDelay: 100,
      shouldRetry: (error: Error, attempt: number) => {
        asked.push(`${error.message} ${attempt}`);

        return true;
      },
    },
    resolveBatchWithResults: async (reqs: Ids) => {
      calls.push(`${idsOf(reqs)} @${Date.now()}`);

      return reqs.map((r) => ({
        success: false,
        error: new Error(`no ${r.id}`),
      }));
    },
  });

  it("retries under the policy, and each item reports its own error once, after the last attempt", async () => {
    const calls: string[] = [];
    const asked: string[] = [];
    const { system, log } = build(failing(calls, asked));
    const t0 = Date.now();
    system.facts.want = ["a", "b"];
    await advance(700);

    expect(calls).toEqual([
      `a,b @${t0 + 10}`,
      `a,b @${t0 + 110}`,
      `a,b @${t0 + 310}`,
    ]);
    // Asked before each retry; the last attempt's items report at once, as
    // 1.35's executeWithResults (which never asks) does.
    expect(asked).toEqual(["no a 1", "no a 2"]);
    expect(log).toEqual([
      "retry a #2 @110",
      "retry b #2 @110",
      "retry a #3 @310",
      "retry b #3 @310",
      "error a no a @310",
      "error b no b @310",
    ]);
    system.destroy();
  });

  it("stop() during its backoff: one cancel each, no error", async () => {
    const { system, log, cancels } = build(failing([], []));
    system.facts.want = ["a", "b"];
    await advance(50);
    system.stop();
    await advance(700);

    expect(log).toEqual(["cancel a @50", "cancel b @50"]);
    // (aq): stop() gives a running batch's cancel hook the whole requirement.
    expect(cancels.map((req) => req.fromConstraint)).toEqual(["c1", "c1"]);
    system.destroy();
  });
});

describe("quirk i: a partly failed with-results batch", () => {
  it("completes the rest at once and retries the failed ones as a smaller batch, never through resolve()", async () => {
    const calls: string[] = [];
    const resolve = vi.fn();
    const { system, log } = build({
      batch: { enabled: true, windowMs: 10 },
      retry: { attempts: 3, backoff: "none", initialDelay: 50 },
      resolve,
      resolveBatchWithResults: async (reqs: Ids) => {
        calls.push(idsOf(reqs));

        return reqs.map((r) =>
          r.id === "a"
            ? { success: true }
            : { success: false, error: new Error(`${r.id} failed`) },
        );
      },
    });
    system.facts.want = ["a", "b", "c"];
    await advance(500);

    expect(calls).toEqual(["a,b,c", "b,c", "b,c"]);
    expect(resolve).not.toHaveBeenCalled();
    expect(log).toEqual([
      "complete a @10",
      "retry b #2 @60",
      "retry c #2 @60",
      "retry b #3 @110",
      "retry c #3 @110",
      "error b b failed @110",
      "error c c failed @110",
    ]);
    system.destroy();
  });

  it("a sibling's write that satisfied its own requirement does not end the retry", async () => {
    let call = 0;
    const { system, log } = build({
      batch: { enabled: true, windowMs: 10 },
      retry: { attempts: 2, backoff: "none", initialDelay: 50 },
      resolveBatchWithResults: async (reqs: Ids, ctx: any) => {
        call += 1;
        // Done with a: its requirement goes away by this batch's own write.
        ctx.facts.want = ctx.facts.want.filter((id: string) => id !== "a");
        await sleep(5);

        return reqs.map((r) => ({ success: r.id === "a" || call > 1 }));
      },
    });
    system.facts.want = ["a", "b"];
    await advance(300);

    expect(call).toBe(2);
    expect(log).toEqual(["complete a @15", "retry b #2 @65", "complete b @70"]);
    system.destroy();
  });

  it("shouldRetry saying no, or a retraction during the smaller retry, ends it with one outcome", async () => {
    const calls: string[] = [];
    const { system, log } = build({
      batch: { enabled: true, windowMs: 10 },
      retry: {
        attempts: 3,
        backoff: "none",
        initialDelay: 50,
        shouldRetry: (_error: Error, attempt: number) => attempt < 2,
      },
      resolveBatchWithResults: async (reqs: Ids) => {
        calls.push(idsOf(reqs));
        await sleep(20);

        return reqs.map((r) => ({ success: r.id === "a" }));
      },
    });
    system.facts.want = ["a", "b", "c"];
    await advance(90);
    // The smaller retry [b, c] runs from 80: c leaves it.
    system.facts.want = ["a", "b"];
    await advance(500);

    expect(calls).toEqual(["a,b,c", "b,c"]);
    expect(log).toEqual([
      "complete a @30",
      "retry b #2 @80",
      "retry c #2 @80",
      "cancel c @90",
      "error b Batch item failed @100",
    ]);
    system.destroy();
  });
});

describe("quirk k: a mixed-source batch is bound to the union of its keys", () => {
  const writer = (key: "x" | "y") => ({
    batch: { enabled: true, windowMs: 30 },
    resolveBatch: async (_reqs: Ids, ctx: any) => {
      await sleep(60);
      ctx.facts.x = "from-batch";
      ctx.facts.y = "from-batch";
      ctx.facts[key === "x" ? "y" : "x"] = "again";
    },
  });

  it("a changed key of either constraint drops the write, aborts the batch and reports no outcome", async () => {
    const { system, log } = build(writer("x"), true);
    system.facts.want = ["a"];
    await advance(10);
    system.facts.want2 = ["b"];
    await advance(40);
    system.facts.y = "external";
    await advance(200);

    expect(system.facts.y).toBe("external");
    // x is written before y's clobber aborts the batch; its later write drops.
    expect(system.facts.x).toBe("from-batch");
    expect(log).toEqual([]);
    system.destroy();
  });

  it("its own writes land when nothing else changed the keys, though its requirements came in different passes", async () => {
    const { system, log } = build(writer("x"), true);
    system.facts.want = ["a"];
    await advance(10);
    system.facts.want2 = ["b"];
    await advance(200);

    expect(system.facts.x).toBe("from-batch");
    expect(system.facts.y).toBe("again");
    expect(log).toEqual(["complete a @90", "complete b @90"]);
    system.destroy();
  });
});
