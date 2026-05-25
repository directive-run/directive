/**
 * Predicate-from-intent subpath export.
 *
 * Tree-shakable entry for the LLM-emit-predicate surface: convert natural-language
 * intent into typed `FactPredicate` values, with optional provenance + tool specs
 * for Anthropic / OpenAI tool calling.
 *
 * @example
 * ```typescript
 * import { predicateFromIntent, predicateToolSpecAnthropic } from "@directive-run/ai/predicate";
 * ```
 */

export {
  predicateFromIntent,
  predicateFromIntentRaw,
  predicateFromIntentWithProvenance,
  predicateToolSpec,
  predicateToolSpecAnthropic,
  predicateToolSpecOpenAI,
  PredicateFromIntentError,
  type PredicateFromIntentOptions,
  type PredicateFromIntentDiagnostics,
  type PredicateFromIntentProvenance,
  type PredicateFromIntentWithProvenanceResult,
  type PredicateToolSpec,
  type PredicateToolSpecAnthropic,
  type PredicateToolSpecOpenAI,
  type PredicateToolSpecOptions,
} from "./predicate-from-intent.js";
