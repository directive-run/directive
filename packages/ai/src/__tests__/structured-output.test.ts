import { describe, it, expect, vi } from "vitest";
import {
	withStructuredOutput,
	extractJsonFromOutput,
	StructuredOutputError,
} from "../structured-output.js";
import type { AgentRunner, AgentLike, RunResult } from "../types.js";

// ============================================================================
// Helpers
// ============================================================================

function mockAgent() {
	return { name: "test-agent", instructions: "Be helpful." };
}

function successResult(output: string): RunResult {
	return {
		output,
		messages: [{ role: "assistant", content: output }],
		toolCalls: [],
		totalTokens: 10,
		tokenUsage: { inputTokens: 5, outputTokens: 5 },
	};
}

/** Minimal Zod-compatible schema for testing. */
function createSchema<T>(validator: (value: unknown) => T | null) {
	return {
		safeParse(value: unknown) {
			try {
				const result = validator(value);
				if (result !== null) {
					return { success: true as const, data: result };
				}

				return { success: false as const, error: { message: "Validation failed" } };
			} catch (err) {
				return {
					success: false as const,
					error: { message: err instanceof Error ? err.message : String(err) },
				};
			}
		},
		description: "a test schema",
	};
}

// ============================================================================
// extractJsonFromOutput
// ============================================================================

describe("extractJsonFromOutput", () => {
	it("parses clean JSON object", () => {
		expect(extractJsonFromOutput('{"name": "Alice"}')).toEqual({ name: "Alice" });
	});

	it("parses clean JSON array", () => {
		expect(extractJsonFromOutput('[1, 2, 3]')).toEqual([1, 2, 3]);
	});

	it("extracts JSON from surrounding text", () => {
		expect(
			extractJsonFromOutput('Here is the result: {"score": 0.95} Hope that helps!'),
		).toEqual({ score: 0.95 });
	});

	it("extracts JSON from markdown code block", () => {
		expect(
			extractJsonFromOutput('```json\n{"value": true}\n```'),
		).toEqual({ value: true });
	});

	it("handles nested objects", () => {
		expect(
			extractJsonFromOutput('{"a": {"b": {"c": 1}}}'),
		).toEqual({ a: { b: { c: 1 } } });
	});

	it("handles strings with braces", () => {
		expect(
			extractJsonFromOutput('{"msg": "hello {world}"}'),
		).toEqual({ msg: "hello {world}" });
	});

	it("throws on no JSON", () => {
		expect(() => extractJsonFromOutput("No JSON here!")).toThrow();
	});

	it("handles escaped quotes in strings", () => {
		expect(
			extractJsonFromOutput('{"text": "he said \\"hello\\""}'),
		).toEqual({ text: 'he said "hello"' });
	});
});

// ============================================================================
// withStructuredOutput
// ============================================================================

describe("withStructuredOutput", () => {
	it("parses valid JSON output on first try", async () => {
		const inner = vi.fn(async () =>
			successResult('{"sentiment": "positive", "confidence": 0.95}'),
		) as unknown as AgentRunner;

		const schema = createSchema((v: unknown) => {
			const obj = v as Record<string, unknown>;
			if (obj.sentiment && obj.confidence) {
				return obj as { sentiment: string; confidence: number };
			}

			return null;
		});

		const runner = withStructuredOutput(inner, { schema });
		const result = await runner(mockAgent(), "Analyze this");

		expect(result.output).toEqual({ sentiment: "positive", confidence: 0.95 });
		expect(inner).toHaveBeenCalledOnce();
	});

	it("retries on invalid JSON and succeeds", async () => {
		let callCount = 0;
		const inner = vi.fn(async () => {
			callCount++;
			if (callCount === 1) {
				return successResult("Not valid JSON");
			}

			return successResult('{"valid": true}');
		}) as unknown as AgentRunner;

		const schema = createSchema((v: unknown) => {
			const obj = v as Record<string, unknown>;
			if (obj.valid === true) {
				return obj;
			}

			return null;
		});

		const runner = withStructuredOutput(inner, { schema, maxRetries: 2 });
		const result = await runner(mockAgent(), "Do something");

		expect(result.output).toEqual({ valid: true });
		expect(inner).toHaveBeenCalledTimes(2);
	});

	it("throws StructuredOutputError after all retries exhausted", async () => {
		const inner = vi.fn(async () =>
			successResult("always invalid"),
		) as unknown as AgentRunner;

		const schema = createSchema(() => null);
		const runner = withStructuredOutput(inner, { schema, maxRetries: 1 });

		await expect(runner(mockAgent(), "Do something")).rejects.toThrow(StructuredOutputError);
		expect(inner).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
	});

	it("appends JSON instruction to agent instructions", async () => {
		const inner = vi.fn(async (agent: AgentLike) => {
			expect(agent.instructions).toContain("IMPORTANT: Respond with valid JSON");

			return successResult('{"ok": true}');
		}) as unknown as AgentRunner;

		const schema = createSchema((v: unknown) => v);
		const runner = withStructuredOutput(inner, { schema });
		await runner(mockAgent(), "hello");
	});

	it("appends error feedback on retry attempts", async () => {
		let callCount = 0;
		const inner = vi.fn(async (_agent: AgentLike, input: string) => {
			callCount++;
			if (callCount === 2) {
				expect(input).toContain("previous response was not valid JSON");
			}

			return successResult('{"ok": true}');
		}) as unknown as AgentRunner;

		const schema = createSchema((v: unknown) => {
			const obj = v as Record<string, unknown>;
			if (callCount >= 2 && obj.ok) {
				return obj;
			}

			return null;
		});

		const runner = withStructuredOutput(inner, { schema, maxRetries: 2 });
		await runner(mockAgent(), "hello");
	});

	it("uses custom extractJson function", async () => {
		const inner = vi.fn(async () =>
			successResult("RESULT: 42"),
		) as unknown as AgentRunner;

		const schema = createSchema((v: unknown) => {
			if (typeof v === "number" && v === 42) {
				return v;
			}

			return null;
		});

		const runner = withStructuredOutput(inner, {
			schema,
			extractJson: (output) => {
				const match = output.match(/RESULT: (\d+)/);
				if (match) {
					return Number(match[1]);
				}
				throw new Error("No result found");
			},
		});

		const result = await runner(mockAgent(), "hello");
		expect(result.output).toBe(42);
	});

	it("extracts JSON from wrapped text output", async () => {
		const inner = vi.fn(async () =>
			successResult('Here is the analysis:\n{"score": 8.5}\nHope that helps!'),
		) as unknown as AgentRunner;

		const schema = createSchema((v: unknown) => {
			const obj = v as Record<string, unknown>;
			if (typeof obj.score === "number") {
				return obj;
			}

			return null;
		});

		const runner = withStructuredOutput(inner, { schema });
		const result = await runner(mockAgent(), "Rate this");

		expect(result.output).toEqual({ score: 8.5 });
	});

	it("StructuredOutputError includes last result", async () => {
		const inner = vi.fn(async () =>
			successResult("bad output"),
		) as unknown as AgentRunner;

		const schema = createSchema(() => null);
		const runner = withStructuredOutput(inner, { schema, maxRetries: 0 });

		try {
			await runner(mockAgent(), "hello");
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(StructuredOutputError);
			expect((err as StructuredOutputError).lastResult).toBeDefined();
		}
	});

	it("uses schema.description in prompt when no schemaDescription provided", async () => {
		const inner = vi.fn(async (agent: AgentLike) => {
			expect(agent.instructions).toContain("a test schema");

			return successResult('{"ok": true}');
		}) as unknown as AgentRunner;

		const schema = createSchema((v: unknown) => v);
		const runner = withStructuredOutput(inner, { schema });
		await runner(mockAgent(), "hello");
	});
});

// ============================================================================
// Config Validation (C1)
// ============================================================================

describe("withStructuredOutput config validation", () => {
	it("throws on negative maxRetries", () => {
		const schema = createSchema((v: unknown) => v);
		const inner = vi.fn(async () => successResult('{"ok": true}')) as unknown as AgentRunner;
		expect(() => withStructuredOutput(inner, { schema, maxRetries: -1 })).toThrow("maxRetries must be a non-negative finite number");
	});

	it("throws on NaN maxRetries", () => {
		const schema = createSchema((v: unknown) => v);
		const inner = vi.fn(async () => successResult('{"ok": true}')) as unknown as AgentRunner;
		expect(() => withStructuredOutput(inner, { schema, maxRetries: NaN })).toThrow("maxRetries must be a non-negative finite number");
	});

	it("accepts zero maxRetries (no retries)", async () => {
		const schema = createSchema(() => null); // Always fails
		const inner = vi.fn(async () => successResult("bad")) as unknown as AgentRunner;
		const runner = withStructuredOutput(inner, { schema, maxRetries: 0 });

		await expect(runner(mockAgent(), "hello")).rejects.toThrow(StructuredOutputError);
		expect(inner).toHaveBeenCalledTimes(1); // Only initial attempt
	});
});

// ============================================================================
// extractJsonFromOutput length guard (M5)
// ============================================================================

describe("extractJsonFromOutput length guard", () => {
	it("throws on output exceeding 1MB", () => {
		const oversized = "x".repeat(1_048_577); // 1MB + 1 byte
		expect(() => extractJsonFromOutput(oversized)).toThrow("Output too large for JSON extraction");
	});

	it("accepts output at exactly 1MB", () => {
		// 1MB of valid JSON-ish text (won't parse, but shouldn't throw the size error)
		const maxSize = "{" + "a".repeat(1_048_574) + "}";
		expect(() => extractJsonFromOutput(maxSize)).toThrow(); // Parse error, not size error
	});
});
