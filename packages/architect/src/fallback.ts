/**
 * LLM Fallback & Degradation — graceful degradation when the LLM fails.
 *
 * Instead of throwing, the architect falls back to cached responses,
 * heuristic rules, or blocks all actions. Strategies are tried in
 * order until one handles the failure.
 */

import type { ActionReasoning, ArchitectAnalysis } from "./types.js";

// ============================================================================
// Types
// ============================================================================

/** Context passed to fallback strategies. */
export interface FallbackContext {
  /** The error that caused the LLM call to fail. */
  error: Error;
  /** What triggered the analysis. */
  trigger: ArchitectAnalysis["trigger"];
  /** The prompt that was sent to the LLM. */
  prompt: string;
  /** Current system state snapshot. */
  systemState: unknown;
  /** Number of consecutive LLM failures. */
  consecutiveFailures: number;
  /** Remaining budget. */
  budgetRemaining: { tokens: number; dollars: number };
}

/** Result from a fallback strategy. */
export interface FallbackResult {
  /** Which strategy produced this result. */
  strategy: string;
  /** Tool calls to execute (empty = no action). */
  toolCalls: Array<{ name: string; arguments: string }>;
  /** Reasoning to attach to the fallback actions. */
  reasoning: ActionReasoning;
  /** Tokens "used" for budget tracking (typically 0). */
  tokensUsed: number;
}

/** A fallback strategy that handles LLM failures. */
export interface FallbackStrategy {
  /** Strategy name for logging/events. */
  name: string;
  /** Handle a failure. Return null to pass to the next strategy. */
  handle(context: FallbackContext): FallbackResult | null;
}

/** Configuration for fallback behavior. */
export interface FallbackConfig {
  /** Ordered list of strategies. Default: [cachedResponseStrategy(), blockStrategy()] */
  strategies?: FallbackStrategy[];
  /** After this many consecutive failures, force block. Default: 5 */
  maxConsecutiveFailures?: number;
}

// ============================================================================
// Built-in Strategies
// ============================================================================

interface CachedEntry {
  trigger: ArchitectAnalysis["trigger"];
  toolCalls: Array<{ name: string; arguments: string }>;
  reasoning: ActionReasoning;
  timestamp: number;
}

/**
 * Cache successful LLM responses. On failure, replay the most recent
 * cached response for the same trigger type.
 */
export function cachedResponseStrategy(opts?: {
  /** Max cached entries per trigger type. Default: 5 */
  maxPerTrigger?: number;
  /** Max age of cached entries in ms. Default: 3600000 (1h) */
  maxAgeMs?: number;
}): FallbackStrategy & {
  /** Cache a successful response for later replay. */
  cache(trigger: ArchitectAnalysis["trigger"], toolCalls: Array<{ name: string; arguments: string }>, reasoning: ActionReasoning): void;
  /** Get the number of cached entries. */
  size(): number;
} {
  const maxPerTrigger = opts?.maxPerTrigger ?? 5;
  const maxAgeMs = opts?.maxAgeMs ?? 3_600_000;
  const entries = new Map<string, CachedEntry[]>();

  function cache(
    trigger: ArchitectAnalysis["trigger"],
    toolCalls: Array<{ name: string; arguments: string }>,
    reasoning: ActionReasoning,
  ): void {
    let triggerEntries = entries.get(trigger);
    if (!triggerEntries) {
      triggerEntries = [];
      entries.set(trigger, triggerEntries);
    }

    triggerEntries.push({
      trigger,
      toolCalls,
      reasoning,
      timestamp: Date.now(),
    });

    // Evict oldest if over limit
    while (triggerEntries.length > maxPerTrigger) {
      triggerEntries.shift();
    }
  }

  function size(): number {
    let total = 0;
    for (const triggerEntries of entries.values()) {
      total += triggerEntries.length;
    }

    return total;
  }

  return {
    name: "cached",
    cache,
    size,
    handle(context: FallbackContext): FallbackResult | null {
      const triggerEntries = entries.get(context.trigger);
      if (!triggerEntries || triggerEntries.length === 0) {
        return null;
      }

      // Find most recent non-expired entry
      const now = Date.now();
      for (let i = triggerEntries.length - 1; i >= 0; i--) {
        const entry = triggerEntries[i]!;
        if (now - entry.timestamp <= maxAgeMs) {
          return {
            strategy: "cached",
            toolCalls: entry.toolCalls,
            reasoning: {
              ...entry.reasoning,
              trigger: `fallback:cached (original: ${entry.reasoning.trigger})`,
            },
            tokensUsed: 0,
          };
        }
      }

      // All entries expired — evict and pass
      entries.delete(context.trigger);

      return null;
    },
  };
}

/** A heuristic rule for deterministic fallback. */
export interface HeuristicRule {
  /** When this rule matches. */
  when: (context: FallbackContext) => boolean;
  /** Tool calls to execute. */
  toolCalls: Array<{ name: string; arguments: string }>;
  /** Reasoning description. */
  reasoning: string;
}

/**
 * Apply deterministic heuristic rules when the LLM is unavailable.
 * Rules are checked in order — first match wins.
 */
export function heuristicStrategy(rules: HeuristicRule[]): FallbackStrategy {
  return {
    name: "heuristic",
    handle(context: FallbackContext): FallbackResult | null {
      for (const rule of rules) {
        try {
          if (rule.when(context)) {
            return {
              strategy: "heuristic",
              toolCalls: rule.toolCalls,
              reasoning: {
                trigger: `fallback:heuristic`,
                observation: `LLM unavailable (${context.error.message})`,
                justification: rule.reasoning,
                expectedOutcome: "Deterministic fallback action",
                raw: rule.reasoning,
              },
              tokensUsed: 0,
            };
          }
        } catch {
          // Skip rules that throw
        }
      }

      return null;
    },
  };
}

/**
 * Block all actions — the safest fallback. Always matches.
 * Returns empty tool calls so no mutations occur.
 */
export function blockStrategy(): FallbackStrategy {
  return {
    name: "block",
    handle(context: FallbackContext): FallbackResult {
      return {
        strategy: "block",
        toolCalls: [],
        reasoning: {
          trigger: `fallback:block`,
          observation: `LLM unavailable (${context.error.message}). Blocking all actions for safety.`,
          justification: "LLM is down — no actions taken to prevent unsafe changes.",
          expectedOutcome: "System remains unchanged until LLM recovers.",
          raw: `Blocked after ${context.consecutiveFailures} consecutive failures.`,
        },
        tokensUsed: 0,
      };
    },
  };
}

// ============================================================================
// Fallback Runner
// ============================================================================

/**
 * Run fallback strategies in order. Returns the first result or null.
 */
export function runFallback(
  strategies: FallbackStrategy[],
  context: FallbackContext,
): FallbackResult | null {
  for (const strategy of strategies) {
    try {
      const result = strategy.handle(context);
      if (result !== null) {
        return result;
      }
    } catch {
      // Strategy threw — skip it
    }
  }

  return null;
}
