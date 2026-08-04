/**
 * What the adapters do against bodies real servers actually write.
 *
 * The shapes here are not hypothetical. Each one is a conformant server, a
 * documented provider frame, or a documented HTTP header that the parser used
 * to answer wrongly — mostly by reporting a healthy stream as truncated, or by
 * reporting a truncated one as healthy, and in three cases by billing the run
 * at a fraction of what the provider charged.
 */

import { describe, expect, it, vi } from "vitest";
import { createAnthropicRunner } from "../adapters/anthropic.js";
import { createAnthropicStreamingRunner } from "../adapters/anthropic.js";
import { createGeminiStreamingRunner } from "../adapters/gemini.js";
import { createOllamaStreamingRunner } from "../adapters/ollama.js";
import { createOpenAIStreamingRunner } from "../adapters/openai.js";
import { createRunner } from "../agent-utils.js";
import { withBudget } from "../budget.js";
import { attachReportedUsage, readReportedUsage } from "../pricing.js";
import { RetryExhaustedError, parseRetryAfter, withRetry } from "../retry.js";
import type { AgentLike } from "../types.js";

// ============================================================================
// Helpers
// ============================================================================

function mockAgent(): AgentLike {
  return { name: "test-agent", instructions: "You are helpful." };
}

/** A finished body, written exactly as given – separators included. */
function rawResponse(body: string, headers?: Record<string, string>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: headers ?? { "Content-Type": "text/event-stream" },
  });
}

const fetchOf = (body: string, headers?: Record<string, string>) =>
  vi.fn(async () => rawResponse(body, headers)) as unknown as typeof fetch;

/**
 * A body that emits `frame` on an interval and never ends, and – the point of
 * it – **ignores the abort signal completely**.
 *
 * Every adapter takes an injected `fetch`. A wrapper that tees the body for
 * logging, replays it from a recording, or hands back a fresh `Response` is
 * under no obligation to error it when the signal fires, and this is what such
 * a body looks like from the reader's side.
 */
function unstoppableStream(frame: string, gapMs: number): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          if (frame !== "") {
            controller.enqueue(encoder.encode(frame));
          }
          resolve();
        }, gapMs);
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

const unstoppableFetch = (frame: string, gapMs: number) =>
  vi.fn(async () => unstoppableStream(frame, gapMs)) as unknown as typeof fetch;

const ANTHROPIC_BODY = [
  '{"type":"message_start","message":{"usage":{"input_tokens":9}}}',
  '{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
  '{"type":"message_delta","usage":{"output_tokens":4}}',
  '{"type":"message_stop"}',
];

// ============================================================================
// The `data` field
// ============================================================================

describe("the space after `data:` is optional", () => {
  it("reads an Anthropic body written without it", async () => {
    const body = `${ANTHROPIC_BODY.map((event) => `data:${event}`).join("\n\n")}\n\n`;
    const runner = createAnthropicStreamingRunner({
      apiKey: "k",
      fetch: fetchOf(body),
    });

    const result = await runner(mockAgent(), "Hi", {});

    expect(result.output).toBe("Hello");
    expect(result.tokenUsage).toMatchObject({
      inputTokens: 9,
      outputTokens: 4,
    });
  });

  it("reads an OpenAI body written without it, sentinel included", async () => {
    const body =
      'data:{"choices":[{"delta":{"content":"Hi"},"finish_reason":"stop"}]}\n\n' +
      'data:{"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2}}\n\n' +
      "data:[DONE]\n\n";
    const runner = createOpenAIStreamingRunner({
      apiKey: "k",
      fetch: fetchOf(body),
    });

    const result = await runner(mockAgent(), "Hi", {});

    expect(result.output).toBe("Hi");
    expect(result.usageReported).toBe(true);
    expect(result.tokenUsage).toMatchObject({
      inputTokens: 7,
      outputTokens: 2,
    });
  });

  it("strips exactly one space, leaving the rest of the payload alone", async () => {
    // A payload whose JSON legitimately begins with whitespace: only the first
    // space belongs to the framing.
    const body =
      'data:  {"type":"message_start","message":{"usage":{"input_tokens":3}}}\n\n' +
      'data: {"type":"message_stop"}\n\n';
    const runner = createAnthropicStreamingRunner({
      apiKey: "k",
      fetch: fetchOf(body),
    });

    const result = await runner(mockAgent(), "Hi", {});

    expect(result.tokenUsage?.inputTokens).toBe(3);
  });
});

describe("lines end at CR as well as LF", () => {
  it("reads a body terminated with bare CR", async () => {
    const body = `${ANTHROPIC_BODY.map((event) => `data: ${event}`).join("\r\r")}\r\r`;
    const runner = createAnthropicStreamingRunner({
      apiKey: "k",
      fetch: fetchOf(body),
    });

    const result = await runner(mockAgent(), "Hi", {});

    expect(result.output).toBe("Hello");
    expect(result.tokenUsage?.inputTokens).toBe(9);
  });

  it("reads a body terminated with CRLF", async () => {
    const body = `${ANTHROPIC_BODY.map((event) => `data: ${event}`).join("\r\n\r\n")}\r\n\r\n`;
    const runner = createAnthropicStreamingRunner({
      apiKey: "k",
      fetch: fetchOf(body),
    });

    const result = await runner(mockAgent(), "Hi", {});

    expect(result.output).toBe("Hello");
  });

  it("does not split a CRLF that arrives across two chunks", async () => {
    const encoder = new TextEncoder();
    const whole = `${ANTHROPIC_BODY.map((event) => `data: ${event}`).join("\r\n\r\n")}\r\n\r\n`;
    // Cut the body between the CR and the LF of a terminator. Treating the
    // dangling CR as a line end would emit one blank line too many, which in a
    // format where the blank line closes an event splits an event in half.
    const cut = whole.indexOf("\r\n") + 1;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(whole.slice(0, cut)));
        controller.enqueue(encoder.encode(whole.slice(cut)));
        controller.close();
      },
    });
    const runner = createAnthropicStreamingRunner({
      apiKey: "k",
      fetch: vi.fn(
        async () => new Response(stream, { status: 200 }),
      ) as unknown as typeof fetch,
    });

    const result = await runner(mockAgent(), "Hi", {});

    expect(result.output).toBe("Hello");
    expect(result.tokenUsage?.inputTokens).toBe(9);
  });
});

describe("an event's `data` lines are one payload", () => {
  it("joins a message_start split across two data lines", async () => {
    // A server is free to break a payload at any newline it likes, and the
    // opening frame is where the input token count lives – so losing this
    // event does not fail the run, it bills it at zero.
    const body =
      'data: {"type":"message_start","message":{"usage":\n' +
      'data: {"input_tokens":4000}}}\n' +
      "\n" +
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n' +
      'data: {"type":"message_stop"}\n\n';
    const runner = createAnthropicStreamingRunner({
      apiKey: "k",
      fetch: fetchOf(body),
    });

    const result = await runner(mockAgent(), "Hi", {});

    expect(result.output).toBe("Hi");
    expect(result.tokenUsage?.inputTokens).toBe(4000);
    expect(result.usageReported).toBe(true);
  });

  it("treats a `:` comment as a comment and not as an event", async () => {
    const body = `: keep-alive\n\n${ANTHROPIC_BODY.map((event) => `data: ${event}`).join("\n\n")}\n\n`;
    const runner = createAnthropicStreamingRunner({
      apiKey: "k",
      fetch: fetchOf(body),
    });

    await expect(runner(mockAgent(), "Hi", {})).resolves.toMatchObject({
      output: "Hello",
    });
  });

  it("ignores `event:` and `id:` fields around the data", async () => {
    const body =
      `event: message_start\nid: 1\ndata: ${ANTHROPIC_BODY[0]}\n\n` +
      `event: content_block_delta\ndata: ${ANTHROPIC_BODY[1]}\n\n` +
      `data: ${ANTHROPIC_BODY[3]}\n\n`;
    const runner = createAnthropicStreamingRunner({
      apiKey: "k",
      fetch: fetchOf(body),
    });

    await expect(runner(mockAgent(), "Hi", {})).resolves.toMatchObject({
      output: "Hello",
    });
  });
});

// ============================================================================
// The two clocks
// ============================================================================

describe("a keep-alive says the connection is up", () => {
  it("does not abandon a stream that is sending comment keep-alives", async () => {
    const runner = createAnthropicStreamingRunner({
      apiKey: "k",
      fetch: unstoppableFetch(": keep-alive\n\n", 30),
      timeoutMs: 200,
      contentTimeoutMs: 900,
    });

    // The stall clock is what ends it, ~900ms in – not the silence clock at
    // 200ms, which every comment restarts.
    const started = Date.now();
    await expect(runner(mockAgent(), "Hi", {})).rejects.toMatchObject({
      name: "TimeoutError",
    });
    expect(Date.now() - started).toBeGreaterThan(500);
  });

  it("abandons a stream that only ever pings", async () => {
    const runner = createAnthropicStreamingRunner({
      apiKey: "k",
      fetch: unstoppableFetch('data: {"type":"ping"}\n\n', 30),
      timeoutMs: 10_000,
      contentTimeoutMs: 300,
    });

    // A ping means the socket is open. It does not mean the model is
    // producing, and a clock a ping restarts can be held off forever by the
    // exact failure it exists to catch.
    await expect(runner(mockAgent(), "Hi", {})).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("says which clock ran out", async () => {
    const runner = createAnthropicStreamingRunner({
      apiKey: "k",
      fetch: unstoppableFetch('data: {"type":"ping"}\n\n', 30),
      timeoutMs: 10_000,
      contentTimeoutMs: 300,
    });

    await expect(runner(mockAgent(), "Hi", {})).rejects.toThrow(
      /produced nothing for 300ms/,
    );
  });
});

describe("the deadline enforces itself", () => {
  it("ends a stalled stream whose body ignores the signal", async () => {
    const runner = createAnthropicStreamingRunner({
      apiKey: "k",
      // Never enqueues, never rejects, never notices the abort. Only a race
      // inside the reader can end this.
      fetch: unstoppableFetch("", 60_000),
      timeoutMs: 200,
    });

    await expect(runner(mockAgent(), "Hi", {})).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("ends a run cancelled by the caller against the same body", async () => {
    const controller = new AbortController();
    const runner = createAnthropicStreamingRunner({
      apiKey: "k",
      fetch: unstoppableFetch("", 60_000),
      timeoutMs: 60_000,
    });

    const call = runner(mockAgent(), "Hi", { signal: controller.signal });
    setTimeout(() => controller.abort(), 30);

    await expect(call).rejects.toThrow();
  });
});

describe("a slow consumer is not a stalled provider", () => {
  it("does not charge the consumer's own time to the deadline", async () => {
    const body = `${ANTHROPIC_BODY.map((event) => `data: ${event}`).join("\n\n")}\n\n`;
    const runner = createAnthropicStreamingRunner({
      apiKey: "k",
      fetch: fetchOf(body),
      timeoutMs: 150,
    });

    // The callback takes far longer than the deadline. Backpressure and the
    // deadline used to cancel each other out here, and the error blamed the
    // provider for time the consumer spent.
    const result = await runner(mockAgent(), "Hi", {
      onToken: async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
      },
    });

    expect(result.output).toBe("Hello");
  });
});

describe("every streaming runner has a deadline", () => {
  const stalled = () => unstoppableFetch("", 60_000);

  it("OpenAI", async () => {
    const runner = createOpenAIStreamingRunner({
      apiKey: "k",
      fetch: stalled(),
      timeoutMs: 150,
    });

    await expect(runner(mockAgent(), "Hi", {})).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("Gemini", async () => {
    const runner = createGeminiStreamingRunner({
      apiKey: "k",
      fetch: stalled(),
      timeoutMs: 150,
    });

    await expect(runner(mockAgent(), "Hi", {})).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("Ollama", async () => {
    const runner = createOllamaStreamingRunner({
      fetch: stalled(),
      timeoutMs: 150,
    });

    await expect(runner(mockAgent(), "Hi", {})).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("createRunner's streaming path — the one the harness takes", async () => {
    const runner = createRunner({
      fetch: stalled(),
      buildRequest: () => ({ url: "https://example.test/v1", init: {} }),
      parseResponse: async () => ({ text: "", totalTokens: 0 }),
      streaming: {
        adapterName: "Test",
        parseEvent: () => ({}),
        requireTerminalEvent: true,
        idleTimeoutMs: 150,
      },
    });

    await expect(
      runner(mockAgent(), "Hi", { onToken: () => {} }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });
});

// ============================================================================
// Money
// ============================================================================

describe("the two Anthropic paths bill the same body the same way", () => {
  const CACHED = [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":1,"cache_read_input_tokens":9300}}}',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}',
    'data: {"type":"message_delta","usage":{"output_tokens":9}}',
    'data: {"type":"message_stop"}',
  ].join("\n\n");

  it("agrees on totalTokens for a fully cached prompt", async () => {
    const viaCreateRunner = createAnthropicRunner({
      apiKey: "k",
      promptCaching: "automatic",
      fetch: fetchOf(`${CACHED}\n\n`),
    });
    const viaStreamingRunner = createAnthropicStreamingRunner({
      apiKey: "k",
      promptCaching: "automatic",
      fetch: fetchOf(`${CACHED}\n\n`),
    });

    const buffered = await viaCreateRunner(mockAgent(), "Hi", {
      onToken: () => {},
    });
    const streamed = await viaStreamingRunner(mockAgent(), "Hi", {});

    expect(streamed.totalTokens).toBe(buffered.totalTokens);
    expect(streamed.totalTokens).toBe(9319);
    expect(streamed.tokenUsage).toMatchObject({ cacheReadTokens: 9300 });
  });

  it("keeps a cache count the provider sent even with caching off", async () => {
    // Nothing asked for caching, so something in front of the model did it.
    // The provider billed those tokens either way.
    const runner = createAnthropicStreamingRunner({
      apiKey: "k",
      fetch: fetchOf(`${CACHED}\n\n`),
    });

    const result = await runner(mockAgent(), "Hi", {});

    expect(result.tokenUsage?.cacheReadTokens).toBe(9300);
  });

  it("still omits the zeros the live API sends on an uncached call", async () => {
    const uncached = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}',
      'data: {"type":"message_stop"}',
    ].join("\n\n");
    const runner = createAnthropicStreamingRunner({
      apiKey: "k",
      fetch: fetchOf(`${uncached}\n\n`),
    });

    const result = await runner(mockAgent(), "Hi", {});

    expect(result.tokenUsage).not.toHaveProperty("cacheReadTokens");
    expect(result.tokenUsage).not.toHaveProperty("cacheCreationTokens");
  });
});

describe("what a failed call reported survives being wrapped", () => {
  it("is found through a RetryExhaustedError", () => {
    const inner = attachReportedUsage(new Error("boom"), {
      inputTokens: 1200,
      outputTokens: 0,
    });

    const wrapped = new RetryExhaustedError(3, inner as Error);

    expect(readReportedUsage(wrapped)).toEqual({
      inputTokens: 1200,
      outputTokens: 0,
    });
  });

  it("is found through two layers of wrapping", () => {
    const inner = attachReportedUsage(new Error("boom"), {
      inputTokens: 5,
      outputTokens: 0,
    });
    const once = new RetryExhaustedError(1, inner as Error);
    const twice = new Error("fallback exhausted", { cause: once });

    expect(readReportedUsage(twice)).toEqual({
      inputTokens: 5,
      outputTokens: 0,
    });
  });

  it("stops rather than looping on an error that causes itself", () => {
    const self = new Error("loop");
    (self as Error & { cause?: unknown }).cause = self;

    expect(readReportedUsage(self)).toBeUndefined();
  });

  it("charges a budget for a stream billed on its prompt and then abandoned", async () => {
    // Anthropic reports the input count in the opening frame, before a single
    // token of the answer exists. A call that dies after it has been billed in
    // full on the prompt, and on a long transcript that is most of the bill.
    const encoder = new TextEncoder();
    const failing = vi.fn(async () => {
      let sent = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(
              encoder.encode(
                'data: {"type":"message_start","message":{"usage":{"input_tokens":1000}}}\n\n',
              ),
            );

            return;
          }
          controller.error(new Error("connection reset"));
        },
      });

      return new Response(stream, { status: 200 });
    }) as unknown as typeof fetch;

    const guarded = withBudget(
      withRetry(createAnthropicRunner({ apiKey: "k", fetch: failing }), {
        maxRetries: 0,
      }),
      {
        budgets: [
          {
            window: "hour",
            maxCost: 1_000_000,
            // $1 per input token, so 1000 reported tokens is $1000 and an
            // estimate from a two-character prompt is a fraction of a dollar.
            pricing: { inputPerMillion: 1_000_000, outputPerMillion: 0 },
          },
        ],
      },
    );

    await expect(
      guarded(mockAgent(), "Hi", { onToken: () => {} }),
    ).rejects.toThrow();

    expect(guarded.getSpent("hour")).toBeCloseTo(1000, 5);
  });
});

describe("Retry-After is carried out of the response", () => {
  it("puts the status and the interval on the thrown error", async () => {
    const response = new Response("rate limited", {
      status: 429,
      statusText: "Too Many Requests",
      headers: {
        "Retry-After": "20",
        "anthropic-ratelimit-requests-remaining": "0",
      },
    });
    const runner = createAnthropicStreamingRunner({
      apiKey: "k",
      fetch: vi.fn(async () => response) as unknown as typeof fetch,
    });

    const error = await runner(mockAgent(), "Hi", {}).catch(
      (err: unknown) => err,
    );

    expect(error).toMatchObject({
      status: 429,
      retryAfter: 20,
      retryAfterMs: 20_000,
    });
    expect(
      (error as { headers: Record<string, string> }).headers,
    ).toMatchObject({
      "retry-after": "20",
      "anthropic-ratelimit-requests-remaining": "0",
    });
  });

  it("is what withRetry reads, rather than its own backoff curve", async () => {
    const runner = createAnthropicStreamingRunner({
      apiKey: "k",
      fetch: vi.fn(
        async () =>
          new Response("rate limited", {
            status: 429,
            headers: { "Retry-After": "20" },
          }),
      ) as unknown as typeof fetch,
    });

    const error = (await runner(mockAgent(), "Hi", {}).catch(
      (err: unknown) => err,
    )) as Error;

    expect(parseRetryAfter(error)).toBe(20_000);
  });

  it("reads the HTTP-date spelling too", async () => {
    const at = new Date(Date.now() + 30_000).toUTCString();
    const runner = createOpenAIStreamingRunner({
      apiKey: "k",
      fetch: vi.fn(
        async () =>
          new Response("slow down", {
            status: 503,
            headers: { "Retry-After": at },
          }),
      ) as unknown as typeof fetch,
    });

    const error = (await runner(mockAgent(), "Hi", {}).catch(
      (err: unknown) => err,
    )) as Error & { retryAfterMs?: number };

    expect(error.retryAfterMs).toBeGreaterThan(25_000);
    expect(error.retryAfterMs).toBeLessThanOrEqual(30_000);
  });
});

// ============================================================================
// What the response said about itself
// ============================================================================

describe("a truncated response is distinguishable from a complete one", () => {
  it("Anthropic max_tokens", async () => {
    const body =
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"half a sen"}}\n\n' +
      'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":4}}\n\n' +
      'data: {"type":"message_stop"}\n\n';
    const runner = createAnthropicStreamingRunner({
      apiKey: "k",
      fetch: fetchOf(body),
    });

    const result = await runner(mockAgent(), "Hi", {});

    expect(result.stopReason).toBe("length");
    expect(result.rawStopReason).toBe("max_tokens");
  });

  it("OpenAI length", async () => {
    const body =
      'data: {"choices":[{"delta":{"content":"half a sen"}}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n' +
      "data: [DONE]\n\n";
    const runner = createOpenAIStreamingRunner({
      apiKey: "k",
      fetch: fetchOf(body),
    });

    const result = await runner(mockAgent(), "Hi", {});

    expect(result.stopReason).toBe("length");
    expect(result.rawStopReason).toBe("length");
  });

  it("Gemini MAX_TOKENS", async () => {
    const body =
      'data: {"candidates":[{"content":{"parts":[{"text":"half"}]},"finishReason":"MAX_TOKENS"}]}\n\n';
    const runner = createGeminiStreamingRunner({
      apiKey: "k",
      fetch: fetchOf(body),
    });

    const result = await runner(mockAgent(), "Hi", {});

    expect(result.stopReason).toBe("length");
  });

  it("Ollama length", async () => {
    const body =
      '{"message":{"content":"half"},"done":false}\n' +
      '{"message":{"content":""},"done":true,"done_reason":"length","prompt_eval_count":3,"eval_count":2}\n';
    const runner = createOllamaStreamingRunner({ fetch: fetchOf(body) });

    const result = await runner(mockAgent(), "Hi", {});

    expect(result.stopReason).toBe("length");
  });

  it("reaches the createRunner path, buffered and streamed alike", async () => {
    const streamed = createAnthropicRunner({
      apiKey: "k",
      fetch: fetchOf(
        'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":4}}\n\n' +
          'data: {"type":"message_stop"}\n\n',
      ),
    });
    const buffered = createAnthropicRunner({
      apiKey: "k",
      fetch: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              content: [{ text: "half a sen" }],
              stop_reason: "max_tokens",
              usage: { input_tokens: 3, output_tokens: 4 },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ) as unknown as typeof fetch,
    });

    await expect(
      streamed(mockAgent(), "Hi", { onToken: () => {} }),
    ).resolves.toMatchObject({ stopReason: "length" });
    await expect(buffered(mockAgent(), "Hi")).resolves.toMatchObject({
      stopReason: "length",
      rawStopReason: "max_tokens",
    });
  });

  it("a complete answer says so", async () => {
    const body =
      'data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}\n\n' +
      "data: [DONE]\n\n";
    const runner = createOpenAIStreamingRunner({
      apiKey: "k",
      fetch: fetchOf(body),
    });

    const result = await runner(mockAgent(), "Hi", {});

    expect(result.stopReason).toBe("stop");
  });

  it("a safety stop is not a completion", async () => {
    const body =
      'data: {"candidates":[{"content":{"parts":[{"text":""}]},"finishReason":"SAFETY"}]}\n\n';
    const runner = createGeminiStreamingRunner({
      apiKey: "k",
      fetch: fetchOf(body),
    });

    const result = await runner(mockAgent(), "Hi", {});

    expect(result.stopReason).toBe("content_filter");
    expect(result.rawStopReason).toBe("SAFETY");
  });
});

describe("Anthropic tool use", () => {
  it("assembles a tool call from its input_json_delta fragments", async () => {
    const body = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":20}}}',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_weather"}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":"}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"Paris\\"}"}}',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":30}}',
      'data: {"type":"message_stop"}',
    ].join("\n\n");
    const runner = createAnthropicStreamingRunner({
      apiKey: "k",
      fetch: fetchOf(`${body}\n\n`),
    });

    const result = await runner(mockAgent(), "Hi", {});

    expect(result.toolCalls).toEqual([
      { id: "toolu_1", name: "get_weather", arguments: '{"city":"Paris"}' },
    ]);
    expect(result.stopReason).toBe("tool_use");
    expect(JSON.parse(result.toolCalls[0]!.arguments)).toEqual({
      city: "Paris",
    });
  });

  it("keeps two concurrent tool blocks apart", async () => {
    const body = [
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"a","name":"one"}}',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"b","name":"two"}}',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"b\\":1}"}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"a\\":1}"}}',
      'data: {"type":"message_stop"}',
    ].join("\n\n");
    const runner = createAnthropicStreamingRunner({
      apiKey: "k",
      fetch: fetchOf(`${body}\n\n`),
    });

    const result = await runner(mockAgent(), "Hi", {});

    expect(result.toolCalls).toEqual([
      { id: "a", name: "one", arguments: '{"a":1}' },
      { id: "b", name: "two", arguments: '{"b":1}' },
    ]);
  });
});

// ============================================================================
// Gemini's thinking models
// ============================================================================

describe("Gemini returns the answer, not the reasoning summary", () => {
  it("skips the thought part and keeps the one after it", async () => {
    const body =
      'data: {"candidates":[{"content":{"parts":[{"text":"Let me think...","thought":true},{"text":"The answer is 4."}]}}]}\n\n' +
      'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":9,"candidatesTokenCount":5,"thoughtsTokenCount":800}}\n\n';
    const runner = createGeminiStreamingRunner({
      apiKey: "k",
      fetch: fetchOf(body),
    });

    const result = await runner(mockAgent(), "Hi", {});

    expect(result.output).toBe("The answer is 4.");
  });

  it("bills the thinking tokens, which the provider charges as output", async () => {
    const body =
      'data: {"candidates":[{"content":{"parts":[{"text":"4"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":9,"candidatesTokenCount":5,"thoughtsTokenCount":800}}\n\n';
    const runner = createGeminiStreamingRunner({
      apiKey: "k",
      fetch: fetchOf(body),
    });

    const result = await runner(mockAgent(), "Hi", {});

    expect(result.tokenUsage?.outputTokens).toBe(805);
  });

  it("says the prompt was refused rather than that the stream was cut short", async () => {
    const body = 'data: {"promptFeedback":{"blockReason":"SAFETY"}}\n\n';
    const runner = createGeminiStreamingRunner({
      apiKey: "k",
      fetch: fetchOf(body),
    });

    await expect(runner(mockAgent(), "Hi", {})).rejects.toThrow(
      /refused the prompt: SAFETY/,
    );
  });
});

// ============================================================================
// Ollama
// ============================================================================

describe("Ollama reports a mid-stream failure as a failure", () => {
  it("surfaces an error object arriving at HTTP 200", async () => {
    const body =
      '{"message":{"content":"par"},"done":false}\n' +
      '{"error":"model requires more system memory than is available"}\n';
    const runner = createOllamaStreamingRunner({ fetch: fetchOf(body) });

    await expect(runner(mockAgent(), "Hi", {})).rejects.toThrow(
      /model requires more system memory/,
    );
  });
});

// ============================================================================
// Content negotiation
// ============================================================================

describe("a streaming request asks for a stream", () => {
  it("sends Accept: text/event-stream", async () => {
    const body = `${ANTHROPIC_BODY.map((event) => `data: ${event}`).join("\n\n")}\n\n`;
    const fetchFn = fetchOf(body);
    const runner = createAnthropicStreamingRunner({
      apiKey: "k",
      fetch: fetchFn,
    });

    await runner(mockAgent(), "Hi", {});

    const init = (
      fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }
    ).mock.calls[0]![1];
    expect((init.headers as Record<string, string>).Accept).toBe(
      "text/event-stream",
    );
  });

  it("says so when the endpoint answers with JSON instead", async () => {
    const runner = createAnthropicStreamingRunner({
      apiKey: "k",
      fetch: fetchOf('{"error":{"message":"overloaded"}}', {
        "Content-Type": "application/json",
      }),
    });

    await expect(runner(mockAgent(), "Hi", {})).rejects.toThrow(
      /rather than text\/event-stream/,
    );
  });

  it("leaves a body with no Content-Type alone", async () => {
    const encoder = new TextEncoder();
    const body = `${ANTHROPIC_BODY.map((event) => `data: ${event}`).join("\n\n")}\n\n`;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(body));
        controller.close();
      },
    });
    const runner = createAnthropicStreamingRunner({
      apiKey: "k",
      fetch: vi.fn(
        async () => new Response(stream, { status: 200 }),
      ) as unknown as typeof fetch,
    });

    await expect(runner(mockAgent(), "Hi", {})).resolves.toMatchObject({
      output: "Hello",
    });
  });
});

describe("stream_options.include_usage can be turned off", () => {
  it("is sent by default", async () => {
    const fetchFn = fetchOf(
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    );
    const runner = createOpenAIStreamingRunner({ apiKey: "k", fetch: fetchFn });

    await runner(mockAgent(), "Hi", {});

    const init = (
      fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }
    ).mock.calls[0]![1];
    expect(JSON.parse(init.body as string).stream_options).toEqual({
      include_usage: true,
    });
  });

  it("is omitted for a deployment that answers 400 to it", async () => {
    const fetchFn = fetchOf(
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    );
    const runner = createOpenAIStreamingRunner({
      apiKey: "k",
      fetch: fetchFn,
      includeUsage: false,
    });

    await runner(mockAgent(), "Hi", {});

    const init = (
      fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }
    ).mock.calls[0]![1];
    expect(JSON.parse(init.body as string)).not.toHaveProperty(
      "stream_options",
    );
  });
});
