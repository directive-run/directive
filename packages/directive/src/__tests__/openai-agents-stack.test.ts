/**
 * Agent Stack Tests
 *
 * Tests for createAgentStack() composition API covering:
 * - Minimal config (just `run`)
 * - All features enabled
 * - Shorthand vs pre-built instances
 * - Per-call cache skip
 * - Streaming
 * - getState aggregation
 * - reset + dispose lifecycle
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
	createAgentStack,
	type AgentStackConfig,
} from "../adapters/openai-agents-stack.js";
import type { AgentLike, AgentRunner, RunResult } from "../adapters/openai-agents.js";
import type { AgentRegistry } from "../adapters/openai-agents-multi.js";
import { createCircuitBreaker } from "../adapters/plugins/circuit-breaker.js";
import { createObservability } from "../adapters/plugins/observability.js";
import { createSemanticCache, createTestEmbedder } from "../adapters/guardrails/semantic-cache.js";
import { createMessageBus } from "../adapters/openai-agents-communication.js";

// ============================================================================
// Helpers
// ============================================================================

function makeAgent(name: string): AgentLike {
	return { name };
}

function makeRunResult<T>(finalOutput: T, totalTokens = 10): RunResult<T> {
	return { finalOutput, messages: [], toolCalls: [], totalTokens };
}

function createMockRunner(
	handler?: (agent: AgentLike, input: string) => unknown,
): AgentRunner {
	return vi.fn(async <T = unknown>(agent: AgentLike, input: string) => {
		const output = handler ? handler(agent, input) : `response from ${agent.name}`;
		return makeRunResult<T>(output as T);
	}) as unknown as AgentRunner;
}

const testAgents: AgentRegistry = {
	move: { agent: makeAgent("move-agent"), description: "Move agent", capabilities: ["move"] },
	chat: { agent: makeAgent("chat-agent"), description: "Chat agent", capabilities: ["chat"] },
};

// ============================================================================
// Tests
// ============================================================================

describe("createAgentStack", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("minimal config", () => {
		it("should create stack with only run function", () => {
			const stack = createAgentStack({ runner: createMockRunner() });

			expect(stack.orchestrator).toBeDefined();
			expect(stack.multi).toBeNull();
			expect(stack.obs).toBeNull();
			expect(stack.cache).toBeNull();
			expect(stack.bus).toBeNull();
		});

		it("should throw when calling run without agents", async () => {
			const stack = createAgentStack({ runner: createMockRunner() });

			await expect(stack.run("move", "hello")).rejects.toThrow("No agents registered");
		});

		it("should throw when calling stream without streaming config", () => {
			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: testAgents,
			});

			expect(() => stack.stream("chat", "hello")).toThrow("Streaming not configured");
		});
	});

	describe("run()", () => {
		it("should run agent by ID and return result", async () => {
			const mockRun = createMockRunner();
			const stack = createAgentStack({
				runner: mockRun,
				agents: testAgents,
			});

			const result = await stack.run("move", "pick a move");

			expect(result.finalOutput).toBe("response from move-agent");
			expect(result.totalTokens).toBe(10);
		});

		it("should throw for unknown agent ID", async () => {
			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: testAgents,
			});

			await expect(stack.run("unknown", "hello")).rejects.toThrow('Agent "unknown" not found');
		});

		it("should track total tokens across runs", async () => {
			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: testAgents,
			});

			await stack.run("move", "input1");
			await stack.run("chat", "input2");

			const state = stack.getState();
			expect(state.totalTokens).toBe(20);
		});
	});

	describe("cache integration", () => {
		it("should cache results and return cached on second call", async () => {
			const mockRun = createMockRunner(() => ({ answer: 42 }));
			const stack = createAgentStack({
				runner: mockRun,
				agents: testAgents,
				cache: { threshold: 0.98, maxSize: 100, ttlMs: 60_000 },
			});

			expect(stack.cache).not.toBeNull();

			// First call — cache miss
			const result1 = await stack.run("move", "test-input");
			expect(result1.finalOutput).toEqual({ answer: 42 });

			// Second call with same input — cache hit
			const result2 = await stack.run("move", "test-input");
			expect(result2.finalOutput).toEqual({ answer: 42 });
			expect(result2.totalTokens).toBe(0); // cached, no tokens used
		});

		it("should skip cache when cache: false is passed", async () => {
			const mockRun = createMockRunner(() => "fresh");
			const stack = createAgentStack({
				runner: mockRun,
				agents: testAgents,
				cache: { threshold: 0.98, maxSize: 100, ttlMs: 60_000 },
			});

			await stack.run("move", "input");
			const result = await stack.run("move", "input", { cache: false });

			// Should have called run twice (not served from cache)
			expect(mockRun).toHaveBeenCalledTimes(2);
		});
	});

	describe("observability integration", () => {
		it("should auto-wire observability when config is provided", async () => {
			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: testAgents,
				observability: { serviceName: "test-service" },
			});

			expect(stack.obs).not.toBeNull();

			await stack.run("move", "test");

			// Check that traces were recorded
			const traces = stack.obs!.getTraces(10);
			expect(traces.length).toBeGreaterThan(0);
		});

		it("should accept pre-built observability instance", async () => {
			const preBuiltObs = createObservability({
				serviceName: "pre-built",
				metrics: { enabled: true },
			});

			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: testAgents,
				observability: preBuiltObs,
			});

			expect(stack.obs).toBe(preBuiltObs);
		});
	});

	describe("circuit breaker integration", () => {
		it("should auto-wire circuit breaker from shorthand config", () => {
			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: testAgents,
				circuitBreaker: { failureThreshold: 3, recoveryTimeMs: 5000 },
			});

			const state = stack.getState();
			expect(state.circuitState).toBe("CLOSED");
		});

		it("should accept pre-built circuit breaker", () => {
			const preBuiltCB = createCircuitBreaker({
				failureThreshold: 5,
				recoveryTimeMs: 10000,
			});

			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: testAgents,
				circuitBreaker: preBuiltCB,
			});

			const state = stack.getState();
			expect(state.circuitState).toBe("CLOSED");
		});
	});

	describe("bus integration", () => {
		it("should auto-wire message bus and publish on run", async () => {
			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: testAgents,
				bus: { maxHistory: 50 },
			});

			expect(stack.bus).not.toBeNull();

			await stack.run("move", "test input");

			const history = stack.bus!.getHistory(undefined, 10);
			expect(history.length).toBeGreaterThan(0);
		});

		it("should accept pre-built message bus", async () => {
			const preBuiltBus = createMessageBus({ maxHistory: 100 });
			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: testAgents,
				bus: preBuiltBus,
			});

			expect(stack.bus).toBe(preBuiltBus);
		});
	});

	describe("memory integration", () => {
		it("should auto-wire memory from shorthand config", () => {
			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: testAgents,
				memory: { maxMessages: 20 },
			});

			const state = stack.getState();
			expect(state.memoryMessageCount).toBe(0);
		});
	});

	describe("rate limiting", () => {
		it("should reject when rate limit exceeded", async () => {
			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: testAgents,
				rateLimit: { maxPerMinute: 2 },
			});

			await stack.run("move", "input1");
			await stack.run("move", "input2");

			// Third call should be rate-limited (guardrail failure)
			await expect(stack.run("move", "input3")).rejects.toThrow();
		});
	});

	describe("getState()", () => {
		it("should aggregate state from all features", async () => {
			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: testAgents,
				cache: { threshold: 0.98, maxSize: 100, ttlMs: 60_000 },
				circuitBreaker: { failureThreshold: 3 },
				memory: { maxMessages: 30 },
				bus: { maxHistory: 100 },
				costRatePerMillion: 2.4,
			});

			await stack.run("move", "test");

			const state = stack.getState();
			expect(state.totalTokens).toBe(10);
			expect(state.estimatedCost).toBeGreaterThan(0);
			expect(state.circuitState).toBe("CLOSED");
			expect(state.cacheStats.totalEntries).toBeGreaterThanOrEqual(0);
			expect(typeof state.memoryMessageCount).toBe("number");
			expect(typeof state.busMessageCount).toBe("number");
		});

		it("should return defaults for disabled features", () => {
			const stack = createAgentStack({ runner: createMockRunner() });

			const state = stack.getState();
			expect(state.circuitState).toBe("CLOSED");
			expect(state.cacheStats).toEqual({
				totalEntries: 0, totalHits: 0, totalMisses: 0,
				hitRate: 0, avgSimilarityOnHit: 0,
				oldestEntry: null, newestEntry: null,
			});
			expect(state.memoryMessageCount).toBe(0);
			expect(state.busMessageCount).toBe(0);
		});
	});

	describe("reset()", () => {
		it("should reset token count and all features", async () => {
			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: testAgents,
				cache: { threshold: 0.98, maxSize: 100, ttlMs: 60_000 },
				bus: { maxHistory: 100 },
			});

			await stack.run("move", "test");
			expect(stack.getState().totalTokens).toBe(10);

			stack.reset();

			expect(stack.getState().totalTokens).toBe(0);
			expect(stack.getState().busMessageCount).toBe(0);
		});
	});

	describe("dispose()", () => {
		it("should dispose without errors", async () => {
			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: testAgents,
				observability: { serviceName: "test" },
			});

			await expect(stack.dispose()).resolves.toBeUndefined();
		});
	});

	describe("runPattern()", () => {
		it("should throw without agents/patterns configured", async () => {
			const stack = createAgentStack({ runner: createMockRunner() });

			await expect(stack.runPattern("test", "input")).rejects.toThrow(
				"No agents/patterns configured",
			);
		});
	});

	describe("all features enabled", () => {
		it("should create stack with every feature", async () => {
			const mockRun = createMockRunner();
			const stack = createAgentStack({
				runner: mockRun,
				agents: testAgents,
				memory: { maxMessages: 30 },
				circuitBreaker: { failureThreshold: 3, recoveryTimeMs: 30000 },
				rateLimit: { maxPerMinute: 10 },
				cache: { threshold: 0.98, maxSize: 200, ttlMs: 600_000 },
				observability: { serviceName: "all-features" },
				bus: { maxHistory: 100 },
				costRatePerMillion: 2.4,
				debug: false,
			});

			expect(stack.orchestrator).toBeDefined();
			expect(stack.multi).not.toBeNull();
			expect(stack.obs).not.toBeNull();
			expect(stack.cache).not.toBeNull();
			expect(stack.bus).not.toBeNull();

			const result = await stack.run("move", "test input");
			expect(result.finalOutput).toBe("response from move-agent");

			const state = stack.getState();
			expect(state.totalTokens).toBe(10);
			expect(state.circuitState).toBe("CLOSED");
			expect(state.cacheStats).not.toBeNull();
		});
	});

	describe("cache error recovery", () => {
		it("should treat cache lookup error as miss and continue", async () => {
			const mockRun = createMockRunner(() => "fresh-result");
			const brokenCache = createSemanticCache({
				embedder: createTestEmbedder(),
				similarityThreshold: 0.98,
				maxCacheSize: 100,
				ttlMs: 60_000,
			});
			// Break lookup by replacing it
			brokenCache.lookup = async () => { throw new Error("embedder exploded"); };

			const stack = createAgentStack({
				runner: mockRun,
				agents: testAgents,
				cache: brokenCache,
			});

			// Should not throw — falls through to fresh run
			const result = await stack.run("move", "input");
			expect(result.finalOutput).toBe("fresh-result");
		});

		it("should survive cache store failure and still return result", async () => {
			const mockRun = createMockRunner(() => "good-result");
			const brokenCache = createSemanticCache({
				embedder: createTestEmbedder(),
				similarityThreshold: 0.98,
				maxCacheSize: 100,
				ttlMs: 60_000,
			});
			// Break store
			brokenCache.store = async () => { throw new Error("store failed"); };

			const stack = createAgentStack({
				runner: mockRun,
				agents: testAgents,
				cache: brokenCache,
			});

			const result = await stack.run("move", "input");
			expect(result.finalOutput).toBe("good-result");
		});
	});

	describe("config validation", () => {
		it("should reject invalid cache.threshold", () => {
			expect(() => createAgentStack({
				runner: createMockRunner(),
				cache: { threshold: 1.5 },
			})).toThrow("cache.threshold must be between 0 and 1");
		});

		it("should reject invalid cache.maxSize", () => {
			expect(() => createAgentStack({
				runner: createMockRunner(),
				cache: { maxSize: 0 },
			})).toThrow("cache.maxSize must be at least 1");
		});

		it("should reject invalid circuitBreaker.failureThreshold", () => {
			expect(() => createAgentStack({
				runner: createMockRunner(),
				circuitBreaker: { failureThreshold: 0 },
			})).toThrow("circuitBreaker.failureThreshold must be at least 1");
		});

		it("should reject invalid rateLimit.maxPerMinute", () => {
			expect(() => createAgentStack({
				runner: createMockRunner(),
				rateLimit: { maxPerMinute: 0 },
			})).toThrow("rateLimit.maxPerMinute must be a positive finite number");
		});
	});

	describe("error messages", () => {
		it("should show available agents when agent not found", async () => {
			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: testAgents,
			});

			await expect(stack.run("unknown", "hello")).rejects.toThrow("Available: move, chat");
		});
	});

	describe("rate limit state", () => {
		it("should expose remaining rate limit in getState", async () => {
			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: testAgents,
				rateLimit: { maxPerMinute: 5 },
			});

			expect(stack.getState().rateLimitRemaining).toBe(5);

			await stack.run("move", "input1");
			expect(stack.getState().rateLimitRemaining).toBe(4);

			await stack.run("move", "input2");
			expect(stack.getState().rateLimitRemaining).toBe(3);
		});

		it("should return null for rateLimitRemaining when not configured", () => {
			const stack = createAgentStack({ runner: createMockRunner() });
			expect(stack.getState().rateLimitRemaining).toBeNull();
		});
	});

	describe("per-agent guardrails", () => {
		it("should apply per-agent output guardrails", async () => {
			const guardCalls: string[] = [];
			const perAgentGuardrail = {
				name: "move-validator",
				fn: (data: { output: unknown }) => {
					guardCalls.push("per-agent");
					return { passed: true };
				},
			};

			const agentsWithGuardrails: AgentRegistry = {
				move: {
					agent: makeAgent("move-agent"),
					description: "Move",
					capabilities: ["move"],
					guardrails: { output: [perAgentGuardrail] },
				},
				chat: {
					agent: makeAgent("chat-agent"),
					description: "Chat",
					capabilities: ["chat"],
				},
			};

			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: agentsWithGuardrails,
			});

			await stack.run("move", "test");
			// Per-agent guardrail should have been triggered
			expect(guardCalls).toContain("per-agent");
		});

		it("should not apply per-agent guardrails to other agents", async () => {
			const guardCalls: string[] = [];
			const perAgentGuardrail = {
				name: "move-only",
				fn: () => {
					guardCalls.push("move-only");
					return { passed: true };
				},
			};

			const agentsWithGuardrails: AgentRegistry = {
				move: {
					agent: makeAgent("move-agent"),
					description: "Move",
					capabilities: ["move"],
					guardrails: { output: [perAgentGuardrail] },
				},
				chat: {
					agent: makeAgent("chat-agent"),
					description: "Chat",
					capabilities: ["chat"],
				},
			};

			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: agentsWithGuardrails,
			});

			await stack.run("chat", "test");
			// Per-agent guardrail should NOT have been triggered for chat
			expect(guardCalls).not.toContain("move-only");
		});
	});

	describe("concurrent runs", () => {
		it("should handle parallel runs without corruption", async () => {
			let callCount = 0;
			const mockRun = createMockRunner(() => {
				callCount++;
				return `result-${callCount}`;
			});

			const stack = createAgentStack({
				runner: mockRun,
				agents: testAgents,
			});

			const [r1, r2, r3] = await Promise.all([
				stack.run("move", "a"),
				stack.run("chat", "b"),
				stack.run("move", "c"),
			]);

			expect(stack.getState().totalTokens).toBe(30); // 3 runs × 10 tokens
		});
	});

	describe("double dispose", () => {
		it("should handle double dispose without errors", async () => {
			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: testAgents,
				observability: { serviceName: "test" },
			});

			await stack.dispose();
			await expect(stack.dispose()).resolves.toBeUndefined();
		});
	});

	describe("approve/reject", () => {
		it("should expose approve and reject methods", () => {
			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: testAgents,
			});

			expect(typeof stack.approve).toBe("function");
			expect(typeof stack.reject).toBe("function");
		});

		it("should delegate approve/reject to orchestrator", () => {
			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: testAgents,
			});

			// approve/reject on a non-pending request should not throw
			// (orchestrator handles the no-op gracefully)
			expect(() => stack.approve("nonexistent-id")).not.toThrow();
			expect(() => stack.reject("nonexistent-id", "test reason")).not.toThrow();
		});
	});

	describe("naming aliases", () => {
		it("should expose observability, messageBus, coordinator aliases", () => {
			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: testAgents,
				observability: { serviceName: "test" },
				bus: { maxHistory: 10 },
			});

			// New names should work
			expect(stack.observability).toBeDefined();
			expect(stack.messageBus).toBeDefined();
			expect(stack.coordinator).toBeDefined(); // agents are registered

			// Deprecated names should still work and return same values
			expect(stack.obs).toBe(stack.observability);
			expect(stack.bus).toBe(stack.messageBus);
			expect(stack.multi).toBe(stack.coordinator);
		});

		it("should have coordinator=null when no agents registered", () => {
			const stack = createAgentStack({
				runner: createMockRunner(),
			});

			expect(stack.coordinator).toBeNull();
			expect(stack.multi).toBe(stack.coordinator);
		});
	});

	describe("hooks forwarding", () => {
		it("should forward lifecycle hooks to orchestrator", async () => {
			const onAgentStart = vi.fn();
			const onAgentComplete = vi.fn();

			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: testAgents,
				hooks: {
					onAgentStart,
					onAgentComplete,
				},
			});

			await stack.run("move", "test input");

			expect(onAgentStart).toHaveBeenCalledTimes(1);
			expect(onAgentStart).toHaveBeenCalledWith(
				expect.objectContaining({
					agentName: "move-agent",
					input: "test input",
				}),
			);

			expect(onAgentComplete).toHaveBeenCalledTimes(1);
			expect(onAgentComplete).toHaveBeenCalledWith(
				expect.objectContaining({
					agentName: "move-agent",
					output: "response from move-agent",
				}),
			);
		});
	});

	describe("retry forwarding", () => {
		it("should forward retry config to orchestrator", async () => {
			let callCount = 0;
			const failOnceRun = createMockRunner((agent) => {
				callCount++;
				if (callCount === 1) throw new Error("transient failure");
				return `recovered from ${agent.name}`;
			});

			const stack = createAgentStack({
				runner: failOnceRun,
				agents: testAgents,
				retry: {
					attempts: 2,
					backoff: "fixed",
					baseDelayMs: 10,
				},
			});

			const result = await stack.run("move", "test");
			expect(result.finalOutput).toBe("recovered from move-agent");
			expect(callCount).toBe(2);
		});
	});

	describe("rate limit reset", () => {
		it("should reset rate limiter on stack.reset()", async () => {
			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: testAgents,
				rateLimit: { maxPerMinute: 2 },
			});

			await stack.run("move", "input1");
			await stack.run("move", "input2");
			// Should be at limit
			expect(stack.getState().rateLimitRemaining).toBe(0);

			stack.reset();
			// After reset, rate limit should be fully available again
			expect(stack.getState().rateLimitRemaining).toBe(2);
		});
	});

	describe("messageBus config alias", () => {
		it("should accept messageBus as alias for bus config", async () => {
			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: testAgents,
				messageBus: { maxHistory: 50 },
			});

			expect(stack.messageBus).not.toBeNull();
			await stack.run("move", "test");
			expect(stack.messageBus!.getHistory(undefined, 10).length).toBeGreaterThan(0);
		});
	});

	describe("escape hatches", () => {
		it("should expose memory escape hatch", () => {
			const stack = createAgentStack({
				runner: createMockRunner(),
				memory: { maxMessages: 20 },
			});

			expect(stack.memory).not.toBeNull();
		});

		it("should have memory=null when not configured", () => {
			const stack = createAgentStack({ runner: createMockRunner() });
			expect(stack.memory).toBeNull();
		});

		it("should expose getTimeline", async () => {
			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: testAgents,
				observability: { serviceName: "test" },
			});

			await stack.run("move", "test");
			const timeline = stack.getTimeline();
			expect(timeline.spans.length).toBeGreaterThan(0);
		});

		it("should return empty timeline when observability is disabled", () => {
			const stack = createAgentStack({ runner: createMockRunner() });
			const timeline = stack.getTimeline();
			expect(timeline.spans).toEqual([]);
			expect(timeline.metrics).toEqual({});
		});
	});

	describe("runStructured()", () => {
		it("should return result when validation passes", async () => {
			const stack = createAgentStack({
				runner: createMockRunner(() => ({ name: "Alice", age: 30 })),
				agents: testAgents,
			});

			const result = await stack.runStructured("move", "get user", {
				validate: (v) => typeof v === "object" && v !== null && "name" in v,
			});

			expect(result.finalOutput).toEqual({ name: "Alice", age: 30 });
		});

		it("should throw when validation fails after retries", async () => {
			const stack = createAgentStack({
				runner: createMockRunner(() => "not-an-object"),
				agents: testAgents,
			});

			await expect(
				stack.runStructured("move", "get user", {
					validate: (v) => ({ valid: typeof v === "object" && v !== null, errors: ["Expected object"] }),
					retries: 1,
				}),
			).rejects.toThrow("Output validation failed");
		});

		it("should retry and succeed on second attempt", async () => {
			let attempt = 0;
			const stack = createAgentStack({
				runner: createMockRunner(() => {
					attempt++;
					return attempt === 1 ? "bad" : { valid: true };
				}),
				agents: testAgents,
			});

			const result = await stack.runStructured("move", "input", {
				validate: (v) => typeof v === "object" && v !== null,
				retries: 1,
			});

			expect(result.finalOutput).toEqual({ valid: true });
			expect(attempt).toBe(2);
		});
	});

	describe("runPattern guardrails", () => {
		it("should reject when input guardrails fail for runPattern", async () => {
			const stack = createAgentStack({
				runner: createMockRunner(),
				agents: testAgents,
				patterns: {},
				guardrails: {
					input: [
						{
							name: "block-all",
							fn: () => ({ passed: false, reason: "Blocked by guardrail" }),
						},
					],
				},
			});

			await expect(stack.runPattern("test", "input")).rejects.toThrow("Blocked by guardrail");
		});
	});
});
