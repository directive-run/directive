import { describe, it, expect } from "vitest";
import {
  createTestMultiAgentOrchestrator,
} from "../testing.js";
import { reflect } from "../multi-agent-orchestrator.js";
import type { ReflectPattern, ReflectIterationRecord } from "../multi-agent-orchestrator.js";

// ============================================================================
// Tests
// ============================================================================

describe("reflect pattern (multi-agent)", () => {
  it("evaluator approves on first pass", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        producer: { agent: { name: "producer" } },
        evaluator: { agent: { name: "evaluator" } },
      },
      mockResponses: {
        producer: { output: "great essay", totalTokens: 50 },
        evaluator: {
          output: JSON.stringify({ passed: true, score: 1 }),
          totalTokens: 10,
        },
      },
      patterns: {
        review: reflect("producer", "evaluator"),
      },
    });

    const result = await orchestrator.runPattern<string>("review", "Write an essay");

    expect(result).toBe("great essay");
  });

  it("evaluator rejects, producer retries with feedback", async () => {
    let producerCallCount = 0;
    let evaluatorCallCount = 0;
    const producerInputs: string[] = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        producer: { agent: { name: "producer" } },
        evaluator: { agent: { name: "evaluator" } },
      },
      mockResponses: {
        producer: {
          output: "dynamic",
          totalTokens: 20,
          generate: (input) => {
            producerCallCount++;
            producerInputs.push(input);

            return {
              output: producerCallCount >= 2 ? "improved essay" : "draft essay",
              totalTokens: 20,
            };
          },
        },
        evaluator: {
          output: "dynamic",
          totalTokens: 5,
          generate: () => {
            evaluatorCallCount++;

            return {
              output: evaluatorCallCount >= 2
                ? JSON.stringify({ passed: true, score: 0.9 })
                : JSON.stringify({ passed: false, feedback: "Needs more detail", score: 0.4 }),
              totalTokens: 5,
            };
          },
        },
      },
      patterns: {
        review: reflect("producer", "evaluator", { maxIterations: 3 }),
      },
    });

    const result = await orchestrator.runPattern<string>("review", "Write an essay");

    expect(result).toBe("improved essay");
    expect(producerCallCount).toBe(2);
    expect(evaluatorCallCount).toBe(2);
    // Second producer input should contain feedback
    expect(producerInputs[1]).toContain("Needs more detail");
  });

  it("maxIterations exhausted returns last result (accept-last)", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        producer: { agent: { name: "producer" } },
        evaluator: { agent: { name: "evaluator" } },
      },
      mockResponses: {
        producer: { output: "best effort", totalTokens: 15 },
        evaluator: {
          output: JSON.stringify({ passed: false, feedback: "Not good enough" }),
          totalTokens: 5,
        },
      },
      patterns: {
        review: reflect("producer", "evaluator", {
          maxIterations: 2,
          onExhausted: "accept-last",
        }),
      },
    });

    const result = await orchestrator.runPattern<string>("review", "Write an essay");

    expect(result).toBe("best effort");
  });

  it("maxIterations exhausted with throw", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        producer: { agent: { name: "producer" } },
        evaluator: { agent: { name: "evaluator" } },
      },
      mockResponses: {
        producer: { output: "bad essay", totalTokens: 15 },
        evaluator: {
          output: JSON.stringify({ passed: false, feedback: "Terrible" }),
          totalTokens: 5,
        },
      },
      patterns: {
        review: reflect("producer", "evaluator", {
          maxIterations: 2,
          onExhausted: "throw",
        }),
      },
    });

    await expect(
      orchestrator.runPattern("review", "Write an essay"),
    ).rejects.toThrow("Exhausted");
  });

  it("custom parseEvaluation", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        producer: { agent: { name: "producer" } },
        evaluator: { agent: { name: "evaluator" } },
      },
      mockResponses: {
        producer: { output: "my output", totalTokens: 10 },
        evaluator: { output: "APPROVED", totalTokens: 5 },
      },
      patterns: {
        review: {
          type: "reflect" as const,
          agent: "producer",
          evaluator: "evaluator",
          parseEvaluation: (output: unknown) => ({
            passed: output === "APPROVED",
            feedback: output === "APPROVED" ? undefined : String(output),
          }),
        } satisfies ReflectPattern,
      },
    });

    const result = await orchestrator.runPattern<string>("review", "Do it");

    expect(result).toBe("my output");
  });

  it("lifecycle hooks fire", async () => {
    const hookEvents: Array<{ patternType: string }> = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        producer: { agent: { name: "producer" } },
        evaluator: { agent: { name: "evaluator" } },
      },
      mockResponses: {
        producer: { output: "output", totalTokens: 10 },
        evaluator: {
          output: JSON.stringify({ passed: true }),
          totalTokens: 5,
        },
      },
      patterns: {
        review: reflect("producer", "evaluator"),
      },
      hooks: {
        onPatternStart: (event) => hookEvents.push({ patternType: event.patternType }),
        onPatternComplete: (event) => hookEvents.push({ patternType: event.patternType }),
      },
    });

    await orchestrator.runPattern("review", "input");

    expect(hookEvents).toEqual([
      { patternType: "reflect" },
      { patternType: "reflect" },
    ]);
  });

  it("timeline events recorded", async () => {
    let evaluatorCallCount = 0;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        producer: { agent: { name: "producer" } },
        evaluator: { agent: { name: "evaluator" } },
      },
      mockResponses: {
        producer: { output: "output", totalTokens: 10 },
        evaluator: {
          output: "dynamic",
          totalTokens: 5,
          generate: () => {
            evaluatorCallCount++;

            return {
              output: evaluatorCallCount >= 2
                ? JSON.stringify({ passed: true, score: 0.9 })
                : JSON.stringify({ passed: false, feedback: "Improve", score: 0.3 }),
              totalTokens: 5,
            };
          },
        },
      },
      patterns: {
        review: reflect("producer", "evaluator", { maxIterations: 3 }),
      },
      debug: true,
    });

    await orchestrator.runPattern("review", "input");

    const events = orchestrator.timeline!.getEvents();
    const reflectionEvents = events.filter((e) => e.type === "reflection_iteration");

    expect(reflectionEvents.length).toBeGreaterThanOrEqual(2);
    expect(reflectionEvents[0]).toMatchObject({
      type: "reflection_iteration",
      iteration: 0,
      passed: false,
    });
    expect(reflectionEvents[1]).toMatchObject({
      type: "reflection_iteration",
      iteration: 1,
      passed: true,
    });
  });

  it("both agents receive correct inputs", async () => {
    const producerInputs: string[] = [];
    const evaluatorInputs: string[] = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        producer: { agent: { name: "producer" } },
        evaluator: { agent: { name: "evaluator" } },
      },
      mockResponses: {
        producer: {
          output: "my essay content",
          totalTokens: 10,
          generate: (input) => {
            producerInputs.push(input);

            return { output: "my essay content", totalTokens: 10 };
          },
        },
        evaluator: {
          output: JSON.stringify({ passed: true }),
          totalTokens: 5,
          generate: (input) => {
            evaluatorInputs.push(input);

            return {
              output: JSON.stringify({ passed: true }),
              totalTokens: 5,
            };
          },
        },
      },
      patterns: {
        review: reflect("producer", "evaluator"),
      },
    });

    await orchestrator.runPattern("review", "Write an essay about AI");

    expect(producerInputs[0]).toBe("Write an essay about AI");
    expect(evaluatorInputs[0]).toBe("my essay content");
  });

  // ---- Reflection history tests ----

  it("getLastReflectionHistory returns iteration records after reflect pattern", async () => {
    let evaluatorCallCount = 0;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        producer: { agent: { name: "producer" } },
        evaluator: { agent: { name: "evaluator" } },
      },
      mockResponses: {
        producer: { output: "essay", totalTokens: 20 },
        evaluator: {
          output: "dynamic",
          totalTokens: 8,
          generate: () => {
            evaluatorCallCount++;

            return {
              output: evaluatorCallCount >= 2
                ? JSON.stringify({ passed: true, score: 0.95 })
                : JSON.stringify({ passed: false, feedback: "Add examples", score: 0.4 }),
              totalTokens: 8,
            };
          },
        },
      },
      patterns: {
        review: reflect("producer", "evaluator", { maxIterations: 3 }),
      },
    });

    await orchestrator.runPattern("review", "Write something");

    const history = orchestrator.getLastReflectionHistory();
    expect(history).not.toBeNull();
    expect(history).toHaveLength(2);

    expect(history![0]).toMatchObject({
      iteration: 0,
      passed: false,
      score: 0.4,
      feedback: "Add examples",
    });
    expect(history![0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(history![0]!.producerTokens).toBe(20);
    expect(history![0]!.evaluatorTokens).toBe(8);

    expect(history![1]).toMatchObject({
      iteration: 1,
      passed: true,
      score: 0.95,
    });
  });

  it("onIteration callback fires per iteration with correct data", async () => {
    let evaluatorCallCount = 0;
    const records: ReflectIterationRecord[] = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        producer: { agent: { name: "producer" } },
        evaluator: { agent: { name: "evaluator" } },
      },
      mockResponses: {
        producer: { output: "output", totalTokens: 15 },
        evaluator: {
          output: "dynamic",
          totalTokens: 5,
          generate: () => {
            evaluatorCallCount++;

            return {
              output: evaluatorCallCount >= 2
                ? JSON.stringify({ passed: true, score: 0.8 })
                : JSON.stringify({ passed: false, feedback: "Try harder", score: 0.3 }),
              totalTokens: 5,
            };
          },
        },
      },
      patterns: {
        review: reflect("producer", "evaluator", {
          maxIterations: 3,
          onIteration: (record) => records.push(record),
        }),
      },
    });

    await orchestrator.runPattern("review", "Go");

    expect(records).toHaveLength(2);
    expect(records[0]!.iteration).toBe(0);
    expect(records[0]!.passed).toBe(false);
    expect(records[0]!.feedback).toBe("Try harder");
    expect(records[1]!.iteration).toBe(1);
    expect(records[1]!.passed).toBe(true);
  });

  it("history cleared/overwritten on next reflect run", async () => {
    let run = 0;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        producer: { agent: { name: "producer" } },
        evaluator: { agent: { name: "evaluator" } },
      },
      mockResponses: {
        producer: { output: "output", totalTokens: 10 },
        evaluator: {
          output: "dynamic",
          totalTokens: 5,
          generate: () => {
            run++;

            return {
              output: JSON.stringify({ passed: true, score: run === 1 ? 0.5 : 0.9 }),
              totalTokens: 5,
            };
          },
        },
      },
      patterns: {
        review: reflect("producer", "evaluator"),
      },
    });

    await orchestrator.runPattern("review", "First");
    const firstHistory = orchestrator.getLastReflectionHistory();
    expect(firstHistory).toHaveLength(1);
    expect(firstHistory![0]!.score).toBe(0.5);

    await orchestrator.runPattern("review", "Second");
    const secondHistory = orchestrator.getLastReflectionHistory();
    expect(secondHistory).toHaveLength(1);
    expect(secondHistory![0]!.score).toBe(0.9);
  });

  // ---- AbortSignal tests ----

  it("AbortSignal cancels reflect loop mid-iteration", async () => {
    const controller = new AbortController();
    let producerCallCount = 0;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        producer: { agent: { name: "producer" } },
        evaluator: { agent: { name: "evaluator" } },
      },
      mockResponses: {
        producer: {
          output: "dynamic",
          totalTokens: 10,
          generate: () => {
            producerCallCount++;
            if (producerCallCount === 2) {
              // Abort during second iteration
              controller.abort();
            }

            return { output: `attempt-${producerCallCount}`, totalTokens: 10 };
          },
        },
        evaluator: {
          output: JSON.stringify({ passed: false, feedback: "Keep going" }),
          totalTokens: 5,
        },
      },
      patterns: {
        review: reflect("producer", "evaluator", {
          maxIterations: 5,
          signal: controller.signal,
        }),
      },
    });

    // Should return last producer result since signal was aborted after producer ran
    await orchestrator.runPattern<string>("review", "Go");

    // The abort happens after the second producer call, so it should return that result
    expect(producerCallCount).toBeLessThanOrEqual(3);
  });

  it("aborted reflect returns last producer result when available", async () => {
    const controller = new AbortController();

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        producer: { agent: { name: "producer" } },
        evaluator: { agent: { name: "evaluator" } },
      },
      mockResponses: {
        producer: { output: "good output", totalTokens: 10 },
        evaluator: {
          output: JSON.stringify({ passed: false, feedback: "Nope" }),
          totalTokens: 5,
        },
      },
      patterns: {
        review: reflect("producer", "evaluator", {
          maxIterations: 5,
          signal: controller.signal,
        }),
      },
    });

    // Abort after first iteration completes
    setTimeout(() => controller.abort(), 50);
    const result = await orchestrator.runPattern<string>("review", "Go");

    // Should return the producer output since it was available when aborted
    expect(result).toBe("good output");
  });
});
