/**
 * Streaming as a `RunOptions` field rather than a second runner.
 *
 * The property under test throughout: because `onToken` travels on the options
 * object that every wrapper already forwards verbatim, a composed runner
 * streams with no wrapper changes, and every other capability carried on that
 * same object – budgets, retries, tool-call gating – keeps working while it
 * streams.
 */

import { describe, expect, it, vi } from "vitest";
import { createAnthropicRunner } from "../adapters/anthropic.js";
import { createGeminiRunner } from "../adapters/gemini.js";
import { createOllamaRunner } from "../adapters/ollama.js";
import { createOpenAIRunner } from "../adapters/openai.js";
import { BudgetExceededError, withBudget } from "../budget.js";
import { withRetry } from "../retry.js";
import type {
  AgentLike,
  AgentRunner,
  RunOptions,
  RunResult,
  ToolCall,
} from "../types.js";

// ============================================================================
// Helpers
// ============================================================================

function mockAgent(overrides: Record<string, unknown> = {}): AgentLike {
  return {
    name: "test-agent",
    instructions: "You are helpful.",
    ...overrides,
  };
}

/** Emit each line as its own chunk, all queued up front. */
function lineStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${line}\n`));
      }
      controller.close();
    },
  });
}

function streamResponse(lines: string[]): Response {
  return new Response(lineStream(lines), {
    status: 200,
    statusText: "OK",
    headers: { "Content-Type": "text/event-stream" },
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    statusText: "OK",
    headers: { "Content-Type": "application/json" },
  });
}

const ANTHROPIC_SSE = [
  'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
  'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
  'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}',
  'data: {"type":"message_delta","usage":{"output_tokens":5}}',
];

const OPENAI_SSE = [
  'data: {"choices":[{"delta":{"content":"Hello"}}]}',
  'data: {"choices":[{"delta":{"content":" world"}}]}',
  'data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}',
  "data: [DONE]",
];

const FREE_PRICING = { inputPerMillion: 0, outputPerMillion: 0 };

// ============================================================================
// Wrapper composition — the regression the second-runner design could not pass
// ============================================================================

describe("streaming survives wrapper composition", () => {
  it("streams through withBudget(withRetry(runner)) — no wrapper changes needed", async () => {
    const fetchFn = vi
      .fn()
      .mockImplementation(async () => streamResponse(ANTHROPIC_SSE));
    const wrapped = withBudget(
      withRetry(createAnthropicRunner({ apiKey: "k", fetch: fetchFn })),
      {
        maxCostPerCall: 10,
        pricing: { inputPerMillion: 3, outputPerMillion: 15 },
      },
    );

    const tokens: string[] = [];
    const result = await wrapped(mockAgent(), "Hi", {
      onToken: (token) => {
        tokens.push(token);
      },
    });

    expect(tokens).toEqual(["Hello", " world"]);
    expect(result.output).toBe("Hello world");
    expect(JSON.parse(fetchFn.mock.calls[0]![1].body).stream).toBe(true);
  });

  it("charges the budget for a streamed call, so a wrapped runner is still budgeted", async () => {
    const fetchFn = vi
      .fn()
      .mockImplementation(async () => streamResponse(ANTHROPIC_SSE));
    const wrapped = withBudget(
      withRetry(createAnthropicRunner({ apiKey: "k", fetch: fetchFn })),
      {
        budgets: [
          {
            window: "hour",
            // $1 per token, so the 15 tokens of the streamed reply cost $15
            // against a $16 ceiling – enough headroom for one call, not two.
            maxCost: 16,
            pricing: {
              inputPerMillion: 1_000_000,
              outputPerMillion: 1_000_000,
            },
          },
        ],
      },
    );

    await wrapped(mockAgent(), "Hi", { onToken: () => {} });

    // 10 in + 5 out at $1/token = $15 recorded from the streamed run.
    expect(wrapped.getSpent("hour")).toBeCloseTo(15, 5);

    // And the recorded spend is enforced on the next streamed call.
    await expect(
      wrapped(mockAgent(), "Hi", { onToken: () => {} }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("retries a failed streaming attempt and streams the successful one", async () => {
    let attempt = 0;
    const fetchFn = vi.fn().mockImplementation(async () => {
      attempt++;
      if (attempt === 1) {
        return new Response("boom", { status: 500, statusText: "Error" });
      }

      return streamResponse(ANTHROPIC_SSE);
    });
    const wrapped = withRetry(
      createAnthropicRunner({ apiKey: "k", fetch: fetchFn }),
      { maxRetries: 1, baseDelayMs: 1 },
    );

    const tokens: string[] = [];
    const result = await wrapped(mockAgent(), "Hi", {
      onToken: (token) => {
        tokens.push(token);
      },
    });

    expect(attempt).toBe(2);
    expect(tokens).toEqual(["Hello", " world"]);
    expect(result.output).toBe("Hello world");
  });
});

// ============================================================================
// Backpressure
// ============================================================================

describe("backpressure", () => {
  it("awaits onToken, so a slow consumer paces the provider stream", async () => {
    const encoder = new TextEncoder();
    const log: string[] = [];
    let next = 0;

    // highWaterMark 0: `pull` runs only when the reader asks for more, so the
    // log records exactly when the adapter went back to the wire.
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (next >= ANTHROPIC_SSE.length) {
            controller.close();

            return;
          }
          log.push(`pull:${next}`);
          controller.enqueue(encoder.encode(`${ANTHROPIC_SSE[next]}\n`));
          next++;
        },
      },
      { highWaterMark: 0 },
    );

    const runner = createAnthropicRunner({
      apiKey: "k",
      fetch: vi.fn().mockResolvedValue(new Response(body, { status: 200 })),
    });

    await runner(mockAgent(), "Hi", {
      onToken: async (token) => {
        log.push(`token:${token}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
        log.push(`done:${token}`);
      },
    });

    // Every delta is fully consumed before the next chunk is pulled. Without
    // the await the three pulls would all precede the first `done:`.
    expect(log).toEqual([
      "pull:0",
      "pull:1",
      "token:Hello",
      "done:Hello",
      "pull:2",
      "token: world",
      "done: world",
      "pull:3",
    ]);
  });

  it("a slow consumer takes proportionally longer than a fast one", async () => {
    const deltas = Array.from(
      { length: 5 },
      (_, i) =>
        `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"t${i}"}}`,
    );
    const makeRunner = () =>
      createAnthropicRunner({
        apiKey: "k",
        fetch: vi.fn().mockImplementation(async () => streamResponse(deltas)),
      });

    const fastStart = Date.now();
    await makeRunner()(mockAgent(), "Hi", { onToken: () => {} });
    const fastMs = Date.now() - fastStart;

    const slowStart = Date.now();
    await makeRunner()(mockAgent(), "Hi", {
      onToken: () => new Promise((resolve) => setTimeout(resolve, 20)),
    });
    const slowMs = Date.now() - slowStart;

    expect(slowMs - fastMs).toBeGreaterThanOrEqual(80);
  });
});

// ============================================================================
// Parity with the buffered path
// ============================================================================

describe("parity when onToken is absent", () => {
  it("returns the same output, tokenUsage and hook calls either way", async () => {
    const buffered: unknown[] = [];
    const streamed: unknown[] = [];

    const bufferedRunner = createOpenAIRunner({
      apiKey: "k",
      fetch: vi.fn().mockResolvedValue(
        jsonResponse({
          choices: [{ message: { content: "Hello world" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      ),
      hooks: { onAfterCall: (event) => buffered.push(event.tokenUsage) },
    });
    const streamingRunner = createOpenAIRunner({
      apiKey: "k",
      fetch: vi.fn().mockImplementation(async () => streamResponse(OPENAI_SSE)),
      hooks: { onAfterCall: (event) => streamed.push(event.tokenUsage) },
    });

    const a = await bufferedRunner(mockAgent(), "Hi");
    const b = await streamingRunner(mockAgent(), "Hi", { onToken: () => {} });

    expect(b.output).toEqual(a.output);
    expect(b.messages).toEqual(a.messages);
    expect(b.toolCalls).toEqual(a.toolCalls);
    expect(b.totalTokens).toBe(a.totalTokens);
    expect(b.tokenUsage).toEqual(a.tokenUsage);
    expect(streamed).toEqual(buffered);
  });

  it("sends no stream flag at all when onToken is absent", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        content: [{ text: "Hi" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    const runner = createAnthropicRunner({ apiKey: "k", fetch: fetchFn });

    await runner(mockAgent(), "Hi");

    const body = JSON.parse(fetchFn.mock.calls[0]![1].body);
    expect("stream" in body).toBe(false);
  });

  it("fires onMessage with the complete assistant message on the streaming path", async () => {
    const runner = createOpenAIRunner({
      apiKey: "k",
      fetch: vi.fn().mockImplementation(async () => streamResponse(OPENAI_SSE)),
    });

    const messages: unknown[] = [];
    await runner(mockAgent(), "Hi", {
      onToken: () => {},
      onMessage: (message) => messages.push(message),
    });

    expect(messages).toEqual([{ role: "assistant", content: "Hello world" }]);
  });

  it("keeps Anthropic prompt-cache token fields on the streaming path", async () => {
    const cacheSSE = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"cache_read_input_tokens":100,"cache_creation_input_tokens":40}}}',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}',
      'data: {"type":"message_delta","usage":{"output_tokens":5}}',
    ];
    const runner = createAnthropicRunner({
      apiKey: "k",
      promptCaching: "automatic",
      fetch: vi.fn().mockImplementation(async () => streamResponse(cacheSSE)),
    });

    const result = await runner(mockAgent(), "Hi", { onToken: () => {} });

    expect(result.tokenUsage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 100,
      cacheCreationTokens: 40,
    });
    expect(result.totalTokens).toBe(155);
  });

  it("omits cache token fields when prompt caching is off, streaming or not", async () => {
    const runner = createAnthropicRunner({
      apiKey: "k",
      fetch: vi
        .fn()
        .mockImplementation(async () => streamResponse(ANTHROPIC_SSE)),
    });

    const result = await runner(mockAgent(), "Hi", { onToken: () => {} });

    expect(result.tokenUsage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });
});

// ============================================================================
// Per-provider wiring
// ============================================================================

describe("provider wiring", () => {
  it("Gemini switches to streamGenerateContent and keeps the same body", async () => {
    const geminiSSE = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}',
      'data: {"candidates":[{"content":{"parts":[{"text":" world"}]}}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5}}',
    ];
    const bufferedFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "Hello world" }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      }),
    );
    const streamFetch = vi
      .fn()
      .mockImplementation(async () => streamResponse(geminiSSE));

    await createGeminiRunner({ apiKey: "k", fetch: bufferedFetch })(
      mockAgent(),
      "Hi",
    );
    const tokens: string[] = [];
    const result = await createGeminiRunner({
      apiKey: "k",
      fetch: streamFetch,
    })(mockAgent(), "Hi", {
      onToken: (token) => {
        tokens.push(token);
      },
    });

    expect(bufferedFetch.mock.calls[0]![0]).toContain(":generateContent");
    expect(streamFetch.mock.calls[0]![0]).toContain(
      ":streamGenerateContent?alt=sse",
    );
    expect(streamFetch.mock.calls[0]![1].body).toBe(
      bufferedFetch.mock.calls[0]![1].body,
    );
    expect(tokens).toEqual(["Hello", " world"]);
    expect(result.output).toBe("Hello world");
  });

  it("Ollama streams newline-delimited JSON rather than server-sent events", async () => {
    const ndjson = [
      '{"message":{"content":"Hello"},"done":false}',
      '{"message":{"content":" world"},"done":false}',
      '{"done":true,"prompt_eval_count":10,"eval_count":5}',
    ];
    const fetchFn = vi
      .fn()
      .mockImplementation(async () => streamResponse(ndjson));

    const tokens: string[] = [];
    const result = await createOllamaRunner({ fetch: fetchFn })(
      mockAgent(),
      "Hi",
      {
        onToken: (token) => {
          tokens.push(token);
        },
      },
    );

    expect(JSON.parse(fetchFn.mock.calls[0]![1].body).stream).toBe(true);
    expect(tokens).toEqual(["Hello", " world"]);
    expect(result.output).toBe("Hello world");
    expect(result.tokenUsage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it("Ollama still sends stream:false when onToken is absent", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        message: { content: "Hi" },
        prompt_eval_count: 1,
        eval_count: 1,
      }),
    );

    await createOllamaRunner({ fetch: fetchFn })(mockAgent(), "Hi");

    expect(JSON.parse(fetchFn.mock.calls[0]![1].body).stream).toBe(false);
  });
});

// ============================================================================
// Tool-call gating on the streaming path
// ============================================================================

describe("tool-call gating while streaming", () => {
  /**
   * A runner that streams deltas and reports tool calls on the same options
   * object – the shape a tool-capable adapter takes. `onToolCall` is awaited,
   * so a rejecting gate stops the run.
   */
  function toolCallingRunner(toolCall: ToolCall): AgentRunner {
    return (async <T>(
      _agent: AgentLike,
      _input: string,
      options?: RunOptions,
    ): Promise<RunResult<T>> => {
      await options?.onToken?.("thinking");
      await options?.onToolCall?.(toolCall);
      await options?.onToken?.("...done");

      return {
        output: "done" as T,
        messages: [],
        toolCalls: [toolCall],
        totalTokens: 3,
        tokenUsage: { inputTokens: 2, outputTokens: 1 },
      };
    }) as AgentRunner;
  }

  /** A gate that refuses one named tool, the shape a guardrail takes. */
  function refuse(name: string) {
    return (toolCall: ToolCall): void => {
      if (toolCall.name === name) {
        throw new Error(`destructive tool blocked: ${toolCall.name}`);
      }
    };
  }

  const dangerousCall: ToolCall = {
    id: "t1",
    name: "delete_everything",
    arguments: "{}",
  };
  const safeCall: ToolCall = { id: "t2", name: "read_file", arguments: "{}" };

  function budgetedAndRetried(runner: AgentRunner): AgentRunner {
    return withBudget(withRetry(runner, { maxRetries: 0 }), {
      budgets: [{ window: "hour", maxCost: 100, pricing: FREE_PRICING }],
    });
  }

  it("a blocking gate still blocks when onToken is set", async () => {
    const runner = budgetedAndRetried(toolCallingRunner(dangerousCall));

    const tokens: string[] = [];
    await expect(
      runner(mockAgent(), "Hi", {
        onToken: (token) => {
          tokens.push(token);
        },
        onToolCall: refuse("delete_everything"),
      }),
    ).rejects.toThrow(/destructive tool blocked/);

    // Deltas flowed right up to the blocked call, and nothing after it.
    expect(tokens).toEqual(["thinking"]);
  });

  it("an allowed tool call proceeds and streaming continues past it", async () => {
    const runner = budgetedAndRetried(toolCallingRunner(safeCall));

    const tokens: string[] = [];
    const result = await runner(mockAgent(), "Hi", {
      onToken: (token) => {
        tokens.push(token);
      },
      onToolCall: refuse("delete_everything"),
    });

    expect(tokens).toEqual(["thinking", "...done"]);
    expect(result.output).toBe("done");
  });

  it("both callbacks reach the base runner through two wrappers", async () => {
    let seen: RunOptions | undefined;
    const spy: AgentRunner = (async <T>(
      _agent: AgentLike,
      _input: string,
      options?: RunOptions,
    ): Promise<RunResult<T>> => {
      seen = options;

      return {
        output: "ok" as T,
        messages: [],
        toolCalls: [],
        totalTokens: 1,
        tokenUsage: { inputTokens: 1, outputTokens: 0 },
      };
    }) as AgentRunner;

    await budgetedAndRetried(spy)(mockAgent(), "Hi", {
      onToken: () => {},
      onToolCall: () => {},
    });

    expect(typeof seen?.onToken).toBe("function");
    expect(typeof seen?.onToolCall).toBe("function");
  });
});

// ============================================================================
// Runners that do not support streaming
// ============================================================================

describe("runners without streaming support", () => {
  it("ignores onToken, returns a correct result, and does not hang", async () => {
    const plainRunner: AgentRunner = (async <T>() => ({
      output: "buffered" as T,
      messages: [],
      toolCalls: [],
      totalTokens: 7,
      tokenUsage: { inputTokens: 4, outputTokens: 3 },
    })) as AgentRunner;

    const tokens: string[] = [];
    const result = await withBudget(withRetry(plainRunner), {
      budgets: [{ window: "hour", maxCost: 1, pricing: FREE_PRICING }],
    })(mockAgent(), "Hi", {
      onToken: (token) => {
        tokens.push(token);
      },
    });

    expect(result.output).toBe("buffered");
    expect(result.totalTokens).toBe(7);
    expect(tokens).toEqual([]);
  });
});
