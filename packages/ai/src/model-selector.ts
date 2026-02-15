/**
 * P3: Smart Model Selection — Rule-based model routing for AgentRunner.
 *
 * Route simple tasks to cheaper models and complex tasks to expensive ones,
 * reducing cost without sacrificing quality where it matters.
 *
 * Rules are evaluated in order; the first match wins. If no rule matches,
 * the agent's original model is used unchanged.
 *
 * Accepts either a {@link ModelSelectionConfig} object (recommended) or
 * a bare `ModelRule[]` array for convenience.
 *
 * @module
 *
 * @example Config object (recommended)
 * ```typescript
 * import { withModelSelection, byInputLength, byAgentName, byPattern } from '@directive-run/ai';
 *
 * const runner = withModelSelection(baseRunner, {
 *   rules: [
 *     byInputLength(200, "gpt-4o-mini"),
 *     byAgentName("summarizer", "gpt-4o-mini"),
 *     byPattern(/classify|categorize/i, "gpt-4o-mini"),
 *   ],
 *   onModelSelected: (original, selected) => {
 *     if (original !== selected) console.log(`Routed ${original} → ${selected}`);
 *   },
 * });
 * ```
 *
 * @example Shorthand (rules array)
 * ```typescript
 * const runner = withModelSelection(baseRunner, [
 *   byInputLength(200, "gpt-4o-mini"),
 * ]);
 * ```
 */

import type { AgentRunner, AgentLike, RunResult, RunOptions } from "./types.js";

// ============================================================================
// Types
// ============================================================================

/** A single model selection rule. First match wins. */
export interface ModelRule {
  /** Predicate that determines if this rule applies. */
  match: (agent: AgentLike, input: string) => boolean;
  /** The model to use when this rule matches. */
  model: string;
}

/** Configuration for model selection. */
export interface ModelSelectionConfig {
  /** Rules evaluated in order. First match wins. */
  rules: ModelRule[];
  /** Called when a model is selected (even if it matches the original). */
  onModelSelected?: (originalModel: string | undefined, selectedModel: string | undefined) => void;
}

// ============================================================================
// Convenience Matchers
// ============================================================================

/**
 * Match when input character length is at most `maxLength`.
 *
 * @example
 * ```typescript
 * byInputLength(500, "gpt-4o-mini") // inputs up to 500 chars use mini
 * ```
 */
export function byInputLength(maxLength: number, model: string): ModelRule {
  return {
    match: (_agent, input) => input.length <= maxLength,
    model,
  };
}

/**
 * Match by agent name (exact string match).
 *
 * @example
 * ```typescript
 * byAgentName("classifier", "gpt-4o-mini")
 * ```
 */
export function byAgentName(name: string, model: string): ModelRule {
  return {
    match: (agent) => agent.name === name,
    model,
  };
}

/**
 * Match by regex pattern on the input text.
 *
 * @example
 * ```typescript
 * byPattern(/classify|categorize/i, "gpt-4o-mini") // classification prompts use mini
 * ```
 */
export function byPattern(pattern: RegExp, model: string): ModelRule {
  return {
    match: (_agent, input) => {
      // Reset lastIndex for stateful regexes (e.g., /g flag)
      pattern.lastIndex = 0;

      return pattern.test(input);
    },
    model,
  };
}

// ============================================================================
// Wrapper
// ============================================================================

/**
 * Wrap an AgentRunner with rule-based model selection.
 *
 * Rules are evaluated in order. The first match wins and overrides `agent.model`.
 * If no rule matches, the agent's original model is used.
 *
 * Accepts either a config object or a bare `ModelRule[]` for convenience.
 *
 * @example
 * ```typescript
 * // Config object (recommended)
 * const runner = withModelSelection(baseRunner, {
 *   rules: [
 *     byInputLength(200, "gpt-4o-mini"),
 *     byAgentName("summarizer", "gpt-4o-mini"),
 *     byPattern(/classify|categorize/i, "gpt-4o-mini"),
 *   ],
 *   onModelSelected: (original, selected) => {
 *     console.log(`Model: ${original} → ${selected}`);
 *   },
 * });
 *
 * // Shorthand (rules array)
 * const runner = withModelSelection(baseRunner, [
 *   byInputLength(200, "gpt-4o-mini"),
 * ]);
 * ```
 */
export function withModelSelection(
  runner: AgentRunner,
  configOrRules: ModelSelectionConfig | ModelRule[],
): AgentRunner {
  const config = Array.isArray(configOrRules)
    ? { rules: configOrRules }
    : configOrRules;
  const { rules, onModelSelected } = config;

  return async <T = unknown>(
    agent: AgentLike,
    input: string,
    options?: RunOptions,
  ): Promise<RunResult<T>> => {
    let selectedModel = agent.model;

    for (const rule of rules) {
      try {
        if (rule.match(agent, input)) {
          selectedModel = rule.model;
          break;
        }
      } catch {
        // Throwing match function is skipped — do not crash model selection
      }
    }

    try { onModelSelected?.(agent.model, selectedModel); } catch { /* callback error must not disrupt model selection flow */ }

    // Override model if a rule matched and model is different
    const effectiveAgent = selectedModel !== agent.model
      ? { ...agent, model: selectedModel }
      : agent;

    return runner<T>(effectiveAgent, input, options);
  };
}
