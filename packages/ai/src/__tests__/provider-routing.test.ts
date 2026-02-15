import { describe, it, expect, vi } from "vitest";
import { createConstraintRouter } from "../provider-routing.js";
import type { AgentRunner, AgentLike, RunResult } from "../types.js";
import type { ConstraintRouterRunner } from "../provider-routing.js";

// ============================================================================
// Helpers
// ============================================================================

function mockAgent() {
	return { name: "test-agent", instructions: "Be helpful." };
}

function successResult(output = "hello"): RunResult {
	return {
		output,
		messages: [{ role: "assistant", content: output }],
		toolCalls: [],
		totalTokens: 100,
		tokenUsage: { inputTokens: 50, outputTokens: 50 },
	};
}

function makeProviderRunner(name: string): AgentRunner {
	return vi.fn(async () => {
		return { ...successResult(), output: `from:${name}` };
	}) as unknown as AgentRunner;
}

function failingProviderRunner(name: string): AgentRunner {
	return vi.fn(async () => {
		throw new Error(`${name} failed`);
	}) as unknown as AgentRunner;
}

// ============================================================================
// createConstraintRouter
// ============================================================================

describe("createConstraintRouter", () => {
	it("routes to default provider when no constraints match", async () => {
		const runner = createConstraintRouter({
			providers: [
				{ name: "openai", runner: makeProviderRunner("openai") },
				{ name: "anthropic", runner: makeProviderRunner("anthropic") },
			],
			defaultProvider: "openai",
		});

		const result = await runner(mockAgent(), "hello");
		expect(result.output).toBe("from:openai");
	});

	it("routes based on constraint match", async () => {
		const runner = createConstraintRouter({
			providers: [
				{ name: "openai", runner: makeProviderRunner("openai"), pricing: { inputPerMillion: 5, outputPerMillion: 15 } },
				{ name: "ollama", runner: makeProviderRunner("ollama") },
			],
			defaultProvider: "openai",
			constraints: [
				{ when: (facts) => facts.totalCost > 0.0001, provider: "ollama" },
			],
		});

		// First call goes to openai (no cost yet)
		const r1 = await runner(mockAgent(), "hello");
		expect(r1.output).toBe("from:openai");

		// Second call should route to ollama (cost accumulated)
		const r2 = await runner(mockAgent(), "hello");
		expect(r2.output).toBe("from:ollama");
	});

	it("higher priority constraints win", async () => {
		const runner = createConstraintRouter({
			providers: [
				{ name: "openai", runner: makeProviderRunner("openai") },
				{ name: "anthropic", runner: makeProviderRunner("anthropic") },
				{ name: "ollama", runner: makeProviderRunner("ollama") },
			],
			defaultProvider: "openai",
			constraints: [
				{ when: () => true, provider: "anthropic", priority: 1 },
				{ when: () => true, provider: "ollama", priority: 10 },
			],
		});

		const result = await runner(mockAgent(), "hello");
		expect(result.output).toBe("from:ollama");
	});

	it("tracks call count and error count", async () => {
		const runner = createConstraintRouter({
			providers: [
				{ name: "openai", runner: failingProviderRunner("openai") },
				{ name: "anthropic", runner: makeProviderRunner("anthropic") },
			],
			defaultProvider: "openai",
		}) as ConstraintRouterRunner;

		// First call fails (openai errors)
		await expect(runner(mockAgent(), "hello")).rejects.toThrow("openai failed");

		const facts = runner.facts;
		expect(facts.callCount).toBe(1);
		expect(facts.errorCount).toBe(1);
		expect(facts.providers.openai?.errorCount).toBe(1);
	});

	it("skips errored providers during cooldown", async () => {
		const runner = createConstraintRouter({
			providers: [
				// Same pricing so cheapest heuristic doesn't interfere
				{ name: "openai", runner: failingProviderRunner("openai"), pricing: { inputPerMillion: 3, outputPerMillion: 15 } },
				{ name: "anthropic", runner: makeProviderRunner("anthropic"), pricing: { inputPerMillion: 3, outputPerMillion: 15 } },
			],
			defaultProvider: "openai",
			errorCooldownMs: 60000,
		});

		// First call: openai is default and cheapest-tied, so it's selected and errors
		await expect(runner(mockAgent(), "hello")).rejects.toThrow("openai failed");

		// Second call: openai is in cooldown, should route to anthropic
		const result = await runner(mockAgent(), "hello");
		expect(result.output).toBe("from:anthropic");
	});

	it("calls onProviderSelected callback", async () => {
		const onProviderSelected = vi.fn();
		const runner = createConstraintRouter({
			providers: [
				{ name: "openai", runner: makeProviderRunner("openai") },
			],
			defaultProvider: "openai",
			onProviderSelected,
		});

		await runner(mockAgent(), "hello");
		expect(onProviderSelected).toHaveBeenCalledWith("openai", "default");
	});

	it("reports constraint reason when constraint matches", async () => {
		const onProviderSelected = vi.fn();
		const runner = createConstraintRouter({
			providers: [
				{ name: "openai", runner: makeProviderRunner("openai") },
				{ name: "anthropic", runner: makeProviderRunner("anthropic") },
			],
			defaultProvider: "openai",
			constraints: [
				{ when: () => true, provider: "anthropic" },
			],
			onProviderSelected,
		});

		await runner(mockAgent(), "hello");
		expect(onProviderSelected).toHaveBeenCalledWith("anthropic", "constraint");
	});

	it("tracks total cost across calls", async () => {
		const runner = createConstraintRouter({
			providers: [
				{ name: "openai", runner: makeProviderRunner("openai"), pricing: { inputPerMillion: 10, outputPerMillion: 30 } },
			],
			defaultProvider: "openai",
		}) as ConstraintRouterRunner;

		await runner(mockAgent(), "hello");
		await runner(mockAgent(), "hello");

		// Each call: (50/1M)*10 + (50/1M)*30 = $0.0005 + $0.0015 = $0.002
		expect(runner.facts.totalCost).toBeCloseTo(0.004, 6);
		expect(runner.facts.callCount).toBe(2);
	});

	it("throws when default provider not in providers list", () => {
		expect(() =>
			createConstraintRouter({
				providers: [
					{ name: "openai", runner: makeProviderRunner("openai") },
				],
				defaultProvider: "nonexistent",
			}),
		).toThrow("not found");
	});

	it("tracks average latency", async () => {
		const runner = createConstraintRouter({
			providers: [
				{ name: "openai", runner: makeProviderRunner("openai") },
			],
			defaultProvider: "openai",
		}) as ConstraintRouterRunner;

		await runner(mockAgent(), "hello");

		expect(runner.facts.avgLatencyMs).toBeGreaterThanOrEqual(0);
		expect(runner.facts.lastProvider).toBe("openai");
	});

	it("prefers cheapest available provider when preferCheapest is true", async () => {
		const runner = createConstraintRouter({
			providers: [
				{ name: "expensive", runner: makeProviderRunner("expensive"), pricing: { inputPerMillion: 100, outputPerMillion: 300 } },
				{ name: "cheap", runner: makeProviderRunner("cheap"), pricing: { inputPerMillion: 1, outputPerMillion: 3 } },
			],
			defaultProvider: "expensive",
			preferCheapest: true,
		});

		const result = await runner(mockAgent(), "hello");
		expect(result.output).toBe("from:cheap");
	});

	it("uses default provider when preferCheapest is false", async () => {
		const runner = createConstraintRouter({
			providers: [
				{ name: "expensive", runner: makeProviderRunner("expensive"), pricing: { inputPerMillion: 100, outputPerMillion: 300 } },
				{ name: "cheap", runner: makeProviderRunner("cheap"), pricing: { inputPerMillion: 1, outputPerMillion: 3 } },
			],
			defaultProvider: "expensive",
		});

		const result = await runner(mockAgent(), "hello");
		expect(result.output).toBe("from:expensive");
	});
});

// ============================================================================
// Config Validation (C1)
// ============================================================================

describe("createConstraintRouter config validation", () => {
	it("throws on negative errorCooldownMs", () => {
		expect(() =>
			createConstraintRouter({
				providers: [{ name: "openai", runner: makeProviderRunner("openai") }],
				defaultProvider: "openai",
				errorCooldownMs: -1,
			}),
		).toThrow("errorCooldownMs must be a non-negative finite number");
	});

	it("throws on NaN errorCooldownMs", () => {
		expect(() =>
			createConstraintRouter({
				providers: [{ name: "openai", runner: makeProviderRunner("openai") }],
				defaultProvider: "openai",
				errorCooldownMs: NaN,
			}),
		).toThrow("errorCooldownMs must be a non-negative finite number");
	});
});

// ============================================================================
// Callback Isolation (C2)
// ============================================================================

describe("createConstraintRouter callback isolation", () => {
	it("throwing constraint.when is skipped silently", async () => {
		const runner = createConstraintRouter({
			providers: [
				{ name: "openai", runner: makeProviderRunner("openai") },
				{ name: "anthropic", runner: makeProviderRunner("anthropic") },
			],
			defaultProvider: "openai",
			constraints: [
				{
					when: () => {
						throw new Error("constraint exploded");
					},
					provider: "anthropic",
				},
			],
		});

		// Should fall through to default provider, not crash
		const result = await runner(mockAgent(), "hello");
		expect(result.output).toBe("from:openai");
	});

	it("throwing onProviderSelected does not crash routing", async () => {
		const runner = createConstraintRouter({
			providers: [{ name: "openai", runner: makeProviderRunner("openai") }],
			defaultProvider: "openai",
			onProviderSelected: () => {
				throw new Error("callback exploded");
			},
		});

		const result = await runner(mockAgent(), "hello");
		expect(result.output).toBe("from:openai");
	});
});

// ============================================================================
// Deep-clone RoutingFacts (C4)
// ============================================================================

describe("RoutingFacts immutability", () => {
	it("mutating returned facts does not affect internal state", async () => {
		const runner = createConstraintRouter({
			providers: [
				{ name: "openai", runner: makeProviderRunner("openai"), pricing: { inputPerMillion: 5, outputPerMillion: 15 } },
			],
			defaultProvider: "openai",
		}) as ConstraintRouterRunner;

		await runner(mockAgent(), "hello");

		// Get facts and mutate them
		const facts1 = runner.facts;
		facts1.totalCost = 999999;
		facts1.callCount = 999999;
		facts1.providers.openai!.errorCount = 999999;

		// Get facts again — should reflect actual internal state, not our mutations
		const facts2 = runner.facts;
		expect(facts2.totalCost).not.toBe(999999);
		expect(facts2.callCount).toBe(1);
		expect(facts2.providers.openai!.errorCount).toBe(0);
	});
});

// ============================================================================
// Pre-sorted Constraints (M9)
// ============================================================================

describe("constraint priority sorting", () => {
	it("constraints are pre-sorted by priority at construction time", async () => {
		// Add constraints in reverse priority order — highest should still win
		const runner = createConstraintRouter({
			providers: [
				{ name: "openai", runner: makeProviderRunner("openai") },
				{ name: "anthropic", runner: makeProviderRunner("anthropic") },
				{ name: "ollama", runner: makeProviderRunner("ollama") },
			],
			defaultProvider: "openai",
			constraints: [
				{ when: () => true, provider: "anthropic", priority: 1 },
				{ when: () => true, provider: "ollama", priority: 100 },
			],
		});

		const result = await runner(mockAgent(), "hello");
		expect(result.output).toBe("from:ollama"); // Highest priority wins
	});
});
