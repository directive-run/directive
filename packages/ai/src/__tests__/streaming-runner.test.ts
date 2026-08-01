import { describe, expect, it, vi } from "vitest";
import { createAgentOrchestrator } from "../agent-orchestrator.js";
import type { OrchestratorStreamChunk } from "../agent-orchestrator.js";
import { createMultiAgentOrchestrator } from "../multi-agent-orchestrator.js";
import { streamingRunnerToAgentRunner } from "../streaming.js";
import type { TokenChunk } from "../streaming.js";
import type {
  AgentLike,
  AgentRunner,
  RunResult,
  StreamingCallbackRunner,
} from "../types.js";

// ============================================================================
// Helpers
// ============================================================================

const TOKENS = ["He", "llo", " wo", "rld"];
const FULL_TEXT = TOKENS.join("");

function mockAgent(overrides: Partial<AgentLike> = {}): AgentLike {
  return {
    name: "test-agent",
    instructions: "Be helpful.",
    ...overrides,
  };
}

function messageResult(output: string): RunResult {
  return {
    output,
    messages: [{ role: "assistant", content: output }],
    toolCalls: [],
    totalTokens: 12,
  };
}

/** Plain runner — emits one whole assistant message, no token deltas. */
function createMockRunner(output = FULL_TEXT): AgentRunner {
  return vi.fn(async (_agent, _input, options) => {
    const result = messageResult(output);
    options?.onMessage?.(result.messages[0]!);

    return result;
  }) as unknown as AgentRunner;
}

/**
 * Callback runner that mirrors real adapters: per-token deltas followed by a
 * whole-message callback carrying the same text.
 */
function createFakeStreamingRunner(
  options: { tokens?: string[]; failTimes?: number } = {},
): StreamingCallbackRunner & { callCount: () => number } {
  const { tokens = TOKENS, failTimes = 0 } = options;
  let calls = 0;

  const runner: StreamingCallbackRunner = async (_agent, _input, callbacks) => {
    calls++;
    if (calls <= failTimes) {
      throw new Error("transient provider failure");
    }

    for (const token of tokens) {
      callbacks.onToken?.(token);
      await Promise.resolve();
    }

    const output = tokens.join("");
    callbacks.onMessage?.({ role: "assistant", content: output });

    return messageResult(output);
  };

  return Object.assign(runner, { callCount: () => calls });
}

async function collectChunks(
  stream: AsyncIterable<OrchestratorStreamChunk>,
): Promise<OrchestratorStreamChunk[]> {
  const chunks: OrchestratorStreamChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return chunks;
}

function tokenChunks(chunks: OrchestratorStreamChunk[]): TokenChunk[] {
  return chunks.filter((chunk): chunk is TokenChunk => chunk.type === "token");
}

// ============================================================================
// streamingRunnerToAgentRunner
// ============================================================================

describe("streamingRunnerToAgentRunner", () => {
  it("forwards token hooks and passes through onMessage and signal", async () => {
    const controller = new AbortController();
    const seenTokens: string[] = [];
    let seenSignal: AbortSignal | undefined;

    const streamingRunner: StreamingCallbackRunner = async (
      _agent,
      _input,
      callbacks,
    ) => {
      seenSignal = callbacks.signal;
      for (const token of TOKENS) {
        callbacks.onToken?.(token);
      }
      callbacks.onMessage?.({ role: "assistant", content: FULL_TEXT });

      return messageResult(FULL_TEXT);
    };

    const messages: string[] = [];
    const runner = streamingRunnerToAgentRunner(streamingRunner, {
      onToken: (token) => seenTokens.push(token),
    });

    const result = await runner(mockAgent(), "Hi", {
      signal: controller.signal,
      onMessage: (message) => messages.push(message.content),
    });

    expect(seenTokens).toEqual(TOKENS);
    expect(messages).toEqual([FULL_TEXT]);
    expect(seenSignal).toBe(controller.signal);
    expect(result.output).toBe(FULL_TEXT);
  });

  it("forwards tool hooks", async () => {
    const started: string[] = [];
    const ended: string[] = [];

    const streamingRunner: StreamingCallbackRunner = async (
      _agent,
      _input,
      callbacks,
    ) => {
      callbacks.onToolStart?.("search", "call-1", '{"q":"x"}');
      callbacks.onToolEnd?.("search", "call-1", "ok");

      return messageResult("done");
    };

    const runner = streamingRunnerToAgentRunner(streamingRunner, {
      onToolStart: (tool, id) => started.push(`${tool}:${id}`),
      onToolEnd: (tool, id, result) => ended.push(`${tool}:${id}:${result}`),
    });

    await runner(mockAgent(), "Hi");

    expect(started).toEqual(["search:call-1"]);
    expect(ended).toEqual(["search:call-1:ok"]);
  });
});

// ============================================================================
// Single-agent orchestrator streaming
// ============================================================================

describe("createAgentOrchestrator — streamingRunner", () => {
  it("emits one token chunk per provider delta, in order", async () => {
    const orchestrator = createAgentOrchestrator({
      runner: createMockRunner(),
      streamingRunner: createFakeStreamingRunner(),
    });

    const { stream, result } = orchestrator.runStream(mockAgent(), "Hi");
    const chunks = await collectChunks(stream);
    const tokens = tokenChunks(chunks);
    const final = await result;

    expect(tokens.length).toBeGreaterThanOrEqual(4);
    expect(tokens.map((chunk) => chunk.data)).toEqual(TOKENS);
    expect(tokens.map((chunk) => chunk.tokenCount)).toEqual([1, 2, 3, 4]);
    expect(tokens.map((chunk) => chunk.data).join("")).toBe(final.output);
  });

  it("does not re-emit the full text as a trailing token chunk", async () => {
    const orchestrator = createAgentOrchestrator({
      runner: createMockRunner(),
      streamingRunner: createFakeStreamingRunner(),
    });

    const { stream, result } = orchestrator.runStream(mockAgent(), "Hi");
    const chunks = await collectChunks(stream);
    await result;

    const tokens = tokenChunks(chunks);
    expect(tokens.some((chunk) => chunk.data === FULL_TEXT)).toBe(false);
    expect(tokens.at(-1)!.tokenCount).toBe(TOKENS.length);
    // The message chunk still lands — only the synthesized token is suppressed.
    expect(chunks.filter((chunk) => chunk.type === "message")).toHaveLength(1);
  });

  it("records the streamed message in conversation facts", async () => {
    const orchestrator = createAgentOrchestrator({
      runner: createMockRunner(),
      streamingRunner: createFakeStreamingRunner(),
    });

    const { stream, result } = orchestrator.runStream(mockAgent(), "Hi");
    await collectChunks(stream);
    await result;

    expect(orchestrator.facts.conversation).toHaveLength(1);
    expect(orchestrator.facts.conversation[0]!.content).toBe(FULL_TEXT);
  });

  it("leaves the non-streaming shape untouched when no streamingRunner is set", async () => {
    const orchestrator = createAgentOrchestrator({
      runner: createMockRunner(),
    });

    const { stream, result } = orchestrator.runStream(mockAgent(), "Hi");
    const chunks = await collectChunks(stream);
    await result;

    const tokens = tokenChunks(chunks);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.data).toBe(FULL_TEXT);
    expect(tokens[0]!.tokenCount).toBe(Math.ceil(FULL_TEXT.length / 4));
  });

  it("still applies output guardrails", async () => {
    const orchestrator = createAgentOrchestrator({
      runner: createMockRunner(),
      streamingRunner: createFakeStreamingRunner(),
      guardrails: {
        output: [() => ({ passed: false, reason: "blocked output" })],
      },
    });

    const { stream, result } = orchestrator.runStream(mockAgent(), "Hi");
    const chunks = await collectChunks(stream);

    await expect(result).rejects.toThrow(/blocked output/);
    expect(
      chunks.some(
        (chunk) =>
          chunk.type === "guardrail_triggered" &&
          chunk.reason === "blocked output",
      ),
    ).toBe(true);
  });

  it("still retries a failing streaming run", async () => {
    const streamingRunner = createFakeStreamingRunner({ failTimes: 1 });
    const orchestrator = createAgentOrchestrator({
      runner: createMockRunner(),
      streamingRunner,
      agentRetry: { attempts: 2, backoff: "fixed", baseDelayMs: 1 },
    });

    const { stream, result } = orchestrator.runStream(mockAgent(), "Hi");
    const chunks = await collectChunks(stream);
    const final = await result;

    expect(streamingRunner.callCount()).toBe(2);
    expect(final.output).toBe(FULL_TEXT);
    expect(tokenChunks(chunks).map((chunk) => chunk.data)).toEqual(TOKENS);
  });
});

// ============================================================================
// Multi-agent orchestrator streaming
// ============================================================================

describe("createMultiAgentOrchestrator — streamingRunner", () => {
  it("emits one token chunk per provider delta, in order", async () => {
    const orchestrator = createMultiAgentOrchestrator({
      runner: createMockRunner(),
      streamingRunner: createFakeStreamingRunner(),
      agents: { writer: { agent: mockAgent({ name: "writer" }) } },
    });

    const { stream, result } = orchestrator.runAgentStream("writer", "Hi");
    const chunks = await collectChunks(stream);
    const tokens = tokenChunks(chunks);
    const final = await result;

    expect(tokens.length).toBeGreaterThanOrEqual(4);
    expect(tokens.map((chunk) => chunk.data)).toEqual(TOKENS);
    expect(tokens.map((chunk) => chunk.tokenCount)).toEqual([1, 2, 3, 4]);
    expect(tokens.map((chunk) => chunk.data).join("")).toBe(final.output);
    expect(tokens.some((chunk) => chunk.data === FULL_TEXT)).toBe(false);

    orchestrator.destroy();
  });

  it("leaves the non-streaming shape untouched when no streamingRunner is set", async () => {
    const orchestrator = createMultiAgentOrchestrator({
      runner: createMockRunner(),
      agents: { writer: { agent: mockAgent({ name: "writer" }) } },
    });

    const { stream, result } = orchestrator.runAgentStream("writer", "Hi");
    const chunks = await collectChunks(stream);
    await result;

    const tokens = tokenChunks(chunks);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.data).toBe(FULL_TEXT);

    orchestrator.destroy();
  });

  it("still applies output guardrails", async () => {
    const orchestrator = createMultiAgentOrchestrator({
      runner: createMockRunner(),
      streamingRunner: createFakeStreamingRunner(),
      agents: { writer: { agent: mockAgent({ name: "writer" }) } },
      guardrails: {
        output: [() => ({ passed: false, reason: "blocked output" })],
      },
    });

    const { stream, result } = orchestrator.runAgentStream("writer", "Hi");
    const chunks = await collectChunks(stream);

    await expect(result).rejects.toThrow(/blocked output/);
    expect(chunks.some((chunk) => chunk.type === "guardrail_triggered")).toBe(
      true,
    );

    orchestrator.destroy();
  });

  it("still retries a failing streaming run", async () => {
    const streamingRunner = createFakeStreamingRunner({ failTimes: 1 });
    const orchestrator = createMultiAgentOrchestrator({
      runner: createMockRunner(),
      streamingRunner,
      agents: {
        writer: {
          agent: mockAgent({ name: "writer" }),
          retry: { attempts: 2, backoff: "fixed", baseDelayMs: 1 },
        },
      },
    });

    const { stream, result } = orchestrator.runAgentStream("writer", "Hi");
    const chunks = await collectChunks(stream);
    const final = await result;

    expect(streamingRunner.callCount()).toBe(2);
    expect(final.output).toBe(FULL_TEXT);
    expect(tokenChunks(chunks).map((chunk) => chunk.data)).toEqual(TOKENS);

    orchestrator.destroy();
  });
});

// ============================================================================
// Tool-call gating is refused, not silently dropped
// ============================================================================

describe("streamingRunner refuses tool-call gating", () => {
  // A callback runner's hooks are sync and return void, so the bridge cannot
  // drive `RunOptions.onToolCall` — the hook that runs tool-call guardrails
  // and blocks for approval. Both would keep looking configured while passing
  // every tool call, so the combination is rejected at construction instead.
  const passingToolGuardrail = () => ({ passed: true }) as const;

  it("single-agent: rejects streamingRunner alongside toolCall guardrails", () => {
    expect(() =>
      createAgentOrchestrator({
        runner: createMockRunner(),
        streamingRunner: createFakeStreamingRunner(),
        guardrails: { toolCall: [passingToolGuardrail] },
      }),
    ).toThrow(/streamingRunner cannot be combined with tool-call gating/);
  });

  it("single-agent: rejects streamingRunner alongside manual approval", () => {
    expect(() =>
      createAgentOrchestrator({
        runner: createMockRunner(),
        streamingRunner: createFakeStreamingRunner(),
        autoApproveToolCalls: false,
        onApprovalRequest: () => {},
      }),
    ).toThrow(/streamingRunner cannot be combined with tool-call gating/);
  });

  it("single-agent: allows streamingRunner with input/output guardrails", () => {
    const orchestrator = createAgentOrchestrator({
      runner: createMockRunner(),
      streamingRunner: createFakeStreamingRunner(),
      guardrails: {
        input: [() => ({ passed: true }) as const],
        output: [() => ({ passed: true }) as const],
      },
    });

    expect(orchestrator).toBeDefined();
    orchestrator.destroy();
  });

  it("multi-agent: rejects orchestrator-level toolCall guardrails", () => {
    expect(() =>
      createMultiAgentOrchestrator({
        runner: createMockRunner(),
        streamingRunner: createFakeStreamingRunner(),
        guardrails: { toolCall: [passingToolGuardrail] },
        agents: { writer: { agent: mockAgent({ name: "writer" }) } },
      }),
    ).toThrow(/streamingRunner cannot be combined with tool-call gating/);
  });

  it("multi-agent: rejects per-agent toolCall guardrails and names the agent", () => {
    expect(() =>
      createMultiAgentOrchestrator({
        runner: createMockRunner(),
        streamingRunner: createFakeStreamingRunner(),
        agents: {
          safe: { agent: mockAgent({ name: "safe" }) },
          gated: {
            agent: mockAgent({ name: "gated" }),
            guardrails: { toolCall: [passingToolGuardrail] },
          },
        },
      }),
    ).toThrow(/Agents with tool-call guardrails: gated/);
  });

  it("does not constrain orchestrators without a streamingRunner", () => {
    const orchestrator = createAgentOrchestrator({
      runner: createMockRunner(),
      guardrails: { toolCall: [passingToolGuardrail] },
      autoApproveToolCalls: false,
      onApprovalRequest: () => {},
    });

    expect(orchestrator).toBeDefined();
    orchestrator.destroy();
  });
});
