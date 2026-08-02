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
import { createRunner } from "../agent-utils.js";
import { BudgetExceededError, withBudget } from "../budget.js";
import { withFallback } from "../fallback.js";
import { withRetry } from "../retry.js";
import { withStructuredOutput } from "../structured-output.js";
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
  'data: {"type":"message_stop"}',
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
      "pull:4",
    ]);
  });

  it("a slow consumer takes proportionally longer than a fast one", async () => {
    const deltas = [
      ...Array.from(
        { length: 5 },
        (_, i) =>
          `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"t${i}"}}`,
      ),
      'data: {"type":"message_stop"}',
    ];
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
      'data: {"type":"message_stop"}',
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
      'data: {"candidates":[{"content":{"parts":[{"text":" world"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5}}',
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

// ============================================================================
// A provider that reports no usage is unpriceable, not free
// ============================================================================

describe("token accounting when the provider reports no usage", () => {
  /** What an OpenAI-compatible gateway that drops `include_usage` sends. */
  const NO_USAGE_SSE = [
    'data: {"choices":[{"delta":{"content":"Hello"}}]}',
    'data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}',
    "data: [DONE]",
  ];

  it("says the usage was not reported rather than reporting zero", async () => {
    const runner = createOpenAIRunner({
      apiKey: "k",
      fetch: vi
        .fn()
        .mockImplementation(async () => streamResponse(NO_USAGE_SSE)),
    });

    const result = await runner(mockAgent(), "Hi", { onToken: () => {} });

    expect(result.output).toBe("Hello world");
    expect(result.totalTokens).toBe(0);
    expect(result.usageReported).toBe(false);
  });

  it("reports usage as trustworthy when the provider does send it", async () => {
    const runner = createOpenAIRunner({
      apiKey: "k",
      fetch: vi.fn().mockImplementation(async () => streamResponse(OPENAI_SSE)),
    });

    const result = await runner(mockAgent(), "Hi", { onToken: () => {} });

    expect(result.usageReported).toBe(true);
  });

  it("says so on the buffered path too, when the body carries no usage", async () => {
    const runner = createOpenAIRunner({
      apiKey: "k",
      fetch: vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ choices: [{ message: { content: "Hello" } }] }),
        ),
    });

    const result = await runner(mockAgent(), "Hi");

    expect(result.usageReported).toBe(false);
  });

  it("charges the budget an estimate, so the window still trips", async () => {
    const fetchFn = vi
      .fn()
      .mockImplementation(async () => streamResponse(NO_USAGE_SSE));
    // $1 per token against a $5 ceiling. "Hi" is 1 input token, and the
    // response the call actually produced – "Hello world" – is 3 output
    // tokens, so the call is charged $4 rather than the $2 an input-scaled
    // guess would have made of it.
    const pricing = { inputPerMillion: 1_000_000, outputPerMillion: 1_000_000 };
    const wrapped = withBudget(
      createOpenAIRunner({ apiKey: "k", fetch: fetchFn }),
      { budgets: [{ window: "hour", maxCost: 5, pricing }] },
    );

    await wrapped(mockAgent(), "Hi", { onToken: () => {} });

    // Recorded spend accrues from the estimate rather than staying at $0
    // forever, and the caller can tell the figure is an estimate.
    expect(wrapped.getSpent("hour")).toBeCloseTo(4, 5);
    expect(wrapped.getUnpricedCallCount()).toBe(1);

    await expect(
      wrapped(mockAgent(), "Hi", { onToken: () => {} }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("counts nothing as unpriced when the provider reports usage", async () => {
    const wrapped = withBudget(
      createOpenAIRunner({
        apiKey: "k",
        fetch: vi
          .fn()
          .mockImplementation(async () => streamResponse(OPENAI_SSE)),
      }),
      { budgets: [{ window: "hour", maxCost: 100, pricing: FREE_PRICING }] },
    );

    await wrapped(mockAgent(), "Hi", { onToken: () => {} });

    expect(wrapped.getUnpricedCallCount()).toBe(0);
  });
});

// ============================================================================
// A stream that ends early ends with an error
// ============================================================================

describe("truncated streams", () => {
  it("fails when the body ends before the completion marker", async () => {
    const truncated = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Half an ans"}}',
    ];
    const runner = createAnthropicRunner({
      apiKey: "k",
      fetch: vi.fn().mockImplementation(async () => streamResponse(truncated)),
    });

    await expect(
      runner(mockAgent(), "Hi", { onToken: () => {} }),
    ).rejects.toThrow(/ended without a completion marker/);
  });

  it("accepts a stream that reaches its completion marker", async () => {
    const runner = createAnthropicRunner({
      apiKey: "k",
      fetch: vi
        .fn()
        .mockImplementation(async () => streamResponse(ANTHROPIC_SSE)),
    });

    await expect(
      runner(mockAgent(), "Hi", { onToken: () => {} }),
    ).resolves.toMatchObject({ output: "Hello world" });
  });

  it("reads a final event that arrives with no trailing newline", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`${ANTHROPIC_SSE.join("\n")}\n`));
        // No newline after the last event, which servers are not obliged to
        // send – and which now decides whether the run reads as complete.
        controller.enqueue(encoder.encode('data: {"type":"message_stop"}'));
        controller.close();
      },
    });
    const runner = createAnthropicRunner({
      apiKey: "k",
      fetch: vi.fn().mockResolvedValue(new Response(body, { status: 200 })),
    });

    await expect(
      runner(mockAgent(), "Hi", { onToken: () => {} }),
    ).resolves.toMatchObject({ output: "Hello world" });
  });

  it("leaves a hand-written runner that cannot report the marker alone", async () => {
    const runner = createRunner({
      fetch: vi
        .fn()
        .mockImplementation(async () =>
          streamResponse(['data: {"text":"Hi"}']),
        ),
      buildRequest: () => ({ url: "https://example.test/v1", init: {} }),
      parseResponse: async () => ({ text: "", totalTokens: 0 }),
      streaming: {
        adapterName: "Custom",
        parseEvent: (event) => ({ text: event.text as string }),
      },
    });

    await expect(
      runner(mockAgent(), "Hi", { onToken: () => {} }),
    ).resolves.toMatchObject({ output: "Hi" });
  });
});

// ============================================================================
// Cancellation cuts through an awaited consumer callback
// ============================================================================

describe("abort with a consumer that never settles", () => {
  it("settles the run and stops reading rather than parking forever", async () => {
    const controller = new AbortController();
    let cancelled = false;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        for (const line of ANTHROPIC_SSE) {
          streamController.enqueue(encoder.encode(`${line}\n`));
        }
      },
      cancel() {
        cancelled = true;
      },
    });
    const runner = createAnthropicRunner({
      apiKey: "k",
      fetch: vi.fn().mockResolvedValue(new Response(body, { status: 200 })),
    });

    const run = runner(mockAgent(), "Hi", {
      signal: controller.signal,
      // The shape an adversarial output can produce in a per-delta sink: a
      // promise that never settles. Awaited outside a race with the abort
      // signal it holds the reader, the fetch and the run open forever.
      onToken: () => new Promise<void>(() => {}),
    });
    const settled = expect(run).rejects.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();

    await settled;
    expect(cancelled).toBe(true);
  });
});

// ============================================================================
// Every wrapper that re-invokes the runner says so
// ============================================================================

describe("restart signalling across wrappers", () => {
  /** Fails `failures` times with a retryable error, then succeeds. */
  function flakyRunner(failures: number): AgentRunner {
    let call = 0;

    return (async <T>(
      _agent: AgentLike,
      _input: string,
      options?: RunOptions,
    ): Promise<RunResult<T>> => {
      call++;
      if (call <= failures) {
        throw new Error("[Directive] request failed: 503");
      }
      await options?.onToken?.("done");

      return {
        output: '{"ok":true}' as T,
        messages: [],
        toolCalls: [],
        totalTokens: 1,
        tokenUsage: { inputTokens: 1, outputTokens: 0 },
      };
    }) as AgentRunner;
  }

  it("withRetry reports every retry", async () => {
    const restarts: string[] = [];

    await withRetry(flakyRunner(2), { maxRetries: 3, baseDelayMs: 0 })(
      mockAgent(),
      "Hi",
      {
        onToken: () => {},
        onStreamRestart: (reason) => restarts.push(reason),
      },
    );

    expect(restarts).toEqual(["retry", "retry"]);
  });

  it("withFallback reports the move to the next provider", async () => {
    const restarts: string[] = [];
    const failing: AgentRunner = (async () => {
      throw new Error("provider down");
    }) as AgentRunner;

    await withFallback([failing, flakyRunner(0)])(mockAgent(), "Hi", {
      onToken: () => {},
      onStreamRestart: (reason) => restarts.push(reason),
    });

    expect(restarts).toEqual(["reroute"]);
  });

  it("withStructuredOutput reports every schema retry", async () => {
    const restarts: string[] = [];
    let call = 0;
    const badThenGood: AgentRunner = (async <T>() => {
      call++;

      return {
        output: (call === 1 ? "not json" : '{"ok":true}') as T,
        messages: [],
        toolCalls: [],
        totalTokens: 1,
      };
    }) as AgentRunner;

    await withStructuredOutput(badThenGood, {
      schema: {
        safeParse: (value: unknown) => ({ success: true, data: value }),
      } as never,
      maxRetries: 2,
    })(mockAgent(), "Hi", {
      onToken: () => {},
      onStreamRestart: (reason) => restarts.push(reason),
    });

    expect(restarts).toEqual(["schema-retry"]);
  });

  it("reaches the base runner through a stack of wrappers", async () => {
    const restarts: string[] = [];

    await withBudget(
      withFallback([
        withRetry(flakyRunner(1), { maxRetries: 1, baseDelayMs: 0 }),
      ]),
      { budgets: [{ window: "hour", maxCost: 10, pricing: FREE_PRICING }] },
    )(mockAgent(), "Hi", {
      onToken: () => {},
      onStreamRestart: (reason) => restarts.push(reason),
    });

    expect(restarts).toEqual(["retry"]);
  });
});

// ============================================================================
// A consumer that throws is not a provider failure
// ============================================================================

describe("a throwing consumer callback", () => {
  function countingRunner(counter: { calls: number }): AgentRunner {
    return (async <T>(
      _agent: AgentLike,
      _input: string,
      options?: RunOptions,
    ): Promise<RunResult<T>> => {
      counter.calls++;
      await options?.onToken?.("delta");

      return {
        output: "ok" as T,
        messages: [],
        toolCalls: [],
        totalTokens: 1,
      };
    }) as AgentRunner;
  }

  it("is not retried", async () => {
    const counter = { calls: 0 };
    const wrapped = withRetry(
      createAnthropicRunner({
        apiKey: "k",
        fetch: vi
          .fn()
          .mockImplementation(async () => streamResponse(ANTHROPIC_SSE)),
      }),
      { maxRetries: 2, baseDelayMs: 0 },
    );

    await expect(
      wrapped(mockAgent(), "Hi", {
        onToken: () => {
          counter.calls++;

          throw new Error("render crashed");
        },
      }),
    ).rejects.toThrow(/render crashed/);

    // One invocation, not three: the provider did nothing wrong.
    expect(counter.calls).toBe(1);
  });

  it("does not fall through to the next provider", async () => {
    const second = { calls: 0 };
    const first = createAnthropicRunner({
      apiKey: "k",
      fetch: vi
        .fn()
        .mockImplementation(async () => streamResponse(ANTHROPIC_SSE)),
    });

    await expect(
      withFallback([first, countingRunner(second)])(mockAgent(), "Hi", {
        onToken: () => {
          throw new Error("render crashed");
        },
      }),
    ).rejects.toThrow(/render crashed/);

    expect(second.calls).toBe(0);
  });

  it("still retries a real provider failure", async () => {
    let attempt = 0;
    const fetchFn = vi.fn().mockImplementation(async () => {
      attempt++;
      if (attempt === 1) {
        return new Response("boom", { status: 503, statusText: "Error" });
      }

      return streamResponse(ANTHROPIC_SSE);
    });

    await withRetry(createAnthropicRunner({ apiKey: "k", fetch: fetchFn }), {
      maxRetries: 2,
      baseDelayMs: 0,
    })(mockAgent(), "Hi", { onToken: () => {} });

    expect(attempt).toBe(2);
  });
});

// ============================================================================
// Usage that is present but says nothing
// ============================================================================

describe("a usage object holding no usable count", () => {
  const NULLED_USAGE_SSE = [
    'data: {"choices":[{"delta":{"content":"Hello world"}}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
    'data: {"usage":{"prompt_tokens":null,"completion_tokens":null}}',
    "data: [DONE]",
  ];

  it("is not a report of zero — OpenAI, streamed", async () => {
    const runner = createOpenAIRunner({
      apiKey: "k",
      fetch: vi
        .fn()
        .mockImplementation(async () => streamResponse(NULLED_USAGE_SSE)),
    });

    const result = await runner(mockAgent(), "Hi", { onToken: () => {} });

    expect(result.usageReported).toBe(false);
  });

  it("is not a report of zero — OpenAI, buffered", async () => {
    const runner = createOpenAIRunner({
      apiKey: "k",
      fetch: vi.fn().mockResolvedValue(
        jsonResponse({
          choices: [{ message: { content: "Hello" } }],
          usage: { prompt_tokens: null, completion_tokens: null },
        }),
      ),
    });

    const result = await runner(mockAgent(), "Hi");

    expect(result.usageReported).toBe(false);
  });

  it("is not a report of zero — Anthropic, buffered", async () => {
    const runner = createAnthropicRunner({
      apiKey: "k",
      fetch: vi.fn().mockResolvedValue(
        jsonResponse({
          content: [{ text: "Hello" }],
          usage: { input_tokens: null, output_tokens: null },
        }),
      ),
    });

    const result = await runner(mockAgent(), "Hi");

    expect(result.usageReported).toBe(false);
  });

  it("is not a report of zero — Gemini, buffered", async () => {
    const runner = createGeminiRunner({
      apiKey: "k",
      fetch: vi.fn().mockResolvedValue(
        jsonResponse({
          candidates: [{ content: { parts: [{ text: "Hello" }] } }],
          usageMetadata: {
            promptTokenCount: null,
            candidatesTokenCount: null,
          },
        }),
      ),
    });

    const result = await runner(mockAgent(), "Hi");

    expect(result.usageReported).toBe(false);
  });

  it("is not a report of zero — Ollama, buffered", async () => {
    const runner = createOllamaRunner({
      fetch: vi.fn().mockResolvedValue(
        jsonResponse({
          message: { content: "Hello" },
          prompt_eval_count: null,
          eval_count: null,
        }),
      ),
    });

    const result = await runner(mockAgent(), "Hi");

    expect(result.usageReported).toBe(false);
  });

  it("still reports usage when only one of the two counts arrives", async () => {
    const runner = createOpenAIRunner({
      apiKey: "k",
      fetch: vi.fn().mockResolvedValue(
        jsonResponse({
          choices: [{ message: { content: "Hello" } }],
          usage: { prompt_tokens: 10, completion_tokens: null },
        }),
      ),
    });

    const result = await runner(mockAgent(), "Hi");

    expect(result.usageReported).toBe(true);
    expect(result.tokenUsage?.inputTokens).toBe(10);
  });

  it("costs money against a budget rather than nothing", async () => {
    const pricing = { inputPerMillion: 1_000_000, outputPerMillion: 1_000_000 };
    const wrapped = withBudget(
      createOpenAIRunner({
        apiKey: "k",
        fetch: vi
          .fn()
          .mockImplementation(async () => streamResponse(NULLED_USAGE_SSE)),
      }),
      { budgets: [{ window: "hour", maxCost: 100, pricing }] },
    );

    await wrapped(mockAgent(), "Hi", { onToken: () => {} });

    expect(wrapped.getSpent("hour")).toBeGreaterThan(0);
    expect(wrapped.getUnpricedCallCount()).toBe(1);
  });
});

// ============================================================================
// The end-of-response marker ends the response
// ============================================================================

describe("content after the end-of-response marker", () => {
  it("does not resolve a truncated body as a complete one", async () => {
    // `[DONE]` first, then a body that was cut short behind it.
    const runner = createOpenAIRunner({
      apiKey: "k",
      fetch: vi
        .fn()
        .mockImplementation(async () =>
          streamResponse([
            "data: [DONE]",
            'data: {"choices":[{"delta":{"content":"Hello"}}]}',
            'data: {"choices":[{"delta":{"content":" wor',
          ]),
        ),
    });

    const seen: string[] = [];
    const result = await runner(mockAgent(), "Hi", {
      onToken: (token) => {
        seen.push(token);
      },
    });

    // Nothing past the sentinel reaches the consumer or the result.
    expect(seen).toEqual([]);
    expect(result.output).toBe("");
  });

  it("stops reading at the sentinel rather than draining the body", async () => {
    let pulled = 0;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        if (pulled === 1) {
          controller.enqueue(encoder.encode("data: [DONE]\n"));

          return;
        }
        if (pulled > 50) {
          controller.close();

          return;
        }
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"x"}}]}\n'),
        );
      },
    });
    const runner = createOpenAIRunner({
      apiKey: "k",
      fetch: vi.fn().mockResolvedValue(new Response(body, { status: 200 })),
    });

    await runner(mockAgent(), "Hi", { onToken: () => {} });

    // A read or two – whatever the stream prefetched – not fifty. Before,
    // the loop drained the whole body after the sentinel had already ended
    // the response.
    expect(pulled).toBeLessThanOrEqual(3);
  });

  it("discards a second generation joined onto the first", async () => {
    const runner = createAnthropicRunner({
      apiKey: "k",
      fetch: vi
        .fn()
        .mockImplementation(async () =>
          streamResponse([
            'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"first"}}',
            'data: {"type":"message_stop"}',
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"second"}}',
          ]),
        ),
    });

    const seen: string[] = [];
    const result = await runner(mockAgent(), "Hi", {
      onToken: (token) => {
        seen.push(token);
      },
    });

    expect(seen).toEqual(["first"]);
    expect(result.output).toBe("first");
  });

  it("still reads the usage frame OpenAI sends after finish_reason", async () => {
    const runner = createOpenAIRunner({
      apiKey: "k",
      fetch: vi
        .fn()
        .mockImplementation(async () =>
          streamResponse([
            'data: {"choices":[{"delta":{"content":"Hello"}}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
            'data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}',
            "data: [DONE]",
          ]),
        ),
    });

    const result = await runner(mockAgent(), "Hi", { onToken: () => {} });

    expect(result.usageReported).toBe(true);
    expect(result.totalTokens).toBe(15);
  });
});

// ============================================================================
// A budget wrapped around retry and fallback
// ============================================================================

describe("withBudget over a retrying, falling-back stack", () => {
  /** A gateway that strips the completion marker from every response. */
  function markerStrippingFetch(): typeof globalThis.fetch {
    return vi
      .fn()
      .mockImplementation(async () =>
        streamResponse([
          'data: {"choices":[{"delta":{"content":"Hello world"}}]}',
        ]),
      ) as unknown as typeof globalThis.fetch;
  }

  it("charges every request the wrappers made on its behalf", async () => {
    const fetchFn = markerStrippingFetch();
    const primary = createOpenAIRunner({ apiKey: "k", fetch: fetchFn });
    const secondary = createOpenAIRunner({ apiKey: "k2", fetch: fetchFn });
    const pricing = { inputPerMillion: 1_000_000, outputPerMillion: 1_000_000 };

    const wrapped = withBudget(
      withFallback([
        withRetry(primary, { maxRetries: 2, baseDelayMs: 0 }),
        withRetry(secondary, { maxRetries: 2, baseDelayMs: 0 }),
      ]),
      { budgets: [{ window: "hour", maxCost: 1_000_000, pricing }] },
    );

    await expect(
      wrapped(mockAgent(), "Hi", { onToken: () => {} }),
    ).rejects.toThrow();

    const httpCalls = (fetchFn as unknown as { mock: { calls: unknown[] } })
      .mock.calls.length;
    // Six requests reached the provider and six responses were billed.
    expect(httpCalls).toBe(6);
    // The budget knows about all of them, not one, and not none.
    expect(wrapped.getUnpricedCallCount()).toBe(httpCalls);
    expect(wrapped.getSpent("hour")).toBeGreaterThan(0);
  });

  it("counts the failed attempts behind a call that eventually succeeded", async () => {
    let attempt = 0;
    const fetchFn = vi.fn().mockImplementation(async () => {
      attempt++;
      if (attempt < 3) {
        return streamResponse([
          'data: {"choices":[{"delta":{"content":"partial"}}]}',
        ]);
      }

      return streamResponse(OPENAI_SSE);
    });
    const pricing = { inputPerMillion: 1_000_000, outputPerMillion: 1_000_000 };

    const wrapped = withBudget(
      withRetry(createOpenAIRunner({ apiKey: "k", fetch: fetchFn }), {
        maxRetries: 3,
        baseDelayMs: 0,
      }),
      { budgets: [{ window: "hour", maxCost: 1_000_000, pricing }] },
    );

    const result = await wrapped(mockAgent(), "Hi", { onToken: () => {} });

    expect(result.usageReported).toBe(true);
    // The two responses thrown away were generated and billed all the same.
    expect(wrapped.getUnpricedCallCount()).toBe(2);
  });

  it("leaves a single successful call counted exactly as before", async () => {
    const pricing = { inputPerMillion: 1_000_000, outputPerMillion: 1_000_000 };
    const wrapped = withBudget(
      withRetry(
        createOpenAIRunner({
          apiKey: "k",
          fetch: vi
            .fn()
            .mockImplementation(async () => streamResponse(OPENAI_SSE)),
        }),
        { maxRetries: 3, baseDelayMs: 0 },
      ),
      { budgets: [{ window: "hour", maxCost: 1_000_000, pricing }] },
    );

    await wrapped(mockAgent(), "Hi", { onToken: () => {} });

    expect(wrapped.getUnpricedCallCount()).toBe(0);
    // 10 in + 5 out, from the counts the provider reported.
    expect(wrapped.getSpent("hour")).toBeCloseTo(15, 5);
  });

  it("still forwards the caller's own restart signal", async () => {
    const seen: string[] = [];
    const wrapped = withBudget(
      withRetry(
        createOpenAIRunner({ apiKey: "k", fetch: markerStrippingFetch() }),
        { maxRetries: 1, baseDelayMs: 0 },
      ),
      {},
    );

    await expect(
      wrapped(mockAgent(), "Hi", {
        onToken: () => {},
        onStreamRestart: (reason) => {
          seen.push(reason);
        },
      }),
    ).rejects.toThrow();

    expect(seen).toEqual(["retry"]);
  });
});
