import { describe, expect, it, vi } from "vitest";
import {
  createAnthropicRunner,
  createAnthropicStreamingRunner,
} from "../adapters/anthropic.js";
import { createOpenAIRunner } from "../adapters/openai.js";

// ============================================================================
// Helpers
// ============================================================================

function mockAgent(overrides: Record<string, unknown> = {}) {
  return {
    name: "test-agent",
    instructions: "You are helpful.",
    model: undefined as string | undefined,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Bad Request",
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    statusText: "Error",
    headers: { "Content-Type": "text/plain" },
  });
}

/**
 * Create a ReadableStream that emits SSE events line by line.
 * Each string in `events` should be a complete SSE payload (e.g. `data: {...}`).
 */
function sseStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const lines = events.map((e) => `${e}\n\n`);

  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }
      controller.close();
    },
  });
}

function sseResponse(events: string[], status = 200): Response {
  return new Response(sseStream(events), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "Content-Type": "text/event-stream" },
  });
}

// ============================================================================
// createAnthropicRunner
// ============================================================================

describe("createAnthropicRunner", () => {
  it("sends request to the correct URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        content: [{ text: "Hello!" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );

    const runner = createAnthropicRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });
    await runner(mockAgent(), "Hi");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("passes x-api-key and anthropic-version headers", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        content: [{ text: "Hi" }],
        usage: { input_tokens: 5, output_tokens: 3 },
      }),
    );

    const runner = createAnthropicRunner({
      apiKey: "sk-ant-abc123",
      fetch: mockFetch,
    });
    await runner(mockAgent(), "Hello");

    const [, init] = mockFetch.mock.calls[0]!;
    expect(init.headers).toEqual(
      expect.objectContaining({
        "x-api-key": "sk-ant-abc123",
        "anthropic-version": "2023-06-01",
      }),
    );
  });

  it("sends correct body shape with system, messages, and max_tokens", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        content: [{ text: "response" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );

    const runner = createAnthropicRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });
    await runner(mockAgent({ instructions: "Be brief." }), "What is 2+2?");

    const [, init] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(init.body as string);

    expect(body.model).toBe("claude-sonnet-4-5-20250929");
    expect(body.max_tokens).toBe(4096);
    expect(body.system).toBe("Be brief.");
    expect(body.messages).toEqual([{ role: "user", content: "What is 2+2?" }]);
  });

  it("uses agent.model when provided, overriding the default", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        content: [{ text: "ok" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );

    const runner = createAnthropicRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });
    await runner(mockAgent({ model: "claude-3-5-haiku-20241022" }), "test");

    const [, init] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(init.body as string);

    expect(body.model).toBe("claude-3-5-haiku-20241022");
  });

  it("parses content[0].text and token counts correctly", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        content: [{ text: "The answer is 4." }],
        usage: { input_tokens: 20, output_tokens: 10 },
      }),
    );

    const runner = createAnthropicRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });
    const result = await runner(mockAgent(), "What is 2+2?");

    expect(result.output).toBe("The answer is 4.");
    expect(result.totalTokens).toBe(30);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({
      role: "user",
      content: "What is 2+2?",
    });
    expect(result.messages[1]).toEqual({
      role: "assistant",
      content: "The answer is 4.",
    });
  });

  it("throws on non-OK response", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(textResponse("Rate limit exceeded", 429));

    const runner = createAnthropicRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });

    await expect(runner(mockAgent(), "test")).rejects.toThrow(
      /request failed: 429/i,
    );
  });

  it("uses custom baseURL when provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        content: [{ text: "ok" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );

    const runner = createAnthropicRunner({
      apiKey: "test-key",
      baseURL: "https://my-proxy.example.com/v1",
      fetch: mockFetch,
    });
    await runner(mockAgent(), "test");

    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://my-proxy.example.com/v1/messages");
  });

  it("uses custom maxTokens when provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        content: [{ text: "ok" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );

    const runner = createAnthropicRunner({
      apiKey: "test-key",
      maxTokens: 8192,
      fetch: mockFetch,
    });
    await runner(mockAgent(), "test");

    const [, init] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(init.body as string);

    expect(body.max_tokens).toBe(8192);
  });

  it("sends a bare-string system (no cache_control) when promptCaching is off", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        content: [{ text: "ok" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );

    const runner = createAnthropicRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });
    await runner(mockAgent({ instructions: "Be brief." }), "test");

    const [, init] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(init.body as string);

    expect(body.system).toBe("Be brief.");
    expect(Array.isArray(body.system)).toBe(false);
  });

  it("adds a cache_control breakpoint to the system prefix when promptCaching is 'automatic'", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        content: [{ text: "ok" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );

    const runner = createAnthropicRunner({
      apiKey: "test-key",
      promptCaching: "automatic",
      fetch: mockFetch,
    });
    await runner(mockAgent({ instructions: "Be brief." }), "test");

    const [, init] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(init.body as string);

    expect(body.system).toEqual([
      {
        type: "text",
        text: "Be brief.",
        cache_control: { type: "ephemeral" },
      },
    ]);
    // The cache breakpoint stays on the system prefix only – the variable
    // message suffix must remain uncached.
    expect(body.messages[0].content).not.toHaveProperty("cache_control");
  });

  it("surfaces cache_read/cache_creation tokens onto tokenUsage", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        content: [{ text: "cached reply" }],
        usage: {
          input_tokens: 12,
          output_tokens: 8,
          cache_read_input_tokens: 1024,
          cache_creation_input_tokens: 256,
        },
      }),
    );

    const runner = createAnthropicRunner({
      apiKey: "test-key",
      promptCaching: "automatic",
      fetch: mockFetch,
    });
    const result = await runner(mockAgent(), "test");

    expect(result.tokenUsage).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      cacheReadTokens: 1024,
      cacheCreationTokens: 256,
    });
    // input_tokens is the uncached remainder – cache tokens are additive.
    expect(result.totalTokens).toBe(12 + 8 + 1024 + 256);
  });

  it("omits cache token fields when the response has no cache usage", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        content: [{ text: "ok" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );

    const runner = createAnthropicRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });
    const result = await runner(mockAgent(), "test");

    expect(result.tokenUsage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(result.tokenUsage).not.toHaveProperty("cacheReadTokens");
    expect(result.totalTokens).toBe(15);
  });

  it("omits cache fields on a caching-off response that reports cache_*_input_tokens: 0", async () => {
    // The live Anthropic API returns cache_read/cache_creation_input_tokens: 0
    // on EVERY response, even when no cache_control was sent. Emission is gated
    // on the option, not on these fields' presence, so a caching-off call stays
    // byte-identical to the pre-caching behavior.
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        content: [{ text: "ok" }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
    );

    const runner = createAnthropicRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });
    const result = await runner(mockAgent(), "test");

    expect(result.tokenUsage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(result.tokenUsage).not.toHaveProperty("cacheReadTokens");
    expect(result.tokenUsage).not.toHaveProperty("cacheCreationTokens");
    expect(result.totalTokens).toBe(15);
  });

  it("emits cacheReadTokens: 0 on a caching-on cache miss (0 means active, not absent)", async () => {
    // First call with caching on: cache is written, nothing read back yet.
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        content: [{ text: "ok" }],
        usage: {
          input_tokens: 20,
          output_tokens: 6,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 512,
        },
      }),
    );

    const runner = createAnthropicRunner({
      apiKey: "test-key",
      promptCaching: "automatic",
      fetch: mockFetch,
    });
    const result = await runner(mockAgent(), "test");

    expect(result.tokenUsage).toEqual({
      inputTokens: 20,
      outputTokens: 6,
      cacheReadTokens: 0,
      cacheCreationTokens: 512,
    });
    // The 0 read is emitted, not omitted – 0 is the cache-miss diagnostic.
    expect(result.tokenUsage).toHaveProperty("cacheReadTokens", 0);
    expect(result.totalTokens).toBe(20 + 6 + 0 + 512);
  });

  it("sends a bare-string system when promptCaching is on but instructions are empty", async () => {
    // A fresh Response per call – a Response body can only be read once.
    const mockFetch = vi.fn().mockImplementation(async () =>
      jsonResponse({
        content: [{ text: "ok" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );

    const runner = createAnthropicRunner({
      apiKey: "test-key",
      promptCaching: "automatic",
      fetch: mockFetch,
    });

    // undefined instructions – nothing stable to cache, so no cached block.
    await runner(mockAgent({ instructions: undefined }), "test");
    const [, init] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(init.body as string);
    expect(body.system).toBe("");
    expect(Array.isArray(body.system)).toBe(false);

    // whitespace-only instructions – same fallback, bytes preserved.
    await runner(mockAgent({ instructions: "   " }), "test");
    const [, init2] = mockFetch.mock.calls[1]!;
    const body2 = JSON.parse(init2.body as string);
    expect(body2.system).toBe("   ");
    expect(Array.isArray(body2.system)).toBe(false);
  });

  it("does not add cache token fields to a non-Anthropic (OpenAI) runner result", async () => {
    // Locks the shared createRunner non-regression: adapters that never emit
    // parsed cache tokens produce a bare { inputTokens, outputTokens } shape.
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 4, completion_tokens: 3 },
      }),
    );

    const runner = createOpenAIRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });
    const result = await runner(mockAgent(), "test");

    expect(result.tokenUsage).toEqual({ inputTokens: 4, outputTokens: 3 });
    expect(result.tokenUsage).not.toHaveProperty("cacheReadTokens");
    expect(result.tokenUsage).not.toHaveProperty("cacheCreationTokens");
  });
});

// ============================================================================
// createAnthropicStreamingRunner
// ============================================================================

describe("createAnthropicStreamingRunner", () => {
  it("sends request to the correct URL with stream: true", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}',
          'data: {"type":"message_delta","usage":{"output_tokens":5}}',
          'data: {"type":"message_stop"}',
        ]),
      );

    const streamingRunner = createAnthropicStreamingRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });

    await streamingRunner(mockAgent(), "Hi", {});

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");

    const body = JSON.parse(init.body as string);
    expect(body.stream).toBe(true);
  });

  it("passes x-api-key and anthropic-version headers", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          'data: {"type":"message_start","message":{"usage":{"input_tokens":5}}}',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}',
          'data: {"type":"message_delta","usage":{"output_tokens":2}}',
          'data: {"type":"message_stop"}',
        ]),
      );

    const streamingRunner = createAnthropicStreamingRunner({
      apiKey: "sk-ant-stream",
      fetch: mockFetch,
    });

    await streamingRunner(mockAgent(), "test", {});

    const [, init] = mockFetch.mock.calls[0]!;
    expect(init.headers).toEqual(
      expect.objectContaining({
        "x-api-key": "sk-ant-stream",
        "anthropic-version": "2023-06-01",
      }),
    );
  });

  it("accumulates streamed text and calls onToken for each delta", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}',
          'data: {"type":"message_delta","usage":{"output_tokens":5}}',
          'data: {"type":"message_stop"}',
        ]),
      );

    const streamingRunner = createAnthropicStreamingRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });

    const tokens: string[] = [];
    const result = await streamingRunner(mockAgent(), "Hi", {
      onToken: (token) => {
        tokens.push(token);
      },
    });

    expect(tokens).toEqual(["Hello", " world"]);
    expect(result.output).toBe("Hello world");
    expect(result.totalTokens).toBe(15);
  });

  it("calls onMessage with the complete assistant message", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          'data: {"type":"message_start","message":{"usage":{"input_tokens":5}}}',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Done"}}',
          'data: {"type":"message_delta","usage":{"output_tokens":3}}',
          'data: {"type":"message_stop"}',
        ]),
      );

    const streamingRunner = createAnthropicStreamingRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });

    const messages: Array<{ role: string; content: string }> = [];
    await streamingRunner(mockAgent(), "test", {
      onMessage: (msg) => messages.push(msg),
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ role: "assistant", content: "Done" });
  });

  it("returns messages array with user and assistant", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          'data: {"type":"message_start","message":{"usage":{"input_tokens":5}}}',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"reply"}}',
          'data: {"type":"message_delta","usage":{"output_tokens":2}}',
          'data: {"type":"message_stop"}',
        ]),
      );

    const streamingRunner = createAnthropicStreamingRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });

    const result = await streamingRunner(mockAgent(), "input", {});

    expect(result.messages).toEqual([
      { role: "user", content: "input" },
      { role: "assistant", content: "reply" },
    ]);
  });

  it("throws on non-OK response", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(textResponse("Overloaded", 529));

    const streamingRunner = createAnthropicStreamingRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });

    await expect(streamingRunner(mockAgent(), "test", {})).rejects.toThrow(
      /streaming error 529/i,
    );
  });

  it("throws when response has no body", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200, statusText: "OK" }));

    const streamingRunner = createAnthropicStreamingRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });

    await expect(streamingRunner(mockAgent(), "test", {})).rejects.toThrow(
      /no response body/i,
    );
  });
});

// ============================================================================
// createAnthropicStreamingRunner – the deadline on a stalled stream
// ============================================================================

/**
 * An SSE body that emits its events on a clock, and then either ends or goes
 * quiet with the connection still open.
 *
 * The signal is honoured the way a real fetch body honours it: a cancelled call
 * errors the body with the signal's reason rather than leaving the reader
 * parked. Without that a stalled-stream test would pass by hanging.
 */
function pacedSseResponse(config: {
  events: string[];
  gapMs: number;
  signal?: AbortSignal;
  thenStall?: boolean;
}): Response {
  const { events, gapMs, signal, thenStall = false } = config;
  const encoder = new TextEncoder();
  let index = 0;

  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const event = events[index++];

      return new Promise<void>((resolve, reject) => {
        const onAbort = (): void => {
          reject(signal?.reason ?? new Error("aborted"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) {
          onAbort();

          return;
        }
        if (event === undefined && thenStall) {
          return;
        }
        setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          if (event === undefined) {
            controller.close();
          } else {
            controller.enqueue(encoder.encode(`${event}\n\n`));
          }
          resolve();
        }, gapMs);
      });
    },
  });

  return new Response(body, {
    status: 200,
    statusText: "OK",
    headers: { "Content-Type": "text/event-stream" },
  });
}

const OPENING_FRAME =
  'data: {"type":"message_start","message":{"usage":{"input_tokens":4000}}}';

describe("createAnthropicStreamingRunner – a stream that stops talking", () => {
  it("abandons a stream that has gone quiet for timeoutMs", async () => {
    vi.useFakeTimers();
    try {
      const mockFetch = vi.fn(async (_url: string, init: RequestInit) =>
        pacedSseResponse({
          events: [OPENING_FRAME],
          gapMs: 0,
          signal: init.signal ?? undefined,
          thenStall: true,
        }),
      );

      const streamingRunner = createAnthropicStreamingRunner({
        apiKey: "test-key",
        fetch: mockFetch as unknown as typeof fetch,
        timeoutMs: 30_000,
      });

      const call = streamingRunner(mockAgent(), "Hi", {});
      const settled = expect(call).rejects.toMatchObject({
        name: "TimeoutError",
      });

      await vi.advanceTimersByTimeAsync(31_000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies a two-minute deadline when the caller sets none", async () => {
    vi.useFakeTimers();
    try {
      const mockFetch = vi.fn(async (_url: string, init: RequestInit) =>
        pacedSseResponse({
          events: [OPENING_FRAME],
          gapMs: 0,
          signal: init.signal ?? undefined,
          thenStall: true,
        }),
      );

      const streamingRunner = createAnthropicStreamingRunner({
        apiKey: "test-key",
        fetch: mockFetch as unknown as typeof fetch,
      });

      const call = streamingRunner(mockAgent(), "Hi", {});
      const settled = expect(call).rejects.toThrow(/sent nothing for 120000ms/);

      // Still running well past any single-call wall clock would allow.
      await vi.advanceTimersByTimeAsync(119_000);
      await vi.advanceTimersByTimeAsync(2_000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it("measures the gap between events, not the length of the call", async () => {
    vi.useFakeTimers();
    try {
      const mockFetch = vi.fn(async (_url: string, init: RequestInit) =>
        pacedSseResponse({
          events: [
            OPENING_FRAME,
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"slow"}}',
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" but alive"}}',
            'data: {"type":"message_delta","usage":{"output_tokens":5}}',
            'data: {"type":"message_stop"}',
          ],
          // Every event arrives well inside the deadline; the call as a whole
          // runs for four times it. A wall clock would have cut this off.
          gapMs: 90_000,
          signal: init.signal ?? undefined,
        }),
      );

      const streamingRunner = createAnthropicStreamingRunner({
        apiKey: "test-key",
        fetch: mockFetch as unknown as typeof fetch,
        timeoutMs: 120_000,
      });

      const call = streamingRunner(mockAgent(), "Hi", {});
      await vi.advanceTimersByTimeAsync(10 * 90_000);

      const result = await call;
      expect(result.output).toBe("slow but alive");
    } finally {
      vi.useRealTimers();
    }
  });

  it("names a stall differently from a cancellation", async () => {
    const controller = new AbortController();
    const mockFetch = vi.fn(async (_url: string, init: RequestInit) =>
      pacedSseResponse({
        events: [OPENING_FRAME],
        gapMs: 0,
        signal: init.signal ?? undefined,
        thenStall: true,
      }),
    );

    const streamingRunner = createAnthropicStreamingRunner({
      apiKey: "test-key",
      fetch: mockFetch as unknown as typeof fetch,
      timeoutMs: 30_000,
    });

    const call = streamingRunner(mockAgent(), "Hi", {
      signal: controller.signal,
    });
    const settled = expect(call).rejects.toMatchObject({ name: "AbortError" });

    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await settled;
  });

  it("refuses a timeoutMs no stream could ever trip", () => {
    expect(() =>
      createAnthropicStreamingRunner({ apiKey: "test-key", timeoutMs: 0 }),
    ).toThrow(/timeoutMs must be a positive number/);
  });
});
