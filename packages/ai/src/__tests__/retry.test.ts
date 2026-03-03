import { describe, expect, it, vi } from "vitest";
import {
  RetryExhaustedError,
  parseHttpStatus,
  parseRetryAfter,
  withRetry,
} from "../retry.js";
import type { AgentRunner, RunResult } from "../types.js";

// ============================================================================
// Helpers
// ============================================================================

function mockAgent() {
  return { name: "test-agent", instructions: "Be helpful." };
}

function successResult(output = "hello"): RunResult {
  return {
    output,
    messages: [{ role: "assistant", content: output }],
    toolCalls: [],
    totalTokens: 10,
    tokenUsage: { inputTokens: 5, outputTokens: 5 },
  };
}

function makeRunner(results: Array<RunResult | Error>): AgentRunner {
  let callIndex = 0;
  return vi.fn(async () => {
    const result = results[callIndex++];
    if (result instanceof Error) {
      throw result;
    }
    return result!;
  }) as unknown as AgentRunner;
}

// ============================================================================
// parseHttpStatus
// ============================================================================

describe("parseHttpStatus", () => {
  it("extracts 429 from error message", () => {
    expect(parseHttpStatus(new Error("request failed: 429"))).toBe(429);
  });

  it("extracts 503 from error message", () => {
    expect(
      parseHttpStatus(new Error("request failed: 503 Service Unavailable")),
    ).toBe(503);
  });

  it("returns null when no status found", () => {
    expect(parseHttpStatus(new Error("network timeout"))).toBeNull();
  });

  it("extracts status from [Directive] error format", () => {
    expect(
      parseHttpStatus(
        new Error("[Directive] AgentRunner request failed: 401 Unauthorized"),
      ),
    ).toBe(401);
  });
});

// ============================================================================
// parseRetryAfter
// ============================================================================

describe("parseRetryAfter", () => {
  it("extracts Retry-After in seconds", () => {
    expect(parseRetryAfter(new Error("429 rate limited, Retry-After: 5"))).toBe(
      5000,
    );
  });

  it("treats Retry-After as seconds per HTTP spec", () => {
    expect(parseRetryAfter(new Error("429 Retry-After: 30"))).toBe(30000);
  });

  it("returns null when no Retry-After", () => {
    expect(parseRetryAfter(new Error("429 rate limited"))).toBeNull();
  });
});

// ============================================================================
// withRetry
// ============================================================================

describe("withRetry", () => {
  it("returns result on first success (no retries needed)", async () => {
    const inner = makeRunner([successResult("ok")]);
    const runner = withRetry(inner, { maxRetries: 3 });

    const result = await runner(mockAgent(), "hello");
    expect(result.output).toBe("ok");
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("retries on transient error and succeeds", async () => {
    const inner = makeRunner([
      new Error("request failed: 503"),
      successResult("recovered"),
    ]);
    const runner = withRetry(inner, { maxRetries: 3, baseDelayMs: 1 });

    const result = await runner(mockAgent(), "hello");
    expect(result.output).toBe("recovered");
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it("throws RetryExhaustedError when all retries fail", async () => {
    const inner = makeRunner([
      new Error("request failed: 503"),
      new Error("request failed: 503"),
      new Error("request failed: 503"),
      new Error("request failed: 503"),
    ]);
    const runner = withRetry(inner, { maxRetries: 3, baseDelayMs: 1 });

    await expect(runner(mockAgent(), "hello")).rejects.toThrow(
      RetryExhaustedError,
    );
    expect(inner).toHaveBeenCalledTimes(4);
  });

  it("does not retry 400 errors", async () => {
    const inner = makeRunner([new Error("request failed: 400 Bad Request")]);
    const runner = withRetry(inner, { maxRetries: 3, baseDelayMs: 1 });

    await expect(runner(mockAgent(), "hello")).rejects.toThrow(
      RetryExhaustedError,
    );
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("does not retry 401 errors", async () => {
    const inner = makeRunner([new Error("request failed: 401 Unauthorized")]);
    const runner = withRetry(inner, { maxRetries: 3, baseDelayMs: 1 });

    await expect(runner(mockAgent(), "hello")).rejects.toThrow(
      RetryExhaustedError,
    );
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("does not retry 403 errors", async () => {
    const inner = makeRunner([new Error("request failed: 403 Forbidden")]);
    const runner = withRetry(inner, { maxRetries: 3, baseDelayMs: 1 });

    await expect(runner(mockAgent(), "hello")).rejects.toThrow(
      RetryExhaustedError,
    );
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("retries 429 errors", async () => {
    const inner = makeRunner([
      new Error("request failed: 429 Rate Limited"),
      successResult("ok"),
    ]);
    const runner = withRetry(inner, { maxRetries: 2, baseDelayMs: 1 });

    const result = await runner(mockAgent(), "hello");
    expect(result.output).toBe("ok");
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it("calls onRetry callback", async () => {
    const onRetry = vi.fn();
    const inner = makeRunner([
      new Error("request failed: 503"),
      successResult("ok"),
    ]);
    const runner = withRetry(inner, { maxRetries: 2, baseDelayMs: 1, onRetry });

    await runner(mockAgent(), "hello");
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledWith(
      1,
      expect.any(Error),
      expect.any(Number),
    );
  });

  it("respects custom isRetryable predicate", async () => {
    const inner = makeRunner([new Error("custom error"), successResult("ok")]);
    const runner = withRetry(inner, {
      maxRetries: 3,
      baseDelayMs: 1,
      isRetryable: (error) => error.message.includes("custom"),
    });

    const result = await runner(mockAgent(), "hello");
    expect(result.output).toBe("ok");
  });

  it("stops retrying when isRetryable returns false", async () => {
    const inner = makeRunner([new Error("fatal error"), successResult("ok")]);
    const runner = withRetry(inner, {
      maxRetries: 3,
      baseDelayMs: 1,
      isRetryable: () => false,
    });

    await expect(runner(mockAgent(), "hello")).rejects.toThrow(
      RetryExhaustedError,
    );
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("RetryExhaustedError includes retry count and last error", async () => {
    const inner = makeRunner([new Error("error 1"), new Error("error 2")]);
    const runner = withRetry(inner, { maxRetries: 1, baseDelayMs: 1 });

    try {
      await runner(mockAgent(), "hello");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RetryExhaustedError);
      const retryErr = err as RetryExhaustedError;
      expect(retryErr.retryCount).toBe(1);
      expect(retryErr.lastError.message).toBe("error 2");
    }
  });

  it("defaults to 3 retries when no config", async () => {
    const inner = makeRunner([
      new Error("request failed: 503"),
      new Error("request failed: 503"),
      new Error("request failed: 503"),
      successResult("ok"),
    ]);
    const runner = withRetry(inner, { baseDelayMs: 1 });

    const result = await runner(mockAgent(), "hello");
    expect(result.output).toBe("ok");
    expect(inner).toHaveBeenCalledTimes(4);
  });
});

// ============================================================================
// Config Validation (C1)
// ============================================================================

describe("withRetry config validation", () => {
  it("throws on negative maxRetries", () => {
    const inner = makeRunner([successResult("ok")]);
    expect(() => withRetry(inner, { maxRetries: -1 })).toThrow(
      "maxRetries must be a non-negative finite number",
    );
  });

  it("throws on NaN maxRetries", () => {
    const inner = makeRunner([successResult("ok")]);
    expect(() => withRetry(inner, { maxRetries: Number.NaN })).toThrow(
      "maxRetries must be a non-negative finite number",
    );
  });

  it("throws on Infinity maxRetries", () => {
    const inner = makeRunner([successResult("ok")]);
    expect(() =>
      withRetry(inner, { maxRetries: Number.POSITIVE_INFINITY }),
    ).toThrow("maxRetries must be a non-negative finite number");
  });

  it("throws on negative baseDelayMs", () => {
    const inner = makeRunner([successResult("ok")]);
    expect(() => withRetry(inner, { baseDelayMs: -100 })).toThrow(
      "baseDelayMs must be a non-negative finite number",
    );
  });

  it("throws on negative maxDelayMs", () => {
    const inner = makeRunner([successResult("ok")]);
    expect(() => withRetry(inner, { maxDelayMs: -1 })).toThrow(
      "maxDelayMs must be a non-negative finite number",
    );
  });

  it("accepts zero maxRetries (no retries)", async () => {
    const inner = makeRunner([new Error("error")]);
    const runner = withRetry(inner, { maxRetries: 0, baseDelayMs: 1 });

    await expect(runner(mockAgent(), "hello")).rejects.toThrow(
      RetryExhaustedError,
    );
    expect(inner).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Callback Isolation (C2)
// ============================================================================

describe("withRetry callback isolation", () => {
  it("throwing isRetryable is treated as non-retryable", async () => {
    const inner = makeRunner([
      new Error("request failed: 503"),
      successResult("ok"),
    ]);
    const runner = withRetry(inner, {
      maxRetries: 3,
      baseDelayMs: 1,
      isRetryable: () => {
        throw new Error("predicate exploded");
      },
    });

    await expect(runner(mockAgent(), "hello")).rejects.toThrow(
      RetryExhaustedError,
    );
    expect(inner).toHaveBeenCalledTimes(1); // No retry attempted
  });

  it("throwing onRetry does not crash retry flow", async () => {
    const inner = makeRunner([
      new Error("request failed: 503"),
      successResult("recovered"),
    ]);
    const runner = withRetry(inner, {
      maxRetries: 3,
      baseDelayMs: 1,
      onRetry: () => {
        throw new Error("callback exploded");
      },
    });

    const result = await runner(mockAgent(), "hello");
    expect(result.output).toBe("recovered");
    expect(inner).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================
// AbortSignal (M1)
// ============================================================================

describe("withRetry AbortSignal", () => {
  it("aborts retry delay when signal is aborted", async () => {
    const inner = makeRunner([
      new Error("request failed: 503"),
      successResult("ok"),
    ]);
    const controller = new AbortController();
    const runner = withRetry(inner, { maxRetries: 3, baseDelayMs: 60000 });

    const promise = runner(mockAgent(), "hello", { signal: controller.signal });

    // Abort immediately — should not wait 60s
    setTimeout(() => controller.abort(new Error("User cancelled")), 10);

    await expect(promise).rejects.toThrow("User cancelled");
    expect(inner).toHaveBeenCalledTimes(1); // Only the initial call
  });

  it("does not retry when signal is already aborted", async () => {
    const inner = makeRunner([
      new Error("request failed: 503"),
      successResult("ok"),
    ]);
    const controller = new AbortController();
    controller.abort(new Error("Already cancelled"));
    const runner = withRetry(inner, { maxRetries: 3, baseDelayMs: 1 });

    await expect(
      runner(mockAgent(), "hello", { signal: controller.signal }),
    ).rejects.toThrow(RetryExhaustedError);
    expect(inner).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// ReDoS Protection & parseRetryAfter property
// ============================================================================

describe("parseRetryAfter", () => {
  it("reads error.retryAfter property", () => {
    const error = new Error("rate limited") as Error & { retryAfter: number };
    error.retryAfter = 10;
    expect(parseRetryAfter(error)).toBe(10000);
  });
});

describe("parseHttpStatus ReDoS protection", () => {
  it("handles very long error messages without hanging", () => {
    const longMessage = "request failed: " + "a".repeat(100_000) + " 503";
    // The status code is beyond the 1000-char truncation point, so it won't be found
    const result = parseHttpStatus(new Error(longMessage));
    // Should not hang — either finds or doesn't find, but completes quickly
    expect(result === null || typeof result === "number").toBe(true);
  });
});
