import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	createStreamingConstraintRunner,
	withStreamingConstraints,
	createLengthConstraint,
	createFormatConstraint,
	createSemanticConstraint,
	createPIIStreamingConstraint,
	createPatternConstraint,
	createLatencyConstraint,
	allOf,
	anyOf,
	type StreamingConstraint,
	type StreamingConstraintContext,
} from "../adapters/guardrails/streaming-constraints.js";

describe("Streaming Constraints", () => {
	const createContext = (overrides: Partial<StreamingConstraintContext> = {}): StreamingConstraintContext => ({
		partialOutput: "",
		tokenCount: 50,
		elapsedMs: 1000,
		agentName: "test-agent",
		input: "test input",
		facts: {},
		...overrides,
	});

	describe("createStreamingConstraintRunner", () => {
		it("should create a runner with constraints", () => {
			const runner = createStreamingConstraintRunner({
				constraints: [createLengthConstraint({ maxTokens: 100 })],
			});

			expect(runner).toBeDefined();
			expect(runner.getConstraints()).toHaveLength(1);
		});

		it("should sort constraints by priority", () => {
			const runner = createStreamingConstraintRunner({
				constraints: [
					{ name: "low", priority: 100, check: () => ({ passed: true }) },
					{ name: "high", priority: 10, check: () => ({ passed: true }) },
					{ name: "medium", priority: 50, check: () => ({ passed: true }) },
				],
			});

			const constraints = runner.getConstraints();
			expect(constraints[0]!.name).toBe("high");
			expect(constraints[1]!.name).toBe("medium");
			expect(constraints[2]!.name).toBe("low");
		});

		it("should check all constraints", async () => {
			const runner = createStreamingConstraintRunner({
				constraints: [
					{ name: "a", check: () => ({ passed: true }) },
					{ name: "b", check: () => ({ passed: true }) },
				],
			});

			const result = await runner.check(createContext());
			expect(result.allPassed).toBe(true);
			expect(result.shouldTerminate).toBe(false);
		});

		it("should detect failures", async () => {
			const runner = createStreamingConstraintRunner({
				constraints: [
					{ name: "failing", check: () => ({ passed: false, reason: "test failure" }) },
				],
			});

			const result = await runner.check(createContext());
			expect(result.allPassed).toBe(false);
			expect(result.shouldTerminate).toBe(true);
		});

		it("should respect intervalTokens", async () => {
			const checkFn = vi.fn().mockReturnValue({ passed: true });
			const runner = createStreamingConstraintRunner({
				constraints: [{ name: "interval", intervalTokens: 100, check: checkFn }],
			});

			// Token count not divisible by interval
			await runner.check(createContext({ tokenCount: 50 }));
			expect(checkFn).not.toHaveBeenCalled();

			// Token count divisible by interval
			await runner.check(createContext({ tokenCount: 100 }));
			expect(checkFn).toHaveBeenCalled();
		});

		it("should call onViolation callback", async () => {
			const onViolation = vi.fn();
			const runner = createStreamingConstraintRunner({
				constraints: [{ name: "fail", check: () => ({ passed: false, reason: "test" }) }],
				onViolation,
			});

			await runner.check(createContext());
			expect(onViolation).toHaveBeenCalled();
		});

		it("should call onWarning callback", async () => {
			const onWarning = vi.fn();
			const runner = createStreamingConstraintRunner({
				constraints: [{ name: "warn", check: () => ({ passed: true, severity: "warning" }) }],
				onWarning,
			});

			await runner.check(createContext());
			expect(onWarning).toHaveBeenCalled();
		});

		it("should handle constraint errors gracefully", async () => {
			const runner = createStreamingConstraintRunner({
				constraints: [
					{
						name: "throwing",
						check: () => {
							throw new Error("Constraint error");
						},
					},
				],
			});

			const result = await runner.check(createContext());
			expect(result.allPassed).toBe(false);
			expect(result.results[0]!.result.reason).toContain("Constraint error");
		});
	});

	describe("createLengthConstraint", () => {
		it("should pass when under limits", async () => {
			const constraint = createLengthConstraint({ maxTokens: 100, maxCharacters: 500 });
			const result = await constraint.check(createContext({ tokenCount: 50, partialOutput: "test" }));

			expect(result.passed).toBe(true);
		});

		it("should fail when exceeding token limit", async () => {
			const constraint = createLengthConstraint({ maxTokens: 100 });
			const result = await constraint.check(createContext({ tokenCount: 100 }));

			expect(result.passed).toBe(false);
			expect(result.reason).toContain("Exceeded maximum tokens");
		});

		it("should fail when exceeding character limit", async () => {
			const constraint = createLengthConstraint({ maxCharacters: 10 });
			const result = await constraint.check(
				createContext({ partialOutput: "this is longer than ten characters" })
			);

			expect(result.passed).toBe(false);
			expect(result.reason).toContain("Exceeded maximum characters");
		});

		it("should warn at specified percentage", async () => {
			const constraint = createLengthConstraint({ maxTokens: 100, warnAtPercent: 80 });
			const result = await constraint.check(createContext({ tokenCount: 85 }));

			expect(result.passed).toBe(true);
			expect(result.severity).toBe("warning");
		});

		it("should only warn once", async () => {
			const constraint = createLengthConstraint({ maxTokens: 100, warnAtPercent: 80 });

			// First check at 85% - should warn
			const result1 = await constraint.check(createContext({ tokenCount: 85 }));
			expect(result1.severity).toBe("warning");

			// Second check at 90% - should not warn again
			const result2 = await constraint.check(createContext({ tokenCount: 90 }));
			expect(result2.severity).toBeUndefined();
		});
	});

	describe("createFormatConstraint", () => {
		it("should pass valid JSON", async () => {
			const constraint = createFormatConstraint({ format: "json", minCheckTokens: 10 });
			const result = await constraint.check(
				createContext({ partialOutput: '{"key": "value"}', tokenCount: 50 })
			);

			expect(result.passed).toBe(true);
		});

		it("should warn on non-JSON structure", async () => {
			const constraint = createFormatConstraint({ format: "json", minCheckTokens: 10 });
			const result = await constraint.check(
				createContext({ partialOutput: "This is plain text", tokenCount: 50 })
			);

			expect(result.passed).toBe(false);
			expect(result.reason).toContain("does not appear to be JSON");
		});

		it("should skip check before minCheckTokens", async () => {
			const constraint = createFormatConstraint({ format: "json", minCheckTokens: 100 });
			const result = await constraint.check(
				createContext({ partialOutput: "plain text", tokenCount: 50 })
			);

			expect(result.passed).toBe(true);
		});

		it("should handle partial JSON gracefully", async () => {
			const constraint = createFormatConstraint({ format: "json", minCheckTokens: 10 });
			const result = await constraint.check(
				createContext({ partialOutput: '{"key": "value", "nested": {', tokenCount: 50 })
			);

			expect(result.passed).toBe(true); // Partial JSON is expected during streaming
		});

		it("should detect malformed JSON structure", async () => {
			const constraint = createFormatConstraint({ format: "json", minCheckTokens: 10 });
			const result = await constraint.check(
				createContext({ partialOutput: '{"key": "value"}}', tokenCount: 50 })
			);

			expect(result.passed).toBe(false);
			expect(result.reason).toContain("malformed");
		});

		it("should check markdown format", async () => {
			const constraint = createFormatConstraint({ format: "markdown", minCheckTokens: 10 });

			const withMarkdown = await constraint.check(
				createContext({ partialOutput: "# Heading\n\n**bold** text", tokenCount: 150 })
			);
			expect(withMarkdown.passed).toBe(true);

			const withoutMarkdown = await constraint.check(
				createContext({ partialOutput: "plain text without any formatting", tokenCount: 150 })
			);
			expect(withoutMarkdown.passed).toBe(true);
			expect(withoutMarkdown.severity).toBe("info");
		});

		it("should check code format", async () => {
			const constraint = createFormatConstraint({
				format: "code",
				language: "typescript",
				minCheckTokens: 10,
			});

			const withCode = await constraint.check(
				createContext({
					partialOutput: "```typescript\nconst x = 1;\n```",
					tokenCount: 150,
				})
			);
			expect(withCode.passed).toBe(true);
		});
	});

	describe("createSemanticConstraint", () => {
		it("should pass when keywords are present", async () => {
			const constraint = createSemanticConstraint({
				topicKeywords: ["authentication", "login"],
				minRelevance: 0.5,
			});

			const result = await constraint.check(
				createContext({
					partialOutput: "The authentication flow requires login credentials",
					tokenCount: 100,
				})
			);

			expect(result.passed).toBe(true);
		});

		it("should warn on topic drift", async () => {
			const constraint = createSemanticConstraint({
				topicKeywords: ["authentication", "login", "password"],
				minRelevance: 0.5,
			});

			const result = await constraint.check(
				createContext({
					partialOutput: "The weather is nice today and the birds are singing",
					tokenCount: 100,
				})
			);

			expect(result.passed).toBe(false);
			expect(result.reason).toContain("Topic drift");
		});

		it("should skip check before 100 tokens", async () => {
			const constraint = createSemanticConstraint({
				topicKeywords: ["test"],
				minRelevance: 0.5,
			});

			const result = await constraint.check(
				createContext({ partialOutput: "unrelated", tokenCount: 50 })
			);

			expect(result.passed).toBe(true);
		});

		it("should use custom check function", async () => {
			const checkFn = vi.fn().mockResolvedValue(0.8);
			const constraint = createSemanticConstraint({ checkFn, minRelevance: 0.5 });

			const ctx = createContext({ tokenCount: 100 });
			const result = await constraint.check(ctx);

			expect(checkFn).toHaveBeenCalledWith(ctx.partialOutput, ctx.input);
			expect(result.passed).toBe(true);
		});
	});

	describe("createPIIStreamingConstraint", () => {
		it("should detect SSN in output", async () => {
			const constraint = createPIIStreamingConstraint({ types: ["ssn"] });
			const result = await constraint.check(
				createContext({ partialOutput: "SSN: 123-45-6789" })
			);

			expect(result.passed).toBe(false);
			expect(result.severity).toBe("critical");
		});

		it("should detect credit card in output", async () => {
			const constraint = createPIIStreamingConstraint({ types: ["credit_card"] });
			const result = await constraint.check(
				createContext({ partialOutput: "Card: 4111111111111111" })
			);

			expect(result.passed).toBe(false);
		});

		it("should pass when no PII detected", async () => {
			const constraint = createPIIStreamingConstraint({ types: ["ssn", "credit_card"] });
			const result = await constraint.check(
				createContext({ partialOutput: "Hello, world!" })
			);

			expect(result.passed).toBe(true);
		});
	});

	describe("createPatternConstraint", () => {
		it("should detect forbidden patterns", async () => {
			const constraint = createPatternConstraint({
				forbidden: [
					{ pattern: /password[:=]\s*\S+/i, name: "password leak" },
				],
			});

			const result = await constraint.check(
				createContext({ partialOutput: "password: secret123" })
			);

			expect(result.passed).toBe(false);
			expect(result.reason).toContain("password leak");
		});

		it("should warn on missing required patterns", async () => {
			const constraint = createPatternConstraint({
				required: [
					{ pattern: /MISSING_PATTERN_12345/i, name: "missing", afterTokens: 50 },
				],
			});

			// Set tokenCount >= afterTokens, pattern not present
			const result = await constraint.check(
				createContext({ partialOutput: "Some content here without the required pattern", tokenCount: 100 })
			);

			// Should pass but with warning properties
			expect(result.passed).toBe(true);
			expect(result.severity).toBe("warning");
			expect(result.action).toBe("warn");
			expect(result.reason).toBe("Required pattern not found: missing");
		});

		it("should not warn if required pattern is present", async () => {
			const constraint = createPatternConstraint({
				required: [
					{ pattern: /disclaimer/i, name: "disclaimer", afterTokens: 100 },
				],
			});

			const result = await constraint.check(
				createContext({ partialOutput: "Content with DISCLAIMER", tokenCount: 200 })
			);

			expect(result.passed).toBe(true);
			expect(result.severity).toBeUndefined();
		});

		it("should handle severity levels for forbidden patterns", async () => {
			const constraint = createPatternConstraint({
				forbidden: [
					{ pattern: /secret/i, name: "secret", severity: "critical" },
				],
			});

			const result = await constraint.check(
				createContext({ partialOutput: "secret data" })
			);

			expect(result.severity).toBe("critical");
			expect(result.action).toBe("terminate");
		});
	});

	describe("createLatencyConstraint", () => {
		it("should warn on slow output", async () => {
			const constraint = createLatencyConstraint({ minTokensPerSecond: 20 });
			const result = await constraint.check(
				createContext({ tokenCount: 100, elapsedMs: 10000 }) // 10 tokens/sec
			);

			expect(result.passed).toBe(true);
			expect(result.severity).toBe("warning");
			expect(result.reason).toContain("Slow output");
		});

		it("should pass on normal output rate", async () => {
			const constraint = createLatencyConstraint({ minTokensPerSecond: 10 });
			const result = await constraint.check(
				createContext({ tokenCount: 100, elapsedMs: 2000 }) // 50 tokens/sec
			);

			expect(result.passed).toBe(true);
			expect(result.severity).toBeUndefined();
		});

		it("should skip check if elapsed time is too short", async () => {
			const constraint = createLatencyConstraint({ minTokensPerSecond: 10 });
			const result = await constraint.check(
				createContext({ tokenCount: 1, elapsedMs: 100 })
			);

			expect(result.passed).toBe(true);
		});

		it("should note fast output", async () => {
			const constraint = createLatencyConstraint({ maxTokensPerSecond: 50 });
			const result = await constraint.check(
				createContext({ tokenCount: 100, elapsedMs: 1000 }) // 100 tokens/sec
			);

			expect(result.passed).toBe(true);
			expect(result.severity).toBe("info");
		});
	});

	describe("Constraint Combinators", () => {
		describe("allOf", () => {
			it("should pass when all constraints pass", async () => {
				const constraint = allOf([
					{ name: "a", check: () => ({ passed: true }) },
					{ name: "b", check: () => ({ passed: true }) },
				]);

				const result = await constraint.check(createContext());
				expect(result.passed).toBe(true);
			});

			it("should fail when any constraint fails", async () => {
				const constraint = allOf([
					{ name: "a", check: () => ({ passed: true }) },
					{ name: "b", check: () => ({ passed: false, reason: "b failed" }) },
				]);

				const result = await constraint.check(createContext());
				expect(result.passed).toBe(false);
				expect(result.reason).toContain("[b]");
			});
		});

		describe("anyOf", () => {
			it("should pass when any constraint passes", async () => {
				const constraint = anyOf([
					{ name: "a", check: () => ({ passed: false, reason: "a failed" }) },
					{ name: "b", check: () => ({ passed: true }) },
				]);

				const result = await constraint.check(createContext());
				expect(result.passed).toBe(true);
			});

			it("should fail when all constraints fail", async () => {
				const constraint = anyOf([
					{ name: "a", check: () => ({ passed: false, reason: "a failed" }) },
					{ name: "b", check: () => ({ passed: false, reason: "b failed" }) },
				]);

				const result = await constraint.check(createContext());
				expect(result.passed).toBe(false);
				expect(result.reason).toContain("All constraints failed");
			});
		});
	});

	describe("withStreamingConstraints", () => {
		it("should wrap a stream runner with constraint checking", async () => {
			const mockChunks = [
				{ type: "token" as const, data: "Hello", tokenCount: 1 },
				{ type: "token" as const, data: " world", tokenCount: 2 },
				{ type: "done" as const, totalTokens: 2, duration: 100, droppedTokens: 0 },
			];

			const baseRunner = vi.fn().mockReturnValue({
				stream: (async function* () {
					for (const chunk of mockChunks) {
						yield chunk;
					}
				})(),
				result: Promise.resolve({ output: "Hello world", totalTokens: 2, messages: [] }),
				abort: vi.fn(),
			});

			const constraintRunner = createStreamingConstraintRunner({
				constraints: [createLengthConstraint({ maxTokens: 100 })],
			});

			const wrappedRunner = withStreamingConstraints(baseRunner as any, constraintRunner);
			const { stream } = wrappedRunner({ name: "test" }, "input");

			const chunks = [];
			for await (const chunk of stream) {
				chunks.push(chunk);
			}

			expect(chunks.some((c) => c.type === "token")).toBe(true);
		});

		it("should emit violation chunk when constraint fails", async () => {
			// Generate 50 chunks to trigger constraint checks at token intervals
			const mockChunks = Array.from({ length: 100 }, (_, i) => ({
				type: "token" as const,
				data: "x",
				tokenCount: i + 1,
			}));

			const baseRunner = vi.fn().mockReturnValue({
				stream: (async function* () {
					for (const chunk of mockChunks) {
						yield chunk;
					}
				})(),
				result: Promise.resolve({ output: "test", totalTokens: 100, messages: [] }),
				abort: vi.fn(),
			});

			// Use a length constraint that will fail at 50 tokens
			const constraintRunner = createStreamingConstraintRunner({
				constraints: [createLengthConstraint({ maxTokens: 50 })],
				intervalTokens: 50,
			});

			const wrappedRunner = withStreamingConstraints(baseRunner as any, constraintRunner);
			const { stream } = wrappedRunner({ name: "test" }, "input");

			const chunks = [];
			for await (const chunk of stream) {
				chunks.push(chunk);
			}

			expect(chunks.some((c) => c.type === "guardrail_triggered")).toBe(true);
		});
	});

	describe("Edge Cases", () => {
		it("should handle empty output", async () => {
			const constraint = createLengthConstraint({ maxTokens: 100 });
			const result = await constraint.check(
				createContext({ partialOutput: "", tokenCount: 0 })
			);

			expect(result.passed).toBe(true);
		});

		it("should handle very long output", async () => {
			const constraint = createLengthConstraint({ maxCharacters: 100 });
			const result = await constraint.check(
				createContext({ partialOutput: "a".repeat(200), tokenCount: 200 })
			);

			expect(result.passed).toBe(false);
		});

		it("should handle async constraints", async () => {
			const constraint: StreamingConstraint = {
				name: "async",
				async check() {
					await new Promise((r) => setTimeout(r, 10));
					return { passed: true };
				},
			};

			const runner = createStreamingConstraintRunner({ constraints: [constraint] });
			const result = await runner.check(createContext());

			expect(result.allPassed).toBe(true);
		});
	});
});
