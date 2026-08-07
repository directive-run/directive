import { describe, expect, it } from "vitest";
import { createAnthropicRunner } from "../adapters/anthropic.js";
import {
  createAgentOrchestrator,
  createModerationGuardrail,
  createPIIGuardrail,
} from "../index.js";

describe("README — the AI orchestration example must keep compiling", () => {
  it("type-checks and constructs", () => {
    const orchestrator = createAgentOrchestrator({
      runner: createAnthropicRunner({
        apiKey: "test-key",
        model: "claude-sonnet-4-5-20250929",
      }),
      guardrails: {
        input: [createPIIGuardrail()],
        output: [
          createModerationGuardrail({
            checkFn: (text) => /\b(secret|confidential)\b/i.test(text),
          }),
        ],
      },
      maxTokenBudget: 100_000,
    });

    expect(orchestrator.run).toBeTypeOf("function");
    // The README then calls:
    //   await orchestrator.run({ name, instructions }, "Summarize this thread.")
    const agent = {
      name: "assistant",
      instructions: "You are a helpful assistant.",
    };
    expect(agent.name).toBe("assistant");
  });
});
