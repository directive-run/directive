/**
 * Orchestrator token streaming – `onToken` on `runStream` and `run`.
 *
 * Streaming is an option travelling the path the orchestrator already uses,
 * not a substituted runner: retry, guardrails, tool-call approval, budgets and
 * the facts bridge all still apply while deltas flow. These tests hold that
 * line, and hold the two orchestrators to the same behavior.
 */

import { createModule, createSystem, t } from "@directive-run/core";
import { describe, expect, it, vi } from "vitest";
import { createAgentOrchestrator } from "../agent-orchestrator.js";
import type { OrchestratorStreamChunk } from "../agent-orchestrator.js";
import { BudgetExceededError, withBudget } from "../budget.js";
import type { DebugTimeline } from "../debug-timeline.js";
import { withFallback } from "../fallback.js";
import { createMultiAgentOrchestrator } from "../multi-agent-orchestrator.js";
import { withRetry } from "../retry.js";
import { admitChunk, sliceTailByCodePoint } from "../streaming.js";
import { GuardrailError } from "../types.js";
import type { AgentLike, AgentRunner, RunResult } from "../types.js";

// ============================================================================
// Helpers
// ============================================================================

function mockAgent(name = "test-agent"): AgentLike {
  return { name, instructions: "Be helpful." };
}

function resultFor(output: string): RunResult {
  return {
    output,
    messages: [{ role: "assistant", content: output }],
    toolCalls: [],
    totalTokens: 10,
    tokenUsage: { inputTokens: 5, outputTokens: 5 },
  };
}

/**
 * A runner that honors `options.onToken` the way the shipped adapters do:
 * awaits every delta, then reports the whole assistant message through
 * `onMessage`. Without `onToken` it behaves as a plain buffered runner.
 */
function deltaRunner(deltas: string[]): AgentRunner {
  return (async (_agent: AgentLike, _input: string, options?: any) => {
    const full = deltas.join("");
    if (options?.onToken) {
      for (const delta of deltas) {
        await options.onToken(delta);
      }
    }
    const message = { role: "assistant" as const, content: full };
    await options?.onMessage?.(message);

    return resultFor(full);
  }) as unknown as AgentRunner;
}

/** A runner that ignores `onToken` entirely – no streaming support. */
function bufferedRunner(output: string): AgentRunner {
  return (async (_agent: AgentLike, _input: string, options?: any) => {
    const message = { role: "assistant" as const, content: output };
    await options?.onMessage?.(message);

    return resultFor(output);
  }) as unknown as AgentRunner;
}

async function collect(
  stream: AsyncIterable<OrchestratorStreamChunk>,
): Promise<OrchestratorStreamChunk[]> {
  const out: OrchestratorStreamChunk[] = [];
  for await (const chunk of stream) {
    out.push(chunk);
  }

  return out;
}

function tokenChunks(chunks: OrchestratorStreamChunk[]) {
  return chunks.filter(
    (c): c is Extract<OrchestratorStreamChunk, { type: "token" }> =>
      c.type === "token",
  );
}

function tokenData(chunks: OrchestratorStreamChunk[]): string[] {
  return tokenChunks(chunks).map((c) => c.data);
}

/** Multi-agent orchestrator with one agent named `assistant`. */
function multiAgent(runner: AgentRunner, extra: Record<string, unknown> = {}) {
  return createMultiAgentOrchestrator({
    runner,
    agents: { assistant: { agent: mockAgent("assistant") } },
    ...extra,
  } as never);
}

// ============================================================================
// Per-delta streaming through runStream
// ============================================================================

describe("runStream – onToken", () => {
  it("leaves the stream unchanged when onToken is absent", async () => {
    const orchestrator = createAgentOrchestrator({
      runner: deltaRunner(["Hel", "lo ", "world"]),
    });

    const { stream, result } = orchestrator.runStream(mockAgent(), "hi");
    const chunks = await collect(stream);
    await result;

    // One synthesized chunk carrying the whole assistant message, exactly as
    // before this option existed.
    expect(tokenData(chunks)).toEqual(["Hello world"]);
  });

  it("delivers one token chunk per provider delta when onToken is passed", async () => {
    const orchestrator = createAgentOrchestrator({
      runner: deltaRunner(["Hel", "lo ", "world"]),
    });

    const { stream, result } = orchestrator.runStream(mockAgent(), "hi", {
      onToken: () => {},
    });
    const chunks = await collect(stream);
    await result;

    expect(tokenData(chunks)).toEqual(["Hel", "lo ", "world"]);
  });

  it("does not deliver the response twice when real deltas are flowing", async () => {
    const orchestrator = createAgentOrchestrator({
      runner: deltaRunner(["a", "b", "c"]),
    });

    const { stream, result } = orchestrator.runStream(mockAgent(), "hi", {
      onToken: () => {},
    });
    const chunks = await collect(stream);
    await result;

    // The whole-message chunk is suppressed; the deltas are the only copy.
    expect(tokenData(chunks).join("")).toBe("abc");
    expect(tokenChunks(chunks)).toHaveLength(3);
    // The `message` chunk still lands – only the synthesized token is gone.
    expect(chunks.some((c) => c.type === "message")).toBe(true);
  });

  it("forwards each delta to the caller's callback", async () => {
    const seen: string[] = [];
    const orchestrator = createAgentOrchestrator({
      runner: deltaRunner(["x", "y"]),
    });

    const { stream, result } = orchestrator.runStream(mockAgent(), "hi", {
      onToken: (token) => {
        seen.push(token);
      },
    });
    await collect(stream);
    await result;

    expect(seen).toEqual(["x", "y"]);
  });

  it("awaits the caller's callback, so a slow consumer slows the provider", async () => {
    const order: string[] = [];
    const runner = (async (_a: AgentLike, _i: string, options?: any) => {
      for (const delta of ["1", "2"]) {
        await options.onToken(delta);
        order.push(`produced ${delta}`);
      }
      await options?.onMessage?.({ role: "assistant", content: "12" });

      return resultFor("12");
    }) as unknown as AgentRunner;
    const orchestrator = createAgentOrchestrator({ runner });

    const { stream, result } = orchestrator.runStream(mockAgent(), "hi", {
      onToken: async (token) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(`consumed ${token}`);
      },
    });
    await collect(stream);
    await result;

    expect(order).toEqual([
      "consumed 1",
      "produced 1",
      "consumed 2",
      "produced 2",
    ]);
  });

  // The runner-ignored-onToken warning fires once per process, so the two
  // tests that observe it run before anything else consumes it.
  it("stays silent when onToken was never requested", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const orchestrator = createAgentOrchestrator({
        runner: bufferedRunner("buffered answer"),
      });
      const { stream, result } = orchestrator.runStream(mockAgent(), "hi");
      await collect(stream);
      await result;

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("names the likely cause once when the runner ignores onToken", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const orchestrator = createAgentOrchestrator({
        runner: bufferedRunner("buffered answer"),
      });

      const first = orchestrator.runStream(mockAgent(), "hi", {
        onToken: () => {},
      });
      await collect(first.stream);
      await first.result;

      const messages = warn.mock.calls.map((call) => String(call[0]));
      expect(messages.some((m) => m.includes("emitted no deltas"))).toBe(true);
      expect(messages.some((m) => m.includes("createRunner"))).toBe(true);
      const countAfterFirst = warn.mock.calls.length;

      const second = orchestrator.runStream(mockAgent(), "hi", {
        onToken: () => {},
      });
      await collect(second.stream);
      await second.result;

      expect(warn.mock.calls.length).toBe(countAfterFirst);
    } finally {
      warn.mockRestore();
    }
  });

  it("still emits the whole-message chunk when the runner ignores onToken", async () => {
    const orchestrator = createAgentOrchestrator({
      runner: bufferedRunner("buffered answer"),
    });

    const { stream, result } = orchestrator.runStream(mockAgent(), "hi", {
      onToken: () => {},
    });
    const chunks = await collect(stream);
    await result;

    expect(tokenData(chunks)).toEqual(["buffered answer"]);
  });
});

// ============================================================================
// deltas: true – asking for chunks without a callback
// ============================================================================

describe("stream call options – deltas", () => {
  const deltas = ["Hel", "lo ", "world"];

  it("runStream delivers per-delta chunks with deltas: true and no callback", async () => {
    const orchestrator = createAgentOrchestrator({
      runner: deltaRunner(deltas),
    });

    const { stream, result } = orchestrator.runStream(mockAgent(), "hi", {
      deltas: true,
    });
    const chunks = await collect(stream);
    await result;

    expect(tokenData(chunks)).toEqual(deltas);
  });

  it("runAgentStream delivers per-delta chunks with deltas: true and no callback", async () => {
    const orchestrator = multiAgent(deltaRunner(deltas));

    const { stream, result } = orchestrator.runAgentStream("assistant", "hi", {
      deltas: true,
    });
    const chunks = await collect(stream);
    await result;

    expect(tokenData(chunks)).toEqual(deltas);
  });

  it("produces the same chunks as the no-op onToken form it replaces", async () => {
    const orchestrator = createAgentOrchestrator({
      runner: deltaRunner(deltas),
    });

    const viaDeltas = tokenChunks(
      await collect(
        orchestrator.runStream(mockAgent(), "hi", { deltas: true }).stream,
      ),
    );
    const viaCallback = tokenChunks(
      await collect(
        orchestrator.runStream(mockAgent(), "hi", { onToken: () => {} }).stream,
      ),
    );

    expect(viaDeltas.map((c) => [c.data, c.deltaCount, c.tokenCount])).toEqual(
      viaCallback.map((c) => [c.data, c.deltaCount, c.tokenCount]),
    );
  });

  it("deltas: false is the default whole-message behavior", async () => {
    const orchestrator = createAgentOrchestrator({
      runner: deltaRunner(deltas),
    });

    const { stream, result } = orchestrator.runStream(mockAgent(), "hi", {
      deltas: false,
    });
    const chunks = await collect(stream);
    await result;

    expect(tokenData(chunks)).toEqual(["Hello world"]);
  });

  it("deltas: true still marks a retry with stream_restart", async () => {
    const orchestrator = createAgentOrchestrator({
      runner: failOnceRunner(["bad"], ["good"]),
      agentRetry: { attempts: 2, baseDelayMs: 0 },
    });

    const { stream, result } = orchestrator.runStream(mockAgent(), "hi", {
      deltas: true,
    });
    const chunks = await collect(stream);
    await result;

    expect(chunks.filter((c) => c.type === "stream_restart")).toEqual([
      { type: "stream_restart", reason: "retry", generation: 2 },
    ]);
  });
});

// ============================================================================
// run() – onToken on RunCallOptions
// ============================================================================

describe("run – onToken", () => {
  it("streams deltas while still resolving to one complete result", async () => {
    const seen: string[] = [];
    const orchestrator = createAgentOrchestrator({
      runner: deltaRunner(["Hel", "lo"]),
    });

    const result = await orchestrator.run(mockAgent(), "hi", {
      onToken: (token) => {
        seen.push(token);
      },
    });

    expect(seen).toEqual(["Hel", "lo"]);
    expect(result.output).toBe("Hello");
  });

  it("survives withRetry and withBudget composition", async () => {
    const seen: string[] = [];
    const base = deltaRunner(["a", "b"]);
    const orchestrator = createAgentOrchestrator({
      runner: withBudget(withRetry(base, { maxRetries: 2 }), {
        maxCostPerCall: 1,
        pricing: { inputPerMillion: 3, outputPerMillion: 15 },
      }),
    });

    await orchestrator.run(mockAgent(), "hi", {
      onToken: (token) => {
        seen.push(token);
      },
    });

    expect(seen).toEqual(["a", "b"]);
  });

  it("streams deltas through the multi-agent runAgent too", async () => {
    const seen: string[] = [];
    const orchestrator = multiAgent(deltaRunner(["Hel", "lo"]));

    const result = await orchestrator.runAgent("assistant", "hi", {
      onToken: (token) => {
        seen.push(token);
      },
    });

    expect(seen).toEqual(["Hel", "lo"]);
    expect(result.output).toBe("Hello");
  });

  it("does not request streaming when onToken is absent", async () => {
    const runner = vi.fn(async (_agent: AgentLike, _input: string, o?: any) => {
      expect(o?.onToken).toBeUndefined();

      return resultFor("plain");
    }) as unknown as AgentRunner;
    const orchestrator = createAgentOrchestrator({ runner });

    const result = await orchestrator.run(mockAgent(), "hi");

    expect(result.output).toBe("plain");
  });
});

// ============================================================================
// Generation boundaries
// ============================================================================

/** Fails the first attempt after emitting `failedDeltas`, then succeeds. */
function failOnceRunner(failedDeltas: string[], goodDeltas: string[]) {
  let attempt = 0;

  return (async (_agent: AgentLike, _input: string, options?: any) => {
    attempt++;
    const deltas = attempt === 1 ? failedDeltas : goodDeltas;
    if (options?.onToken) {
      for (const delta of deltas) {
        await options.onToken(delta);
      }
    }
    if (attempt === 1) {
      throw new Error("transient provider failure");
    }
    const full = goodDeltas.join("");
    await options?.onMessage?.({ role: "assistant", content: full });

    return resultFor(full);
  }) as unknown as AgentRunner;
}

describe("runStream – generation boundaries", () => {
  it("marks a retry with stream_restart and restarts deltaCount", async () => {
    const orchestrator = createAgentOrchestrator({
      runner: failOnceRunner(["bad", "start"], ["good", " ", "answer"]),
      agentRetry: { attempts: 2, baseDelayMs: 0 },
    });

    const { stream, result } = orchestrator.runStream(mockAgent(), "hi", {
      onToken: () => {},
    });
    const chunks = await collect(stream);
    const final = await result;

    const restarts = chunks.filter((c) => c.type === "stream_restart");
    expect(restarts).toHaveLength(1);
    expect(restarts[0]).toEqual({
      type: "stream_restart",
      reason: "retry",
      generation: 2,
    });

    const restartIndex = chunks.indexOf(restarts[0]!);
    const before = tokenData(chunks.slice(0, restartIndex));
    const after = tokenChunks(chunks.slice(restartIndex));
    expect(before).toEqual(["bad", "start"]);
    expect(after.map((c) => c.data)).toEqual(["good", " ", "answer"]);
    // The counter restarts, so the consumer's view matches the live response.
    expect(after.map((c) => c.deltaCount)).toEqual([1, 2, 3]);
    // The accumulated result is the successful attempt alone.
    expect(after.map((c) => c.data).join("")).toBe("good answer");
    expect(final.output).toBe("good answer");
  });

  it("emits no stream_restart when onToken was not requested", async () => {
    const orchestrator = createAgentOrchestrator({
      runner: failOnceRunner(["bad"], ["good"]),
      agentRetry: { attempts: 2, baseDelayMs: 0 },
    });

    const { stream, result } = orchestrator.runStream(mockAgent(), "hi");
    const chunks = await collect(stream);
    await result;

    expect(chunks.some((c) => c.type === "stream_restart")).toBe(false);
    expect(tokenData(chunks)).toEqual(["good"]);
  });

  it("marks a self-healing reroute in the multi-agent orchestrator", async () => {
    let call = 0;
    const runner = (async (agent: AgentLike, _input: string, options?: any) => {
      call++;
      if (agent.name === "primary") {
        await options?.onToken?.("from-primary");

        throw new Error("primary is down");
      }
      await options?.onToken?.("from-backup");
      await options?.onMessage?.({ role: "assistant", content: "from-backup" });

      return resultFor("from-backup");
    }) as unknown as AgentRunner;

    const orchestrator = createMultiAgentOrchestrator({
      runner,
      agents: {
        primary: { agent: mockAgent("primary"), capabilities: ["answer"] },
        backup: { agent: mockAgent("backup"), capabilities: ["answer"] },
      },
      selfHealing: { useCapabilities: true },
    } as never);

    const { stream, result } = orchestrator.runAgentStream("primary", "hi", {
      onToken: () => {},
    });
    const chunks = await collect(stream);
    await result;

    expect(call).toBe(2);
    const restarts = chunks.filter((c) => c.type === "stream_restart");
    expect(restarts).toHaveLength(1);
    expect(restarts[0]).toMatchObject({ reason: "reroute", generation: 2 });
  });

  it("marks a structured-output schema retry in the multi-agent orchestrator", async () => {
    let call = 0;
    const runner = (async (
      _agent: AgentLike,
      _input: string,
      options?: any,
    ) => {
      call++;
      const text = call === 1 ? "not json at all" : '{"ok":true}';
      await options?.onToken?.(text);
      await options?.onMessage?.({ role: "assistant", content: text });

      return resultFor(text);
    }) as unknown as AgentRunner;

    const orchestrator = createMultiAgentOrchestrator({
      runner,
      agents: {
        assistant: {
          agent: mockAgent("assistant"),
          outputSchema: {
            safeParse: (value: unknown) =>
              value && typeof value === "object" && "ok" in (value as object)
                ? { success: true, data: value }
                : { success: false, error: { message: "missing ok" } },
          },
          maxSchemaRetries: 1,
        },
      },
    } as never);

    const { stream, result } = orchestrator.runAgentStream("assistant", "hi", {
      onToken: () => {},
    });
    const chunks = await collect(stream);
    await result;

    expect(call).toBe(2);
    const restarts = chunks.filter((c) => c.type === "stream_restart");
    expect(restarts).toHaveLength(1);
    expect(restarts[0]).toMatchObject({
      reason: "schema-retry",
      generation: 2,
    });
  });
});

// ============================================================================
// Buffer overflow
// ============================================================================

describe("runStream – buffer overflow", () => {
  /**
   * Fill past the 10,000-chunk buffer without draining the stream, then read.
   * The chunk pump only buffers while nothing is waiting on it, so the whole
   * run has to finish before the first `next()`.
   */
  async function overflow(deltaCount: number) {
    const deltas = Array.from({ length: deltaCount }, (_, i) => `d${i}`);
    const orchestrator = createAgentOrchestrator({
      runner: deltaRunner(deltas),
    });
    const { stream, result } = orchestrator.runStream(mockAgent(), "hi", {
      onToken: () => {},
    });
    await result;

    return collect(stream);
  }

  it("drops the newest chunk so the beginning of the message survives", async () => {
    const chunks = await overflow(11_000);
    const tokens = tokenData(chunks);

    // The prefix is intact – the old drop-oldest eviction kept the tail and
    // deleted the opening of the response.
    expect(tokens[0]).toBe("d0");
    expect(tokens[1]).toBe("d1");
    expect(tokens.length).toBeLessThan(11_000);
  });

  it("reports the real dropped count on the done chunk", async () => {
    const chunks = await overflow(11_000);
    const done = chunks.find((c) => c.type === "done");

    expect(done).toBeDefined();
    if (done?.type === "done") {
      expect(done.droppedTokens).toBeGreaterThan(0);
    }
  });

  it("drops the newest and reports it in the multi-agent orchestrator too", async () => {
    const deltas = Array.from({ length: 11_000 }, (_, i) => `d${i}`);
    const orchestrator = multiAgent(deltaRunner(deltas));
    const { stream, result } = orchestrator.runAgentStream("assistant", "hi", {
      onToken: () => {},
    });
    await result;
    const chunks = await collect(stream);

    const tokens = tokenData(chunks);
    expect(tokens[0]).toBe("d0");
    expect(tokens.length).toBeLessThan(11_000);

    const done = chunks.find((c) => c.type === "done");
    if (done?.type === "done") {
      expect(done.droppedTokens).toBeGreaterThan(0);
    }
  });

  it("reports zero drops for a stream that fits", async () => {
    const orchestrator = createAgentOrchestrator({
      runner: deltaRunner(["a", "b"]),
    });
    const { stream, result } = orchestrator.runStream(mockAgent(), "hi", {
      onToken: () => {},
    });
    const chunks = await collect(stream);
    await result;

    const done = chunks.find((c) => c.type === "done");
    if (done?.type === "done") {
      expect(done.droppedTokens).toBe(0);
    }
  });
});

// ============================================================================
// Chunk units
// ============================================================================

describe("token chunk units", () => {
  it("deltaCount counts token chunks and matches tokenCount while streaming", async () => {
    const orchestrator = createAgentOrchestrator({
      runner: deltaRunner(["a", "b", "c"]),
    });
    const { stream, result } = orchestrator.runStream(mockAgent(), "hi", {
      onToken: () => {},
    });
    const chunks = await collect(stream);
    await result;

    const tokens = tokenChunks(chunks);
    expect(tokens.map((c) => c.deltaCount)).toEqual([1, 2, 3]);
    expect(tokens.map((c) => c.tokenCount)).toEqual([1, 2, 3]);
  });

  it("keeps the historical tokenCount estimate on the whole-message path", async () => {
    const orchestrator = createAgentOrchestrator({
      runner: bufferedRunner("12345678"),
    });
    const { stream, result } = orchestrator.runStream(mockAgent(), "hi");
    const chunks = await collect(stream);
    await result;

    const tokens = tokenChunks(chunks);
    expect(tokens).toHaveLength(1);
    // ceil(8 / 4) – unchanged from before this option existed.
    expect(tokens[0]!.tokenCount).toBe(2);
    expect(tokens[0]!.deltaCount).toBe(1);
  });
});

// ============================================================================
// Accumulated output truncation
// ============================================================================

describe("sliceTailByCodePoint", () => {
  it("returns the input untouched when it already fits", () => {
    expect(sliceTailByCodePoint("hello", 10)).toBe("hello");
    expect(sliceTailByCodePoint("hello", 5)).toBe("hello");
  });

  it("slices on a code-unit boundary when no pair straddles the cut", () => {
    expect(sliceTailByCodePoint("abcdef", 3)).toBe("def");
  });

  it("moves the cut forward rather than bisecting a surrogate pair", () => {
    // "a" + two astral characters: cutting at 3 code units would land on the
    // low surrogate of the first pair.
    const text = `a${"😀".repeat(2)}`;
    const sliced = sliceTailByCodePoint(text, 3);

    expect(sliced).toBe("😀");
    expect(() => encodeURIComponent(sliced)).not.toThrow();
  });

  it("leaves no lone surrogate at the front of the result", () => {
    const text = `a${"😀".repeat(50)}`;
    for (let max = 1; max <= text.length; max++) {
      const sliced = sliceTailByCodePoint(text, max);
      const first = sliced.charCodeAt(0);
      expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
    }
  });
});

describe("runStream – partial output truncation", () => {
  it("keeps the partial output serializable when the tail is truncated", async () => {
    // 100,001 code units before truncation, with the 100,000-unit cut landing
    // inside a surrogate pair.
    const deltas = ["a", "😀".repeat(50_001)];
    const runner = (async (_a: AgentLike, _i: string, options?: any) => {
      for (const delta of deltas) {
        await options?.onToken?.(delta);
      }
      await options?.onToolCall?.({
        id: "call-1",
        name: "danger",
        arguments: "{}",
      });

      return resultFor("unreached");
    }) as unknown as AgentRunner;

    const orchestrator = createAgentOrchestrator({
      runner,
      guardrails: {
        toolCall: [
          () => ({ passed: false, reason: "tool calls are not allowed" }),
        ],
      },
    });

    const { stream, result } = orchestrator.runStream(mockAgent(), "hi", {
      onToken: () => {},
    });
    const chunks = await collect(stream);
    await expect(result).rejects.toThrow(GuardrailError);

    const triggered = chunks.find((c) => c.type === "guardrail_triggered");
    expect(triggered).toBeDefined();
    if (triggered?.type === "guardrail_triggered") {
      const first = triggered.partialOutput.charCodeAt(0);
      expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
      expect(() => encodeURIComponent(triggered.partialOutput)).not.toThrow();
    }
  });
});

// ============================================================================
// Composition still applies while streaming
// ============================================================================

describe("streaming does not bypass composition", () => {
  it("a blocking tool-call guardrail still blocks through runStream", async () => {
    const toolRan = vi.fn();
    const runner = (async (_a: AgentLike, _i: string, options?: any) => {
      await options?.onToken?.("thinking");
      await options?.onToolCall?.({
        id: "call-1",
        name: "delete-everything",
        arguments: "{}",
      });
      toolRan();

      return resultFor("done");
    }) as unknown as AgentRunner;

    const orchestrator = createAgentOrchestrator({
      runner,
      guardrails: {
        toolCall: [() => ({ passed: false, reason: "blocked by policy" })],
      },
    });

    const { stream, result } = orchestrator.runStream(mockAgent(), "hi", {
      onToken: () => {},
    });
    const chunks = await collect(stream);

    await expect(result).rejects.toThrow(GuardrailError);
    expect(toolRan).not.toHaveBeenCalled();
    expect(
      chunks.some(
        (c) =>
          c.type === "guardrail_triggered" &&
          c.reason.includes("blocked by policy"),
      ),
    ).toBe(true);
  });

  it("a blocking tool-call guardrail still blocks in the multi-agent orchestrator", async () => {
    const toolRan = vi.fn();
    const runner = (async (_a: AgentLike, _i: string, options?: any) => {
      await options?.onToken?.("thinking");
      await options?.onToolCall?.({
        id: "call-1",
        name: "delete-everything",
        arguments: "{}",
      });
      toolRan();

      return resultFor("done");
    }) as unknown as AgentRunner;

    const orchestrator = multiAgent(runner, {
      guardrails: {
        toolCall: [() => ({ passed: false, reason: "blocked by policy" })],
      },
    });

    const { stream, result } = orchestrator.runAgentStream("assistant", "hi", {
      onToken: () => {},
    });
    await collect(stream);

    await expect(result).rejects.toThrow(GuardrailError);
    expect(toolRan).not.toHaveBeenCalled();
  });

  it("a budget still trips behind runStream", async () => {
    const base = vi.fn(async () =>
      resultFor("never"),
    ) as unknown as AgentRunner;
    const orchestrator = createAgentOrchestrator({
      runner: withBudget(withRetry(base, { maxRetries: 1 }), {
        maxCostPerCall: 1e-9,
        pricing: { inputPerMillion: 3, outputPerMillion: 15 },
      }),
    });

    const { stream, result } = orchestrator.runStream(mockAgent(), "hello", {
      onToken: () => {},
    });
    await collect(stream);

    await expect(result).rejects.toThrow(BudgetExceededError);
    expect(base).not.toHaveBeenCalled();
  });

  it("a budget still trips behind the multi-agent stream", async () => {
    const base = vi.fn(async () =>
      resultFor("never"),
    ) as unknown as AgentRunner;
    const orchestrator = multiAgent(
      withBudget(withRetry(base, { maxRetries: 1 }), {
        maxCostPerCall: 1e-9,
        pricing: { inputPerMillion: 3, outputPerMillion: 15 },
      }),
    );

    const { stream, result } = orchestrator.runAgentStream("assistant", "hi", {
      onToken: () => {},
    });
    await collect(stream);

    await expect(result).rejects.toThrow(BudgetExceededError);
    expect(base).not.toHaveBeenCalled();
  });
});

// ============================================================================
// The two orchestrators agree
// ============================================================================

describe("both orchestrators stream the same way", () => {
  const deltas = ["Hel", "lo ", "world"];

  async function singleAgentChunks(onToken?: (token: string) => void) {
    const orchestrator = createAgentOrchestrator({
      runner: deltaRunner(deltas),
    });
    const { stream, result } = orchestrator.runStream(
      mockAgent("assistant"),
      "hi",
      onToken ? { onToken } : undefined,
    );
    const chunks = await collect(stream);
    await result;

    return chunks;
  }

  async function multiAgentChunks(onToken?: (token: string) => void) {
    const orchestrator = multiAgent(deltaRunner(deltas));
    const { stream, result } = orchestrator.runAgentStream(
      "assistant",
      "hi",
      onToken ? { onToken } : undefined,
    );
    const chunks = await collect(stream);
    await result;

    return chunks;
  }

  it("emits the same token chunks with onToken", async () => {
    const single = tokenChunks(await singleAgentChunks(() => {}));
    const multi = tokenChunks(await multiAgentChunks(() => {}));

    expect(single.map((c) => [c.data, c.deltaCount, c.tokenCount])).toEqual(
      multi.map((c) => [c.data, c.deltaCount, c.tokenCount]),
    );
    expect(single.map((c) => c.data)).toEqual(deltas);
  });

  it("emits the same token chunks without onToken", async () => {
    const single = tokenChunks(await singleAgentChunks());
    const multi = tokenChunks(await multiAgentChunks());

    expect(single.map((c) => [c.data, c.deltaCount, c.tokenCount])).toEqual(
      multi.map((c) => [c.data, c.deltaCount, c.tokenCount]),
    );
    expect(single.map((c) => c.data)).toEqual(["Hello world"]);
  });

  it("both mark a retry with an identical stream_restart chunk", async () => {
    const single = createAgentOrchestrator({
      runner: failOnceRunner(["bad"], ["good"]),
      agentRetry: { attempts: 2, baseDelayMs: 0 },
    });
    const singleStream = single.runStream(mockAgent(), "hi", {
      onToken: () => {},
    });
    const singleChunks = await collect(singleStream.stream);
    await singleStream.result;

    const multi = createMultiAgentOrchestrator({
      runner: failOnceRunner(["bad"], ["good"]),
      agents: { assistant: { agent: mockAgent("assistant") } },
      agentRetry: { attempts: 2, baseDelayMs: 0 },
    } as never);
    const multiStream = multi.runAgentStream("assistant", "hi", {
      onToken: () => {},
    });
    const multiChunks = await collect(multiStream.stream);
    await multiStream.result;

    const restartOf = (chunks: OrchestratorStreamChunk[]) =>
      chunks.filter((c) => c.type === "stream_restart");

    expect(restartOf(singleChunks)).toEqual([
      { type: "stream_restart", reason: "retry", generation: 2 },
    ]);
    expect(restartOf(multiChunks)).toEqual(restartOf(singleChunks));
    expect(tokenData(singleChunks)).toEqual(tokenData(multiChunks));
  });
});

// ============================================================================
// Durable record of a streamed run
// ============================================================================

/**
 * A runner that reports one tool call per name through `options.onToolCall`,
 * the way a tool-executing runner does, then answers with deltas.
 */
function toolCallRunner(toolNames: string[]): AgentRunner {
  return (async (_agent: AgentLike, _input: string, options?: any) => {
    const calls = toolNames.map((name, i) => ({
      id: `call-${i}`,
      name,
      arguments: `{"i":${i}}`,
      result: `result-${i}`,
    }));
    for (const call of calls) {
      await options?.onToolCall?.(call);
    }
    if (options?.onToken) {
      await options.onToken("done");
    }
    await options?.onMessage?.({ role: "assistant", content: "done" });

    return { ...resultFor("done"), toolCalls: calls };
  }) as unknown as AgentRunner;
}

/** The `toolCalls` bridge fact for the single-agent orchestrator. */
function singleToolCallsFact(orchestrator: {
  facts: { toolCalls: unknown };
}): Array<{ id: string; name: string }> {
  return orchestrator.facts.toolCalls as Array<{ id: string; name: string }>;
}

/** The `toolCalls` bridge fact for one agent of the multi-agent orchestrator. */
function multiToolCallsFact(
  orchestrator: { facts: Record<string, unknown> },
  agentId: string,
): Array<{ id: string; name: string }> {
  const agentFacts = orchestrator.facts[agentId] as Record<string, unknown>;

  return agentFacts.__toolCalls as Array<{ id: string; name: string }>;
}

/** Event types recorded on a timeline, in order. */
function timelineTypes(timeline: DebugTimeline | null): string[] {
  return (timeline?.getEvents() ?? []).map((event) => event.type);
}

/**
 * The fields a timeline entry carries that describe the run rather than when
 * it happened, so two runs of the same agent can be compared directly.
 */
function timelineShape(
  timeline: DebugTimeline | null,
): Record<string, unknown>[] {
  return (timeline?.getEvents() ?? []).map((event) => {
    const fields: Record<string, unknown> = { ...event };

    return {
      type: fields.type,
      agentId: fields.agentId,
      input: fields.input,
      inputLength: fields.inputLength,
      output: fields.output,
      outputLength: fields.outputLength,
      totalTokens: fields.totalTokens,
    };
  });
}

describe("streamed runs leave the same record as buffered ones", () => {
  it("single-agent: the toolCalls fact is identical either way", async () => {
    const buffered = createAgentOrchestrator({
      runner: toolCallRunner(["search", "fetch"]),
      autoApproveToolCalls: true,
    });
    await buffered.run(mockAgent(), "hi");

    const streamed = createAgentOrchestrator({
      runner: toolCallRunner(["search", "fetch"]),
      autoApproveToolCalls: true,
    });
    const { stream, result } = streamed.runStream(mockAgent(), "hi", {
      deltas: true,
    });
    await collect(stream);
    await result;

    expect(singleToolCallsFact(streamed)).toEqual(
      singleToolCallsFact(buffered),
    );
    expect(singleToolCallsFact(streamed).map((c) => c.name)).toEqual([
      "search",
      "fetch",
    ]);
  });

  it("multi-agent: the toolCalls fact is identical either way", async () => {
    const buffered = multiAgent(toolCallRunner(["search", "fetch"]), {
      autoApproveToolCalls: true,
    });
    await buffered.runAgent("assistant", "hi");

    const streamed = multiAgent(toolCallRunner(["search", "fetch"]), {
      autoApproveToolCalls: true,
    });
    const { stream, result } = streamed.runAgentStream("assistant", "hi", {
      deltas: true,
    });
    await collect(stream);
    await result;

    expect(multiToolCallsFact(streamed, "assistant")).toEqual(
      multiToolCallsFact(buffered, "assistant"),
    );
  });

  it("both orchestrators record one entry per tool call, not two", async () => {
    const single = createAgentOrchestrator({
      runner: toolCallRunner(["search"]),
      autoApproveToolCalls: true,
    });
    const singleStream = single.runStream(mockAgent(), "hi", {
      onToken: () => {},
    });
    await collect(singleStream.stream);
    await singleStream.result;

    const multi = multiAgent(toolCallRunner(["search"]), {
      autoApproveToolCalls: true,
    });
    const multiStream = multi.runAgentStream("assistant", "hi", {
      onToken: () => {},
    });
    await collect(multiStream.stream);
    await multiStream.result;

    expect(singleToolCallsFact(single)).toHaveLength(1);
    expect(multiToolCallsFact(multi, "assistant")).toHaveLength(1);
  });

  it("both cap the streamed toolCalls fact where the buffered path caps it", async () => {
    const names = Array.from({ length: 205 }, (_, i) => `tool-${i}`);

    const single = createAgentOrchestrator({
      runner: toolCallRunner(names),
      autoApproveToolCalls: true,
    });
    const singleStream = single.runStream(mockAgent(), "hi", { deltas: true });
    await collect(singleStream.stream);
    await singleStream.result;

    const multi = multiAgent(toolCallRunner(names), {
      autoApproveToolCalls: true,
    });
    const multiStream = multi.runAgentStream("assistant", "hi", {
      deltas: true,
    });
    await collect(multiStream.stream);
    await multiStream.result;

    // 200 is the cap the buffered path has always applied. Before this the
    // single-agent streaming path appended without bound.
    expect(singleToolCallsFact(single)).toHaveLength(200);
    expect(multiToolCallsFact(multi, "assistant")).toHaveLength(200);
    expect(singleToolCallsFact(single)[0]?.name).toBe("tool-5");
    expect(multiToolCallsFact(multi, "assistant")[0]?.name).toBe("tool-5");
  });

  it("both write agent_start and agent_complete to the timeline while streaming", async () => {
    const single = createAgentOrchestrator({
      runner: toolCallRunner(["search"]),
      autoApproveToolCalls: true,
      debug: true,
    });
    const singleStream = single.runStream(mockAgent(), "hi", { deltas: true });
    await collect(singleStream.stream);
    await singleStream.result;

    const multi = multiAgent(toolCallRunner(["search"]), {
      autoApproveToolCalls: true,
      debug: true,
    });
    const multiStream = multi.runAgentStream("assistant", "hi", {
      deltas: true,
    });
    await collect(multiStream.stream);
    await multiStream.result;

    expect(timelineTypes(single.timeline)).toEqual([
      "agent_start",
      "agent_complete",
    ]);
    expect(timelineTypes(multi.timeline)).toEqual(
      timelineTypes(single.timeline),
    );
  });

  it("single-agent: the streamed timeline entries carry what the buffered ones carry", async () => {
    const buffered = createAgentOrchestrator({
      runner: deltaRunner(["Hello"]),
      debug: true,
    });
    await buffered.run(mockAgent(), "a question");

    const streamed = createAgentOrchestrator({
      runner: deltaRunner(["Hello"]),
      debug: true,
    });
    const { stream, result } = streamed.runStream(mockAgent(), "a question", {
      deltas: true,
    });
    await collect(stream);
    await result;

    expect(timelineShape(streamed.timeline)).toEqual(
      timelineShape(buffered.timeline),
    );
  });
});

// ============================================================================
// destroy() and streams still in flight
// ============================================================================

/** A runner that never settles, so the stream stays open until torn down. */
function hangingRunner(onStart: () => void): AgentRunner {
  return (async (_agent: AgentLike, _input: string, _options?: any) => {
    onStart();

    return new Promise<RunResult>(() => {});
  }) as unknown as AgentRunner;
}

/** A runner that records the signal it was handed, then answers normally. */
function signalCapturingRunner(seen: AbortSignal[]): AgentRunner {
  return (async (_agent: AgentLike, _input: string, options?: any) => {
    if (options?.signal) {
      seen.push(options.signal);
    }
    await options?.onMessage?.({ role: "assistant", content: "ok" });

    return resultFor("ok");
  }) as unknown as AgentRunner;
}

/** Resolve once the microtask and timer queues have drained. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("destroy() and live streams", () => {
  it("single-agent: releases a consumer parked on the stream", async () => {
    let started!: () => void;
    const hasStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const orchestrator = createAgentOrchestrator({
      runner: hangingRunner(started),
    });

    const { stream } = orchestrator.runStream(mockAgent(), "hi", {
      deltas: true,
    });
    const consumed = (async () => {
      for await (const _chunk of stream) {
        // drain until the stream ends
      }

      return "ended";
    })();

    await hasStarted;
    await settle();
    orchestrator.destroy();

    await expect(consumed).resolves.toBe("ended");
  });

  it("multi-agent: releases a consumer parked on the stream", async () => {
    let started!: () => void;
    const hasStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const orchestrator = multiAgent(hangingRunner(started));

    const { stream } = orchestrator.runAgentStream("assistant", "hi", {
      deltas: true,
    });
    const consumed = (async () => {
      for await (const _chunk of stream) {
        // drain until the stream ends
      }

      return "ended";
    })();

    await hasStarted;
    await settle();
    orchestrator.destroy();

    await expect(consumed).resolves.toBe("ended");
  });

  it("single-agent: aborts the in-flight provider request", async () => {
    let started!: () => void;
    const hasStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let seen: AbortSignal | undefined;
    const orchestrator = createAgentOrchestrator({
      runner: (async (_a: AgentLike, _i: string, options?: any) => {
        seen = options?.signal;
        started();

        return new Promise<RunResult>(() => {});
      }) as unknown as AgentRunner,
    });

    const { stream } = orchestrator.runStream(mockAgent(), "hi", {
      deltas: true,
    });
    void collect(stream);

    await hasStarted;
    await settle();
    expect(seen?.aborted).toBe(false);

    orchestrator.destroy();
    expect(seen?.aborted).toBe(true);
  });

  it("single-agent: a completed stream deregisters, so destroy() reaches nothing", async () => {
    const seen: AbortSignal[] = [];
    const orchestrator = createAgentOrchestrator({
      runner: signalCapturingRunner(seen),
    });

    for (let i = 0; i < 3; i++) {
      const { stream, result } = orchestrator.runStream(mockAgent(), "hi", {
        deltas: true,
      });
      await collect(stream);
      await result;
    }

    expect(seen).toHaveLength(3);
    orchestrator.destroy();

    // A leaked registry would abort every finished run's signal here.
    expect(seen.map((s) => s.aborted)).toEqual([false, false, false]);
  });

  it("multi-agent: a completed stream deregisters, so destroy() reaches nothing", async () => {
    const seen: AbortSignal[] = [];
    const orchestrator = multiAgent(signalCapturingRunner(seen));

    for (let i = 0; i < 3; i++) {
      const { stream, result } = orchestrator.runAgentStream(
        "assistant",
        "hi",
        {
          deltas: true,
        },
      );
      await collect(stream);
      await result;
    }

    expect(seen).toHaveLength(3);
    orchestrator.destroy();

    expect(seen.map((s) => s.aborted)).toEqual([false, false, false]);
  });

  it("destroy() with nothing streaming behaves exactly as before", async () => {
    const single = createAgentOrchestrator({ runner: bufferedRunner("ok") });
    await single.run(mockAgent(), "hi");
    expect(() => single.destroy()).not.toThrow();

    const multi = multiAgent(bufferedRunner("ok"));
    await multi.runAgent("assistant", "hi");
    expect(() => multi.destroy()).not.toThrow();
    // Second call stays a no-op.
    expect(() => multi.destroy()).not.toThrow();
  });
});

// ============================================================================
// Generation boundaries the orchestrator does not perform itself
// ============================================================================

describe("stream_restart from runner wrappers", () => {
  /** Fails `failures` times, then streams `deltas`. */
  function flakyDeltaRunner(failures: number, deltas: string[]): AgentRunner {
    let call = 0;
    const inner = deltaRunner(deltas);

    return (async (agent: AgentLike, input: string, options?: any) => {
      call++;
      if (call <= failures) {
        throw new Error("[Directive] request failed: 503");
      }

      return inner(agent, input, options);
    }) as unknown as AgentRunner;
  }

  it("marks a withRetry retry, so the stream is not one run-on response", async () => {
    const orchestrator = createAgentOrchestrator({
      runner: withRetry(flakyDeltaRunner(1, ["The answer ", "is 42"]), {
        maxRetries: 2,
        baseDelayMs: 0,
      }),
    });

    const { stream, result } = orchestrator.runStream(mockAgent(), "hi", {
      deltas: true,
    });
    const chunks = await collect(stream);
    await result;

    const restarts = chunks.filter((c) => c.type === "stream_restart");
    expect(restarts).toEqual([
      { type: "stream_restart", reason: "retry", generation: 2 },
    ]);
  });

  it("marks a withFallback reroute, so the stream and the result agree", async () => {
    const failing: AgentRunner = (async (
      _agent: AgentLike,
      _input: string,
      options?: any,
    ) => {
      await options?.onToken?.("Sorry, I cannot");

      throw new Error("provider down");
    }) as unknown as AgentRunner;
    const orchestrator = createAgentOrchestrator({
      runner: withFallback([failing, deltaRunner(["Sure, ", "here you go."])]),
    });

    const { stream, result } = orchestrator.runStream(mockAgent(), "hi", {
      deltas: true,
    });
    const chunks = await collect(stream);
    const final = await result;

    const restartIndex = chunks.findIndex((c) => c.type === "stream_restart");
    expect(restartIndex).toBeGreaterThan(-1);
    expect((chunks[restartIndex] as { reason: string }).reason).toBe("reroute");

    // Rendering the current generation reproduces the result exactly.
    const rendered = tokenData(chunks.slice(restartIndex)).join("");
    expect(rendered).toBe(final.output);
  });

  it("gives run({ onToken }) the same boundary through onStreamRestart", async () => {
    const orchestrator = createAgentOrchestrator({
      runner: withRetry(flakyDeltaRunner(1, ["The answer ", "is 42"]), {
        maxRetries: 2,
        baseDelayMs: 0,
      }),
    });

    let rendered = "";
    const restarts: string[] = [];
    const result = await orchestrator.run(mockAgent(), "hi", {
      onToken: (token) => {
        rendered += token;
      },
      onStreamRestart: (reason) => {
        restarts.push(reason);
        rendered = "";
      },
    });

    expect(restarts).toEqual(["retry"]);
    expect(rendered).toBe(result.output);
  });
});

// ============================================================================
// The configured runner applies on the streaming path too
// ============================================================================

describe("runStream uses the configured runner", () => {
  it("applies the orchestrator's output schema, and marks the schema retry", async () => {
    let call = 0;
    const runner: AgentRunner = (async (
      _agent: AgentLike,
      _input: string,
      options?: any,
    ) => {
      call++;
      const output = call === 1 ? "not json" : '{"ok":true}';
      await options?.onToken?.(output);

      return { ...resultFor(output), output };
    }) as unknown as AgentRunner;

    const orchestrator = createAgentOrchestrator({
      runner,
      outputSchema: {
        safeParse: (value: unknown) =>
          typeof value === "object" && value !== null
            ? { success: true, data: value }
            : { success: false, error: { message: "not an object" } },
      } as never,
    });

    const { stream, result } = orchestrator.runStream(mockAgent(), "hi", {
      deltas: true,
    });
    const chunks = await collect(stream);
    const final = await result;

    expect(call).toBe(2);
    expect(final.output).toEqual({ ok: true });
    expect(chunks.filter((c) => c.type === "stream_restart")).toMatchObject([
      { reason: "schema-retry", generation: 2 },
    ]);
  });

  it("applies the circuit breaker, so a streamed run counts toward it", async () => {
    const failing: AgentRunner = (async () => {
      throw new Error("boom");
    }) as AgentRunner;
    const orchestrator = createAgentOrchestrator({
      runner: failing,
      circuitBreaker: { failureThreshold: 1, resetTimeoutMs: 60_000 },
    } as never);

    const first = orchestrator.runStream(mockAgent(), "hi", { deltas: true });
    await collect(first.stream);
    await expect(first.result).rejects.toThrow();

    const second = orchestrator.runStream(mockAgent(), "hi", { deltas: true });
    const chunks = await collect(second.stream);
    await expect(second.result).rejects.toThrow();

    const error = chunks.find((c) => c.type === "error");
    expect((error as { error: Error }).error.message).toMatch(/circuit/i);
  });
});

// ============================================================================
// Loss is bounded, and reported however the run ends
// ============================================================================

describe("buffer bounds and drop reporting", () => {
  it("bounds fact-change notifications on a stream nobody is reading", async () => {
    const factSystem = createSystem({
      module: createModule("ticker", {
        schema: {
          facts: { price: t.number() },
          events: { setPrice: { price: t.number() } },
        },
        init: (facts) => {
          facts.price = 0;
        },
        events: {
          setPrice: (facts, payload) => {
            facts.price = payload.price;
          },
        },
      }),
    });
    factSystem.start();

    // Mutates the watched fact far past the buffer cap before returning, with
    // no consumer pulling from the stream.
    const runner: AgentRunner = (async (
      _agent: AgentLike,
      _input: string,
      options?: any,
    ) => {
      for (let i = 1; i <= 30_000; i++) {
        factSystem.events.setPrice({ price: i });
      }
      await options?.onToken?.("done");

      return resultFor("done");
    }) as unknown as AgentRunner;

    const orchestrator = createAgentOrchestrator({ runner });
    const { stream, result } = orchestrator.runStream(mockAgent(), "hi", {
      deltas: true,
      liveContext: {
        system: factSystem as never,
        keys: ["price"],
        notifyOn: "all-changes",
        interruptWhen: () => false,
      },
    });

    await result;
    const chunks = await collect(stream);
    factSystem.destroy();

    // The buffer holds its cap, not one chunk per fact change.
    expect(chunks.length).toBeLessThanOrEqual(10_001);

    const done = chunks.find((c) => c.type === "done");
    expect((done as { droppedTokens: number }).droppedTokens).toBeGreaterThan(
      0,
    );
  });

  it("keeps control chunks ahead of content, and still caps them", () => {
    const buffer: Array<{ type: string; id: number }> = [];
    for (let i = 0; i < 4; i++) {
      admitChunk(buffer, { type: "token", id: i }, 4);
    }

    // Full: another token is refused.
    expect(admitChunk(buffer, { type: "token", id: 99 }, 4)).toBe(1);
    expect(buffer).toHaveLength(4);

    // A control chunk lands, evicting the newest token so the beginning of
    // the response survives.
    expect(admitChunk(buffer, { type: "approval_required", id: 100 }, 4)).toBe(
      1,
    );
    expect(buffer.map((c) => c.id)).toEqual([0, 1, 2, 100]);

    // Control chunks are capped too — three more cannot grow the buffer past
    // four, however many arrive.
    for (let i = 0; i < 3; i++) {
      admitChunk(buffer, { type: "approval_required", id: 200 + i }, 4);
    }
    expect(buffer).toHaveLength(4);

    // The terminal chunk always lands, even with nothing droppable left.
    expect(admitChunk(buffer, { type: "done", id: 300 }, 4)).toBe(1);
    expect(buffer).toHaveLength(4);
    expect(buffer[buffer.length - 1]!.id).toBe(300);
  });

  it("reports the loss on the error path, not only on done", async () => {
    const runner: AgentRunner = (async (
      _agent: AgentLike,
      _input: string,
      options?: any,
    ) => {
      for (let i = 0; i < 10_050; i++) {
        await options?.onToken?.("x");
      }

      throw new Error("boom");
    }) as unknown as AgentRunner;

    const orchestrator = createAgentOrchestrator({ runner });
    const { stream, result } = orchestrator.runStream(mockAgent(), "hi", {
      deltas: true,
    });
    await expect(result).rejects.toThrow(/boom/);

    const chunks = await collect(stream);
    const error = chunks.find((c) => c.type === "error");
    expect((error as { droppedTokens?: number }).droppedTokens).toBeGreaterThan(
      0,
    );
  });
});

// ============================================================================
// Multi-agent paths that accept the option
// ============================================================================

describe("multi-agent streaming options", () => {
  it("hands a task's output to onToken as well as to the stream", async () => {
    const orchestrator = createMultiAgentOrchestrator({
      runner: bufferedRunner("unused"),
      agents: { assistant: { agent: mockAgent("assistant") } },
      tasks: { summarize: { run: async () => "task output" } },
    } as never);

    const tokens: string[] = [];
    const { stream, result } = orchestrator.runAgentStream("summarize", "hi", {
      onToken: (token) => tokens.push(token),
    });
    const chunks = await collect(stream);
    await result;

    expect(tokens).toEqual(["task output"]);
    expect(tokenData(chunks)).toEqual(["task output"]);
  });

  it("forwards deltas through runParallelStream", async () => {
    const orchestrator = createMultiAgentOrchestrator({
      runner: deltaRunner(["a", "b", "c"]),
      agents: {
        one: { agent: mockAgent("one") },
        two: { agent: mockAgent("two") },
      },
    } as never);

    const { stream, results } = orchestrator.runParallelStream(
      ["one", "two"],
      "hi",
      (all) => all.length,
      { deltas: true },
    );

    const seen: Record<string, string[]> = { one: [], two: [] };
    for await (const { chunk, agentId } of stream) {
      if (chunk.type === "token") {
        seen[agentId]!.push(chunk.data);
      }
    }
    await results;

    expect(seen.one).toEqual(["a", "b", "c"]);
    expect(seen.two).toEqual(["a", "b", "c"]);
  });
});
