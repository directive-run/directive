import { describe, expect, it, vi } from "vitest";
import { dag, parallel, sequential } from "../multi-agent-orchestrator.js";
import type { TaskContext } from "../multi-agent-orchestrator.js";
import {
  createMockTask,
  createTestMultiAgentOrchestrator,
} from "../testing.js";

// ============================================================================
// Basic task execution
// ============================================================================

describe("tasks: basic execution", () => {
  it("task runs in a DAG pattern", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        researcher: { agent: { name: "researcher" } },
        writer: { agent: { name: "writer" } },
      },
      mockResponses: {
        researcher: { output: '{"data":"research results"}', totalTokens: 50 },
        writer: { output: "final report", totalTokens: 30 },
      },
      tasks: {
        transform: {
          run: async (input) => {
            const data = JSON.parse(input);

            return JSON.stringify({ ...data, processed: true });
          },
          label: "Transform",
        },
      },
      patterns: {
        pipeline: dag<string>(
          {
            research: { handler: "researcher" },
            process: { handler: "transform", deps: ["research"] },
            write: { handler: "writer", deps: ["process"] },
          },
          (ctx) => ctx.outputs.write as string,
        ),
      },
    });

    const result = await orchestrator.runPattern<string>(
      "pipeline",
      "analyze this",
    );

    expect(result).toBe("final report");
  });

  it("task runs in sequential pattern", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        agent1: { agent: { name: "agent1" } },
      },
      mockResponses: {
        agent1: { output: "agent output", totalTokens: 10 },
      },
      tasks: {
        transform: {
          run: async (input) => `transformed: ${input}`,
          label: "Transform",
        },
      },
      patterns: {
        chain: sequential(["agent1", "transform"]),
      },
    });

    const result = await orchestrator.runPattern("chain", "hello");

    expect(result).toBe("transformed: agent output");
  });

  it("task runs in parallel pattern", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        agent1: { agent: { name: "agent1" } },
      },
      mockResponses: {
        agent1: { output: "agent output", totalTokens: 10 },
      },
      tasks: {
        transform: {
          run: async () => "task output",
          label: "Transform",
        },
      },
      patterns: {
        fan: parallel(["agent1", "transform"], (results) =>
          results.map((r) => String(r.output)).join("|"),
        ),
      },
    });

    const result = await orchestrator.runPattern("fan", "hello");

    expect(result).toContain("agent output");
    expect(result).toContain("task output");
  });

  it("task output is stringified when non-string", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        jsonTask: {
          run: async () => ({ value: 42 }),
          label: "JSON Task",
        },
      },
    });

    const result = await orchestrator.run("jsonTask", "input");

    // Core safeStringify pretty-prints with 2-space indent
    expect(result.output).toBe('{\n  "value": 42\n}');
    expect(result.totalTokens).toBe(0);
  });

  it("task string output is passed through as-is", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        strTask: {
          run: async () => "hello world",
          label: "Str Task",
        },
      },
    });

    const result = await orchestrator.run("strTask", "input");

    expect(result.output).toBe("hello world");
  });

  it("task totalTokens is always 0", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        t: { run: async () => "ok", label: "T" },
      },
    });

    const result = await orchestrator.run("t", "x");

    expect(result.totalTokens).toBe(0);
  });
});

// ============================================================================
// TaskContext
// ============================================================================

describe("tasks: TaskContext", () => {
  it("provides taskId in context", async () => {
    let receivedTaskId: string | undefined;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        myTask: {
          run: async (_input, _signal, context) => {
            receivedTaskId = context.taskId;

            return "ok";
          },
          label: "My Task",
        },
      },
    });

    await orchestrator.run("myTask", "input");

    expect(receivedTaskId).toBe("myTask");
  });

  it("provides read-only memory snapshot", async () => {
    let receivedMemory: TaskContext["memory"] | undefined;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        memTask: {
          run: async (_input, _signal, context) => {
            receivedMemory = context.memory;

            return "ok";
          },
          label: "Mem Task",
        },
      },
    });

    await orchestrator.run("memTask", "check memory");

    // Memory should be a read-only array (may be empty if no messages sent yet)
    expect(Array.isArray(receivedMemory)).toBe(true);
  });

  it("provides read-only scratchpad snapshot (deep cloned)", async () => {
    let receivedScratchpad: TaskContext["scratchpad"] | undefined;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        scratchTask: {
          run: async (_input, _signal, context) => {
            receivedScratchpad = context.scratchpad;

            return "ok";
          },
          label: "Scratch Task",
        },
      },
    });

    await orchestrator.run("scratchTask", "input");

    expect(receivedScratchpad).toBeDefined();
    // Should be frozen
    expect(Object.isFrozen(receivedScratchpad)).toBe(true);
  });

  it("readAgentState reads agent states", async () => {
    let readState: ReturnType<TaskContext["readAgentState"]>;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        researcher: { agent: { name: "researcher" } },
      },
      mockResponses: {
        researcher: { output: "research done", totalTokens: 20 },
      },
      tasks: {
        checker: {
          run: async (_input, _signal, context) => {
            readState = context.readAgentState("researcher");

            return "ok";
          },
          label: "Checker",
        },
      },
      patterns: {
        pipeline: dag({
          research: { handler: "researcher" },
          check: { handler: "checker", deps: ["research"] },
        }),
      },
    });

    await orchestrator.runPattern("pipeline", "go");

    expect(readState).toBeDefined();
    expect(readState!.status).toBe("completed");
    expect(readState!.lastOutput).toBe("research done");
  });

  it("readAgentState also reads task states", async () => {
    let readState: ReturnType<TaskContext["readAgentState"]>;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        first: {
          run: async () => "first done",
          label: "First",
        },
        second: {
          run: async (_input, _signal, context) => {
            readState = context.readAgentState("first");

            return "ok";
          },
          label: "Second",
        },
      },
      patterns: {
        chain: sequential(["first", "second"]),
      },
    });

    await orchestrator.runPattern("chain", "go");

    expect(readState).toBeDefined();
    expect(readState!.status).toBe("completed");
    expect(readState!.lastOutput).toBe("first done");
    expect(readState!.totalTokens).toBe(0);
  });

  it("readAgentState returns undefined for unknown IDs", async () => {
    let readState: ReturnType<TaskContext["readAgentState"]>;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        t: {
          run: async (_input, _signal, context) => {
            readState = context.readAgentState("nonexistent");

            return "ok";
          },
          label: "T",
        },
      },
    });

    await orchestrator.run("t", "x");

    expect(readState).toBeUndefined();
  });

  it("reportProgress emits timeline events", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        prog: {
          run: async (_input, _signal, context) => {
            context.reportProgress(25, "Quarter done");
            context.reportProgress(75, "Almost done");
            context.reportProgress(100, "Complete");

            return "ok";
          },
          label: "Progress Task",
        },
      },
      debug: true,
    });

    await orchestrator.run("prog", "x");

    const events = orchestrator.timeline!.getEvents();
    const progressEvents = events.filter((e) => e.type === "task_progress");

    expect(progressEvents).toHaveLength(3);
    expect(progressEvents[0]).toMatchObject({
      type: "task_progress",
      taskId: "prog",
      percent: 25,
      message: "Quarter done",
    });
    expect(progressEvents[1]).toMatchObject({
      type: "task_progress",
      taskId: "prog",
      percent: 75,
    });
    expect(progressEvents[2]).toMatchObject({
      type: "task_progress",
      taskId: "prog",
      percent: 100,
    });
  });

  it("reportProgress clamps NaN to 0", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        nanTask: {
          run: async (_input, _signal, context) => {
            context.reportProgress(Number.NaN, "NaN progress");

            return "ok";
          },
          label: "NaN Task",
        },
      },
      debug: true,
    });

    await orchestrator.run("nanTask", "x");

    const events = orchestrator.timeline!.getEvents();
    const progressEvents = events.filter((e) => e.type === "task_progress");

    expect(progressEvents).toHaveLength(1);
    // NaN is clamped: Math.max(0, Math.min(100, NaN)) → 0
    expect(progressEvents[0]).toMatchObject({ percent: 0 });
  });

  it("reportProgress clamps to 0-100", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        clamp: {
          run: async (_input, _signal, context) => {
            context.reportProgress(-10);
            context.reportProgress(200);

            return "ok";
          },
          label: "Clamp",
        },
      },
      debug: true,
    });

    await orchestrator.run("clamp", "x");

    const events = orchestrator.timeline!.getEvents();
    const progressEvents = events.filter((e) => e.type === "task_progress");

    expect(progressEvents[0]).toMatchObject({ percent: 0 });
    expect(progressEvents[1]).toMatchObject({ percent: 100 });
  });
});

// ============================================================================
// Retry
// ============================================================================

describe("tasks: retry", () => {
  it("retries on failure with fixed backoff", async () => {
    let attempts = 0;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        flaky: {
          run: async () => {
            attempts++;
            if (attempts < 3) {
              throw new Error("transient error");
            }

            return "success";
          },
          retry: { attempts: 3, backoff: "fixed", delayMs: 1 },
          label: "Flaky",
        },
      },
    });

    const result = await orchestrator.run("flaky", "x");

    expect(result.output).toBe("success");
    expect(attempts).toBe(3);
  });

  it("throws after all retry attempts exhausted", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        broken: {
          run: async () => {
            throw new Error("permanent error");
          },
          retry: { attempts: 2, backoff: "fixed", delayMs: 1 },
          label: "Broken",
        },
      },
    });

    await expect(orchestrator.run("broken", "x")).rejects.toThrow(
      "permanent error",
    );
  });

  it("emits per-attempt error timeline events during retry", async () => {
    let attempts = 0;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        flaky: {
          run: async () => {
            attempts++;
            if (attempts < 3) {
              throw new Error("attempt failed");
            }

            return "ok";
          },
          retry: { attempts: 3, backoff: "fixed", delayMs: 1 },
          label: "Flaky",
        },
      },
      debug: true,
    });

    await orchestrator.run("flaky", "x");

    const events = orchestrator.timeline!.getEvents();
    const errorEvents = events.filter((e) => e.type === "task_error");

    // 2 retry errors (attempts 1 and 2), no final error since attempt 3 succeeds
    expect(errorEvents).toHaveLength(2);
    expect(errorEvents[0]).toMatchObject({ taskId: "flaky", attempt: 1 });
    expect(errorEvents[1]).toMatchObject({ taskId: "flaky", attempt: 2 });
  });

  it("validates retry attempts must be finite >= 1", () => {
    expect(() =>
      createTestMultiAgentOrchestrator({
        agents: {},
        mockResponses: {},
        tasks: {
          bad: {
            run: async () => "ok",
            retry: { attempts: 0 },
            label: "Bad",
          },
        },
      }),
    ).toThrow("retry attempts must be a finite number >= 1");

    expect(() =>
      createTestMultiAgentOrchestrator({
        agents: {},
        mockResponses: {},
        tasks: {
          bad: {
            run: async () => "ok",
            retry: { attempts: Number.POSITIVE_INFINITY },
            label: "Bad",
          },
        },
      }),
    ).toThrow("retry attempts must be a finite number >= 1");
  });

  it("validates retry delayMs must be finite >= 0", () => {
    expect(() =>
      createTestMultiAgentOrchestrator({
        agents: {},
        mockResponses: {},
        tasks: {
          bad: {
            run: async () => "ok",
            retry: { attempts: 2, delayMs: -1 },
            label: "Bad",
          },
        },
      }),
    ).toThrow("retry delayMs must be a finite number >= 0");
  });

  it("validates retry attempts rejects NaN", () => {
    expect(() =>
      createTestMultiAgentOrchestrator({
        agents: {},
        mockResponses: {},
        tasks: {
          bad: {
            run: async () => "ok",
            retry: { attempts: Number.NaN },
            label: "Bad",
          },
        },
      }),
    ).toThrow("retry attempts must be a finite number >= 1");
  });

  it("validates retry delayMs rejects NaN", () => {
    expect(() =>
      createTestMultiAgentOrchestrator({
        agents: {},
        mockResponses: {},
        tasks: {
          bad: {
            run: async () => "ok",
            retry: { attempts: 2, delayMs: Number.NaN },
            label: "Bad",
          },
        },
      }),
    ).toThrow("retry delayMs must be a finite number >= 0");
  });

  it("caps exponential backoff at 30s", async () => {
    // With delayMs=10000 and exponential, attempt 3 would be 10000*4=40000
    // But should be capped at 30000
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn, ms) => {
      if (ms && ms > 0) {
        delays.push(ms as number);
      }

      return originalSetTimeout(fn as () => void, 1);
    });

    let attempts = 0;
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        slowRetry: {
          run: async () => {
            attempts++;
            if (attempts < 4) {
              throw new Error("fail");
            }

            return "ok";
          },
          retry: { attempts: 4, backoff: "exponential", delayMs: 10000 },
          label: "Slow Retry",
        },
      },
    });

    await orchestrator.run("slowRetry", "x");

    vi.restoreAllMocks();

    // delay 1: 10000, delay 2: 20000, delay 3: min(40000, 30000)=30000
    expect(delays).toContain(30000);
    expect(delays.every((d) => d <= 30000)).toBe(true);
  });
});

// ============================================================================
// Timeout and abort
// ============================================================================

describe("tasks: timeout and abort", () => {
  it("task timeout aborts execution", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        slow: {
          run: async (_input, signal) => {
            return new Promise((_resolve, reject) => {
              const timer = setTimeout(() => _resolve("done"), 5000);
              signal.addEventListener(
                "abort",
                () => {
                  clearTimeout(timer);
                  reject(new Error("aborted"));
                },
                { once: true },
              );
            });
          },
          timeout: 10,
          label: "Slow",
        },
      },
    });

    await expect(orchestrator.run("slow", "x")).rejects.toThrow("aborted");
  });

  it("external abort signal cancels task", async () => {
    const controller = new AbortController();

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        cancelable: {
          run: async (_input, signal) => {
            return new Promise((_resolve, reject) => {
              const timer = setTimeout(() => _resolve("done"), 5000);
              signal.addEventListener(
                "abort",
                () => {
                  clearTimeout(timer);
                  reject(new Error("cancelled"));
                },
                { once: true },
              );
            });
          },
          label: "Cancelable",
        },
      },
    });

    controller.abort();

    await expect(
      orchestrator.run("cancelable", "x", { signal: controller.signal }),
    ).rejects.toThrow("aborted before starting");
  });
});

// ============================================================================
// Semaphore concurrency
// ============================================================================

describe("tasks: semaphore concurrency", () => {
  it("maxConcurrent limits parallel executions", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        limited: {
          run: async () => {
            concurrent++;
            maxConcurrent = Math.max(maxConcurrent, concurrent);
            await new Promise((r) => setTimeout(r, 20));
            concurrent--;

            return "ok";
          },
          maxConcurrent: 1,
          label: "Limited",
        },
      },
    });

    // Run 3 in parallel
    await Promise.all([
      orchestrator.run("limited", "1"),
      orchestrator.run("limited", "2"),
      orchestrator.run("limited", "3"),
    ]);

    expect(maxConcurrent).toBe(1);
  });
});

// ============================================================================
// Registration lifecycle
// ============================================================================

describe("tasks: registration lifecycle", () => {
  it("registerTask adds a task dynamically", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {},
    });

    orchestrator.registerTask("dynamic", {
      run: async () => "dynamic result",
      label: "Dynamic",
    });

    expect(orchestrator.getTaskIds()).toContain("dynamic");

    const result = await orchestrator.run("dynamic", "x");

    expect(result.output).toBe("dynamic result");
  });

  it("unregisterTask removes a task", () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        removable: { run: async () => "ok", label: "Removable" },
      },
    });

    expect(orchestrator.getTaskIds()).toContain("removable");
    orchestrator.unregisterTask("removable");
    expect(orchestrator.getTaskIds()).not.toContain("removable");
  });

  it("cannot register task with existing agent ID", () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        conflict: { agent: { name: "conflict" } },
      },
      mockResponses: {
        conflict: { output: "ok", totalTokens: 0 },
      },
      tasks: {},
    });

    expect(() =>
      orchestrator.registerTask("conflict", { run: async () => "ok" }),
    ).toThrow("already registered as an agent");
  });

  it("cannot register duplicate task ID", () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        existing: { run: async () => "ok", label: "Existing" },
      },
    });

    expect(() =>
      orchestrator.registerTask("existing", { run: async () => "ok" }),
    ).toThrow("already registered");
  });

  it("cannot unregister a running task", async () => {
    let resolveTask: (() => void) | undefined;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        longRunning: {
          run: async () => {
            await new Promise<void>((r) => {
              resolveTask = r;
            });

            return "ok";
          },
          label: "Long Running",
        },
      },
    });

    const runPromise = orchestrator.run("longRunning", "x");

    // Give it a tick to start
    await new Promise((r) => setTimeout(r, 10));

    expect(() => orchestrator.unregisterTask("longRunning")).toThrow(
      "while it is running",
    );

    resolveTask?.();
    await runPromise;
  });

  it("rejects reserved task IDs", () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {},
    });

    expect(() =>
      orchestrator.registerTask("__coord", {
        run: async () => "ok",
        label: "Bad",
      }),
    ).toThrow("reserved");
  });

  it("rejects empty task ID on registerTask", () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {},
    });

    expect(() =>
      orchestrator.registerTask("", { run: async () => "ok" }),
    ).toThrow("non-empty trimmed string");
  });

  it("rejects task ID with leading/trailing whitespace", () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {},
    });

    expect(() =>
      orchestrator.registerTask(" spaces ", { run: async () => "ok" }),
    ).toThrow("non-empty trimmed string");
  });

  it("validates timeout must be finite > 0", () => {
    expect(() =>
      createTestMultiAgentOrchestrator({
        agents: {},
        mockResponses: {},
        tasks: {
          bad: { run: async () => "ok", timeout: -1, label: "Bad" },
        },
      }),
    ).toThrow("timeout must be a finite number > 0");

    expect(() =>
      createTestMultiAgentOrchestrator({
        agents: {},
        mockResponses: {},
        tasks: {
          bad: { run: async () => "ok", timeout: Number.NaN, label: "Bad" },
        },
      }),
    ).toThrow("timeout must be a finite number > 0");
  });

  it("validates maxConcurrent must be finite integer >= 1", () => {
    expect(() =>
      createTestMultiAgentOrchestrator({
        agents: {},
        mockResponses: {},
        tasks: {
          bad: { run: async () => "ok", maxConcurrent: 0.5, label: "Bad" },
        },
      }),
    ).toThrow("maxConcurrent must be a finite integer >= 1");

    expect(() =>
      createTestMultiAgentOrchestrator({
        agents: {},
        mockResponses: {},
        tasks: {
          bad: {
            run: async () => "ok",
            maxConcurrent: Number.NaN,
            label: "Bad",
          },
        },
      }),
    ).toThrow("maxConcurrent must be a finite integer >= 1");
  });

  it("validates timeout/maxConcurrent on registerTask", () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {},
    });

    expect(() =>
      orchestrator.registerTask("bad1", { run: async () => "ok", timeout: -5 }),
    ).toThrow("timeout must be a finite number > 0");

    expect(() =>
      orchestrator.registerTask("bad2", {
        run: async () => "ok",
        maxConcurrent: 0,
      }),
    ).toThrow("maxConcurrent must be a finite integer >= 1");
  });

  it("validates task ID format at init time", () => {
    expect(() =>
      createTestMultiAgentOrchestrator({
        agents: {},
        mockResponses: {},
        tasks: {
          " spacey ": { run: async () => "ok", label: "Bad" },
        },
      }),
    ).toThrow("non-empty trimmed string");
  });
});

// ============================================================================
// Task state tracking
// ============================================================================

describe("tasks: state tracking", () => {
  it("getTaskState returns frozen copy", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        t: { run: async () => "result", label: "T" },
      },
    });

    await orchestrator.run("t", "x");

    const state = orchestrator.getTaskState("t");

    expect(state).toBeDefined();
    expect(state!.status).toBe("completed");
    expect(state!.lastOutput).toBe("result");
    expect(Object.isFrozen(state)).toBe(true);
  });

  it("getAllTaskStates returns frozen copies", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        a: { run: async () => "a-out", label: "A" },
        b: { run: async () => "b-out", label: "B" },
      },
    });

    await orchestrator.run("a", "x");
    await orchestrator.run("b", "y");

    const states = orchestrator.getAllTaskStates();

    expect(states.a!.status).toBe("completed");
    expect(states.b!.status).toBe("completed");
    expect(Object.isFrozen(states.a)).toBe(true);
    expect(Object.isFrozen(states.b)).toBe(true);
  });

  it("getNodeIds includes both agents and tasks", () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        agent1: { agent: { name: "agent1" } },
      },
      mockResponses: {
        agent1: { output: "ok", totalTokens: 0 },
      },
      tasks: {
        task1: { run: async () => "ok", label: "T1" },
      },
    });

    const ids = orchestrator.getNodeIds();

    expect(ids).toContain("agent1");
    expect(ids).toContain("task1");
  });

  it("task error updates state correctly", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        failing: {
          run: async () => {
            throw new Error("task failed");
          },
          label: "Failing",
        },
      },
    });

    await expect(orchestrator.run("failing", "x")).rejects.toThrow(
      "task failed",
    );

    const state = orchestrator.getTaskState("failing");

    expect(state!.status).toBe("error");
    expect(state!.lastError).toBe("task failed");
  });
});

// ============================================================================
// Timeline events
// ============================================================================

describe("tasks: timeline events", () => {
  it("emits task_start and task_complete events", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        t: {
          run: async () => "ok",
          label: "My Task",
          description: "A test task",
        },
      },
      debug: true,
    });

    await orchestrator.run("t", "hello");

    const events = orchestrator.timeline!.getEvents();
    const startEvents = events.filter((e) => e.type === "task_start");
    const completeEvents = events.filter((e) => e.type === "task_complete");

    expect(startEvents).toHaveLength(1);
    expect(startEvents[0]).toMatchObject({
      type: "task_start",
      taskId: "t",
      label: "My Task",
      description: "A test task",
      inputLength: 5,
    });

    expect(completeEvents).toHaveLength(1);
    expect(completeEvents[0]).toMatchObject({
      type: "task_complete",
      taskId: "t",
      label: "My Task",
    });
  });

  it("emits task_error on failure", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        t: {
          run: async () => {
            throw new Error("boom");
          },
          label: "Boom",
        },
      },
      debug: true,
    });

    await expect(orchestrator.run("t", "x")).rejects.toThrow("boom");

    const events = orchestrator.timeline!.getEvents();
    const errorEvents = events.filter((e) => e.type === "task_error");

    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]).toMatchObject({
      type: "task_error",
      taskId: "t",
      label: "Boom",
      error: "boom",
    });
  });
});

// ============================================================================
// Lifecycle hooks
// ============================================================================

describe("tasks: lifecycle hooks", () => {
  it("fires onTaskStart, onTaskComplete hooks", async () => {
    const hookEvents: Array<{ hook: string; taskId: string }> = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        t: { run: async () => "ok", label: "T" },
      },
      hooks: {
        onTaskStart: (e) =>
          hookEvents.push({ hook: "start", taskId: e.taskId }),
        onTaskComplete: (e) =>
          hookEvents.push({ hook: "complete", taskId: e.taskId }),
      },
    });

    await orchestrator.run("t", "x");

    expect(hookEvents).toEqual([
      { hook: "start", taskId: "t" },
      { hook: "complete", taskId: "t" },
    ]);
  });

  it("fires onTaskError hook on failure", async () => {
    const errors: Array<{ taskId: string; error: string }> = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        t: {
          run: async () => {
            throw new Error("task error");
          },
          label: "T",
        },
      },
      hooks: {
        onTaskError: (e) =>
          errors.push({ taskId: e.taskId, error: e.error.message }),
      },
    });

    await expect(orchestrator.run("t", "x")).rejects.toThrow();

    expect(errors).toEqual([{ taskId: "t", error: "task error" }]);
  });

  it("fires onTaskProgress hook from reportProgress", async () => {
    const progressEvents: Array<{
      taskId: string;
      percent: number;
      message?: string;
    }> = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        t: {
          run: async (_input, _signal, context) => {
            context.reportProgress(50, "halfway");

            return "ok";
          },
          label: "T",
        },
      },
      hooks: {
        onTaskProgress: (e) =>
          progressEvents.push({
            taskId: e.taskId,
            percent: e.percent,
            message: e.message,
          }),
      },
    });

    await orchestrator.run("t", "x");

    expect(progressEvents).toEqual([
      { taskId: "t", percent: 50, message: "halfway" },
    ]);
  });

  it("hooks receive patternId when run via pattern", async () => {
    const hookPatternIds: string[] = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        t: { run: async () => "ok", label: "T" },
      },
      patterns: {
        myPipeline: dag({
          step: { handler: "t" },
        }),
      },
      hooks: {
        onTaskStart: (e) => hookPatternIds.push(e.patternId),
        onTaskComplete: (e) => hookPatternIds.push(e.patternId),
      },
    });

    await orchestrator.runPattern("myPipeline", "go");

    // Both hooks should receive the pattern ID
    expect(hookPatternIds.every((id) => id === "myPipeline")).toBe(true);
    expect(hookPatternIds).toHaveLength(2);
  });
});

// ============================================================================
// Pause/idle
// ============================================================================

describe("tasks: pause and waitForIdle", () => {
  it("paused orchestrator rejects task execution", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        t: { run: async () => "ok", label: "T" },
      },
    });

    orchestrator.pause();

    await expect(orchestrator.run("t", "x")).rejects.toThrow("paused");
  });
});

// ============================================================================
// createMockTask helper
// ============================================================================

describe("createMockTask", () => {
  it("creates a basic mock task", async () => {
    const task = createMockTask("mock output");
    const result = await task.run(
      "input",
      new AbortController().signal,
      {} as TaskContext,
    );

    expect(result).toBe("mock output");
    expect(task.label).toBe("Mock Task");
  });

  it("creates a mock task with delay", async () => {
    const task = createMockTask("delayed output", { delay: 10 });
    const start = Date.now();
    await task.run("input", new AbortController().signal, {} as TaskContext);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(5);
  });

  it("creates a mock task that errors", async () => {
    const task = createMockTask("ignored", { shouldError: true });

    await expect(
      task.run("input", new AbortController().signal, {} as TaskContext),
    ).rejects.toThrow("Mock task error");
  });

  it("mock task respects abort signal", async () => {
    const task = createMockTask("output", { delay: 5000 });
    const controller = new AbortController();
    controller.abort();

    await expect(
      task.run("input", controller.signal, {} as TaskContext),
    ).rejects.toThrow("Task aborted");
  });

  it("custom label and description", () => {
    const task = createMockTask("output", {
      label: "Custom",
      description: "A custom task",
    });

    expect(task.label).toBe("Custom");
    expect(task.description).toBe("A custom task");
  });
});

// ============================================================================
// Streaming
// ============================================================================

describe("tasks: streaming", () => {
  it("streamed task tracks pendingRuns (waitForIdle)", async () => {
    let resolveTask: (() => void) | undefined;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        slow: {
          run: async () => {
            await new Promise<void>((r) => {
              resolveTask = r;
            });

            return "stream result";
          },
          label: "Slow",
        },
      },
    });

    const { result } = orchestrator.runStream("slow", "x");

    // waitForIdle should not resolve yet since task is running
    let idleResolved = false;
    const idlePromise = orchestrator.waitForIdle(100).then(() => {
      idleResolved = true;
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(idleResolved).toBe(false);

    // Complete the task
    resolveTask?.();
    await result;
    await idlePromise;

    expect(idleResolved).toBe(true);
  });
});

// ============================================================================
// Checkpoint
// ============================================================================

describe("tasks: checkpoint", () => {
  it("checkpoint rejects while task is running", async () => {
    let resolveTask: (() => void) | undefined;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {},
      mockResponses: {},
      tasks: {
        blocking: {
          run: async () => {
            await new Promise<void>((r) => {
              resolveTask = r;
            });

            return "ok";
          },
          label: "Blocking",
        },
      },
      debug: true,
    });

    const runPromise = orchestrator.run("blocking", "x");

    await new Promise((r) => setTimeout(r, 10));

    await expect(orchestrator.checkpoint()).rejects.toThrow(
      'Cannot checkpoint while task "blocking" is running',
    );

    resolveTask?.();
    await runPromise;
  });
});

// ============================================================================
// Self-healing exclusion
// ============================================================================

describe("tasks: self-healing exclusion", () => {
  it("task failures bypass self-healing degradation", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        backup: { agent: { name: "backup" } },
      },
      mockResponses: {
        backup: { output: "backup result", totalTokens: 0 },
      },
      tasks: {
        failingTask: {
          run: async () => {
            throw new Error("task failure");
          },
          label: "Failing Task",
        },
      },
      selfHealing: {
        degradation: "fallback-response",
        fallbackResponse: "fallback",
      },
    });

    // Task failure should NOT be caught by self-healing — should propagate directly
    await expect(orchestrator.run("failingTask", "x")).rejects.toThrow(
      "task failure",
    );
  });
});

// ============================================================================
// readAgentState frozen
// ============================================================================

describe("tasks: readAgentState immutability", () => {
  it("readAgentState returns frozen objects", async () => {
    let readState: ReturnType<TaskContext["readAgentState"]>;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        agent1: { agent: { name: "agent1" } },
      },
      mockResponses: {
        agent1: { output: "done", totalTokens: 10 },
      },
      tasks: {
        checker: {
          run: async (_input, _signal, context) => {
            readState = context.readAgentState("agent1");

            return "ok";
          },
          label: "Checker",
        },
      },
      patterns: {
        pipe: dag({
          a: { handler: "agent1" },
          b: { handler: "checker", deps: ["a"] },
        }),
      },
    });

    await orchestrator.runPattern("pipe", "go");

    expect(readState).toBeDefined();
    expect(Object.isFrozen(readState)).toBe(true);
  });
});
