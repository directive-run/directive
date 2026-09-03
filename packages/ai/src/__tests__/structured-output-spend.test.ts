/**
 * What `withStructuredOutput` reports having spent.
 *
 * The wrapper re-prompts when a model's answer does not parse, so one call from
 * the caller's point of view can be several calls to the provider — each one
 * billed. Every attempt is real money, and the caller has no other way to learn
 * about the ones that failed: they happen inside the wrapper and leave no trace
 * anywhere else.
 *
 * These pin what the wrapper says the call cost, on both exits.
 */

import { describe, expect, it, vi } from "vitest";
import {
  StructuredOutputError,
  withStructuredOutput,
} from "../structured-output.js";
import type { AgentLike, AgentRunner, RunResult } from "../types.js";

const agent: AgentLike = { name: "writer" };

/** A schema that accepts `{ ok: true }` and nothing else. */
const schema = {
  description: "an object with ok: true",
  safeParse(value: unknown) {
    if (
      typeof value === "object" &&
      value !== null &&
      (value as { ok?: unknown }).ok === true
    ) {
      return { success: true as const, data: value };
    }

    return {
      success: false as const,
      error: { issues: [{ path: ["ok"], message: "expected true" }] },
    };
  },
};

/**
 * A runner that bills `tokensPerCall` every time and returns the given outputs
 * in order, so a test can spend three attempts' worth of tokens on the way to
 * one answer.
 */
function billingRunner(outputs: string[], tokensPerCall: number) {
  let call = 0;
  const runner: AgentRunner = async <T>(): Promise<RunResult<T>> => {
    const output = outputs[Math.min(call, outputs.length - 1)]!;
    call += 1;

    return {
      output: output as T,
      messages: [],
      toolCalls: [],
      totalTokens: tokensPerCall,
    };
  };

  return {
    run: runner,
    calls: () => call,
    billed: () => call * tokensPerCall,
  };
}

describe("withStructuredOutput reports what the whole call spent", () => {
  it("counts the attempts that failed to parse, not just the one that worked", async () => {
    // Two unparseable answers, then a good one. Three provider calls, 30 tokens
    // each, so the call cost 90.
    const provider = billingRunner(
      ["not json", "still not json", '{"ok":true}'],
      30,
    );
    const wrapped = withStructuredOutput(provider.run, {
      schema: schema as never,
      maxRetries: 2,
    });

    const result = await wrapped(agent, "go");

    expect(provider.calls()).toBe(3);
    expect(provider.billed()).toBe(90);

    // Before: 30 — the last attempt's tokens, as though the two re-prompts
    // were free. A budget reading this under-counts by the retry rate, which
    // is highest exactly when a model is struggling and costing the most.
    expect(result.totalTokens).toBe(90);
  });

  it("reports the spend on the error when every attempt fails", async () => {
    const provider = billingRunner(["nope"], 30);
    const wrapped = withStructuredOutput(provider.run, {
      schema: schema as never,
      maxRetries: 2,
    });

    await expect(wrapped(agent, "go")).rejects.toThrow(StructuredOutputError);

    let thrown: StructuredOutputError | undefined;
    try {
      await wrapped(agent, "go");
    } catch (error) {
      thrown = error as StructuredOutputError;
    }

    // Three attempts, 30 each. The run produced nothing usable and still cost
    // 90 — the case where knowing the number matters most, and the one where
    // the wrapper used to carry a single attempt's result and no total at all.
    expect(thrown?.totalTokens).toBe(90);
    expect(thrown?.attempts).toBe(3);
  });

  it("counts a single clean attempt exactly once", async () => {
    const provider = billingRunner(['{"ok":true}'], 30);
    const wrapped = withStructuredOutput(provider.run, {
      schema: schema as never,
      maxRetries: 2,
    });

    const result = await wrapped(agent, "go");

    // No double-counting on the path that never retries, which is the common
    // one and the one a summing change is most likely to break.
    expect(provider.calls()).toBe(1);
    expect(result.totalTokens).toBe(30);
  });

  it("sums the input and output breakdown across attempts too", async () => {
    let call = 0;
    const runner: AgentRunner = async <T>(): Promise<RunResult<T>> => {
      call += 1;

      return {
        output: (call < 3 ? "not json" : '{"ok":true}') as T,
        messages: [],
        toolCalls: [],
        totalTokens: 30,
        tokenUsage: { inputTokens: 20, outputTokens: 10 },
      };
    };

    const wrapped = withStructuredOutput(runner, {
      schema: schema as never,
      maxRetries: 2,
    });

    const result = await wrapped(agent, "go");

    // The breakdown is what a per-token price is applied to, so leaving it on
    // the last attempt while the total sums would make the two disagree — one
    // number saying 90 and the other saying 30 is worse than either alone.
    expect(result.tokenUsage?.inputTokens).toBe(60);
    expect(result.tokenUsage?.outputTokens).toBe(30);
    expect(result.totalTokens).toBe(90);
  });

  it("sums cache reads and writes across attempts", async () => {
    let call = 0;
    const runner: AgentRunner = async <T>(): Promise<RunResult<T>> => {
      call += 1;

      return {
        output: (call < 3 ? "not json" : '{"ok":true}') as T,
        messages: [],
        toolCalls: [],
        totalTokens: 30,
        tokenUsage: {
          inputTokens: 20,
          outputTokens: 10,
          cacheReadTokens: 100,
          cacheWriteTokens: 5,
        },
      };
    };

    const wrapped = withStructuredOutput(runner, {
      schema: schema as never,
      maxRetries: 2,
    });

    const result = await wrapped(agent, "go");

    // Cache reads are priced differently from ordinary input, and on a heavily
    // cached prompt they are most of the call. Summing input and output while
    // leaving these on the last attempt would under-count exactly the provider
    // where caching matters most.
    expect(result.tokenUsage?.cacheReadTokens).toBe(300);
    expect(result.tokenUsage?.cacheWriteTokens).toBe(15);
  });

  it("takes the larger of the two cache-write spellings, per attempt", async () => {
    let call = 0;
    const runner: AgentRunner = async <T>(): Promise<RunResult<T>> => {
      call += 1;

      return {
        output: (call < 2 ? "not json" : '{"ok":true}') as T,
        messages: [],
        toolCalls: [],
        totalTokens: 30,
        tokenUsage: {
          inputTokens: 20,
          outputTokens: 10,
          // Both spellings present and disagreeing. The rule is the larger,
          // and it lives in one function; a `??` shortcut here would take
          // whichever name was checked first and under-count by 4 per attempt.
          cacheWriteTokens: 3,
          cacheCreationTokens: 7,
        },
      };
    };

    const wrapped = withStructuredOutput(runner, {
      schema: schema as never,
      maxRetries: 2,
    });

    const result = await wrapped(agent, "go");

    expect(result.tokenUsage?.cacheWriteTokens).toBe(14);
  });

  it("still reports spend when the retry hook throws", async () => {
    const provider = billingRunner(["not json", '{"ok":true}'], 30);
    const wrapped = withStructuredOutput(provider.run, {
      schema: schema as never,
      maxRetries: 2,
      onRetry: () => {
        throw new Error("observer blew up");
      },
    });

    const result = await wrapped(agent, "go");

    // A broken observability hook must not cost the ledger its numbers.
    expect(result.totalTokens).toBe(60);
  });
});

describe("what the caller can see", () => {
  it("tells the caller how many attempts it paid for", async () => {
    const provider = billingRunner(["not json", '{"ok":true}'], 30);
    const onRetry = vi.fn();
    const wrapped = withStructuredOutput(provider.run, {
      schema: schema as never,
      maxRetries: 2,
      onRetry,
    });

    const result = await wrapped(agent, "go");

    // Two attempts at 30 is not the same event as one attempt at 60, and a
    // ledger that only ever sees a total cannot tell them apart.
    expect(result.structuredOutputAttempts).toBe(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
