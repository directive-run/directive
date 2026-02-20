import { describe, it, expect } from "vitest";
import { withReflection, ReflectionExhaustedError } from "../reflection.js";
import { createMockAgentRunner } from "../testing.js";
import type { AgentLike } from "../types.js";

// ============================================================================
// Helper: simple mock runner
// ============================================================================

function makeRunner(responses: string[]) {
  let callIndex = 0;

  return createMockAgentRunner({
    defaultResponse: {
      output: "default",
      totalTokens: 10,
    },
    responses: {
      agent: {
        output: "dynamic",
        totalTokens: 10,
        generate: () => {
          const output = responses[callIndex] ?? responses[responses.length - 1];
          callIndex++;

          return { output, totalTokens: 10 };
        },
      },
    },
  });
}

const agent: AgentLike = { name: "agent" };

// ============================================================================
// Tests
// ============================================================================

describe("withReflection", () => {
  it("passes on first iteration (no retry)", async () => {
    const mock = makeRunner(["great output"]);

    const reflective = withReflection(mock.run, {
      evaluate: () => ({ passed: true, score: 1 }),
    });

    const result = await reflective(agent, "write something");

    expect(result.output).toBe("great output");
    expect(result.totalTokens).toBe(10);
    expect(mock.getCalls()).toHaveLength(1);
  });

  it("retries and passes on second iteration", async () => {
    const mock = makeRunner(["bad output", "good output"]);
    let evalCount = 0;

    const reflective = withReflection(mock.run, {
      evaluate: () => {
        evalCount++;

        return evalCount >= 2
          ? { passed: true, score: 1 }
          : { passed: false, feedback: "Needs improvement", score: 0.3 };
      },
      maxIterations: 3,
    });

    const result = await reflective(agent, "write something");

    expect(result.output).toBe("good output");
    expect(result.totalTokens).toBe(20); // 10 + 10
    expect(mock.getCalls()).toHaveLength(2);
  });

  it("returns last result when exhausted with accept-last", async () => {
    const mock = makeRunner(["attempt1", "attempt2"]);

    const reflective = withReflection(mock.run, {
      evaluate: () => ({ passed: false, feedback: "Still bad", score: 0.2 }),
      maxIterations: 2,
      onExhausted: "accept-last",
    });

    const result = await reflective(agent, "write something");

    expect(result.output).toBe("attempt2");
    expect(result.totalTokens).toBe(20);
  });

  it("throws ReflectionExhaustedError when exhausted with throw", async () => {
    const mock = makeRunner(["bad1", "bad2"]);

    const reflective = withReflection(mock.run, {
      evaluate: () => ({ passed: false, feedback: "Not good enough", score: 0.1 }),
      maxIterations: 2,
      onExhausted: "throw",
    });

    await expect(reflective(agent, "write something")).rejects.toThrow(
      ReflectionExhaustedError,
    );

    try {
      await reflective(agent, "write something");
    } catch (error) {
      const err = error as ReflectionExhaustedError;
      expect(err.iterations).toBe(2);
      expect(err.history).toHaveLength(2);
      expect(err.history[0]!.feedback).toBe("Not good enough");
      expect(err.totalTokens).toBe(20);
    }
  });

  it("uses custom buildRetryInput", async () => {
    const inputs: string[] = [];
    const mock = createMockAgentRunner({
      responses: {
        agent: {
          output: "ok",
          totalTokens: 5,
          generate: (input) => {
            inputs.push(input);

            return { output: inputs.length >= 2 ? "good" : "bad", totalTokens: 5 };
          },
        },
      },
    });

    let evalCount = 0;
    const reflective = withReflection(mock.run, {
      evaluate: () => {
        evalCount++;

        return evalCount >= 2
          ? { passed: true }
          : { passed: false, feedback: "Do better" };
      },
      maxIterations: 3,
      buildRetryInput: (original, feedback, iteration) =>
        `[retry ${iteration}] ${original} | feedback: ${feedback}`,
    });

    await reflective(agent, "original input");

    expect(inputs[0]).toBe("original input");
    expect(inputs[1]).toContain("[retry 0]");
    expect(inputs[1]).toContain("original input");
    expect(inputs[1]).toContain("Do better");
  });

  it("fires onIteration callback correctly", async () => {
    const mock = makeRunner(["try1", "try2"]);
    const iterations: Array<{ iteration: number; passed: boolean; feedback?: string }> = [];
    let evalCount = 0;

    const reflective = withReflection(mock.run, {
      evaluate: () => {
        evalCount++;

        return evalCount >= 2
          ? { passed: true, score: 0.9 }
          : { passed: false, feedback: "Improve", score: 0.4 };
      },
      maxIterations: 3,
      onIteration: (event) => {
        iterations.push({
          iteration: event.iteration,
          passed: event.passed,
          feedback: event.feedback,
        });
      },
    });

    await reflective(agent, "input");

    expect(iterations).toHaveLength(2);
    expect(iterations[0]).toEqual(expect.objectContaining({
      iteration: 0,
      passed: false,
      feedback: "Improve",
    }));
    expect(iterations[1]).toEqual(expect.objectContaining({
      iteration: 1,
      passed: true,
    }));
  });

  it("propagates score and feedback in evaluation", async () => {
    const mock = makeRunner(["output"]);
    let capturedScore: number | undefined;

    const reflective = withReflection(mock.run, {
      evaluate: () => ({ passed: true, feedback: "Great job", score: 0.95 }),
      onIteration: (event) => {
        capturedScore = event.score;
      },
    });

    await reflective(agent, "input");

    expect(capturedScore).toBe(0.95);
  });

  it("validates maxIterations < 1", () => {
    const mock = makeRunner(["output"]);

    expect(() =>
      withReflection(mock.run, {
        evaluate: () => ({ passed: true }),
        maxIterations: 0,
      }),
    ).toThrow("[Directive Reflection] maxIterations must be >= 1");
  });

  it("accumulates history across iterations", async () => {
    const mock = makeRunner(["a", "b", "c"]);
    let evalCount = 0;

    const reflective = withReflection(mock.run, {
      evaluate: (_output, context) => {
        evalCount++;
        // Context should contain history from previous iterations
        expect(context.history).toHaveLength(evalCount - 1);

        return evalCount >= 3
          ? { passed: true }
          : { passed: false, feedback: `Feedback ${evalCount}` };
      },
      maxIterations: 3,
    });

    await reflective(agent, "input");

    expect(evalCount).toBe(3);
  });

  it("accumulates token usage in final result", async () => {
    const mock = makeRunner(["a", "b", "c"]);
    let evalCount = 0;

    const reflective = withReflection(mock.run, {
      evaluate: () => {
        evalCount++;

        return evalCount >= 3
          ? { passed: true }
          : { passed: false, feedback: "more" };
      },
      maxIterations: 3,
    });

    const result = await reflective(agent, "input");

    // 3 iterations × 10 tokens each
    expect(result.totalTokens).toBe(30);
  });

  it("supports async evaluator", async () => {
    const mock = makeRunner(["output"]);

    const reflective = withReflection(mock.run, {
      evaluate: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));

        return { passed: true, score: 1 };
      },
    });

    const result = await reflective(agent, "input");

    expect(result.output).toBe("output");
  });
});
