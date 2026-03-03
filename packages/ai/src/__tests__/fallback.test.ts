import { describe, expect, it, vi } from "vitest";
import { AllProvidersFailedError, withFallback } from "../fallback.js";
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

function failingRunner(error: string): AgentRunner {
  return vi.fn(async () => {
    throw new Error(error);
  }) as unknown as AgentRunner;
}

function succeedingRunner(output: string): AgentRunner {
  return vi.fn(async () => successResult(output)) as unknown as AgentRunner;
}

// ============================================================================
// withFallback
// ============================================================================

describe("withFallback", () => {
  it("returns result from first runner on success", async () => {
    const runner = withFallback([
      succeedingRunner("from-primary"),
      succeedingRunner("from-fallback"),
    ]);

    const result = await runner(mockAgent(), "hello");
    expect(result.output).toBe("from-primary");
  });

  it("falls back to second runner when first fails", async () => {
    const primary = failingRunner("primary down");
    const fallback = succeedingRunner("from-fallback");
    const runner = withFallback([primary, fallback]);

    const result = await runner(mockAgent(), "hello");
    expect(result.output).toBe("from-fallback");
    expect(primary).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("falls back through multiple providers", async () => {
    const runner = withFallback([
      failingRunner("provider-1 down"),
      failingRunner("provider-2 down"),
      succeedingRunner("from-provider-3"),
    ]);

    const result = await runner(mockAgent(), "hello");
    expect(result.output).toBe("from-provider-3");
  });

  it("throws AllProvidersFailedError when all fail", async () => {
    const runner = withFallback([
      failingRunner("error-1"),
      failingRunner("error-2"),
      failingRunner("error-3"),
    ]);

    await expect(runner(mockAgent(), "hello")).rejects.toThrow(
      AllProvidersFailedError,
    );
  });

  it("AllProvidersFailedError contains all errors", async () => {
    const runner = withFallback([
      failingRunner("error-1"),
      failingRunner("error-2"),
    ]);

    try {
      await runner(mockAgent(), "hello");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AllProvidersFailedError);
      const allErr = err as AllProvidersFailedError;
      expect(allErr.errors).toHaveLength(2);
      expect(allErr.errors[0]!.message).toBe("error-1");
      expect(allErr.errors[1]!.message).toBe("error-2");
    }
  });

  it("calls onFallback callback", async () => {
    const onFallback = vi.fn();
    const runner = withFallback(
      [failingRunner("error-1"), succeedingRunner("ok")],
      { onFallback },
    );

    await runner(mockAgent(), "hello");
    expect(onFallback).toHaveBeenCalledOnce();
    expect(onFallback).toHaveBeenCalledWith(0, 1, expect.any(Error));
  });

  it("respects shouldFallback predicate", async () => {
    const runner = withFallback(
      [failingRunner("fatal error"), succeedingRunner("ok")],
      { shouldFallback: (error) => !error.message.includes("fatal") },
    );

    await expect(runner(mockAgent(), "hello")).rejects.toThrow(
      AllProvidersFailedError,
    );
  });

  it("shouldFallback true allows fallback", async () => {
    const runner = withFallback(
      [failingRunner("transient"), succeedingRunner("ok")],
      { shouldFallback: () => true },
    );

    const result = await runner(mockAgent(), "hello");
    expect(result.output).toBe("ok");
  });

  it("throws when given empty runners array", () => {
    expect(() => withFallback([])).toThrow("at least one runner");
  });

  it("works with a single runner", async () => {
    const runner = withFallback([succeedingRunner("only-one")]);

    const result = await runner(mockAgent(), "hello");
    expect(result.output).toBe("only-one");
  });

  it("single runner failure gives AllProvidersFailedError with one error", async () => {
    const runner = withFallback([failingRunner("solo error")]);

    try {
      await runner(mockAgent(), "hello");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AllProvidersFailedError);
      expect((err as AllProvidersFailedError).errors).toHaveLength(1);
    }
  });
});

// ============================================================================
// Callback Isolation (C2)
// ============================================================================

describe("withFallback callback isolation", () => {
  it("throwing shouldFallback stops fallback (treats as non-fallbackable)", async () => {
    const runner = withFallback(
      [failingRunner("transient"), succeedingRunner("ok")],
      {
        shouldFallback: () => {
          throw new Error("predicate exploded");
        },
      },
    );

    await expect(runner(mockAgent(), "hello")).rejects.toThrow(
      AllProvidersFailedError,
    );
  });

  it("throwing onFallback does not crash fallback flow", async () => {
    const runner = withFallback(
      [failingRunner("error-1"), succeedingRunner("ok")],
      {
        onFallback: () => {
          throw new Error("callback exploded");
        },
      },
    );

    const result = await runner(mockAgent(), "hello");
    expect(result.output).toBe("ok");
  });
});

// ============================================================================
// AllProvidersFailedError improvements (E9)
// ============================================================================

describe("AllProvidersFailedError", () => {
  it("message includes [Directive] prefix", async () => {
    const runner = withFallback([failingRunner("error-1")]);

    try {
      await runner(mockAgent(), "hello");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).message).toMatch(/^\[Directive\]/);
    }
  });

  it("errors array is frozen (immutable)", async () => {
    const runner = withFallback([
      failingRunner("error-1"),
      failingRunner("error-2"),
    ]);

    try {
      await runner(mockAgent(), "hello");
      expect.unreachable("should have thrown");
    } catch (err) {
      const allErr = err as AllProvidersFailedError;
      expect(Object.isFrozen(allErr.errors)).toBe(true);
      expect(() => {
        (allErr.errors as Error[]).push(new Error("injected"));
      }).toThrow();
    }
  });

  it("cause is set to the last error", async () => {
    const runner = withFallback([
      failingRunner("first"),
      failingRunner("last"),
    ]);

    try {
      await runner(mockAgent(), "hello");
      expect.unreachable("should have thrown");
    } catch (err) {
      const allErr = err as AllProvidersFailedError;
      expect((allErr.cause as Error).message).toBe("last");
    }
  });
});
