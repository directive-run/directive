import { describe, it, expect, vi } from "vitest";
import {
  createTestOrchestrator,
  createTestMultiAgentOrchestrator,
  createMockSchema,
} from "../testing.js";
import { StructuredOutputError } from "../structured-output.js";

// ============================================================================
// Single-agent structured output
// ============================================================================

describe("Single-agent structured output", () => {
  const validJson = JSON.stringify({ name: "test", score: 42 });

  it("orchestrator-level outputSchema validates output", async () => {
    const schema = createMockSchema<{ name: string; score: number }>(
      (data) =>
        typeof data === "object" &&
        data !== null &&
        "name" in data &&
        "score" in data,
    );

    const orchestrator = createTestOrchestrator({
      defaultMockResponse: { output: validJson, totalTokens: 50 },
      outputSchema: schema,
    });

    const agent = { name: "test-agent", instructions: "" };
    const result = await orchestrator.run(agent, "do something");

    expect(result.output).toEqual({ name: "test", score: 42 });
  });

  it("per-call outputSchema overrides orchestrator schema", async () => {
    const orchestratorSchema = createMockSchema<{ name: string }>(
      (data) =>
        typeof data === "object" &&
        data !== null &&
        "name" in data,
    );

    const callSchema = createMockSchema<{ name: string; score: number }>(
      (data) =>
        typeof data === "object" &&
        data !== null &&
        "name" in data &&
        "score" in data,
    );

    const orchestrator = createTestOrchestrator({
      defaultMockResponse: { output: validJson, totalTokens: 50 },
      outputSchema: orchestratorSchema,
    });

    const agent = { name: "test-agent", instructions: "" };
    const result = await orchestrator.run(agent, "do something", {
      outputSchema: callSchema,
    });

    // The call-level schema requires both name and score; output should be parsed
    expect(result.output).toEqual({ name: "test", score: 42 });
  });

  it("per-call outputSchema null opts out of validation", async () => {
    const schema = createMockSchema<{ name: string }>(() => false);

    const orchestrator = createTestOrchestrator({
      defaultMockResponse: { output: validJson, totalTokens: 50 },
      outputSchema: schema,
    });

    const agent = { name: "test-agent", instructions: "" };

    // With the orchestrator schema, this would fail validation.
    // Per-call null opts out entirely — raw output returned as-is.
    const result = await orchestrator.run(agent, "do something", {
      outputSchema: null,
    });

    expect(result.output).toBe(validJson);
  });

  it("invalid output triggers retry and succeeds on second call", async () => {
    let callCount = 0;
    const schema = createMockSchema<{ name: string; score: number }>(
      (data) =>
        typeof data === "object" &&
        data !== null &&
        "name" in data &&
        "score" in data,
    );

    const orchestrator = createTestOrchestrator({
      defaultMockResponse: {
        output: "not valid json",
        totalTokens: 50,
        generate: () => {
          callCount++;
          if (callCount <= 1) {
            return { output: "not valid json" };
          }

          return { output: validJson };
        },
      },
      outputSchema: schema,
      maxSchemaRetries: 2,
    });

    const agent = { name: "test-agent", instructions: "" };
    const result = await orchestrator.run(agent, "do something");

    expect(result.output).toEqual({ name: "test", score: 42 });
  });

  it("output guardrails receive parsed object, not raw JSON string", async () => {
    const schema = createMockSchema<{ name: string; score: number }>(
      (data) =>
        typeof data === "object" &&
        data !== null &&
        "name" in data &&
        "score" in data,
    );

    const guardrailOutput = vi.fn();
    const orchestrator = createTestOrchestrator({
      defaultMockResponse: { output: validJson, totalTokens: 50 },
      outputSchema: schema,
      guardrails: {
        output: [
          async (data) => {
            guardrailOutput(data.output);

            return { passed: true };
          },
        ],
      },
    });

    const agent = { name: "test-agent", instructions: "" };
    await orchestrator.run(agent, "do something");

    // The output guardrail should receive the parsed object, not the raw JSON string
    expect(guardrailOutput).toHaveBeenCalledWith({ name: "test", score: 42 });
  });
});

// ============================================================================
// Multi-agent per-agent structured output
// ============================================================================

describe("Multi-agent per-agent structured output", () => {
  const validJson = JSON.stringify({ name: "test" });

  it("agent with schema gets validated output", async () => {
    const schema = createMockSchema<{ name: string }>(
      (data) =>
        typeof data === "object" &&
        data !== null &&
        "name" in data,
    );

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        structured: {
          agent: { name: "structured", instructions: "" },
          outputSchema: schema,
        },
      },
      defaultMockResponse: {
        output: validJson,
        totalTokens: 50,
      },
    });

    const result = await orchestrator.runAgent("structured", "do something");

    expect(result.output).toEqual({ name: "test" });
  });

  it("agent without schema returns raw output", async () => {
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        unstructured: {
          agent: { name: "unstructured", instructions: "" },
        },
      },
      defaultMockResponse: {
        output: validJson,
        totalTokens: 50,
      },
    });

    const result = await orchestrator.runAgent("unstructured", "do something");

    // No schema, so output is the raw string as returned by the mock runner
    expect(result.output).toBe(validJson);
  });

  it("invalid output throws StructuredOutputError after retries", async () => {
    const schema = createMockSchema<{ name: string }>(
      (data) =>
        typeof data === "object" &&
        data !== null &&
        "name" in data,
    );

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        bad: {
          agent: { name: "bad-agent", instructions: "" },
          outputSchema: schema,
          maxSchemaRetries: 1,
        },
      },
      defaultMockResponse: { output: "not json at all", totalTokens: 10 },
    });

    await expect(
      orchestrator.runAgent("bad", "do something"),
    ).rejects.toThrow(StructuredOutputError);
  });

  it("maxSchemaRetries controls retry count", async () => {
    let callCount = 0;
    const schema = createMockSchema<{ name: string }>(
      (data) =>
        typeof data === "object" &&
        data !== null &&
        "name" in data,
    );

    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        retrier: {
          agent: { name: "retrier", instructions: "" },
          outputSchema: schema,
          maxSchemaRetries: 3,
        },
      },
      defaultMockResponse: {
        output: "bad output",
        totalTokens: 10,
        generate: () => {
          callCount++;
          // Always return bad output — we want to exhaust all retries
          return { output: "still bad output" };
        },
      },
    });

    await expect(
      orchestrator.runAgent("retrier", "do something"),
    ).rejects.toThrow(StructuredOutputError);

    // maxSchemaRetries: 3 means 1 initial + 3 retries = 4 total calls
    const calls = orchestrator.getCalls();
    expect(calls).toHaveLength(4);
  });

  it("output guardrails see parsed object for structured agents", async () => {
    const schema = createMockSchema<{ name: string }>(
      (data) =>
        typeof data === "object" &&
        data !== null &&
        "name" in data,
    );

    const guardrailOutput = vi.fn();
    const orchestrator = createTestMultiAgentOrchestrator({
      agents: {
        structured: {
          agent: { name: "structured", instructions: "" },
          outputSchema: schema,
          guardrails: {
            output: [
              async (data) => {
                guardrailOutput(data.output);

                return { passed: true };
              },
            ],
          },
        },
      },
      defaultMockResponse: {
        output: validJson,
        totalTokens: 50,
      },
    });

    await orchestrator.runAgent("structured", "do something");

    // The per-agent output guardrail should receive the parsed object
    expect(guardrailOutput).toHaveBeenCalledWith({ name: "test" });
  });
});
