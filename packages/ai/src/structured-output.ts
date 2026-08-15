/**
 * Structured Outputs — Schema validation with auto-retry for LLM responses.
 *
 * Turns unreliable text output into typed, validated data. Appends JSON schema
 * instructions to the system prompt and retries with error feedback on parse failure.
 *
 * Works with any Zod-compatible schema (any object with a `safeParse` method).
 *
 * @module
 *
 * @example
 * ```typescript
 * import { z } from "zod";
 * import { withStructuredOutput, StructuredOutputError } from '@directive-run/ai';
 *
 * const SentimentSchema = z.object({
 *   sentiment: z.enum(["positive", "negative", "neutral"]),
 *   confidence: z.number().min(0).max(1),
 * });
 *
 * const runner = withStructuredOutput(baseRunner, {
 *   schema: SentimentSchema,
 *   maxRetries: 2,
 * });
 *
 * const result = await runner(agent, "Analyze: I love this product!");
 * // result.output is typed as { sentiment: string; confidence: number }
 * ```
 */

import { isPrototypeSafe } from "@directive-run/core/internals";
import { normalizeTokenUsage } from "@directive-run/core/plugins";
import type { AgentLike, AgentRunner, RunOptions, RunResult } from "./types.js";

/**
 * Guard against prototype pollution in LLM-extracted JSON. LLM output is
 * attacker-controllable via prompt injection — payloads like
 * `{"__proto__":{"polluted":true}}` would otherwise seed pollution downstream.
 */
function assertPrototypeSafe(value: unknown): void {
  if (!isPrototypeSafe(value)) {
    throw new Error(
      "[Directive] structured-output: extracted JSON contains unsafe prototype keys",
    );
  }
}

// ============================================================================
// Types
// ============================================================================

/**
 * Zod-compatible schema duck type — any object with a `safeParse` method.
 *
 * This interface allows structured outputs to work with Zod, Valibot,
 * or any validation library that implements this pattern.
 *
 * @example
 * ```typescript
 * import { z } from "zod";
 *
 * // Zod schemas implement SafeParseable automatically
 * const schema = z.object({ name: z.string() });
 *
 * // Custom schema
 * const custom: SafeParseable<{ name: string }> = {
 *   safeParse(value) {
 *     if (typeof value === "object" && value && "name" in value) {
 *       return { success: true, data: value as { name: string } };
 *     }
 *     return { success: false, error: { message: "Missing name field" } };
 *   },
 * };
 * ```
 */
export interface SafeParseable<T = unknown> {
  safeParse(value: unknown): SafeParseResult<T>;
  /** Optional: schema description injected into the system prompt. */
  description?: string;
}

export interface SafeParseResult<T> {
  success: boolean;
  data?: T;
  error?: { message?: string; issues?: Array<{ message: string }> };
}

export interface StructuredOutputConfig<T = unknown> {
  /** Zod-compatible schema with safeParse. */
  schema: SafeParseable<T>;
  /** Max retries on parse/validation failure. @default 2 */
  maxRetries?: number;
  /** Custom JSON extractor. Default: finds first `{...}` or `[...]` in output. */
  extractJson?: (output: string) => unknown;
  /** Schema description to inject into system prompt. Auto-derived from schema.description if available. */
  schemaDescription?: string;
  /**
   * Called just before the runner is re-invoked because the previous response
   * did not satisfy the schema. `attempt` is the 1-based number of the attempt
   * that just failed and `error` is the validation message fed back to the
   * model.
   *
   * A re-invocation replays the whole response, so a consumer streaming deltas
   * needs to know the earlier ones are void. Best-effort – a throw from here is
   * swallowed rather than failing the run.
   */
  onRetry?: (attempt: number, error: string) => void;
}

// ============================================================================
// Helpers
// ============================================================================

/** Maximum output length to process (1MB). */
const MAX_EXTRACT_LENGTH = 1_048_576;

/** Default JSON extractor — finds the first `{...}` or `[...]` in output. */
export function extractJsonFromOutput(output: string): unknown {
  if (output.length > MAX_EXTRACT_LENGTH) {
    throw new Error(
      `[Directive] Output too large for JSON extraction (${output.length} chars, max ${MAX_EXTRACT_LENGTH}).`,
    );
  }

  const trimmed = output.trim();

  // Try direct parse first
  try {
    const parsed = JSON.parse(trimmed);
    assertPrototypeSafe(parsed);

    return parsed;
  } catch (err) {
    // Re-throw prototype-safety errors immediately — they are NOT parse errors
    if (
      err instanceof Error &&
      err.message.startsWith("[Directive] structured-output:")
    ) {
      throw err;
    }
    // Continue to extraction on plain parse failures
  }

  // Try to find JSON object or array
  const objectStart = trimmed.indexOf("{");
  const arrayStart = trimmed.indexOf("[");

  let start: number;
  let openChar: string;
  let closeChar: string;

  if (objectStart === -1 && arrayStart === -1) {
    throw new Error("[Directive] No JSON object or array found in output");
  }

  if (objectStart === -1) {
    start = arrayStart;
    openChar = "[";
    closeChar = "]";
  } else if (arrayStart === -1) {
    start = objectStart;
    openChar = "{";
    closeChar = "}";
  } else {
    start = Math.min(objectStart, arrayStart);
    openChar = start === objectStart ? "{" : "[";
    closeChar = start === objectStart ? "}" : "]";
  }

  // Find matching closing bracket
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < trimmed.length; i++) {
    const char = trimmed[i]!;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === openChar) {
      depth++;
    } else if (char === closeChar) {
      depth--;
      if (depth === 0) {
        const jsonStr = trimmed.slice(start, i + 1);

        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonStr);
        } catch {
          // LLMs emit literal newlines inside JSON string values — escape them
          const sanitized = jsonStr.replace(/"(?:[^"\\]|\\.)*"/g, (match) =>
            match
              .replace(/\n/g, "\\n")
              .replace(/\r/g, "\\r")
              .replace(/\t/g, "\\t"),
          );

          parsed = JSON.parse(sanitized);
        }

        assertPrototypeSafe(parsed);

        return parsed;
      }
    }
  }

  throw new Error("[Directive] No valid JSON found in output");
}

/** Format validation errors for feedback. */
function formatValidationError(
  error: SafeParseResult<unknown>["error"],
): string {
  if (!error) {
    return "Validation failed";
  }

  if (error.issues && error.issues.length > 0) {
    return error.issues.map((issue) => issue.message).join("; ");
  }

  return error.message ?? "Validation failed";
}

// ============================================================================
// Wrapper
// ============================================================================

/**
 * Wrap an AgentRunner with structured output parsing and validation.
 *
 * @example
 * ```typescript
 * import { z } from "zod";
 *
 * const SentimentSchema = z.object({
 *   sentiment: z.enum(["positive", "negative", "neutral"]),
 *   confidence: z.number().min(0).max(1),
 * });
 *
 * const runner = withStructuredOutput(baseRunner, {
 *   schema: SentimentSchema,
 *   maxRetries: 2,
 * });
 *
 * const result = await runner(agent, "Analyze: I love this product!");
 * // result.output is typed as { sentiment: string; confidence: number }
 * ```
 */
export function withStructuredOutput<T = unknown>(
  runner: AgentRunner,
  config: StructuredOutputConfig<T>,
): AgentRunner {
  const {
    schema,
    maxRetries = 2,
    extractJson = extractJsonFromOutput,
    schemaDescription,
    onRetry,
  } = config;

  // Validate config
  if (!Number.isFinite(maxRetries) || maxRetries < 0) {
    throw new Error(
      "[Directive] withStructuredOutput: maxRetries must be a non-negative finite number.",
    );
  }

  const schemaPrompt =
    schemaDescription ?? schema.description ?? "the specified JSON schema";

  // The returned runner produces `T` from the schema. We cast at the
  // boundary to satisfy the `AgentRunner` generic while keeping output type-safe.
  return async <_T = unknown>(
    agent: AgentLike,
    input: string,
    options?: RunOptions,
  ): Promise<RunResult<_T>> => {
    // Append JSON instruction to agent's system prompt
    const structuredAgent: AgentLike = {
      ...agent,
      instructions: `${agent.instructions ?? ""}\n\nIMPORTANT: Respond with valid JSON matching ${schemaPrompt}. Output ONLY the JSON object, no additional text or markdown formatting.`,
    };

    let lastResult: RunResult<unknown> | undefined;
    let lastError: string | undefined;

    // Every attempt is billed, so every attempt is counted.
    //
    // A re-prompt is invisible from outside this wrapper: it produces no event,
    // no separate result, and no other record. Reporting only the attempt that
    // finally parsed treated the failed ones as free, which under-counts by the
    // retry rate — highest exactly when a model is struggling and costing the
    // most. The same reasoning applies on the throwing exit, where the run
    // produced nothing usable and still has to be paid for.
    let spentTokens = 0;
    let spentInput = 0;
    let spentOutput = 0;
    let spentCacheRead = 0;
    let spentCacheWrite = 0;
    let sawUsageBreakdown = false;
    let attempts = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // On retries, append error feedback as additional input
      const effectiveInput =
        attempt === 0
          ? input
          : `${input}\n\nYour previous response was not valid JSON. Error: ${lastError}\nPlease try again with valid JSON only.`;

      if (attempt > 0) {
        try {
          onRetry?.(attempt, lastError ?? "");
        } catch {
          // Observability hook – a throw here must not fail the run.
        }
        // This attempt re-prompts and replays the whole response, so a caller
        // streaming deltas has to discard what it rendered from the last one.
        try {
          options?.onStreamRestart?.("schema-retry");
        } catch {
          // Observability hook – a throw here must not fail the run.
        }
      }

      const result = await runner(structuredAgent, effectiveInput, options);
      lastResult = result;
      attempts += 1;
      spentTokens += result.totalTokens ?? 0;
      if (result.tokenUsage) {
        sawUsageBreakdown = true;
        // Read through `normalizeTokenUsage` rather than off the object.
        //
        // Cache writes arrive under two spellings, and reconciling them lives
        // in exactly one function on purpose. A hand-rolled
        // `cacheWriteTokens ?? cacheCreationTokens` here looks equivalent and
        // is not: the real rule takes the larger of the two, so the shortcut
        // under-counts whenever both are present and the older spelling is
        // bigger. Cache reads are priced separately from ordinary input, so
        // dropping them would under-count a cached run on exactly the provider
        // where caching saves the most.
        const usage = normalizeTokenUsage(result.tokenUsage);
        spentInput += usage.inputTokens ?? 0;
        spentOutput += usage.outputTokens ?? 0;
        spentCacheRead += usage.cacheReadTokens ?? 0;
        spentCacheWrite += usage.cacheWriteTokens ?? 0;
      }

      // Try to extract and validate JSON
      const outputStr =
        typeof result.output === "string"
          ? result.output
          : JSON.stringify(result.output);

      try {
        const extracted = extractJson(outputStr);
        const parsed = schema.safeParse(extracted);

        if (parsed.success) {
          return {
            ...result,
            output: parsed.data as _T,
            totalTokens: spentTokens,
            ...(sawUsageBreakdown
              ? {
                  tokenUsage: {
                    ...result.tokenUsage,
                    inputTokens: spentInput,
                    outputTokens: spentOutput,
                    ...(spentCacheRead > 0
                      ? { cacheReadTokens: spentCacheRead }
                      : {}),
                    ...(spentCacheWrite > 0
                      ? { cacheWriteTokens: spentCacheWrite }
                      : {}),
                  },
                }
              : {}),
            structuredOutputAttempts: attempts,
          };
        }

        lastError = formatValidationError(parsed.error);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    // All retries exhausted — throw with context, including the bill. A run
    // that produced nothing usable still spent, and this is the only place
    // that number survives.
    throw new StructuredOutputError(
      `[Directive] Failed to get valid structured output after ${maxRetries + 1} attempts: ${lastError}`,
      lastResult,
      { totalTokens: spentTokens, attempts },
    );
  };
}

/** Error thrown when structured output parsing fails after all retries. */
export class StructuredOutputError extends Error {
  readonly lastResult: RunResult<unknown> | undefined;
  /**
   * Tokens billed across every attempt, including the ones that failed to
   * parse.
   *
   * `lastResult` carries one attempt. This carries the call. A run that ends
   * here produced nothing a caller can use and still cost money, so this is
   * the number a ledger needs and the only place it survives.
   */
  readonly totalTokens: number;
  /** How many times the provider was called before giving up. */
  readonly attempts: number;

  constructor(
    message: string,
    lastResult?: RunResult<unknown>,
    spend?: { totalTokens: number; attempts: number },
  ) {
    super(message);
    this.name = "StructuredOutputError";
    this.lastResult = lastResult;
    this.totalTokens = spend?.totalTokens ?? lastResult?.totalTokens ?? 0;
    this.attempts = spend?.attempts ?? (lastResult ? 1 : 0);
  }
}
