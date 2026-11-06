// Ported from packages/core/src/core/__tests__/l7-batch-pins-oracle.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Black-box pins of 1.35's batch behaviour that no other test states (the L7
// RFC, "Untested behaviours" U3, U7, U10 and U13 to U16). Each pins what
// 1.35 does today. Where an approved L7 row changes that (quirk g and (aq) in
// U3 and U14, (as) in U7, row t's batch-shaped path in U10), the case keeps
// only what 1.35 and 2.0 share, and names the row (the L2 and L6 precedent).
// Public API only; a plugin records the resolver hooks in order, each with
// the fake time it ran at.

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

interface Options {
  /** Each constraint's `abortOn`; omitted, the constraint has none. */
  abortOn?: string[];
  /** Runs inside the plugin's onResolverComplete, after it is logged. */
  onComplete?: (id: string, system: any) => void;
}

/**
 * A system whose `want` fact lists the ids to fetch: one FETCH requirement per
 * id, keyed by that id, from the constraint `fetch`. `status` is a fact
 * nothing requires, for writes that only start a reconcile.
 */
function build(resolver: Record<string, unknown>, options: Options = {}) {
  const t0 = Date.now();
  const at = () => Date.now() - t0;
  const log: string[] = [];
  const cancelArgs: Array<Record<string, unknown>> = [];
  // The plugin reaches the system it is part of through this holder.
  const holder: { system?: any } = {};
  const plugin = {
    name: "rec",
    onResolverComplete: (_resolver: string, req: { id: string }) => {
      log.push(`complete ${req.id} @${at()}`);
      options.onComplete?.(req.id, holder.system);
    },
    onResolverError: (
      _resolver: string,
      req: { id: string },
      error: unknown,
    ) => {
      log.push(`error ${req.id} ${(error as Error).message} @${at()}`);
    },
    onResolverCancel: (_resolver: string, req: Record<string, unknown>) => {
      log.push(`cancel ${req.id as string} @${at()}`);
      cancelArgs.push(req);
    },
    onResolverRetry: (
      _resolver: string,
      req: { id: string },
      attempt: number,
    ) => {
      log.push(`retry ${req.id} #${attempt} @${at()}`);
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
        ...(options.abortOn ? { abortOn: options.abortOn } : {}),
      },
    },
    resolvers: {
      fetch: {
        requirement: "FETCH",
        key: (req: { id: string }) => req.id,
        ...resolver,
      },
    },
  } as never);
  const system = createSystem({
    module: mod,
    plugins: [plugin],
  } as never) as any;
  holder.system = system;
  system.start();

  return { system, log, cancelArgs, at };
}

/** Ids of `n` requirements, r0 to r<n-1>. */
const ids = (n: number) => Array.from({ length: n }, (_, i) => `r${i}`);

describe("the cancel hook for a batched requirement (U3)", () => {
  it("gets the whole requirement when the requirement is still queued", async () => {
    const { system, cancelArgs, log } = build({
      batch: { enabled: true, windowMs: 50 },
      resolveBatch: async () => {},
    });
    system.facts.want = ["x", "y"];
    await advance(10);
    system.facts.want = ["x"];
    await advance(100);

    expect(cancelArgs).toHaveLength(1);
    expect(Object.keys(cancelArgs[0]!).sort()).toEqual([
      "fromConstraint",
      "id",
      "requirement",
    ]);
    expect(cancelArgs[0]!.requirement).toEqual({ type: "FETCH", id: "y" });
    expect(cancelArgs[0]!.fromConstraint).toBe("fetch");
    expect(log).toEqual(["cancel y @10", "complete x @50"]);
    system.destroy();
  });

  it("cancels the retracted requirement of a batch that is running", async () => {
    const { system, cancelArgs, log } = build({
      batch: { enabled: true, windowMs: 10 },
      resolveBatch: async () => {
        await sleep(60);
      },
    });
    system.facts.want = ["a", "b", "c"];
    await advance(30);
    system.facts.want = ["a", "c"];
    await advance(200);

    // Quirk g and row (aq): 1.35 cancels a, b and c with { id } only, 2.0 cancels b alone with the whole requirement (diff scenario U2).
    expect(cancelArgs.map((req) => req.id)).toContain("b");
    expect(log).toContain("cancel b @30");
    system.destroy();
  });
});

describe("settle() and inspect() while a batch runs (U7)", () => {
  it("settle() runs the queued batch, and inspect() lists no batch while it is queued", async () => {
    const { system, log, at } = build({
      batch: { enabled: true, windowMs: 50 },
      resolveBatch: async (reqs: Array<{ id: string }>) => {
        log.push(`start ${reqs.map((r) => r.id).join(",")} @${at()}`);
        await sleep(100);
        log.push(`end @${at()}`);
      },
    });
    system.facts.want = ["a"];
    await advance(0);
    const queued = system.inspect();

    const settled = system.settle().then(() => {
      log.push(`settled @${at()}`);
    });
    await advance(200);
    await settled;

    // Row (as): 1.35's settle() resolves at 0 ms and inspect() lists no running batch, 2.0 waits for the batch and lists the batch, as the diff scenario "a batch window collects requirements into one resolveBatch" records.
    expect(log.filter((line) => !line.startsWith("settled"))).toEqual([
      "start a @0",
      "end @100",
      "complete a @100",
    ]);
    expect(log.filter((line) => line.startsWith("settled"))).toHaveLength(1);
    expect(queued.inflight).toEqual([]);
    system.destroy();
  });
});

describe("stop() from a completion hook during a batch's completion loop (U10)", () => {
  it("still completes every requirement of the batch, and the system stops", async () => {
    let stopped = false;
    const { system, log } = build(
      {
        batch: { enabled: true, windowMs: 10 },
        resolveBatch: async () => {},
      },
      {
        onComplete: (id, sys) => {
          if (id === "a" && !stopped) {
            stopped = true;
            sys.stop();
          }
        },
      },
    );
    system.facts.want = ["a", "b", "c"];
    await advance(100);

    // Row t's batch-shaped path (L7 RFC B-4): 1.35 also cancels a, b and c after a's completion, 2.0 reports the completions only (core-next l7a-batch "composes with a stop() inside the completion loop (row t) …").
    expect(log.filter((line) => line.startsWith("complete"))).toEqual([
      "complete a @10",
      "complete b @10",
      "complete c @10",
    ]);
    expect(system.isRunning).toBe(false);
    system.destroy();
  });
});

describe("requeue() inside a batch handler (U13)", () => {
  it.each([true, false])(
    "requeue %s: a requeue runs every requirement of the batch again at the next reconcile",
    async (requeue) => {
      const calls: string[][] = [];
      const { system } = build({
        batch: { enabled: true, windowMs: 10 },
        resolveBatch: async (reqs: Array<{ id: string }>, ctx: any) => {
          calls.push(reqs.map((r) => r.id));
          if (requeue && calls.length === 1) {
            ctx.requeue();
          }
        },
      });
      system.facts.want = ["a", "b"];
      await advance(50);
      system.facts.status = "poke";
      await advance(50);

      expect(calls).toEqual(
        requeue
          ? [
              ["a", "b"],
              ["a", "b"],
            ]
          : [["a", "b"]],
      );
      system.destroy();
    },
  );
});

describe("what a batch's signal carries when it aborts (U14)", () => {
  /**
   * A batch handler that waits 60 ms, then writes `status`. It keeps each
   * call's signal, and how long after the call started the signal aborted.
   */
  function waiting() {
    const signals: AbortSignal[] = [];
    const abortedAfter: number[] = [];
    const fn = async (_reqs: unknown, ctx: any) => {
      const started = Date.now();
      signals.push(ctx.signal);
      ctx.signal.addEventListener("abort", () => {
        abortedAfter.push(Date.now() - started);
      });
      await sleep(60);
      ctx.facts.status = "from-batch";
    };

    return { signals, abortedAfter, fn };
  }
  const reasonOf = (signal: AbortSignal) => ({
    aborted: signal.aborted,
    name: (signal.reason as { name?: unknown } | undefined)?.name,
  });

  it("the batch's write still lands when a requirement of the running batch is retracted", async () => {
    const h = waiting();
    const { system } = build({
      batch: { enabled: true, windowMs: 10 },
      resolveBatch: h.fn,
    });
    system.facts.want = ["a", "b"];
    await advance(30);
    system.facts.want = ["a"];
    await advance(100);

    // Quirk g: 1.35 aborts the batch's signal with an AbortError 20 ms in, 2.0 cancels b alone and leaves the signal clean (diff scenario U2).
    expect(h.signals).toHaveLength(1);
    // The batch's write lands: nothing binds it.
    expect(system.facts.status).toBe("from-batch");
    system.destroy();
  });

  it("an AbortError when the system stops", async () => {
    const h = waiting();
    const { system } = build({
      batch: { enabled: true, windowMs: 10 },
      resolveBatch: h.fn,
    });
    system.facts.want = ["a", "b"];
    await advance(30);
    system.stop();
    await advance(100);

    expect(h.signals.map(reasonOf)).toEqual([
      { aborted: true, name: "AbortError" },
    ]);
    expect(h.abortedAfter).toEqual([20]);
    system.destroy();
  });

  it("the clobber detail, at the write, when a fact the batch is bound to changed", async () => {
    const h = waiting();
    const { system, log } = build(
      {
        batch: { enabled: true, windowMs: 10 },
        resolveBatch: h.fn,
      },
      { abortOn: ["status"] },
    );
    system.facts.want = ["a", "b"];
    await advance(30);
    system.facts.status = "external";
    await advance(100);

    expect(h.signals.map((s) => s.aborted)).toEqual([true]);
    expect(h.signals[0]!.reason).toEqual({
      kind: "clobbered",
      fact: "status",
      expected: "idle",
      actual: "external",
    });
    // The signal aborts when the batch writes, not when the fact changed.
    expect(h.abortedAfter).toEqual([60]);
    expect(system.facts.status).toBe("external");
    expect(log).toEqual([]);
    system.destroy();
  });
});

describe("a queue with no maxSize (U15)", () => {
  it("runs at once when it holds 10,000 requirements and one more arrives, and leaves that one to the window", async () => {
    const calls: Array<{
      size: number;
      first: string;
      last: string;
      at: number;
    }> = [];
    const { system, at } = build({
      batch: { enabled: true, windowMs: 50 },
      resolveBatch: async (reqs: Array<{ id: string }>) => {
        calls.push({
          size: reqs.length,
          first: reqs[0]!.id,
          last: reqs[reqs.length - 1]!.id,
          at: at(),
        });
      },
    });
    system.facts.want = ids(10_000);
    await advance(10);
    // Ten thousand queued is not yet the cap: the window still holds them.
    expect(calls).toEqual([]);

    system.facts.want = ids(10_001);
    await advance(0);
    expect(calls).toEqual([
      { size: 10_000, first: "r0", last: "r9999", at: 10 },
    ]);

    await advance(100);
    expect(calls).toEqual([
      { size: 10_000, first: "r0", last: "r9999", at: 10 },
      { size: 1, first: "r10000", last: "r10000", at: 60 },
    ]);
    system.destroy();
  }, 60_000);
});

describe("the attempt number a batch reports (U16)", () => {
  it("passes each failed attempt's number to shouldRetry once per batch, and the next attempt's to onRetry for each requirement", async () => {
    let call = 0;
    const asked: Array<[string, number]> = [];
    const { system, log } = build({
      batch: { enabled: true, windowMs: 10 },
      retry: {
        attempts: 3,
        backoff: "none",
        initialDelay: 20,
        shouldRetry: (error: Error, attempt: number) => {
          asked.push([error.message, attempt]);

          return true;
        },
      },
      resolveBatch: async () => {
        call += 1;
        throw new Error(`boom${call}`);
      },
    });
    system.facts.want = ["a", "b"];
    await advance(500);

    expect(asked).toEqual([
      ["boom1", 1],
      ["boom2", 2],
      ["boom3", 3],
    ]);
    expect(log).toEqual([
      "retry a #2 @30",
      "retry b #2 @30",
      "retry a #3 @50",
      "retry b #3 @50",
      "error a boom3 @50",
      "error b boom3 @50",
    ]);
    system.destroy();
  });
});
