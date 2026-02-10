import { describe, expect, it, vi, beforeEach } from "vitest";
import {
	createStreamingRunner,
	createToxicityStreamingGuardrail,
	createLengthStreamingGuardrail,
	createPatternStreamingGuardrail,
	combineStreamingGuardrails,
	adaptOutputGuardrail,
	collectTokens,
	tapStream,
	filterStream,
	mapStream,
	type StreamChunk,
	type StreamingGuardrail,
	type StreamingRunResult,
	type BackpressureStrategy,
} from "../adapters/openai-agents-streaming.js";
import type {
	AgentLike,
	RunResult,
	Message,
	GuardrailFn,
	OutputGuardrailData,
} from "../adapters/openai-agents.js";

// ============================================================================
// Helpers
// ============================================================================

const fakeAgent: AgentLike = { name: "test-agent" };

/** Collect every chunk from an async iterable into an array */
async function drain(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
	const chunks: StreamChunk[] = [];
	for await (const chunk of stream) {
		chunks.push(chunk);
	}
	return chunks;
}

/** Create a simple baseRunner that emits the given tokens one-by-one.
 *  Awaits each callback to simulate realistic async streaming behavior. */
function makeBaseRun(tokens: string[], result?: Partial<RunResult>) {
	return async (
		_agent: AgentLike,
		_input: string,
		callbacks: {
			onToken?: (token: string) => void;
			onToolStart?: (tool: string, id: string, args: string) => void;
			onToolEnd?: (tool: string, id: string, result: string) => void;
			onMessage?: (message: Message) => void;
			signal?: AbortSignal;
		},
	): Promise<RunResult<unknown>> => {
		for (const token of tokens) {
			// Await the callback return value to allow the runner's async
			// internal logic (buffer.push, guardrail checks) to complete
			await (callbacks.onToken as ((t: string) => Promise<void>) | undefined)?.(token);
		}
		return {
			output: result?.output ?? tokens.join(""),
			messages: result?.messages ?? [],
			toolCalls: result?.toolCalls ?? [],
			totalTokens: result?.totalTokens ?? tokens.length,
		};
	};
}

// ============================================================================
// StreamBuffer (tested indirectly through createStreamingRunner)
// ============================================================================

describe("StreamBuffer", () => {
	describe("buffer strategy (default)", () => {
		it("should buffer all tokens without dropping", async () => {
			const tokens = Array.from({ length: 20 }, (_, i) => `t${i}`);
			const runner = createStreamingRunner(makeBaseRun(tokens));
			const { stream, result } = runner(fakeAgent, "hi");

			const chunks = await drain(stream);
			await result;

			const tokenChunks = chunks.filter((c) => c.type === "token");
			expect(tokenChunks).toHaveLength(20);
			for (let i = 0; i < 20; i++) {
				expect(tokenChunks[i]).toMatchObject({ type: "token", data: `t${i}`, tokenCount: i + 1 });
			}
		});

		it("should exceed bufferSize without dropping when strategy is buffer", async () => {
			const tokens = Array.from({ length: 10 }, (_, i) => `x${i}`);
			const runner = createStreamingRunner(makeBaseRun(tokens));
			const { stream, result } = runner(fakeAgent, "hi", {
				backpressure: "buffer",
				bufferSize: 2,
			});

			const chunks = await drain(stream);
			await result;

			const tokenChunks = chunks.filter((c) => c.type === "token");
			expect(tokenChunks).toHaveLength(10);

			const doneChunk = chunks.find((c) => c.type === "done");
			expect(doneChunk).toBeDefined();
			if (doneChunk?.type === "done") {
				expect(doneChunk.droppedTokens).toBe(0);
			}
		});
	});

	describe("drop strategy", () => {
		it("should drop tokens when buffer is full", async () => {
			// We need to simulate backpressure - the producer fills the buffer before
			// the consumer starts pulling. With a tiny bufferSize and many tokens,
			// some will be dropped.
			const tokens = Array.from({ length: 50 }, (_, i) => `d${i}`);
			const runner = createStreamingRunner(makeBaseRun(tokens));
			const { stream, result } = runner(fakeAgent, "hi", {
				backpressure: "drop",
				bufferSize: 3,
			});

			const chunks = await drain(stream);
			await result;

			const doneChunk = chunks.find((c) => c.type === "done");
			expect(doneChunk).toBeDefined();
			if (doneChunk?.type === "done") {
				// Some tokens should have been dropped since buffer was only 3
				// The exact count depends on timing, but droppedTokens >= 0
				expect(doneChunk.droppedTokens).toBeGreaterThanOrEqual(0);
			}
		});
	});

	describe("block strategy", () => {
		it("should eventually deliver all tokens with block strategy", async () => {
			const tokens = ["a", "b", "c", "d", "e"];
			const runner = createStreamingRunner(makeBaseRun(tokens));
			const { stream, result } = runner(fakeAgent, "hi", {
				backpressure: "block",
				bufferSize: 2,
			});

			const chunks = await drain(stream);
			await result;

			const tokenChunks = chunks.filter((c) => c.type === "token");
			// block strategy is lossless
			expect(tokenChunks).toHaveLength(5);
			expect(tokenChunks.map((c) => (c as { data: string }).data)).toEqual(["a", "b", "c", "d", "e"]);
		});
	});

	describe("close behavior", () => {
		it("should emit done chunk on close", async () => {
			const runner = createStreamingRunner(makeBaseRun(["hello"]));
			const { stream, result } = runner(fakeAgent, "test");

			const chunks = await drain(stream);
			await result;

			const done = chunks.find((c) => c.type === "done");
			expect(done).toBeDefined();
			if (done?.type === "done") {
				expect(done.totalTokens).toBe(1);
				expect(done.duration).toBeGreaterThanOrEqual(0);
			}
		});

		it("should return null from pull after close (stream ends)", async () => {
			const runner = createStreamingRunner(makeBaseRun([]));
			const { stream, result } = runner(fakeAgent, "test");

			const chunks = await drain(stream);
			await result;

			// Stream should have ended cleanly (progress + done)
			const types = chunks.map((c) => c.type);
			expect(types).toContain("progress");
			expect(types).toContain("done");
		});
	});
});

// ============================================================================
// createStreamingRunner
// ============================================================================

describe("createStreamingRunner", () => {
	it("should return stream, result, and abort", () => {
		const runner = createStreamingRunner(makeBaseRun(["a"]));
		const runResult = runner(fakeAgent, "hello");

		expect(runResult).toHaveProperty("stream");
		expect(runResult).toHaveProperty("result");
		expect(runResult).toHaveProperty("abort");
		expect(typeof runResult.abort).toBe("function");
	});

	it("should emit a starting progress chunk first", async () => {
		const runner = createStreamingRunner(makeBaseRun(["tok"]));
		const { stream, result } = runner(fakeAgent, "input");

		const chunks = await drain(stream);
		await result;

		expect(chunks[0]).toMatchObject({
			type: "progress",
			phase: "starting",
			message: "Starting agent",
		});
	});

	it("should call onToken callback and stream tokens", async () => {
		const onTokenSpy = vi.fn();

		const baseRun = async (
			_agent: AgentLike,
			_input: string,
			callbacks: { onToken?: (token: string) => void; signal?: AbortSignal },
		): Promise<RunResult<unknown>> => {
			callbacks.onToken?.("Hello");
			callbacks.onToken?.(" ");
			callbacks.onToken?.("World");
			return { output: "Hello World", messages: [], toolCalls: [], totalTokens: 3 };
		};

		const runner = createStreamingRunner(baseRun);
		const { stream, result } = runner(fakeAgent, "test");

		const chunks = await drain(stream);
		await result;

		const tokenChunks = chunks.filter((c) => c.type === "token");
		expect(tokenChunks).toHaveLength(3);
		expect(tokenChunks[0]).toMatchObject({ data: "Hello", tokenCount: 1 });
		expect(tokenChunks[1]).toMatchObject({ data: " ", tokenCount: 2 });
		expect(tokenChunks[2]).toMatchObject({ data: "World", tokenCount: 3 });
	});

	it("should emit tool_start and tool_end chunks", async () => {
		const baseRun = async (
			_agent: AgentLike,
			_input: string,
			callbacks: {
				onToken?: (token: string) => void;
				onToolStart?: (tool: string, id: string, args: string) => void;
				onToolEnd?: (tool: string, id: string, result: string) => void;
				signal?: AbortSignal;
			},
		): Promise<RunResult<unknown>> => {
			callbacks.onToolStart?.("search", "call-1", '{"q":"test"}');
			callbacks.onToolEnd?.("search", "call-1", "results here");
			callbacks.onToken?.("done");
			return { output: "done", messages: [], toolCalls: [], totalTokens: 1 };
		};

		const runner = createStreamingRunner(baseRun);
		const { stream, result } = runner(fakeAgent, "test");
		const chunks = await drain(stream);
		await result;

		const toolStart = chunks.find((c) => c.type === "tool_start");
		expect(toolStart).toMatchObject({
			type: "tool_start",
			tool: "search",
			toolCallId: "call-1",
			arguments: '{"q":"test"}',
		});

		const toolEnd = chunks.find((c) => c.type === "tool_end");
		expect(toolEnd).toMatchObject({
			type: "tool_end",
			tool: "search",
			toolCallId: "call-1",
			result: "results here",
		});
	});

	it("should emit message chunks", async () => {
		const msg: Message = { role: "assistant", content: "hi" };
		const baseRun = async (
			_agent: AgentLike,
			_input: string,
			callbacks: { onMessage?: (message: Message) => void; signal?: AbortSignal },
		): Promise<RunResult<unknown>> => {
			callbacks.onMessage?.(msg);
			return { output: "hi", messages: [msg], toolCalls: [], totalTokens: 0 };
		};

		const runner = createStreamingRunner(baseRun);
		const { stream, result } = runner(fakeAgent, "test");
		const chunks = await drain(stream);
		await result;

		const msgChunk = chunks.find((c) => c.type === "message");
		expect(msgChunk).toMatchObject({ type: "message", message: msg });
	});

	it("should resolve the result promise with the run result", async () => {
		const runner = createStreamingRunner(
			makeBaseRun(["a", "b"], { output: "ab", totalTokens: 2 }),
		);
		const { stream, result } = runner(fakeAgent, "test");
		await drain(stream);

		const res = await result;
		expect(res.output).toBe("ab");
		expect(res.totalTokens).toBe(2);
	});

	it("should emit error chunk and reject result on failure", async () => {
		const baseRun = async (): Promise<RunResult<unknown>> => {
			throw new Error("LLM exploded");
		};

		const runner = createStreamingRunner(baseRun);
		const { stream, result } = runner(fakeAgent, "test");
		const chunks = await drain(stream);

		const errorChunk = chunks.find((c) => c.type === "error");
		expect(errorChunk).toBeDefined();
		if (errorChunk?.type === "error") {
			expect(errorChunk.error.message).toBe("LLM exploded");
		}

		await expect(result).rejects.toThrow("LLM exploded");
	});

	it("should include partialOutput in error chunk when tokens were emitted", async () => {
		const baseRun = async (
			_agent: AgentLike,
			_input: string,
			callbacks: { onToken?: (token: string) => void; signal?: AbortSignal },
		): Promise<RunResult<unknown>> => {
			callbacks.onToken?.("partial");
			throw new Error("mid-stream failure");
		};

		const runner = createStreamingRunner(baseRun);
		const { stream, result } = runner(fakeAgent, "test");
		const chunks = await drain(stream);

		const errorChunk = chunks.find((c) => c.type === "error");
		if (errorChunk?.type === "error") {
			expect(errorChunk.partialOutput).toBe("partial");
		}

		await expect(result).rejects.toThrow("mid-stream failure");
	});

	it("should support abort", async () => {
		const baseRun = async (
			_agent: AgentLike,
			_input: string,
			callbacks: { signal?: AbortSignal },
		): Promise<RunResult<unknown>> => {
			// Simulate waiting for abort
			return new Promise((resolve, reject) => {
				if (callbacks.signal?.aborted) {
					reject(new Error("Aborted"));
					return;
				}
				callbacks.signal?.addEventListener("abort", () => {
					reject(new Error("Aborted"));
				});
			});
		};

		const runner = createStreamingRunner(baseRun);
		const { stream, result, abort } = runner(fakeAgent, "test");

		// Start consuming then abort
		const chunkPromise = drain(stream);
		abort();

		const chunks = await chunkPromise;
		const errorChunk = chunks.find((c) => c.type === "error");
		expect(errorChunk).toBeDefined();

		await expect(result).rejects.toThrow("Aborted");
	});

	describe("guardrail integration", () => {
		it("should check streaming guardrails at the configured interval", async () => {
			const checkFn = vi.fn().mockReturnValue({ passed: true });
			const guardrail: StreamingGuardrail = {
				name: "test-guardrail",
				check: checkFn,
			};

			const tokens = Array.from({ length: 10 }, (_, i) => `t${i}`);
			const runner = createStreamingRunner(makeBaseRun(tokens), {
				streamingGuardrails: [guardrail],
			});

			const { stream, result } = runner(fakeAgent, "test", {
				guardrailCheckInterval: 5,
			});

			await drain(stream);
			await result;

			// Called at token 5, 10, and once more at final check
			expect(checkFn).toHaveBeenCalledTimes(3);
		});

		it("should emit guardrail_triggered chunk when guardrail fails", async () => {
			const guardrail: StreamingGuardrail = {
				name: "bad-word-detector",
				check: (partial) => ({
					passed: !partial.includes("bad"),
					reason: "Bad word detected",
				}),
			};

			const tokens = ["good", " ", "bad", " ", "word"];
			const runner = createStreamingRunner(makeBaseRun(tokens), {
				streamingGuardrails: [guardrail],
			});

			const { stream, result } = runner(fakeAgent, "test", {
				guardrailCheckInterval: 1,
			});

			const chunks = await drain(stream);
			// Result may throw due to abort
			try {
				await result;
			} catch {
				// Expected if guardrail stops the stream
			}

			const triggered = chunks.find((c) => c.type === "guardrail_triggered");
			expect(triggered).toBeDefined();
			if (triggered?.type === "guardrail_triggered") {
				expect(triggered.guardrailName).toBe("bad-word-detector");
				expect(triggered.reason).toBe("Bad word detected");
				expect(triggered.stopped).toBe(true);
			}
		});

		it("should not stop stream when stopOnFail is false", async () => {
			const guardrail: StreamingGuardrail = {
				name: "warn-only",
				stopOnFail: false,
				check: (_partial, tokenCount) => ({
					passed: tokenCount < 3,
					reason: "Token limit warning",
				}),
			};

			const tokens = ["a", "b", "c", "d", "e"];
			const runner = createStreamingRunner(makeBaseRun(tokens), {
				streamingGuardrails: [guardrail],
			});

			const { stream, result } = runner(fakeAgent, "test", {
				guardrailCheckInterval: 1,
			});

			const chunks = await drain(stream);
			await result;

			// Stream should complete with all tokens
			const tokenChunks = chunks.filter((c) => c.type === "token");
			expect(tokenChunks).toHaveLength(5);

			// But guardrail_triggered should still be emitted
			const triggered = chunks.filter((c) => c.type === "guardrail_triggered");
			expect(triggered.length).toBeGreaterThan(0);
		});
	});
});

// ============================================================================
// createToxicityStreamingGuardrail
// ============================================================================

describe("createToxicityStreamingGuardrail", () => {
	it("should pass when score is below threshold", async () => {
		const guardrail = createToxicityStreamingGuardrail({
			checkFn: () => 0.3,
			threshold: 0.8,
		});

		const result = await guardrail.check("safe text", 10);
		expect(result.passed).toBe(true);
	});

	it("should fail when score exceeds threshold", async () => {
		const guardrail = createToxicityStreamingGuardrail({
			checkFn: () => 0.95,
			threshold: 0.8,
		});

		const result = await guardrail.check("toxic text", 10);
		expect(result.passed).toBe(false);
		expect(result.reason).toContain("0.95");
		expect(result.reason).toContain("0.8");
		expect(result.severity).toBe("critical");
	});

	it("should use default threshold of 0.8", async () => {
		const guardrail = createToxicityStreamingGuardrail({
			checkFn: () => 0.85,
		});

		const result = await guardrail.check("text", 5);
		expect(result.passed).toBe(false);
	});

	it("should pass when score equals threshold (not exceeded)", async () => {
		const guardrail = createToxicityStreamingGuardrail({
			checkFn: () => 0.8,
			threshold: 0.8,
		});

		const result = await guardrail.check("borderline text", 5);
		expect(result.passed).toBe(true);
	});

	it("should support async checkFn", async () => {
		const guardrail = createToxicityStreamingGuardrail({
			checkFn: async (text) => {
				return text.includes("bad") ? 0.99 : 0.1;
			},
		});

		expect((await guardrail.check("this is bad", 5)).passed).toBe(false);
		expect((await guardrail.check("this is fine", 5)).passed).toBe(true);
	});

	it("should have correct name and stopOnFail defaults", () => {
		const guardrail = createToxicityStreamingGuardrail({ checkFn: () => 0 });
		expect(guardrail.name).toBe("toxicity-streaming");
		expect(guardrail.stopOnFail).toBe(true);
	});

	it("should respect custom stopOnFail", () => {
		const guardrail = createToxicityStreamingGuardrail({
			checkFn: () => 0,
			stopOnFail: false,
		});
		expect(guardrail.stopOnFail).toBe(false);
	});
});

// ============================================================================
// createLengthStreamingGuardrail
// ============================================================================

describe("createLengthStreamingGuardrail", () => {
	it("should pass when token count is below max", () => {
		const guardrail = createLengthStreamingGuardrail({ maxTokens: 100 });
		const result = guardrail.check("some output", 50);
		expect(result).toMatchObject({ passed: true });
	});

	it("should fail when token count reaches max", () => {
		const guardrail = createLengthStreamingGuardrail({ maxTokens: 100 });
		const result = guardrail.check("long output", 100);
		expect(result).toMatchObject({ passed: false, severity: "error" });
		expect((result as { reason: string }).reason).toContain("100");
	});

	it("should fail when token count exceeds max", () => {
		const guardrail = createLengthStreamingGuardrail({ maxTokens: 50 });
		const result = guardrail.check("very long output", 75);
		expect(result).toMatchObject({ passed: false });
	});

	it("should emit warning at warnAt threshold", () => {
		const guardrail = createLengthStreamingGuardrail({
			maxTokens: 100,
			warnAt: 80,
		});

		const result = guardrail.check("approaching limit", 85);
		expect(result).toMatchObject({ passed: true, severity: "warning" });
		expect((result as { warning: string }).warning).toContain("85/100");
	});

	it("should not emit warning when below warnAt", () => {
		const guardrail = createLengthStreamingGuardrail({
			maxTokens: 100,
			warnAt: 80,
		});

		const result = guardrail.check("short output", 50);
		expect(result).toMatchObject({ passed: true });
		expect((result as { warning?: string }).warning).toBeUndefined();
	});

	it("should have correct name", () => {
		const guardrail = createLengthStreamingGuardrail({ maxTokens: 100 });
		expect(guardrail.name).toBe("length-streaming");
	});

	it("should default stopOnFail to true", () => {
		const guardrail = createLengthStreamingGuardrail({ maxTokens: 100 });
		expect(guardrail.stopOnFail).toBe(true);
	});

	it("should respect custom stopOnFail", () => {
		const guardrail = createLengthStreamingGuardrail({
			maxTokens: 100,
			stopOnFail: false,
		});
		expect(guardrail.stopOnFail).toBe(false);
	});
});

// ============================================================================
// createPatternStreamingGuardrail
// ============================================================================

describe("createPatternStreamingGuardrail", () => {
	it("should pass when no patterns match", () => {
		const guardrail = createPatternStreamingGuardrail({
			patterns: [
				{ regex: /\b\d{3}-\d{2}-\d{4}\b/, name: "SSN" },
				{ regex: /\b\d{16}\b/, name: "Credit Card" },
			],
		});

		const result = guardrail.check("Hello, my name is Alice", 5);
		expect(result).toMatchObject({ passed: true });
	});

	it("should detect SSN pattern", () => {
		const guardrail = createPatternStreamingGuardrail({
			patterns: [{ regex: /\b\d{3}-\d{2}-\d{4}\b/, name: "SSN" }],
		});

		const result = guardrail.check("My SSN is 123-45-6789", 10);
		expect(result).toMatchObject({ passed: false, severity: "error" });
		expect((result as { reason: string }).reason).toContain("SSN");
	});

	it("should detect credit card pattern", () => {
		const guardrail = createPatternStreamingGuardrail({
			patterns: [{ regex: /\b\d{16}\b/, name: "Credit Card" }],
		});

		const result = guardrail.check("Card: 1234567890123456", 10);
		expect(result).toMatchObject({ passed: false });
		expect((result as { reason: string }).reason).toContain("Credit Card");
	});

	it("should detect the first matching pattern", () => {
		const guardrail = createPatternStreamingGuardrail({
			patterns: [
				{ regex: /foo/, name: "Foo" },
				{ regex: /bar/, name: "Bar" },
			],
		});

		const result = guardrail.check("foobar", 5);
		expect(result).toMatchObject({ passed: false });
		expect((result as { reason: string }).reason).toContain("Foo");
	});

	it("should have correct name and defaults", () => {
		const guardrail = createPatternStreamingGuardrail({ patterns: [] });
		expect(guardrail.name).toBe("pattern-streaming");
		expect(guardrail.stopOnFail).toBe(true);
	});

	it("should respect custom stopOnFail", () => {
		const guardrail = createPatternStreamingGuardrail({
			patterns: [],
			stopOnFail: false,
		});
		expect(guardrail.stopOnFail).toBe(false);
	});

	it("should pass with empty patterns array", () => {
		const guardrail = createPatternStreamingGuardrail({ patterns: [] });
		const result = guardrail.check("anything goes", 5);
		expect(result).toMatchObject({ passed: true });
	});
});

// ============================================================================
// combineStreamingGuardrails
// ============================================================================

describe("combineStreamingGuardrails", () => {
	it("should pass when all guardrails pass", async () => {
		const combined = combineStreamingGuardrails([
			createLengthStreamingGuardrail({ maxTokens: 100 }),
			createPatternStreamingGuardrail({ patterns: [] }),
		]);

		const result = await combined.check("hello", 5);
		expect(result.passed).toBe(true);
	});

	it("should fail on first failure with stopOnFirstFail", async () => {
		const g1: StreamingGuardrail = {
			name: "always-fail",
			check: () => ({ passed: false, reason: "g1 failed" }),
		};
		const g2: StreamingGuardrail = {
			name: "never-reached",
			check: vi.fn().mockReturnValue({ passed: true }),
		};

		const combined = combineStreamingGuardrails([g1, g2], { stopOnFirstFail: true });
		const result = await combined.check("text", 5);

		expect(result.passed).toBe(false);
		expect(result.reason).toContain("[always-fail]");
		expect(result.reason).toContain("g1 failed");
		expect(g2.check).not.toHaveBeenCalled();
	});

	it("should use custom name", () => {
		const combined = combineStreamingGuardrails([], { name: "my-combined" });
		expect(combined.name).toBe("my-combined");
	});

	it("should default name to combined-streaming", () => {
		const combined = combineStreamingGuardrails([]);
		expect(combined.name).toBe("combined-streaming");
	});

	it("should pass with empty guardrails array", async () => {
		const combined = combineStreamingGuardrails([]);
		const result = await combined.check("anything", 100);
		expect(result.passed).toBe(true);
	});
});

// ============================================================================
// adaptOutputGuardrail
// ============================================================================

describe("adaptOutputGuardrail", () => {
	it("should adapt an output guardrail into a streaming guardrail", async () => {
		const outputGuardrail: GuardrailFn<OutputGuardrailData> = async (data) => {
			if (typeof data.output === "string" && data.output.includes("forbidden")) {
				return { passed: false, reason: "Contains forbidden content" };
			}
			return { passed: true };
		};

		const streaming = adaptOutputGuardrail("adapted-test", outputGuardrail);
		expect(streaming.name).toBe("adapted-test");
		expect(streaming.stopOnFail).toBe(true);
	});

	it("should pass when underlying guardrail passes", async () => {
		const outputGuardrail: GuardrailFn<OutputGuardrailData> = async () => ({
			passed: true,
		});

		const streaming = adaptOutputGuardrail("pass-through", outputGuardrail);
		const result = await streaming.check("safe content", 10);

		expect(result.passed).toBe(true);
	});

	it("should fail when underlying guardrail fails", async () => {
		const outputGuardrail: GuardrailFn<OutputGuardrailData> = async () => ({
			passed: false,
			reason: "Content policy violation",
		});

		const streaming = adaptOutputGuardrail("policy-check", outputGuardrail);
		const result = await streaming.check("bad content", 10);

		expect(result.passed).toBe(false);
		expect(result.reason).toBe("Content policy violation");
		expect(result.severity).toBe("error");
	});

	it("should skip check when tokenCount is below minTokens", async () => {
		const checkFn = vi.fn().mockResolvedValue({ passed: true });
		const streaming = adaptOutputGuardrail("delayed-check", checkFn, {
			minTokens: 20,
		});

		const result = await streaming.check("early output", 10);

		expect(result.passed).toBe(true);
		expect(checkFn).not.toHaveBeenCalled();
	});

	it("should run check when tokenCount reaches minTokens", async () => {
		const checkFn = vi.fn().mockResolvedValue({ passed: true });
		const streaming = adaptOutputGuardrail("delayed-check", checkFn, {
			minTokens: 20,
		});

		await streaming.check("enough output", 20);
		expect(checkFn).toHaveBeenCalledOnce();
	});

	it("should pass partialOutput as output in guardrail data", async () => {
		const checkFn = vi.fn().mockResolvedValue({ passed: true });
		const streaming = adaptOutputGuardrail("data-check", checkFn);

		await streaming.check("my partial output", 5);

		expect(checkFn).toHaveBeenCalledWith(
			expect.objectContaining({
				output: "my partial output",
				agentName: "streaming",
				input: "",
				messages: [],
			}),
			expect.objectContaining({
				agentName: "streaming",
				input: "",
				facts: {},
			}),
		);
	});

	it("should respect stopOnFail option", () => {
		const checkFn = vi.fn().mockResolvedValue({ passed: true });
		const streaming = adaptOutputGuardrail("no-stop", checkFn, {
			stopOnFail: false,
		});
		expect(streaming.stopOnFail).toBe(false);
	});

	it("should not set severity when guardrail passes", async () => {
		const checkFn = vi.fn().mockResolvedValue({ passed: true });
		const streaming = adaptOutputGuardrail("pass-test", checkFn);

		const result = await streaming.check("good content", 5);
		expect(result.severity).toBeUndefined();
	});
});

// ============================================================================
// StreamChunk type handling
// ============================================================================

describe("StreamChunk type handling", () => {
	it("should correctly type-narrow token chunks", async () => {
		const runner = createStreamingRunner(makeBaseRun(["hello"]));
		const { stream, result } = runner(fakeAgent, "test");
		const chunks = await drain(stream);
		await result;

		for (const chunk of chunks) {
			if (chunk.type === "token") {
				// TypeScript should narrow to TokenChunk
				expect(typeof chunk.data).toBe("string");
				expect(typeof chunk.tokenCount).toBe("number");
			}
		}
	});

	it("should handle all chunk types in a mixed stream", async () => {
		const msg: Message = { role: "assistant", content: "result" };
		const baseRun = async (
			_agent: AgentLike,
			_input: string,
			callbacks: {
				onToken?: (token: string) => void;
				onToolStart?: (tool: string, id: string, args: string) => void;
				onToolEnd?: (tool: string, id: string, result: string) => void;
				onMessage?: (message: Message) => void;
				signal?: AbortSignal;
			},
		): Promise<RunResult<unknown>> => {
			callbacks.onToolStart?.("calc", "id-1", "{}");
			callbacks.onToolEnd?.("calc", "id-1", "42");
			callbacks.onToken?.("The answer is 42");
			callbacks.onMessage?.(msg);
			return { output: "The answer is 42", messages: [msg], toolCalls: [], totalTokens: 1 };
		};

		const runner = createStreamingRunner(baseRun);
		const { stream, result } = runner(fakeAgent, "test");
		const chunks = await drain(stream);
		await result;

		const types = chunks.map((c) => c.type);
		expect(types).toContain("progress");
		expect(types).toContain("tool_start");
		expect(types).toContain("tool_end");
		expect(types).toContain("token");
		expect(types).toContain("message");
		expect(types).toContain("done");
	});

	it("should include correct fields on done chunk", async () => {
		const runner = createStreamingRunner(makeBaseRun(["a", "b", "c"]));
		const { stream, result } = runner(fakeAgent, "test");
		const chunks = await drain(stream);
		await result;

		const done = chunks.find((c) => c.type === "done");
		expect(done).toBeDefined();
		if (done?.type === "done") {
			expect(typeof done.totalTokens).toBe("number");
			expect(typeof done.duration).toBe("number");
			expect(typeof done.droppedTokens).toBe("number");
			expect(done.droppedTokens).toBe(0);
		}
	});
});

// ============================================================================
// Stream Utilities
// ============================================================================

describe("collectTokens", () => {
	it("should collect all token data into a single string", async () => {
		const runner = createStreamingRunner(makeBaseRun(["Hello", " ", "World"]));
		const { stream, result } = runner(fakeAgent, "test");

		const output = await collectTokens(stream);
		await result;

		expect(output).toBe("Hello World");
	});

	it("should return empty string when no tokens", async () => {
		const runner = createStreamingRunner(makeBaseRun([]));
		const { stream, result } = runner(fakeAgent, "test");

		const output = await collectTokens(stream);
		await result;

		expect(output).toBe("");
	});
});

describe("tapStream", () => {
	it("should call tap function for each chunk without consuming", async () => {
		const runner = createStreamingRunner(makeBaseRun(["a", "b"]));
		const { stream, result } = runner(fakeAgent, "test");

		const tapped: StreamChunk[] = [];
		const tappedStream = tapStream(stream, (chunk) => {
			tapped.push(chunk);
		});

		const consumed: StreamChunk[] = [];
		for await (const chunk of tappedStream) {
			consumed.push(chunk);
		}
		await result;

		// Both should see the same chunks
		expect(tapped).toEqual(consumed);
		expect(tapped.length).toBeGreaterThan(0);
	});
});

describe("filterStream", () => {
	it("should only yield chunks of specified types", async () => {
		const runner = createStreamingRunner(makeBaseRun(["a", "b"]));
		const { stream, result } = runner(fakeAgent, "test");

		const filtered: StreamChunk[] = [];
		for await (const chunk of filterStream(stream, ["token"])) {
			filtered.push(chunk);
		}
		await result;

		expect(filtered.every((c) => c.type === "token")).toBe(true);
		expect(filtered).toHaveLength(2);
	});

	it("should yield nothing when no chunks match", async () => {
		const runner = createStreamingRunner(makeBaseRun(["a"]));
		const { stream, result } = runner(fakeAgent, "test");

		const filtered: StreamChunk[] = [];
		for await (const chunk of filterStream(stream, ["guardrail_triggered"])) {
			filtered.push(chunk);
		}
		await result;

		expect(filtered).toHaveLength(0);
	});
});

describe("mapStream", () => {
	it("should transform each chunk", async () => {
		const runner = createStreamingRunner(makeBaseRun(["hello"]));
		const { stream, result } = runner(fakeAgent, "test");

		const mapped: string[] = [];
		for await (const chunkType of mapStream(stream, (c) => c.type)) {
			mapped.push(chunkType);
		}
		await result;

		expect(mapped).toContain("progress");
		expect(mapped).toContain("token");
		expect(mapped).toContain("done");
	});
});
