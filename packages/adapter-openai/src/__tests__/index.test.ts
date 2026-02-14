import { describe, it, expect, vi } from "vitest";
import {
	createOpenAIRunner,
	createOpenAIEmbedder,
	createOpenAIStreamingRunner,
} from "../index.js";

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
// createOpenAIRunner
// ============================================================================

describe("createOpenAIRunner", () => {
	it("sends request to the correct URL", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			jsonResponse({
				choices: [{ message: { content: "Hello!" } }],
				usage: { prompt_tokens: 10, completion_tokens: 5 },
			}),
		);

		const runner = createOpenAIRunner({ apiKey: "test-key", fetch: mockFetch });
		await runner(mockAgent(), "Hi");

		expect(mockFetch).toHaveBeenCalledOnce();
		const [url] = mockFetch.mock.calls[0];
		expect(url).toBe("https://api.openai.com/v1/chat/completions");
	});

	it("passes apiKey as Bearer token in Authorization header", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			jsonResponse({
				choices: [{ message: { content: "Hi" } }],
				usage: { prompt_tokens: 5, completion_tokens: 3 },
			}),
		);

		const runner = createOpenAIRunner({ apiKey: "sk-abc123", fetch: mockFetch });
		await runner(mockAgent(), "Hello");

		const [, init] = mockFetch.mock.calls[0];
		expect(init.headers).toEqual(
			expect.objectContaining({ Authorization: "Bearer sk-abc123" }),
		);
	});

	it("sends correct body shape with system message and user message", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			jsonResponse({
				choices: [{ message: { content: "response" } }],
				usage: { prompt_tokens: 10, completion_tokens: 5 },
			}),
		);

		const runner = createOpenAIRunner({ apiKey: "test-key", fetch: mockFetch });
		await runner(mockAgent({ instructions: "Be brief." }), "What is 2+2?");

		const [, init] = mockFetch.mock.calls[0];
		const body = JSON.parse(init.body as string);

		expect(body.model).toBe("gpt-4o");
		expect(body.messages).toEqual([
			{ role: "system", content: "Be brief." },
			{ role: "user", content: "What is 2+2?" },
		]);
	});

	it("uses agent.model when provided, overriding the default", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			jsonResponse({
				choices: [{ message: { content: "ok" } }],
				usage: { prompt_tokens: 1, completion_tokens: 1 },
			}),
		);

		const runner = createOpenAIRunner({ apiKey: "test-key", fetch: mockFetch });
		await runner(mockAgent({ model: "gpt-4o-mini" }), "test");

		const [, init] = mockFetch.mock.calls[0];
		const body = JSON.parse(init.body as string);

		expect(body.model).toBe("gpt-4o-mini");
	});

	it("uses custom model default from options when agent.model is undefined", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			jsonResponse({
				choices: [{ message: { content: "ok" } }],
				usage: { prompt_tokens: 1, completion_tokens: 1 },
			}),
		);

		const runner = createOpenAIRunner({
			apiKey: "test-key",
			model: "gpt-3.5-turbo",
			fetch: mockFetch,
		});
		await runner(mockAgent(), "test");

		const [, init] = mockFetch.mock.calls[0];
		const body = JSON.parse(init.body as string);

		expect(body.model).toBe("gpt-3.5-turbo");
	});

	it("parses response text and token counts correctly", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			jsonResponse({
				choices: [{ message: { content: "The answer is 4." } }],
				usage: { prompt_tokens: 20, completion_tokens: 10 },
			}),
		);

		const runner = createOpenAIRunner({ apiKey: "test-key", fetch: mockFetch });
		const result = await runner(mockAgent(), "What is 2+2?");

		expect(result.output).toBe("The answer is 4.");
		expect(result.totalTokens).toBe(30);
		expect(result.messages).toHaveLength(2);
		expect(result.messages[0]).toEqual({ role: "user", content: "What is 2+2?" });
		expect(result.messages[1]).toEqual({
			role: "assistant",
			content: "The answer is 4.",
		});
	});

	it("throws on non-OK response", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			textResponse("Rate limit exceeded", 429),
		);

		const runner = createOpenAIRunner({ apiKey: "test-key", fetch: mockFetch });

		await expect(runner(mockAgent(), "test")).rejects.toThrow(
			/request failed: 429/i,
		);
	});

	it("uses custom baseURL when provided", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			jsonResponse({
				choices: [{ message: { content: "ok" } }],
				usage: { prompt_tokens: 1, completion_tokens: 1 },
			}),
		);

		const runner = createOpenAIRunner({
			apiKey: "test-key",
			baseURL: "https://my-proxy.example.com/v1",
			fetch: mockFetch,
		});
		await runner(mockAgent(), "test");

		const [url] = mockFetch.mock.calls[0];
		expect(url).toBe("https://my-proxy.example.com/v1/chat/completions");
	});

	it("omits system message when agent has no instructions", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			jsonResponse({
				choices: [{ message: { content: "ok" } }],
				usage: { prompt_tokens: 1, completion_tokens: 1 },
			}),
		);

		const runner = createOpenAIRunner({ apiKey: "test-key", fetch: mockFetch });
		await runner(mockAgent({ instructions: undefined }), "test");

		const [, init] = mockFetch.mock.calls[0];
		const body = JSON.parse(init.body as string);

		expect(body.messages).toEqual([{ role: "user", content: "test" }]);
	});
});

// ============================================================================
// createOpenAIEmbedder
// ============================================================================

describe("createOpenAIEmbedder", () => {
	it("sends request to the correct embeddings URL", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			jsonResponse({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
		);

		const embedder = createOpenAIEmbedder({
			apiKey: "test-key",
			fetch: mockFetch,
		});
		await embedder("Hello world");

		expect(mockFetch).toHaveBeenCalledOnce();
		const [url] = mockFetch.mock.calls[0];
		expect(url).toBe("https://api.openai.com/v1/embeddings");
	});

	it("passes apiKey as Bearer token", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			jsonResponse({ data: [{ embedding: [0.1] }] }),
		);

		const embedder = createOpenAIEmbedder({
			apiKey: "sk-embed-key",
			fetch: mockFetch,
		});
		await embedder("test");

		const [, init] = mockFetch.mock.calls[0];
		expect(init.headers).toEqual(
			expect.objectContaining({ Authorization: "Bearer sk-embed-key" }),
		);
	});

	it("sends correct body with model and dimensions", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			jsonResponse({ data: [{ embedding: [0.1, 0.2] }] }),
		);

		const embedder = createOpenAIEmbedder({
			apiKey: "test-key",
			model: "text-embedding-3-large",
			dimensions: 256,
			fetch: mockFetch,
		});
		await embedder("embed this");

		const [, init] = mockFetch.mock.calls[0];
		const body = JSON.parse(init.body as string);

		expect(body.model).toBe("text-embedding-3-large");
		expect(body.dimensions).toBe(256);
		expect(body.input).toBe("embed this");
	});

	it("returns the embedding array", async () => {
		const expected = [0.1, 0.2, 0.3, 0.4, 0.5];
		const mockFetch = vi.fn().mockResolvedValue(
			jsonResponse({ data: [{ embedding: expected }] }),
		);

		const embedder = createOpenAIEmbedder({
			apiKey: "test-key",
			fetch: mockFetch,
		});
		const result = await embedder("test");

		expect(result).toEqual(expected);
	});

	it("throws on non-OK response with truncated error body", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			textResponse("Unauthorized: invalid API key", 401),
		);

		const embedder = createOpenAIEmbedder({
			apiKey: "bad-key",
			fetch: mockFetch,
		});

		await expect(embedder("test")).rejects.toThrow(/embedding failed: 401/i);
	});

	it("throws when response contains no data entries", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			jsonResponse({ data: [] }),
		);

		const embedder = createOpenAIEmbedder({
			apiKey: "test-key",
			fetch: mockFetch,
		});

		await expect(embedder("test")).rejects.toThrow(/no data entries/i);
	});

	it("uses default model and dimensions when not specified", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			jsonResponse({ data: [{ embedding: [0.1] }] }),
		);

		const embedder = createOpenAIEmbedder({
			apiKey: "test-key",
			fetch: mockFetch,
		});
		await embedder("test");

		const [, init] = mockFetch.mock.calls[0];
		const body = JSON.parse(init.body as string);

		expect(body.model).toBe("text-embedding-3-small");
		expect(body.dimensions).toBe(1536);
	});
});

// ============================================================================
// createOpenAIStreamingRunner
// ============================================================================

describe("createOpenAIStreamingRunner", () => {
	it("sends request with stream: true and stream_options", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			sseResponse([
				'data: {"choices":[{"delta":{"content":"Hi"}}]}',
				'data: {"usage":{"prompt_tokens":5,"completion_tokens":2}}',
				"data: [DONE]",
			]),
		);

		const streamingRunner = createOpenAIStreamingRunner({
			apiKey: "test-key",
			fetch: mockFetch,
		});

		await streamingRunner(mockAgent(), "Hello", {});

		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, init] = mockFetch.mock.calls[0];
		expect(url).toBe("https://api.openai.com/v1/chat/completions");

		const body = JSON.parse(init.body as string);
		expect(body.stream).toBe(true);
		expect(body.stream_options).toEqual({ include_usage: true });
	});

	it("passes apiKey as Bearer token", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			sseResponse([
				'data: {"choices":[{"delta":{"content":"ok"}}]}',
				'data: {"usage":{"prompt_tokens":3,"completion_tokens":1}}',
				"data: [DONE]",
			]),
		);

		const streamingRunner = createOpenAIStreamingRunner({
			apiKey: "sk-stream-key",
			fetch: mockFetch,
		});

		await streamingRunner(mockAgent(), "test", {});

		const [, init] = mockFetch.mock.calls[0];
		expect(init.headers).toEqual(
			expect.objectContaining({ Authorization: "Bearer sk-stream-key" }),
		);
	});

	it("accumulates streamed text and calls onToken for each delta", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			sseResponse([
				'data: {"choices":[{"delta":{"content":"Hello"}}]}',
				'data: {"choices":[{"delta":{"content":" world"}}]}',
				'data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}',
				"data: [DONE]",
			]),
		);

		const streamingRunner = createOpenAIStreamingRunner({
			apiKey: "test-key",
			fetch: mockFetch,
		});

		const tokens: string[] = [];
		const result = await streamingRunner(mockAgent(), "Hi", {
			onToken: (token) => tokens.push(token),
		});

		expect(tokens).toEqual(["Hello", " world"]);
		expect(result.output).toBe("Hello world");
		expect(result.totalTokens).toBe(15);
	});

	it("calls onMessage with the complete assistant message", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			sseResponse([
				'data: {"choices":[{"delta":{"content":"Done"}}]}',
				'data: {"usage":{"prompt_tokens":5,"completion_tokens":3}}',
				"data: [DONE]",
			]),
		);

		const streamingRunner = createOpenAIStreamingRunner({
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
		const mockFetch = vi.fn().mockResolvedValue(
			sseResponse([
				'data: {"choices":[{"delta":{"content":"reply"}}]}',
				'data: {"usage":{"prompt_tokens":5,"completion_tokens":2}}',
				"data: [DONE]",
			]),
		);

		const streamingRunner = createOpenAIStreamingRunner({
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
		const mockFetch = vi.fn().mockResolvedValue(
			textResponse("Rate limit exceeded", 429),
		);

		const streamingRunner = createOpenAIStreamingRunner({
			apiKey: "test-key",
			fetch: mockFetch,
		});

		await expect(
			streamingRunner(mockAgent(), "test", {}),
		).rejects.toThrow(/streaming error 429/i);
	});

	it("throws when response has no body", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			new Response(null, { status: 200, statusText: "OK" }),
		);

		const streamingRunner = createOpenAIStreamingRunner({
			apiKey: "test-key",
			fetch: mockFetch,
		});

		await expect(
			streamingRunner(mockAgent(), "test", {}),
		).rejects.toThrow(/no response body/i);
	});

	it("handles [DONE] signal gracefully", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			sseResponse([
				'data: {"choices":[{"delta":{"content":"first"}}]}',
				'data: {"choices":[{"delta":{"content":" second"}}]}',
				'data: {"usage":{"prompt_tokens":8,"completion_tokens":4}}',
				"data: [DONE]",
			]),
		);

		const streamingRunner = createOpenAIStreamingRunner({
			apiKey: "test-key",
			fetch: mockFetch,
		});

		const tokens: string[] = [];
		const result = await streamingRunner(mockAgent(), "test", {
			onToken: (token) => tokens.push(token),
		});

		expect(tokens).toEqual(["first", " second"]);
		expect(result.output).toBe("first second");
		expect(result.totalTokens).toBe(12);
	});

	it("handles malformed SSE lines without throwing", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			sseResponse([
				'data: {"choices":[{"delta":{"content":"ok"}}]}',
				"data: {not valid json!!!",
				'data: {"choices":[{"delta":{"content":" fine"}}]}',
				'data: {"usage":{"prompt_tokens":5,"completion_tokens":3}}',
				"data: [DONE]",
			]),
		);

		const streamingRunner = createOpenAIStreamingRunner({
			apiKey: "test-key",
			fetch: mockFetch,
		});

		const tokens: string[] = [];
		const result = await streamingRunner(mockAgent(), "test", {
			onToken: (token) => tokens.push(token),
		});

		expect(tokens).toEqual(["ok", " fine"]);
		expect(result.output).toBe("ok fine");
	});

	it("passes signal from callbacks", async () => {
		const controller = new AbortController();
		const mockFetch = vi.fn().mockResolvedValue(
			sseResponse([
				'data: {"choices":[{"delta":{"content":"ok"}}]}',
				'data: {"usage":{"prompt_tokens":3,"completion_tokens":1}}',
				"data: [DONE]",
			]),
		);

		const streamingRunner = createOpenAIStreamingRunner({
			apiKey: "test-key",
			fetch: mockFetch,
		});

		await streamingRunner(mockAgent(), "test", {
			signal: controller.signal,
		});

		const [, init] = mockFetch.mock.calls[0];
		expect(init.signal).toBe(controller.signal);
	});
});
