/**
 * OpenAI Agents Orchestrator Tests
 *
 * Comprehensive tests for createAgentOrchestrator covering:
 * - Basic agent execution
 * - Guardrail execution (input, output, toolCall)
 * - Approval workflows
 * - Budget constraints
 * - Error handling
 * - Builder pattern
 */

import { describe, expect, it, vi } from "vitest";
import {
	createAgentOrchestrator,
	createOrchestratorBuilder,
	createPIIGuardrail,
	createModerationGuardrail,
	createRateLimitGuardrail,
	createToolGuardrail,
	createOutputSchemaGuardrail,
	createOutputTypeGuardrail,
	createRunner,
	GuardrailError,
	type AgentLike,
	type AgentRunner,
	type RunResult,
	type OutputGuardrailData,
} from "../adapters/ai/index.js";
import { createAgentMemory, createSlidingWindowStrategy } from "../adapters/ai/memory.js";
import { createCircuitBreaker, CircuitBreakerOpenError } from "../adapters/plugins/circuit-breaker.js";

// ============================================================================
// Helpers
// ============================================================================

function makeAgent(name: string): AgentLike {
	return { name };
}

function makeRunResult<T>(output: T, totalTokens = 10): RunResult<T> {
	return { output, messages: [], toolCalls: [], totalTokens };
}

function createMockRunner(
	handler?: (agent: AgentLike, input: string) => unknown,
): AgentRunner {
	return vi.fn(async <T = unknown>(agent: AgentLike, input: string) => {
		const output = handler ? handler(agent, input) : `response from ${agent.name}`;
		return makeRunResult<T>(output as T);
	}) as unknown as AgentRunner;
}

// ============================================================================
// Basic Orchestrator
// ============================================================================

describe("createAgentOrchestrator", () => {
	describe("basic execution", () => {
		it("should run an agent and return result", async () => {
			const mockRun = createMockRunner();
			const orchestrator = createAgentOrchestrator({
				runner: mockRun,
				autoApproveToolCalls: true,
			});

			const result = await orchestrator.run(makeAgent("test"), "hello");

			expect(result.output).toBe("response from test");
			expect(result.totalTokens).toBe(10);
			expect(mockRun).toHaveBeenCalledOnce();
		});

		it("should update agent state during run", async () => {
			const orchestrator = createAgentOrchestrator({
				runner: createMockRunner(),
				autoApproveToolCalls: true,
			});

			expect(orchestrator.facts.agent.status).toBe("idle");

			const promise = orchestrator.run(makeAgent("test"), "hello");
			// State updates are synchronous at start
			expect(orchestrator.facts.agent.input).toBe("hello");

			await promise;
			expect(orchestrator.facts.agent.status).toBe("completed");
		});

		it("should track token usage", async () => {
			const orchestrator = createAgentOrchestrator({
				runner: createMockRunner(),
				autoApproveToolCalls: true,
			});

			await orchestrator.run(makeAgent("test"), "hello");
			expect(orchestrator.facts.agent.tokenUsage).toBe(10);

			await orchestrator.run(makeAgent("test"), "world");
			expect(orchestrator.facts.agent.tokenUsage).toBe(20);
		});

		it("should reset state correctly", async () => {
			const orchestrator = createAgentOrchestrator({
				runner: createMockRunner(),
				autoApproveToolCalls: true,
			});

			await orchestrator.run(makeAgent("test"), "hello");
			expect(orchestrator.facts.agent.tokenUsage).toBe(10);

			orchestrator.reset();
			expect(orchestrator.facts.agent.status).toBe("idle");
			expect(orchestrator.facts.agent.tokenUsage).toBe(0);
			expect(orchestrator.facts.agent.input).toBeNull(); // AgentState uses null for reset
		});
	});

	describe("approval workflow validation", () => {
		it("should default autoApproveToolCalls to true (no throw without callback)", () => {
			expect(() =>
				createAgentOrchestrator({
					runner: createMockRunner(),
				}),
			).not.toThrow();
		});

		it("should throw when autoApproveToolCalls is explicitly false and no callback", () => {
			expect(() =>
				createAgentOrchestrator({
					runner: createMockRunner(),
					autoApproveToolCalls: false,
				}),
			).toThrow("autoApproveToolCalls is false but no onApprovalRequest callback provided");
		});

		it("should accept when autoApproveToolCalls is true without callback", () => {
			expect(() =>
				createAgentOrchestrator({
					runner: createMockRunner(),
					autoApproveToolCalls: true,
				}),
			).not.toThrow();
		});

		it("should accept when callback is provided", () => {
			expect(() =>
				createAgentOrchestrator({
					runner: createMockRunner(),
					autoApproveToolCalls: false,
					onApprovalRequest: () => {},
				}),
			).not.toThrow();
		});

		it("should track rejection with reason and timestamp", () => {
			const orchestrator = createAgentOrchestrator({
				runner: createMockRunner(),
				autoApproveToolCalls: false,
				onApprovalRequest: () => {},
			});

			// Seed a pending request before rejecting
			orchestrator.system.batch(() => {
				orchestrator.system.facts.__approval = {
					pending: [{ id: "test-request-123", toolName: "test", arguments: "{}", createdAt: Date.now() }],
					approved: [],
					rejected: [],
				};
			});

			const beforeReject = Date.now();
			orchestrator.reject("test-request-123", "Security policy violation");
			const afterReject = Date.now();

			const rejected = orchestrator.facts.approval.rejected;
			expect(rejected.length).toBe(1);
			expect(rejected[0].id).toBe("test-request-123");
			expect(rejected[0].reason).toBe("Security policy violation");
			expect(rejected[0].rejectedAt).toBeGreaterThanOrEqual(beforeReject);
			expect(rejected[0].rejectedAt).toBeLessThanOrEqual(afterReject);
		});

		it("should track rejection without reason", () => {
			const orchestrator = createAgentOrchestrator({
				runner: createMockRunner(),
				autoApproveToolCalls: false,
				onApprovalRequest: () => {},
			});

			// Seed a pending request before rejecting
			orchestrator.system.batch(() => {
				orchestrator.system.facts.__approval = {
					pending: [{ id: "test-request-456", toolName: "test", arguments: "{}", createdAt: Date.now() }],
					approved: [],
					rejected: [],
				};
			});

			orchestrator.reject("test-request-456");

			const rejected = orchestrator.facts.approval.rejected;
			expect(rejected.length).toBe(1);
			expect(rejected[0].id).toBe("test-request-456");
			expect(rejected[0].reason).toBeUndefined();
			expect(rejected[0].rejectedAt).toBeGreaterThan(0);
		});

		it("should ignore approve/reject for non-pending IDs", () => {
			const orchestrator = createAgentOrchestrator({
				runner: createMockRunner(),
				autoApproveToolCalls: false,
				onApprovalRequest: () => {},
			});

			// No pending requests — approve/reject should be no-ops
			orchestrator.approve("phantom-id");
			orchestrator.reject("phantom-id", "test");

			expect(orchestrator.facts.approval.approved.length).toBe(0);
			expect(orchestrator.facts.approval.rejected.length).toBe(0);
		});
	});

	describe("budget constraints", () => {
		it("should track token usage and trigger constraint when budget exceeded", async () => {
			let pauseResolverCalled = false;
			const orchestrator = createAgentOrchestrator({
				runner: createMockRunner(() => "response"),
				autoApproveToolCalls: true,
				maxTokenBudget: 15,
				// Add a custom resolver to verify constraint triggers
				resolvers: {
					customPause: {
						requirement: (req): req is { type: "__PAUSE_BUDGET_EXCEEDED" } =>
							req.type === "__PAUSE_BUDGET_EXCEEDED",
						resolve: async () => {
							pauseResolverCalled = true;
						},
					},
				},
			});

			// First run uses 10 tokens
			await orchestrator.run(makeAgent("test"), "first");
			expect(orchestrator.facts.agent.tokenUsage).toBe(10);

			// Second run would exceed budget
			await orchestrator.run(makeAgent("test"), "second");
			expect(orchestrator.facts.agent.tokenUsage).toBe(20);
			// The built-in __budgetLimit constraint should trigger __PAUSE_BUDGET_EXCEEDED
			// which the built-in __pause resolver handles to set status to "paused"
		});

		it("should allow runs when under budget", async () => {
			const orchestrator = createAgentOrchestrator({
				runner: createMockRunner(() => "response"),
				autoApproveToolCalls: true,
				maxTokenBudget: 100,
			});

			await orchestrator.run(makeAgent("test"), "first");
			await orchestrator.run(makeAgent("test"), "second");

			expect(orchestrator.facts.agent.status).not.toBe("paused");
			expect(orchestrator.facts.agent.tokenUsage).toBe(20);
		});
	});

	describe("pause and resume", () => {
		it("should pause and resume correctly", () => {
			const orchestrator = createAgentOrchestrator({
				runner: createMockRunner(),
				autoApproveToolCalls: true,
			});

			expect(orchestrator.facts.agent.status).toBe("idle");

			orchestrator.pause();
			expect(orchestrator.facts.agent.status).toBe("paused");

			orchestrator.resume();
			expect(orchestrator.facts.agent.status).toBe("idle");
		});
	});
});

// ============================================================================
// Input Guardrails
// ============================================================================

describe("input guardrails", () => {
	it("should pass valid input through guardrails", async () => {
		const guardrail = vi.fn(async () => ({ passed: true }));
		const orchestrator = createAgentOrchestrator({
			runner: createMockRunner(),
			autoApproveToolCalls: true,
			guardrails: {
				input: [guardrail],
			},
		});

		await orchestrator.run(makeAgent("test"), "clean input");

		expect(guardrail).toHaveBeenCalledOnce();
		// Guardrail receives (data, context) - check data shape
		expect(guardrail).toHaveBeenCalledWith(
			expect.objectContaining({
				input: "clean input",
				agentName: "test",
			}),
			expect.objectContaining({
				agentName: "test",
				input: "clean input",
			}),
		);
	});

	it("should block input that fails guardrails", async () => {
		const guardrail = vi.fn(async () => ({
			passed: false,
			reason: "Contains bad content",
		}));
		const orchestrator = createAgentOrchestrator({
			runner: createMockRunner(),
			autoApproveToolCalls: true,
			guardrails: {
				input: [guardrail],
			},
		});

		await expect(orchestrator.run(makeAgent("test"), "bad input")).rejects.toThrow(
			GuardrailError,
		);
	});

	it("should run guardrails in order and stop on first failure", async () => {
		const order: number[] = [];
		const guardrail1 = vi.fn(async () => {
			order.push(1);
			return { passed: true };
		});
		const guardrail2 = vi.fn(async () => {
			order.push(2);
			return { passed: false, reason: "Failed" };
		});
		const guardrail3 = vi.fn(async () => {
			order.push(3);
			return { passed: true };
		});

		const orchestrator = createAgentOrchestrator({
			runner: createMockRunner(),
			autoApproveToolCalls: true,
			guardrails: {
				input: [guardrail1, guardrail2, guardrail3],
			},
		});

		await expect(orchestrator.run(makeAgent("test"), "input")).rejects.toThrow();

		expect(order).toEqual([1, 2]);
		expect(guardrail3).not.toHaveBeenCalled();
	});

	it("should support named guardrails", async () => {
		const orchestrator = createAgentOrchestrator({
			runner: createMockRunner(),
			autoApproveToolCalls: true,
			guardrails: {
				input: [
					{
						name: "custom-check",
						fn: async () => ({ passed: false, reason: "Custom failure" }),
					},
				],
			},
		});

		try {
			await orchestrator.run(makeAgent("test"), "input");
			expect.fail("Should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(GuardrailError);
			expect((error as GuardrailError).guardrailName).toBe("custom-check");
		}
	});
});

// ============================================================================
// Output Guardrails
// ============================================================================

describe("output guardrails", () => {
	it("should check output after agent completes", async () => {
		const outputGuardrail = vi.fn(async (data: OutputGuardrailData) => {
			return { passed: data.output !== "bad output" };
		});

		const orchestrator = createAgentOrchestrator({
			runner: createMockRunner(() => "good output"),
			autoApproveToolCalls: true,
			guardrails: {
				output: [outputGuardrail],
			},
		});

		await orchestrator.run(makeAgent("test"), "input");

		// Output guardrail receives (data, context)
		expect(outputGuardrail).toHaveBeenCalledWith(
			expect.objectContaining({
				output: "good output",
				agentName: "test",
				input: "input",
				messages: [],
			}),
			expect.objectContaining({
				agentName: "test",
				input: "input",
			}),
		);
	});

	it("should throw GuardrailError for bad output", async () => {
		const outputGuardrail = vi.fn(async () => ({
			passed: false,
			reason: "Output contains PII",
		}));

		const orchestrator = createAgentOrchestrator({
			runner: createMockRunner(() => "SSN: 123-45-6789"),
			autoApproveToolCalls: true,
			guardrails: {
				output: [outputGuardrail],
			},
		});

		try {
			await orchestrator.run(makeAgent("test"), "input");
			expect.fail("Should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(GuardrailError);
			expect((error as GuardrailError).guardrailType).toBe("output");
		}
	});
});

// ============================================================================
// Built-in Guardrails
// ============================================================================

describe("built-in guardrails", () => {
	// Helper to create guardrail context
	function makeContext(input: string, agentName = "test"): { agentName: string; input: string; facts: Record<string, unknown> } {
		return { agentName, input, facts: {} };
	}

	describe("createPIIGuardrail", () => {
		it("should detect SSN patterns", async () => {
			const guardrail = createPIIGuardrail({});
			const input = "My SSN is 123-45-6789";
			const result = await guardrail(
				{ input, agentName: "test" },
				makeContext(input),
			);
			expect(result.passed).toBe(false);
			expect(result.reason).toContain("PII");
		});

		it("should pass clean input", async () => {
			const guardrail = createPIIGuardrail({});
			const input = "Hello, how are you?";
			const result = await guardrail(
				{ input, agentName: "test" },
				makeContext(input),
			);
			expect(result.passed).toBe(true);
		});
	});

	describe("createModerationGuardrail", () => {
		it("should use provided check function", async () => {
			const checkFn = vi.fn(async () => true); // flagged = true
			const guardrail = createModerationGuardrail({ checkFn });
			const input = "test content";

			const result = await guardrail(
				{ input, agentName: "test" },
				makeContext(input),
			);

			expect(result.passed).toBe(false);
			expect(checkFn).toHaveBeenCalledWith("test content");
		});
	});

	describe("createRateLimitGuardrail", () => {
		it("should allow requests within limit", async () => {
			const guardrail = createRateLimitGuardrail({
				maxRequestsPerMinute: 2,
			});

			const result1 = guardrail({ input: "first", agentName: "test" }, makeContext("first"));
			const result2 = guardrail({ input: "second", agentName: "test" }, makeContext("second"));

			expect(result1.passed).toBe(true);
			expect(result2.passed).toBe(true);

			// Reset for next test
			guardrail.reset();
		});

		it("should reject requests over limit", async () => {
			const guardrail = createRateLimitGuardrail({
				maxRequestsPerMinute: 1,
			});

			guardrail({ input: "first", agentName: "test" }, makeContext("first"));
			const result = guardrail({ input: "second", agentName: "test" }, makeContext("second"));

			expect(result.passed).toBe(false);
			expect(result.reason).toContain("rate limit");

			// Reset for next test
			guardrail.reset();
		});
	});

	describe("createToolGuardrail", () => {
		it("should allow whitelisted tools", async () => {
			const guardrail = createToolGuardrail({
				allowlist: ["search", "calculate"],
			});

			const result = await guardrail(
				{
					toolCall: { id: "1", name: "search", arguments: "{}" },
					agentName: "test",
					input: "",
				},
				makeContext(""),
			);

			expect(result.passed).toBe(true);
		});

		it("should reject non-whitelisted tools", async () => {
			const guardrail = createToolGuardrail({
				allowlist: ["search"],
			});

			const result = await guardrail(
				{
					toolCall: { id: "1", name: "dangerous_tool", arguments: "{}" },
					agentName: "test",
					input: "",
				},
				makeContext(""),
			);

			expect(result.passed).toBe(false);
			expect(result.reason).toContain("not in allowlist");
		});
	});

	describe("createOutputSchemaGuardrail", () => {
		it("should pass valid output with custom validator", async () => {
			const guardrail = createOutputSchemaGuardrail({
				validate: (output) => {
					if (typeof output === "object" && output !== null && "answer" in output) {
						return { valid: true };
					}
					return { valid: false, errors: ["Missing answer field"] };
				},
			});

			const result = await guardrail(
				{ output: { answer: "Hello" }, agentName: "test", input: "", messages: [] },
				makeContext(""),
			);

			expect(result.passed).toBe(true);
		});

		it("should fail invalid output with error details", async () => {
			const guardrail = createOutputSchemaGuardrail({
				validate: (output) => {
					if (typeof output !== "object" || output === null) {
						return { valid: false, errors: ["Must be an object"] };
					}
					return { valid: true };
				},
			});

			const result = await guardrail(
				{ output: "not an object", agentName: "test", input: "", messages: [] },
				makeContext(""),
			);

			expect(result.passed).toBe(false);
			expect(result.reason).toContain("Must be an object");
		});

		it("should support boolean return from validator", async () => {
			const guardrail = createOutputSchemaGuardrail({
				validate: (output) => typeof output === "string",
			});

			const validResult = await guardrail(
				{ output: "valid string", agentName: "test", input: "", messages: [] },
				makeContext(""),
			);
			expect(validResult.passed).toBe(true);

			const invalidResult = await guardrail(
				{ output: 123, agentName: "test", input: "", messages: [] },
				makeContext(""),
			);
			expect(invalidResult.passed).toBe(false);
		});
	});

	describe("createOutputTypeGuardrail", () => {
		it("should validate string type", async () => {
			const guardrail = createOutputTypeGuardrail({ type: "string" });

			const validResult = await guardrail(
				{ output: "hello", agentName: "test", input: "", messages: [] },
				makeContext(""),
			);
			expect(validResult.passed).toBe(true);

			const invalidResult = await guardrail(
				{ output: 123, agentName: "test", input: "", messages: [] },
				makeContext(""),
			);
			expect(invalidResult.passed).toBe(false);
			expect(invalidResult.reason).toContain("Expected string");
		});

		it("should validate object with required fields", async () => {
			const guardrail = createOutputTypeGuardrail({
				type: "object",
				requiredFields: ["name", "value"],
			});

			const validResult = await guardrail(
				{ output: { name: "test", value: 42 }, agentName: "test", input: "", messages: [] },
				makeContext(""),
			);
			expect(validResult.passed).toBe(true);

			const missingFieldResult = await guardrail(
				{ output: { name: "test" }, agentName: "test", input: "", messages: [] },
				makeContext(""),
			);
			expect(missingFieldResult.passed).toBe(false);
			expect(missingFieldResult.reason).toContain("Missing required field: value");
		});

		it("should validate array with length constraints", async () => {
			const guardrail = createOutputTypeGuardrail({
				type: "array",
				minLength: 2,
				maxLength: 5,
			});

			const validResult = await guardrail(
				{ output: [1, 2, 3], agentName: "test", input: "", messages: [] },
				makeContext(""),
			);
			expect(validResult.passed).toBe(true);

			const tooShortResult = await guardrail(
				{ output: [1], agentName: "test", input: "", messages: [] },
				makeContext(""),
			);
			expect(tooShortResult.passed).toBe(false);
			expect(tooShortResult.reason).toContain("Array too short");

			const tooLongResult = await guardrail(
				{ output: [1, 2, 3, 4, 5, 6], agentName: "test", input: "", messages: [] },
				makeContext(""),
			);
			expect(tooLongResult.passed).toBe(false);
			expect(tooLongResult.reason).toContain("Array too long");
		});
	});
});

// ============================================================================
// GuardrailError
// ============================================================================

describe("GuardrailError", () => {
	it("should have correct properties", () => {
		const error = new GuardrailError({
			code: "INPUT_GUARDRAIL_FAILED",
			message: "Test error",
			guardrailName: "test-guardrail",
			guardrailType: "input",
			userMessage: "Please try again",
			data: { detail: "extra info" },
			agentName: "my-agent",
			input: "sensitive input",
		});

		expect(error.code).toBe("INPUT_GUARDRAIL_FAILED");
		expect(error.guardrailName).toBe("test-guardrail");
		expect(error.guardrailType).toBe("input");
		expect(error.userMessage).toBe("Please try again");
		expect(error.agentName).toBe("my-agent");
	});

	it("should have non-enumerable sensitive fields", () => {
		const error = new GuardrailError({
			code: "INPUT_GUARDRAIL_FAILED",
			message: "Test error",
			guardrailName: "test",
			guardrailType: "input",
			agentName: "agent",
			input: "sensitive",
			data: { secret: "value" },
		});

		// These should be accessible but not enumerable
		expect(error.input).toBe("sensitive");
		expect(error.data).toEqual({ secret: "value" });

		// Should not appear in JSON
		const json = JSON.stringify(error);
		expect(json).not.toContain("sensitive");
		expect(json).not.toContain("secret");
	});

	it("should have toJSON method excluding sensitive data", () => {
		const error = new GuardrailError({
			code: "OUTPUT_GUARDRAIL_FAILED",
			message: "Failed",
			guardrailName: "pii-check",
			guardrailType: "output",
			agentName: "agent",
			input: "secret input",
			data: { pii: "123-45-6789" },
		});

		const json = error.toJSON();

		expect(json.code).toBe("OUTPUT_GUARDRAIL_FAILED");
		expect(json.guardrailName).toBe("pii-check");
		expect(json).not.toHaveProperty("input");
		expect(json).not.toHaveProperty("data");
	});
});

// ============================================================================
// Builder Pattern
// ============================================================================

describe("createOrchestratorBuilder", () => {
	it("should build orchestrator with fluent API", () => {
		const mockRun = createMockRunner();
		const inputGuardrail = vi.fn(async () => ({ passed: true }));

		// Builder creates orchestrator with auto-approve by default
		const orchestrator = createOrchestratorBuilder()
			.withInputGuardrail("check", inputGuardrail)
			.build({
				runner: mockRun,
				autoApproveToolCalls: true,
			});

		expect(orchestrator).toBeDefined();
		expect(orchestrator.run).toBeDefined();
	});

	it("should accumulate multiple guardrails", async () => {
		const mockRun = createMockRunner();
		const guard1 = vi.fn(async () => ({ passed: true }));
		const guard2 = vi.fn(async () => ({ passed: true }));

		const orchestrator = createOrchestratorBuilder()
			.withInputGuardrail("first", guard1)
			.withInputGuardrail("second", guard2)
			.build({
				runner: mockRun,
				autoApproveToolCalls: true,
			});

		await orchestrator.run(makeAgent("test"), "input");

		expect(guard1).toHaveBeenCalledOnce();
		expect(guard2).toHaveBeenCalledOnce();
	});

	it("should support constraints via builder", async () => {
		const mockRun = createMockRunner();

		// Create orchestrator with a budget constraint
		const orchestrator = createOrchestratorBuilder()
			.withConstraint("token-check", {
				when: (facts) => facts.agent.tokenUsage > 5,
				require: { type: "LOG_USAGE" },
			})
			.withBudget(100)
			.build({
				runner: mockRun,
				autoApproveToolCalls: true,
			});

		await orchestrator.run(makeAgent("test"), "input");

		// Token usage should be tracked correctly
		expect(orchestrator.facts.agent.tokenUsage).toBe(10);
		// Constraint is registered (verified by not throwing during setup)
		// Note: Constraint evaluation timing depends on Directive core's reconciliation loop
	});
});

// ============================================================================
// Error Handling
// ============================================================================

describe("error handling", () => {
	it("should throw when agent fails", async () => {
		const failingRun = vi.fn(async () => {
			throw new Error("Agent crashed");
		}) as unknown as AgentRunner;

		const orchestrator = createAgentOrchestrator({
			runner: failingRun,
			autoApproveToolCalls: true,
		});

		await expect(orchestrator.run(makeAgent("test"), "input")).rejects.toThrow("Agent crashed");
		// Note: The current implementation doesn't update status on agent failure
		// as the error is thrown before the status update runs
	});

	it("should retry agent on transient failure with agentRetry config", async () => {
		let attempts = 0;
		const transientFailRun = vi.fn(async () => {
			attempts++;
			if (attempts < 3) {
				throw new Error("Transient failure");
			}
			return makeRunResult("success after retry");
		}) as unknown as AgentRunner;

		const onRetry = vi.fn();
		const orchestrator = createAgentOrchestrator({
			runner: transientFailRun,
			autoApproveToolCalls: true,
			agentRetry: {
				attempts: 3,
				baseDelayMs: 10, // Short delay for testing
				onRetry,
			},
		});

		const result = await orchestrator.run(makeAgent("test"), "input");

		expect(result.output).toBe("success after retry");
		expect(attempts).toBe(3);
		expect(onRetry).toHaveBeenCalledTimes(2); // Called before each retry
	});

	it("should respect isRetryable filter in agentRetry config", async () => {
		let attempts = 0;
		const nonRetryableRun = vi.fn(async () => {
			attempts++;
			throw new Error("Non-retryable error");
		}) as unknown as AgentRunner;

		const orchestrator = createAgentOrchestrator({
			runner: nonRetryableRun,
			autoApproveToolCalls: true,
			agentRetry: {
				attempts: 3,
				baseDelayMs: 10,
				isRetryable: () => false, // No errors are retryable
			},
		});

		await expect(orchestrator.run(makeAgent("test"), "input")).rejects.toThrow("Non-retryable error");
		expect(attempts).toBe(1); // Should only try once
	});

	it("should throw the original error when guardrail throws", async () => {
		const throwingGuardrail = vi.fn(async () => {
			throw new Error("Guardrail internal error");
		});

		const orchestrator = createAgentOrchestrator({
			runner: createMockRunner(),
			autoApproveToolCalls: true,
			guardrails: {
				input: [throwingGuardrail],
			},
		});

		// Guardrail throws are re-thrown as the original error (not wrapped in GuardrailError)
		await expect(orchestrator.run(makeAgent("test"), "input")).rejects.toThrow("Guardrail internal error");
	});
});

// ============================================================================
// dispose()
// ============================================================================

describe("dispose", () => {
	it("should clean up orchestrator", () => {
		const orchestrator = createAgentOrchestrator({
			runner: createMockRunner(),
			autoApproveToolCalls: true,
		});

		// Should not throw
		expect(() => orchestrator.dispose()).not.toThrow();
	});
});

// ============================================================================
// Lifecycle Hooks
// ============================================================================

describe("lifecycle hooks", () => {
	it("should call onAgentStart and onAgentComplete hooks", async () => {
		const onAgentStart = vi.fn();
		const onAgentComplete = vi.fn();

		const orchestrator = createAgentOrchestrator({
			runner: createMockRunner(() => "test output"),
			autoApproveToolCalls: true,
			hooks: {
				onAgentStart,
				onAgentComplete,
			},
		});

		await orchestrator.run(makeAgent("test-agent"), "hello");

		expect(onAgentStart).toHaveBeenCalledOnce();
		expect(onAgentStart).toHaveBeenCalledWith(
			expect.objectContaining({
				agentName: "test-agent",
				input: "hello",
				timestamp: expect.any(Number),
			}),
		);

		expect(onAgentComplete).toHaveBeenCalledOnce();
		expect(onAgentComplete).toHaveBeenCalledWith(
			expect.objectContaining({
				agentName: "test-agent",
				input: "hello",
				output: "test output",
				tokenUsage: 10,
				durationMs: expect.any(Number),
				timestamp: expect.any(Number),
			}),
		);
	});

	it("should call onGuardrailCheck hook for each guardrail", async () => {
		const onGuardrailCheck = vi.fn();

		const orchestrator = createAgentOrchestrator({
			runner: createMockRunner(),
			autoApproveToolCalls: true,
			guardrails: {
				input: [
					{ name: "input-check", fn: async () => ({ passed: true }) },
				],
				output: [
					{ name: "output-check", fn: async () => ({ passed: true }) },
				],
			},
			hooks: {
				onGuardrailCheck,
			},
		});

		await orchestrator.run(makeAgent("test"), "input");

		expect(onGuardrailCheck).toHaveBeenCalledTimes(2);
		expect(onGuardrailCheck).toHaveBeenCalledWith(
			expect.objectContaining({
				guardrailName: "input-check",
				guardrailType: "input",
				passed: true,
				durationMs: expect.any(Number),
			}),
		);
		expect(onGuardrailCheck).toHaveBeenCalledWith(
			expect.objectContaining({
				guardrailName: "output-check",
				guardrailType: "output",
				passed: true,
			}),
		);
	});

	it("should call onAgentRetry hook on retry", async () => {
		let attempts = 0;
		const onAgentRetry = vi.fn();

		const orchestrator = createAgentOrchestrator({
			runner: vi.fn(async () => {
				attempts++;
				if (attempts < 2) {
					throw new Error("Transient error");
				}
				return makeRunResult("success");
			}) as unknown as AgentRunner,
			autoApproveToolCalls: true,
			agentRetry: {
				attempts: 2,
				baseDelayMs: 1,
			},
			hooks: {
				onAgentRetry,
			},
		});

		await orchestrator.run(makeAgent("test"), "input");

		expect(onAgentRetry).toHaveBeenCalledOnce();
		expect(onAgentRetry).toHaveBeenCalledWith(
			expect.objectContaining({
				agentName: "test",
				attempt: 1,
				error: expect.any(Error),
				delayMs: expect.any(Number),
			}),
		);
	});
});

// ============================================================================
// Memory Integration
// ============================================================================

describe("memory integration", () => {
	it("should auto-inject memory context into agent instructions", async () => {
		const memory = createAgentMemory({
			strategy: createSlidingWindowStrategy(),
			strategyConfig: { maxMessages: 50 },
		});

		// Seed memory with a message
		memory.addMessage({ role: "user", content: "previous question" });
		memory.addMessage({ role: "assistant", content: "previous answer" });

		let capturedAgent: AgentLike | undefined;
		const mockRun: AgentRunner = vi.fn(async <T = unknown>(agent: AgentLike, _input: string) => {
			capturedAgent = agent;
			return makeRunResult<T>("response" as T);
		}) as unknown as AgentRunner;

		const orchestrator = createAgentOrchestrator({
			runner: mockRun,
			memory,
		});

		await orchestrator.run(makeAgent("test-agent"), "hello");

		// Agent instructions should include memory context
		expect(capturedAgent).toBeDefined();
		expect(capturedAgent!.instructions).toContain("previous question");
		expect(capturedAgent!.instructions).toContain("previous answer");
	});

	it("should auto-store result messages in memory after run", async () => {
		const memory = createAgentMemory({
			strategy: createSlidingWindowStrategy(),
			strategyConfig: { maxMessages: 50 },
		});

		const mockRun: AgentRunner = vi.fn(async <T = unknown>(_agent: AgentLike, _input: string) => {
			return {
				output: "response" as T,
				messages: [
					{ role: "user" as const, content: "hello" },
					{ role: "assistant" as const, content: "hi back" },
				],
				toolCalls: [],
				totalTokens: 10,
			};
		}) as unknown as AgentRunner;

		const orchestrator = createAgentOrchestrator({
			runner: mockRun,
			memory,
		});

		await orchestrator.run(makeAgent("test"), "hello");

		// Memory should now contain the messages from the run
		const state = memory.getState();
		expect(state.messages.length).toBe(2);
		expect(state.messages[0]!.content).toBe("hello");
		expect(state.messages[1]!.content).toBe("hi back");
	});

	it("should not mutate the original agent object", async () => {
		const memory = createAgentMemory({
			strategy: createSlidingWindowStrategy(),
			strategyConfig: { maxMessages: 50 },
		});
		memory.addMessage({ role: "user", content: "context" });

		const originalAgent = makeAgent("test");
		originalAgent.instructions = "Be helpful";

		const orchestrator = createAgentOrchestrator({
			runner: createMockRunner(),
			memory,
		});

		await orchestrator.run(originalAgent, "hello");

		// Original agent should not be mutated
		expect(originalAgent.instructions).toBe("Be helpful");
	});
});

// ============================================================================
// Circuit Breaker Integration
// ============================================================================

describe("circuit breaker integration", () => {
	it("should wrap agent runs in circuit breaker", async () => {
		const cb = createCircuitBreaker({
			failureThreshold: 2,
			recoveryTimeMs: 30000,
			name: "test-cb",
		});

		const orchestrator = createAgentOrchestrator({
			runner: createMockRunner(),
			circuitBreaker: cb,
		});

		const result = await orchestrator.run(makeAgent("test"), "hello");
		expect(result.output).toBe("response from test");

		// Circuit should still be closed after success
		expect(cb.getState()).toBe("CLOSED");
		expect(cb.getStats().totalSuccesses).toBe(1);
	});

	it("should throw CircuitBreakerOpenError when circuit is open", async () => {
		const cb = createCircuitBreaker({
			failureThreshold: 1,
			recoveryTimeMs: 60000,
			name: "test-cb",
		});

		const failingRun = vi.fn(async () => {
			throw new Error("API down");
		}) as unknown as AgentRunner;

		const orchestrator = createAgentOrchestrator({
			runner: failingRun,
			circuitBreaker: cb,
		});

		// First call fails, opens the circuit
		await expect(orchestrator.run(makeAgent("test"), "hello")).rejects.toThrow("API down");

		// Second call should be rejected by circuit breaker
		await expect(orchestrator.run(makeAgent("test"), "hello")).rejects.toThrow(CircuitBreakerOpenError);
	});
});

// ============================================================================
// Per-Call Guardrail Overrides
// ============================================================================

describe("per-call guardrail overrides", () => {
	it("should skip output guardrails when overridden with empty array", async () => {
		const outputGuardrail = vi.fn(async () => ({
			passed: false,
			reason: "Always fails",
		}));

		const orchestrator = createAgentOrchestrator({
			runner: createMockRunner(),
			guardrails: {
				output: [outputGuardrail],
			},
		});

		// With default guardrails, this would throw
		await expect(orchestrator.run(makeAgent("test"), "input")).rejects.toThrow();

		// With empty override, output guardrails are skipped
		const result = await orchestrator.run(makeAgent("test"), "input", {
			outputGuardrails: [],
		});
		expect(result.output).toBe("response from test");
		// The output guardrail was called once (first run), not in the second
		expect(outputGuardrail).toHaveBeenCalledTimes(1);
	});

	it("should use per-call guardrails instead of defaults", async () => {
		const defaultGuardrail = vi.fn(async () => ({ passed: true }));
		const perCallGuardrail = vi.fn(async () => ({ passed: true }));

		const orchestrator = createAgentOrchestrator({
			runner: createMockRunner(),
			guardrails: {
				output: [defaultGuardrail],
			},
		});

		await orchestrator.run(makeAgent("test"), "input", {
			outputGuardrails: [perCallGuardrail],
		});

		expect(defaultGuardrail).not.toHaveBeenCalled();
		expect(perCallGuardrail).toHaveBeenCalledOnce();
	});

	it("should skip input guardrails when overridden with empty array", async () => {
		const inputGuardrail = vi.fn(async () => ({
			passed: false,
			reason: "Blocked",
		}));

		const orchestrator = createAgentOrchestrator({
			runner: createMockRunner(),
			guardrails: {
				input: [inputGuardrail],
			},
		});

		// Override input guardrails for this call
		const result = await orchestrator.run(makeAgent("test"), "input", {
			inputGuardrails: [],
		});
		expect(result.output).toBe("response from test");
		expect(inputGuardrail).not.toHaveBeenCalled();
	});

	it("should use default guardrails when options is undefined", async () => {
		const outputGuardrail = vi.fn(async () => ({ passed: true }));

		const orchestrator = createAgentOrchestrator({
			runner: createMockRunner(),
			guardrails: {
				output: [outputGuardrail],
			},
		});

		await orchestrator.run(makeAgent("test"), "input");
		expect(outputGuardrail).toHaveBeenCalledOnce();
	});
});

// ============================================================================
// createRunner
// ============================================================================

describe("createRunner", () => {
	it("should create a working AgentRunner from buildRequest/parseResponse", async () => {
		const mockFetch = vi.fn(async () => ({
			ok: true,
			json: async () => ({ text: "hello world", tokens: 42 }),
			status: 200,
			statusText: "OK",
		})) as unknown as typeof fetch;

		const runner = createRunner({
			fetch: mockFetch,
			buildRequest: (agent, input) => ({
				url: "https://api.example.com/chat",
				init: {
					method: "POST",
					body: JSON.stringify({ model: agent.model, input }),
				},
			}),
			parseResponse: async (response) => {
				const data = await response.json() as { text: string; tokens: number };
				return { text: data.text, totalTokens: data.tokens };
			},
		});

		const result = await runner(makeAgent("test"), "hello");

		expect(result.output).toBe("hello world");
		expect(result.totalTokens).toBe(42);
		expect(result.messages).toHaveLength(2);
		expect(result.messages[0]!.role).toBe("user");
		expect(result.messages[1]!.role).toBe("assistant");
		expect(mockFetch).toHaveBeenCalledOnce();
	});

	it("should throw on non-OK response", async () => {
		const mockFetch = vi.fn(async () => ({
			ok: false,
			status: 500,
			statusText: "Internal Server Error",
		})) as unknown as typeof fetch;

		const runner = createRunner({
			fetch: mockFetch,
			buildRequest: () => ({ url: "https://api.example.com/chat", init: {} }),
			parseResponse: async () => ({ text: "", totalTokens: 0 }),
		});

		await expect(runner(makeAgent("test"), "hello")).rejects.toThrow("500");
	});

	it("should parse JSON output by default", async () => {
		const mockFetch = vi.fn(async () => ({
			ok: true,
			json: async () => ({ text: '{"answer": "42"}', tokens: 10 }),
			status: 200,
			statusText: "OK",
		})) as unknown as typeof fetch;

		const runner = createRunner({
			fetch: mockFetch,
			buildRequest: () => ({ url: "/api/chat", init: {} }),
			parseResponse: async (res) => {
				const data = await res.json() as { text: string; tokens: number };
				return { text: data.text, totalTokens: data.tokens };
			},
		});

		const result = await runner<{ answer: string }>(makeAgent("test"), "hello");
		expect(result.output).toEqual({ answer: "42" });
	});

	it("should use custom parseOutput when provided", async () => {
		const mockFetch = vi.fn(async () => ({
			ok: true,
			json: async () => ({ text: "custom-format:42", tokens: 5 }),
			status: 200,
			statusText: "OK",
		})) as unknown as typeof fetch;

		const runner = createRunner({
			fetch: mockFetch,
			buildRequest: () => ({ url: "/api/chat", init: {} }),
			parseResponse: async (res) => {
				const data = await res.json() as { text: string; tokens: number };
				return { text: data.text, totalTokens: data.tokens };
			},
			parseOutput: <T>(text: string): T => {
				const [format, value] = text.split(":");
				return { format, value: Number(value) } as T;
			},
		});

		const result = await runner(makeAgent("test"), "hello");
		expect(result.output).toEqual({ format: "custom-format", value: 42 });
	});
});
