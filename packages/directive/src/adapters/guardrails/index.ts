/**
 * Guardrails - Security and safety guardrails for AI agents
 *
 * This module provides comprehensive guardrails for:
 * - Prompt injection detection and prevention
 * - Enhanced PII detection with pluggable backends
 * - Output sanitization
 * - Rate limiting and abuse prevention
 *
 * @example
 * ```typescript
 * import {
 *   createPromptInjectionGuardrail,
 *   createEnhancedPIIGuardrail,
 *   createOutputSanitizer,
 * } from 'directive/guardrails';
 *
 * const orchestrator = createAgentOrchestrator({
 *   guardrails: {
 *     input: [
 *       createPromptInjectionGuardrail({ strictMode: true }),
 *       createEnhancedPIIGuardrail({ redact: true }),
 *     ],
 *     output: [
 *       createOutputSanitizer(),
 *     ],
 *   },
 * });
 * ```
 */

// Prompt injection detection
export {
  createPromptInjectionGuardrail,
  createUntrustedContentGuardrail,
  detectPromptInjection,
  sanitizeInjection,
  markUntrustedContent,
  DEFAULT_INJECTION_PATTERNS,
  STRICT_INJECTION_PATTERNS,
  type InjectionPattern,
  type InjectionCategory,
  type InjectionDetectionResult,
  type PromptInjectionGuardrailOptions,
} from "./prompt-injection.js";

// Enhanced PII detection
export {
  createEnhancedPIIGuardrail,
  createOutputPIIGuardrail,
  detectPII,
  redactPII,
  regexDetector,
  type PIIType,
  type DetectedPII,
  type PIIDetectionResult,
  type PIIDetector,
  type RedactionStyle,
  type EnhancedPIIGuardrailOptions,
} from "./pii-enhanced.js";

// Semantic caching
export {
  createSemanticCache,
  createSemanticCacheGuardrail,
  createInMemoryStorage,
  createTestEmbedder,
  createBatchedEmbedder,
  cosineSimilarity,
  type SemanticCache,
  type SemanticCacheConfig,
  type SemanticCacheStorage,
  type CacheEntry,
  type CacheLookupResult,
  type CacheStats,
  type Embedding,
  type EmbedderFn,
  type SemanticCacheGuardrailData,
  type SemanticCacheGuardrailResult,
} from "./semantic-cache.js";

// Streaming constraints
export {
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
  DEFAULT_CONSTRAINT_INTERVAL,
  type StreamingConstraint,
  type StreamingConstraintContext,
  type StreamingConstraintResult,
  type StreamingConstraintRunnerConfig,
  type StreamingConstraintViolatedChunk,
} from "./streaming-constraints.js";

// Re-export existing guardrails from main module for convenience
export {
  createPIIGuardrail,
  createModerationGuardrail,
  createRateLimitGuardrail,
  createToolGuardrail,
  createLengthGuardrail,
  createContentFilterGuardrail,
} from "../ai/index.js";

// ============================================================================
// Output Sanitization
// ============================================================================

import type { GuardrailFn, OutputGuardrailData, GuardrailResult } from "../ai/index.js";
import { detectPromptInjection, STRICT_INJECTION_PATTERNS } from "./prompt-injection.js";

/** Options for output sanitizer */
export interface OutputSanitizerOptions {
  /** Strip injection patterns from output */
  stripInjectionPatterns?: boolean;
  /** Maximum output length (characters) */
  maxLength?: number;
  /** Strip markdown code blocks that could contain executable code */
  stripCodeBlocks?: boolean;
  /** Strip URLs */
  stripUrls?: boolean;
  /** Custom sanitization function */
  customSanitizer?: (text: string) => string;
  /** Callback when sanitization occurs */
  onSanitized?: (original: string, sanitized: string, reasons: string[]) => void;
}

/**
 * Create an output sanitizer guardrail.
 *
 * Sanitizes agent output by:
 * - Removing injection patterns that might affect downstream processing
 * - Enforcing length limits
 * - Optionally stripping code blocks or URLs
 *
 * @example
 * ```typescript
 * const sanitizer = createOutputSanitizer({
 *   maxLength: 10000,
 *   stripInjectionPatterns: true,
 * });
 * ```
 */
export function createOutputSanitizer(
  options: OutputSanitizerOptions = {}
): GuardrailFn<OutputGuardrailData> {
  const {
    stripInjectionPatterns = true,
    maxLength,
    stripCodeBlocks = false,
    stripUrls = false,
    customSanitizer,
    onSanitized,
  } = options;

  return (data): GuardrailResult => {
    let text = typeof data.output === "string" ? data.output : JSON.stringify(data.output);
    const original = text;
    const reasons: string[] = [];

    // Strip injection patterns
    if (stripInjectionPatterns) {
      const detection = detectPromptInjection(text, STRICT_INJECTION_PATTERNS);
      if (detection.detected) {
        for (const pattern of detection.patterns) {
          text = text.replace(new RegExp(pattern.match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[SANITIZED]');
        }
        reasons.push(`injection-patterns:${detection.patterns.length}`);
      }
    }

    // Strip code blocks
    if (stripCodeBlocks) {
      const codeBlockRegex = /```[\s\S]*?```/g;
      if (codeBlockRegex.test(text)) {
        text = text.replace(codeBlockRegex, '[CODE REMOVED]');
        reasons.push('code-blocks');
      }
    }

    // Strip URLs
    if (stripUrls) {
      const urlRegex = /https?:\/\/[^\s)>\]]+/gi;
      if (urlRegex.test(text)) {
        text = text.replace(urlRegex, '[URL REMOVED]');
        reasons.push('urls');
      }
    }

    // Apply max length
    if (maxLength && text.length > maxLength) {
      text = text.slice(0, maxLength) + '... [TRUNCATED]';
      reasons.push(`length:${original.length}>${maxLength}`);
    }

    // Apply custom sanitizer
    if (customSanitizer) {
      const customResult = customSanitizer(text);
      if (customResult !== text) {
        text = customResult;
        reasons.push('custom');
      }
    }

    // Report if changes were made
    if (text !== original) {
      onSanitized?.(original, text, reasons);

      // Return transformed output
      return {
        passed: true,
        transformed: typeof data.output === "string" ? text : JSON.parse(text),
      };
    }

    return { passed: true };
  };
}

// ============================================================================
// Guardrail Composition
// ============================================================================

/**
 * Combine multiple guardrails into one.
 * Runs all guardrails and fails if any fail.
 *
 * @example
 * ```typescript
 * const combined = composeGuardrails([
 *   createPromptInjectionGuardrail(),
 *   createEnhancedPIIGuardrail(),
 * ], { name: 'security-suite' });
 * ```
 */
export function composeGuardrails<T>(
  guardrails: GuardrailFn<T>[],
  options: {
    /** Name for debugging */
    name?: string;
    /** Continue checking even after a failure (collect all failures) */
    collectAllFailures?: boolean;
  } = {}
): GuardrailFn<T> {
  const { name = 'composed', collectAllFailures = false } = options;

  return async (data, context): Promise<GuardrailResult> => {
    const failures: string[] = [];
    let currentData = data;

    for (const guardrail of guardrails) {
      const result = await guardrail(currentData, context);

      if (!result.passed) {
        if (!collectAllFailures) {
          return result;
        }
        failures.push(result.reason || 'Unknown failure');
      } else if (result.transformed !== undefined) {
        // Apply transformation and continue
        currentData = { ...currentData, input: result.transformed } as T;
      }
    }

    if (failures.length > 0) {
      return {
        passed: false,
        reason: `[${name}] Multiple failures: ${failures.join('; ')}`,
      };
    }

    // Return any accumulated transformations
    if (currentData !== data && typeof data === 'object' && data !== null && 'input' in data) {
      return {
        passed: true,
        transformed: (currentData as Record<string, unknown>).input,
      };
    }

    return { passed: true };
  };
}

/**
 * Create a conditional guardrail that only runs when a condition is met.
 *
 * @example
 * ```typescript
 * const conditionalPII = conditionalGuardrail(
 *   createEnhancedPIIGuardrail(),
 *   (data) => data.agentName === 'customer-support'
 * );
 * ```
 */
export function conditionalGuardrail<T>(
  guardrail: GuardrailFn<T>,
  condition: (data: T) => boolean | Promise<boolean>
): GuardrailFn<T> {
  return async (data, context): Promise<GuardrailResult> => {
    const shouldRun = await condition(data);
    if (!shouldRun) {
      return { passed: true };
    }
    return guardrail(data, context);
  };
}

/**
 * Create a guardrail with retry logic.
 *
 * @example
 * ```typescript
 * const retryablePII = retryableGuardrail(
 *   createEnhancedPIIGuardrail({ detector: externalService }),
 *   { maxRetries: 3, delayMs: 100 }
 * );
 * ```
 */
export function retryableGuardrail<T>(
  guardrail: GuardrailFn<T>,
  options: {
    maxRetries?: number;
    delayMs?: number;
    /** Only retry on errors, not on guardrail failures */
    retryOnErrorOnly?: boolean;
  } = {}
): GuardrailFn<T> {
  const { maxRetries = 3, delayMs = 100, retryOnErrorOnly = true } = options;

  return async (data, context): Promise<GuardrailResult> => {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await guardrail(data, context);

        // If retryOnErrorOnly, don't retry guardrail failures
        if (!result.passed && retryOnErrorOnly) {
          return result;
        }

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
        }
      }
    }

    // If we exhausted retries due to errors, fail
    return {
      passed: false,
      reason: `Guardrail failed after ${maxRetries} retries: ${lastError?.message}`,
    };
  };
}
