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
import { DirectiveError } from "../api/core.js";
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

  it('a batch ended by a rethrow (boundary "throw") lets settle() resolve, and escapes as 1.35\'s one unhandled rejection', async () => {
    // Vitest's own listener would fail the run; collect them instead.
    const caught: unknown[] = [];
    const saved = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    const mine = (reason: unknown) => caught.push(reason);
    process.on("unhandledRejection", mine);
    try {
      const mod = createModule("m", {
        schema: {
          facts: { want: t.array<string>() },
          derivations: {},
          events: {},
          requirements: { FETCH: { id: t.string() } },
        },
        init: (f: any) => {
          f.want = [];
        },
        constraints: {
          fetch: {
            when: (f: any) => f.want.length > 0,
            require: (f: any) =>
              f.want.map((id: string) => ({ type: "FETCH", id })),
          },
        },
        resolvers: {
          fetch: {
            requirement: "FETCH",
            key: (r: any) => r.id,
            batch: { enabled: true, windowMs: 10 },
            resolveBatch: async () => {
              throw new Error("batch boom");
            },
          },
        },
      } as never);
      const system = createSystem({
        module: mod,
        errorBoundary: { onResolverError: "throw" },
      } as never) as any;
      system.start();
      system.facts.want = ["a", "b"];
      await advance(0);
      const outcome = system.settle().then(
        () => "resolved",
        (error: Error) => error.message,
      );
      await advance(5_000);

      expect(await outcome).toBe("resolved");
      expect(system.isSettled).toBe(true);
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 0));
      expect(caught).toHaveLength(1);
      expect(caught[0]).toBeInstanceOf(DirectiveError);
      expect(caught[0]).toMatchObject({
        message: "batch boom",
        source: "resolver",
        sourceId: "fetch",
      });
      system.destroy();
    } finally {
      process.off("unhandledRejection", mine);
      for (const fn of saved) {
        process.on("unhandledRejection", fn);
      }
    }
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

/**
 * Owner decision (au): the batch [A, B] satisfies A by its own write and A
 * comes back while it runs. The old batch reports a cancel for A, the hook
 * given the requirement, as a superseded single run does; the new run
 * completes A. 1.35 completes A from both runs.
 */
describe("a superseded batch member reports a cancel from the old batch (au)", () => {
  function superseded(opts: { withResults?: boolean; stopOnB?: boolean }) {
    const t0 = Date.now();
    const log: string[] = [];
    const cancels: unknown[] = [];
    const at = () => `@${Date.now() - t0}`;
    let calls = 0;
    const handler = async (reqs: Array<{ id: string }>, ctx: any) => {
      const ids = reqs.map((r) => r.id).join(",");
      log.push(`call ${ids} ${at()}`);
      // The second call (A alone) leaves A wanted, so stop() and start()
      // have something to dispatch again (quirk j).
      if (++calls !== 2 || !opts.stopOnB) {
        for (const r of reqs) {
          ctx.facts[`done${r.id}`] = true;
        }
      }
      await sleep(60);
      log.push(`return ${ids} ${at()}`);

      return reqs.map(() => ({ success: true }));
    };
    const name = (req: any) => req.requirement?.id ?? req.id;
    const mod = createModule("m", {
      schema: {
        facts: { doneA: t.boolean(), doneB: t.boolean() },
        derivations: {},
        events: {},
        requirements: { LOAD: { id: t.string() } },
      },
      init: (f: any) => {
        f.doneA = false;
        f.doneB = false;
      },
      constraints: {
        a: { when: (f: any) => !f.doneA, require: { type: "LOAD", id: "A" } },
        b: { when: (f: any) => !f.doneB, require: { type: "LOAD", id: "B" } },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          key: (r: any) => r.id,
          batch: { enabled: true, windowMs: 10 },
          [opts.withResults ? "resolveBatchWithResults" : "resolveBatch"]:
            handler,
        },
      },
    } as never);
    const system = createSystem({
      module: mod,
      plugins: [
        {
          name: "rec",
          onResolverComplete: (_r: string, req: any) => {
            log.push(`complete ${name(req)} ${at()}`);
            if (opts.stopOnB && name(req) === "B") {
              system.stop();
            }
          },
          onResolverCancel: (_r: string, req: any) => {
            log.push(`cancel ${name(req)} ${at()}`);
            cancels.push(req);
          },
          onResolverError: (_r: string, req: any) => {
            log.push(`error ${name(req)} ${at()}`);
          },
        },
      ],
    } as never) as any;
    system.start();

    return { system, log, cancels, at };
  }

  for (const withResults of [false, true]) {
    it(`old batch cancels A at the supersede, new run completes it (${withResults ? "resolveBatchWithResults" : "resolveBatch"})`, async () => {
      const { system, log, cancels, at } = superseded({ withResults });
      await advance(30);
      log.push(`doneA = false ${at()}`);
      system.facts.doneA = false;
      await advance(200);
      expect(log).toEqual([
        "call A,B @10",
        "doneA = false @30",
        "cancel A @30",
        "call A @40",
        "return A,B @70",
        "complete B @70",
        "return A @100",
        "complete A @100",
      ]);
      // The whole requirement, as a superseded single run's cancel.
      expect(cancels[0]).toMatchObject({
        id: "A",
        requirement: { type: "LOAD", id: "A" },
      });
      expect(system.inspect().inflight).toEqual([]);
      system.destroy();
    });
  }

  it("composes with a stop() inside the completion loop (row t) and start() after it (quirk j)", async () => {
    const { system, log, at } = superseded({ stopOnB: true });
    await advance(30);
    log.push(`doneA = false ${at()}`);
    system.facts.doneA = false;
    await advance(45);
    log.push(`start ${at()}`);
    system.start();
    await advance(200);
    expect(log).toEqual([
      "call A,B @10",
      "doneA = false @30",
      "cancel A @30",
      "call A @40",
      "return A,B @70",
      "complete B @70",
      // stop() from B's hook: the new run's one outcome; the old batch
      // has reported all of its own.
      "cancel A @70",
      "start @75",
      "call A @85",
      "return A @100",
      "return A @145",
      "complete A @145",
    ]);
    system.destroy();
  });
});
