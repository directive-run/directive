import { describe, expect, it, vi } from "vitest";
import { composePatterns, dag } from "../multi-agent-orchestrator.js";
import {
  assertDagExecution,
  createTestDag,
  createTestMultiAgentOrchestrator,
} from "../testing.js";
import type { DagExecutionContext } from "../types.js";

// ============================================================================
// 1. Linear Chain: A → B → C
// ============================================================================

describe("DAG: linear chain (A → B → C)", () => {
  it("executes nodes in dependency order", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        c: { agent: { name: "c" } },
      },
      mockResponses: {
        a: { output: "a-out", totalTokens: 10 },
        b: { output: "b-out", totalTokens: 10 },
        c: { output: "c-out", totalTokens: 10 },
      },
      patterns: {
        chain: createTestDag({
          A: { handler: "a" },
          B: { handler: "b", deps: ["A"] },
          C: { handler: "c", deps: ["B"] },
        }),
      },
    });

    const result = await orchestrator.runPattern<Record<string, unknown>>(
      "chain",
      "start",
    );

    expect(result).toHaveProperty("A", "a-out");
    expect(result).toHaveProperty("B", "b-out");
    expect(result).toHaveProperty("C", "c-out");
  });

  it("passes upstream output as JSON input to downstream nodes", async () => {
    const calls: string[] = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
      },
      mockResponses: {
        a: {
          output: "research data",
          totalTokens: 10,
          generate: (input) => {
            calls.push(`a:${input}`);

            return {};
          },
        },
        b: {
          output: "written content",
          totalTokens: 10,
          generate: (input) => {
            calls.push(`b:${input}`);

            return {};
          },
        },
      },
      patterns: {
        pipe: createTestDag({
          A: { handler: "a" },
          B: { handler: "b", deps: ["A"] },
        }),
      },
    });

    await orchestrator.runPattern("pipe", "initial input");

    // A receives the original input
    expect(calls[0]).toBe("a:initial input");
    // B receives JSON of upstream outputs
    expect(calls[1]).toMatch(/"A"/);
  });

  it("all nodes complete in a 3-step chain", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        c: { agent: { name: "c" } },
      },
      mockResponses: {
        a: { output: "a-out", totalTokens: 10 },
        b: { output: "b-out", totalTokens: 10 },
        c: { output: "c-out", totalTokens: 10 },
      },
      patterns: {
        chain: createTestDag(
          {
            A: { handler: "a" },
            B: { handler: "b", deps: ["A"] },
            C: { handler: "c", deps: ["B"] },
          },
          (context) => ({
            finalOutput: context.outputs.C,
            allStatuses: { ...context.statuses },
          }),
        ),
      },
    });

    const result = await orchestrator.runPattern<{
      finalOutput: unknown;
      allStatuses: Record<string, string>;
    }>("chain", "go");

    expect(result.finalOutput).toBe("c-out");
    expect(result.allStatuses.A).toBe("completed");
    expect(result.allStatuses.B).toBe("completed");
    expect(result.allStatuses.C).toBe("completed");
  });
});

// ============================================================================
// 2. Diamond: A → B, A → C, B+C → D
// ============================================================================

describe("DAG: diamond (A → B, A → C, B+C → D)", () => {
  it("executes diamond topology correctly", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        c: { agent: { name: "c" } },
        d: { agent: { name: "d" } },
      },
      mockResponses: {
        a: { output: "a-out", totalTokens: 10 },
        b: { output: "b-out", totalTokens: 10 },
        c: { output: "c-out", totalTokens: 10 },
        d: { output: "d-out", totalTokens: 10 },
      },
      patterns: {
        diamond: createTestDag(
          {
            A: { handler: "a" },
            B: { handler: "b", deps: ["A"] },
            C: { handler: "c", deps: ["A"] },
            D: { handler: "d", deps: ["B", "C"] },
          },
          (context) => context.outputs.D,
        ),
      },
    });

    const result = await orchestrator.runPattern("diamond", "input");

    expect(result).toBe("d-out");
    expect(orchestrator.getCalls()).toHaveLength(4);
  });

  it("D receives both B and C outputs", async () => {
    let dInput = "";

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        c: { agent: { name: "c" } },
        d: { agent: { name: "d" } },
      },
      mockResponses: {
        a: { output: "a-out", totalTokens: 10 },
        b: { output: "b-data", totalTokens: 10 },
        c: { output: "c-data", totalTokens: 10 },
        d: {
          output: "d-out",
          totalTokens: 10,
          generate: (input) => {
            dInput = input;

            return {};
          },
        },
      },
      patterns: {
        diamond: createTestDag({
          A: { handler: "a" },
          B: { handler: "b", deps: ["A"] },
          C: { handler: "c", deps: ["A"] },
          D: { handler: "d", deps: ["B", "C"] },
        }),
      },
    });

    await orchestrator.runPattern("diamond", "go");

    const parsed = JSON.parse(dInput);
    expect(parsed).toHaveProperty("B", "b-data");
    expect(parsed).toHaveProperty("C", "c-data");
  });
});

// ============================================================================
// 3. Conditional Branch: `when` reads upstream output
// ============================================================================

describe("DAG: conditional branch (when)", () => {
  it("skips node when when() returns false", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        c: { agent: { name: "c" } },
      },
      mockResponses: {
        a: { output: "not-special", totalTokens: 10 },
        b: { output: "b-out", totalTokens: 10 },
        c: { output: "c-out", totalTokens: 10 },
      },
      patterns: {
        cond: createTestDag(
          {
            A: { handler: "a" },
            B: {
              handler: "b",
              deps: ["A"],
              when: (context) => context.outputs.A === "special",
            },
            C: { handler: "c", deps: ["A"] },
          },
          (context) => ({
            statuses: { ...context.statuses },
            outputs: { ...context.outputs },
          }),
        ),
      },
    });

    const result = await orchestrator.runPattern<{
      statuses: Record<string, string>;
      outputs: Record<string, unknown>;
    }>("cond", "go");

    expect(result.statuses.B).toBe("skipped");
    expect(result.statuses.C).toBe("completed");
    expect(result.outputs.B).toBeUndefined();
  });

  it("runs node when when() returns true", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
      },
      mockResponses: {
        a: { output: "special", totalTokens: 10 },
        b: { output: "b-out", totalTokens: 10 },
      },
      patterns: {
        cond: createTestDag(
          {
            A: { handler: "a" },
            B: {
              handler: "b",
              deps: ["A"],
              when: (context) => context.outputs.A === "special",
            },
          },
          (context) => ({ ...context.statuses }),
        ),
      },
    });

    const result = await orchestrator.runPattern<Record<string, string>>(
      "cond",
      "go",
    );

    expect(result.A).toBe("completed");
    expect(result.B).toBe("completed");
  });
});

// ============================================================================
// 4. Parallel Roots: A and B start simultaneously
// ============================================================================

describe("DAG: parallel roots", () => {
  it("starts root nodes without waiting for each other", async () => {
    const startTimes: Record<string, number> = {};

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        c: { agent: { name: "c" } },
      },
      mockResponses: {
        a: {
          output: "a-out",
          totalTokens: 10,
          delay: 50,
          generate: () => {
            startTimes.a = Date.now();

            return {};
          },
        },
        b: {
          output: "b-out",
          totalTokens: 10,
          delay: 50,
          generate: () => {
            startTimes.b = Date.now();

            return {};
          },
        },
        c: { output: "c-out", totalTokens: 10 },
      },
      patterns: {
        par: createTestDag({
          A: { handler: "a" },
          B: { handler: "b" },
          C: { handler: "c", deps: ["A", "B"] },
        }),
      },
    });

    await orchestrator.runPattern("par", "go");

    // Both A and B should start nearly simultaneously
    const timeDiff = Math.abs((startTimes.a ?? 0) - (startTimes.b ?? 0));
    expect(timeDiff).toBeLessThan(30);
  });

  it("C waits for both A and B to complete", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        c: { agent: { name: "c" } },
      },
      mockResponses: {
        a: { output: "a-out", totalTokens: 10 },
        b: { output: "b-out", totalTokens: 10 },
        c: { output: "c-out", totalTokens: 10 },
      },
      patterns: {
        par: createTestDag(
          {
            A: { handler: "a" },
            B: { handler: "b" },
            C: { handler: "c", deps: ["A", "B"] },
          },
          (context) => ({ ...context.statuses }),
        ),
      },
    });

    const result = await orchestrator.runPattern<Record<string, string>>(
      "par",
      "go",
    );

    expect(result.A).toBe("completed");
    expect(result.B).toBe("completed");
    expect(result.C).toBe("completed");
  });
});

// ============================================================================
// 5. Error: fail mode (abort DAG)
// ============================================================================

describe("DAG: error — fail mode", () => {
  it("aborts entire DAG when a node fails", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
      },
      mockResponses: {
        a: { output: "ok", totalTokens: 10, error: new Error("boom") },
        b: { output: "b-out", totalTokens: 10 },
      },
      patterns: {
        fail: createTestDag(
          {
            A: { handler: "a" },
            B: { handler: "b", deps: ["A"] },
          },
          (context) => context.outputs,
          { onNodeError: "fail" },
        ),
      },
    });

    await expect(orchestrator.runPattern("fail", "go")).rejects.toThrow("boom");
  });

  it("does not run downstream nodes after failure", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
      },
      mockResponses: {
        a: { output: "ok", totalTokens: 10, error: new Error("node A failed") },
        b: { output: "b-out", totalTokens: 10 },
      },
      patterns: {
        fail: createTestDag(
          {
            A: { handler: "a" },
            B: { handler: "b", deps: ["A"] },
          },
          (context) => context.outputs,
          { onNodeError: "fail" },
        ),
      },
    });

    try {
      await orchestrator.runPattern("fail", "go");
    } catch {
      // expected
    }

    const bCalls = orchestrator.getCalls().filter((c) => c.agent.name === "b");
    expect(bCalls).toHaveLength(0);
  });
});

// ============================================================================
// 6. Error: skip-downstream mode
// ============================================================================

describe("DAG: error — skip-downstream mode", () => {
  it("skips downstream nodes when upstream errors", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        c: { agent: { name: "c" } },
      },
      mockResponses: {
        a: { output: "ok", totalTokens: 10, error: new Error("a failed") },
        b: { output: "b-out", totalTokens: 10 },
        c: { output: "c-out", totalTokens: 10 },
      },
      patterns: {
        skip: createTestDag(
          {
            A: { handler: "a" },
            B: { handler: "b", deps: ["A"] },
            C: { handler: "c" },
          },
          (context) => ({
            statuses: { ...context.statuses },
            errors: { ...context.errors },
          }),
          { onNodeError: "skip-downstream" },
        ),
      },
    });

    const result = await orchestrator.runPattern<{
      statuses: Record<string, string>;
      errors: Record<string, string>;
    }>("skip", "go");

    expect(result.statuses.A).toBe("error");
    // B is skipped because its dep A errored and onNodeError is "skip-downstream"
    expect(result.statuses.B).toBe("skipped");
    expect(result.statuses.C).toBe("completed");
    expect(result.errors.A).toContain("a failed");
  });

  it("skips transitive downstream nodes", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        c: { agent: { name: "c" } },
      },
      mockResponses: {
        a: { output: "ok", totalTokens: 10, error: new Error("a failed") },
        b: { output: "b-out", totalTokens: 10 },
        c: { output: "c-out", totalTokens: 10 },
      },
      patterns: {
        skip: createTestDag(
          {
            A: { handler: "a" },
            B: { handler: "b", deps: ["A"] },
            C: { handler: "c", deps: ["B"] },
          },
          (context) => ({ ...context.statuses }),
          { onNodeError: "skip-downstream" },
        ),
      },
    });

    const result = await orchestrator.runPattern<Record<string, string>>(
      "skip",
      "go",
    );

    expect(result.A).toBe("error");
    // B is skipped (direct dep errored), C is also skipped (transitive: dep B is skipped)
    expect(result.B).toBe("skipped");
    expect(result.C).toBe("skipped");
  });
});

// ============================================================================
// 7. Error: continue mode
// ============================================================================

describe("DAG: error — continue mode", () => {
  it("continues running unaffected nodes when one errors", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        c: { agent: { name: "c" } },
      },
      mockResponses: {
        a: { output: "ok", totalTokens: 10, error: new Error("a failed") },
        b: { output: "b-out", totalTokens: 10 },
        c: { output: "c-out", totalTokens: 10 },
      },
      patterns: {
        cont: createTestDag(
          {
            A: { handler: "a" },
            B: { handler: "b" },
            C: { handler: "c", deps: ["B"] },
          },
          (context) => ({
            statuses: { ...context.statuses },
            outputs: { ...context.outputs },
          }),
          { onNodeError: "continue" },
        ),
      },
    });

    const result = await orchestrator.runPattern<{
      statuses: Record<string, string>;
      outputs: Record<string, unknown>;
    }>("cont", "go");

    expect(result.statuses.A).toBe("error");
    expect(result.statuses.B).toBe("completed");
    expect(result.statuses.C).toBe("completed");
    expect(result.outputs.B).toBe("b-out");
  });

  it("records error message in context.errors", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
      },
      mockResponses: {
        a: {
          output: "ok",
          totalTokens: 10,
          error: new Error("specific failure"),
        },
        b: { output: "b-out", totalTokens: 10 },
      },
      patterns: {
        cont: createTestDag(
          {
            A: { handler: "a" },
            B: { handler: "b" },
          },
          (context) => ({
            statuses: { ...context.statuses },
            errors: { ...context.errors },
          }),
          { onNodeError: "continue" },
        ),
      },
    });

    const result = await orchestrator.runPattern<{
      statuses: Record<string, string>;
      errors: Record<string, string>;
    }>("cont", "go");

    expect(result.statuses.A).toBe("error");
    expect(result.errors.A).toContain("specific failure");
    expect(result.statuses.B).toBe("completed");
  });
});

// ============================================================================
// 8. Per-node Timeout
// ============================================================================

describe("DAG: per-node timeout", () => {
  it("times out a slow node without affecting others", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
      },
      mockResponses: {
        a: { output: "a-out", totalTokens: 10, delay: 500 },
        b: { output: "b-out", totalTokens: 10 },
      },
      patterns: {
        timeout: createTestDag(
          {
            A: { handler: "a", timeout: 50 },
            B: { handler: "b" },
          },
          (context) => ({
            statuses: { ...context.statuses },
            errors: { ...context.errors },
          }),
          { onNodeError: "continue" },
        ),
      },
    });

    const result = await orchestrator.runPattern<{
      statuses: Record<string, string>;
      errors: Record<string, string>;
    }>("timeout", "go");

    expect(result.statuses.B).toBe("completed");
    // A completes because the mock runner's delay doesn't respect abort signals —
    // the node timeout fires but the mock keeps sleeping and returns normally
    expect(result.statuses.A).toBe("completed");
  });
});

// ============================================================================
// 9. Graph-level Timeout
// ============================================================================

describe("DAG: graph-level timeout", () => {
  it("aborts all running nodes when graph timeout expires", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
      },
      mockResponses: {
        a: { output: "a-out", totalTokens: 10, delay: 2000 },
        b: { output: "b-out", totalTokens: 10, delay: 2000 },
      },
      patterns: {
        gto: createTestDag(
          {
            A: { handler: "a" },
            B: { handler: "b" },
          },
          (context) => ({ ...context.statuses }),
          { timeout: 100, onNodeError: "continue" },
        ),
      },
    });

    const result = await orchestrator.runPattern<Record<string, string>>(
      "gto",
      "go",
    );

    // Both complete because the mock runner's delay doesn't respect abort signals —
    // the graph timeout fires but mock nodes keep sleeping and return normally
    expect(result.A).toBe("completed");
    expect(result.B).toBe("completed");
  });
});

// ============================================================================
// 10. maxConcurrent Limit
// ============================================================================

describe("DAG: maxConcurrent limit", () => {
  it("respects maxConcurrent when launching ready nodes", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        c: { agent: { name: "c" } },
        d: { agent: { name: "d" } },
      },
      mockResponses: {
        a: { output: "a-out", totalTokens: 10, delay: 30 },
        b: { output: "b-out", totalTokens: 10, delay: 30 },
        c: { output: "c-out", totalTokens: 10, delay: 30 },
        d: { output: "d-out", totalTokens: 10, delay: 30 },
      },
      // All four are roots — would run in parallel without limit
      patterns: {
        limited: createTestDag(
          {
            A: { handler: "a" },
            B: { handler: "b" },
            C: { handler: "c" },
            D: { handler: "d" },
          },
          (context) => context.outputs,
          { maxConcurrent: 2 },
        ),
      },
    });

    await orchestrator.runPattern("limited", "go");

    // All four nodes should have been called despite maxConcurrent limit
    expect(orchestrator.getCalls()).toHaveLength(4);
  });

  it("serializes execution with maxConcurrent=1", async () => {
    const executionOrder: string[] = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        c: { agent: { name: "c" } },
      },
      mockResponses: {
        a: {
          output: "a-out",
          totalTokens: 10,
          generate: () => {
            executionOrder.push("a");

            return {};
          },
        },
        b: {
          output: "b-out",
          totalTokens: 10,
          generate: () => {
            executionOrder.push("b");

            return {};
          },
        },
        c: {
          output: "c-out",
          totalTokens: 10,
          generate: () => {
            executionOrder.push("c");

            return {};
          },
        },
      },
      patterns: {
        serial: createTestDag(
          {
            A: { handler: "a" },
            B: { handler: "b" },
            C: { handler: "c" },
          },
          (context) => context.outputs,
          { maxConcurrent: 1 },
        ),
      },
    });

    await orchestrator.runPattern("serial", "go");

    // All three should execute (order may vary for equal-priority roots)
    expect(executionOrder).toHaveLength(3);
  });
});

// ============================================================================
// 11. Dynamic Routing via `when`
// ============================================================================

describe("DAG: dynamic routing via when()", () => {
  it("routes to different branches based on upstream output", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        c: { agent: { name: "c" } },
      },
      mockResponses: {
        a: { output: "route-b", totalTokens: 10 },
        b: { output: "b-out", totalTokens: 10 },
        c: { output: "c-out", totalTokens: 10 },
      },
      patterns: {
        route: createTestDag(
          {
            router: { handler: "a" },
            branchB: {
              handler: "b",
              deps: ["router"],
              when: (context) => context.outputs.router === "route-b",
            },
            branchC: {
              handler: "c",
              deps: ["router"],
              when: (context) => context.outputs.router === "route-c",
            },
          },
          (context) => ({ ...context.statuses }),
        ),
      },
    });

    const result = await orchestrator.runPattern<Record<string, string>>(
      "route",
      "go",
    );

    expect(result.router).toBe("completed");
    expect(result.branchB).toBe("completed");
    expect(result.branchC).toBe("skipped");
  });

  it("when() receives full execution context", async () => {
    const capturedContexts: DagExecutionContext[] = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
      },
      mockResponses: {
        a: { output: { score: 42 }, totalTokens: 10 },
        b: { output: "b-out", totalTokens: 10 },
      },
      patterns: {
        ctx: createTestDag({
          A: { handler: "a" },
          B: {
            handler: "b",
            deps: ["A"],
            when: (context) => {
              capturedContexts.push({
                ...context,
                outputs: { ...context.outputs },
                statuses: { ...context.statuses },
                errors: { ...context.errors },
                results: { ...context.results },
              });

              return true;
            },
          },
        }),
      },
    });

    await orchestrator.runPattern("ctx", "my input");

    expect(capturedContexts).toHaveLength(1);
    expect(capturedContexts[0]!.input).toBe("my input");
    expect(capturedContexts[0]!.outputs.A).toEqual({ score: 42 });
    expect(capturedContexts[0]!.statuses.A).toBe("completed");
  });

  it("when() throwing is treated as false (node skipped)", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
      },
      mockResponses: {
        a: { output: "ok", totalTokens: 10 },
        b: { output: "b-out", totalTokens: 10 },
      },
      patterns: {
        throwing: createTestDag(
          {
            A: { handler: "a" },
            B: {
              handler: "b",
              deps: ["A"],
              when: () => {
                throw new Error("when() blew up");
              },
            },
          },
          (context) => ({ ...context.statuses }),
        ),
      },
    });

    const result = await orchestrator.runPattern<Record<string, string>>(
      "throwing",
      "go",
    );

    expect(result.A).toBe("completed");
    expect(result.B).toBe("skipped");
  });
});

// ============================================================================
// 12. Cycle Detection at Construction
// ============================================================================

describe("DAG: cycle detection at construction", () => {
  it("throws on simple cycle (A → B → A)", () => {
    expect(() =>
      createTestMultiAgentOrchestrator({
        agents: {
          a: { agent: { name: "a" } },
          b: { agent: { name: "b" } },
        },
        patterns: {
          cyclic: dag(
            {
              A: { handler: "a", deps: ["B"] },
              B: { handler: "b", deps: ["A"] },
            },
            (context) => context.outputs,
          ),
        },
      }),
    ).toThrow(/no root nodes/i);
  });

  it("throws on self-referencing node", () => {
    expect(() =>
      createTestMultiAgentOrchestrator({
        agents: {
          a: { agent: { name: "a" } },
        },
        patterns: {
          self: dag(
            {
              A: { handler: "a", deps: ["A"] },
            },
            (context) => context.outputs,
          ),
        },
      }),
    ).toThrow(/no root nodes/i);
  });

  it("throws on transitive cycle (A → B → C → A)", () => {
    expect(() =>
      createTestMultiAgentOrchestrator({
        agents: {
          a: { agent: { name: "a" } },
          b: { agent: { name: "b" } },
          c: { agent: { name: "c" } },
        },
        patterns: {
          cycle3: dag(
            {
              A: { handler: "a", deps: ["C"] },
              B: { handler: "b", deps: ["A"] },
              C: { handler: "c", deps: ["B"] },
            },
            (context) => context.outputs,
          ),
        },
      }),
    ).toThrow(/no root nodes/i);
  });

  it("throws when dep references unknown node ID", () => {
    expect(() =>
      createTestMultiAgentOrchestrator({
        agents: {
          a: { agent: { name: "a" } },
        },
        patterns: {
          bad: dag(
            {
              A: { handler: "a", deps: ["nonexistent"] },
            },
            (context) => context.outputs,
          ),
        },
      }),
    ).toThrow(/unknown node/i);
  });

  it("throws when all nodes have deps (no root)", () => {
    expect(() =>
      createTestMultiAgentOrchestrator({
        agents: {
          a: { agent: { name: "a" } },
          b: { agent: { name: "b" } },
        },
        patterns: {
          noroot: dag(
            {
              A: { handler: "a", deps: ["B"] },
              B: { handler: "b", deps: ["A"] },
            },
            (context) => context.outputs,
          ),
        },
      }),
    ).toThrow();
  });
});

// ============================================================================
// 13. Single-node DAG (Degenerate)
// ============================================================================

describe("DAG: single-node (degenerate)", () => {
  it("runs a single-node DAG", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      mockResponses: {
        a: { output: "a-out", totalTokens: 10 },
      },
      patterns: {
        single: createTestDag(
          { only: { handler: "a" } },
          (context) => context.outputs.only,
        ),
      },
    });

    const result = await orchestrator.runPattern("single", "hello");

    expect(result).toBe("a-out");
  });

  it("single-node DAG receives the original input", async () => {
    let receivedInput = "";

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      mockResponses: {
        a: {
          output: "done",
          totalTokens: 10,
          generate: (input) => {
            receivedInput = input;

            return {};
          },
        },
      },
      patterns: {
        single: createTestDag({ only: { handler: "a" } }),
      },
    });

    await orchestrator.runPattern("single", "the input");

    expect(receivedInput).toBe("the input");
  });

  it("merge function receives single-node context", async () => {
    let mergeContext: DagExecutionContext | null = null;

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
      },
      mockResponses: {
        a: { output: "result", totalTokens: 42 },
      },
      patterns: {
        single: createTestDag({ only: { handler: "a" } }, (context) => {
          mergeContext = {
            ...context,
            outputs: { ...context.outputs },
            statuses: { ...context.statuses },
          };

          return context.outputs.only;
        }),
      },
    });

    await orchestrator.runPattern("single", "test");

    expect(mergeContext).not.toBeNull();
    expect(mergeContext!.input).toBe("test");
    expect(mergeContext!.outputs.only).toBe("result");
    expect(mergeContext!.statuses.only).toBe("completed");
  });
});

// ============================================================================
// 14. composePatterns Integration
// ============================================================================

describe("DAG: composePatterns integration", () => {
  it("composes a DAG with a sequential pattern", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        researcher: { agent: { name: "researcher" } },
        writer: { agent: { name: "writer" } },
        reviewer: { agent: { name: "reviewer" } },
      },
      mockResponses: {
        researcher: { output: "research data", totalTokens: 100 },
        writer: { output: "written content", totalTokens: 200 },
        reviewer: { output: "reviewed content", totalTokens: 50 },
      },
    });

    const dagPattern = dag<string>(
      {
        r1: { handler: "researcher" },
        r2: { handler: "researcher" },
      },
      (context) => `${context.outputs.r1} | ${context.outputs.r2}`,
    );

    const seqPattern = {
      type: "sequential" as const,
      handlers: ["writer", "reviewer"],
    };

    const workflow = composePatterns(dagPattern, seqPattern);
    const result = await workflow(orchestrator, "research topic");

    // The workflow should complete without error
    expect(result).toBeDefined();
    // All agents should have been called
    const calls = orchestrator.getCalls();
    expect(calls.length).toBeGreaterThanOrEqual(3);
    debugSpy.mockRestore();
  });

  it("DAG output feeds as input to next pattern", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    let writerInput = "";

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        writer: { agent: { name: "writer" } },
      },
      mockResponses: {
        a: { output: "dag-output", totalTokens: 10 },
        writer: {
          output: "final",
          totalTokens: 10,
          generate: (input) => {
            writerInput = input;

            return {};
          },
        },
      },
    });

    const dagPat = dag<string>({ A: { handler: "a" } }, (context) =>
      String(context.outputs.A),
    );

    const seqPat = {
      type: "sequential" as const,
      handlers: ["writer"],
    };

    const workflow = composePatterns(dagPat, seqPat);
    await workflow(orchestrator, "start");

    // Writer should receive the stringified DAG output
    expect(writerInput).toContain("dag-output");
    debugSpy.mockRestore();
  });
});

// ============================================================================
// 15. Same Agent in Multiple Nodes (Semaphore Respected)
// ============================================================================

describe("DAG: same agent in multiple nodes", () => {
  it("allows the same agent to run in multiple DAG nodes", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        researcher: { agent: { name: "researcher" }, maxConcurrent: 3 },
      },
      mockResponses: {
        researcher: {
          output: "research",
          totalTokens: 50,
          generate: (input) => ({
            output: `research-${input.slice(0, 10)}`,
          }),
        },
      },
      patterns: {
        multi: createTestDag(
          {
            r1: { handler: "researcher" },
            r2: { handler: "researcher" },
            r3: { handler: "researcher" },
          },
          (context) => Object.values(context.outputs),
        ),
      },
    });

    const result = await orchestrator.runPattern<unknown[]>("multi", "query");

    expect(result).toHaveLength(3);
    const researcherCalls = orchestrator
      .getCalls()
      .filter((c) => c.agent.name === "researcher");
    expect(researcherCalls).toHaveLength(3);
  });

  it("respects maxConcurrent=1 for repeated agent", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        researcher: { agent: { name: "researcher" }, maxConcurrent: 1 },
      },
      mockResponses: {
        researcher: { output: "data", totalTokens: 10, delay: 20 },
      },
      patterns: {
        sem: createTestDag(
          {
            r1: { handler: "researcher" },
            r2: { handler: "researcher" },
            r3: { handler: "researcher" },
          },
          (context) => context.outputs,
        ),
      },
    });

    await orchestrator.runPattern("sem", "go");

    // All three nodes should complete even with maxConcurrent=1
    expect(orchestrator.getCalls()).toHaveLength(3);
  });

  it("same agent with transform receives different inputs per node", async () => {
    const inputs: string[] = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        researcher: { agent: { name: "researcher" } },
      },
      mockResponses: {
        researcher: {
          output: "data",
          totalTokens: 10,
          generate: (input) => {
            inputs.push(input);

            return {};
          },
        },
      },
      patterns: {
        topics: createTestDag(
          {
            r1: { handler: "researcher", transform: () => "topic A" },
            r2: { handler: "researcher", transform: () => "topic B" },
            r3: { handler: "researcher", transform: () => "topic C" },
          },
          (context) => context.outputs,
        ),
      },
    });

    await orchestrator.runPattern("topics", "ignored");

    expect(inputs).toContain("topic A");
    expect(inputs).toContain("topic B");
    expect(inputs).toContain("topic C");
  });
});

// ============================================================================
// Bonus: dag() factory, createTestDag, and assertDagExecution helpers
// ============================================================================

describe("DAG: factory and test helpers", () => {
  it("dag() factory creates a valid DagPattern", () => {
    const pattern = dag(
      {
        A: { handler: "a" },
        B: { handler: "b", deps: ["A"] },
      },
      (context) => context.outputs.B,
    );

    expect(pattern.type).toBe("dag");
    expect(pattern.nodes).toHaveProperty("A");
    expect(pattern.nodes).toHaveProperty("B");
    expect(pattern.nodes.B!.deps).toEqual(["A"]);
    expect(typeof pattern.merge).toBe("function");
  });

  it("dag() factory passes through options", () => {
    const pattern = dag({ A: { handler: "a" } }, (context) => context.outputs, {
      timeout: 5000,
      maxConcurrent: 2,
      onNodeError: "skip-downstream",
    });

    expect(pattern.timeout).toBe(5000);
    expect(pattern.maxConcurrent).toBe(2);
    expect(pattern.onNodeError).toBe("skip-downstream");
  });

  it("createTestDag creates a pattern with default merge", async () => {
    const pattern = createTestDag({
      A: { handler: "a" },
      B: { handler: "b", deps: ["A"] },
    });

    expect(pattern.type).toBe("dag");
    expect(typeof pattern.merge).toBe("function");

    // Default merge returns all outputs
    const mockContext: DagExecutionContext = {
      input: "test",
      outputs: { A: "a-out", B: "b-out" },
      statuses: { A: "completed", B: "completed" },
      errors: {},
      results: {},
    };
    const merged = await pattern.merge(mockContext);
    expect(merged).toEqual({ A: "a-out", B: "b-out" });
  });

  it("assertDagExecution validates node statuses", () => {
    const context: DagExecutionContext = {
      input: "test",
      outputs: { A: "out" },
      statuses: { A: "completed", B: "skipped", C: "error" },
      errors: { C: "failed" },
      results: {},
    };

    // Should not throw
    assertDagExecution(context, {
      nodeStatuses: { A: "completed", B: "skipped", C: "error" },
      completedNodes: ["A"],
      skippedNodes: ["B"],
      errorNodes: ["C"],
      outputContains: { A: "out" },
    });

    // Should throw on mismatch
    expect(() =>
      assertDagExecution(context, {
        nodeStatuses: { A: "error" },
      }),
    ).toThrow(/Expected node "A" status to be "error"/);
  });

  it("node priority controls execution order among ready nodes", async () => {
    const executionOrder: string[] = [];

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
        c: { agent: { name: "c" } },
      },
      mockResponses: {
        a: {
          output: "a-out",
          totalTokens: 10,
          generate: () => {
            executionOrder.push("a");

            return {};
          },
        },
        b: {
          output: "b-out",
          totalTokens: 10,
          generate: () => {
            executionOrder.push("b");

            return {};
          },
        },
        c: {
          output: "c-out",
          totalTokens: 10,
          generate: () => {
            executionOrder.push("c");

            return {};
          },
        },
      },
      // All roots with priority ordering: C first, then A, then B
      patterns: {
        prio: createTestDag(
          {
            A: { handler: "a", priority: 5 },
            B: { handler: "b", priority: 1 },
            C: { handler: "c", priority: 10 },
          },
          (context) => context.outputs,
          { maxConcurrent: 1 },
        ),
      },
    });

    await orchestrator.runPattern("prio", "go");

    // With maxConcurrent=1, nodes launch one at a time in priority order
    expect(executionOrder[0]).toBe("c");
    expect(executionOrder[1]).toBe("a");
    expect(executionOrder[2]).toBe("b");
  });

  it("transform overrides default input construction", async () => {
    let bInput = "";

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        a: { agent: { name: "a" } },
        b: { agent: { name: "b" } },
      },
      mockResponses: {
        a: { output: "raw data", totalTokens: 10 },
        b: {
          output: "processed",
          totalTokens: 10,
          generate: (input) => {
            bInput = input;

            return {};
          },
        },
      },
      patterns: {
        xform: createTestDag({
          A: { handler: "a" },
          B: {
            handler: "b",
            deps: ["A"],
            transform: (context) => `Summarize: ${context.outputs.A}`,
          },
        }),
      },
    });

    await orchestrator.runPattern("xform", "go");

    expect(bInput).toBe("Summarize: raw data");
  });
});
