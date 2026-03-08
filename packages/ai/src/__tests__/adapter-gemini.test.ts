import { describe, expect, it, vi } from "vitest";
import {
  createGeminiRunner,
  createGeminiStreamingRunner,
} from "../adapters/gemini.js";

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
// createGeminiRunner
// ============================================================================

describe("createGeminiRunner", () => {
  it("sends request to the correct URL with model", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "Hello!" }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      }),
    );

    const runner = createGeminiRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });
    await runner(mockAgent(), "Hi");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
    );
  });

  it("includes apiKey in x-goog-api-key header", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "Hi" }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
      }),
    );

    const runner = createGeminiRunner({
      apiKey: "gemini-key-abc123",
      fetch: mockFetch,
    });
    await runner(mockAgent(), "Hello");

    const [, init] = mockFetch.mock.calls[0]!;
    expect(init.headers).toEqual(
      expect.objectContaining({
        "x-goog-api-key": "gemini-key-abc123",
      }),
    );
  });

  it("maps agent instructions to systemInstruction", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "response" }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      }),
    );

    const runner = createGeminiRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });
    await runner(mockAgent({ instructions: "Be brief." }), "What is 2+2?");

    const [, init] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(init.body as string);

    expect(body.systemInstruction).toEqual({ parts: [{ text: "Be brief." }] });
  });

  it("formats messages as Gemini contents with role mapping", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "ok" }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      }),
    );

    const runner = createGeminiRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });
    await runner(mockAgent(), "What is 2+2?");

    const [, init] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(init.body as string);

    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "What is 2+2?" }] },
    ]);
  });

  it("parses response text from candidates[0].content.parts[0].text", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "The answer is 4." }] } }],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 },
      }),
    );

    const runner = createGeminiRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });
    const result = await runner(mockAgent(), "What is 2+2?");

    expect(result.output).toBe("The answer is 4.");
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

  it("returns tokenUsage from usageMetadata", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "ok" }] } }],
        usageMetadata: { promptTokenCount: 25, candidatesTokenCount: 12 },
      }),
    );

    const runner = createGeminiRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });
    const result = await runner(mockAgent(), "test");

    expect(result.totalTokens).toBe(37);
    expect(result.tokenUsage).toEqual({
      inputTokens: 25,
      outputTokens: 12,
    });
  });

  it("includes maxOutputTokens in generationConfig when set", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "ok" }] } }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      }),
    );

    const runner = createGeminiRunner({
      apiKey: "test-key",
      maxOutputTokens: 2048,
      fetch: mockFetch,
    });
    await runner(mockAgent(), "test");

    const [, init] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(init.body as string);

    expect(body.generationConfig).toEqual({ maxOutputTokens: 2048 });
  });

  it("uses agent.model over default model", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "ok" }] } }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      }),
    );

    const runner = createGeminiRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });
    await runner(mockAgent({ model: "gemini-2.5-pro" }), "test");

    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
    );
  });

  it("throws on non-200 response", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(textResponse("Rate limit exceeded", 429));

    const runner = createGeminiRunner({
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
        candidates: [{ content: { parts: [{ text: "ok" }] } }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      }),
    );

    const runner = createGeminiRunner({
      apiKey: "test-key",
      baseURL: "https://my-proxy.example.com/v1beta",
      fetch: mockFetch,
    });
    await runner(mockAgent(), "test");

    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toBe(
      "https://my-proxy.example.com/v1beta/models/gemini-2.0-flash:generateContent",
    );
  });

  it("calls hooks.onBeforeCall and hooks.onAfterCall", async () => {
    const onBeforeCall = vi.fn();
    const onAfterCall = vi.fn();

    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "hooked" }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
      }),
    );

    const runner = createGeminiRunner({
      apiKey: "test-key",
      fetch: mockFetch,
      hooks: { onBeforeCall, onAfterCall },
    });

    const agent = mockAgent();
    await runner(agent, "test");

    expect(onBeforeCall).toHaveBeenCalledOnce();
    expect(onBeforeCall.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ agent, input: "test" }),
    );

    expect(onAfterCall).toHaveBeenCalledOnce();
    expect(onAfterCall.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        agent,
        input: "test",
        output: "hooked",
        totalTokens: 8,
      }),
    );
  });
});

// ============================================================================
// createGeminiStreamingRunner
// ============================================================================

describe("createGeminiStreamingRunner", () => {
  it("streams tokens from SSE events", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}',
          'data: {"candidates":[{"content":{"parts":[{"text":" world"}]}}]}',
          'data: {"candidates":[{"content":{"parts":[{"text":"!"}]}}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5}}',
        ]),
      );

    const streamingRunner = createGeminiStreamingRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });

    const tokens: string[] = [];
    const result = await streamingRunner(mockAgent(), "Hi", {
      onToken: (token) => tokens.push(token),
    });

    expect(tokens).toEqual(["Hello", " world", "!"]);
    expect(result.output).toBe("Hello world!");
  });

  it("sends request to the correct streaming URL", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2}}',
        ]),
      );

    const streamingRunner = createGeminiStreamingRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });

    await streamingRunner(mockAgent(), "test", {});

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse",
    );
  });

  it("calls onToken callback for each text chunk", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          'data: {"candidates":[{"content":{"parts":[{"text":"chunk1"}]}}]}',
          'data: {"candidates":[{"content":{"parts":[{"text":"chunk2"}]}}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":3}}',
        ]),
      );

    const streamingRunner = createGeminiStreamingRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });

    const tokens: string[] = [];
    await streamingRunner(mockAgent(), "test", {
      onToken: (token) => tokens.push(token),
    });

    expect(tokens).toEqual(["chunk1", "chunk2"]);
  });

  it("calls onMessage with final assistant message", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          'data: {"candidates":[{"content":{"parts":[{"text":"Done"}]}}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":3}}',
        ]),
      );

    const streamingRunner = createGeminiStreamingRunner({
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

  it("returns tokenUsage from usageMetadata", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}',
          'data: {"candidates":[{"content":{"parts":[{"text":" world"}]}}],"usageMetadata":{"promptTokenCount":15,"candidatesTokenCount":8}}',
        ]),
      );

    const streamingRunner = createGeminiStreamingRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });

    const result = await streamingRunner(mockAgent(), "Hi", {});

    expect(result.totalTokens).toBe(23);
    expect(result.tokenUsage).toEqual({
      inputTokens: 15,
      outputTokens: 8,
    });
  });

  it("throws on non-200 response", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(textResponse("Overloaded", 503));

    const streamingRunner = createGeminiStreamingRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });

    await expect(streamingRunner(mockAgent(), "test", {})).rejects.toThrow(
      /streaming error 503/i,
    );
  });

  it("handles [DONE] event", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          'data: {"candidates":[{"content":{"parts":[{"text":"final"}]}}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2}}',
          "data: [DONE]",
        ]),
      );

    const streamingRunner = createGeminiStreamingRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });

    const tokens: string[] = [];
    const result = await streamingRunner(mockAgent(), "test", {
      onToken: (token) => tokens.push(token),
    });

    expect(tokens).toEqual(["final"]);
    expect(result.output).toBe("final");
  });

  it("respects signal for abort", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2}}',
        ]),
      );

    const streamingRunner = createGeminiStreamingRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });

    const controller = new AbortController();
    await streamingRunner(mockAgent(), "test", {
      signal: controller.signal,
    });

    const [, init] = mockFetch.mock.calls[0]!;
    expect(init.signal).toBe(controller.signal);
  });

  it("calls hooks.onError on failure", async () => {
    const onError = vi.fn();
    const mockFetch = vi
      .fn()
      .mockResolvedValue(textResponse("Server Error", 500));

    const streamingRunner = createGeminiStreamingRunner({
      apiKey: "test-key",
      fetch: mockFetch,
      hooks: { onError },
    });

    const agent = mockAgent();
    await expect(
      streamingRunner(agent, "test", {}),
    ).rejects.toThrow(/streaming error 500/i);

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        agent,
        input: "test",
      }),
    );
    expect(onError.mock.calls[0]![0].error).toBeInstanceOf(Error);
  });

  it("throws when response has no body", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 200, statusText: "OK" }),
      );

    const streamingRunner = createGeminiStreamingRunner({
      apiKey: "test-key",
      fetch: mockFetch,
    });

    await expect(streamingRunner(mockAgent(), "test", {})).rejects.toThrow(
      /no response body/i,
    );
  });
});
