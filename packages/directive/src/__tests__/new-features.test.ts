/**
 * Tests for new features added in post-review items:
 * - Constraint helpers (constraint() builder, when() shorthand)
 * - createLengthGuardrail
 * - createContentFilterGuardrail
 * - streamChunks() on AgentStack
 */

import { describe, expect, it, vi, afterEach } from "vitest";

// ============================================================================
// Constraint Helpers
// ============================================================================

import {
	constraint,
	when,
	type WhenWithRequire,
} from "../adapters/ai/constraint-helpers.js";
import type { OrchestratorConstraint, OrchestratorState } from "../adapters/ai/types.js";

type TestFacts = { confidence: number; errors: number; critical: boolean };

describe("constraint helpers", () => {
	describe("constraint() builder", () => {
		it("should build a constraint with when/require/priority", () => {
			const c = constraint<TestFacts>()
				.when((f) => f.confidence < 0.7)
				.require({ type: "ESCALATE" })
				.priority(50)
				.build();

			expect(c).toHaveProperty("when");
			expect(c).toHaveProperty("require");
			expect(c.priority).toBe(50);
		});

		it("should default priority to 0", () => {
			const c = constraint<TestFacts>()
				.when((f) => f.errors > 3)
				.require({ type: "PAUSE" })
				.build();

			expect(c.priority).toBe(0);
		});

		it("should support function-based require", () => {
			const c = constraint<TestFacts>()
				.when((f) => f.critical)
				.require((f) => ({ type: "ALERT", level: f.errors }))
				.build();

			expect(typeof c.require).toBe("function");
		});

		it("should allow chaining priority multiple times (last wins)", () => {
			const c = constraint<TestFacts>()
				.when((f) => f.errors > 0)
				.require({ type: "LOG" })
				.priority(10)
				.priority(20)
				.priority(30)
				.build();

			expect(c.priority).toBe(30);
		});

		it("should produce a valid OrchestratorConstraint", async () => {
			const c = constraint<TestFacts>()
				.when((f) => f.confidence < 0.5)
				.require({ type: "ESCALATE" })
				.priority(75)
				.build();

			const fakeFacts = { confidence: 0.3, errors: 0, critical: false } as TestFacts & OrchestratorState;
			expect(await c.when(fakeFacts)).toBe(true);
			expect(c.require).toEqual({ type: "ESCALATE" });
		});

		it("should support async when condition", async () => {
			const c = constraint<TestFacts>()
				.when(async (f) => f.errors > 5)
				.require({ type: "HALT" })
				.build();

			const fakeFacts = { confidence: 1, errors: 10, critical: false } as TestFacts & OrchestratorState;
			expect(await c.when(fakeFacts)).toBe(true);
		});

		it("should work with default generic (Record<string, never>)", () => {
			const c = constraint()
				.when(() => true)
				.require({ type: "ALWAYS" })
				.build();

			expect(c.priority).toBe(0);
			expect(c.require).toEqual({ type: "ALWAYS" });
		});
	});

	describe("when() shorthand", () => {
		it("should return a valid constraint directly", () => {
			const c = when<TestFacts>((f) => f.errors > 3).require({ type: "PAUSE" });

			expect(c).toHaveProperty("when");
			expect(c).toHaveProperty("require");
			expect(c.priority).toBe(0);
		});

		it("should support .withPriority() to set priority", () => {
			const c = when<TestFacts>((f) => f.critical)
				.require({ type: "HALT" })
				.withPriority(100);

			expect(c.priority).toBe(100);
			expect(c.require).toEqual({ type: "HALT" });
		});

		it("should return a new object from withPriority (immutability)", () => {
			const base = when<TestFacts>((f) => f.errors > 0).require({ type: "LOG" });
			const prioritized = base.withPriority(50);

			expect(base.priority).toBe(0);
			expect(prioritized.priority).toBe(50);
			expect(base).not.toBe(prioritized);
		});

		it("should evaluate when condition correctly", async () => {
			const c = when<TestFacts>((f) => f.confidence < 0.5).require({ type: "ESCALATE" });

			const lowConf = { confidence: 0.3, errors: 0, critical: false } as TestFacts & OrchestratorState;
			const highConf = { confidence: 0.9, errors: 0, critical: false } as TestFacts & OrchestratorState;

			expect(await c.when(lowConf)).toBe(true);
			expect(await c.when(highConf)).toBe(false);
		});

		it("should support function-based require", () => {
			const c = when<TestFacts>((f) => f.errors > 0)
				.require((f) => ({ type: "LOG", count: f.errors }));

			expect(typeof c.require).toBe("function");
		});

		it("should work with default generic", () => {
			const c = when(() => true).require({ type: "ALWAYS" });
			expect(c.priority).toBe(0);
		});

		it("should support async when condition", async () => {
			const c = when<TestFacts>(async (f) => f.critical).require({ type: "EMERGENCY" });

			const facts = { confidence: 0, errors: 0, critical: true } as TestFacts & OrchestratorState;
			expect(await c.when(facts)).toBe(true);
		});
	});
});

// ============================================================================
// Length Guardrail
// ============================================================================

import {
	createLengthGuardrail,
	createContentFilterGuardrail,
} from "../adapters/ai/builtin-guardrails.js";
import type { OutputGuardrailData, GuardrailContext } from "../adapters/ai/types.js";

function makeOutputData(output: unknown): OutputGuardrailData {
	return {
		output,
		agentName: "test-agent",
		input: "test input",
		messages: [],
	};
}

const dummyContext: GuardrailContext = {
	agentName: "test-agent",
	input: "test",
	facts: {},
};

describe("createLengthGuardrail", () => {
	it("should pass when output is within character limit", () => {
		const guard = createLengthGuardrail({ maxCharacters: 100 });
		const result = guard(makeOutputData("short text"), dummyContext);
		expect(result).toEqual({ passed: true });
	});

	it("should fail when output exceeds character limit", () => {
		const guard = createLengthGuardrail({ maxCharacters: 10 });
		const result = guard(makeOutputData("this is a long string that exceeds ten"), dummyContext);
		expect(result).toHaveProperty("passed", false);
		expect(result).toHaveProperty("reason");
		expect((result as { reason: string }).reason).toContain("characters");
	});

	it("should pass when output is within token limit", () => {
		const guard = createLengthGuardrail({ maxTokens: 100 });
		const result = guard(makeOutputData("hello"), dummyContext);
		expect(result).toEqual({ passed: true });
	});

	it("should fail when output exceeds token limit", () => {
		const guard = createLengthGuardrail({ maxTokens: 2 });
		// Default estimator: chars / 4. "12 chars!" = 10 chars → ~3 tokens
		const result = guard(makeOutputData("12 chars!!"), dummyContext);
		expect(result).toHaveProperty("passed", false);
		expect((result as { reason: string }).reason).toContain("tokens");
	});

	it("should support custom token estimator", () => {
		const guard = createLengthGuardrail({
			maxTokens: 5,
			estimateTokens: (text) => text.split(" ").length,
		});

		const passResult = guard(makeOutputData("one two three"), dummyContext);
		expect(passResult).toEqual({ passed: true });

		const failResult = guard(makeOutputData("one two three four five six"), dummyContext);
		expect(failResult).toHaveProperty("passed", false);
	});

	it("should handle object output via JSON stringification", () => {
		const guard = createLengthGuardrail({ maxCharacters: 10 });
		const result = guard(makeOutputData({ key: "a long value that exceeds limit" }), dummyContext);
		expect(result).toHaveProperty("passed", false);
	});

	it("should pass when both limits are provided and satisfied", () => {
		const guard = createLengthGuardrail({ maxCharacters: 100, maxTokens: 50 });
		const result = guard(makeOutputData("short"), dummyContext);
		expect(result).toEqual({ passed: true });
	});

	it("should handle zero maxCharacters", () => {
		const guard = createLengthGuardrail({ maxCharacters: 0 });
		// Empty string has length 0, which is not > 0
		const passResult = guard(makeOutputData(""), dummyContext);
		expect(passResult).toEqual({ passed: true });

		const failResult = guard(makeOutputData("a"), dummyContext);
		expect(failResult).toHaveProperty("passed", false);
	});

	it("should handle circular references in output", () => {
		const guard = createLengthGuardrail({ maxCharacters: 1000 });
		const circular: Record<string, unknown> = { a: 1 };
		circular.self = circular;
		// Should not throw
		const result = guard(makeOutputData(circular), dummyContext);
		expect(result).toHaveProperty("passed");
	});
});

// ============================================================================
// Content Filter Guardrail
// ============================================================================

describe("createContentFilterGuardrail", () => {
	it("should pass when no blocked patterns match", () => {
		const guard = createContentFilterGuardrail({
			blockedPatterns: ["password", "secret"],
		});
		const result = guard(makeOutputData("this is safe text"), dummyContext);
		expect(result).toEqual({ passed: true });
	});

	it("should fail when string pattern matches (case-insensitive by default)", () => {
		const guard = createContentFilterGuardrail({
			blockedPatterns: ["password"],
		});
		const result = guard(makeOutputData("Your PASSWORD is here"), dummyContext);
		expect(result).toHaveProperty("passed", false);
		expect((result as { reason: string }).reason).toContain("password");
	});

	it("should support case-sensitive matching", () => {
		const guard = createContentFilterGuardrail({
			blockedPatterns: ["Secret"],
			caseSensitive: true,
		});

		const lower = guard(makeOutputData("secret data"), dummyContext);
		expect(lower).toEqual({ passed: true });

		const exact = guard(makeOutputData("Secret data"), dummyContext);
		expect(exact).toHaveProperty("passed", false);
	});

	it("should support RegExp patterns", () => {
		const guard = createContentFilterGuardrail({
			blockedPatterns: [/\b\d{3}-\d{2}-\d{4}\b/],
		});

		const clean = guard(makeOutputData("no SSN here"), dummyContext);
		expect(clean).toEqual({ passed: true });

		const ssn = guard(makeOutputData("SSN: 123-45-6789"), dummyContext);
		expect(ssn).toHaveProperty("passed", false);
	});

	it("should escape special regex characters in string patterns", () => {
		const guard = createContentFilterGuardrail({
			blockedPatterns: ["cost.total"],
		});

		// Should only match literal "cost.total", not "costXtotal"
		const literal = guard(makeOutputData("The cost.total is $50"), dummyContext);
		expect(literal).toHaveProperty("passed", false);

		// "costXtotal" should NOT match because '.' was escaped
		const nonMatch = guard(makeOutputData("costXtotal"), dummyContext);
		expect(nonMatch).toEqual({ passed: true });
	});

	it("should handle mixed string and RegExp patterns", () => {
		const guard = createContentFilterGuardrail({
			blockedPatterns: ["internal-only", /api[_-]key/i],
		});

		const text1 = guard(makeOutputData("api-key: abc123"), dummyContext);
		expect(text1).toHaveProperty("passed", false);

		const text2 = guard(makeOutputData("internal-only document"), dummyContext);
		expect(text2).toHaveProperty("passed", false);

		const safe = guard(makeOutputData("public information"), dummyContext);
		expect(safe).toEqual({ passed: true });
	});

	it("should warn when blockedPatterns is empty", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		createContentFilterGuardrail({ blockedPatterns: [] });
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("blockedPatterns is empty"),
		);
		warnSpy.mockRestore();
	});

	it("should pass everything when patterns array is empty", () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const guard = createContentFilterGuardrail({ blockedPatterns: [] });
		const result = guard(makeOutputData("anything goes"), dummyContext);
		expect(result).toEqual({ passed: true });
		vi.restoreAllMocks();
	});

	it("should handle object output via JSON stringification", () => {
		const guard = createContentFilterGuardrail({
			blockedPatterns: ["secret_key"],
		});
		const result = guard(makeOutputData({ token: "secret_key_123" }), dummyContext);
		expect(result).toHaveProperty("passed", false);
	});

	it("should reset regex lastIndex between calls (global flag)", () => {
		const guard = createContentFilterGuardrail({
			blockedPatterns: [/blocked/gi],
		});

		// Call twice — the second call should still work despite global flag
		const r1 = guard(makeOutputData("this is blocked"), dummyContext);
		const r2 = guard(makeOutputData("also blocked"), dummyContext);
		expect(r1).toHaveProperty("passed", false);
		expect(r2).toHaveProperty("passed", false);
	});

	it("should handle circular references in output", () => {
		const guard = createContentFilterGuardrail({
			blockedPatterns: ["secret"],
		});
		const circular: Record<string, unknown> = { data: "no secret here" };
		circular.self = circular;
		// Should not throw
		const result = guard(makeOutputData(circular), dummyContext);
		expect(result).toHaveProperty("passed");
	});
});

// ============================================================================
// streamChunks() on AgentStack
// ============================================================================

import { createAgentStack, type StreamingCallbackRunner } from "../adapters/ai/stack.js";
import type { AgentLike, RunResult } from "../adapters/ai/types.js";
import type { AgentRegistry } from "../adapters/ai/multi.js";
import type { StreamChunk, StreamingRunResult } from "../adapters/ai/streaming.js";

function makeAgent(name: string): AgentLike { return { name }; }

function makeRunResult<T>(output: T, totalTokens = 10): RunResult<T> {
	return { output, messages: [], toolCalls: [], totalTokens };
}

function createMockRunner(): AgentRunner {
	return vi.fn(async <T = unknown>(agent: AgentLike, input: string) => {
		return makeRunResult<T>(`response from ${agent.name}` as T);
	}) as unknown as AgentRunner;
}

import type { AgentRunner } from "../adapters/ai/types.js";

const testAgents: AgentRegistry = {
	chat: { agent: makeAgent("chat-agent"), description: "Chat agent", capabilities: ["chat"] },
};

function createMockStreamingRunner(tokens: string[] = ["Hello", " ", "world"]): StreamingCallbackRunner {
	return vi.fn(async (agent, input, callbacks) => {
		for (const token of tokens) {
			callbacks.onToken?.(token);
		}
		return makeRunResult<string>(tokens.join(""), tokens.length);
	}) as StreamingCallbackRunner;
}

describe("streamChunks()", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should throw when streaming is not configured", () => {
		const stack = createAgentStack({
			runner: createMockRunner(),
			agents: testAgents,
		});

		expect(() => stack.streamChunks("chat", "hello")).toThrow("Streaming not configured");
	});

	it("should return stream, result, and abort", () => {
		const stack = createAgentStack({
			runner: createMockRunner(),
			streaming: { runner: createMockStreamingRunner() },
			agents: testAgents,
		});

		const streamResult = stack.streamChunks("chat", "hello");
		expect(streamResult).toHaveProperty("stream");
		expect(streamResult).toHaveProperty("result");
		expect(streamResult).toHaveProperty("abort");
		expect(typeof streamResult.abort).toBe("function");
	});

	it("should yield StreamChunk events and resolve result", async () => {
		const stack = createAgentStack({
			runner: createMockRunner(),
			streaming: { runner: createMockStreamingRunner(["Hi", "!"]) },
			agents: testAgents,
		});

		const { stream, result } = stack.streamChunks<string>("chat", "hello");

		const chunks: StreamChunk[] = [];
		for await (const chunk of stream) {
			chunks.push(chunk);
		}

		const finalResult = await result;
		expect(finalResult.output).toBe("Hi!");
		expect(finalResult.totalTokens).toBe(2);
	});

	it("should track tokens in stack state", async () => {
		const stack = createAgentStack({
			runner: createMockRunner(),
			streaming: { runner: createMockStreamingRunner(["a", "b", "c"]) },
			agents: testAgents,
		});

		const { stream, result } = stack.streamChunks("chat", "test");
		for await (const _ of stream) { /* consume */ }
		await result;

		expect(stack.getState().totalTokens).toBe(3);
	});

	it("should throw for unknown agent ID", () => {
		const stack = createAgentStack({
			runner: createMockRunner(),
			streaming: { runner: createMockStreamingRunner() },
			agents: testAgents,
		});

		expect(() => stack.streamChunks("unknown", "hello")).toThrow('Agent "unknown" not found');
	});

	it("should abort idempotently", () => {
		const stack = createAgentStack({
			runner: createMockRunner(),
			streaming: { runner: createMockStreamingRunner() },
			agents: testAgents,
		});

		const { abort } = stack.streamChunks("chat", "hello");
		// Calling abort multiple times should not throw
		abort();
		abort();
		abort();
	});

	it("should publish to message bus on completion", async () => {
		const stack = createAgentStack({
			runner: createMockRunner(),
			streaming: { runner: createMockStreamingRunner(["tok"]) },
			agents: testAgents,
			bus: { maxHistory: 50 },
		});

		const { stream, result } = stack.streamChunks("chat", "test");
		for await (const _ of stream) { /* consume */ }
		await result;

		const history = stack.messageBus!.getHistory(undefined, 10);
		const completedMsg = history.find((m) => m.topic?.includes("streamChunks.completed"));
		expect(completedMsg).toBeDefined();
	});

	it("should record observability traces", async () => {
		const stack = createAgentStack({
			runner: createMockRunner(),
			streaming: { runner: createMockStreamingRunner(["x"]) },
			agents: testAgents,
			observability: { serviceName: "test-stream" },
		});

		const { stream, result } = stack.streamChunks("chat", "hello");
		for await (const _ of stream) { /* consume */ }
		await result;

		const traces = stack.observability!.getTraces(10);
		expect(traces.length).toBeGreaterThan(0);
	});

	it("should throw when circuit breaker is open", async () => {
		const failRunner = vi.fn(async () => { throw new Error("fail"); }) as unknown as AgentRunner;

		const stack = createAgentStack({
			runner: failRunner,
			streaming: { runner: createMockStreamingRunner() },
			agents: testAgents,
			circuitBreaker: { failureThreshold: 1, recoveryTimeMs: 60000 },
		});

		// Trip the circuit breaker
		try { await stack.run("chat", "trigger"); } catch { /* expected */ }

		// Now streamChunks should throw circuit breaker error
		expect(() => stack.streamChunks("chat", "hello")).toThrow("Circuit breaker is OPEN");
	});
});
