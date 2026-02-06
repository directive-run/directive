/**
 * Streaming Constraints - Evaluate constraints on partial output
 *
 * Provides real-time constraint evaluation during streaming:
 * - Interval-based checking (default: every 50 tokens)
 * - Early termination on constraint violation
 * - Built-in constraints for common use cases
 * - Integration with existing streaming infrastructure
 *
 * @example
 * ```typescript
 * import {
 *   createStreamingConstraintRunner,
 *   createLengthConstraint,
 *   createFormatConstraint,
 *   createPIIStreamingConstraint,
 * } from 'directive/guardrails';
 *
 * const runner = createStreamingConstraintRunner({
 *   constraints: [
 *     createLengthConstraint({ maxTokens: 4000 }),
 *     createFormatConstraint({ format: 'json' }),
 *     createPIIStreamingConstraint({ types: ['ssn', 'credit_card'] }),
 *   ],
 *   intervalTokens: 50,
 * });
 *
 * // Use with streaming runner
 * const stream = withStreamingConstraints(baseStream, runner);
 * ```
 */

import type { StreamChunk, StreamRunFn, StreamingRunResult } from "../openai-agents-streaming.js";
import type { PIIType } from "./pii-enhanced.js";
import { detectPII } from "./pii-enhanced.js";

// ============================================================================
// Types
// ============================================================================

/** Context passed to streaming constraint check functions */
export interface StreamingConstraintContext {
	/** Accumulated partial output */
	partialOutput: string;
	/** Current token count */
	tokenCount: number;
	/** Elapsed time in milliseconds */
	elapsedMs: number;
	/** Agent name (if available) */
	agentName: string;
	/** Original input */
	input: string;
	/** Current facts (if available) */
	facts: Record<string, unknown>;
}

/** Result from a streaming constraint check */
export interface StreamingConstraintResult {
	/** Whether the constraint passed */
	passed: boolean;
	/** Reason for failure (if failed) */
	reason?: string;
	/** Severity level */
	severity?: "info" | "warning" | "error" | "critical";
	/** Action to take */
	action?: "continue" | "warn" | "terminate";
	/** Optional data to attach */
	data?: Record<string, unknown>;
}

/** Streaming constraint definition */
export interface StreamingConstraint {
	/** Unique name for this constraint */
	name: string;
	/** Check function called at intervals */
	check: (ctx: StreamingConstraintContext) => Promise<StreamingConstraintResult> | StreamingConstraintResult;
	/** Check every N tokens (default: 50) */
	intervalTokens?: number;
	/** Terminate stream on failure (default: true) */
	terminateOnFail?: boolean;
	/** Priority for ordering (lower = first) */
	priority?: number;
}

/** Streaming constraint runner configuration */
export interface StreamingConstraintRunnerConfig {
	/** Constraints to evaluate */
	constraints: StreamingConstraint[];
	/** Default check interval in tokens (default: 50) */
	intervalTokens?: number;
	/** Default behavior on constraint failure (default: true) */
	terminateOnFail?: boolean;
	/** Callback when constraint is violated */
	onViolation?: (constraint: StreamingConstraint, result: StreamingConstraintResult, ctx: StreamingConstraintContext) => void;
	/** Callback when constraint emits a warning */
	onWarning?: (constraint: StreamingConstraint, result: StreamingConstraintResult, ctx: StreamingConstraintContext) => void;
}

/** Streaming constraint chunk emitted on violation - compatible with GuardrailTriggeredChunk */
export interface StreamingConstraintViolatedChunk {
	type: "guardrail_triggered";
	guardrailName: string;
	reason: string;
	partialOutput: string;
	stopped: boolean;
	/** Additional constraint-specific fields */
	constraintName: string;
	severity: "info" | "warning" | "error" | "critical";
	action: "continue" | "warn" | "terminate";
	tokenCount: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Default interval between constraint checks */
export const DEFAULT_CONSTRAINT_INTERVAL = 50;

// ============================================================================
// Streaming Constraint Runner
// ============================================================================

/**
 * Create a streaming constraint runner that evaluates constraints on partial output.
 *
 * @example
 * ```typescript
 * const runner = createStreamingConstraintRunner({
 *   constraints: [
 *     createLengthConstraint({ maxTokens: 4000 }),
 *     createFormatConstraint({ format: 'json' }),
 *   ],
 * });
 *
 * // Evaluate constraints manually
 * const result = await runner.check({
 *   partialOutput: 'partial response...',
 *   tokenCount: 100,
 *   elapsedMs: 500,
 *   agentName: 'my-agent',
 *   input: 'original input',
 *   facts: {},
 * });
 * ```
 */
export function createStreamingConstraintRunner(config: StreamingConstraintRunnerConfig) {
	const {
		constraints,
		intervalTokens = DEFAULT_CONSTRAINT_INTERVAL,
		terminateOnFail = true,
		onViolation,
		onWarning,
	} = config;

	// Sort constraints by priority
	const sortedConstraints = [...constraints].sort(
		(a, b) => (a.priority ?? 100) - (b.priority ?? 100)
	);

	return {
		/** Check all constraints against current context */
		async check(ctx: StreamingConstraintContext): Promise<{
			allPassed: boolean;
			results: Array<{ constraint: StreamingConstraint; result: StreamingConstraintResult }>;
			shouldTerminate: boolean;
		}> {
			const results: Array<{ constraint: StreamingConstraint; result: StreamingConstraintResult }> = [];
			let allPassed = true;
			let shouldTerminate = false;

			for (const constraint of sortedConstraints) {
				// Check if this constraint should run at this token count
				const interval = constraint.intervalTokens ?? intervalTokens;
				if (ctx.tokenCount % interval !== 0 && ctx.tokenCount > 0) {
					continue;
				}

				try {
					const result = await constraint.check(ctx);
					results.push({ constraint, result });

					if (!result.passed) {
						allPassed = false;

						const doTerminate = constraint.terminateOnFail ?? terminateOnFail;
						if (doTerminate && (result.action === "terminate" || result.action === undefined)) {
							shouldTerminate = true;
						}

						onViolation?.(constraint, result, ctx);
					} else if (result.severity === "warning" || result.action === "warn") {
						onWarning?.(constraint, result, ctx);
					}
				} catch (error) {
					// Constraint threw - treat as failure
					const result: StreamingConstraintResult = {
						passed: false,
						reason: `Constraint error: ${error instanceof Error ? error.message : String(error)}`,
						severity: "error",
						action: "continue", // Don't terminate on constraint errors by default
					};
					results.push({ constraint, result });
					allPassed = false;
				}
			}

			return { allPassed, results, shouldTerminate };
		},

		/** Get constraints */
		getConstraints(): StreamingConstraint[] {
			return [...sortedConstraints];
		},
	};
}

// ============================================================================
// Wrapper for StreamRunFn
// ============================================================================

/**
 * Wrap a streaming runner with constraint checking.
 *
 * @example
 * ```typescript
 * const runner = createStreamingConstraintRunner({ constraints: [...] });
 * const wrappedStream = withStreamingConstraints(baseStreamRunner, runner);
 *
 * const { stream, result } = wrappedStream(agent, input);
 * for await (const chunk of stream) {
 *   if (chunk.type === 'streaming_constraint_violated') {
 *     console.warn('Constraint violated:', chunk.constraintName);
 *   }
 * }
 * ```
 */
export function withStreamingConstraints(
	runner: StreamRunFn,
	constraintRunner: ReturnType<typeof createStreamingConstraintRunner>
): StreamRunFn {
	return <T>(agent: Parameters<StreamRunFn>[0], input: string, options?: Parameters<StreamRunFn>[2]): StreamingRunResult<T> => {
		const baseResult = runner<T>(agent, input, options);
		const abortController = new AbortController();

		// Combine abort signals
		let externalAbortHandler: (() => void) | undefined;
		if (options?.signal) {
			externalAbortHandler = () => abortController.abort();
			options.signal.addEventListener("abort", externalAbortHandler);
		}

		let partialOutput = "";
		let tokenCount = 0;
		const startTime = Date.now();

		// Transform stream to check constraints
		async function* transformStream(): AsyncIterable<StreamChunk> {
			try {
				for await (const chunk of baseResult.stream) {
					// Track tokens
					if (chunk.type === "token") {
						tokenCount++;
						partialOutput += chunk.data;

						// Check constraints at intervals
						const checkResult = await constraintRunner.check({
							partialOutput,
							tokenCount,
							elapsedMs: Date.now() - startTime,
							agentName: agent.name ?? "unknown",
							input,
							facts: {},
						});

						// Emit violation chunks
						for (const { constraint, result } of checkResult.results) {
							if (!result.passed) {
								const shouldTerminate = result.action === "terminate" || result.action === undefined;
								const violationChunk: StreamingConstraintViolatedChunk = {
									type: "guardrail_triggered",
									guardrailName: `streaming:${constraint.name}`,
									reason: result.reason ?? "Constraint failed",
									partialOutput,
									stopped: shouldTerminate,
									constraintName: constraint.name,
									severity: result.severity ?? "error",
									action: result.action ?? "terminate",
									tokenCount,
								};
								yield violationChunk;
							}
						}

						// Terminate if needed
						if (checkResult.shouldTerminate) {
							abortController.abort();
							baseResult.abort();
							return;
						}
					}

					yield chunk;
				}
			} finally {
				// Cleanup
				if (externalAbortHandler && options?.signal) {
					options.signal.removeEventListener("abort", externalAbortHandler);
				}
			}
		}

		return {
			stream: transformStream(),
			result: baseResult.result,
			abort: () => {
				abortController.abort();
				baseResult.abort();
			},
		};
	};
}

// ============================================================================
// Built-in Constraints
// ============================================================================

/**
 * Create a length constraint that limits output tokens/characters.
 *
 * @example
 * ```typescript
 * const constraint = createLengthConstraint({
 *   maxTokens: 4000,
 *   maxCharacters: 16000,
 *   warnAtPercent: 80,
 * });
 * ```
 */
export function createLengthConstraint(options: {
	/** Maximum tokens */
	maxTokens?: number;
	/** Maximum characters */
	maxCharacters?: number;
	/** Warn at percentage of limit (0-100) */
	warnAtPercent?: number;
	/** Terminate on violation */
	terminateOnFail?: boolean;
	/** Priority */
	priority?: number;
}): StreamingConstraint {
	const {
		maxTokens,
		maxCharacters,
		warnAtPercent = 80,
		terminateOnFail = true,
		priority = 10,
	} = options;

	let warned = false;

	return {
		name: "length-constraint",
		terminateOnFail,
		priority,
		check(ctx) {
			// Check token limit
			if (maxTokens && ctx.tokenCount >= maxTokens) {
				return {
					passed: false,
					reason: `Exceeded maximum tokens: ${ctx.tokenCount} >= ${maxTokens}`,
					severity: "error",
					action: "terminate",
				};
			}

			// Check character limit
			if (maxCharacters && ctx.partialOutput.length >= maxCharacters) {
				return {
					passed: false,
					reason: `Exceeded maximum characters: ${ctx.partialOutput.length} >= ${maxCharacters}`,
					severity: "error",
					action: "terminate",
				};
			}

			// Warning check
			if (!warned && warnAtPercent > 0) {
				const tokenPercent = maxTokens ? (ctx.tokenCount / maxTokens) * 100 : 0;
				const charPercent = maxCharacters ? (ctx.partialOutput.length / maxCharacters) * 100 : 0;

				if (tokenPercent >= warnAtPercent || charPercent >= warnAtPercent) {
					warned = true;
					return {
						passed: true,
						severity: "warning",
						action: "warn",
						reason: `Approaching limit: ${Math.max(tokenPercent, charPercent).toFixed(0)}%`,
					};
				}
			}

			return { passed: true };
		},
	};
}

/**
 * Create a format constraint that validates output structure.
 *
 * @example
 * ```typescript
 * const constraint = createFormatConstraint({
 *   format: 'json',
 *   minCheckTokens: 100, // Don't check until 100 tokens
 * });
 * ```
 */
export function createFormatConstraint(options: {
	/** Expected format */
	format: "json" | "markdown" | "code";
	/** Minimum tokens before checking (default: 50) */
	minCheckTokens?: number;
	/** Language for code format */
	language?: string;
	/** Terminate on violation */
	terminateOnFail?: boolean;
	/** Priority */
	priority?: number;
}): StreamingConstraint {
	const {
		format,
		minCheckTokens = 50,
		language,
		terminateOnFail = false, // Don't terminate by default - format may be incomplete
		priority = 50,
	} = options;

	return {
		name: `format-constraint:${format}`,
		terminateOnFail,
		priority,
		check(ctx) {
			// Don't check until we have enough tokens
			if (ctx.tokenCount < minCheckTokens) {
				return { passed: true };
			}

			const output = ctx.partialOutput.trim();

			switch (format) {
				case "json": {
					// Check for JSON structure indicators
					if (!output.startsWith("{") && !output.startsWith("[")) {
						return {
							passed: false,
							reason: "Output does not appear to be JSON (missing opening brace/bracket)",
							severity: "warning",
							action: "warn",
						};
					}

					// Try to parse (may fail for partial JSON, which is expected)
					try {
						JSON.parse(output);
						return { passed: true };
					} catch {
						// Check for obvious structural issues
						const openBraces = (output.match(/{/g) || []).length;
						const closeBraces = (output.match(/}/g) || []).length;
						const openBrackets = (output.match(/\[/g) || []).length;
						const closeBrackets = (output.match(/]/g) || []).length;

						// If we have more closing than opening, something is wrong
						if (closeBraces > openBraces || closeBrackets > openBrackets) {
							return {
								passed: false,
								reason: "JSON structure appears malformed",
								severity: "warning",
								action: "warn",
							};
						}

						// Partial JSON is expected during streaming
						return { passed: true };
					}
				}

				case "markdown": {
					// Light validation - check for markdown indicators
					const hasMarkdownSyntax =
						output.includes("#") ||
						output.includes("**") ||
						output.includes("- ") ||
						output.includes("* ") ||
						output.includes("```") ||
						output.includes("[") ||
						output.includes(">");

					if (!hasMarkdownSyntax && ctx.tokenCount > 100) {
						return {
							passed: true, // Don't fail, just warn
							severity: "info",
							reason: "Output may not contain markdown formatting",
						};
					}

					return { passed: true };
				}

				case "code": {
					// Check for code block if language specified
					if (language) {
						const codeBlockPattern = new RegExp(`\`\`\`${language}`, "i");
						if (!codeBlockPattern.test(output) && ctx.tokenCount > 100) {
							return {
								passed: true,
								severity: "info",
								reason: `Expected ${language} code block not found`,
							};
						}
					}

					return { passed: true };
				}

				default:
					return { passed: true };
			}
		},
	};
}

/**
 * Create a semantic constraint that detects topic drift.
 *
 * @example
 * ```typescript
 * const constraint = createSemanticConstraint({
 *   topicKeywords: ['authentication', 'login', 'password'],
 *   minRelevance: 0.5,
 *   checkFn: async (text) => myEmbeddingModel.similarity(text, topic),
 * });
 * ```
 */
export function createSemanticConstraint(options: {
	/** Keywords that should appear in output */
	topicKeywords?: string[];
	/** Custom relevance check function (returns 0-1) */
	checkFn?: (partialOutput: string, input: string) => Promise<number>;
	/** Minimum relevance score (0-1) */
	minRelevance?: number;
	/** Terminate on violation */
	terminateOnFail?: boolean;
	/** Priority */
	priority?: number;
}): StreamingConstraint {
	const {
		topicKeywords = [],
		checkFn,
		minRelevance = 0.3,
		terminateOnFail = false,
		priority = 60,
	} = options;

	return {
		name: "semantic-constraint",
		terminateOnFail,
		priority,
		intervalTokens: 100, // Check less frequently
		async check(ctx) {
			// Skip early checks
			if (ctx.tokenCount < 100) {
				return { passed: true };
			}

			// Use custom check function if provided
			if (checkFn) {
				const relevance = await checkFn(ctx.partialOutput, ctx.input);
				if (relevance < minRelevance) {
					return {
						passed: false,
						reason: `Topic drift detected: relevance ${(relevance * 100).toFixed(0)}% < ${(minRelevance * 100).toFixed(0)}%`,
						severity: "warning",
						action: "warn",
						data: { relevance },
					};
				}
				return { passed: true };
			}

			// Keyword-based check
			if (topicKeywords.length > 0) {
				const outputLower = ctx.partialOutput.toLowerCase();
				const matchedKeywords = topicKeywords.filter((kw) =>
					outputLower.includes(kw.toLowerCase())
				);

				const relevance = matchedKeywords.length / topicKeywords.length;
				if (relevance < minRelevance) {
					return {
						passed: false,
						reason: `Topic drift: only ${matchedKeywords.length}/${topicKeywords.length} topic keywords found`,
						severity: "warning",
						action: "warn",
						data: { matchedKeywords, relevance },
					};
				}
			}

			return { passed: true };
		},
	};
}

/**
 * Create a PII constraint that detects PII in streaming output.
 *
 * @example
 * ```typescript
 * const constraint = createPIIStreamingConstraint({
 *   types: ['ssn', 'credit_card', 'email'],
 *   terminateOnFail: true,
 * });
 * ```
 */
export function createPIIStreamingConstraint(options: {
	/** PII types to detect */
	types?: PIIType[];
	/** Minimum confidence threshold */
	minConfidence?: number;
	/** Terminate on violation */
	terminateOnFail?: boolean;
	/** Priority */
	priority?: number;
}): StreamingConstraint {
	const {
		types = ["ssn", "credit_card"],
		minConfidence = 0.7,
		terminateOnFail = true,
		priority = 5, // High priority - check early
	} = options;

	return {
		name: "pii-streaming-constraint",
		terminateOnFail,
		priority,
		async check(ctx) {
			const result = await detectPII(ctx.partialOutput, {
				types,
				minConfidence,
			});

			if (result.detected) {
				const typeCounts = Object.entries(result.typeCounts)
					.map(([type, count]) => `${type}: ${count}`)
					.join(", ");

				return {
					passed: false,
					reason: `PII detected in output: ${typeCounts}`,
					severity: "critical",
					action: "terminate",
					data: {
						detected: result.items.map((item) => ({
							type: item.type,
							confidence: item.confidence,
						})),
					},
				};
			}

			return { passed: true };
		},
	};
}

/**
 * Create a pattern constraint that detects forbidden patterns.
 *
 * @example
 * ```typescript
 * const constraint = createPatternConstraint({
 *   forbidden: [
 *     { pattern: /password[:=]\s*\S+/i, name: 'password leak' },
 *     { pattern: /api[_-]?key[:=]\s*\S+/i, name: 'API key leak' },
 *   ],
 * });
 * ```
 */
export function createPatternConstraint(options: {
	/** Forbidden patterns */
	forbidden?: Array<{ pattern: RegExp; name: string; severity?: "warning" | "error" | "critical" }>;
	/** Required patterns (warn if missing) */
	required?: Array<{ pattern: RegExp; name: string; afterTokens?: number }>;
	/** Terminate on violation */
	terminateOnFail?: boolean;
	/** Priority */
	priority?: number;
}): StreamingConstraint {
	const {
		forbidden = [],
		required = [],
		terminateOnFail = true,
		priority = 10,
	} = options;

	return {
		name: "pattern-constraint",
		terminateOnFail,
		priority,
		check(ctx) {
			// Check forbidden patterns
			for (const { pattern, name, severity = "error" } of forbidden) {
				if (pattern.test(ctx.partialOutput)) {
					return {
						passed: false,
						reason: `Forbidden pattern detected: ${name}`,
						severity,
						action: severity === "critical" ? "terminate" : "warn",
					};
				}
			}

			// Check required patterns
			for (const { pattern, name, afterTokens = 200 } of required) {
				if (ctx.tokenCount >= afterTokens && !pattern.test(ctx.partialOutput)) {
					return {
						passed: true, // Don't fail, just warn
						severity: "warning",
						action: "warn",
						reason: `Required pattern not found: ${name}`,
					};
				}
			}

			return { passed: true };
		},
	};
}

/**
 * Create a latency constraint that monitors output rate.
 *
 * @example
 * ```typescript
 * const constraint = createLatencyConstraint({
 *   minTokensPerSecond: 10,
 *   maxTokensPerSecond: 100,
 * });
 * ```
 */
export function createLatencyConstraint(options: {
	/** Minimum tokens per second (warn if slower) */
	minTokensPerSecond?: number;
	/** Maximum tokens per second (warn if faster - might indicate issue) */
	maxTokensPerSecond?: number;
	/** Terminate on violation */
	terminateOnFail?: boolean;
	/** Priority */
	priority?: number;
}): StreamingConstraint {
	const {
		minTokensPerSecond,
		maxTokensPerSecond,
		terminateOnFail = false,
		priority = 90, // Low priority - check last
	} = options;

	return {
		name: "latency-constraint",
		terminateOnFail,
		priority,
		intervalTokens: 100, // Check every 100 tokens
		check(ctx) {
			// Need at least some elapsed time
			if (ctx.elapsedMs < 1000) {
				return { passed: true };
			}

			const tokensPerSecond = (ctx.tokenCount / ctx.elapsedMs) * 1000;

			if (minTokensPerSecond && tokensPerSecond < minTokensPerSecond) {
				return {
					passed: true, // Don't fail, just warn
					severity: "warning",
					action: "warn",
					reason: `Slow output: ${tokensPerSecond.toFixed(1)} tokens/sec < ${minTokensPerSecond}`,
					data: { tokensPerSecond },
				};
			}

			if (maxTokensPerSecond && tokensPerSecond > maxTokensPerSecond) {
				return {
					passed: true,
					severity: "info",
					reason: `Fast output: ${tokensPerSecond.toFixed(1)} tokens/sec > ${maxTokensPerSecond}`,
					data: { tokensPerSecond },
				};
			}

			return { passed: true };
		},
	};
}

// ============================================================================
// Constraint Combinators
// ============================================================================

/**
 * Combine multiple constraints with AND logic.
 * All constraints must pass for the combined constraint to pass.
 */
export function allOf(
	constraints: StreamingConstraint[],
	options: { name?: string; terminateOnFail?: boolean } = {}
): StreamingConstraint {
	const { name = "all-of", terminateOnFail = true } = options;

	return {
		name,
		terminateOnFail,
		async check(ctx) {
			for (const constraint of constraints) {
				const result = await constraint.check(ctx);
				if (!result.passed) {
					return {
						...result,
						reason: `[${constraint.name}] ${result.reason}`,
					};
				}
			}
			return { passed: true };
		},
	};
}

/**
 * Combine multiple constraints with OR logic.
 * At least one constraint must pass for the combined constraint to pass.
 */
export function anyOf(
	constraints: StreamingConstraint[],
	options: { name?: string; terminateOnFail?: boolean } = {}
): StreamingConstraint {
	const { name = "any-of", terminateOnFail = true } = options;

	return {
		name,
		terminateOnFail,
		async check(ctx) {
			const failures: string[] = [];

			for (const constraint of constraints) {
				const result = await constraint.check(ctx);
				if (result.passed) {
					return { passed: true };
				}
				failures.push(`[${constraint.name}] ${result.reason}`);
			}

			return {
				passed: false,
				reason: `All constraints failed: ${failures.join("; ")}`,
				severity: "error",
			};
		},
	};
}

// ============================================================================
// Exports
// ============================================================================

export {
	createStreamingConstraintRunner as createRunner,
	withStreamingConstraints as withConstraints,
	createLengthConstraint as length,
	createFormatConstraint as format,
	createSemanticConstraint as semantic,
	createPIIStreamingConstraint as pii,
	createPatternConstraint as pattern,
	createLatencyConstraint as latency,
};
