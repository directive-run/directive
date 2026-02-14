import { describe, expect, it, vi, beforeEach } from "vitest";
import {
	createSSETransport,
	type SSETransport,
	type SSEEvent,
} from "../adapters/ai/sse-transport.js";
import type { AgentStack, TokenStream } from "../adapters/ai/stack.js";
import type { RunResult } from "../adapters/ai/types.js";

// ============================================================================
// Helpers
// ============================================================================

/** Create a fake TokenStream that yields predetermined tokens. */
function fakeTokenStream(
	tokens: string[],
	opts?: { throwError?: Error; totalTokens?: number },
): TokenStream {
	let aborted = false;

	const stream: TokenStream = {
		[Symbol.asyncIterator]() {
			let i = 0;
			return {
				async next() {
					if (aborted || i >= tokens.length) {
						return { done: true, value: undefined };
					}
					if (opts?.throwError && i === tokens.length - 1) {
						throw opts.throwError;
					}
					return { done: false, value: tokens[i++]! };
				},
			};
		},
		result: Promise.resolve({
			output: tokens.join(""),
			messages: [],
			toolCalls: [],
			totalTokens: opts?.totalTokens ?? tokens.length * 10,
		} as RunResult<string>),
		abort() {
			aborted = true;
		},
	};

	return stream;
}

/** Create a fake AgentStack that returns a fake TokenStream. */
function fakeStack(tokens: string[], opts?: { throwError?: Error }): AgentStack {
	return {
		stream: vi.fn(
			(_agentId: string, _input: string, _options?: unknown) =>
				fakeTokenStream(tokens, opts),
		),
	} as unknown as AgentStack;
}

/** Create a fake stack that throws on stream() (e.g., guardrail failure). */
function fakeErrorStack(error: Error): AgentStack {
	return {
		stream: vi.fn(() => {
			throw error;
		}),
	} as unknown as AgentStack;
}

/** Read all SSE events from a ReadableStream. */
async function readSSEEvents(stream: ReadableStream<Uint8Array>): Promise<SSEEvent[]> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	const events: SSEEvent[] = [];
	let buf = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });

		const lines = buf.split("\n\n");
		buf = lines.pop() ?? "";

		for (const block of lines) {
			if (block.startsWith("data: ")) {
				const json = block.slice(6).trim();
				if (json) events.push(JSON.parse(json) as SSEEvent);
			}
		}
	}

	return events;
}

// ============================================================================
// toResponse()
// ============================================================================

describe("createSSETransport — toResponse()", () => {
	it("returns a Response with SSE headers", () => {
		const transport = createSSETransport();
		const stack = fakeStack(["hello"]);
		const response = transport.toResponse(stack, "agent", "input");

		expect(response).toBeInstanceOf(Response);
		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		expect(response.headers.get("Cache-Control")).toBe("no-cache");
		expect(response.headers.get("Connection")).toBe("keep-alive");
	});

	it("streams tokens as SSE text events", async () => {
		const transport = createSSETransport();
		const stack = fakeStack(["Hello", " ", "World"]);
		const response = transport.toResponse(stack, "agent", "input");

		const events = await readSSEEvents(response.body!);
		const textEvents = events.filter((e) => e.type === "text") as Array<{
			type: "text";
			text: string;
		}>;

		expect(textEvents).toHaveLength(3);
		expect(textEvents[0]!.text).toBe("Hello");
		expect(textEvents[1]!.text).toBe(" ");
		expect(textEvents[2]!.text).toBe("World");
	});

	it("emits done event after stream", async () => {
		const transport = createSSETransport();
		const stack = fakeStack(["hi"]);
		const response = transport.toResponse(stack, "agent", "input");

		const events = await readSSEEvents(response.body!);
		const doneEvents = events.filter((e) => e.type === "done");
		expect(doneEvents.length).toBeGreaterThanOrEqual(1);
	});

	it("truncates at maxResponseChars and sends exactly one done event", async () => {
		const transport = createSSETransport({
			maxResponseChars: 5,
			truncationMessage: "[TRUNCATED]",
		});
		const stack = fakeStack(["abc", "def", "ghi"]);
		const response = transport.toResponse(stack, "agent", "input");

		const events = await readSSEEvents(response.body!);

		// Truncation message is sent as a "truncated" event type
		const truncatedEvents = events.filter((e) => e.type === "truncated") as Array<{
			type: "truncated";
			text: string;
		}>;
		expect(truncatedEvents).toHaveLength(1);
		expect(truncatedEvents[0]!.text).toBe("[TRUNCATED]");

		// Should have exactly one done event (no double-done bug)
		const doneEvents = events.filter((e) => e.type === "done");
		expect(doneEvents).toHaveLength(1);
	});

	it("maps guardrail errors via errorMessages config", async () => {
		const guardrailError = Object.assign(new Error("blocked"), {
			code: "INPUT_GUARDRAIL_FAILED",
		});

		const transport = createSSETransport({
			errorMessages: {
				INPUT_GUARDRAIL_FAILED: "Your message was flagged.",
			},
		});
		const stack = fakeErrorStack(guardrailError);
		const response = transport.toResponse(stack, "agent", "input");

		const events = await readSSEEvents(response.body!);
		const errorEvent = events.find((e) => e.type === "error") as
			| { type: "error"; message: string }
			| undefined;

		expect(errorEvent).toBeDefined();
		expect(errorEvent!.message).toBe("Your message was flagged.");
	});

	it("uses function-based errorMessages", async () => {
		const transport = createSSETransport({
			errorMessages: (err) =>
				err instanceof Error ? `Custom: ${err.message}` : "Unknown",
		});
		const stack = fakeErrorStack(new Error("boom"));
		const response = transport.toResponse(stack, "agent", "input");

		const events = await readSSEEvents(response.body!);
		const errorEvent = events.find((e) => e.type === "error") as
			| { type: "error"; message: string }
			| undefined;

		expect(errorEvent!.message).toBe("Custom: boom");
	});

	it("uses default error message for unknown errors", async () => {
		const transport = createSSETransport();
		const stack = fakeErrorStack(new Error("something"));
		const response = transport.toResponse(stack, "agent", "input");

		const events = await readSSEEvents(response.body!);
		const errorEvent = events.find((e) => e.type === "error") as
			| { type: "error"; message: string }
			| undefined;

		expect(errorEvent).toBeDefined();
		expect(errorEvent!.message).toContain("temporarily unavailable");
	});

	it("uses default truncation message when none is configured", async () => {
		const transport = createSSETransport({
			maxResponseChars: 3,
		});
		const stack = fakeStack(["abcd", "efgh"]);
		const response = transport.toResponse(stack, "agent", "input");

		const events = await readSSEEvents(response.body!);
		const truncatedEvent = events.find((e) => e.type === "truncated") as
			| { type: "truncated"; text: string }
			| undefined;

		expect(truncatedEvent).toBeDefined();
		expect(truncatedEvent!.text).toBe("\n\n*[Response truncated]*");
	});

	it("abort signal stops token iteration", async () => {
		const controller = new AbortController();
		let tokensYielded = 0;
		let aborted = false;

		const slowStream: TokenStream = {
			[Symbol.asyncIterator]() {
				return {
					async next() {
						if (aborted) {
							return { done: true, value: undefined };
						}
						tokensYielded++;
						if (tokensYielded > 10) {
							return { done: true, value: undefined };
						}
						// Abort after second token
						if (tokensYielded === 2) {
							controller.abort();
						}

						return { done: false, value: `token${tokensYielded}` };
					},
				};
			},
			result: Promise.resolve({
				output: "",
				messages: [],
				toolCalls: [],
				totalTokens: 0,
			} as RunResult<string>),
			abort() {
				aborted = true;
			},
		};

		const stack = {
			stream: vi.fn((_a: string, _b: string, opts?: { signal?: AbortSignal }) => {
				if (opts?.signal) {
					opts.signal.addEventListener("abort", () => {
						slowStream.abort();
					});
				}

				return slowStream;
			}),
		} as unknown as AgentStack;

		const transport = createSSETransport();
		const response = transport.toResponse(stack, "agent", "input", {
			signal: controller.signal,
		});

		const events = await readSSEEvents(response.body!);
		const textEvents = events.filter((e) => e.type === "text");

		// Should have stopped early — not all 10 tokens
		expect(textEvents.length).toBeLessThan(10);
		expect(textEvents.length).toBeGreaterThan(0);
	});

	it("falls back to default message when errorMessages function throws", async () => {
		const transport = createSSETransport({
			errorMessages: () => {
				throw new Error("mapper exploded");
			},
		});
		const stack = fakeErrorStack(new Error("original"));
		const response = transport.toResponse(stack, "agent", "input");

		const events = await readSSEEvents(response.body!);
		const errorEvent = events.find((e) => e.type === "error") as
			| { type: "error"; message: string }
			| undefined;

		expect(errorEvent).toBeDefined();
		expect(errorEvent!.message).toContain("temporarily unavailable");
	});

	it("merges custom headers", () => {
		const transport = createSSETransport({
			headers: { "X-Custom": "test" },
		});
		const stack = fakeStack([]);
		const response = transport.toResponse(stack, "agent", "input");

		expect(response.headers.get("X-Custom")).toBe("test");
		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
	});
});

// ============================================================================
// toStream()
// ============================================================================

describe("createSSETransport — toStream()", () => {
	it("returns a ReadableStream", () => {
		const transport = createSSETransport();
		const stack = fakeStack(["hi"]);
		const stream = transport.toStream(stack, "agent", "input");

		expect(stream).toBeInstanceOf(ReadableStream);
	});

	it("produces the same SSE events as toResponse", async () => {
		const transport = createSSETransport();
		const stack1 = fakeStack(["A", "B"]);
		const stack2 = fakeStack(["A", "B"]);

		const responseEvents = await readSSEEvents(
			transport.toResponse(stack1, "agent", "input").body!,
		);
		const streamEvents = await readSSEEvents(
			transport.toStream(stack2, "agent", "input"),
		);

		// Both should have the same text events
		const responseTexts = responseEvents
			.filter((e) => e.type === "text")
			.map((e) => (e as { text: string }).text);
		const streamTexts = streamEvents
			.filter((e) => e.type === "text")
			.map((e) => (e as { text: string }).text);

		expect(responseTexts).toEqual(streamTexts);
	});
});

// ============================================================================
// Heartbeat
// ============================================================================

describe("createSSETransport — heartbeat", () => {
	it("sends heartbeat events at interval", async () => {
		vi.useFakeTimers();

		// Use a slow token stream to allow heartbeats to fire
		let resolveToken: ((v: IteratorResult<string>) => void) | null = null;
		let tokenCount = 0;
		const totalTokens = 2;

		const slowStream: TokenStream = {
			[Symbol.asyncIterator]() {
				return {
					async next() {
						if (tokenCount >= totalTokens) {
							return { done: true as const, value: undefined };
						}
						return new Promise<IteratorResult<string>>((resolve) => {
							resolveToken = resolve;
						});
					},
				};
			},
			result: Promise.resolve({
				output: "ab",
				messages: [],
				toolCalls: [],
				totalTokens: 20,
			} as RunResult<string>),
			abort() {},
		};

		const stack = {
			stream: vi.fn(() => slowStream),
		} as unknown as AgentStack;

		const transport = createSSETransport({ heartbeatIntervalMs: 100 });
		const stream = transport.toStream(stack, "agent", "input");
		const reader = stream.getReader();

		// Advance time to fire heartbeats
		await vi.advanceTimersByTimeAsync(250);

		// Resolve tokens to finish the stream
		if (resolveToken) {
			tokenCount++;
			resolveToken({ done: false, value: "a" });
		}
		await vi.advanceTimersByTimeAsync(10);
		if (resolveToken) {
			tokenCount++;
			resolveToken({ done: false, value: "b" });
		}
		await vi.advanceTimersByTimeAsync(10);

		// Read everything
		const decoder = new TextDecoder();
		let allText = "";
		// Read with a timeout to avoid hanging
		const readWithTimeout = async () => {
			while (true) {
				const readPromise = reader.read();
				await vi.advanceTimersByTimeAsync(100);
				const { done, value } = await readPromise;
				if (done) break;
				allText += decoder.decode(value, { stream: true });
			}
		};
		await readWithTimeout();

		// Should contain at least one heartbeat event with timestamp
		expect(allText).toContain('"type":"heartbeat"');
		expect(allText).toContain('"timestamp":');

		vi.useRealTimers();
	});
});

// ============================================================================
// Abort signal propagation
// ============================================================================

describe("createSSETransport — abort", () => {
	it("passes abort signal to stack.stream()", () => {
		const transport = createSSETransport();
		const stack = fakeStack(["hi"]);
		const controller = new AbortController();

		transport.toResponse(stack, "agent", "input", {
			signal: controller.signal,
		});

		// Verify signal was passed through
		const streamCall = (stack.stream as ReturnType<typeof vi.fn>).mock
			.calls[0]!;
		expect(streamCall[2]).toEqual({ signal: controller.signal });
	});
});

// ============================================================================
// Input validation
// ============================================================================

describe("createSSETransport — input validation", () => {
	it("throws RangeError for negative maxResponseChars", () => {
		expect(() => createSSETransport({ maxResponseChars: -1 })).toThrow(
			RangeError,
		);
	});

	it("throws RangeError for negative heartbeatIntervalMs", () => {
		expect(() => createSSETransport({ heartbeatIntervalMs: -1 })).toThrow(
			RangeError,
		);
	});
});
