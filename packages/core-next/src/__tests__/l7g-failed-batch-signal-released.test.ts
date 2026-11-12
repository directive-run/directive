/**
 * A batch call that failed has ended before its error is told (deep fuzz
 * case 2/1693, api/resolvers.ts `execute`).
 *
 * 1.35's executeBatch releases a batch in its `finally`, then records the
 * errors, so a cancel from an error hook, or from the pass that hook asks
 * for, aborts nothing. Before the fix 2.0 still held the call's signal
 * until the batch's own end, a tick later, and aborted the signal of a
 * call that had already thrown and reported. A with-results batch tells
 * its last-attempt items inline, still running, in both engines, so a
 * cancel then still aborts it.
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

interface Setup {
  /** Requirement ids; each is its own call (maxSize 1). */
  want: string[];
  results?: boolean;
  attempts?: number;
  /** stop() from errorBoundary.onError at the last attempt's error. */
  stopOnError?: boolean;
}

const run = async (setup: Setup) => {
  const log: string[] = [];
  const attempts = setup.attempts ?? 1;
  const tries = new Map<string, number>();
  const handler = async (reqs: Array<{ id: string }>, ctx: any) => {
    const id = reqs.map((req) => req.id).join();
    const n = (tries.get(id) ?? 0) + 1;
    tries.set(id, n);
    ctx.signal.addEventListener("abort", () => log.push(`aborted ${id} ${n}`));
    // "c" succeeds on the last attempt; every other call fails.
    if (id === "c" && n === attempts) {
      return setup.results ? [{ success: true }] : undefined;
    }
    if (setup.results) {
      return [{ success: false, error: new Error(`${id} ${n}`) }];
    }
    throw new Error(`${id} ${n}`);
  };
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
      rb: {
        requirement: "FETCH",
        batch: { enabled: true, windowMs: 1, maxSize: 1 },
        ...(attempts > 1
          ? { retry: { attempts, backoff: "none", initialDelay: 2 } }
          : {}),
        ...(setup.results
          ? { resolveBatchWithResults: handler }
          : { resolveBatch: handler }),
      },
    },
  } as never);
  const system: any = createSystem({
    module: mod,
    errorBoundary: setup.stopOnError
      ? {
          onResolverError: "skip",
          onError: (error: Error) => {
            log.push(`error ${error.message}`);
            if (error.message.endsWith(` ${attempts}`)) {
              system.stop();
            }
          },
        }
      : { onResolverError: "disable" },
    plugins: [
      {
        name: "rec",
        onResolverError: (_resolver: string, req: any) =>
          log.push(`failed ${req.requirement.id}`),
        onResolverCancel: (_resolver: string, req: any) =>
          log.push(`cancel ${req.id}`),
      },
    ],
  } as never);
  system.start();
  system.facts.want = setup.want;
  await vi.advanceTimersByTimeAsync(50);
  system.stop();

  return log;
};

describe("a failed batch call's signal is let go before its error is told", () => {
  it("stop() from the error hook aborts nothing (resolveBatch, no retry)", async () => {
    const log = await run({ want: ["a"], stopOnError: true });
    expect(log).toEqual(["error a 1", "failed a"]);
  });

  it("stop() at the last attempt's error aborts no attempt (retry)", async () => {
    const log = await run({ want: ["a"], attempts: 2, stopOnError: true });
    expect(log).toEqual(["error a 2", "failed a"]);
  });

  it("the pass a disable boundary asks for cancels the failed calls without aborting them", async () => {
    const log = await run({ want: ["a", "b", "c"] });
    expect(log.filter((entry) => entry.startsWith("aborted"))).toEqual([]);
    expect(log).toContain("failed a");
    expect(log).toContain("failed b");
  });

  it("a with-results call told inline is still running: stop() aborts it (1.35)", async () => {
    const log = await run({ want: ["a"], results: true, stopOnError: true });
    expect(log).toEqual(["error a 1", "aborted a 1", "failed a"]);
  });
});
