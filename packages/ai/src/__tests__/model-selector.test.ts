import { describe, expect, it, vi } from "vitest";
import {
  byAgentName,
  byInputLength,
  byPattern,
  withModelSelection,
} from "../model-selector.js";
import type { AgentLike, AgentRunner, RunResult } from "../types.js";

// ============================================================================
// Helpers
// ============================================================================

function successResult(output = "hello"): RunResult {
  return {
    output,
    messages: [{ role: "assistant", content: output }],
    toolCalls: [],
    totalTokens: 10,
    tokenUsage: { inputTokens: 5, outputTokens: 5 },
  };
}

function makeRunner(): AgentRunner {
  return vi.fn(async (agent: AgentLike) => {
    return { ...successResult(), output: `model:${agent.model ?? "default"}` };
  }) as unknown as AgentRunner;
}

// ============================================================================
// Convenience Matchers
// ============================================================================

describe("byInputLength", () => {
  it("matches when input length is under threshold", () => {
    const rule = byInputLength(100, "gpt-4o-mini");
    expect(rule.match({ name: "a" }, "short")).toBe(true);
    expect(rule.model).toBe("gpt-4o-mini");
  });

  it("does not match when input length exceeds threshold", () => {
    const rule = byInputLength(10, "gpt-4o-mini");
    expect(rule.match({ name: "a" }, "x".repeat(20))).toBe(false);
  });

  it("matches at exact threshold", () => {
    const rule = byInputLength(5, "gpt-4o-mini");
    expect(rule.match({ name: "a" }, "12345")).toBe(true);
  });
});

describe("byAgentName", () => {
  it("matches exact agent name", () => {
    const rule = byAgentName("classifier", "gpt-4o-mini");
    expect(rule.match({ name: "classifier" }, "")).toBe(true);
  });

  it("does not match different name", () => {
    const rule = byAgentName("classifier", "gpt-4o-mini");
    expect(rule.match({ name: "summarizer" }, "")).toBe(false);
  });
});

describe("byPattern", () => {
  it("matches regex pattern on input", () => {
    const rule = byPattern(/classify|categorize/i, "gpt-4o-mini");
    expect(rule.match({ name: "a" }, "Please classify this text")).toBe(true);
  });

  it("does not match when pattern absent", () => {
    const rule = byPattern(/classify/i, "gpt-4o-mini");
    expect(rule.match({ name: "a" }, "Summarize this text")).toBe(false);
  });
});

// ============================================================================
// withModelSelection
// ============================================================================

describe("withModelSelection", () => {
  it("uses first matching rule's model", async () => {
    const inner = makeRunner();
    const runner = withModelSelection(inner, [
      byInputLength(10, "mini"),
      byInputLength(100, "medium"),
    ]);

    const result = await runner({ name: "test", model: "big" }, "short");
    expect(result.output).toBe("model:mini");
  });

  it("falls through to agent's original model when no rule matches", async () => {
    const inner = makeRunner();
    const runner = withModelSelection(inner, [byInputLength(5, "mini")]);

    const result = await runner(
      { name: "test", model: "gpt-4" },
      "this is a long input",
    );
    expect(result.output).toBe("model:gpt-4");
  });

  it("preserves agent properties other than model", async () => {
    const inner = vi.fn(async (agent: AgentLike) => {
      expect(agent.name).toBe("my-agent");
      expect(agent.instructions).toBe("Be helpful.");

      return successResult();
    }) as unknown as AgentRunner;

    const runner = withModelSelection(inner, [byAgentName("my-agent", "mini")]);

    await runner(
      { name: "my-agent", instructions: "Be helpful.", model: "big" },
      "hello",
    );
    expect(inner).toHaveBeenCalledOnce();
  });

  it("works with empty rules (passthrough)", async () => {
    const inner = makeRunner();
    const runner = withModelSelection(inner, []);

    const result = await runner({ name: "test", model: "gpt-4" }, "hello");
    expect(result.output).toBe("model:gpt-4");
  });

  it("first match wins when multiple rules apply", async () => {
    const inner = makeRunner();
    const runner = withModelSelection(inner, [
      byAgentName("test", "first-match"),
      byInputLength(100, "second-match"),
    ]);

    const result = await runner({ name: "test", model: "original" }, "hello");
    expect(result.output).toBe("model:first-match");
  });

  it("passes options through to inner runner", async () => {
    const inner = vi.fn(
      async (_agent: AgentLike, _input: string, options: unknown) => {
        expect(options).toEqual({ maxTurns: 5 });

        return successResult();
      },
    ) as unknown as AgentRunner;

    const runner = withModelSelection(inner, []);
    await runner({ name: "test" }, "hello", { maxTurns: 5 });
  });

  it("accepts config object with onModelSelected callback", async () => {
    const onModelSelected = vi.fn();
    const inner = makeRunner();
    const runner = withModelSelection(inner, {
      rules: [byInputLength(10, "mini")],
      onModelSelected,
    });

    await runner({ name: "test", model: "big" }, "short");
    expect(onModelSelected).toHaveBeenCalledWith("big", "mini");
  });
});

// ============================================================================
// Callback Isolation (C2)
// ============================================================================

describe("withModelSelection callback isolation", () => {
  it("throwing rule.match is skipped silently", async () => {
    const inner = makeRunner();
    const runner = withModelSelection(inner, [
      {
        match: () => {
          throw new Error("rule exploded");
        },
        model: "bad-model",
      },
      byAgentName("test", "fallback-model"),
    ]);

    // Should skip the throwing rule and use the next matching rule
    const result = await runner({ name: "test", model: "original" }, "hello");
    expect(result.output).toBe("model:fallback-model");
  });

  it("throwing onModelSelected does not crash model selection", async () => {
    const inner = makeRunner();
    const runner = withModelSelection(inner, {
      rules: [byInputLength(100, "mini")],
      onModelSelected: () => {
        throw new Error("callback exploded");
      },
    });

    const result = await runner({ name: "test", model: "big" }, "short");
    expect(result.output).toBe("model:mini");
  });
});

// ============================================================================
// byPattern stateful regex (M7)
// ============================================================================

describe("byPattern with global regex", () => {
  it("works correctly on repeated calls with /g flag", () => {
    const rule = byPattern(/classify/gi, "gpt-4o-mini");

    // Call multiple times — should always work due to lastIndex reset
    expect(rule.match({ name: "a" }, "Please classify this")).toBe(true);
    expect(rule.match({ name: "a" }, "classify again")).toBe(true);
    expect(rule.match({ name: "a" }, "Classify it")).toBe(true);
    expect(rule.match({ name: "a" }, "no match here")).toBe(false);
    expect(rule.match({ name: "a" }, "classify once more")).toBe(true);
  });
});
