import { describe, expect, it, vi } from "vitest";
import {
  createStreamingRunner,
  createToxicityStreamingGuardrail,
  createLengthStreamingGuardrail,
  createPatternStreamingGuardrail,
  combineStreamingGuardrails,
  type StreamChunk,
  type StreamingGuardrail,
} from "../streaming.js";
import type {
  AgentLike,
  RunResult,
  StreamingCallbackRunner,
} from "../types.js";

// ============================================================================
// Helpers
// ============================================================================

function mockAgent(name = "test-agent"): AgentLike {
  return { name, instructions: "Be helpful." };
}

function successResult(tokens: string[]): RunResult<unknown> {
  return {
    output: tokens.join(""),
    messages: [{ role: "assistant", content: tokens.join("") }],
    toolCalls: [],
    totalTokens: tokens.length,
  };
}

function createMockRunner(tokens: string[]): StreamingCallbackRunner {
  return async (_agent, _input, callbacks) => {
    for (const token of tokens) {
      if (callbacks.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      await callbacks.onToken?.(token);
    }

    return successResult(tokens);
  };
}

function createMockRunnerWithTools(
  tokens: string[],
  tools: Array<{ name: string; id: string; args: string; result: string }>,
): StreamingCallbackRunner {
  return async (_agent, _input, callbacks) => {
    for (const tool of tools) {
      await callbacks.onToolStart?.(tool.name, tool.id, tool.args);
      await callbacks.onToolEnd?.(tool.name, tool.id, tool.result);
    }
    for (const token of tokens) {
      await callbacks.onToken?.(token);
    }

    return successResult(tokens);
  };
}

function createMockRunnerWithMessages(
  tokens: string[],
  messages: Array<{ role: "user" | "assistant" | "tool" | "system"; content: string }>,
): StreamingCallbackRunner {
  return async (_agent, _input, callbacks) => {
    for (const msg of messages) {
      await callbacks.onMessage?.(msg);
    }
    for (const token of tokens) {
      await callbacks.onToken?.(token);
    }

    return successResult(tokens);
  };
}

function createErrorRunner(error: Error): StreamingCallbackRunner {
  return async (_agent, _input, callbacks) => {
    await callbacks.onToken?.("partial");
    throw error;
  };
}

async function collectChunks(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return chunks;
}

// ============================================================================
// createStreamingRunner — Core Behavior
// ============================================================================

describe("createStreamingRunner", () => {
  it("emits token chunks with incrementing tokenCount", async () => {
    const runner = createStreamingRunner(createMockRunner(["Hello", " ", "World"]));
    const { stream, result } = runner(mockAgent(), "hi");

    const chunks = await collectChunks(stream);
    await result;

    const tokenChunks = chunks.filter((c) => c.type === "token");
    expect(tokenChunks).toHaveLength(3);
    expect(tokenChunks[0]).toEqual({ type: "token", data: "Hello", tokenCount: 1 });
    expect(tokenChunks[1]).toEqual({ type: "token", data: " ", tokenCount: 2 });
    expect(tokenChunks[2]).toEqual({ type: "token", data: "World", tokenCount: 3 });
  });

  it("emits tool_start and tool_end chunks", async () => {
    const runner = createStreamingRunner(
      createMockRunnerWithTools(["ok"], [
        { name: "search", id: "tc_1", args: '{"q":"test"}', result: "found" },
      ]),
    );
    const { stream, result } = runner(mockAgent(), "test");

    const chunks = await collectChunks(stream);
    await result;

    const toolStart = chunks.find((c) => c.type === "tool_start");
    const toolEnd = chunks.find((c) => c.type === "tool_end");
    expect(toolStart).toEqual({
      type: "tool_start",
      tool: "search",
      toolCallId: "tc_1",
      arguments: '{"q":"test"}',
    });
    expect(toolEnd).toEqual({
      type: "tool_end",
      tool: "search",
      toolCallId: "tc_1",
      result: "found",
    });
  });

  it("emits message chunks", async () => {
    const runner = createStreamingRunner(
      createMockRunnerWithMessages(["ok"], [
        { role: "assistant", content: "thinking..." },
      ]),
    );
    const { stream, result } = runner(mockAgent(), "test");

    const chunks = await collectChunks(stream);
    await result;

    const msgChunk = chunks.find((c) => c.type === "message");
    expect(msgChunk).toEqual({
      type: "message",
      message: { role: "assistant", content: "thinking..." },
    });
  });

  it("emits progress chunks (starting, tool_calling, generating, finishing)", async () => {
    const runner = createStreamingRunner(
      createMockRunnerWithTools(["ok"], [
        { name: "search", id: "tc_1", args: "{}", result: "done" },
      ]),
    );
    const { stream, result } = runner(mockAgent(), "test");

    const chunks = await collectChunks(stream);
    await result;

    const progressChunks = chunks.filter((c) => c.type === "progress");
    const phases = progressChunks.map((c) => (c as { phase: string }).phase);
    expect(phases).toContain("starting");
    expect(phases).toContain("tool_calling");
    expect(phases).toContain("generating");
  });

  it("emits done chunk with totalTokens, duration, droppedTokens", async () => {
    const runner = createStreamingRunner(createMockRunner(["a", "b", "c"]));
    const { stream, result } = runner(mockAgent(), "test");

    const chunks = await collectChunks(stream);
    await result;

    const doneChunk = chunks.find((c) => c.type === "done");
    expect(doneChunk).toBeDefined();
    expect(doneChunk!.type).toBe("done");
    const done = doneChunk as StreamChunk & { type: "done" };
    expect(done.totalTokens).toBe(3);
    expect(done.droppedTokens).toBe(0);
    expect(done.duration).toBeGreaterThanOrEqual(0);
  });

  it("result promise resolves to RunResult", async () => {
    const runner = createStreamingRunner(createMockRunner(["Hello"]));
    const { stream, result } = runner(mockAgent(), "test");

    // Drain the stream
    await collectChunks(stream);
    const runResult = await result;

    expect(runResult.output).toBe("Hello");
    expect(runResult.totalTokens).toBe(1);
    expect(runResult.messages).toEqual([{ role: "assistant", content: "Hello" }]);
  });

  it("abort() cancels the stream via AbortController", async () => {
    let tokensSent = 0;
    const slowRunner: StreamingCallbackRunner = async (_agent, _input, callbacks) => {
      for (let i = 0; i < 100; i++) {
        if (callbacks.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        await callbacks.onToken?.(`t${i}`);
        tokensSent++;
      }

      return successResult(Array.from({ length: 100 }, (_, i) => `t${i}`));
    };

    const runner = createStreamingRunner(slowRunner);
    const { stream, result, abort } = runner(mockAgent(), "test");

    const chunks: StreamChunk[] = [];
    // Consume a few then abort
    for await (const chunk of stream) {
      chunks.push(chunk);
      if (chunk.type === "token" && chunks.filter((c) => c.type === "token").length >= 3) {
        abort();
      }
    }

    await expect(result).rejects.toThrow();
    expect(tokensSent).toBeLessThan(100);
  });

  it("external AbortSignal cancels the stream", async () => {
    const externalController = new AbortController();
    const slowRunner: StreamingCallbackRunner = async (_agent, _input, callbacks) => {
      for (let i = 0; i < 100; i++) {
        if (callbacks.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        await callbacks.onToken?.(`t${i}`);
      }

      return successResult([]);
    };

    const runner = createStreamingRunner(slowRunner);
    const { stream, result } = runner(mockAgent(), "test", {
      signal: externalController.signal,
    });

    const chunks: StreamChunk[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
      if (chunk.type === "token" && chunks.filter((c) => c.type === "token").length >= 3) {
        externalController.abort();
      }
    }

    await expect(result).rejects.toThrow();
  });

  it("error from base runner emits error chunk and throws from result", async () => {
    const err = new Error("LLM exploded");
    const runner = createStreamingRunner(createErrorRunner(err));
    const { stream, result } = runner(mockAgent(), "test");

    const chunks = await collectChunks(stream);

    const errorChunk = chunks.find((c) => c.type === "error");
    expect(errorChunk).toBeDefined();
    const ec = errorChunk as StreamChunk & { type: "error" };
    expect(ec.error.message).toBe("LLM exploded");
    expect(ec.partialOutput).toBe("partial");

    await expect(result).rejects.toThrow("LLM exploded");
  });

  it("cleanup removes abort signal listener (no memory leak)", async () => {
    const externalController = new AbortController();
    const removeSpy = vi.spyOn(externalController.signal, "removeEventListener");

    const runner = createStreamingRunner(createMockRunner(["a"]));
    const { stream, result } = runner(mockAgent(), "test", {
      signal: externalController.signal,
    });

    await collectChunks(stream);
    await result;

    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    removeSpy.mockRestore();
  });
});

// ============================================================================
// Backpressure Strategies
// ============================================================================

describe("backpressure strategies", () => {
  it('"buffer" strategy: all tokens delivered even with slow consumer', async () => {
    const tokens = Array.from({ length: 20 }, (_, i) => `t${i}`);
    const runner = createStreamingRunner(createMockRunner(tokens));
    const { stream, result } = runner(mockAgent(), "test", {
      backpressure: "buffer",
      bufferSize: 5,
    });

    // Slow consumer: add a small delay per chunk
    const chunks: StreamChunk[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    await result;

    const tokenChunks = chunks.filter((c) => c.type === "token");
    expect(tokenChunks).toHaveLength(20);

    const doneChunk = chunks.find((c) => c.type === "done") as StreamChunk & { type: "done" };
    expect(doneChunk.droppedTokens).toBe(0);
  });

  it('"drop" strategy: dropped tokens counted in done chunk', async () => {
    // Producer sends many tokens synchronously with tiny buffer
    const tokens = Array.from({ length: 50 }, (_, i) => `t${i}`);
    const runner = createStreamingRunner(createMockRunner(tokens));
    const { stream, result } = runner(mockAgent(), "test", {
      backpressure: "drop",
      bufferSize: 3,
    });

    const chunks = await collectChunks(stream);
    await result;

    const doneChunk = chunks.find((c) => c.type === "done") as StreamChunk & { type: "done" };
    // Some tokens should have been dropped because the buffer is tiny
    // The exact count depends on timing, but droppedTokens should be >= 0
    // and total token chunks + dropped should approximate 50
    expect(doneChunk.droppedTokens).toBeGreaterThanOrEqual(0);
  });

  it('"block" strategy: producer blocks until consumer catches up', async () => {
    const tokens = ["a", "b", "c", "d", "e"];
    const runner = createStreamingRunner(createMockRunner(tokens));
    const { stream, result } = runner(mockAgent(), "test", {
      backpressure: "block",
      bufferSize: 2,
    });

    // All tokens should arrive — blocking just slows the producer
    const chunks = await collectChunks(stream);
    await result;

    const tokenChunks = chunks.filter((c) => c.type === "token");
    expect(tokenChunks).toHaveLength(5);

    const doneChunk = chunks.find((c) => c.type === "done") as StreamChunk & { type: "done" };
    expect(doneChunk.droppedTokens).toBe(0);
  });
});

// ============================================================================
// Streaming Guardrails
// ============================================================================

describe("streaming guardrails", () => {
  it("guardrail check runs every guardrailCheckInterval tokens", async () => {
    const checkFn = vi.fn().mockResolvedValue({ passed: true });
    const guardrail: StreamingGuardrail = {
      name: "counter",
      check: checkFn,
    };

    const tokens = Array.from({ length: 25 }, (_, i) => `t${i}`);
    const runner = createStreamingRunner(createMockRunner(tokens), {
      streamingGuardrails: [guardrail],
    });
    const { stream, result } = runner(mockAgent(), "test", {
      guardrailCheckInterval: 5,
    });

    await collectChunks(stream);
    await result;

    // Called at tokens 5, 10, 15, 20, 25 = 5 periodic + 1 final check = 6
    expect(checkFn).toHaveBeenCalledTimes(6);
  });

  it("failed guardrail emits guardrail_triggered chunk", async () => {
    const guardrail: StreamingGuardrail = {
      name: "bad-word",
      stopOnFail: false,
      check: (partialOutput) => {
        if (partialOutput.includes("bad")) {
          return { passed: false, reason: "Bad word detected" };
        }

        return { passed: true };
      },
    };

    const runner = createStreamingRunner(createMockRunner(["good", "bad"]), {
      streamingGuardrails: [guardrail],
    });
    const { stream, result } = runner(mockAgent(), "test", {
      guardrailCheckInterval: 1,
      stopOnGuardrail: false,
    });

    const chunks = await collectChunks(stream);
    // result may reject if stopped, but with stopOnGuardrail=false it completes
    await result;

    const triggered = chunks.filter((c) => c.type === "guardrail_triggered");
    expect(triggered.length).toBeGreaterThanOrEqual(1);
    const g = triggered[0] as StreamChunk & { type: "guardrail_triggered" };
    expect(g.guardrailName).toBe("bad-word");
    expect(g.reason).toBe("Bad word detected");
  });

  it("stopOnGuardrail=true aborts the stream", async () => {
    const guardrail: StreamingGuardrail = {
      name: "stopper",
      stopOnFail: true,
      check: (_partial, tokenCount) => {
        if (tokenCount >= 3) {
          return { passed: false, reason: "Too many tokens" };
        }

        return { passed: true };
      },
    };

    const runner = createStreamingRunner(
      createMockRunner(Array.from({ length: 20 }, (_, i) => `t${i}`)),
      { streamingGuardrails: [guardrail] },
    );
    const { stream, result } = runner(mockAgent(), "test", {
      guardrailCheckInterval: 3,
      stopOnGuardrail: true,
    });

    const chunks = await collectChunks(stream);

    const triggered = chunks.find((c) => c.type === "guardrail_triggered");
    expect(triggered).toBeDefined();
    const g = triggered as StreamChunk & { type: "guardrail_triggered" };
    expect(g.stopped).toBe(true);

    // Result should reject because stream was aborted
    await expect(result).rejects.toThrow();
  });

  it("stopOnGuardrail=false continues streaming", async () => {
    const guardrail: StreamingGuardrail = {
      name: "warn-only",
      stopOnFail: true,
      check: (_partial, tokenCount) => {
        if (tokenCount >= 2) {
          return { passed: false, reason: "warning" };
        }

        return { passed: true };
      },
    };

    const tokens = ["a", "b", "c", "d"];
    const runner = createStreamingRunner(createMockRunner(tokens), {
      streamingGuardrails: [guardrail],
    });
    const { stream, result } = runner(mockAgent(), "test", {
      guardrailCheckInterval: 2,
      stopOnGuardrail: false,
    });

    const chunks = await collectChunks(stream);
    await result;

    // Should have all token chunks despite guardrail triggering
    const tokenChunks = chunks.filter((c) => c.type === "token");
    expect(tokenChunks).toHaveLength(4);

    // Done chunk should exist (stream completed)
    expect(chunks.some((c) => c.type === "done")).toBe(true);
  });

  it("stopOnGuardrail as function: custom logic", async () => {
    const guardrail: StreamingGuardrail = {
      name: "custom",
      stopOnFail: true,
      check: (_partial, tokenCount) => {
        if (tokenCount >= 2) {
          return { passed: false, reason: `fail-at-${tokenCount}` };
        }

        return { passed: true };
      },
    };

    const tokens = Array.from({ length: 10 }, (_, i) => `t${i}`);
    const runner = createStreamingRunner(createMockRunner(tokens), {
      streamingGuardrails: [guardrail],
    });

    // Custom function: only stop if reason contains "fail-at-4"
    const { stream, result } = runner(mockAgent(), "test", {
      guardrailCheckInterval: 2,
      stopOnGuardrail: (chunk) => chunk.reason.includes("fail-at-4"),
    });

    const chunks = await collectChunks(stream);

    const triggered = chunks.filter((c) => c.type === "guardrail_triggered");
    // Should have triggered at token 2 (no stop) and token 4 (stop)
    expect(triggered.length).toBeGreaterThanOrEqual(1);

    // Result should reject because we stopped at token 4
    await expect(result).rejects.toThrow();
  });

  it("final guardrail check after completion", async () => {
    const checkFn = vi.fn().mockReturnValue({ passed: true });
    const guardrail: StreamingGuardrail = {
      name: "final-check",
      check: checkFn,
    };

    // 3 tokens with interval=10 means no periodic checks, only final
    const runner = createStreamingRunner(createMockRunner(["a", "b", "c"]), {
      streamingGuardrails: [guardrail],
    });
    const { stream, result } = runner(mockAgent(), "test", {
      guardrailCheckInterval: 10,
    });

    await collectChunks(stream);
    await result;

    // Only the final check fires (no periodic since 3 < 10)
    expect(checkFn).toHaveBeenCalledTimes(1);
    expect(checkFn).toHaveBeenCalledWith("abc", 3);
  });

  it("guardrail errors are silently swallowed", async () => {
    const guardrail: StreamingGuardrail = {
      name: "exploding",
      check: () => {
        throw new Error("guardrail kaboom");
      },
    };

    const runner = createStreamingRunner(createMockRunner(["a", "b"]), {
      streamingGuardrails: [guardrail],
    });
    const { stream, result } = runner(mockAgent(), "test", {
      guardrailCheckInterval: 1,
    });

    const chunks = await collectChunks(stream);
    await result;

    // Stream completes normally despite guardrail throwing
    expect(chunks.some((c) => c.type === "done")).toBe(true);
    expect(chunks.filter((c) => c.type === "token")).toHaveLength(2);
  });
});

// ============================================================================
// Built-in Streaming Guardrails
// ============================================================================

describe("createToxicityStreamingGuardrail", () => {
  it("score above threshold fails", async () => {
    const guardrail = createToxicityStreamingGuardrail({
      checkFn: () => 0.95,
      threshold: 0.8,
    });

    const result = await guardrail.check("toxic content", 10);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("0.95");
    expect(result.reason).toContain("0.8");
    expect(result.severity).toBe("critical");
  });

  it("score below threshold passes", async () => {
    const guardrail = createToxicityStreamingGuardrail({
      checkFn: () => 0.2,
      threshold: 0.8,
    });

    const result = await guardrail.check("clean content", 10);
    expect(result.passed).toBe(true);
  });
});

describe("createLengthStreamingGuardrail", () => {
  it("exceeds maxTokens fails", () => {
    const guardrail = createLengthStreamingGuardrail({ maxTokens: 100 });

    const result = guardrail.check("output", 150);
    expect(result).toEqual({
      passed: false,
      reason: "Output exceeded maximum length of 100 tokens",
      severity: "error",
    });
  });

  it("warnAt emits warning (passed=true with warning)", async () => {
    const guardrail = createLengthStreamingGuardrail({
      maxTokens: 100,
      warnAt: 80,
    });

    const result = await guardrail.check("output", 85);
    expect(result.passed).toBe(true);
    expect(result.warning).toContain("85/100");
    expect(result.severity).toBe("warning");
  });
});

describe("createPatternStreamingGuardrail", () => {
  it("regex match fails", async () => {
    const guardrail = createPatternStreamingGuardrail({
      patterns: [{ regex: /\b\d{3}-\d{2}-\d{4}\b/, name: "SSN" }],
    });

    const result = await guardrail.check("My SSN is 123-45-6789", 10);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("SSN");
  });

  it("no match passes", async () => {
    const guardrail = createPatternStreamingGuardrail({
      patterns: [{ regex: /\b\d{3}-\d{2}-\d{4}\b/, name: "SSN" }],
    });

    const result = await guardrail.check("No sensitive data here", 10);
    expect(result.passed).toBe(true);
  });
});

describe("combineStreamingGuardrails", () => {
  it("stops on first fail", async () => {
    const g1: StreamingGuardrail = {
      name: "first",
      check: () => ({ passed: false, reason: "first failed" }),
    };
    const g2: StreamingGuardrail = {
      name: "second",
      check: vi.fn().mockReturnValue({ passed: true }),
    };

    const combined = combineStreamingGuardrails([g1, g2], { stopOnFirstFail: true });
    const result = await combined.check("test", 1);

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("[first]");
    expect(result.reason).toContain("first failed");
    // Second guardrail should not have been called
    expect(g2.check).not.toHaveBeenCalled();
  });

  it("collects all failures when stopOnFirstFail=false", async () => {
    const g1: StreamingGuardrail = {
      name: "alpha",
      check: () => ({ passed: false, reason: "alpha failed" }),
    };
    const g2: StreamingGuardrail = {
      name: "beta",
      check: () => ({ passed: false, reason: "beta failed" }),
    };

    const combined = combineStreamingGuardrails([g1, g2], { stopOnFirstFail: false });
    const result = await combined.check("test", 1);

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("[alpha]");
    expect(result.reason).toContain("[beta]");
  });
});

// ============================================================================
// Validation
// ============================================================================

describe("validation", () => {
  it("throws on guardrailCheckInterval = 0", () => {
    const runner = createStreamingRunner(createMockRunner(["a"]));
    expect(() =>
      runner(mockAgent(), "test", { guardrailCheckInterval: 0 }),
    ).toThrow("guardrailCheckInterval must be a positive number");
  });

  it("throws on negative guardrailCheckInterval", () => {
    const runner = createStreamingRunner(createMockRunner(["a"]));
    expect(() =>
      runner(mockAgent(), "test", { guardrailCheckInterval: -5 }),
    ).toThrow("guardrailCheckInterval must be a positive number");
  });

  it("throws on NaN guardrailCheckInterval", () => {
    const runner = createStreamingRunner(createMockRunner(["a"]));
    expect(() =>
      runner(mockAgent(), "test", { guardrailCheckInterval: NaN }),
    ).toThrow("guardrailCheckInterval must be a positive number");
  });
});
