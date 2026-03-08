import { describe, expect, it, vi } from "vitest";

import {
  createContentFilterGuardrail,
  createLengthGuardrail,
  createModerationGuardrail,
  createOutputSchemaGuardrail,
  createOutputTypeGuardrail,
  createPIIGuardrail,
  createRateLimitGuardrail,
  createToolGuardrail,
} from "../builtin-guardrails.js";
import { AGENT_KEY } from "../types.js";

// ============================================================================
// Helpers
// ============================================================================

function inputData(input: string) {
  return { input, agentName: "test-agent" };
}

function outputData(output: unknown) {
  return { output, agentName: "test-agent", input: "", messages: [] };
}

function toolCallData(name: string) {
  return {
    toolCall: { id: "tc-1", name, arguments: "{}" },
    agentName: "test-agent",
    input: "",
  };
}

const defaultContext = { agentName: "test-agent", input: "", facts: {} };

// ============================================================================
// createPIIGuardrail
// ============================================================================

describe("createPIIGuardrail", () => {
  it("blocks input with SSN pattern (default)", () => {
    const guardrail = createPIIGuardrail({});
    const result = guardrail(inputData("My SSN is 123-45-6789"), defaultContext);

    expect(result).toEqual({ passed: false, reason: "Input contains PII" });
  });

  it("blocks input with credit card pattern (default)", () => {
    const guardrail = createPIIGuardrail({});
    const result = guardrail(
      inputData("Card: 1234567890123456"),
      defaultContext,
    );

    expect(result).toEqual({ passed: false, reason: "Input contains PII" });
  });

  it("blocks input with email pattern (default)", () => {
    const guardrail = createPIIGuardrail({});
    const result = guardrail(
      inputData("Contact me at user@example.com"),
      defaultContext,
    );

    expect(result).toEqual({ passed: false, reason: "Input contains PII" });
  });

  it("passes clean input", () => {
    const guardrail = createPIIGuardrail({});
    const result = guardrail(
      inputData("Hello, how are you?"),
      defaultContext,
    );

    expect(result).toEqual({ passed: true, transformed: undefined });
  });

  it("redact mode replaces PII instead of blocking", () => {
    const guardrail = createPIIGuardrail({ redact: true });
    const result = guardrail(
      inputData("My SSN is 123-45-6789"),
      defaultContext,
    );

    expect(result).toEqual({
      passed: true,
      transformed: "My SSN is [REDACTED]",
    });
  });

  it("custom redact replacement string", () => {
    const guardrail = createPIIGuardrail({
      redact: true,
      redactReplacement: "***",
    });
    const result = guardrail(
      inputData("Email: user@example.com"),
      defaultContext,
    );

    expect(result).toEqual({
      passed: true,
      transformed: "Email: ***",
    });
  });

  it("custom patterns", () => {
    const guardrail = createPIIGuardrail({
      patterns: [/\bSECRET-\d+\b/g],
    });
    const result = guardrail(
      inputData("Code is SECRET-42"),
      defaultContext,
    );

    expect(result).toEqual({ passed: false, reason: "Input contains PII" });
  });
});

// ============================================================================
// createModerationGuardrail
// ============================================================================

describe("createModerationGuardrail", () => {
  it("blocks flagged content (checkFn returns true)", async () => {
    const guardrail = createModerationGuardrail({
      checkFn: () => true,
    });
    const result = await guardrail(inputData("bad content"), defaultContext);

    expect(result).toEqual({
      passed: false,
      reason: "Content flagged by moderation",
    });
  });

  it("passes clean content (checkFn returns false)", async () => {
    const guardrail = createModerationGuardrail({
      checkFn: () => false,
    });
    const result = await guardrail(inputData("good content"), defaultContext);

    expect(result).toEqual({ passed: true, reason: undefined });
  });

  it("works on output data (output field)", async () => {
    const guardrail = createModerationGuardrail({
      checkFn: (text) => text.includes("bad"),
    });
    const result = await guardrail(outputData("this is bad"), defaultContext);

    expect(result).toEqual({
      passed: false,
      reason: "Content flagged by moderation",
    });
  });

  it("custom message", async () => {
    const guardrail = createModerationGuardrail({
      checkFn: () => true,
      message: "Blocked by custom moderation",
    });
    const result = await guardrail(inputData("anything"), defaultContext);

    expect(result).toEqual({
      passed: false,
      reason: "Blocked by custom moderation",
    });
  });

  it("async checkFn", async () => {
    const guardrail = createModerationGuardrail({
      checkFn: async (text) => {
        await new Promise((r) => setTimeout(r, 1));

        return text.includes("toxic");
      },
    });
    const result = await guardrail(inputData("toxic stuff"), defaultContext);

    expect(result).toEqual({
      passed: false,
      reason: "Content flagged by moderation",
    });
  });
});

// ============================================================================
// createRateLimitGuardrail
// ============================================================================

describe("createRateLimitGuardrail", () => {
  it("passes under rate limit", () => {
    const guardrail = createRateLimitGuardrail({
      maxRequestsPerMinute: 10,
    });
    const result = guardrail(inputData("hello"), defaultContext);

    expect(result).toEqual({ passed: true });
  });

  it("blocks on request rate limit", () => {
    const guardrail = createRateLimitGuardrail({
      maxRequestsPerMinute: 3,
    });

    guardrail(inputData("req 1"), defaultContext);
    guardrail(inputData("req 2"), defaultContext);
    guardrail(inputData("req 3"), defaultContext);
    const result = guardrail(inputData("req 4"), defaultContext);

    expect(result).toEqual({
      passed: false,
      reason: "Request rate limit exceeded",
    });
  });

  it("reset() clears counters", () => {
    const guardrail = createRateLimitGuardrail({
      maxRequestsPerMinute: 2,
    });

    guardrail(inputData("req 1"), defaultContext);
    guardrail(inputData("req 2"), defaultContext);

    guardrail.reset();

    const result = guardrail(inputData("req 3"), defaultContext);

    expect(result).toEqual({ passed: true });
  });

  it("token limit check (uses context.facts AGENT_KEY)", () => {
    const guardrail = createRateLimitGuardrail({
      maxTokensPerMinute: 100,
    });
    const context = {
      agentName: "test-agent",
      input: "",
      facts: { [AGENT_KEY]: { tokenUsage: 200 } },
    };
    const result = guardrail(inputData("hello"), context);

    expect(result).toEqual({
      passed: false,
      reason: "Token rate limit exceeded",
    });
  });
});

// ============================================================================
// createToolGuardrail
// ============================================================================

describe("createToolGuardrail", () => {
  it("passes tool in allowlist", () => {
    const guardrail = createToolGuardrail({
      allowlist: ["search", "calculate"],
    });
    const result = guardrail(toolCallData("search"), defaultContext);

    expect(result).toEqual({ passed: true });
  });

  it("blocks tool not in allowlist", () => {
    const guardrail = createToolGuardrail({
      allowlist: ["search", "calculate"],
    });
    const result = guardrail(toolCallData("delete"), defaultContext);

    expect(result).toEqual({
      passed: false,
      reason: 'Tool "delete" not in allowlist',
    });
  });

  it("blocks tool in denylist", () => {
    const guardrail = createToolGuardrail({
      denylist: ["delete_account", "drop_table"],
    });
    const result = guardrail(toolCallData("delete_account"), defaultContext);

    expect(result).toEqual({
      passed: false,
      reason: 'Tool "delete_account" is blocked',
    });
  });

  it("both allowlist and denylist — tool must be in allow and NOT in deny", () => {
    const guardrail = createToolGuardrail({
      allowlist: ["search", "admin_search"],
      denylist: ["admin_search"],
    });

    const passResult = guardrail(toolCallData("search"), defaultContext);

    expect(passResult).toEqual({ passed: true });

    const blockResult = guardrail(
      toolCallData("admin_search"),
      defaultContext,
    );

    expect(blockResult).toEqual({
      passed: false,
      reason: 'Tool "admin_search" is blocked',
    });
  });

  it("case insensitive by default", () => {
    const guardrail = createToolGuardrail({
      allowlist: ["Search"],
    });
    const result = guardrail(toolCallData("SEARCH"), defaultContext);

    expect(result).toEqual({ passed: true });
  });

  it("case sensitive option", () => {
    const guardrail = createToolGuardrail({
      allowlist: ["Search"],
      caseSensitive: true,
    });
    const result = guardrail(toolCallData("search"), defaultContext);

    expect(result).toEqual({
      passed: false,
      reason: 'Tool "search" not in allowlist',
    });
  });
});

// ============================================================================
// createOutputSchemaGuardrail
// ============================================================================

describe("createOutputSchemaGuardrail", () => {
  it("passes valid output (validate returns { valid: true })", () => {
    const guardrail = createOutputSchemaGuardrail({
      validate: () => ({ valid: true }),
    });
    const result = guardrail(outputData({ answer: "yes" }), defaultContext);

    expect(result).toEqual({ passed: true });
  });

  it("rejects invalid output with error messages", () => {
    const guardrail = createOutputSchemaGuardrail({
      validate: () => ({
        valid: false,
        errors: ["missing field: answer", "wrong type for score"],
      }),
    });
    const result = guardrail(outputData({}), defaultContext);

    expect(result).toEqual({
      passed: false,
      reason:
        "Output schema validation failed: missing field: answer; wrong type for score",
    });
  });

  it("works with boolean validator", () => {
    const guardrail = createOutputSchemaGuardrail({
      validate: (value) => typeof value === "string",
    });

    const passResult = guardrail(outputData("hello"), defaultContext);

    expect(passResult).toEqual({ passed: true });

    const failResult = guardrail(outputData(42), defaultContext);

    expect(failResult).toEqual({
      passed: false,
      reason: "Output schema validation failed",
    });
  });
});

// ============================================================================
// createOutputTypeGuardrail
// ============================================================================

describe("createOutputTypeGuardrail", () => {
  it("string type — passes string", () => {
    const guardrail = createOutputTypeGuardrail({ type: "string" });
    const result = guardrail(outputData("hello"), defaultContext);

    expect(result).toEqual({ passed: true });
  });

  it("string type — minStringLength / maxStringLength", () => {
    const guardrail = createOutputTypeGuardrail({
      type: "string",
      minStringLength: 3,
      maxStringLength: 10,
    });

    const tooShort = guardrail(outputData("ab"), defaultContext);

    expect(tooShort).toEqual({
      passed: false,
      reason: "String too short: 2 < 3",
    });

    const tooLong = guardrail(outputData("a".repeat(11)), defaultContext);

    expect(tooLong).toEqual({
      passed: false,
      reason: "String too long: 11 > 10",
    });

    const justRight = guardrail(outputData("hello"), defaultContext);

    expect(justRight).toEqual({ passed: true });
  });

  it("number type — rejects NaN", () => {
    const guardrail = createOutputTypeGuardrail({ type: "number" });

    const validResult = guardrail(outputData(42), defaultContext);

    expect(validResult).toEqual({ passed: true });

    const nanResult = guardrail(outputData(NaN), defaultContext);

    expect(nanResult).toEqual({
      passed: false,
      reason: "Expected number, got number",
    });
  });

  it("boolean type", () => {
    const guardrail = createOutputTypeGuardrail({ type: "boolean" });

    const passResult = guardrail(outputData(true), defaultContext);

    expect(passResult).toEqual({ passed: true });

    const failResult = guardrail(outputData("true"), defaultContext);

    expect(failResult).toEqual({
      passed: false,
      reason: "Expected boolean, got string",
    });
  });

  it("object type — rejects null, rejects array", () => {
    const guardrail = createOutputTypeGuardrail({ type: "object" });

    const validResult = guardrail(outputData({ a: 1 }), defaultContext);

    expect(validResult).toEqual({ passed: true });

    const nullResult = guardrail(outputData(null), defaultContext);

    expect(nullResult).toEqual({
      passed: false,
      reason: "Expected object, got object",
    });

    const arrayResult = guardrail(outputData([1, 2]), defaultContext);

    expect(arrayResult).toEqual({
      passed: false,
      reason: "Expected object, got array",
    });
  });

  it("object type — requiredFields", () => {
    const guardrail = createOutputTypeGuardrail({
      type: "object",
      requiredFields: ["id", "name"],
    });

    const validResult = guardrail(
      outputData({ id: 1, name: "test" }),
      defaultContext,
    );

    expect(validResult).toEqual({ passed: true });

    const missingResult = guardrail(outputData({ id: 1 }), defaultContext);

    expect(missingResult).toEqual({
      passed: false,
      reason: "Missing required field: name",
    });
  });

  it("array type — minLength / maxLength", () => {
    const guardrail = createOutputTypeGuardrail({
      type: "array",
      minLength: 2,
      maxLength: 5,
    });

    const tooShort = guardrail(outputData([1]), defaultContext);

    expect(tooShort).toEqual({
      passed: false,
      reason: "Array too short: 1 < 2",
    });

    const tooLong = guardrail(outputData([1, 2, 3, 4, 5, 6]), defaultContext);

    expect(tooLong).toEqual({
      passed: false,
      reason: "Array too long: 6 > 5",
    });

    const justRight = guardrail(outputData([1, 2, 3]), defaultContext);

    expect(justRight).toEqual({ passed: true });
  });
});

// ============================================================================
// createLengthGuardrail
// ============================================================================

describe("createLengthGuardrail", () => {
  it("blocks on maxCharacters exceeded", () => {
    const guardrail = createLengthGuardrail({ maxCharacters: 10 });
    const result = guardrail(outputData("a".repeat(15)), defaultContext);

    expect(result).toEqual({
      passed: false,
      reason: "Output too long: 15 characters (max: 10)",
    });
  });

  it("blocks on maxTokens exceeded", () => {
    const guardrail = createLengthGuardrail({ maxTokens: 5 });
    // Default estimator: Math.ceil(text.length / 4)
    // 24 chars -> 6 tokens -> exceeds 5
    const result = guardrail(outputData("a".repeat(24)), defaultContext);

    expect(result).toEqual({
      passed: false,
      reason: "Output too long: ~6 tokens (max: 5)",
    });
  });

  it("passes within limits", () => {
    const guardrail = createLengthGuardrail({
      maxCharacters: 100,
      maxTokens: 50,
    });
    const result = guardrail(outputData("short text"), defaultContext);

    expect(result).toEqual({ passed: true });
  });

  it("custom estimateTokens", () => {
    const customEstimator = vi.fn((text: string) => text.split(" ").length);
    const guardrail = createLengthGuardrail({
      maxTokens: 3,
      estimateTokens: customEstimator,
    });

    const result = guardrail(
      outputData("one two three four"),
      defaultContext,
    );

    expect(customEstimator).toHaveBeenCalledWith("one two three four");
    expect(result).toEqual({
      passed: false,
      reason: "Output too long: ~4 tokens (max: 3)",
    });
  });
});

// ============================================================================
// createContentFilterGuardrail
// ============================================================================

describe("createContentFilterGuardrail", () => {
  it("blocks output matching string pattern", () => {
    const guardrail = createContentFilterGuardrail({
      blockedPatterns: ["internal-only"],
    });
    const result = guardrail(
      outputData("This is internal-only data"),
      defaultContext,
    );

    expect(result).toEqual({
      passed: false,
      reason: "Output contains blocked content matching: internal-only",
    });
  });

  it("blocks output matching regex pattern", () => {
    const guardrail = createContentFilterGuardrail({
      blockedPatterns: [/\bpassword\b/i],
    });
    const result = guardrail(
      outputData("Your Password is secret"),
      defaultContext,
    );

    expect(result).toEqual({
      passed: false,
      reason: "Output contains blocked content matching: \\bpassword\\b",
    });
  });

  it("case insensitive by default", () => {
    const guardrail = createContentFilterGuardrail({
      blockedPatterns: ["secret"],
    });
    const result = guardrail(outputData("This is SECRET info"), defaultContext);

    expect(result).toEqual({
      passed: false,
      reason: "Output contains blocked content matching: secret",
    });
  });

  it("case sensitive option", () => {
    const guardrail = createContentFilterGuardrail({
      blockedPatterns: ["Secret"],
      caseSensitive: true,
    });

    const noMatch = guardrail(outputData("this is secret"), defaultContext);

    expect(noMatch).toEqual({ passed: true });

    const match = guardrail(outputData("this is Secret"), defaultContext);

    expect(match).toEqual({
      passed: false,
      reason: "Output contains blocked content matching: Secret",
    });
  });
});
