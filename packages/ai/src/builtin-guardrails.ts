/**
 * Built-in guardrails for AI adapter — PII, moderation, rate limiting, tool allowlists, schema validation.
 */

import type {
  AgentState,
  GuardrailFn,
  InputGuardrailData,
  OutputGuardrailData,
  SchemaValidator,
  ToolCallGuardrailData,
} from "./types.js";
import { AGENT_KEY } from "./types.js";

// ============================================================================
// Helpers
// ============================================================================

const MAX_STRINGIFY_LENGTH = 100_000;

/** Safely stringify output, handling circular references and truncating large values */
function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const seen = new WeakSet();
    const json = JSON.stringify(value, (_key, val) => {
      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) return "[Circular]";
        seen.add(val);
      }
      return val;
    });
    return json.length > MAX_STRINGIFY_LENGTH
      ? json.slice(0, MAX_STRINGIFY_LENGTH) + "...[truncated]"
      : json;
  } catch {
    return String(value);
  }
}

// ============================================================================
// PII Guardrail
// ============================================================================

/**
 * Create a PII detection guardrail.
 *
 * @example
 * ```typescript
 * const piiGuardrail = createPIIGuardrail({
 *   patterns: [
 *     /\b\d{3}-\d{2}-\d{4}\b/, // SSN
 *     /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, // Email
 *   ],
 *   redact: true,
 * });
 * ```
 */
export function createPIIGuardrail(options: {
  patterns?: RegExp[];
  redact?: boolean;
  redactReplacement?: string;
}): GuardrailFn<InputGuardrailData> {
  const {
    patterns = [
      /\b\d{3}-\d{2}-\d{4}\b/g, // SSN
      /\b\d{16}\b/g, // Credit card
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, // Email
    ],
    redact = false,
    redactReplacement = "[REDACTED]",
  } = options;

  return (data) => {
    let text = data.input;
    let hasPII = false;

    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        hasPII = true;
        if (redact) {
          pattern.lastIndex = 0;
          text = text.replace(pattern, redactReplacement);
        }
      }
    }

    if (hasPII && !redact) {
      return { passed: false, reason: "Input contains PII" };
    }

    return { passed: true, transformed: redact && hasPII ? text : undefined };
  };
}

// ============================================================================
// Moderation Guardrail
// ============================================================================

/**
 * Create a content moderation guardrail.
 *
 * @example
 * ```typescript
 * const moderationGuardrail = createModerationGuardrail({
 *   checkFn: async (text) => {
 *     const result = await openai.moderations.create({ input: text });
 *     return result.results[0].flagged;
 *   },
 * });
 * ```
 */
export function createModerationGuardrail(options: {
  checkFn: (text: string) => boolean | Promise<boolean>;
  message?: string;
}): GuardrailFn<InputGuardrailData | OutputGuardrailData> {
  const { checkFn, message = "Content flagged by moderation" } = options;

  return async (data) => {
    const text =
      "output" in data
        ? typeof data.output === "string"
          ? data.output
          : JSON.stringify(data.output)
        : data.input;

    const flagged = await checkFn(text);

    return { passed: !flagged, reason: flagged ? message : undefined };
  };
}

// ============================================================================
// Rate Limit Guardrail
// ============================================================================

/** Rate limiter with reset capability for testing */
export interface RateLimitGuardrail extends GuardrailFn<InputGuardrailData> {
  reset(): void;
}

/**
 * Create a rate limit guardrail based on token usage.
 * Returns a guardrail function with an additional `reset()` method for testing.
 */
export function createRateLimitGuardrail(options: {
  maxTokensPerMinute?: number;
  maxRequestsPerMinute?: number;
}): RateLimitGuardrail {
  const { maxTokensPerMinute = 100000, maxRequestsPerMinute = 60 } = options;

  const maxEntries = Math.max(maxRequestsPerMinute, 1000);
  let tokenTimestamps: number[] = [];
  let requestTimestamps: number[] = [];
  const windowMs = 60000;

  function findCutoffIndex(arr: number[], cutoffTime: number): number {
    let low = 0;
    let high = arr.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((arr[mid] ?? 0) < cutoffTime) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }

  const guardrail: RateLimitGuardrail = (_data, context) => {
    const now = Date.now();
    const cutoffTime = now - windowMs;

    const tokenCutoff = findCutoffIndex(tokenTimestamps, cutoffTime);
    if (tokenCutoff > 0) {
      tokenTimestamps = tokenTimestamps.slice(tokenCutoff);
    }

    const requestCutoff = findCutoffIndex(requestTimestamps, cutoffTime);
    if (requestCutoff > 0) {
      requestTimestamps = requestTimestamps.slice(requestCutoff);
    }

    const factsObj = context.facts as Record<string, unknown>;
    const agentState = factsObj[AGENT_KEY] as AgentState | undefined;
    const tokenUsage = agentState?.tokenUsage ?? 0;
    const recentTokens = tokenTimestamps.length;
    const recentRequests = requestTimestamps.length;

    if (recentTokens + tokenUsage > maxTokensPerMinute) {
      return { passed: false, reason: "Token rate limit exceeded" };
    }

    if (recentRequests >= maxRequestsPerMinute) {
      return { passed: false, reason: "Request rate limit exceeded" };
    }

    if (requestTimestamps.length < maxEntries) {
      requestTimestamps.push(now);
    }
    if (tokenTimestamps.length < maxEntries) {
      tokenTimestamps.push(now);
    }

    return { passed: true };
  };

  guardrail.reset = () => {
    tokenTimestamps = [];
    requestTimestamps = [];
  };

  return guardrail;
}

// ============================================================================
// Tool Guardrail
// ============================================================================

/**
 * Create a tool allowlist/denylist guardrail.
 */
export function createToolGuardrail(options: {
  allowlist?: string[];
  denylist?: string[];
  /** @default false */
  caseSensitive?: boolean;
}): GuardrailFn<ToolCallGuardrailData> {
  const { allowlist, denylist, caseSensitive = false } = options;

  const normalizedAllowlist = allowlist?.map((t) =>
    caseSensitive ? t : t.toLowerCase(),
  );
  const normalizedDenylist = denylist?.map((t) =>
    caseSensitive ? t : t.toLowerCase(),
  );

  return (data) => {
    const toolName = caseSensitive
      ? data.toolCall.name
      : data.toolCall.name.toLowerCase();

    if (normalizedAllowlist && !normalizedAllowlist.includes(toolName)) {
      return {
        passed: false,
        reason: `Tool "${data.toolCall.name}" not in allowlist`,
      };
    }

    if (normalizedDenylist?.includes(toolName)) {
      return {
        passed: false,
        reason: `Tool "${data.toolCall.name}" is blocked`,
      };
    }

    return { passed: true };
  };
}

// ============================================================================
// Output Schema Guardrail
// ============================================================================

/**
 * Create an output schema validation guardrail.
 */
export function createOutputSchemaGuardrail<T = unknown>(options: {
  validate: SchemaValidator<T>;
  errorPrefix?: string;
}): GuardrailFn<OutputGuardrailData> {
  const { validate, errorPrefix = "Output schema validation failed" } = options;

  return (data) => {
    const result = validate(data.output);

    if (typeof result === "boolean") {
      return {
        passed: result,
        reason: result ? undefined : errorPrefix,
      };
    }

    if (result.valid) {
      return { passed: true };
    }

    const errorMessage = result.errors?.length
      ? `${errorPrefix}: ${result.errors.join("; ")}`
      : errorPrefix;

    return { passed: false, reason: errorMessage };
  };
}

// ============================================================================
// Output Type Guardrail
// ============================================================================

/**
 * Create a simple type check guardrail for common output types.
 */
export function createOutputTypeGuardrail(options: {
  type: "string" | "number" | "boolean" | "object" | "array";
  requiredFields?: string[];
  minLength?: number;
  maxLength?: number;
  minStringLength?: number;
  maxStringLength?: number;
}): GuardrailFn<OutputGuardrailData> {
  const {
    type,
    requiredFields = [],
    minLength,
    maxLength,
    minStringLength,
    maxStringLength,
  } = options;

  return (data) => {
    const output = data.output;

    switch (type) {
      case "string":
        if (typeof output !== "string") {
          return {
            passed: false,
            reason: `Expected string, got ${typeof output}`,
          };
        }
        if (minStringLength !== undefined && output.length < minStringLength) {
          return {
            passed: false,
            reason: `String too short: ${output.length} < ${minStringLength}`,
          };
        }
        if (maxStringLength !== undefined && output.length > maxStringLength) {
          return {
            passed: false,
            reason: `String too long: ${output.length} > ${maxStringLength}`,
          };
        }
        return { passed: true };

      case "number":
        if (typeof output !== "number" || Number.isNaN(output)) {
          return {
            passed: false,
            reason: `Expected number, got ${typeof output}`,
          };
        }
        return { passed: true };

      case "boolean":
        if (typeof output !== "boolean") {
          return {
            passed: false,
            reason: `Expected boolean, got ${typeof output}`,
          };
        }
        return { passed: true };

      case "object":
        if (
          typeof output !== "object" ||
          output === null ||
          Array.isArray(output)
        ) {
          return {
            passed: false,
            reason: `Expected object, got ${Array.isArray(output) ? "array" : typeof output}`,
          };
        }
        for (const field of requiredFields) {
          if (!(field in output)) {
            return {
              passed: false,
              reason: `Missing required field: ${field}`,
            };
          }
        }
        return { passed: true };

      case "array":
        if (!Array.isArray(output)) {
          return {
            passed: false,
            reason: `Expected array, got ${typeof output}`,
          };
        }
        if (minLength !== undefined && output.length < minLength) {
          return {
            passed: false,
            reason: `Array too short: ${output.length} < ${minLength}`,
          };
        }
        if (maxLength !== undefined && output.length > maxLength) {
          return {
            passed: false,
            reason: `Array too long: ${output.length} > ${maxLength}`,
          };
        }
        return { passed: true };

      default:
        return { passed: false, reason: `Unknown type: ${type}` };
    }
  };
}

// ============================================================================
// Length Guardrail
// ============================================================================

/**
 * Create a length guardrail that limits output size.
 *
 * @example
 * ```typescript
 * const lengthGuardrail = createLengthGuardrail({
 *   maxCharacters: 5000,
 * });
 * ```
 */
export function createLengthGuardrail(options: {
  /** Maximum characters in output */
  maxCharacters?: number;
  /** Maximum estimated tokens in output */
  maxTokens?: number;
  /** Custom token estimator (default: chars / 4) */
  estimateTokens?: (text: string) => number;
}): GuardrailFn<OutputGuardrailData> {
  const {
    maxCharacters,
    maxTokens,
    estimateTokens = (text: string) => Math.ceil(text.length / 4),
  } = options;

  return (data) => {
    const text = safeStringify(data.output);

    if (maxCharacters !== undefined && text.length > maxCharacters) {
      return {
        passed: false,
        reason: `Output too long: ${text.length} characters (max: ${maxCharacters})`,
      };
    }

    if (maxTokens !== undefined) {
      const tokens = estimateTokens(text);
      if (tokens > maxTokens) {
        return {
          passed: false,
          reason: `Output too long: ~${tokens} tokens (max: ${maxTokens})`,
        };
      }
    }

    return { passed: true };
  };
}

// ============================================================================
// Content Filter Guardrail
// ============================================================================

/**
 * Create a content filter guardrail that blocks output matching specific patterns.
 *
 * @example
 * ```typescript
 * const contentFilter = createContentFilterGuardrail({
 *   blockedPatterns: [
 *     /\bpassword\b/i,
 *     /\bsecret\b/i,
 *     'internal-only',
 *   ],
 * });
 * ```
 */
export function createContentFilterGuardrail(options: {
  /** Patterns to block — strings or RegExp */
  blockedPatterns: Array<string | RegExp>;
  /** Case-sensitive matching for string patterns (default: false) */
  caseSensitive?: boolean;
}): GuardrailFn<OutputGuardrailData> {
  const { blockedPatterns, caseSensitive = false } = options;

  if (blockedPatterns.length === 0) {
    console.warn(
      "[Directive] createContentFilterGuardrail: blockedPatterns is empty — no content will be filtered",
    );
  }

  const compiledPatterns = blockedPatterns.map((p) => {
    if (p instanceof RegExp) return p;
    const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(escaped, caseSensitive ? "g" : "gi");
  });

  return (data) => {
    const text = safeStringify(data.output);

    for (const pattern of compiledPatterns) {
      pattern.lastIndex = 0; // Reset required for global flags across iterations
      if (pattern.test(text)) {
        return {
          passed: false,
          reason: `Output contains blocked content matching: ${pattern.source}`,
        };
      }
    }

    return { passed: true };
  };
}
