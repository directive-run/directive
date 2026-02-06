/**
 * OpenAI Agents Testing Utilities Tests
 *
 * Tests for createMockAgentRunner, testGuardrail, testGuardrailBatch,
 * createApprovalSimulator, createConstraintRecorder, createTimeController,
 * and assertOrchestratorState.
 */

import { describe, expect, it, vi } from "vitest";
import {
	createMockAgentRunner,
	testGuardrail,
	testGuardrailBatch,
	createApprovalSimulator,
	createConstraintRecorder,
	createTimeController,
	assertOrchestratorState,
} from "../adapters/openai-agents-testing.js";
import type {
	GuardrailFn,
	InputGuardrailData,
	AgentLike,
	AgentOrchestrator,
	OrchestratorState,
} from "../adapters/openai-agents.js";

// ============================================================================
// Helpers
// ============================================================================

function makeAgent(name: string): AgentLike {
	return { name };
}

// ============================================================================
// createMockAgentRunner
// ============================================================================

describe("createMockAgentRunner", () => {
	it("should return configured response for a named agent", async () => {
		const mock = createMockAgentRunner({
			responses: {
				"my-agent": {
					finalOutput: "hello from mock",
					totalTokens: 42,
				},
			},
		});

		const result = await mock.run(makeAgent("my-agent"), "test input");

		expect(result.finalOutput).toBe("hello from mock");
		expect(result.totalTokens).toBe(42);
		expect(result.messages).toEqual([]);
		expect(result.toolCalls).toEqual([]);
	});

	it("should fall back to default response for unknown agents", async () => {
		const mock = createMockAgentRunner({
			responses: {
				"known-agent": { finalOutput: "known" },
			},
		});

		const result = await mock.run(makeAgent("unknown-agent"), "hi");

		expect(result.finalOutput).toBe("mock response");
		expect(result.totalTokens).toBe(10);
	});

	it("should use a custom default response", async () => {
		const mock = createMockAgentRunner({
			defaultResponse: { finalOutput: "custom default", totalTokens: 99 },
		});

		const result = await mock.run(makeAgent("any"), "test");

		expect(result.finalOutput).toBe("custom default");
		expect(result.totalTokens).toBe(99);
	});

	it("should track call history", async () => {
		const mock = createMockAgentRunner();

		const agent1 = makeAgent("agent-a");
		const agent2 = makeAgent("agent-b");

		await mock.run(agent1, "first");
		await mock.run(agent2, "second");
		await mock.run(agent1, "third");

		const allCalls = mock.getCalls();
		expect(allCalls).toHaveLength(3);
		expect(allCalls[0]!.agent.name).toBe("agent-a");
		expect(allCalls[0]!.input).toBe("first");
		expect(allCalls[1]!.agent.name).toBe("agent-b");
		expect(allCalls[2]!.input).toBe("third");

		const agentACalls = mock.getCallsFor("agent-a");
		expect(agentACalls).toHaveLength(2);

		const agentBCalls = mock.getCallsFor("agent-b");
		expect(agentBCalls).toHaveLength(1);
	});

	it("should clear call history", async () => {
		const mock = createMockAgentRunner();

		await mock.run(makeAgent("a"), "input");
		expect(mock.getCalls()).toHaveLength(1);

		mock.clearCalls();
		expect(mock.getCalls()).toHaveLength(0);
	});

	it("should not record calls when recordCalls is false", async () => {
		const mock = createMockAgentRunner({ recordCalls: false });

		await mock.run(makeAgent("a"), "input");
		expect(mock.getCalls()).toHaveLength(0);
	});

	it("should call onRun callback for each run", async () => {
		const onRun = vi.fn();
		const mock = createMockAgentRunner({ onRun });

		const agent = makeAgent("test");
		await mock.run(agent, "hello");

		expect(onRun).toHaveBeenCalledOnce();
		expect(onRun).toHaveBeenCalledWith(agent, "hello");
	});

	it("should emit messages and tool calls via onMessage/onToolCall callbacks", async () => {
		const messages = [
			{ role: "assistant" as const, content: "thinking..." },
			{ role: "assistant" as const, content: "done" },
		];
		const toolCalls = [
			{ id: "tc-1", name: "search", arguments: '{"q":"test"}' },
		];

		const mock = createMockAgentRunner({
			responses: {
				"my-agent": {
					finalOutput: "result",
					messages,
					toolCalls,
				},
			},
		});

		const onMessage = vi.fn();
		const onToolCall = vi.fn();

		await mock.run(makeAgent("my-agent"), "test", { onMessage, onToolCall });

		expect(onMessage).toHaveBeenCalledTimes(2);
		expect(onMessage).toHaveBeenCalledWith(messages[0]);
		expect(onMessage).toHaveBeenCalledWith(messages[1]);

		expect(onToolCall).toHaveBeenCalledOnce();
		expect(onToolCall).toHaveBeenCalledWith(toolCalls[0]);
	});

	it("should throw configured error", async () => {
		const mock = createMockAgentRunner({
			responses: {
				"error-agent": {
					finalOutput: null,
					error: new Error("agent failed"),
				},
			},
		});

		await expect(mock.run(makeAgent("error-agent"), "test")).rejects.toThrow(
			"agent failed"
		);
	});

	it("should support dynamic response generation", async () => {
		const mock = createMockAgentRunner({
			responses: {
				"dynamic-agent": {
					finalOutput: "default",
					generate: (input, agent) => ({
						finalOutput: `${agent.name} received: ${input}`,
						totalTokens: input.length,
					}),
				},
			},
		});

		const result = await mock.run(makeAgent("dynamic-agent"), "hello");

		expect(result.finalOutput).toBe("dynamic-agent received: hello");
		expect(result.totalTokens).toBe(5);
	});

	it("should allow updating responses after creation via setResponse", async () => {
		const mock = createMockAgentRunner();

		mock.setResponse("my-agent", { finalOutput: "updated", totalTokens: 50 });

		const result = await mock.run(makeAgent("my-agent"), "test");
		expect(result.finalOutput).toBe("updated");
		expect(result.totalTokens).toBe(50);
	});

	it("should allow updating default response via setDefaultResponse", async () => {
		const mock = createMockAgentRunner();

		mock.setDefaultResponse({ finalOutput: "new default", totalTokens: 1 });

		const result = await mock.run(makeAgent("anything"), "test");
		expect(result.finalOutput).toBe("new default");
		expect(result.totalTokens).toBe(1);
	});

	it("should record timestamps on calls", async () => {
		const mock = createMockAgentRunner();

		const before = Date.now();
		await mock.run(makeAgent("a"), "input");
		const after = Date.now();

		const call = mock.getCalls()[0]!;
		expect(call.timestamp).toBeGreaterThanOrEqual(before);
		expect(call.timestamp).toBeLessThanOrEqual(after);
	});

	it("should return independent copies from getCalls", async () => {
		const mock = createMockAgentRunner();

		await mock.run(makeAgent("a"), "input");

		const calls1 = mock.getCalls();
		const calls2 = mock.getCalls();

		expect(calls1).toEqual(calls2);
		expect(calls1).not.toBe(calls2);
	});
});

// ============================================================================
// testGuardrail
// ============================================================================

describe("testGuardrail", () => {
	const passingGuardrail: GuardrailFn<InputGuardrailData> = () => ({
		passed: true,
	});

	const failingGuardrail: GuardrailFn<InputGuardrailData> = () => ({
		passed: false,
		reason: "Contains forbidden content",
	});

	const transformingGuardrail: GuardrailFn<InputGuardrailData> = (data) => ({
		passed: true,
		transformed: (data as InputGuardrailData).input.toUpperCase(),
	});

	it("should test a passing guardrail", async () => {
		const result = await testGuardrail(passingGuardrail, { input: "safe input" });

		expect(result.passed).toBe(true);
		expect(result.reason).toBeUndefined();
		result.assertPassed();
	});

	it("should test a failing guardrail", async () => {
		const result = await testGuardrail(failingGuardrail, { input: "bad input" });

		expect(result.passed).toBe(false);
		expect(result.reason).toBe("Contains forbidden content");
		result.assertFailed();
	});

	it("assertFailed should match string reason", async () => {
		const result = await testGuardrail(failingGuardrail, { input: "test" });

		result.assertFailed("forbidden");
	});

	it("assertFailed should match regex reason", async () => {
		const result = await testGuardrail(failingGuardrail, { input: "test" });

		result.assertFailed(/forbidden/i);
	});

	it("assertFailed should throw when guardrail passed", async () => {
		const result = await testGuardrail(passingGuardrail, { input: "test" });

		expect(() => result.assertFailed()).toThrow("Expected guardrail to fail, but it passed");
	});

	it("assertFailed should throw when string reason does not match", async () => {
		const result = await testGuardrail(failingGuardrail, { input: "test" });

		expect(() => result.assertFailed("nonexistent")).toThrow(
			'Expected failure reason to include "nonexistent"'
		);
	});

	it("assertFailed should throw when regex reason does not match", async () => {
		const result = await testGuardrail(failingGuardrail, { input: "test" });

		expect(() => result.assertFailed(/xyz/)).toThrow(
			"Expected failure reason to match /xyz/"
		);
	});

	it("assertPassed should throw when guardrail failed", async () => {
		const result = await testGuardrail(failingGuardrail, { input: "test" });

		expect(() => result.assertPassed()).toThrow("Expected guardrail to pass, but it failed");
	});

	it("assertTransformed should verify transformation occurred", async () => {
		const result = await testGuardrail(transformingGuardrail, { input: "hello" });

		result.assertPassed();
		result.assertTransformed();
		result.assertTransformed("HELLO");
	});

	it("assertTransformed should throw when no transformation occurred", async () => {
		const result = await testGuardrail(passingGuardrail, { input: "test" });

		expect(() => result.assertTransformed()).toThrow(
			"Expected guardrail to transform input, but no transformation occurred"
		);
	});

	it("assertTransformed should throw when expected value does not match", async () => {
		const result = await testGuardrail(transformingGuardrail, { input: "hello" });

		expect(() => result.assertTransformed("wrong")).toThrow(
			'Expected transformation to be "wrong"'
		);
	});

	it("should track duration", async () => {
		const slowGuardrail: GuardrailFn<InputGuardrailData> = async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
			return { passed: true };
		};

		const result = await testGuardrail(slowGuardrail, { input: "test" });

		expect(result.duration).toBeGreaterThanOrEqual(0);
	});

	it("should include testedData", async () => {
		const result = await testGuardrail(passingGuardrail, { input: "my input" });

		expect(result.testedData).toEqual(expect.objectContaining({ input: "my input" }));
	});

	it("should use default agentName when not provided", async () => {
		const capturedContext = vi.fn();
		const guardrail: GuardrailFn<InputGuardrailData> = (_data, ctx) => {
			capturedContext(ctx);
			return { passed: true };
		};

		await testGuardrail(guardrail, { input: "test" });

		expect(capturedContext).toHaveBeenCalledWith(
			expect.objectContaining({ agentName: "test-agent" })
		);
	});

	it("should use custom agentName when provided", async () => {
		const capturedContext = vi.fn();
		const guardrail: GuardrailFn<InputGuardrailData> = (_data, ctx) => {
			capturedContext(ctx);
			return { passed: true };
		};

		await testGuardrail(guardrail, { input: "test", agentName: "custom-agent" });

		expect(capturedContext).toHaveBeenCalledWith(
			expect.objectContaining({ agentName: "custom-agent" })
		);
	});

	it("should pass context facts to guardrail", async () => {
		const capturedContext = vi.fn();
		const guardrail: GuardrailFn<InputGuardrailData> = (_data, ctx) => {
			capturedContext(ctx);
			return { passed: true };
		};

		await testGuardrail(guardrail, { input: "test" }, { facts: { role: "admin" } });

		expect(capturedContext).toHaveBeenCalledWith(
			expect.objectContaining({ facts: { role: "admin" } })
		);
	});

	it("should work with async guardrails", async () => {
		const asyncGuardrail: GuardrailFn<InputGuardrailData> = async (data) => {
			const text = (data as InputGuardrailData).input;
			return {
				passed: !text.includes("blocked"),
				reason: text.includes("blocked") ? "Blocked content" : undefined,
			};
		};

		const passResult = await testGuardrail(asyncGuardrail, { input: "safe" });
		passResult.assertPassed();

		const failResult = await testGuardrail(asyncGuardrail, { input: "blocked word" });
		failResult.assertFailed("Blocked");
	});
});

// ============================================================================
// testGuardrailBatch
// ============================================================================

describe("testGuardrailBatch", () => {
	const piiGuardrail: GuardrailFn<InputGuardrailData> = (data) => {
		const input = (data as InputGuardrailData).input;
		const hasPII = /\d{3}-\d{2}-\d{4}/.test(input);
		return { passed: !hasPII, reason: hasPII ? "Contains PII" : undefined };
	};

	it("should test multiple inputs and report all passed", async () => {
		const results = await testGuardrailBatch(piiGuardrail, [
			{ input: { input: "Hello world" }, expect: "pass" },
			{ input: { input: "Normal text" }, expect: "pass" },
		]);

		expect(results.allPassed()).toBe(true);
		expect(results.failures()).toHaveLength(0);
		expect(results.results).toHaveLength(2);
	});

	it("should detect expected failures", async () => {
		const results = await testGuardrailBatch(piiGuardrail, [
			{ input: { input: "Hello world" }, expect: "pass" },
			{ input: { input: "My SSN is 123-45-6789" }, expect: "fail" },
		]);

		expect(results.allPassed()).toBe(true);
		expect(results.failures()).toHaveLength(0);
	});

	it("should report mismatches as failures", async () => {
		const results = await testGuardrailBatch(piiGuardrail, [
			{ input: { input: "My SSN is 123-45-6789" }, expect: "pass" }, // This should actually fail
		]);

		expect(results.allPassed()).toBe(false);
		const failures = results.failures();
		expect(failures).toHaveLength(1);
		expect(failures[0]!.index).toBe(0);
		expect(failures[0]!.expected).toBe("pass");
	});

	it("should detect expected transformations", async () => {
		const transformGuardrail: GuardrailFn<InputGuardrailData> = (data) => {
			const input = (data as InputGuardrailData).input;
			if (input.includes("fix")) {
				return { passed: true, transformed: input.replace("fix", "fixed") };
			}
			return { passed: true };
		};

		const results = await testGuardrailBatch(transformGuardrail, [
			{ input: { input: "please fix this" }, expect: "transform" },
			{ input: { input: "no change needed" }, expect: "pass" },
		]);

		expect(results.allPassed()).toBe(true);
	});

	it("should correctly identify mismatched transform expectations", async () => {
		const noopGuardrail: GuardrailFn<InputGuardrailData> = () => ({ passed: true });

		const results = await testGuardrailBatch(noopGuardrail, [
			{ input: { input: "test" }, expect: "transform" },
		]);

		expect(results.allPassed()).toBe(false);
		expect(results.failures()[0]!.expected).toBe("transform");
	});
});

// ============================================================================
// createApprovalSimulator
// ============================================================================

describe("createApprovalSimulator", () => {
	function makeApprovalRequest(overrides: Partial<{ id: string; type: string; agentName: string; description: string; data: unknown }> = {}) {
		return {
			id: overrides.id ?? "req-1",
			type: (overrides.type ?? "tool_call") as "tool_call" | "output" | "handoff",
			agentName: overrides.agentName ?? "test-agent",
			description: overrides.description ?? "Test request",
			data: overrides.data ?? { name: "search" },
			requestedAt: Date.now(),
		};
	}

	it("should auto-approve requests matching predicate", async () => {
		const simulator = createApprovalSimulator({
			autoApprove: (req) => req.type === "tool_call",
		});

		const result = await simulator.handle(makeApprovalRequest({ type: "tool_call" }));
		expect(result).toBe("approved");
	});

	it("should auto-reject requests matching predicate", async () => {
		const simulator = createApprovalSimulator({
			autoReject: (req) => req.type === "output",
		});

		const result = await simulator.handle(makeApprovalRequest({ type: "output" }));
		expect(result).toBe("rejected");
	});

	it("should prioritize autoReject over autoApprove (security-first)", async () => {
		const simulator = createApprovalSimulator({
			autoApprove: () => true,
			autoReject: () => true,
		});

		const result = await simulator.handle(makeApprovalRequest());
		expect(result).toBe("rejected");
	});

	it("should record requests", async () => {
		const simulator = createApprovalSimulator({
			autoApprove: () => true,
		});

		const req1 = makeApprovalRequest({ id: "req-1" });
		const req2 = makeApprovalRequest({ id: "req-2" });

		await simulator.handle(req1);
		await simulator.handle(req2);

		const requests = simulator.getRequests();
		expect(requests).toHaveLength(2);
		expect(requests[0]!.id).toBe("req-1");
		expect(requests[1]!.id).toBe("req-2");
	});

	it("should clear requests", async () => {
		const simulator = createApprovalSimulator({
			autoApprove: () => true,
		});

		await simulator.handle(makeApprovalRequest());
		expect(simulator.getRequests()).toHaveLength(1);

		simulator.clearRequests();
		expect(simulator.getRequests()).toHaveLength(0);
	});

	it("should not record requests when recordRequests is false", async () => {
		const simulator = createApprovalSimulator({
			autoApprove: () => true,
			recordRequests: false,
		});

		await simulator.handle(makeApprovalRequest());
		expect(simulator.getRequests()).toHaveLength(0);
	});

	it("should allow manual approval of pending requests", async () => {
		const simulator = createApprovalSimulator();

		const request = makeApprovalRequest({ id: "manual-1" });

		// Start handling (will pend since no auto-approve/reject)
		const resultPromise = simulator.handle(request);

		// Manually approve
		simulator.approve("manual-1");

		const result = await resultPromise;
		expect(result).toBe("approved");
	});

	it("should allow manual rejection of pending requests", async () => {
		const simulator = createApprovalSimulator();

		const request = makeApprovalRequest({ id: "manual-2" });

		const resultPromise = simulator.handle(request);

		simulator.reject("manual-2", "Not allowed");

		const result = await resultPromise;
		expect(result).toBe("rejected");
	});

	it("should handle approve for non-existent request id gracefully", () => {
		const simulator = createApprovalSimulator();

		// Should not throw
		simulator.approve("nonexistent");
		simulator.reject("nonexistent");
	});

	it("should return independent copies from getRequests", async () => {
		const simulator = createApprovalSimulator({
			autoApprove: () => true,
		});

		await simulator.handle(makeApprovalRequest());

		const requests1 = simulator.getRequests();
		const requests2 = simulator.getRequests();

		expect(requests1).toEqual(requests2);
		expect(requests1).not.toBe(requests2);
	});

	it("waitForRequest should resolve with existing matching request", async () => {
		const simulator = createApprovalSimulator({
			autoApprove: () => true,
		});

		const req = makeApprovalRequest({ id: "existing-1", type: "tool_call" });
		await simulator.handle(req);

		const found = await simulator.waitForRequest((r) => r.id === "existing-1");
		expect(found.id).toBe("existing-1");
	});

	it("waitForRequest should resolve with future matching request", async () => {
		const simulator = createApprovalSimulator({
			autoApprove: () => true,
		});

		const waitPromise = simulator.waitForRequest((r) => r.id === "future-1");

		// Handle a request after waiting has started
		const req = makeApprovalRequest({ id: "future-1" });
		await simulator.handle(req);

		const found = await waitPromise;
		expect(found.id).toBe("future-1");
	});

	it("waitForRequest should timeout when no matching request arrives", async () => {
		const simulator = createApprovalSimulator();

		await expect(
			simulator.waitForRequest(() => false, 50)
		).rejects.toThrow("Timeout waiting for approval request");
	});
});

// ============================================================================
// createConstraintRecorder
// ============================================================================

describe("createConstraintRecorder", () => {
	it("should start with empty snapshots", () => {
		const recorder = createConstraintRecorder();

		expect(recorder.getSnapshots()).toEqual([]);
	});

	it("should have a named plugin", () => {
		const recorder = createConstraintRecorder();

		expect(recorder.plugin.name).toBe("constraint-recorder");
	});

	it("should record constraint evaluations via the plugin hook", () => {
		const recorder = createConstraintRecorder();

		recorder.plugin.onRequirementCreated({
			constraintId: "transition",
			requirement: { type: "TRANSITION", to: "green" },
			facts: { phase: "red", elapsed: 31 },
		});

		const snapshots = recorder.getSnapshots();
		expect(snapshots).toHaveLength(1);
		expect(snapshots[0]!.constraintId).toBe("transition");
		expect(snapshots[0]!.triggered).toBe(true);
		expect(snapshots[0]!.requirement).toEqual({ type: "TRANSITION", to: "green" });
		expect(snapshots[0]!.facts).toEqual({ phase: "red", elapsed: 31 });
		expect(typeof snapshots[0]!.timestamp).toBe("number");
	});

	it("should record multiple constraint evaluations", () => {
		const recorder = createConstraintRecorder();

		recorder.plugin.onRequirementCreated({
			constraintId: "first",
			requirement: { type: "A" },
			facts: { x: 1 },
		});

		recorder.plugin.onRequirementCreated({
			constraintId: "second",
			requirement: { type: "B" },
			facts: { x: 2 },
		});

		expect(recorder.getSnapshots()).toHaveLength(2);
		expect(recorder.getSnapshots()[0]!.constraintId).toBe("first");
		expect(recorder.getSnapshots()[1]!.constraintId).toBe("second");
	});

	it("should clear snapshots", () => {
		const recorder = createConstraintRecorder();

		recorder.plugin.onRequirementCreated({
			constraintId: "test",
			requirement: { type: "X" },
			facts: {},
		});

		expect(recorder.getSnapshots()).toHaveLength(1);

		recorder.clearSnapshots();
		expect(recorder.getSnapshots()).toHaveLength(0);
	});

	it("should return independent copies from getSnapshots", () => {
		const recorder = createConstraintRecorder();

		recorder.plugin.onRequirementCreated({
			constraintId: "test",
			requirement: { type: "X" },
			facts: {},
		});

		const snapshots1 = recorder.getSnapshots();
		const snapshots2 = recorder.getSnapshots();

		expect(snapshots1).toEqual(snapshots2);
		expect(snapshots1).not.toBe(snapshots2);
	});

	it("should record timestamps close to Date.now()", () => {
		const recorder = createConstraintRecorder();

		const before = Date.now();
		recorder.plugin.onRequirementCreated({
			constraintId: "timed",
			requirement: { type: "T" },
			facts: {},
		});
		const after = Date.now();

		const snapshot = recorder.getSnapshots()[0]!;
		expect(snapshot.timestamp).toBeGreaterThanOrEqual(before);
		expect(snapshot.timestamp).toBeLessThanOrEqual(after);
	});
});

// ============================================================================
// createTimeController
// ============================================================================

describe("createTimeController", () => {
	it("should start at the given time", () => {
		const time = createTimeController(1000);

		expect(time.now()).toBe(1000);
	});

	it("should default to Date.now() if no startTime given", () => {
		const before = Date.now();
		const time = createTimeController();
		const after = Date.now();

		expect(time.now()).toBeGreaterThanOrEqual(before);
		expect(time.now()).toBeLessThanOrEqual(after);
	});

	it("should advance time by given milliseconds", () => {
		const time = createTimeController(0);

		time.advance(1000);
		expect(time.now()).toBe(1000);

		time.advance(500);
		expect(time.now()).toBe(1500);
	});

	it("should set time to an absolute value", () => {
		const time = createTimeController(0);

		time.set(5000);
		expect(time.now()).toBe(5000);

		time.set(100);
		expect(time.now()).toBe(100);
	});

	it("should reset to the initial start time", () => {
		const time = createTimeController(42);

		time.advance(1000);
		expect(time.now()).toBe(1042);

		time.reset();
		expect(time.now()).toBe(42);
	});

	it("should work when used to override Date.now", () => {
		const time = createTimeController(10000);
		const originalNow = Date.now;

		try {
			Date.now = () => time.now();

			expect(Date.now()).toBe(10000);

			time.advance(2000);
			expect(Date.now()).toBe(12000);

			time.set(0);
			expect(Date.now()).toBe(0);
		} finally {
			Date.now = originalNow;
		}
	});

	it("should handle negative advance (going back in time)", () => {
		const time = createTimeController(5000);

		time.advance(-1000);
		expect(time.now()).toBe(4000);
	});

	it("should handle advance of zero", () => {
		const time = createTimeController(100);

		time.advance(0);
		expect(time.now()).toBe(100);
	});
});

// ============================================================================
// assertOrchestratorState
// ============================================================================

describe("assertOrchestratorState", () => {
	function makeMockOrchestrator(state: Partial<OrchestratorState>): AgentOrchestrator<Record<string, never>> {
		const defaultState: OrchestratorState = {
			agent: {
				status: "idle",
				currentAgent: null,
				input: null,
				output: null,
				error: null,
				tokenUsage: 0,
				turnCount: 0,
				startedAt: null,
				completedAt: null,
			},
			approval: {
				pending: [],
				approved: [],
				rejected: [],
			},
			conversation: [],
			toolCalls: [],
		};

		const mergedState = {
			...defaultState,
			...state,
			agent: { ...defaultState.agent, ...(state.agent ?? {}) },
			approval: { ...defaultState.approval, ...(state.approval ?? {}) },
		};

		return {
			facts: mergedState,
		} as unknown as AgentOrchestrator<Record<string, never>>;
	}

	describe("agentStatus", () => {
		it("should pass when agent status matches", () => {
			const orchestrator = makeMockOrchestrator({
				agent: { status: "completed" } as OrchestratorState["agent"],
			});

			expect(() =>
				assertOrchestratorState(orchestrator, { agentStatus: "completed" })
			).not.toThrow();
		});

		it("should fail when agent status does not match", () => {
			const orchestrator = makeMockOrchestrator({
				agent: { status: "idle" } as OrchestratorState["agent"],
			});

			expect(() =>
				assertOrchestratorState(orchestrator, { agentStatus: "running" })
			).toThrow('Expected agent status to be "running", got "idle"');
		});
	});

	describe("tokenUsage", () => {
		it("should pass with exact token usage", () => {
			const orchestrator = makeMockOrchestrator({
				agent: { tokenUsage: 500 } as OrchestratorState["agent"],
			});

			expect(() =>
				assertOrchestratorState(orchestrator, { tokenUsage: { exact: 500 } })
			).not.toThrow();
		});

		it("should fail with wrong exact token usage", () => {
			const orchestrator = makeMockOrchestrator({
				agent: { tokenUsage: 500 } as OrchestratorState["agent"],
			});

			expect(() =>
				assertOrchestratorState(orchestrator, { tokenUsage: { exact: 100 } })
			).toThrow("Expected token usage to be exactly 100, got 500");
		});

		it("should pass within min/max range", () => {
			const orchestrator = makeMockOrchestrator({
				agent: { tokenUsage: 500 } as OrchestratorState["agent"],
			});

			expect(() =>
				assertOrchestratorState(orchestrator, { tokenUsage: { min: 100, max: 1000 } })
			).not.toThrow();
		});

		it("should fail when below min", () => {
			const orchestrator = makeMockOrchestrator({
				agent: { tokenUsage: 50 } as OrchestratorState["agent"],
			});

			expect(() =>
				assertOrchestratorState(orchestrator, { tokenUsage: { min: 100 } })
			).toThrow("Expected token usage to be at least 100, got 50");
		});

		it("should fail when above max", () => {
			const orchestrator = makeMockOrchestrator({
				agent: { tokenUsage: 2000 } as OrchestratorState["agent"],
			});

			expect(() =>
				assertOrchestratorState(orchestrator, { tokenUsage: { max: 1000 } })
			).toThrow("Expected token usage to be at most 1000, got 2000");
		});
	});

	describe("pendingApprovals", () => {
		it("should pass with correct pending approval count", () => {
			const orchestrator = makeMockOrchestrator({
				approval: {
					pending: [
						{ id: "1", type: "tool_call", agentName: "a", description: "d", data: null, requestedAt: 0 },
						{ id: "2", type: "tool_call", agentName: "b", description: "d", data: null, requestedAt: 0 },
					],
					approved: [],
					rejected: [],
				},
			});

			expect(() =>
				assertOrchestratorState(orchestrator, { pendingApprovals: 2 })
			).not.toThrow();
		});

		it("should fail with wrong pending approval count", () => {
			const orchestrator = makeMockOrchestrator({
				approval: { pending: [], approved: [], rejected: [] },
			});

			expect(() =>
				assertOrchestratorState(orchestrator, { pendingApprovals: 1 })
			).toThrow("Expected 1 pending approvals, got 0");
		});
	});

	describe("conversationLength", () => {
		it("should pass with exact conversation length", () => {
			const orchestrator = makeMockOrchestrator({
				conversation: [
					{ role: "user", content: "hello" },
					{ role: "assistant", content: "hi" },
				],
			});

			expect(() =>
				assertOrchestratorState(orchestrator, { conversationLength: { exact: 2 } })
			).not.toThrow();
		});

		it("should fail with wrong exact conversation length", () => {
			const orchestrator = makeMockOrchestrator({ conversation: [] });

			expect(() =>
				assertOrchestratorState(orchestrator, { conversationLength: { exact: 5 } })
			).toThrow("Expected conversation length to be exactly 5, got 0");
		});

		it("should pass within min/max range", () => {
			const orchestrator = makeMockOrchestrator({
				conversation: [{ role: "user", content: "a" }],
			});

			expect(() =>
				assertOrchestratorState(orchestrator, { conversationLength: { min: 0, max: 10 } })
			).not.toThrow();
		});

		it("should fail when below min conversation length", () => {
			const orchestrator = makeMockOrchestrator({ conversation: [] });

			expect(() =>
				assertOrchestratorState(orchestrator, { conversationLength: { min: 1 } })
			).toThrow("Expected conversation length to be at least 1, got 0");
		});

		it("should fail when above max conversation length", () => {
			const orchestrator = makeMockOrchestrator({
				conversation: [
					{ role: "user", content: "a" },
					{ role: "assistant", content: "b" },
					{ role: "user", content: "c" },
				],
			});

			expect(() =>
				assertOrchestratorState(orchestrator, { conversationLength: { max: 2 } })
			).toThrow("Expected conversation length to be at most 2, got 3");
		});
	});

	it("should pass when no expectations are set", () => {
		const orchestrator = makeMockOrchestrator({});

		expect(() => assertOrchestratorState(orchestrator, {})).not.toThrow();
	});

	it("should validate multiple expectations at once", () => {
		const orchestrator = makeMockOrchestrator({
			agent: { status: "completed", tokenUsage: 500 } as OrchestratorState["agent"],
			approval: { pending: [], approved: ["a"], rejected: [] },
			conversation: [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "hello" },
			],
		});

		expect(() =>
			assertOrchestratorState(orchestrator, {
				agentStatus: "completed",
				tokenUsage: { min: 100, max: 1000 },
				pendingApprovals: 0,
				conversationLength: { exact: 2 },
			})
		).not.toThrow();
	});
});
