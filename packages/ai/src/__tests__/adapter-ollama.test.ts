import { describe, expect, it, vi } from "vitest";
import { createOllamaRunner } from "../adapters/ollama.js";

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

// ============================================================================
// createOllamaRunner
// ============================================================================

describe("createOllamaRunner", () => {
  it("sends request to the correct localhost URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        message: { content: "Hello!" },
        prompt_eval_count: 10,
        eval_count: 5,
      }),
    );

    const runner = createOllamaRunner({ fetch: mockFetch });
    await runner(mockAgent(), "Hi");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toBe("http://localhost:11434/api/chat");
  });

  it("sends correct body shape with model, messages, and stream: false", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        message: { content: "response" },
        prompt_eval_count: 10,
        eval_count: 5,
      }),
    );

    const runner = createOllamaRunner({ fetch: mockFetch });
    await runner(mockAgent({ instructions: "Be brief." }), "What is 2+2?");

    const [, init] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(init.body as string);

    expect(body.model).toBe("llama3");
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual([
      { role: "system", content: "Be brief." },
      { role: "user", content: "What is 2+2?" },
    ]);
  });

  it("uses agent.model when provided, overriding the default", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        message: { content: "ok" },
        prompt_eval_count: 1,
        eval_count: 1,
      }),
    );

    const runner = createOllamaRunner({ fetch: mockFetch });
    await runner(mockAgent({ model: "mistral" }), "test");

    const [, init] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(init.body as string);

    expect(body.model).toBe("mistral");
  });

  it("uses custom model default from options when agent.model is undefined", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        message: { content: "ok" },
        prompt_eval_count: 1,
        eval_count: 1,
      }),
    );

    const runner = createOllamaRunner({ model: "phi3", fetch: mockFetch });
    await runner(mockAgent(), "test");

    const [, init] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(init.body as string);

    expect(body.model).toBe("phi3");
  });

  it("parses message.content and token counts correctly", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        message: { content: "The answer is 4." },
        prompt_eval_count: 20,
        eval_count: 10,
      }),
    );

    const runner = createOllamaRunner({ fetch: mockFetch });
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
      .mockResolvedValue(textResponse("Internal Server Error", 500));

    const runner = createOllamaRunner({ fetch: mockFetch });

    await expect(runner(mockAgent(), "test")).rejects.toThrow(
      /request failed: 500/i,
    );
  });

  it("throws descriptive error on non-JSON response", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("<html>Not Found</html>", {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "text/html" },
      }),
    );

    const runner = createOllamaRunner({ fetch: mockFetch });

    await expect(runner(mockAgent(), "test")).rejects.toThrow(
      /non-JSON response.*ollama/i,
    );
  });

  it("uses custom baseURL when provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        message: { content: "ok" },
        prompt_eval_count: 1,
        eval_count: 1,
      }),
    );

    const runner = createOllamaRunner({
      baseURL: "http://gpu-server:11434",
      fetch: mockFetch,
    });
    await runner(mockAgent(), "test");

    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toBe("http://gpu-server:11434/api/chat");
  });

  it("omits system message when agent has no instructions", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        message: { content: "ok" },
        prompt_eval_count: 1,
        eval_count: 1,
      }),
    );

    const runner = createOllamaRunner({ fetch: mockFetch });
    await runner(mockAgent({ instructions: undefined }), "test");

    const [, init] = mockFetch.mock.calls[0]!;
    const body = JSON.parse(init.body as string);

    expect(body.messages).toEqual([{ role: "user", content: "test" }]);
  });

  it("handles missing token counts gracefully (defaults to 0)", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        message: { content: "ok" },
      }),
    );

    const runner = createOllamaRunner({ fetch: mockFetch });
    const result = await runner(mockAgent(), "test");

    expect(result.totalTokens).toBe(0);
  });
});
