/**
 * L3e: the owner-approved L3 fixes, where 2.0 differs from 1.35 on purpose.
 *
 * - (n) A timeout aborts the timed-out attempt's `context.signal`, with the
 *   timeout error as its reason. Each attempt has its own signal; the
 *   outcome is read from the run's, so a timeout is never a cancel.
 * - (p) Under "retry-later" a due entry re-dispatches each requirement it
 *   recorded that is still raised (1.35 never runs the resolver again), at
 *   most `maxRetries` times in a row per requirement.
 *
 * (q) and (r) are pinned beside their 1.35 neighbours (l3c, l3a).
 */

import { getEventListeners } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystemCore } from "../api/core.js";
import { withErrorBoundary } from "../api/errors.js";
import { withPlugins } from "../api/plugins.js";
import { withReconcile } from "../api/reconcile.js";
import { createResolvers } from "../api/resolvers.js";
import { t } from "../api/schema-builders.js";
import { createVirtualClock } from "../clock.js";
import { createScheduler } from "../scheduler.js";

afterEach(() => vi.restoreAllMocks());

/** Let microtasks and the scheduler's flushes run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

function outcomes() {
  const order: string[] = [];
  const plugin = {
    name: "outcomes",
    onResolverStart: () => order.push("start"),
    onResolverComplete: () => order.push("complete"),
    onResolverCancel: () => order.push("cancel"),
    onResolverError: () => order.push("error"),
    onResolverRetry: () => order.push("retry"),
    onReconcileStart: () => order.push("pass"),
  };

  return { order, plugin };
}

function build(definition: Record<string, unknown>, parts: unknown[] = []) {
  const clock = createVirtualClock();
  const { order, plugin } = outcomes();
  const mod = createModule("m", {
    schema: {
      facts: { a: t.boolean(), b: t.boolean(), n: t.number() },
      derivations: {},
      events: {},
      requirements: {},
    },
    init: (f: any) => {
      f.a = false;
      f.b = false;
      f.n = 0;
    },
    ...definition,
  } as never);
  const system = createSystemCore(
    { module: mod } as never,
    [...(parts as never[]), withReconcile, withPlugins([plugin as never])],
    { clock, scheduler: createScheduler() },
  ) as any;

  return { system, clock, order };
}

/** Advance the virtual clock in steps, letting each step's work run. */
async function advance(
  clock: { advanceTo(ms: number): void },
  ...at: number[]
) {
  for (const ms of at) {
    clock.advanceTo(ms);
    await flush();
  }
}

describe("(n) approved: per-attempt signals", () => {
  for (const honours of [false, true]) {
    it(`a timed-out attempt's signal aborts, the retry's starts clean, and the run completes (body ${honours ? "honours" : "ignores"} its signal)`, async () => {
      const signals: AbortSignal[] = [];
      const reasons: string[] = [];
      const { system, clock, order } = build({
        constraints: {
          c: { when: (f: any) => f.a, require: { type: "LOAD" } },
        },
        resolvers: {
          load: {
            requirement: "LOAD",
            timeout: 50,
            retry: {
              attempts: 3,
              backoff: "none",
              initialDelay: 10,
              shouldRetry: (_e: Error, _n: number, ctx: { reason: string }) => {
                reasons.push(ctx.reason);

                return true;
              },
            },
            resolve: (_req: unknown, ctx: any) => {
              signals.push(ctx.signal);
              if (signals.length === 3) {
                return Promise.resolve();
              }

              return new Promise<void>((_resolve, reject) => {
                if (honours) {
                  ctx.signal.addEventListener("abort", () =>
                    reject(ctx.signal.reason),
                  );
                }
              });
            },
          },
        },
      });
      vi.spyOn(console, "warn").mockImplementation(() => {});
      system.start();
      system.facts.a = true;
      await flush();
      expect(signals).toHaveLength(1);
      expect(signals[0]!.aborted).toBe(false);
      await advance(clock, 50);
      // Only the attempt gave up: its signal says why.
      expect(signals[0]!.aborted).toBe(true);
      expect(String(signals[0]!.reason)).toMatch(/timed out after 50ms/);
      await advance(clock, 60);
      expect(signals).toHaveLength(2);
      expect(signals[1]).not.toBe(signals[0]);
      expect(signals[1]!.aborted).toBe(false);
      await advance(clock, 110, 120);
      expect(signals).toHaveLength(3);
      expect(signals[1]!.aborted).toBe(true);
      expect(signals[2]!.aborted).toBe(false);
      expect(reasons).toEqual(["timeout", "timeout"]);
      // The outcomes are 1.35's: two retries, then one completion.
      expect(order.filter((o) => o !== "pass")).toEqual([
        "start",
        "retry",
        "retry",
        "complete",
      ]);
      expect(system.facts.a).toBe(true);
      system.destroy();
    });
  }

  it("every attempt timing out is one error, never a cancel, each attempt aborted by its own timeout", async () => {
    const signals: AbortSignal[] = [];
    const { system, clock, order } = build({
      constraints: {
        c: { when: (f: any) => f.a, require: { type: "LOAD" } },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          timeout: 50,
          retry: { attempts: 2, backoff: "none", initialDelay: 10 },
          resolve: (_req: unknown, ctx: any) => {
            signals.push(ctx.signal);

            return new Promise(() => {});
          },
        },
      },
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    system.start();
    system.facts.a = true;
    await flush();
    await advance(clock, 50, 60);
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
    await advance(clock, 110);
    expect(signals[1]!.aborted).toBe(true);
    expect(signals[1]!.reason).not.toBe(signals[0]!.reason);
    expect(order.filter((o) => o !== "pass")).toEqual([
      "start",
      "retry",
      "error",
    ]);
    system.stop();
    await flush();
    expect(order.filter((o) => o !== "pass")).toEqual([
      "start",
      "retry",
      "error",
    ]);
    system.destroy();
  });

  it("stop() during a retry aborts that attempt's signal, and the outcome is the cancel", async () => {
    const signals: AbortSignal[] = [];
    const { system, clock, order } = build({
      constraints: {
        c: { when: (f: any) => f.a, require: { type: "LOAD" } },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          timeout: 50,
          retry: { attempts: 3, backoff: "none", initialDelay: 10 },
          resolve: (_req: unknown, ctx: any) => {
            signals.push(ctx.signal);

            return new Promise(() => {});
          },
        },
      },
    });
    system.start();
    system.facts.a = true;
    await flush();
    await advance(clock, 50, 60);
    expect(signals).toHaveLength(2);
    expect(signals[1]!.aborted).toBe(false);
    system.stop();
    expect(signals[1]!.aborted).toBe(true);
    await advance(clock, 200);
    expect(signals).toHaveLength(2);
    expect(order.filter((o) => o !== "pass")).toEqual([
      "start",
      "retry",
      "cancel",
    ]);
    system.destroy();
  });
});

describe("(p) approved: retry-later re-dispatches the resolver", () => {
  for (const retract of [false, true]) {
    it(`two requirements of one resolver: due, each still raised runs once more${retract ? "; the retracted one does not" : ""}`, async () => {
      const calls: Record<string, number> = { A: 0, B: 0 };
      const { system, clock, order } = build(
        {
          constraints: {
            ca: {
              when: (f: any) => f.a,
              require: { type: "WORK", which: "A" },
            },
            cb: {
              when: (f: any) => f.b,
              require: { type: "WORK", which: "B" },
            },
          },
          resolvers: {
            work: {
              requirement: "WORK",
              resolve: async (req: { which: string }) => {
                // Each fails once, then succeeds.
                if (++calls[req.which]! === 1) {
                  throw new Error(`down ${req.which}`);
                }
              },
            },
          },
        },
        [
          withErrorBoundary({
            onResolverError: "retry-later",
            retryLater: { delayMs: 300, maxRetries: 3 },
          }),
        ],
      );
      system.start();
      system.facts.a = true;
      system.facts.b = true;
      await flush();
      expect(calls).toEqual({ A: 1, B: 1 });
      // One entry for the resolver: B's failure replaced A's, carrying A's
      // id forward, and (1.35's count) is due at 600 ms.
      if (retract) {
        system.facts.b = false;
      }
      await advance(clock, 100, 300, 500);
      expect(calls).toEqual({ A: 1, B: 1 });
      await advance(clock, 600, 610);
      expect(calls).toEqual({ A: 2, B: retract ? 1 : 2 });
      await advance(clock, 5000, 20_000);
      expect(calls).toEqual({ A: 2, B: retract ? 1 : 2 });
      const runs = order.filter((o) => o !== "pass");
      expect(runs.filter((o) => o === "complete")).toHaveLength(
        retract ? 1 : 2,
      );
      expect(runs.filter((o) => o === "cancel")).toHaveLength(0);
      system.destroy();
    });
  }

  it("a requirement retracted while it waits is not run again, and its due entry runs 1.35's one pass", async () => {
    let calls = 0;
    const { system, clock, order } = build(
      {
        constraints: {
          c: { when: (f: any) => f.a, require: { type: "WORK" } },
        },
        resolvers: {
          work: {
            requirement: "WORK",
            resolve: async () => {
              calls++;
              throw new Error("down");
            },
          },
        },
      },
      [
        withErrorBoundary({
          onResolverError: "retry-later",
          retryLater: { delayMs: 300, maxRetries: 3 },
        }),
      ],
    );
    system.start();
    system.facts.a = true;
    await flush();
    system.facts.a = false;
    await advance(clock, 100);
    const before = order.filter((o) => o === "pass").length;
    await advance(clock, 300, 310, 600, 5000);
    expect(calls).toBe(1);
    // The due pass, and no second one for a requeue.
    expect(order.filter((o) => o === "pass").length - before).toBe(1);
    system.destroy();
  });

  it("a requirement raised anew and in flight when its entry is due is not dispatched again after it completes", async () => {
    let calls = 0;
    let release!: () => void;
    const { system, clock } = build(
      {
        constraints: {
          c: { when: (f: any) => f.a, require: { type: "WORK" } },
        },
        resolvers: {
          work: {
            requirement: "WORK",
            resolve: async () => {
              calls++;
              if (calls === 1) {
                throw new Error("down");
              }
              await new Promise<void>((r) => {
                release = r;
              });
            },
          },
        },
      },
      [
        withErrorBoundary({
          onResolverError: "retry-later",
          retryLater: { delayMs: 300, maxRetries: 3 },
        }),
      ],
    );
    system.start();
    system.facts.a = true;
    await flush();
    expect(calls).toBe(1);
    system.facts.a = false;
    await flush();
    system.facts.a = true;
    await flush();
    // Raised anew: dispatched as 1.35 does; still running when due.
    expect(calls).toBe(2);
    await advance(clock, 300, 310);
    expect(calls).toBe(2);
    release();
    await flush();
    await advance(clock, 600, 900, 5000);
    // It completed, and that dropped the entry: no third run.
    expect(calls).toBe(2);
    system.destroy();
  });
});

describe("(n) a timeout's reason, and the attempts' listeners", () => {
  for (const satisfy of [false, true]) {
    it(`a ${satisfy ? "satisfied, " : ""}timed-out attempt's signal aborts with ${satisfy ? "1.35's plain AbortError" : "the timeout error"}`, async () => {
      const signals: AbortSignal[] = [];
      const { system, clock, order } = build({
        constraints: {
          c: { when: (f: any) => f.a && !f.b, require: { type: "LOAD" } },
        },
        resolvers: {
          load: {
            requirement: "LOAD",
            timeout: 50,
            resolve: (_req: unknown, ctx: any) => {
              signals.push(ctx.signal);
              if (satisfy) {
                ctx.facts.b = true;
              }

              return new Promise(() => {});
            },
          },
        },
      });
      vi.spyOn(console, "warn").mockImplementation(() => {});
      system.start();
      system.facts.a = true;
      await flush();
      expect(signals[0]!.aborted).toBe(false);
      await advance(clock, 50, 60);
      expect(signals).toHaveLength(1);
      expect(signals[0]!.aborted).toBe(true);
      const reason = signals[0]!.reason as Error;
      if (satisfy) {
        expect(reason.name).toBe("AbortError");
        expect(reason.message).not.toMatch(/timed out/);
      } else {
        expect(reason).toBeInstanceOf(Error);
        expect(reason.message).toMatch(/timed out after 50ms/);
      }
      expect(order.filter((o) => o !== "pass")).toEqual(["start", "error"]);
      system.destroy();
    });
  }

  it("each attempt leaves no abort listener on the run's signal", async () => {
    const clock = createVirtualClock();
    const counts: number[] = [];
    let runSignal: AbortSignal | undefined;
    let errors = 0;
    const resolvers = createResolvers({
      defs: {
        load: {
          requirement: "LOAD",
          retry: { attempts: 4, backoff: "none", initialDelay: 10 },
          resolve: () => {
            runSignal ??= resolvers.inflight.get("r")!.controller_.signal;
            counts.push(getEventListeners(runSignal, "abort").length);
            throw new Error("down");
          },
        },
      },
      store: { batch: (fn) => fn() },
      factsFor: () => ({ $snapshot: () => ({}) }) as never,
      peek: () => undefined,
      has: () => false,
      onDrop: () => {},
      bindingOf: () => undefined,
      clock,
      owner: 1,
      random: () => 0,
      emit: () => {},
      onComplete: () => {},
      onError: () => {
        errors++;
      },
      onEnd: () => {},
      onRequeue: () => {},
    });
    resolvers.resolve({
      id: "r",
      requirement: { type: "LOAD" },
      fromConstraint: "c",
    });
    await flush();
    await advance(clock, 10, 20, 30, 40, 100);
    // Only the attempt's own relay while it runs: none left by the last
    // attempt or by a retry wait.
    expect(counts).toEqual([1, 1, 1, 1]);
    expect(errors).toBe(1);
    expect(getEventListeners(runSignal!, "abort")).toHaveLength(0);
  });
});

describe("(p) the bound: at most maxRetries re-dispatches in a row per requirement", () => {
  /** Two requirements, A and B, of one resolver; `fail` decides each run. */
  function twoOfOne(
    maxRetries: number,
    fail: (which: string, call: number) => boolean,
  ) {
    const calls: Record<string, number> = { A: 0 };
    const built = build(
      {
        constraints: {
          ca: {
            when: (f: any) => f.a,
            require: { type: "WORK", which: "A" },
          },
          cb: {
            when: (f: any) => f.b,
            require: { type: "WORK", which: "B" },
          },
        },
        resolvers: {
          work: {
            requirement: "WORK",
            resolve: async (req: { which: string }, ctx: any) => {
              const call = (calls[req.which] = (calls[req.which] ?? 0) + 1);
              if (fail(req.which, call)) {
                throw new Error(`down ${req.which}`);
              }
              // A completed run that asks to run again: still raised.
              ctx.requeue();
            },
          },
        },
      },
      [
        withErrorBoundary({
          onResolverError: "retry-later",
          retryLater: { delayMs: 300, maxRetries, backoffMultiplier: 1 },
        }),
      ],
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    return { ...built, calls };
  }
  /** Run the virtual clock to `to` in 100 ms steps. */
  async function runTo(clock: { advanceTo(ms: number): void }, to: number) {
    for (let ms = 100; ms <= to; ms += 100) {
      await advance(clock, ms);
    }
  }

  it("two requirements always failing (maxRetries 2): each re-runs at most twice", async () => {
    const { system, clock, calls } = twoOfOne(2, () => true);
    system.start();
    system.facts.a = true;
    system.facts.b = true;
    await flush();
    await runTo(clock, 6000);
    // 1.35's shared count starts over when used up (A's fallback), so B
    // would run a third time again without the per-requirement bound.
    expect(calls).toEqual({ A: 2, B: 3 });
    system.destroy();
  });

  it("a retraction starts the count over", async () => {
    const { system, clock, calls } = twoOfOne(3, () => true);
    system.start();
    system.facts.a = true;
    system.facts.b = true;
    await flush();
    await runTo(clock, 3000);
    // A: three re-runs, then held at the bound; B's fifth shared attempt
    // fell back to skip after one.
    expect(calls).toEqual({ A: 4, B: 2 });
    system.facts.a = false;
    await flush();
    system.facts.a = true;
    await flush();
    await runTo(clock, 6000);
    // Raised anew: dispatched, then requeued once more before 1.35's
    // fallback ends it.
    expect(calls).toEqual({ A: 6, B: 2 });
    system.destroy();
  });

  it("a completed run starts the count over", async () => {
    // A fails twice, completes (asking to run again), then always fails.
    const { system, clock, calls } = twoOfOne(2, (_w, call) => call !== 3);
    system.start();
    system.facts.a = true;
    await flush();
    await runTo(clock, 6000);
    // Two re-dispatches, the completed third run, its own requeue, and two
    // re-dispatches more before 1.35's fallback.
    expect(calls).toEqual({ A: 6 });
    system.destroy();
  });
});
