// Ported from packages/core/src/core/__tests__/l2-resolvers-oracle.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Black-box tests for resolvers at L2: retry and backoff timing, jitter,
// timeouts, shouldRetry's reason, which resolver handles a requirement,
// writes a run counts as its own, superseded runs, and abortOn write
// rejection. Public API only; a plugin observes the resolver hooks. Timing
// rules are contracts, so they are pinned to the millisecond with fake timers.

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

const CLOBBER_FACTS = Array.from({ length: 12 }, (_, i) => `c${i}`);

function recorder() {
  const log = {
    starts: 0,
    completes: 0,
    cancels: 0,
    retries: [] as number[],
    errors: [] as unknown[],
    durations: [] as number[],
    rejections: [] as Record<string, unknown>[],
  };
  const plugin = {
    name: "rec",
    onResolverStart: () => {
      log.starts++;
    },
    onResolverComplete: (_r: string, _q: unknown, duration: number) => {
      log.completes++;
      log.durations.push(duration);
    },
    onResolverError: (_r: string, _q: unknown, error: unknown) => {
      log.errors.push(error);
    },
    onResolverRetry: (_r: string, _q: unknown, attempt: number) => {
      log.retries.push(attempt);
    },
    onResolverCancel: () => {
      log.cancels++;
    },
    onResolverWriteRejected: (event: Record<string, unknown>) => {
      log.rejections.push(event);
    },
  };

  return { log, plugin };
}

interface BuildOptions {
  when?: (facts: any) => boolean;
  abortOn?: string[];
  plugins?: unknown[];
}

function build(resolver: Record<string, unknown>, options: BuildOptions = {}) {
  const { log, plugin } = recorder();
  const facts: Record<string, unknown> = {
    go: t.boolean(),
    done: t.boolean(),
    a: t.boolean(),
    b: t.boolean(),
    mark: t.number(),
    other: t.number(),
    token: t.string().optional(),
  };
  for (const k of CLOBBER_FACTS) {
    facts[k] = t.number();
  }
  const mod = createModule("m", {
    schema: {
      facts,
      derivations: {},
      events: {},
      requirements: { LOAD: {} },
    },
    init: (f: any) => {
      f.go = false;
      f.done = false;
      f.a = false;
      f.b = false;
      f.mark = 0;
      f.other = 0;
      for (const k of CLOBBER_FACTS) {
        f[k] = 0;
      }
    },
    constraints: {
      load: {
        when: options.when ?? ((f: any) => f.go && !f.done),
        require: { type: "LOAD" },
        ...(options.abortOn ? { abortOn: options.abortOn } : {}),
      },
    },
    resolvers: { load: { requirement: "LOAD", ...resolver } },
  } as never);
  const system = createSystem({
    module: mod,
    plugins: [plugin, ...(options.plugins ?? [])],
  } as never) as any;
  system.start();

  return { system, log };
}

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });

  return { promise, open };
}

/** Run a resolver that always fails; return each attempt's start, relative to the first. */
async function attemptTimes(retry: Record<string, unknown>) {
  const times: number[] = [];
  const { system, log } = build({
    retry,
    resolve: async () => {
      times.push(Date.now());
      throw new Error("fail");
    },
  });
  system.facts.go = true;
  await advance(200_000);
  system.destroy();

  return { offsets: times.map((x) => x - times[0]!), log };
}

describe("retry backoff fires each attempt exactly when its delay ends", () => {
  it("does not retry without a retry policy", async () => {
    const { offsets, log } = await attemptTimes(undefined as never);
    expect(offsets).toEqual([0]);
    expect(log.errors).toHaveLength(1);
    expect(log.retries).toEqual([]);
  });

  it('"none" waits initialDelay before every retry', async () => {
    const { offsets } = await attemptTimes({
      attempts: 4,
      backoff: "none",
      initialDelay: 50,
    });
    expect(offsets).toEqual([0, 50, 100, 150]);
  });

  it("initialDelay defaults to 100ms", async () => {
    const { offsets } = await attemptTimes({ attempts: 3, backoff: "none" });
    expect(offsets).toEqual([0, 100, 200]);
  });

  it('"linear" waits initialDelay × attempt', async () => {
    const { offsets } = await attemptTimes({
      attempts: 4,
      backoff: "linear",
      initialDelay: 100,
    });
    expect(offsets).toEqual([0, 100, 300, 600]);
  });

  it('"exponential" doubles the delay each attempt', async () => {
    const { offsets } = await attemptTimes({
      attempts: 4,
      backoff: "exponential",
      initialDelay: 100,
    });
    expect(offsets).toEqual([0, 100, 300, 700]);
  });

  it("maxDelay caps the delay", async () => {
    const { offsets } = await attemptTimes({
      attempts: 4,
      backoff: "exponential",
      initialDelay: 100,
      maxDelay: 150,
    });
    expect(offsets).toEqual([0, 100, 250, 400]);
  });

  it("maxDelay defaults to 30s", async () => {
    const { offsets } = await attemptTimes({
      attempts: 3,
      backoff: "exponential",
      initialDelay: 20_000,
    });
    expect(offsets).toEqual([0, 20_000, 50_000]);
  });

  it("an unknown backoff waits initialDelay", async () => {
    const { offsets } = await attemptTimes({
      attempts: 3,
      backoff: "bogus",
      initialDelay: 40,
    });
    expect(offsets).toEqual([0, 40, 80]);
  });

  it("a zero delay still waits 1ms", async () => {
    const { offsets } = await attemptTimes({
      attempts: 3,
      backoff: "none",
      initialDelay: 0,
    });
    expect(offsets).toEqual([0, 1, 2]);
  });
});

describe("jitter draws from Math.random", () => {
  const base = { attempts: 2, backoff: "none", initialDelay: 100 };

  it('"full" samples within [0, delay)', async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { offsets } = await attemptTimes({ ...base, jitter: "full" });
    expect(offsets).toEqual([0, 50]);
  });

  it('"full" never goes below 1ms', async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { offsets } = await attemptTimes({ ...base, jitter: "full" });
    expect(offsets).toEqual([0, 1]);
  });

  it('"equal" samples within [delay/2, delay)', async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { offsets } = await attemptTimes({ ...base, jitter: "equal" });
    expect(offsets).toEqual([0, 75]);
  });

  it("{ maxMs } adds up to maxMs on top of the delay", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { offsets } = await attemptTimes({ ...base, jitter: { maxMs: 40 } });
    expect(offsets).toEqual([0, 120]);
  });

  it("jitter applies after maxDelay clamps the delay", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { offsets } = await attemptTimes({
      attempts: 3,
      backoff: "exponential",
      initialDelay: 100,
      maxDelay: 150,
      jitter: { maxMs: 40 },
    });
    expect(offsets).toEqual([0, 120, 290]);
  });

  it.each([
    ["a negative maxMs", { maxMs: -5 }],
    ["an infinite maxMs", { maxMs: Number.POSITIVE_INFINITY }],
    ["a NaN maxMs", { maxMs: Number.NaN }],
    ['"none"', "none"],
    ["an unknown strategy", "bogus"],
  ])("%s adds no jitter", async (_label, jitter) => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { offsets } = await attemptTimes({ ...base, jitter });
    expect(offsets).toEqual([0, 100]);
  });
});

describe("retry outcomes", () => {
  it("announces each retry with the next attempt number, then completes", async () => {
    let calls = 0;
    const { system, log } = build({
      retry: { attempts: 3, backoff: "none", initialDelay: 10 },
      resolve: async (_req: unknown, context: any) => {
        calls++;
        if (calls < 3) {
          throw new Error(`fail ${calls}`);
        }
        context.facts.done = true;
      },
    });
    system.facts.go = true;
    await advance(100);
    expect(calls).toBe(3);
    expect(log.retries).toEqual([2, 3]);
    expect(log.completes).toBe(1);
    expect(log.errors).toEqual([]);
    expect(system.facts.done).toBe(true);
    system.destroy();
  });

  it("reports the last error once the attempts run out, with no retry after the last", async () => {
    const thrown: Error[] = [];
    const { system, log } = build({
      retry: { attempts: 3, backoff: "none", initialDelay: 10 },
      resolve: async () => {
        const error = new Error(`fail ${thrown.length + 1}`);
        thrown.push(error);
        throw error;
      },
    });
    system.facts.go = true;
    await advance(100);
    expect(thrown).toHaveLength(3);
    expect(log.retries).toEqual([2, 3]);
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0]).toBe(thrown[2]);
    expect(log.completes).toBe(0);
    system.destroy();
  });

  it("stops at once when shouldRetry says no", async () => {
    const refused = new Error("no");
    let calls = 0;
    const { system, log } = build({
      retry: {
        attempts: 5,
        backoff: "none",
        initialDelay: 10,
        shouldRetry: () => false,
      },
      resolve: async () => {
        calls++;
        throw refused;
      },
    });
    system.facts.go = true;
    await advance(200);
    expect(calls).toBe(1);
    expect(log.retries).toEqual([]);
    expect(log.errors).toEqual([refused]);
    system.destroy();
  });

  it('shouldRetry sees the error, the attempt and why it failed ("error" or "timeout")', async () => {
    const seen: Array<{ error: unknown; attempt: number; context: unknown }> =
      [];
    const first = new Error("thrown");
    let calls = 0;
    const { system, log } = build({
      timeout: 50,
      retry: {
        attempts: 3,
        backoff: "none",
        initialDelay: 10,
        shouldRetry: (error: unknown, attempt: number, context: unknown) => {
          seen.push({ error, attempt, context });

          return true;
        },
      },
      resolve: async (_req: unknown, context: any) => {
        calls++;
        if (calls === 1) {
          throw first;
        }
        if (calls === 2) {
          await new Promise(() => {});
        }
        context.facts.done = true;
      },
    });
    system.facts.go = true;
    await advance(500);
    expect(calls).toBe(3);
    expect(seen).toHaveLength(2);
    expect(seen[0]!.error).toBe(first);
    expect(seen[0]!.attempt).toBe(1);
    expect(seen[0]!.context).toEqual({ reason: "error" });
    expect(seen[1]!.error).toBeInstanceOf(Error);
    expect(seen[1]!.attempt).toBe(2);
    expect(seen[1]!.context).toEqual({ reason: "timeout" });
    expect(log.completes).toBe(1);
    system.destroy();
  });

  it("a thrown non-Error reaches the hooks as an Error", async () => {
    const { system, log } = build({
      resolve: async () => {
        throw "plain string";
      },
    });
    system.facts.go = true;
    await advance(10);
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0]).toBeInstanceOf(Error);
    expect(String((log.errors[0] as Error).message)).toContain("plain string");
    system.destroy();
  });

  it("a run canceled during its backoff is not retried and announces no retry", async () => {
    let calls = 0;
    const { system, log } = build({
      retry: { attempts: 3, backoff: "none", initialDelay: 1000 },
      resolve: async () => {
        calls++;
        throw new Error("fail");
      },
    });
    system.facts.go = true;
    await advance(10);
    expect(calls).toBe(1);
    system.facts.go = false;
    await advance(5000);
    expect(calls).toBe(1);
    expect(log.retries).toEqual([]);
    expect(log.cancels).toBe(1);
    system.destroy();
  });

  it("a canceled run that throws on abort reports no error", async () => {
    const { system, log } = build({
      retry: { attempts: 3, backoff: "none", initialDelay: 10 },
      resolve: (_req: unknown, context: any) =>
        new Promise<void>((_resolve, reject) => {
          context.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    });
    system.facts.go = true;
    await advance(10);
    system.facts.go = false;
    await advance(100);
    expect(log.cancels).toBe(1);
    expect(log.errors).toEqual([]);
    expect(log.retries).toEqual([]);
    system.destroy();
  });

  it("a run that satisfies its requirement and then throws is not run again", async () => {
    let calls = 0;
    const { system, log } = build({
      retry: { attempts: 3, backoff: "none", initialDelay: 10 },
      resolve: async (_req: unknown, context: any) => {
        calls++;
        context.facts.done = true;
        throw new Error("after write");
      },
    });
    system.facts.go = true;
    await advance(100);
    expect(calls).toBe(1);
    expect(log.errors).toHaveLength(1);
    expect(log.cancels).toBe(0);
    system.destroy();
  });

  it("onResolverComplete gets the time from the first attempt's start", async () => {
    let calls = 0;
    const { system, log } = build({
      retry: { attempts: 2, backoff: "none", initialDelay: 100 },
      resolve: async (_req: unknown, context: any) => {
        calls++;
        if (calls === 1) {
          throw new Error("fail");
        }
        await new Promise((r) => setTimeout(r, 50));
        context.facts.done = true;
      },
    });
    system.facts.go = true;
    await advance(1000);
    expect(log.durations).toEqual([150]);
    system.destroy();
  });
});

describe("timeout", () => {
  it("fails the attempt exactly at its deadline", async () => {
    const { system, log } = build({
      timeout: 100,
      resolve: () => new Promise(() => {}),
    });
    system.facts.go = true;
    await advance(0);
    await advance(99);
    expect(log.errors).toEqual([]);
    await advance(1);
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0]).toBeInstanceOf(Error);
    system.destroy();
  });

  it.each([0, -1])("a timeout of %i means no timeout", async (timeout) => {
    const { system, log } = build({
      timeout,
      resolve: async (_req: unknown, context: any) => {
        await new Promise((r) => setTimeout(r, 500));
        context.facts.done = true;
      },
    });
    system.facts.go = true;
    await advance(1000);
    expect(log.errors).toEqual([]);
    expect(log.completes).toBe(1);
    expect(system.facts.done).toBe(true);
    system.destroy();
  });
});

describe("which resolver handles a requirement", () => {
  function matching(order: Array<"one" | "two">) {
    const handled: string[] = [];
    const mod = createModule("pick", {
      schema: {
        facts: { want: t.number(), got: t.array<string>() },
        derivations: {},
        events: {},
        requirements: { LOAD: { which: t.number() }, OTHER: {} },
      },
      init: (f: any) => {
        f.want = 0;
        f.got = [];
      },
      constraints: {
        load: {
          when: (f: any) => f.want > 0,
          require: (f: any) => ({ type: "LOAD", which: f.want }),
        },
      },
      resolvers: {
        bogus: {
          requirement: 42,
          resolve: async () => {
            handled.push("bogus");
          },
        },
        other: {
          requirement: "OTHER",
          resolve: async () => {
            handled.push("other");
          },
        },
        two: {
          requirement: (req: any) => req.type === "LOAD" && req.which === 2,
          resolve: async (req: any) => {
            handled.push(`two:${req.which}`);
          },
        },
        any: {
          requirement: "LOAD",
          resolve: async (req: any) => {
            handled.push(`any:${req.which}`);
          },
        },
      },
    } as never);
    const system = createSystem({ module: mod } as never) as any;
    system.start();

    return {
      handled,
      async run() {
        for (const which of order) {
          system.facts.want = which === "one" ? 1 : 2;
          await advance(10);
          system.facts.want = 0;
          await advance(10);
        }
        system.destroy();
      },
    };
  }

  it("a predicate takes only what it accepts; later resolvers take the rest", async () => {
    const m = matching(["two", "one", "two"]);
    await m.run();
    expect(m.handled).toEqual(["two:2", "any:1", "two:2"]);
  });
});

describe("writes a run counts as its own", () => {
  it("deleting a fact retracts the requirement as an own write, not a cancel", async () => {
    const g = gate();
    let signal: AbortSignal | undefined;
    const { system, log } = build(
      {
        resolve: async (_req: unknown, context: any) => {
          signal = context.signal;
          // biome-ignore lint/performance/noDelete: deleting the fact is the write under test
          delete context.facts.token;
          await g.promise;
        },
      },
      { when: (f: any) => f.token !== undefined },
    );
    system.facts.token = "t";
    await advance(10);
    expect(system.facts.token).toBeUndefined();
    expect(signal?.aborted).toBe(false);
    expect(log.cancels).toBe(0);
    g.open();
    await advance(10);
    expect(log.completes).toBe(1);
    expect(log.cancels).toBe(0);
    system.destroy();
  });

  it("two own writes in one pass both count", async () => {
    const g = gate();
    let signal: AbortSignal | undefined;
    const { system, log } = build(
      {
        resolve: async (_req: unknown, context: any) => {
          signal = context.signal;
          context.facts.a = true;
          context.facts.b = true;
          await g.promise;
        },
      },
      { when: (f: any) => f.go && !(f.a && f.b) },
    );
    system.facts.go = true;
    await advance(10);
    expect(signal?.aborted).toBe(false);
    expect(log.cancels).toBe(0);
    g.open();
    await advance(10);
    expect(log.completes).toBe(1);
    system.destroy();
  });

  it("writing a fact's current value is not an own write", async () => {
    const g1 = gate();
    const g2 = gate();
    let signal: AbortSignal | undefined;
    const { system, log } = build(
      {
        resolve: async (_req: unknown, context: any) => {
          signal = context.signal;
          await g1.promise;
          context.facts.mark = 0;
          await g2.promise;
        },
      },
      { when: (f: any) => f.go && f.mark !== 99 },
    );
    system.facts.go = true;
    await advance(10);
    g1.open();
    await Promise.resolve();
    await Promise.resolve();
    system.facts.mark = 99;
    await advance(10);
    expect(signal?.aborted).toBe(true);
    expect(log.cancels).toBe(1);
    system.destroy();
  });

  it("deleting an absent fact is not an own write", async () => {
    const g1 = gate();
    const g2 = gate();
    let signal: AbortSignal | undefined;
    const { system, log } = build(
      {
        resolve: async (_req: unknown, context: any) => {
          signal = context.signal;
          await g1.promise;
          // biome-ignore lint/performance/noDelete: deleting the fact is the write under test
          delete context.facts.token;
          await g2.promise;
        },
      },
      { when: (f: any) => f.go && f.token === undefined },
    );
    system.facts.go = true;
    await advance(10);
    g1.open();
    await Promise.resolve();
    await Promise.resolve();
    system.facts.token = "outside";
    await advance(10);
    expect(signal?.aborted).toBe(true);
    expect(log.cancels).toBe(1);
    system.destroy();
  });

  it.each([0, 1, 2, 3])(
    "an own write %i passes earlier does not shield an outside retraction",
    async (passes) => {
      const g = gate();
      let signal: AbortSignal | undefined;
      const { system, log } = build(
        {
          resolve: async (_req: unknown, context: any) => {
            signal = context.signal;
            context.facts.mark = 1;
            await g.promise;
          },
        },
        { when: (f: any) => f.go && f.mark !== 99 },
      );
      system.facts.go = true;
      await advance(10);
      for (let i = 1; i <= passes; i++) {
        system.facts.other = i;
        await advance(10);
      }
      expect(log.cancels).toBe(0);
      system.facts.mark = 99;
      await advance(10);
      expect(signal?.aborted).toBe(true);
      expect(log.cancels).toBe(1);
      system.destroy();
    },
  );
});

describe("a superseded run", () => {
  function superseding(late: "write" | "delete" | "throw") {
    const runs: Array<{ signal: AbortSignal; open: () => void }> = [];
    const after: string[] = [];
    const { system, log } = build({
      resolve: async (_req: unknown, context: any) => {
        const g = gate();
        runs.push({ signal: context.signal, open: g.open });
        const n = runs.length;
        if (n === 1) {
          context.facts.done = true;
        }
        await g.promise;
        if (n === 1) {
          if (late === "write") {
            context.facts.mark = 7;
          } else if (late === "delete") {
            // biome-ignore lint/performance/noDelete: deleting the fact is the write under test
            delete context.facts.token;
          } else {
            throw new Error("late failure");
          }
          after.push("continued");
        }
      },
    });

    return { system, log, runs, after };
  }

  async function supersede(h: ReturnType<typeof superseding>) {
    h.system.facts.token = "kept";
    h.system.facts.go = true;
    await advance(10);
    expect(h.runs).toHaveLength(1);
    h.system.facts.done = false;
    await advance(10);
    expect(h.runs).toHaveLength(2);
    expect(h.runs[0]!.signal.aborted).toBe(true);
    expect(h.log.cancels).toBe(1);
    h.runs[0]!.open();
    await advance(10);
  }

  it("drops its late write silently and keeps running", async () => {
    const h = superseding("write");
    await supersede(h);
    expect(h.system.facts.mark).toBe(0);
    expect(h.after).toEqual(["continued"]);
    h.system.destroy();
  });

  it("drops its late delete silently and keeps running", async () => {
    const h = superseding("delete");
    await supersede(h);
    expect(h.system.facts.token).toBe("kept");
    expect(h.after).toEqual(["continued"]);
    h.system.destroy();
  });

  it("reports no error when it throws late", async () => {
    const h = superseding("throw");
    await supersede(h);
    expect(h.log.errors).toEqual([]);
    h.system.destroy();
  });

  it("finishing does not untrack the run that replaced it", async () => {
    const h = superseding("write");
    await supersede(h);
    let settled = false;
    void h.system.settle().then(() => {
      settled = true;
    });
    await advance(50);
    expect(settled).toBe(false);
    expect(h.runs[1]!.signal.aborted).toBe(false);
    h.system.stop();
    expect(h.runs[1]!.signal.aborted).toBe(true);
    h.system.destroy();
  });
});

describe("abortOn rejects a run's write to a fact changed meanwhile", () => {
  it("rejects every later write to that fact too", async () => {
    const g = gate();
    let signal: AbortSignal | undefined;
    const after: string[] = [];
    const { system, log } = build(
      {
        resolve: async (_req: unknown, context: any) => {
          signal = context.signal;
          await g.promise;
          context.facts.mark = 1;
          context.facts.mark = 2;
          after.push("continued");
        },
      },
      { abortOn: ["mark"] },
    );
    system.facts.go = true;
    await advance(10);
    system.facts.mark = 50;
    await advance(10);
    g.open();
    await advance(10);
    expect(system.facts.mark).toBe(50);
    expect(after).toEqual(["continued"]);
    expect(signal?.aborted).toBe(true);
    expect(signal?.reason).toEqual({
      kind: "clobbered",
      fact: "mark",
      expected: 0,
      actual: 50,
    });
    const rejections = log.rejections.filter((e) => e.kind === "rejection");
    expect(rejections).toHaveLength(1);
    expect(rejections[0]).toMatchObject({
      resolver: "load",
      reason: "clobbered",
      fact: "mark",
      expected: 0,
      actual: 50,
    });
    expect(log.rejections.filter((e) => e.kind === "summary")).toEqual([]);
    system.destroy();
  });

  it("lets a run write an abortOn fact nothing else changed, again and again", async () => {
    const g = gate();
    let signal: AbortSignal | undefined;
    const { system, log } = build(
      {
        resolve: async (_req: unknown, context: any) => {
          signal = context.signal;
          await g.promise;
          context.facts.mark = 1;
          context.facts.mark = 2;
          context.facts.done = true;
        },
      },
      { abortOn: ["mark"] },
    );
    system.facts.go = true;
    await advance(10);
    g.open();
    await advance(10);
    expect(system.facts.mark).toBe(2);
    expect(signal?.aborted).toBe(false);
    expect(log.rejections).toEqual([]);
    expect(log.completes).toBe(1);
    system.destroy();
  });

  it("reports ten rejections, then one summary of the rest", async () => {
    const g = gate();
    const { system, log } = build(
      {
        resolve: async (_req: unknown, context: any) => {
          await g.promise;
          for (const k of CLOBBER_FACTS) {
            context.facts[k] = 1;
          }
        },
      },
      { abortOn: CLOBBER_FACTS },
    );
    system.facts.go = true;
    await advance(10);
    for (const k of CLOBBER_FACTS) {
      system.facts[k] = 100;
    }
    await advance(10);
    g.open();
    await advance(10);
    for (const k of CLOBBER_FACTS) {
      expect(system.facts[k]).toBe(100);
    }
    const rejections = log.rejections.filter((e) => e.kind === "rejection");
    expect(rejections.map((e) => e.fact)).toEqual(CLOBBER_FACTS.slice(0, 10));
    const summaries = log.rejections.filter((e) => e.kind === "summary");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      resolver: "load",
      reason: "clobbered",
      dropped: 1,
    });
    expect((summaries[0]!.req as { id?: unknown }).id).toBeDefined();
    system.destroy();
  });

  it("a bound run retracted from outside keeps retrying to the end", async () => {
    let calls = 0;
    const { system, log } = build(
      {
        retry: { attempts: 2, backoff: "none", initialDelay: 100 },
        resolve: async () => {
          calls++;
          if (calls === 1) {
            throw new Error("fail");
          }
        },
      },
      { abortOn: ["mark"] },
    );
    system.facts.go = true;
    await advance(50);
    system.facts.go = false;
    await advance(200);
    expect(calls).toBe(2);
    expect(log.errors).toEqual([]);
    expect(log.completes).toBe(1);
    system.destroy();
  });
});

describe("the resolver context", () => {
  it("snapshot() returns the current facts", async () => {
    let snap: unknown;
    const { system } = build({
      resolve: async (_req: unknown, context: any) => {
        snap = context.snapshot();
        context.facts.done = true;
      },
    });
    system.facts.mark = 5;
    system.facts.go = true;
    await advance(10);
    expect(snap).toBeTypeOf("object");
    const read = snap as {
      get(key: string): unknown;
      has(key: string): boolean;
    };
    expect(read.get("mark")).toBe(5);
    expect(read.has("go")).toBe(true);
    system.destroy();
  });
});

describe("definition checks", () => {
  it("a resolver with no resolve function is rejected when the system is created", () => {
    const mod = createModule("bad", {
      schema: {
        facts: { go: t.boolean() },
        derivations: {},
        events: {},
        requirements: { LOAD: {} },
      },
      init: (f: any) => {
        f.go = false;
      },
      resolvers: { load: { requirement: "LOAD" } },
    } as never);
    expect(() => createSystem({ module: mod } as never)).toThrow();
  });
});

describe("inspect() shows an in-flight run's status", () => {
  it("pending as it starts, then running with the attempt number; listed as in flight", async () => {
    const atStart: unknown[] = [];
    const g = gate();
    let calls = 0;
    const holder: { system?: any } = {};
    const status = () => Object.values(holder.system.inspect().resolvers)[0];
    const { system } = build(
      {
        retry: { attempts: 2, backoff: "none", initialDelay: 10 },
        resolve: async () => {
          calls++;
          if (calls === 1) {
            throw new Error("fail");
          }
          await g.promise;
        },
      },
      {
        plugins: [
          {
            name: "peek",
            onResolverStart: () => {
              atStart.push(status());
            },
          },
        ],
      },
    );
    holder.system = system;
    system.facts.go = true;
    await advance(0);
    expect(atStart).toHaveLength(1);
    expect(atStart[0]).toMatchObject({ state: "pending" });
    expect(status()).toMatchObject({ state: "running", attempt: 1 });
    expect(system.inspect().inflight).toMatchObject([
      { resolverId: "load", startedAt: Date.now() },
    ]);
    await advance(20);
    expect(calls).toBe(2);
    expect(status()).toMatchObject({ state: "running", attempt: 2 });
    g.open();
    await advance(10);
    expect(system.inspect().resolvers).toEqual({});
    system.destroy();
  });
});
