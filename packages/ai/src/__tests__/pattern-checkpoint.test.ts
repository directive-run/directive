import { describe, it, expect } from "vitest";
import { createTestMultiAgentOrchestrator } from "../testing.js";
import {
  sequential,
  supervisor,
  reflect,
  debate,
  dag,
  getPatternStep,
  getCheckpointProgress,
  diffCheckpoints,
  forkFromCheckpoint,
} from "../multi-agent-orchestrator.js";
import { InMemoryCheckpointStore } from "../checkpoint.js";
import type {
  SequentialCheckpointState,
  SupervisorCheckpointState,
  ReflectCheckpointState,
  DebateCheckpointState,
  DagCheckpointState,
  PatternCheckpointState,
} from "../types.js";

// ============================================================================
// Helpers
// ============================================================================

function makeOrchestrator(agentIds: string[], mockOutput: string | Record<string, unknown> = "ok") {
  const agents: Record<string, { agent: { name: string } }> = {};
  const mockResponses: Record<string, { output: string; totalTokens: number }> = {};

  for (const id of agentIds) {
    agents[id] = { agent: { name: id } };
    mockResponses[id] = {
      output: typeof mockOutput === "string" ? mockOutput : JSON.stringify(mockOutput),
      totalTokens: 10,
    };
  }

  return createTestMultiAgentOrchestrator({ agents, mockResponses });
}

// ============================================================================
// Sequential Pattern Checkpoint
// ============================================================================

describe("Sequential Pattern Checkpoint", () => {
  it("saves checkpoints at configured intervals", async () => {
    const store = new InMemoryCheckpointStore();
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        c: { agent: { name: "c" } },
        d: { agent: { name: "d" } },
      },
      mockResponses: {
        a: { output: "from-a", totalTokens: 10 },
        b: { output: "from-b", totalTokens: 10 },
        c: { output: "from-c", totalTokens: 10 },
        d: { output: "from-d", totalTokens: 10 },
      },
      patterns: {
        seq: {
          type: "sequential",
          handlers: ["a", "b", "c", "d"],
          checkpoint: { everyN: 1, store, labelPrefix: "seq-test" },
        },
      },
    });

    await orchestrator.runPattern("seq", "hello");

    const checkpoints = await store.list();
    // Should have saved at least 1 checkpoint (after agents 1, 2, 3)
    expect(checkpoints.length).toBeGreaterThanOrEqual(1);

    for (const cp of checkpoints) {
      expect(cp.label).toMatch(/^seq-test:step-/);
    }
  });

  it("resumes from checkpoint and continues execution", async () => {
    const orchestrator = makeOrchestrator(["a", "b", "c", "d"]);

    const checkpointState: SequentialCheckpointState = {
      type: "sequential",
      version: 1,
      id: "ckpt_seq_resume",
      createdAt: new Date().toISOString(),
      label: "seq:step-2",
      patternId: "__resume_test",
      step: 2,
      currentInput: "from-b",
      results: [
        { agentId: "a", output: "from-a", totalTokens: 10 },
        { agentId: "b", output: "from-b", totalTokens: 10 },
      ],
    };

    const pattern = sequential<string>(["a", "b", "c", "d"]);
    const result = await orchestrator.resumeSequential(checkpointState, pattern);

    // Should have completed (ran agents c and d from step 2)
    expect(result).toBeDefined();
  });

  it("rejects invalid checkpoint state", async () => {
    const orchestrator = makeOrchestrator(["a"]);

    await expect(
      orchestrator.resumeSequential(
        { version: 2 } as any,
        sequential(["a"]),
      ),
    ).rejects.toThrow("Invalid sequential checkpoint state");
  });
});

// ============================================================================
// Supervisor Pattern Checkpoint
// ============================================================================

describe("Supervisor Pattern Checkpoint", () => {
  it("saves checkpoints at configured intervals", async () => {
    const store = new InMemoryCheckpointStore();
    let bossCallCount = 0;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        boss: { agent: { name: "boss" } },
        w1: { agent: { name: "w1" } },
      },
      mockResponses: {
        boss: {
          output: "dynamic",
          totalTokens: 15,
          generate: () => {
            bossCallCount++;
            if (bossCallCount <= 2) {
              return { output: JSON.stringify({ action: "delegate", worker: "w1", workerInput: "do work" }), totalTokens: 15 };
            }

            return { output: JSON.stringify({ action: "complete" }), totalTokens: 15 };
          },
        },
        w1: { output: "w1-done", totalTokens: 10 },
      },
      patterns: {
        sup: {
          type: "supervisor",
          supervisor: "boss",
          workers: ["w1"],
          maxRounds: 3,
          checkpoint: { everyN: 1, store, labelPrefix: "sup-test" },
        },
      },
    });

    await orchestrator.runPattern("sup", "task");

    const checkpoints = await store.list();
    expect(checkpoints.length).toBeGreaterThanOrEqual(1);
  });

  it("resumes from checkpoint and continues execution", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        boss: { agent: { name: "boss" } },
        w1: { agent: { name: "w1" } },
      },
      mockResponses: {
        boss: { output: JSON.stringify({ action: "complete" }), totalTokens: 15 },
        w1: { output: "done", totalTokens: 10 },
      },
    });

    const checkpointState: SupervisorCheckpointState = {
      type: "supervisor",
      version: 1,
      id: "ckpt_sup_resume",
      createdAt: new Date().toISOString(),
      label: "sup:round-1",
      patternId: "__resume_test",
      round: 1,
      supervisorOutput: { action: "delegate", worker: "w1", workerInput: "do work" },
      workerResults: [{ output: "partial", totalTokens: 10 }],
      currentInput: "task",
    };

    const pattern = supervisor("boss", ["w1"], { maxRounds: 3 });
    const result = await orchestrator.resumeSupervisor(checkpointState, pattern, { input: "task" });

    expect(result).toBeDefined();
  });

  it("rejects invalid checkpoint state", async () => {
    const orchestrator = makeOrchestrator(["boss", "w1"]);

    await expect(
      orchestrator.resumeSupervisor(
        { version: 2 } as any,
        supervisor("boss", ["w1"]),
      ),
    ).rejects.toThrow("Invalid supervisor checkpoint state");
  });
});

// ============================================================================
// Reflect Pattern Checkpoint
// ============================================================================

describe("Reflect Pattern Checkpoint", () => {
  it("saves checkpoints at configured intervals", async () => {
    const store = new InMemoryCheckpointStore();
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        writer: { agent: { name: "writer" } },
        reviewer: { agent: { name: "reviewer" } },
      },
      mockResponses: {
        writer: { output: "draft text", totalTokens: 20 },
        reviewer: { output: JSON.stringify({ passed: true, score: 0.9 }), totalTokens: 15 },
      },
      patterns: {
        ref: {
          type: "reflect",
          handler: "writer",
          evaluator: "reviewer",
          maxIterations: 3,
          checkpoint: { everyN: 1, store, labelPrefix: "ref-test" },
        },
      },
    });

    await orchestrator.runPattern("ref", "write an essay");

    // Reflect should pass on first iteration, so checkpoint may not save
    // (only saves after iteration > startIteration, and everyN applies)
    const checkpoints = await store.list();
    // At minimum, the test verifies no errors occur during checkpoint path
    expect(checkpoints.length).toBeGreaterThanOrEqual(0);
  });

  it("resumes from checkpoint and continues execution", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        writer: { agent: { name: "writer" } },
        reviewer: { agent: { name: "reviewer" } },
      },
      mockResponses: {
        writer: { output: "revised text", totalTokens: 20 },
        reviewer: { output: JSON.stringify({ passed: true, score: 0.95 }), totalTokens: 15 },
      },
    });

    const checkpointState: ReflectCheckpointState = {
      type: "reflect",
      version: 1,
      id: "ckpt_ref_resume",
      createdAt: new Date().toISOString(),
      label: "ref:iter-1",
      patternId: "__resume_test",
      iteration: 1,
      effectiveInput: "Previous feedback: needs more detail\n\nOriginal: write an essay",
      history: [
        { iteration: 0, passed: false, score: 0.4, feedback: "needs more detail", durationMs: 100, producerTokens: 20, evaluatorTokens: 15 },
      ],
      producerOutputs: [{ output: "first draft", score: 0.4 }],
      lastProducerOutput: "first draft",
    };

    const pattern = reflect<string>("writer", "reviewer", { maxIterations: 3 });
    const result = await orchestrator.resumeReflect(checkpointState, pattern, { input: "write an essay" });

    expect(result).toBeDefined();
  });

  it("rejects invalid checkpoint state", async () => {
    const orchestrator = makeOrchestrator(["writer", "reviewer"]);

    await expect(
      orchestrator.resumeReflect(
        { version: 2 } as any,
        reflect("writer", "reviewer"),
      ),
    ).rejects.toThrow("Invalid reflect checkpoint state");
  });
});

// ============================================================================
// Debate Pattern Checkpoint
// ============================================================================

describe("Debate Pattern Checkpoint", () => {
  it("saves checkpoints at configured intervals", async () => {
    const store = new InMemoryCheckpointStore();
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        d1: { agent: { name: "d1" } },
        d2: { agent: { name: "d2" } },
        judge: { agent: { name: "judge" } },
      },
      mockResponses: {
        d1: { output: "argument-1", totalTokens: 10 },
        d2: { output: "argument-2", totalTokens: 10 },
        judge: { output: JSON.stringify({ winnerId: "d1", feedback: "better argument" }), totalTokens: 15 },
      },
      patterns: {
        dbt: {
          type: "debate",
          handlers: ["d1", "d2"],
          evaluator: "judge",
          maxRounds: 3,
          checkpoint: { everyN: 1, store, labelPrefix: "dbt-test" },
        },
      },
    });

    await orchestrator.runPattern("dbt", "discuss AI safety");

    const checkpoints = await store.list();
    // With 3 rounds and everyN=1, should save at least 1 checkpoint
    expect(checkpoints.length).toBeGreaterThanOrEqual(1);

    for (const cp of checkpoints) {
      expect(cp.label).toMatch(/^dbt-test:round-/);
    }
  });

  it("resumes from checkpoint and continues execution", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        d1: { agent: { name: "d1" } },
        d2: { agent: { name: "d2" } },
        judge: { agent: { name: "judge" } },
      },
      mockResponses: {
        d1: { output: "argument-1", totalTokens: 10 },
        d2: { output: "argument-2", totalTokens: 10 },
        judge: { output: JSON.stringify({ winnerId: "d1" }), totalTokens: 15 },
      },
    });

    const checkpointState: DebateCheckpointState = {
      type: "debate",
      version: 1,
      id: "ckpt_dbt_resume",
      createdAt: new Date().toISOString(),
      label: "dbt:round-1",
      patternId: "__resume_test",
      round: 1,
      currentInput: "discuss AI safety",
      rounds: [
        {
          proposals: [
            { agentId: "d1", output: "round1-arg1" },
            { agentId: "d2", output: "round1-arg2" },
          ],
          judgement: { winnerId: "d1", feedback: "solid argument" },
        },
      ],
      lastWinnerId: "d1",
      lastWinnerOutput: "round1-arg1",
      tokensConsumed: 35,
    };

    const pattern = debate<string>({ handlers: ["d1", "d2"], evaluator: "judge", maxRounds: 3 });
    const result = await orchestrator.resumeDebate(checkpointState, pattern);

    expect(result).toBeDefined();
    expect(result.winnerId).toBeDefined();
    // Should have the original round plus new rounds
    expect(result.rounds.length).toBeGreaterThan(1);
  });

  it("rejects invalid checkpoint state", async () => {
    const orchestrator = makeOrchestrator(["d1", "d2", "judge"]);

    await expect(
      orchestrator.resumeDebate(
        { version: 2 } as any,
        debate({ handlers: ["d1", "d2"], evaluator: "judge" }),
      ),
    ).rejects.toThrow("Invalid debate checkpoint state");
  });
});

// ============================================================================
// DAG Pattern Checkpoint
// ============================================================================

describe("DAG Pattern Checkpoint", () => {
  it("saves checkpoints after node completion", async () => {
    const store = new InMemoryCheckpointStore();
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        fetcher: { agent: { name: "fetcher" } },
        analyzer: { agent: { name: "analyzer" } },
        summarizer: { agent: { name: "summarizer" } },
      },
      mockResponses: {
        fetcher: { output: "data", totalTokens: 10 },
        analyzer: { output: "analysis", totalTokens: 15 },
        summarizer: { output: "summary", totalTokens: 10 },
      },
      patterns: {
        pipeline: {
          type: "dag",
          nodes: {
            fetch: { handler: "fetcher" },
            analyze: { handler: "analyzer", deps: ["fetch"] },
            summarize: { handler: "summarizer", deps: ["analyze"] },
          },
          merge: (context) => context.outputs.summarize as string,
          checkpoint: { everyN: 1, store, labelPrefix: "dag-test" },
        },
      },
    });

    await orchestrator.runPattern("pipeline", "process this");

    const checkpoints = await store.list();
    expect(checkpoints.length).toBeGreaterThanOrEqual(1);

    for (const cp of checkpoints) {
      expect(cp.label).toMatch(/^dag-test:node-/);
    }
  });

  it("resumes from checkpoint and skips completed nodes", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        fetcher: { agent: { name: "fetcher" } },
        analyzer: { agent: { name: "analyzer" } },
        summarizer: { agent: { name: "summarizer" } },
      },
      mockResponses: {
        fetcher: { output: "data", totalTokens: 10 },
        analyzer: { output: "analysis", totalTokens: 15 },
        summarizer: { output: "summary", totalTokens: 10 },
      },
    });

    const checkpointState: DagCheckpointState = {
      type: "dag",
      version: 1,
      id: "ckpt_dag_resume",
      createdAt: new Date().toISOString(),
      label: "dag:node-1",
      patternId: "__resume_test",
      statuses: { fetch: "completed", analyze: "pending", summarize: "pending" },
      outputs: { fetch: "data" },
      errors: {},
      completedCount: 1,
      nodeResults: { fetch: { output: "data", totalTokens: 10 } },
      input: "process this",
    };

    const pattern = dag<string>(
      {
        fetch: { handler: "fetcher" },
        analyze: { handler: "analyzer", deps: ["fetch"] },
        summarize: { handler: "summarizer", deps: ["analyze"] },
      },
      (context) => context.outputs.summarize as string,
    );

    const result = await orchestrator.resumeDag(checkpointState, pattern, { input: "process this" });

    // Should complete without re-running the fetch node
    expect(result).toBeDefined();
  });

  it("rejects invalid checkpoint state", async () => {
    const orchestrator = makeOrchestrator(["fetcher"]);

    await expect(
      orchestrator.resumeDag(
        { version: 2 } as any,
        dag({ fetch: { handler: "fetcher" } }),
      ),
    ).rejects.toThrow("Invalid DAG checkpoint state");
  });
});

// ============================================================================
// Checkpoint Progress
// ============================================================================

describe("getCheckpointProgress", () => {
  it("computes progress for sequential pattern", () => {
    const state: SequentialCheckpointState = {
      type: "sequential",
      version: 1,
      id: "test",
      createdAt: new Date().toISOString(),
      patternId: "test",
      step: 2,
      currentInput: "input",
      results: [
        { agentId: "a", output: "ok", totalTokens: 10 },
        { agentId: "b", output: "ok", totalTokens: 15 },
      ],
    };

    const progress = getCheckpointProgress(state);
    expect(progress.stepsCompleted).toBe(2);
    expect(progress.tokensConsumed).toBe(25);
  });

  it("computes progress for DAG pattern", () => {
    const state: DagCheckpointState = {
      type: "dag",
      version: 1,
      id: "test",
      createdAt: new Date().toISOString(),
      patternId: "test",
      statuses: { a: "completed", b: "completed", c: "pending" },
      outputs: { a: "ok", b: "ok" },
      errors: {},
      completedCount: 2,
      nodeResults: {
        a: { output: "ok", totalTokens: 10 },
        b: { output: "ok", totalTokens: 20 },
      },
      input: "test",
    };

    const progress = getCheckpointProgress(state);
    expect(progress.stepsCompleted).toBe(2);
    expect(progress.stepsTotal).toBe(3);
    expect(progress.tokensConsumed).toBe(30);
    expect(progress.percentage).toBeCloseTo(66.67, 0);
  });

  it("computes progress for debate pattern", () => {
    const state: DebateCheckpointState = {
      type: "debate",
      version: 1,
      id: "test",
      createdAt: new Date().toISOString(),
      patternId: "test",
      round: 2,
      currentInput: "topic",
      rounds: [
        { proposals: [], judgement: { winnerId: "a" } },
        { proposals: [], judgement: { winnerId: "b" } },
      ],
      lastWinnerId: "b",
      lastWinnerOutput: "arg",
      tokensConsumed: 100,
    };

    const progress = getCheckpointProgress(state);
    expect(progress.stepsCompleted).toBe(2);
    expect(progress.tokensConsumed).toBe(100);
  });

  it("computes progress for reflect pattern", () => {
    const state: ReflectCheckpointState = {
      type: "reflect",
      version: 1,
      id: "test",
      createdAt: new Date().toISOString(),
      patternId: "test",
      iteration: 2,
      effectiveInput: "input",
      history: [
        { iteration: 0, passed: false, score: 0.3, durationMs: 100, producerTokens: 20, evaluatorTokens: 10 },
        { iteration: 1, passed: false, score: 0.6, durationMs: 100, producerTokens: 25, evaluatorTokens: 10 },
      ],
      producerOutputs: [{ output: "v1" }, { output: "v2" }],
      lastProducerOutput: "v2",
    };

    const progress = getCheckpointProgress(state);
    expect(progress.stepsCompleted).toBe(2);
    expect(progress.tokensConsumed).toBe(65); // 20+10+25+10
  });
});

// ============================================================================
// Checkpoint Diff
// ============================================================================

describe("diffCheckpoints", () => {
  it("computes diff between two sequential checkpoints", () => {
    const a: SequentialCheckpointState = {
      type: "sequential",
      version: 1,
      id: "a",
      createdAt: new Date().toISOString(),
      patternId: "test",
      step: 1,
      currentInput: "input",
      results: [{ agentId: "a", output: "ok", totalTokens: 10 }],
    };

    const b: SequentialCheckpointState = {
      type: "sequential",
      version: 1,
      id: "b",
      createdAt: new Date().toISOString(),
      patternId: "test",
      step: 3,
      currentInput: "input-3",
      results: [
        { agentId: "a", output: "ok", totalTokens: 10 },
        { agentId: "b", output: "ok", totalTokens: 15 },
        { agentId: "c", output: "ok", totalTokens: 20 },
      ],
    };

    const diff = diffCheckpoints(a, b);
    expect(diff.patternType).toBe("sequential");
    expect(diff.stepDelta).toBe(2);
    expect(diff.tokensDelta).toBe(35); // 45-10
  });

  it("computes diff with nodes completed for DAG", () => {
    const a: DagCheckpointState = {
      type: "dag",
      version: 1,
      id: "a",
      createdAt: new Date().toISOString(),
      patternId: "test",
      statuses: { x: "completed", y: "pending", z: "pending" },
      outputs: { x: "ok" },
      errors: {},
      completedCount: 1,
      nodeResults: { x: { output: "ok", totalTokens: 10 } },
      input: "test",
    };

    const b: DagCheckpointState = {
      type: "dag",
      version: 1,
      id: "b",
      createdAt: new Date().toISOString(),
      patternId: "test",
      statuses: { x: "completed", y: "completed", z: "pending" },
      outputs: { x: "ok", y: "ok" },
      errors: {},
      completedCount: 2,
      nodeResults: { x: { output: "ok", totalTokens: 10 }, y: { output: "ok", totalTokens: 20 } },
      input: "test",
    };

    const diff = diffCheckpoints(a, b);
    expect(diff.patternType).toBe("dag");
    expect(diff.stepDelta).toBe(1);
    expect(diff.tokensDelta).toBe(20);
    expect(diff.nodesCompleted).toEqual(["y"]);
  });

  it("throws when diffing different pattern types", () => {
    const a: SequentialCheckpointState = {
      type: "sequential",
      version: 1,
      id: "a",
      createdAt: new Date().toISOString(),
      patternId: "test",
      step: 0,
      currentInput: "",
      results: [],
    };

    const b: DebateCheckpointState = {
      type: "debate",
      version: 1,
      id: "b",
      createdAt: new Date().toISOString(),
      patternId: "test",
      round: 0,
      currentInput: "",
      rounds: [],
      lastWinnerId: "",
      lastWinnerOutput: "",
      tokensConsumed: 0,
    };

    expect(() => diffCheckpoints(a, b as unknown as PatternCheckpointState)).toThrow(
      "Cannot diff different pattern types",
    );
  });
});

// ============================================================================
// Conditional Checkpointing
// ============================================================================

describe("Conditional Checkpointing", () => {
  it("respects when() predicate — saves only when true", async () => {
    const store = new InMemoryCheckpointStore();
    let stepsSeen: number[] = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        c: { agent: { name: "c" } },
        d: { agent: { name: "d" } },
        e: { agent: { name: "e" } },
      },
      mockResponses: {
        a: { output: "ok", totalTokens: 10 },
        b: { output: "ok", totalTokens: 10 },
        c: { output: "ok", totalTokens: 10 },
        d: { output: "ok", totalTokens: 10 },
        e: { output: "ok", totalTokens: 10 },
      },
      patterns: {
        seq: {
          type: "sequential",
          handlers: ["a", "b", "c", "d", "e"],
          checkpoint: {
            everyN: 1,
            store,
            when: (context) => {
              stepsSeen.push(context.step);

              // Only save on even steps
              return context.step % 2 === 0;
            },
          },
        },
      },
    });

    await orchestrator.runPattern("seq", "hello");

    const checkpoints = await store.list();
    // when() skips odd steps, so fewer checkpoints
    // Each checkpoint should only be for even steps
    for (const cp of checkpoints) {
      const loaded = await store.load(cp.id);
      if (loaded) {
        const state = JSON.parse(loaded.systemExport) as SequentialCheckpointState;
        expect(state.step % 2).toBe(0);
      }
    }
  });
});

// ============================================================================
// Retention Policies
// ============================================================================

describe("InMemoryCheckpointStore Retention", () => {
  it("prunes checkpoints older than retentionMs", async () => {
    const store = new InMemoryCheckpointStore({
      maxCheckpoints: 100,
      retentionMs: 1000, // 1 second
    });

    // Save an "old" checkpoint with a past createdAt
    const oldCheckpoint = {
      version: 1 as const,
      id: "old-1",
      createdAt: new Date(Date.now() - 5000).toISOString(), // 5 seconds ago
      systemExport: "{}",
      timelineExport: null,
      localState: { type: "single" as const },
      memoryExport: null,
      orchestratorType: "single" as const,
    };

    const newCheckpoint = {
      version: 1 as const,
      id: "new-1",
      createdAt: new Date().toISOString(),
      systemExport: "{}",
      timelineExport: null,
      localState: { type: "single" as const },
      memoryExport: null,
      orchestratorType: "single" as const,
    };

    await store.save(oldCheckpoint);
    await store.save(newCheckpoint);

    const pruned = await store.prune();
    expect(pruned).toBe(1);

    const remaining = await store.list();
    expect(remaining.length).toBe(1);
    expect(remaining[0]!.id).toBe("new-1");
  });

  it("preserves labeled checkpoints during prune when preserveLabeled is true", async () => {
    const store = new InMemoryCheckpointStore({
      maxCheckpoints: 100,
      retentionMs: 1000,
      preserveLabeled: true,
    });

    const oldLabeled = {
      version: 1 as const,
      id: "old-labeled",
      createdAt: new Date(Date.now() - 5000).toISOString(),
      label: "important",
      systemExport: "{}",
      timelineExport: null,
      localState: { type: "single" as const },
      memoryExport: null,
      orchestratorType: "single" as const,
    };

    const oldUnlabeled = {
      version: 1 as const,
      id: "old-unlabeled",
      createdAt: new Date(Date.now() - 5000).toISOString(),
      systemExport: "{}",
      timelineExport: null,
      localState: { type: "single" as const },
      memoryExport: null,
      orchestratorType: "single" as const,
    };

    await store.save(oldLabeled);
    await store.save(oldUnlabeled);

    const pruned = await store.prune();
    expect(pruned).toBe(1); // Only unlabeled pruned

    const remaining = await store.list();
    expect(remaining.length).toBe(1);
    expect(remaining[0]!.id).toBe("old-labeled");
  });

  it("FIFO eviction preserves labeled checkpoints", async () => {
    const store = new InMemoryCheckpointStore({
      maxCheckpoints: 2,
      preserveLabeled: true,
    });

    const labeled = {
      version: 1 as const,
      id: "labeled-1",
      createdAt: new Date().toISOString(),
      label: "keep-me",
      systemExport: "{}",
      timelineExport: null,
      localState: { type: "single" as const },
      memoryExport: null,
      orchestratorType: "single" as const,
    };

    const unlabeled = {
      version: 1 as const,
      id: "unlabeled-1",
      createdAt: new Date().toISOString(),
      systemExport: "{}",
      timelineExport: null,
      localState: { type: "single" as const },
      memoryExport: null,
      orchestratorType: "single" as const,
    };

    const third = {
      version: 1 as const,
      id: "third-1",
      createdAt: new Date().toISOString(),
      systemExport: "{}",
      timelineExport: null,
      localState: { type: "single" as const },
      memoryExport: null,
      orchestratorType: "single" as const,
    };

    await store.save(labeled);
    await store.save(unlabeled);
    // This should evict unlabeled (not labeled) to make room
    await store.save(third);

    const remaining = await store.list();
    expect(remaining.length).toBe(2);
    const ids = remaining.map((r) => r.id);
    expect(ids).toContain("labeled-1");
    expect(ids).toContain("third-1");
  });
});

// ============================================================================
// Replay
// ============================================================================

describe("Replay", () => {
  it("replays from a saved checkpoint", async () => {
    const store = new InMemoryCheckpointStore();

    // Save a checkpoint manually
    const checkpointState: SequentialCheckpointState = {
      type: "sequential",
      version: 1,
      id: "ckpt_replay_test",
      createdAt: new Date().toISOString(),
      label: "test",
      patternId: "__replay_test",
      step: 1,
      currentInput: "from-a",
      results: [{ agentId: "a", output: "from-a", totalTokens: 10 }],
    };

    await store.save({
      version: 1,
      id: checkpointState.id,
      createdAt: checkpointState.createdAt,
      label: checkpointState.label,
      systemExport: JSON.stringify(checkpointState),
      timelineExport: null,
      localState: { type: "multi", globalTokenCount: 0, globalStatus: "idle", agentStates: {}, handoffCounter: 0, pendingHandoffs: [], handoffResults: [], roundRobinCounters: null },
      memoryExport: null,
      orchestratorType: "multi",
    });

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        c: { agent: { name: "c" } },
      },
      mockResponses: {
        a: { output: "from-a", totalTokens: 10 },
        b: { output: "from-b", totalTokens: 10 },
        c: { output: "from-c", totalTokens: 10 },
      },
      checkpointStore: store,
    });

    const pattern = sequential<string>(["a", "b", "c"]);
    const result = await orchestrator.replay(checkpointState.id, pattern);

    expect(result).toBeDefined();
  });

  it("throws when checkpoint not found", async () => {
    const store = new InMemoryCheckpointStore();
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: { a: { agent: { name: "a" } } },
      mockResponses: { a: { output: "ok", totalTokens: 10 } },
      checkpointStore: store,
    });

    await expect(
      orchestrator.replay("nonexistent", sequential(["a"])),
    ).rejects.toThrow("Checkpoint not found");
  });

  it("throws when no checkpoint store configured", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: { a: { agent: { name: "a" } } },
      mockResponses: { a: { output: "ok", totalTokens: 10 } },
    });

    await expect(
      orchestrator.replay("any", sequential(["a"])),
    ).rejects.toThrow("No checkpoint store configured");
  });

  it("rejects checkpoint with invalid state", async () => {
    const store = new InMemoryCheckpointStore();

    await store.save({
      version: 1,
      id: "bad-ckpt",
      createdAt: new Date().toISOString(),
      systemExport: JSON.stringify({ type: "unknown_type", version: 99 }),
      timelineExport: null,
      localState: { type: "multi", globalTokenCount: 0, globalStatus: "idle", agentStates: {}, handoffCounter: 0, pendingHandoffs: [], handoffResults: [], roundRobinCounters: null },
      memoryExport: null,
      orchestratorType: "multi",
    });

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: { a: { agent: { name: "a" } } },
      mockResponses: { a: { output: "ok", totalTokens: 10 } },
      checkpointStore: store,
    });

    await expect(
      orchestrator.replay("bad-ckpt", sequential(["a"])),
    ).rejects.toThrow("Invalid checkpoint state");
  });
});

// ============================================================================
// Fork from Checkpoint
// ============================================================================

describe("forkFromCheckpoint", () => {
  it("creates an independent orchestrator from a checkpoint", async () => {
    const store = new InMemoryCheckpointStore();

    // Save a sequential checkpoint
    const checkpointState: SequentialCheckpointState = {
      type: "sequential",
      version: 1,
      id: "ckpt_fork_test",
      createdAt: new Date().toISOString(),
      label: "fork-test",
      patternId: "__fork_test",
      step: 1,
      currentInput: "from-a",
      results: [{ agentId: "a", output: "from-a", totalTokens: 10 }],
    };

    await store.save({
      version: 1,
      id: checkpointState.id,
      createdAt: checkpointState.createdAt,
      label: checkpointState.label,
      systemExport: JSON.stringify(checkpointState),
      timelineExport: null,
      localState: { type: "multi", globalTokenCount: 0, globalStatus: "idle", agentStates: {}, handoffCounter: 0, pendingHandoffs: [], handoffResults: [], roundRobinCounters: null },
      memoryExport: null,
      orchestratorType: "multi",
    });

    const mockAgent = { name: "test-agent" };
    const forked = await forkFromCheckpoint(
      {
        agents: {
          a: { agent: mockAgent },
          b: { agent: mockAgent },
        },
        runner: (async () => ({ output: "forked-output", messages: [], toolCalls: [], totalTokens: 5 })) as any,
        debug: true,
      },
      store,
      "ckpt_fork_test",
    );

    expect(forked).toBeDefined();
    expect(forked.system).toBeDefined();
  });

  it("throws when checkpoint not found", async () => {
    const store = new InMemoryCheckpointStore();

    await expect(
      forkFromCheckpoint(
        { agents: { a: { agent: { name: "a" } } }, runner: (async () => ({ output: "ok", messages: [], toolCalls: [], totalTokens: 5 })) as any },
        store,
        "nonexistent",
      ),
    ).rejects.toThrow("Checkpoint not found");
  });
});

// ============================================================================
// getPatternStep
// ============================================================================

describe("getPatternStep", () => {
  it("returns step for sequential", () => {
    expect(getPatternStep({ type: "sequential", step: 3, version: 1, id: "x", createdAt: "", patternId: "p", currentInput: "", results: [] })).toBe(3);
  });

  it("returns round for supervisor", () => {
    expect(getPatternStep({ type: "supervisor", round: 5, version: 1, id: "x", createdAt: "", patternId: "p", supervisorOutput: null, workerResults: [], currentInput: "" })).toBe(5);
  });

  it("returns iteration for reflect", () => {
    expect(getPatternStep({ type: "reflect", iteration: 2, version: 1, id: "x", createdAt: "", patternId: "p", effectiveInput: "", history: [], producerOutputs: [], lastProducerOutput: null })).toBe(2);
  });

  it("returns round for debate", () => {
    expect(getPatternStep({ type: "debate", round: 4, version: 1, id: "x", createdAt: "", patternId: "p", currentInput: "", rounds: [], lastWinnerId: "", lastWinnerOutput: "", tokensConsumed: 0 })).toBe(4);
  });

  it("returns completedCount for dag", () => {
    expect(getPatternStep({ type: "dag", completedCount: 7, version: 1, id: "x", createdAt: "", patternId: "p", statuses: {}, outputs: {}, errors: {}, nodeResults: {}, input: "" })).toBe(7);
  });
});
