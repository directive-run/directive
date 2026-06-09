/**
 * Guardrails subpath export.
 *
 * Tree-shakable entry for guardrail primitives: builtin guardrails (PII, moderation,
 * rate limit, tool, output schema/type, length, content filter), prompt-injection
 * detection, enhanced PII detect/redact, ANN index, and semantic cache.
 *
 * @example
 * ```typescript
 * import { createPIIGuardrail, createPromptInjectionGuardrail } from "@directive-run/ai/guardrails";
 * ```
 */

// Built-in Guardrails
export {
  createPIIGuardrail,
  createModerationGuardrail,
  createRateLimitGuardrail,
  createToolGuardrail,
  createOutputSchemaGuardrail,
  createOutputTypeGuardrail,
  createLengthGuardrail,
  createContentFilterGuardrail,
  type RateLimitGuardrail,
} from "./builtin-guardrails.js";

// Prompt Injection Guardrails
export {
  createPromptInjectionGuardrail,
  createUntrustedContentGuardrail,
  detectPromptInjection,
  sanitizeInjection,
  markUntrustedContent,
  DEFAULT_INJECTION_PATTERNS,
  STRICT_INJECTION_PATTERNS,
  type PromptInjectionGuardrailOptions,
  type InjectionDetectionResult,
} from "./guardrails/prompt-injection.js";

// Enhanced PII Guardrails
export {
  createEnhancedPIIGuardrail,
  createOutputPIIGuardrail,
  detectPII,
  detectAndRedactPII,
  redactPII,
  type EnhancedPIIGuardrailOptions,
  type PIIDetectionResult,
  type DetectedPII,
  type PIIType,
  type PIIDetector,
  type RedactionStyle,
} from "./guardrails/pii-enhanced.js";

// ANN Index
export {
  createBruteForceIndex,
  createVPTreeIndex,
  type ANNIndex,
  type ANNSearchResult,
  type VPTreeIndexConfig,
} from "./guardrails/ann-index.js";

// Fact-PII Guardrail — the Tier 0 Mandatory Companion to liveContext.
// Closes the source → fact → agent-prompt PII bypass. See ai-sources.md
// "Sources × Security" for the full recipe.
export {
  createFactPIIGuardrail,
  type FactPIIGuardrailMode,
  type FactPIIGuardrailOptions,
  type FactPIICategory,
  type FactPIIMatch,
} from "./guardrails/fact-pii.js";

// Semantic Cache
export {
  createSemanticCache,
  createSemanticCacheGuardrail,
  createBatchedEmbedder,
  createTestEmbedder,
  createInMemoryStorage,
  type Embedding,
  type SemanticCache,
  type SemanticCacheConfig,
  type CacheEntry,
  type CacheLookupResult,
  type CacheStats,
  type SemanticCacheStorage,
  type BatchedEmbedder,
  type EmbedderFn,
} from "./guardrails/semantic-cache.js";
