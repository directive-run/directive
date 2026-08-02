import { describe, expect, it, vi } from "vitest";
import { createAgentOrchestrator } from "../agent-orchestrator.js";
import { GuardrailError } from "../types.js";
import type { AgentLike, AgentRunner, RunResult } from "../types.js";

// ============================================================================
// Helpers
// ============================================================================

function mockAgent(overrides: Partial<AgentLike> = {}): AgentLike {
  return {
    name: "test-agent",
    instructions: "Be helpful.",
    ...overrides,
  };
}

function successResult(output = "Hello!"): RunResult {
  return {
    output,
    messages: [{ role: "assistant", content: output }],
    toolCalls: [],
    totalTokens: 10,
    tokenUsage: { inputTokens: 5, outputTokens: 5 },
  };
}

function createMockRunner(
  results: Array<RunResult | Error> = [successResult()],
): AgentRunner {
  let callIndex = 0;
  return vi.fn(async () => {
    const result = results[callIndex++ % results.length];
    if (result instanceof Error) {
      throw result;
    }

    return result!;
  }) as unknown as AgentRunner;
}

// ============================================================================
// Basic run lifecycle
// ============================================================================

describe("createAgentOrchestrator", () => {
  it("runs an agent and returns result", async () => {
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({ runner });

    const result = await orchestrator.run(mockAgent(), "Hello");

    expect(result.output).toBe("Hello!");
    expect(result.totalTokens).toBe(10);
  });

  it("updates facts after a run", async () => {
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({ runner });

    await orchestrator.run(mockAgent(), "Hello");

    expect(orchestrator.facts.agent.status).toBe("completed");
    expect(orchestrator.facts.agent.tokenUsage).toBe(10);
    expect(orchestrator.facts.agent.output).toBe("Hello!");
  });

  it("accumulates token usage across runs", async () => {
    const runner = createMockRunner([successResult(), successResult()]);
    const orchestrator = createAgentOrchestrator({ runner });

    await orchestrator.run(mockAgent(), "First");
    await orchestrator.run(mockAgent(), "Second");

    expect(orchestrator.totalTokens).toBe(20);
  });

  it("passes input to the runner", async () => {
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({ runner });

    await orchestrator.run(mockAgent(), "specific input");

    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({ name: "test-agent" }),
      "specific input",
      expect.anything(),
    );
  });

  it("exposes the underlying system", () => {
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({ runner });

    expect(orchestrator.system).toBeDefined();
  });
});

// ============================================================================
// Input guardrails
// ============================================================================

describe("input guardrails", () => {
  it("blocks run when input guardrail fails", async () => {
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({
      runner,
      guardrails: {
        input: [() => ({ passed: false, reason: "blocked" })],
      },
    });

    await expect(orchestrator.run(mockAgent(), "bad input")).rejects.toThrow(
      GuardrailError,
    );
    expect(runner).not.toHaveBeenCalled();
  });

  it("allows run when input guardrail passes", async () => {
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({
      runner,
      guardrails: {
        input: [() => ({ passed: true })],
      },
    });

    const result = await orchestrator.run(mockAgent(), "good input");

    expect(result.output).toBe("Hello!");
  });

  it("applies input transformation from guardrail", async () => {
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({
      runner,
      guardrails: {
        input: [() => ({ passed: true, transformed: "sanitized input" })],
      },
    });

    await orchestrator.run(mockAgent(), "raw input");

    expect(runner).toHaveBeenCalledWith(
      expect.anything(),
      "sanitized input",
      expect.anything(),
    );
  });

  it("per-call inputGuardrails override defaults", async () => {
    const defaultGuardrail = vi.fn(() => ({ passed: true }));
    const perCallGuardrail = vi.fn(() => ({ passed: true }));
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({
      runner,
      guardrails: { input: [defaultGuardrail] },
    });

    await orchestrator.run(mockAgent(), "Hello", {
      inputGuardrails: [perCallGuardrail],
    });

    expect(defaultGuardrail).not.toHaveBeenCalled();
    expect(perCallGuardrail).toHaveBeenCalled();
  });
});

// ============================================================================
// Output guardrails
// ============================================================================

describe("output guardrails", () => {
  it("throws when output guardrail fails", async () => {
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({
      runner,
      guardrails: {
        output: [() => ({ passed: false, reason: "toxic content" })],
      },
    });

    await expect(orchestrator.run(mockAgent(), "Hello")).rejects.toThrow(
      GuardrailError,
    );
  });

  it("applies output transformation from guardrail", async () => {
    const runner = createMockRunner([successResult("raw output")]);
    const orchestrator = createAgentOrchestrator({
      runner,
      guardrails: {
        output: [() => ({ passed: true, transformed: "cleaned output" })],
      },
    });

    const result = await orchestrator.run(mockAgent(), "Hello");

    expect(result.output).toBe("cleaned output");
  });

  it("per-call outputGuardrails override defaults", async () => {
    const defaultGuardrail = vi.fn(() => ({ passed: true }));
    const perCallGuardrail = vi.fn(() => ({ passed: true }));
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({
      runner,
      guardrails: { output: [defaultGuardrail] },
    });

    await orchestrator.run(mockAgent(), "Hello", {
      outputGuardrails: [perCallGuardrail],
    });

    expect(defaultGuardrail).not.toHaveBeenCalled();
    expect(perCallGuardrail).toHaveBeenCalled();
  });

  it("empty per-call guardrails skip all checks", async () => {
    const defaultGuardrail = vi.fn(() => ({
      passed: false,
      reason: "blocked",
    }));
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({
      runner,
      guardrails: { output: [defaultGuardrail] },
    });

    const result = await orchestrator.run(mockAgent(), "Hello", {
      outputGuardrails: [],
    });

    expect(result.output).toBe("Hello!");
    expect(defaultGuardrail).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Named guardrails
// ============================================================================

describe("named guardrails", () => {
  it("uses guardrail name in error message", async () => {
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({
      runner,
      guardrails: {
        input: [
          {
            name: "pii-detector",
            fn: () => ({ passed: false, reason: "PII found" }),
          },
        ],
      },
    });

    await expect(
      orchestrator.run(mockAgent(), "my ssn is 123-45-6789"),
    ).rejects.toThrow(/pii-detector/);
  });
});

// ============================================================================
// Error handling
// ============================================================================

describe("error handling", () => {
  it("propagates runner errors", async () => {
    const runner = createMockRunner([new Error("LLM down")]);
    const orchestrator = createAgentOrchestrator({ runner });

    await expect(orchestrator.run(mockAgent(), "Hello")).rejects.toThrow(
      "LLM down",
    );
  });

  it("GuardrailError has correct properties", async () => {
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({
      runner,
      guardrails: {
        input: [
          {
            name: "test-guard",
            fn: () => ({ passed: false, reason: "bad input" }),
          },
        ],
      },
    });

    try {
      await orchestrator.run(mockAgent(), "Hello");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GuardrailError);
      const error = err as GuardrailError;
      expect(error.code).toBe("INPUT_GUARDRAIL_FAILED");
      expect(error.guardrailName).toBe("test-guard");
      expect(error.guardrailType).toBe("input");
    }
  });
});

// ============================================================================
// Lifecycle hooks
// ============================================================================

describe("lifecycle hooks", () => {
  it("fires onAgentStart and onAgentComplete hooks", async () => {
    const onAgentStart = vi.fn();
    const onAgentComplete = vi.fn();
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({
      runner,
      hooks: { onAgentStart, onAgentComplete },
    });

    await orchestrator.run(mockAgent(), "Hello");

    expect(onAgentStart).toHaveBeenCalledWith(
      expect.objectContaining({ agentName: "test-agent", input: "Hello" }),
    );
    expect(onAgentComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        agentName: "test-agent",
        output: "Hello!",
        tokenUsage: 10,
      }),
    );
  });

  it("fires onGuardrailCheck hook", async () => {
    const onGuardrailCheck = vi.fn();
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({
      runner,
      hooks: { onGuardrailCheck },
      guardrails: { input: [() => ({ passed: true })] },
    });

    await orchestrator.run(mockAgent(), "Hello");

    expect(onGuardrailCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        guardrailType: "input",
        passed: true,
      }),
    );
  });

  it("swallows hook errors", async () => {
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({
      runner,
      hooks: {
        onAgentStart: () => {
          throw new Error("hook error");
        },
      },
    });

    // Should not throw despite hook error
    const result = await orchestrator.run(mockAgent(), "Hello");

    expect(result.output).toBe("Hello!");
  });
});

// ============================================================================
// Token budget
// ============================================================================

describe("token budget", () => {
  it("fires onBudgetWarning when threshold reached", async () => {
    const onBudgetWarning = vi.fn();
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({
      runner,
      maxTokenBudget: 10,
      budgetWarningThreshold: 0.8,
      onBudgetWarning,
    });

    await orchestrator.run(mockAgent(), "Hello"); // 10 tokens = 100% > 80%

    expect(onBudgetWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        maxBudget: 10,
      }),
    );
  });

  it("fires warning only once", async () => {
    const onBudgetWarning = vi.fn();
    const runner = createMockRunner([successResult(), successResult()]);
    const orchestrator = createAgentOrchestrator({
      runner,
      maxTokenBudget: 10,
      budgetWarningThreshold: 0.5,
      onBudgetWarning,
    });

    await orchestrator.run(mockAgent(), "First"); // 10 tokens > 50% of 10
    await orchestrator.run(mockAgent(), "Second"); // Already warned

    expect(onBudgetWarning).toHaveBeenCalledTimes(1);
  });

  it("throws on invalid budgetWarningThreshold", () => {
    const runner = createMockRunner();

    expect(() =>
      createAgentOrchestrator({ runner, budgetWarningThreshold: 1.5 }),
    ).toThrow("budgetWarningThreshold must be between 0 and 1");
  });
});

// ============================================================================
// Pause / Resume / Reset
// ============================================================================

describe("pause / resume / reset", () => {
  it("pause sets status to paused", () => {
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({ runner });

    orchestrator.pause();

    expect(orchestrator.facts.agent.status).toBe("paused");
  });

  it("resume sets status back to idle when no agent running", () => {
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({ runner });

    orchestrator.pause();
    orchestrator.resume();

    expect(orchestrator.facts.agent.status).toBe("idle");
  });

  it("reset clears all state", async () => {
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({ runner });

    await orchestrator.run(mockAgent(), "Hello");
    orchestrator.reset();

    expect(orchestrator.facts.agent.status).toBe("idle");
    expect(orchestrator.facts.agent.tokenUsage).toBe(0);
    expect(orchestrator.facts.agent.output).toBeNull();
    expect(orchestrator.totalTokens).toBe(0);
  });
});

// ============================================================================
// Validation
// ============================================================================

describe("validation", () => {
  it("throws when autoApproveToolCalls=false without callback", () => {
    const runner = createMockRunner();

    expect(() =>
      createAgentOrchestrator({
        runner,
        autoApproveToolCalls: false,
      }),
    ).toThrow("autoApproveToolCalls is false but no onApprovalRequest");
  });

  it("throws when factsSchema uses reserved keys", () => {
    const runner = createMockRunner();

    expect(() =>
      createAgentOrchestrator({
        runner,
        factsSchema: { agent: { _type: "", _validators: [] } },
      } as any),
    ).toThrow('Facts schema key "agent" conflicts with orchestrator state');
  });
});

// ============================================================================
// Debug mode
// ============================================================================

describe("debug", () => {
  it("timeline is null when debug is false", () => {
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({ runner, debug: false });

    expect(orchestrator.timeline).toBeNull();
  });

  it("timeline is available when debug is true", () => {
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({ runner, debug: true });

    expect(orchestrator.timeline).not.toBeNull();
  });

  it("records events to timeline during run", async () => {
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({ runner, debug: true });

    await orchestrator.run(mockAgent(), "Hello");

    const events = orchestrator.timeline!.getEvents();

    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "agent_start")).toBe(true);
    expect(events.some((e) => e.type === "agent_complete")).toBe(true);
  });
});

// ============================================================================
// Streaming
// ============================================================================

describe("runStream", () => {
  it("emits progress and done chunks", async () => {
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({ runner });

    const { stream, result } = orchestrator.runStream(mockAgent(), "Hello");
    const chunks: Array<{ type: string }> = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const finalResult = await result;

    expect(chunks.some((c) => c.type === "progress")).toBe(true);
    expect(chunks.some((c) => c.type === "done")).toBe(true);
    expect(finalResult.output).toBe("Hello!");
  });

  it("abort closes the stream", async () => {
    const runner = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 100));

      return successResult();
    }) as unknown as AgentRunner;
    const orchestrator = createAgentOrchestrator({ runner });

    const { stream, abort } = orchestrator.runStream(mockAgent(), "Hello");

    // Abort immediately
    abort();

    const chunks: Array<{ type: string }> = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    // Stream should be closed — may have progress chunks but should terminate
    expect(chunks.length).toBeGreaterThanOrEqual(0);
    // The done chunk should NOT be present since we aborted
    expect(chunks.some((c) => c.type === "done")).toBe(false);
  });

  it("emits guardrail_triggered on input guardrail failure", async () => {
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({
      runner,
      guardrails: {
        input: [() => ({ passed: false, reason: "blocked" })],
      },
    });

    const { stream, result } = orchestrator.runStream(mockAgent(), "bad input");
    const chunks: Array<{ type: string }> = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks.some((c) => c.type === "guardrail_triggered")).toBe(true);
    await expect(result).rejects.toThrow(GuardrailError);
  });
});

// ============================================================================
// waitForIdle
// ============================================================================

describe("waitForIdle", () => {
  it("resolves immediately when idle", async () => {
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({ runner });

    // Should resolve without timeout
    await orchestrator.waitForIdle(100);
  });
});

// ============================================================================
// Destroy
// ============================================================================

describe("destroy", () => {
  it("destroys without error", async () => {
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({ runner });

    await orchestrator.run(mockAgent(), "Hello");

    expect(() => orchestrator.destroy()).not.toThrow();
  });
});

// ============================================================================
// Budget pre-flight
// ============================================================================
//
// Prior behavior: budget was a constraint that fired post-call. N
// concurrent runs each saw `tokenUsage = 0 < cap`, all proceeded, total
// spend was N * maxTokenBudget. The fix adds a pre-flight check that
// rejects when projected usage (current + in-flight reservations + this
// call's estimate) would exceed the cap.
describe("budget pre-flight", () => {
  it("default (no budgetEstimateTokens) — rejects when already over cap", async () => {
    // Heavy result to push usage past cap on first call.
    const heavy: RunResult = {
      output: "ok",
      messages: [],
      toolCalls: [],
      totalTokens: 80,
      tokenUsage: { inputTokens: 40, outputTokens: 40 },
    };
    const runner = createMockRunner([heavy]);
    const orchestrator = createAgentOrchestrator({
      runner,
      maxTokenBudget: 50, // tighter than the heavy call
    });
    // First call succeeds (pre-flight sees usage=0 < 50) but overshoots
    // (post-call tokenUsage=80 > 50).
    await orchestrator.run(mockAgent(), "first");
    // Second call's pre-flight sees usage=80 >= 50 and rejects.
    await expect(orchestrator.run(mockAgent(), "second")).rejects.toThrow(
      /budget would be exceeded/i,
    );
    orchestrator.destroy();
  });

  it("budgetEstimateTokens (number) — reserves per-call and blocks concurrent overshoot", async () => {
    // Per-call estimate of 30 tokens; cap 50.
    // First call reserves 30 (in-flight=30, projected=0+30+30=60 > 50?
    // No — current=0, in-flight=0, estimate=30 → 30 ≤ 50 OK).
    // Second concurrent call sees current=0, in-flight=30, estimate=30
    // → 60 > 50 → reject.
    let release: (() => void) | null = null;
    const blocker = new Promise<void>((r) => {
      release = r;
    });
    const runner: AgentRunner = vi.fn(async () => {
      await blocker;
      return successResult("ok");
    }) as unknown as AgentRunner;

    const orchestrator = createAgentOrchestrator({
      runner,
      maxTokenBudget: 50,
      budgetEstimateTokens: 30,
    });

    const first = orchestrator.run(mockAgent(), "a");
    // Concurrent: second one should reject pre-flight.
    await expect(orchestrator.run(mockAgent(), "b")).rejects.toThrow(
      /budget would be exceeded/i,
    );
    (release as (() => void) | null)?.();
    await first;
    orchestrator.destroy();
  });

  it("budgetEstimateTokens (callback) — per-call estimate from input length", async () => {
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({
      runner,
      maxTokenBudget: 100,
      // 1 token per 4 chars rough estimate
      budgetEstimateTokens: (input) => Math.ceil(input.length / 4),
    });
    // Short input (8 chars → 2 tokens estimate) succeeds.
    await orchestrator.run(mockAgent(), "Hi there");
    // Huge input (500 chars → 125 tokens > 100 cap) fails pre-flight.
    await expect(
      orchestrator.run(mockAgent(), "x".repeat(500)),
    ).rejects.toThrow(/budget would be exceeded/i);
    orchestrator.destroy();
  });

  it("reservation is released after the call completes", async () => {
    const runner = createMockRunner([successResult()]);
    const orchestrator = createAgentOrchestrator({
      runner,
      maxTokenBudget: 100,
      budgetEstimateTokens: 60,
    });
    // First call reserves 60 (in-flight=60). After return, reservation
    // released, so a second call (estimate 60) projects 10 (post-call
    // tokenUsage) + 0 (in-flight) + 60 = 70 ≤ 100 → should succeed.
    await orchestrator.run(mockAgent(), "a");
    await orchestrator.run(mockAgent(), "b");
    orchestrator.destroy();
  });

  it("no maxTokenBudget — pre-flight is a no-op", async () => {
    const runner = createMockRunner();
    const orchestrator = createAgentOrchestrator({
      runner,
      // intentionally no maxTokenBudget
    });
    // Any input length is fine.
    await orchestrator.run(mockAgent(), "x".repeat(10_000));
    orchestrator.destroy();
  });
});

// ============================================================================
// Retry-outside-circuit-breaker
// ============================================================================
//
// Prior: `circuitBreaker.execute(() => runWithRetry(...))` hid retries
// from the breaker; `attempts: 3, failureThreshold: 5` required 15 real
// failures before the breaker opened.
// New default: each retry attempt is wrapped in CB.execute individually.
// Each failure counts toward `failureThreshold`. Opt-in to legacy via
// `retryInsideCircuit: true`.
describe("retry-outside-circuit-breaker", () => {
  it("default — each retry attempt counts as a circuit-breaker failure", async () => {
    let cbAttempts = 0;
    const fakeCB = {
      // Counts every execute() call — that's what the new strategy
      // expects: each retry attempt goes through the breaker.
      execute: async <T>(fn: () => Promise<T>) => {
        cbAttempts++;
        return fn();
      },
    };
    // Runner always throws; retry config = 3 attempts.
    const runner = createMockRunner([
      new Error("fail 1"),
      new Error("fail 2"),
      new Error("fail 3"),
    ]);
    const orchestrator = createAgentOrchestrator({
      runner,
      circuitBreaker: fakeCB as unknown as Parameters<
        typeof createAgentOrchestrator
      >[0]["circuitBreaker"],
      agentRetry: { attempts: 3, backoff: "fixed" },
      // default: retryInsideCircuit: false
    });
    await expect(orchestrator.run(mockAgent(), "hi")).rejects.toThrow();
    expect(cbAttempts).toBe(3); // one per retry attempt — the fix
    orchestrator.destroy();
  });

  it("retryInsideCircuit: true — legacy behavior, one CB call wraps the entire retry loop", async () => {
    let cbAttempts = 0;
    const fakeCB = {
      execute: async <T>(fn: () => Promise<T>) => {
        cbAttempts++;
        return fn();
      },
    };
    const runner = createMockRunner([
      new Error("fail 1"),
      new Error("fail 2"),
      new Error("fail 3"),
    ]);
    const orchestrator = createAgentOrchestrator({
      runner,
      circuitBreaker: fakeCB as unknown as Parameters<
        typeof createAgentOrchestrator
      >[0]["circuitBreaker"],
      agentRetry: { attempts: 3, backoff: "fixed" },
      retryInsideCircuit: true,
    });
    await expect(orchestrator.run(mockAgent(), "hi")).rejects.toThrow();
    expect(cbAttempts).toBe(1); // legacy: retries hidden from CB
    orchestrator.destroy();
  });

  it("default — short-circuits remaining retries once the breaker opens", async () => {
    let cbAttempts = 0;
    let opened = false;
    const fakeCB = {
      execute: async <T>(fn: () => Promise<T>) => {
        if (opened) {
          throw new Error("Circuit breaker open");
        }
        cbAttempts++;
        // Open the breaker after the second failure.
        if (cbAttempts >= 2) opened = true;
        return fn();
      },
    };
    const runner = createMockRunner([
      new Error("fail 1"),
      new Error("fail 2"),
      new Error("fail 3"),
      new Error("fail 4"),
    ]);
    const orchestrator = createAgentOrchestrator({
      runner,
      circuitBreaker: fakeCB as unknown as Parameters<
        typeof createAgentOrchestrator
      >[0]["circuitBreaker"],
      agentRetry: { attempts: 4, backoff: "fixed" },
    });
    await expect(orchestrator.run(mockAgent(), "hi")).rejects.toThrow();
    // CB allowed 2 attempts before opening; the third+fourth retries
    // see the open breaker and short-circuit.
    expect(cbAttempts).toBe(2);
    orchestrator.destroy();
  });
});
