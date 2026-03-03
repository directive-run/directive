/**
 * P6: Structured Outputs — Schema validation with auto-retry for LLM responses.
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

import type { AgentRunner, AgentLike, RunResult, RunOptions } from "./types.js";

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
}

// ============================================================================
// Helpers
// ============================================================================

/** Maximum output length to process (1MB). */
const MAX_EXTRACT_LENGTH = 1_048_576;

/** Default JSON extractor — finds the first `{...}` or `[...]` in output. */
export function extractJsonFromOutput(output: string): unknown {
  if (output.length > MAX_EXTRACT_LENGTH) {
    throw new Error(`[Directive] Output too large for JSON extraction (${output.length} chars, max ${MAX_EXTRACT_LENGTH}).`);
  }

  const trimmed = output.trim();

  // Try direct parse first
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue to extraction
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

        try {
          return JSON.parse(jsonStr);
        } catch {
          // LLMs emit literal newlines inside JSON string values — escape them
          const sanitized = jsonStr.replace(
            /"(?:[^"\\]|\\.)*"/g,
            (match) =>
              match
                .replace(/\n/g, "\\n")
                .replace(/\r/g, "\\r")
                .replace(/\t/g, "\\t"),
          );

          return JSON.parse(sanitized);
        }
      }
    }
  }

  throw new Error("[Directive] No valid JSON found in output");
}

/** Format validation errors for feedback. */
function formatValidationError(error: SafeParseResult<unknown>["error"]): string {
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
  } = config;

  // Validate config
  if (!Number.isFinite(maxRetries) || maxRetries < 0) {
    throw new Error("[Directive] withStructuredOutput: maxRetries must be a non-negative finite number.");
  }

  const schemaPrompt = schemaDescription ?? schema.description ?? "the specified JSON schema";

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
      instructions: (agent.instructions ?? "") +
        "\n\nIMPORTANT: Respond with valid JSON matching " + schemaPrompt + ". " +
        "Output ONLY the JSON object, no additional text or markdown formatting.",
    };

    let lastResult: RunResult<unknown> | undefined;
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // On retries, append error feedback as additional input
      const effectiveInput = attempt === 0
        ? input
        : `${input}\n\nYour previous response was not valid JSON. Error: ${lastError}\nPlease try again with valid JSON only.`;

      const result = await runner(structuredAgent, effectiveInput, options);
      lastResult = result;

      // Try to extract and validate JSON
      const outputStr = typeof result.output === "string"
        ? result.output
        : JSON.stringify(result.output);

      try {
        const extracted = extractJson(outputStr);
        const parsed = schema.safeParse(extracted);

        if (parsed.success) {
          return {
            ...result,
            output: parsed.data as _T,
          };
        }

        lastError = formatValidationError(parsed.error);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    // All retries exhausted — throw with context
    throw new StructuredOutputError(
      `[Directive] Failed to get valid structured output after ${maxRetries + 1} attempts: ${lastError}`,
      lastResult,
    );
  };
}

/** Error thrown when structured output parsing fails after all retries. */
export class StructuredOutputError extends Error {
  readonly lastResult: RunResult<unknown> | undefined;

  constructor(message: string, lastResult?: RunResult<unknown>) {
    super(message);
    this.name = "StructuredOutputError";
    this.lastResult = lastResult;
  }
}
