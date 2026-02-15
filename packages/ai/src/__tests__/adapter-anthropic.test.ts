import { describe, it, expect, vi } from "vitest";
import {
	createAnthropicRunner,
	createAnthropicStreamingRunner,
} from "../adapters/anthropic.js";

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
		const [url] = mockFetch.mock.calls[0];
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

		const [, init] = mockFetch.mock.calls[0];
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

		const [, init] = mockFetch.mock.calls[0];
		const body = JSON.parse(init.body as string);

		expect(body.model).toBe("claude-sonnet-4-5-20250929");
		expect(body.max_tokens).toBe(4096);
		expect(body.system).toBe("Be brief.");
		expect(body.messages).toEqual([
			{ role: "user", content: "What is 2+2?" },
		]);
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
		await runner(mockAgent({ model: "claude-haiku-3-5-20241022" }), "test");

		const [, init] = mockFetch.mock.calls[0];
		const body = JSON.parse(init.body as string);

		expect(body.model).toBe("claude-haiku-3-5-20241022");
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
		const mockFetch = vi.fn().mockResolvedValue(
			textResponse("Rate limit exceeded", 429),
		);

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

		const [url] = mockFetch.mock.calls[0];
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

		const [, init] = mockFetch.mock.calls[0];
		const body = JSON.parse(init.body as string);

		expect(body.max_tokens).toBe(8192);
	});
});

// ============================================================================
// createAnthropicStreamingRunner
// ============================================================================

describe("createAnthropicStreamingRunner", () => {
	it("sends request to the correct URL with stream: true", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			sseResponse([
				'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
				'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
				'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}',
				'data: {"type":"message_delta","usage":{"output_tokens":5}}',
			]),
		);

		const streamingRunner = createAnthropicStreamingRunner({
			apiKey: "test-key",
			fetch: mockFetch,
		});

		await streamingRunner(mockAgent(), "Hi", {});

		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, init] = mockFetch.mock.calls[0];
		expect(url).toBe("https://api.anthropic.com/v1/messages");

		const body = JSON.parse(init.body as string);
		expect(body.stream).toBe(true);
	});

	it("passes x-api-key and anthropic-version headers", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			sseResponse([
				'data: {"type":"message_start","message":{"usage":{"input_tokens":5}}}',
				'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}',
				'data: {"type":"message_delta","usage":{"output_tokens":2}}',
			]),
		);

		const streamingRunner = createAnthropicStreamingRunner({
			apiKey: "sk-ant-stream",
			fetch: mockFetch,
		});

		await streamingRunner(mockAgent(), "test", {});

		const [, init] = mockFetch.mock.calls[0];
		expect(init.headers).toEqual(
			expect.objectContaining({
				"x-api-key": "sk-ant-stream",
				"anthropic-version": "2023-06-01",
			}),
		);
	});

	it("accumulates streamed text and calls onToken for each delta", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			sseResponse([
				'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
				'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
				'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}',
				'data: {"type":"message_delta","usage":{"output_tokens":5}}',
			]),
		);

		const streamingRunner = createAnthropicStreamingRunner({
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
				'data: {"type":"message_start","message":{"usage":{"input_tokens":5}}}',
				'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Done"}}',
				'data: {"type":"message_delta","usage":{"output_tokens":3}}',
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
		const mockFetch = vi.fn().mockResolvedValue(
			sseResponse([
				'data: {"type":"message_start","message":{"usage":{"input_tokens":5}}}',
				'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"reply"}}',
				'data: {"type":"message_delta","usage":{"output_tokens":2}}',
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
		const mockFetch = vi.fn().mockResolvedValue(
			textResponse("Overloaded", 529),
		);

		const streamingRunner = createAnthropicStreamingRunner({
			apiKey: "test-key",
			fetch: mockFetch,
		});

		await expect(
			streamingRunner(mockAgent(), "test", {}),
		).rejects.toThrow(/streaming error 529/i);
	});

	it("throws when response has no body", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			new Response(null, { status: 200, statusText: "OK" }),
		);

		const streamingRunner = createAnthropicStreamingRunner({
			apiKey: "test-key",
			fetch: mockFetch,
		});

		await expect(
			streamingRunner(mockAgent(), "test", {}),
		).rejects.toThrow(/no response body/i);
	});
});
