import { describe, expect, it, vi, beforeEach } from "vitest";
import {
	Semaphore,
	createMultiAgentOrchestrator,
	parallel,
	sequential,
	supervisor,
	selectAgent,
	runAgentRequirement,
	concatResults,
	pickBestResult,
	collectOutputs,
	aggregateTokens,
	type MultiAgentOrchestrator,
	type AgentRegistry,
} from "../adapters/ai/multi.js";
import type { AgentLike, AgentRunner, RunResult } from "../adapters/ai/index.js";

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

function makeRegistry(...names: string[]): AgentRegistry {
	const registry: AgentRegistry = {};
	for (const name of names) {
		registry[name] = { agent: makeAgent(name) };
	}
	return registry;
}

// ============================================================================
// Semaphore
// ============================================================================

describe("Semaphore", () => {
	it("should initialize with correct max permits", () => {
		const sem = new Semaphore(3);
		expect(sem.max).toBe(3);
		expect(sem.available).toBe(3);
		expect(sem.waiting).toBe(0);
	});

	it("should acquire and release a permit synchronously when available", async () => {
		const sem = new Semaphore(2);
		const release = await sem.acquire();
		expect(sem.available).toBe(1);
		release();
		expect(sem.available).toBe(2);
	});

	it("should queue waiters when all permits are taken", async () => {
		const sem = new Semaphore(1);
		const release1 = await sem.acquire();
		expect(sem.available).toBe(0);

		// Second acquire should be queued
		let release2: (() => void) | undefined;
		const p2 = sem.acquire().then((r) => {
			release2 = r;
		});

		expect(sem.waiting).toBe(1);

		// Release first permit to unblock the waiter
		release1();
		await p2;

		expect(sem.waiting).toBe(0);
		expect(sem.available).toBe(0);

		release2!();
		expect(sem.available).toBe(1);
	});

	it("should enforce concurrent limit", async () => {
		const sem = new Semaphore(2);
		const release1 = await sem.acquire();
		const release2 = await sem.acquire();
		expect(sem.available).toBe(0);

		const order: string[] = [];
		const p3 = sem.acquire().then((release) => {
			order.push("third");
			return release;
		});
		const p4 = sem.acquire().then((release) => {
			order.push("fourth");
			return release;
		});

		expect(sem.waiting).toBe(2);

		// Release one permit - should unblock exactly one waiter (FIFO)
		release1();
		const release3 = await p3;
		expect(order).toEqual(["third"]);
		expect(sem.waiting).toBe(1);

		release2();
		const release4 = await p4;
		expect(order).toEqual(["third", "fourth"]);
		expect(sem.waiting).toBe(0);

		release3();
		release4();
		expect(sem.available).toBe(2);
	});

	it("should process waiters in FIFO order", async () => {
		const sem = new Semaphore(1);
		const release1 = await sem.acquire();

		const order: number[] = [];
		const promises = [1, 2, 3].map((n) =>
			sem.acquire().then((release) => {
				order.push(n);
				return release;
			}),
		);

		expect(sem.waiting).toBe(3);

		release1();
		const r2 = await promises[0];
		expect(order).toEqual([1]);

		r2!();
		const r3 = await promises[1];
		expect(order).toEqual([1, 2]);

		r3!();
		await promises[2];
		expect(order).toEqual([1, 2, 3]);
	});
});

// ============================================================================
// createMultiAgentOrchestrator - basics
// ============================================================================

describe("createMultiAgentOrchestrator", () => {
	let mockRun: AgentRunner;
	let orchestrator: MultiAgentOrchestrator;

	beforeEach(() => {
		mockRun = createMockRunner();
		orchestrator = createMultiAgentOrchestrator({
			runner: mockRun,
			agents: makeRegistry("alpha", "beta", "gamma"),
		});
	});

	describe("agent registration", () => {
		it("should initialize all agents with idle state", () => {
			const states = orchestrator.getAllAgentStates();
			expect(Object.keys(states)).toEqual(["alpha", "beta", "gamma"]);
			for (const state of Object.values(states)) {
				expect(state.status).toBe("idle");
				expect(state.runCount).toBe(0);
				expect(state.totalTokens).toBe(0);
			}
		});

		it("should return undefined for unregistered agent state", () => {
			expect(orchestrator.getAgentState("nonexistent")).toBeUndefined();
		});
	});

	describe("single agent execution", () => {
		it("should run a registered agent and return the result", async () => {
			const result = await orchestrator.runAgent("alpha", "hello");
			expect(result.output).toBe("response from alpha");
			expect(result.totalTokens).toBe(10);
		});

		it("should throw for unknown agent", async () => {
			await expect(orchestrator.runAgent("unknown", "hello")).rejects.toThrow(
				"Unknown agent: unknown",
			);
		});

		it("should update agent state after successful run", async () => {
			await orchestrator.runAgent("alpha", "test input");
			const state = orchestrator.getAgentState("alpha");
			expect(state?.status).toBe("completed");
			expect(state?.runCount).toBe(1);
			expect(state?.totalTokens).toBe(10);
			expect(state?.lastInput).toBe("test input");
			expect(state?.lastOutput).toBe("response from alpha");
		});

		it("should accumulate totalTokens across multiple runs", async () => {
			await orchestrator.runAgent("alpha", "one");
			await orchestrator.runAgent("alpha", "two");
			await orchestrator.runAgent("alpha", "three");
			const state = orchestrator.getAgentState("alpha");
			expect(state?.runCount).toBe(3);
			expect(state?.totalTokens).toBe(30);
		});

		it("should pass run options through to the run function", async () => {
			const onMessage = vi.fn();
			await orchestrator.runAgent("alpha", "hi", { onMessage });
			expect(mockRun).toHaveBeenCalledWith(
				expect.objectContaining({ name: "alpha" }),
				"hi",
				expect.objectContaining({ onMessage }),
			);
		});
	});

	describe("error handling", () => {
		it("should set agent state to error when run fails", async () => {
			const failRun = createMockRunner(() => {
				throw new Error("agent failed");
			});
			const orch = createMultiAgentOrchestrator({
				runner: failRun,
				agents: makeRegistry("failing"),
			});

			await expect(orch.runAgent("failing", "input")).rejects.toThrow("agent failed");
			const state = orch.getAgentState("failing");
			expect(state?.status).toBe("error");
			expect(state?.lastError).toBe("agent failed");
		});

		it("should release the semaphore slot after an error", async () => {
			let callCount = 0;
			const sometimesFail: AgentRunner = vi.fn(async <T>(agent: AgentLike, input: string) => {
				callCount++;
				if (callCount === 1) throw new Error("first call fails");
				return makeRunResult<T>(`ok-${callCount}` as T);
			}) as unknown as AgentRunner;

			const orch = createMultiAgentOrchestrator({
				runner: sometimesFail,
				agents: { solo: { agent: makeAgent("solo"), maxConcurrent: 1 } },
			});

			await expect(orch.runAgent("solo", "a")).rejects.toThrow("first call fails");
			// Should not deadlock - slot was released
			const result = await orch.runAgent("solo", "b");
			expect(result.output).toBe("ok-2");
		});
	});
});

// ============================================================================
// Parallel execution
// ============================================================================

describe("parallel execution", () => {
	it("should create a parallel pattern config", () => {
		const merge = vi.fn();
		const pattern = parallel(["a", "b"], merge, { minSuccess: 1, timeout: 5000 });
		expect(pattern.type).toBe("parallel");
		expect(pattern.agents).toEqual(["a", "b"]);
		expect(pattern.merge).toBe(merge);
		expect(pattern.minSuccess).toBe(1);
		expect(pattern.timeout).toBe(5000);
	});

	it("should run agents in parallel via runParallel", async () => {
		const mockRun = createMockRunner((agent) => `result-${agent.name}`);
		const orch = createMultiAgentOrchestrator({
			runner: mockRun,
			agents: makeRegistry("a", "b"),
		});

		const merged = await orch.runParallel(
			["a", "b"],
			["input-a", "input-b"],
			(results) => results.map((r) => r.output),
		);

		expect(merged).toEqual(["result-a", "result-b"]);
	});

	it("should broadcast a single input string to all agents", async () => {
		const mockRun = createMockRunner((agent, input) => `${agent.name}:${input}`);
		const orch = createMultiAgentOrchestrator({
			runner: mockRun,
			agents: makeRegistry("x", "y"),
		});

		const merged = await orch.runParallel(
			["x", "y"],
			"shared-input",
			(results) => results.map((r) => r.output),
		);

		expect(merged).toEqual(["x:shared-input", "y:shared-input"]);
	});

	it("should throw when input count does not match agent count", async () => {
		const orch = createMultiAgentOrchestrator({
			runner: createMockRunner(),
			agents: makeRegistry("a", "b"),
		});

		await expect(
			orch.runParallel(["a", "b"], ["only-one"], vi.fn()),
		).rejects.toThrow("Input count must match agent count");
	});

	it("should run a named parallel pattern via runPattern", async () => {
		const mockRun = createMockRunner((agent) => `out-${agent.name}`);
		const orch = createMultiAgentOrchestrator({
			runner: mockRun,
			agents: makeRegistry("r1", "r2"),
			patterns: {
				research: parallel(
					["r1", "r2"],
					(results) => results.map((r) => r.output).join("|"),
				),
			},
		});

		const result = await orch.runPattern("research", "query");
		expect(result).toBe("out-r1|out-r2");
	});

	it("should throw for unknown pattern", async () => {
		const orch = createMultiAgentOrchestrator({
			runner: createMockRunner(),
			agents: makeRegistry("a"),
		});

		await expect(orch.runPattern("nonexistent", "input")).rejects.toThrow(
			"Unknown pattern: nonexistent",
		);
	});

	it("should tolerate partial failures with minSuccess", async () => {
		let callIdx = 0;
		const sometimesFail: AgentRunner = vi.fn(async <T>(agent: AgentLike) => {
			callIdx++;
			if (callIdx === 1) throw new Error("fail");
			return makeRunResult<T>(`ok-${agent.name}` as T);
		}) as unknown as AgentRunner;

		const orch = createMultiAgentOrchestrator({
			runner: sometimesFail,
			agents: makeRegistry("a", "b"),
			patterns: {
				tolerant: {
					type: "parallel" as const,
					agents: ["a", "b"],
					merge: (results) => results.map((r) => r.output),
					minSuccess: 1,
				},
			},
		});

		const result = await orch.runPattern("tolerant", "go");
		expect(result).toEqual(["ok-b"]);
	});
});

// ============================================================================
// Sequential execution
// ============================================================================

describe("sequential execution", () => {
	it("should create a sequential pattern config", () => {
		const transform = vi.fn();
		const extract = vi.fn();
		const pattern = sequential(["a", "b"], { transform, extract, continueOnError: true });
		expect(pattern.type).toBe("sequential");
		expect(pattern.agents).toEqual(["a", "b"]);
		expect(pattern.transform).toBe(transform);
		expect(pattern.extract).toBe(extract);
		expect(pattern.continueOnError).toBe(true);
	});

	it("should pipe output from one agent as input to the next", async () => {
		const calls: Array<{ agent: string; input: string }> = [];
		const mockRun: AgentRunner = vi.fn(async <T>(agent: AgentLike, input: string) => {
			calls.push({ agent: agent.name, input });
			return makeRunResult<T>(`${agent.name}-processed-${input}` as T);
		}) as unknown as AgentRunner;

		const orch = createMultiAgentOrchestrator({
			runner: mockRun,
			agents: makeRegistry("step1", "step2", "step3"),
		});

		const results = await orch.runSequential(["step1", "step2", "step3"], "start");

		expect(calls[0]).toEqual({ agent: "step1", input: "start" });
		expect(calls[1]).toEqual({ agent: "step2", input: "step1-processed-start" });
		expect(calls[2]).toEqual({
			agent: "step3",
			input: "step2-processed-step1-processed-start",
		});
		expect(results).toHaveLength(3);
	});

	it("should use a custom transform between steps", async () => {
		const mockRun = createMockRunner((agent, input) => ({ text: `${agent.name}:${input}` }));
		const orch = createMultiAgentOrchestrator({
			runner: mockRun,
			agents: makeRegistry("a", "b"),
		});

		const results = await orch.runSequential(["a", "b"], "init", {
			transform: (output) => (output as { text: string }).text,
		});

		expect(results).toHaveLength(2);
		expect((results[1].output as { text: string }).text).toBe("b:a:init");
	});

	it("should run a named sequential pattern via runPattern", async () => {
		const mockRun = createMockRunner((agent, input) => `${agent.name}(${input})`);
		const orch = createMultiAgentOrchestrator({
			runner: mockRun,
			agents: makeRegistry("writer", "reviewer"),
			patterns: {
				writeReview: sequential<string>(["writer", "reviewer"], {
					extract: (output) => output as string,
				}),
			},
		});

		const result = await orch.runPattern<string>("writeReview", "draft");
		expect(result).toBe("reviewer(writer(draft))");
	});

	it("should throw when sequential pattern produces no results", async () => {
		const failRun: AgentRunner = vi.fn(async () => {
			throw new Error("fail");
		}) as unknown as AgentRunner;

		const orch = createMultiAgentOrchestrator({
			runner: failRun,
			agents: makeRegistry("a"),
			patterns: {
				failing: sequential(["a"], { continueOnError: true }),
			},
		});

		await expect(orch.runPattern("failing", "input")).rejects.toThrow(
			"No successful results in sequential pattern",
		);
	});

	it("should propagate errors by default", async () => {
		let callCount = 0;
		const failSecond: AgentRunner = vi.fn(async <T>(agent: AgentLike) => {
			callCount++;
			if (callCount === 2) throw new Error("second fails");
			return makeRunResult<T>("ok" as T);
		}) as unknown as AgentRunner;

		const orch = createMultiAgentOrchestrator({
			runner: failSecond,
			agents: makeRegistry("a", "b", "c"),
			patterns: {
				pipeline: sequential(["a", "b", "c"]),
			},
		});

		await expect(orch.runPattern("pipeline", "go")).rejects.toThrow("second fails");
		// Agent "c" should never have been called
		expect(callCount).toBe(2);
	});
});

// ============================================================================
// Supervisor execution
// ============================================================================

describe("supervisor execution", () => {
	it("should create a supervisor pattern config", () => {
		const extract = vi.fn();
		const pattern = supervisor("mgr", ["w1", "w2"], { maxRounds: 3, extract });
		expect(pattern.type).toBe("supervisor");
		expect(pattern.supervisor).toBe("mgr");
		expect(pattern.workers).toEqual(["w1", "w2"]);
		expect(pattern.maxRounds).toBe(3);
		expect(pattern.extract).toBe(extract);
	});

	it("should delegate work to workers and gather results", async () => {
		let supervisorCallCount = 0;
		const mockRun: AgentRunner = vi.fn(async <T>(agent: AgentLike, input: string) => {
			if (agent.name === "boss") {
				supervisorCallCount++;
				if (supervisorCallCount === 1) {
					// First call: delegate to worker
					return makeRunResult<T>({
						action: "delegate",
						worker: "worker1",
						workerInput: "do task",
					} as T);
				}
				// Second call: complete after receiving worker result
				return makeRunResult<T>({
					action: "complete",
					output: "all done",
				} as T);
			}
			// Worker
			return makeRunResult<T>(`worker-result: ${input}` as T);
		}) as unknown as AgentRunner;

		const orch = createMultiAgentOrchestrator({
			runner: mockRun,
			agents: makeRegistry("boss", "worker1"),
			patterns: {
				managed: supervisor("boss", ["worker1"], { maxRounds: 5 }),
			},
		});

		const result = await orch.runPattern("managed", "start");
		expect(result).toEqual({ action: "complete", output: "all done" });
		expect(supervisorCallCount).toBe(2);
	});

	it("should throw for invalid worker delegation", async () => {
		const mockRun: AgentRunner = vi.fn(async <T>() => {
			return makeRunResult<T>({
				action: "delegate",
				worker: "nonexistent-worker",
				workerInput: "task",
			} as T);
		}) as unknown as AgentRunner;

		const orch = createMultiAgentOrchestrator({
			runner: mockRun,
			agents: makeRegistry("boss", "worker1"),
			patterns: {
				managed: supervisor("boss", ["worker1"]),
			},
		});

		await expect(orch.runPattern("managed", "go")).rejects.toThrow(
			"Invalid worker: nonexistent-worker",
		);
	});

	it("should respect maxRounds limit", async () => {
		let callCount = 0;
		const alwaysDelegate: AgentRunner = vi.fn(async <T>(agent: AgentLike) => {
			callCount++;
			if (agent.name === "boss") {
				return makeRunResult<T>({
					action: "delegate",
					worker: "w",
					workerInput: "again",
				} as T);
			}
			return makeRunResult<T>("done" as T);
		}) as unknown as AgentRunner;

		const orch = createMultiAgentOrchestrator({
			runner: alwaysDelegate,
			agents: makeRegistry("boss", "w"),
			patterns: {
				loop: supervisor("boss", ["w"], { maxRounds: 2 }),
			},
		});

		// Should finish without looping forever
		await orch.runPattern("loop", "start");
		// 1 initial supervisor call + 2 rounds * (1 worker + 1 supervisor) = 5
		expect(callCount).toBe(5);
	});

	it("should use extract function for final result", async () => {
		let supervisorCallCount = 0;
		const mockRun: AgentRunner = vi.fn(async <T>(agent: AgentLike) => {
			if (agent.name === "boss") {
				supervisorCallCount++;
				if (supervisorCallCount === 1) {
					return makeRunResult<T>({
						action: "delegate",
						worker: "w",
						workerInput: "task",
					} as T);
				}
				return makeRunResult<T>({ action: "complete" } as T);
			}
			return makeRunResult<T>("worker-output" as T, 25);
		}) as unknown as AgentRunner;

		const orch = createMultiAgentOrchestrator({
			runner: mockRun,
			agents: makeRegistry("boss", "w"),
			patterns: {
				extracted: supervisor("boss", ["w"], {
					extract: (supervisorOut, workerResults) => ({
						supervisor: supervisorOut,
						workerCount: workerResults.length,
					}),
				}),
			},
		});

		const result = await orch.runPattern("extracted", "go");
		expect(result).toEqual({
			supervisor: { action: "complete" },
			workerCount: 1,
		});
	});
});

// ============================================================================
// Agent state tracking
// ============================================================================

describe("agent state tracking", () => {
	it("should track status transitions through a run lifecycle", async () => {
		let resolveRun!: (value: RunResult<unknown>) => void;
		const blockingRun: AgentRunner = vi.fn(
			() => new Promise((resolve) => { resolveRun = resolve; }),
		) as unknown as AgentRunner;

		const orch = createMultiAgentOrchestrator({
			runner: blockingRun,
			agents: makeRegistry("agent"),
		});

		expect(orch.getAgentState("agent")?.status).toBe("idle");

		const promise = orch.runAgent("agent", "go");
		// Allow the microtask for state update to settle
		await new Promise((r) => setTimeout(r, 0));
		expect(orch.getAgentState("agent")?.status).toBe("running");

		resolveRun(makeRunResult("done"));
		await promise;
		expect(orch.getAgentState("agent")?.status).toBe("completed");
	});

	it("should track totalTokens and runCount correctly", async () => {
		let tokens = 5;
		const mockRun: AgentRunner = vi.fn(async <T>() => {
			const t = tokens;
			tokens += 5;
			return makeRunResult<T>("ok" as T, t);
		}) as unknown as AgentRunner;

		const orch = createMultiAgentOrchestrator({
			runner: mockRun,
			agents: makeRegistry("a"),
		});

		await orch.runAgent("a", "1");
		await orch.runAgent("a", "2");
		await orch.runAgent("a", "3");

		const state = orch.getAgentState("a");
		expect(state?.runCount).toBe(3);
		expect(state?.totalTokens).toBe(5 + 10 + 15);
	});

	it("should return a copy from getAllAgentStates", () => {
		const orch = createMultiAgentOrchestrator({
			runner: createMockRunner(),
			agents: makeRegistry("a"),
		});

		const states1 = orch.getAllAgentStates();
		const states2 = orch.getAllAgentStates();
		expect(states1).not.toBe(states2); // Different object references
		expect(states1).toEqual(states2);  // Same content
	});
});

// ============================================================================
// Handoffs
// ============================================================================

describe("handoffs", () => {
	it("should execute a handoff and track it", async () => {
		const onHandoff = vi.fn();
		const onHandoffComplete = vi.fn();
		const mockRun = createMockRunner((agent) => `${agent.name}-result`);

		const orch = createMultiAgentOrchestrator({
			runner: mockRun,
			agents: makeRegistry("sender", "receiver"),
			onHandoff,
			onHandoffComplete,
		});

		const result = await orch.handoff("sender", "receiver", "handoff-input", { key: "val" });
		expect(result.output).toBe("receiver-result");
		expect(onHandoff).toHaveBeenCalledOnce();
		expect(onHandoffComplete).toHaveBeenCalledOnce();
		expect(orch.getPendingHandoffs()).toHaveLength(0);
	});

	it("should clean up pending handoffs on error", async () => {
		const failRun: AgentRunner = vi.fn(async () => {
			throw new Error("handoff failed");
		}) as unknown as AgentRunner;

		const orch = createMultiAgentOrchestrator({
			runner: failRun,
			agents: makeRegistry("a", "b"),
		});

		await expect(orch.handoff("a", "b", "input")).rejects.toThrow("handoff failed");
		expect(orch.getPendingHandoffs()).toHaveLength(0);
	});
});

// ============================================================================
// reset() and dispose()
// ============================================================================

describe("reset and dispose", () => {
	it("should reset all agent states to idle", async () => {
		const mockRun = createMockRunner();
		const orch = createMultiAgentOrchestrator({
			runner: mockRun,
			agents: makeRegistry("a", "b"),
		});

		await orch.runAgent("a", "test");
		await orch.runAgent("b", "test");

		expect(orch.getAgentState("a")?.runCount).toBe(1);
		expect(orch.getAgentState("b")?.runCount).toBe(1);

		orch.reset();

		for (const id of ["a", "b"]) {
			const state = orch.getAgentState(id);
			expect(state?.status).toBe("idle");
			expect(state?.runCount).toBe(0);
			expect(state?.totalTokens).toBe(0);
			expect(state?.lastInput).toBeUndefined();
			expect(state?.lastOutput).toBeUndefined();
			expect(state?.lastError).toBeUndefined();
		}
	});

	it("should clear pending handoffs and handoff history on reset", async () => {
		const mockRun = createMockRunner();
		const orch = createMultiAgentOrchestrator({
			runner: mockRun,
			agents: makeRegistry("a", "b"),
		});

		await orch.handoff("a", "b", "data");
		orch.reset();
		expect(orch.getPendingHandoffs()).toHaveLength(0);
	});

	it("should allow running agents again after reset", async () => {
		const mockRun = createMockRunner();
		const orch = createMultiAgentOrchestrator({
			runner: mockRun,
			agents: makeRegistry("a"),
		});

		await orch.runAgent("a", "before");
		orch.reset();
		const result = await orch.runAgent("a", "after");
		expect(result.output).toBe("response from a");
		expect(orch.getAgentState("a")?.runCount).toBe(1);
	});

	it("dispose should reset everything", async () => {
		const mockRun = createMockRunner();
		const orch = createMultiAgentOrchestrator({
			runner: mockRun,
			agents: makeRegistry("a"),
		});

		await orch.runAgent("a", "test");
		orch.dispose();

		const state = orch.getAgentState("a");
		expect(state?.status).toBe("idle");
		expect(state?.runCount).toBe(0);
	});
});

// ============================================================================
// Config validation
// ============================================================================

describe("config validation", () => {
	describe("pattern agent validation", () => {
		it("should throw when parallel pattern references unknown agent", () => {
			expect(() =>
				createMultiAgentOrchestrator({
					runner: createMockRunner(),
					agents: makeRegistry("a"),
					patterns: {
						myPattern: parallel(["a", "unknown"], (r) => r),
					},
				}),
			).toThrow('Pattern "myPattern" references unknown agent "unknown"');
		});

		it("should throw when sequential pattern references unknown agent", () => {
			expect(() =>
				createMultiAgentOrchestrator({
					runner: createMockRunner(),
					agents: makeRegistry("first"),
					patterns: {
						pipeline: sequential(["first", "second", "third"]),
					},
				}),
			).toThrow(/Pattern "pipeline" references unknown agent "second"/);
		});

		it("should throw when supervisor pattern references unknown supervisor", () => {
			expect(() =>
				createMultiAgentOrchestrator({
					runner: createMockRunner(),
					agents: makeRegistry("worker1", "worker2"),
					patterns: {
						managed: supervisor("boss", ["worker1", "worker2"]),
					},
				}),
			).toThrow('Pattern "managed" references unknown agent "boss"');
		});

		it("should throw when supervisor pattern references unknown worker", () => {
			expect(() =>
				createMultiAgentOrchestrator({
					runner: createMockRunner(),
					agents: makeRegistry("boss", "worker1"),
					patterns: {
						managed: supervisor("boss", ["worker1", "worker2"]),
					},
				}),
			).toThrow('Pattern "managed" references unknown agent "worker2"');
		});

		it("should list all missing agents in error message", () => {
			expect(() =>
				createMultiAgentOrchestrator({
					runner: createMockRunner(),
					agents: makeRegistry("a"),
					patterns: {
						p1: parallel(["missing1", "a"], (r) => r),
						p2: sequential(["a", "missing2"]),
					},
				}),
			).toThrow(/missing1.*missing2/s);
		});

		it("should include registered agents in error message", () => {
			expect(() =>
				createMultiAgentOrchestrator({
					runner: createMockRunner(),
					agents: makeRegistry("alpha", "beta"),
					patterns: {
						broken: parallel(["unknown"], (r) => r),
					},
				}),
			).toThrow(/Registered agents: alpha, beta/);
		});

		it("should pass validation when all pattern agents are registered", () => {
			expect(() =>
				createMultiAgentOrchestrator({
					runner: createMockRunner(),
					agents: makeRegistry("a", "b", "c", "supervisor"),
					patterns: {
						par: parallel(["a", "b"], (r) => r),
						seq: sequential(["a", "b", "c"]),
						sup: supervisor("supervisor", ["a", "b"]),
					},
				}),
			).not.toThrow();
		});
	});

	it("should default maxConcurrent to 1", async () => {
		const calls: string[] = [];
		let resolvers: Array<(v: RunResult<unknown>) => void> = [];

		const blockingRun: AgentRunner = vi.fn(<T>(_agent: AgentLike, input: string) => {
			calls.push(input);
			return new Promise<RunResult<T>>((resolve) => {
				resolvers.push(resolve as (v: RunResult<unknown>) => void);
			});
		}) as unknown as AgentRunner;

		const orch = createMultiAgentOrchestrator({
			runner: blockingRun,
			agents: makeRegistry("solo"), // no maxConcurrent specified
		});

		// Start two concurrent runs
		const p1 = orch.runAgent("solo", "first");
		const p2 = orch.runAgent("solo", "second");

		// Only one should be running (maxConcurrent defaults to 1)
		await new Promise((r) => setTimeout(r, 0));
		expect(calls).toEqual(["first"]);

		// Resolve first, second should start
		resolvers[0](makeRunResult("r1"));
		await p1;
		await new Promise((r) => setTimeout(r, 0));
		expect(calls).toEqual(["first", "second"]);

		resolvers[1](makeRunResult("r2"));
		await p2;
	});

	it("should respect custom maxConcurrent", async () => {
		const calls: string[] = [];
		let resolvers: Array<(v: RunResult<unknown>) => void> = [];

		const blockingRun: AgentRunner = vi.fn(<T>(_agent: AgentLike, input: string) => {
			calls.push(input);
			return new Promise<RunResult<T>>((resolve) => {
				resolvers.push(resolve as (v: RunResult<unknown>) => void);
			});
		}) as unknown as AgentRunner;

		const orch = createMultiAgentOrchestrator({
			runner: blockingRun,
			agents: {
				multi: { agent: makeAgent("multi"), maxConcurrent: 2 },
			},
		});

		orch.runAgent("multi", "a");
		orch.runAgent("multi", "b");
		orch.runAgent("multi", "c");

		await new Promise((r) => setTimeout(r, 0));
		// Two should be running concurrently
		expect(calls).toEqual(["a", "b"]);

		// Resolve one, third should start
		resolvers[0](makeRunResult("r-a"));
		await new Promise((r) => setTimeout(r, 10));
		expect(calls).toEqual(["a", "b", "c"]);

		resolvers[1](makeRunResult("r-b"));
		resolvers[2](makeRunResult("r-c"));
	});

	it("should use default maxHandoffHistory of 1000", () => {
		// Just verify the orchestrator accepts defaults without error
		const orch = createMultiAgentOrchestrator({
			runner: createMockRunner(),
			agents: makeRegistry("a"),
		});
		expect(orch).toBeDefined();
	});
});

// ============================================================================
// Helper utilities
// ============================================================================

describe("helper utilities", () => {
	describe("selectAgent", () => {
		it("should create an agent selection constraint", () => {
			const constraint = selectAgent(
				(facts) => (facts.complexity as number) > 0.5,
				"expert",
				(facts) => facts.query as string,
				10,
			);
			expect(constraint.select).toBe("expert");
			expect(constraint.priority).toBe(10);
			expect(constraint.when({ complexity: 0.9 })).toBe(true);
			expect(constraint.when({ complexity: 0.1 })).toBe(false);
		});
	});

	describe("runAgentRequirement", () => {
		it("should create a RUN_AGENT requirement", () => {
			const req = runAgentRequirement("researcher", "find data", { topic: "ai" });
			expect(req.type).toBe("RUN_AGENT");
			expect(req.agent).toBe("researcher");
			expect(req.input).toBe("find data");
			expect(req.context).toEqual({ topic: "ai" });
		});
	});

	describe("concatResults", () => {
		it("should concatenate string outputs", () => {
			const results = [
				makeRunResult("hello"),
				makeRunResult("world"),
			];
			expect(concatResults(results)).toBe("hello\n\nworld");
		});

		it("should stringify non-string outputs", () => {
			const results = [
				makeRunResult({ key: "val" }),
				makeRunResult("text"),
			];
			expect(concatResults(results, " | ")).toBe('{"key":"val"} | text');
		});
	});

	describe("pickBestResult", () => {
		it("should pick the result with the highest score", () => {
			const results = [
				makeRunResult("low", 5),
				makeRunResult("high", 20),
				makeRunResult("mid", 10),
			];
			const best = pickBestResult(results, (r) => r.totalTokens);
			expect(best.output).toBe("high");
		});

		it("should throw for empty results", () => {
			expect(() => pickBestResult([], () => 0)).toThrow("No results to pick from");
		});
	});

	describe("collectOutputs", () => {
		it("should collect output from all results", () => {
			const results = [makeRunResult("a"), makeRunResult("b"), makeRunResult("c")];
			expect(collectOutputs(results)).toEqual(["a", "b", "c"]);
		});
	});

	describe("aggregateTokens", () => {
		it("should sum totalTokens across results", () => {
			const results = [
				makeRunResult("x", 100),
				makeRunResult("y", 200),
				makeRunResult("z", 50),
			];
			expect(aggregateTokens(results)).toBe(350);
		});
	});
});
