import { describe, it, expect } from "vitest";
import { createMockAgentRunner } from "../testing.js";
import { createAgentOrchestrator } from "../agent-orchestrator.js";

// ============================================================================
// Helpers
// ============================================================================

function mockAgent(name = "test-agent") {
	return { name, instructions: "Be helpful." };
}

// ============================================================================
// budgetWarningThreshold / onBudgetWarning
// ============================================================================

describe("budgetWarningThreshold / onBudgetWarning (C1)", () => {
	it("fires onBudgetWarning at threshold", async () => {
		const warnings: Array<{ currentTokens: number; maxBudget: number; percentage: number }> = [];
		const mock = createMockAgentRunner({
			defaultResponse: { output: "hello", totalTokens: 90 },
		});
		const orchestrator = createAgentOrchestrator({
			runner: mock.run,
			maxTokenBudget: 100,
			budgetWarningThreshold: 0.8,
			onBudgetWarning: (event) => {
				warnings.push(event);
			},
		});

		// 90 tokens = 90% of 100, exceeds 80% threshold
		await orchestrator.run(mockAgent(), "hello");

		expect(warnings).toHaveLength(1);
		expect(warnings[0]!.currentTokens).toBe(90);
		expect(warnings[0]!.maxBudget).toBe(100);
		expect(warnings[0]!.percentage).toBeCloseTo(0.9);
	});

	it("fires only once across multiple runs", async () => {
		const warnings: unknown[] = [];
		const mock = createMockAgentRunner({
			defaultResponse: { output: "hello", totalTokens: 50 },
		});
		const orchestrator = createAgentOrchestrator({
			runner: mock.run,
			maxTokenBudget: 100,
			budgetWarningThreshold: 0.4,
			onBudgetWarning: (event) => {
				warnings.push(event);
			},
		});

		// First run: 50 tokens = 50%, exceeds 40% threshold → fires
		await orchestrator.run(mockAgent(), "hello");
		expect(warnings).toHaveLength(1);

		// Second run: now at 100 tokens, but warning already fired → no second fire
		await orchestrator.run(mockAgent(), "hello").catch(() => {});
		expect(warnings).toHaveLength(1);
	});

	it("does not fire when below threshold", async () => {
		const warnings: unknown[] = [];
		const mock = createMockAgentRunner({
			defaultResponse: { output: "hello", totalTokens: 10 },
		});
		const orchestrator = createAgentOrchestrator({
			runner: mock.run,
			maxTokenBudget: 100,
			budgetWarningThreshold: 0.8,
			onBudgetWarning: (event) => {
				warnings.push(event);
			},
		});

		// 10 tokens = 10%, below 80% threshold
		await orchestrator.run(mockAgent(), "hello");

		expect(warnings).toHaveLength(0);
	});

	it("resets warning state on reset()", async () => {
		const warnings: unknown[] = [];
		const mock = createMockAgentRunner({
			defaultResponse: { output: "hello", totalTokens: 90 },
		});
		const orchestrator = createAgentOrchestrator({
			runner: mock.run,
			maxTokenBudget: 100,
			budgetWarningThreshold: 0.8,
			onBudgetWarning: (event) => {
				warnings.push(event);
			},
		});

		await orchestrator.run(mockAgent(), "hello");
		expect(warnings).toHaveLength(1);

		// Reset resets the warning flag
		orchestrator.reset();

		// After reset, tokens are 0 again so 90 tokens will re-trigger
		await orchestrator.run(mockAgent(), "hello");
		expect(warnings).toHaveLength(2);
	});

	it("validates budgetWarningThreshold range", () => {
		const mock = createMockAgentRunner();

		expect(() =>
			createAgentOrchestrator({
				runner: mock.run,
				budgetWarningThreshold: -0.1,
			}),
		).toThrow("budgetWarningThreshold must be between 0 and 1");

		expect(() =>
			createAgentOrchestrator({
				runner: mock.run,
				budgetWarningThreshold: 1.5,
			}),
		).toThrow("budgetWarningThreshold must be between 0 and 1");
	});

	it("throwing onBudgetWarning does not crash the orchestrator", async () => {
		const mock = createMockAgentRunner({
			defaultResponse: { output: "hello", totalTokens: 90 },
		});
		const orchestrator = createAgentOrchestrator({
			runner: mock.run,
			maxTokenBudget: 100,
			budgetWarningThreshold: 0.8,
			onBudgetWarning: () => {
				throw new Error("callback exploded");
			},
		});

		// Should not throw despite callback throwing
		const result = await orchestrator.run(mockAgent(), "hello");

		expect(result.output).toBe("hello");
	});
});

// ============================================================================
// totalTokens convenience property
// ============================================================================

describe("totalTokens convenience property (C2)", () => {
	it("starts at 0", () => {
		const mock = createMockAgentRunner();
		const orchestrator = createAgentOrchestrator({ runner: mock.run });

		expect(orchestrator.totalTokens).toBe(0);
	});

	it("accumulates across runs", async () => {
		const mock = createMockAgentRunner({
			defaultResponse: { output: "hello", totalTokens: 42 },
		});
		const orchestrator = createAgentOrchestrator({ runner: mock.run });

		await orchestrator.run(mockAgent(), "hello");
		expect(orchestrator.totalTokens).toBe(42);

		await orchestrator.run(mockAgent(), "hello again");
		expect(orchestrator.totalTokens).toBe(84);
	});

	it("resets to 0 on reset()", async () => {
		const mock = createMockAgentRunner({
			defaultResponse: { output: "hello", totalTokens: 100 },
		});
		const orchestrator = createAgentOrchestrator({ runner: mock.run });

		await orchestrator.run(mockAgent(), "hello");
		expect(orchestrator.totalTokens).toBe(100);

		orchestrator.reset();
		expect(orchestrator.totalTokens).toBe(0);
	});
});

// ============================================================================
// waitForIdle
// ============================================================================

describe("waitForIdle (H1)", () => {
	it("resolves immediately when idle", async () => {
		const mock = createMockAgentRunner();
		const orchestrator = createAgentOrchestrator({ runner: mock.run });

		// Should resolve without delay
		await orchestrator.waitForIdle();
	});

	it("resolves after run completes", async () => {
		const mock = createMockAgentRunner({
			defaultResponse: { output: "hello", totalTokens: 10 },
		});
		const orchestrator = createAgentOrchestrator({ runner: mock.run });

		// Start a run in the background
		const runPromise = orchestrator.run(mockAgent(), "hello");

		// waitForIdle should resolve after run finishes
		await runPromise;
		await orchestrator.waitForIdle();
	});

	it("times out when stuck", async () => {
		let resolveRunner!: () => void;
		const runnerPromise = new Promise<void>((r) => { resolveRunner = r; });

		const runner = async () => {
			await runnerPromise;

			return { output: "hello", messages: [], toolCalls: [], totalTokens: 0 };
		};
		const orchestrator = createAgentOrchestrator({ runner: runner as any });

		// Start a long-running agent
		const runPromise = orchestrator.run(mockAgent(), "hello").catch(() => {});

		// waitForIdle should time out
		await expect(orchestrator.waitForIdle(100)).rejects.toThrow("waitForIdle timed out");

		// Clean up
		resolveRunner();
		await runPromise;
	});
});

// ============================================================================
// agentId in onGuardrailCheck hook
// ============================================================================

describe("agentId in onGuardrailCheck (M1)", () => {
	it("includes agentId in guardrail check events", async () => {
		const events: Array<{ agentId?: string; guardrailType: string }> = [];
		const mock = createMockAgentRunner({
			defaultResponse: { output: "safe output", totalTokens: 10 },
		});
		const orchestrator = createAgentOrchestrator({
			runner: mock.run,
			guardrails: {
				input: [{ name: "allow-all", fn: async () => ({ passed: true }) }],
				output: [{ name: "allow-all-output", fn: async () => ({ passed: true }) }],
			},
			hooks: {
				onGuardrailCheck: (event) => {
					events.push({ agentId: event.agentId, guardrailType: event.guardrailType });
				},
			},
		});

		await orchestrator.run(mockAgent("my-agent"), "hello");

		// Should have both input and output guardrail events
		expect(events.length).toBeGreaterThanOrEqual(2);
		expect(events[0]!.agentId).toBe("my-agent");
		expect(events[0]!.guardrailType).toBe("input");
		expect(events[1]!.agentId).toBe("my-agent");
		expect(events[1]!.guardrailType).toBe("output");
	});
});
