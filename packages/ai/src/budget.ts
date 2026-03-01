/**
 * P1: Cost Budget Guards — Pre-call estimation + rolling budget windows.
 *
 * Prevents runaway LLM costs by estimating costs before each call
 * and tracking actual costs after each call. Supports per-call limits
 * and rolling time-window budgets (hourly, daily).
 *
 * @module
 *
 * @example
 * ```typescript
 * import { withBudget, BudgetExceededError } from '@directive-run/ai';
 * import type { BudgetRunner } from '@directive-run/ai';
 *
 * const pricing = { inputPerMillion: 3, outputPerMillion: 15 };
 *
 * const runner = withBudget(baseRunner, {
 *   maxCostPerCall: 0.10,
 *   pricing,
 *   budgets: [
 *     { window: "hour", maxCost: 5.00, pricing },
 *     { window: "day", maxCost: 50.00, pricing },
 *   ],
 * });
 *
 * // Check spending via escape hatch
 * const spent = (runner as BudgetRunner).getSpent("hour");
 * if (spent > 4.00) {
 *   console.warn("Approaching hourly budget limit!");
 * }
 * ```
 */

import type { AgentRunner, AgentLike, RunResult, RunOptions, TokenUsage } from "./types.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Token pricing for a specific model or provider.
 *
 * @example
 * ```typescript
 * // GPT-4o pricing (as of 2024)
 * const gpt4oPricing: TokenPricing = {
 *   inputPerMillion: 5,
 *   outputPerMillion: 15,
 * };
 * ```
 */
export interface TokenPricing {
  /** Cost per million input tokens (in dollars). */
  inputPerMillion: number;
  /** Cost per million output tokens (in dollars). */
  outputPerMillion: number;
}

/**
 * Rolling budget window configuration.
 *
 * Each window tracks cost independently, preventing double-counting
 * when multiple windows are configured.
 *
 * @example
 * ```typescript
 * const hourlyBudget: BudgetWindow = {
 *   window: "hour",
 *   maxCost: 5.00,
 *   pricing: { inputPerMillion: 3, outputPerMillion: 15 },
 * };
 * ```
 */
export interface BudgetWindow {
  /** Time window for the budget. */
  window: "hour" | "day";
  /** Maximum cost in dollars for this window. */
  maxCost: number;
  /** Token pricing for cost calculation within this window. */
  pricing: TokenPricing;
}

export interface BudgetConfig {
  /** Maximum estimated cost per individual call. */
  maxCostPerCall?: number;
  /** Rolling budget windows. */
  budgets?: BudgetWindow[];
  /** Pricing used for per-call estimation (when maxCostPerCall is set). */
  pricing?: TokenPricing;
  /** Approximate characters per token for input estimation. @default 4 */
  charsPerToken?: number;
  /**
   * Multiplier for estimated output tokens relative to input tokens.
   * For summarization tasks, use a value less than 1 (e.g., 0.3).
   * For generation tasks, use a value greater than 1 (e.g., 3.0).
   * @default 1.0
   */
  estimatedOutputMultiplier?: number;
  /** Called when a budget check fails (before throwing). */
  onBudgetExceeded?: (details: BudgetExceededDetails) => void;
}

export interface BudgetExceededDetails {
  estimated: number;
  remaining: number;
  window: "per-call" | "hour" | "day";
}

/** Error thrown when a budget limit is exceeded. */
export class BudgetExceededError extends Error {
  readonly estimated: number;
  readonly remaining: number;
  readonly window: "per-call" | "hour" | "day";

  constructor(details: BudgetExceededDetails) {
    super(
      `[Directive] Budget exceeded (${details.window}): estimated $${details.estimated.toFixed(4)}, ` +
      `remaining $${details.remaining.toFixed(4)}`,
    );
    this.name = "BudgetExceededError";
    this.estimated = details.estimated;
    this.remaining = details.remaining;
    this.window = details.window;
  }
}

// ============================================================================
// Internal: Cost Ledger
// ============================================================================

interface CostEntry {
  timestamp: number;
  cost: number;
}

class CostLedger {
  private entries: CostEntry[] = [];

  record(cost: number): void {
    this.entries.push({ timestamp: Date.now(), cost });
  }

  /** Get total cost within a time window. */
  getCostInWindow(windowMs: number): number {
    const cutoff = Date.now() - windowMs;
    this.prune(cutoff);

    let total = 0;
    for (const entry of this.entries) {
      if (entry.timestamp >= cutoff) {
        total += entry.cost;
      }
    }

    return total;
  }

  /** Remove entries older than the cutoff. */
  private prune(cutoff: number): void {
    let pruneIndex = 0;
    while (pruneIndex < this.entries.length && this.entries[pruneIndex]!.timestamp < cutoff) {
      pruneIndex++;
    }
    if (pruneIndex > 0) {
      this.entries.splice(0, pruneIndex);
    }
  }

  clear(): void {
    this.entries = [];
  }
}

// ============================================================================
// Helpers
// ============================================================================

const WINDOW_MS: Record<string, number> = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

function estimateInputTokens(input: string, charsPerToken: number): number {
  return Math.ceil(input.length / charsPerToken);
}

function calculateCost(usage: TokenUsage, pricing: TokenPricing): number {
  return (
    (usage.inputTokens / 1_000_000) * pricing.inputPerMillion +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMillion
  );
}

function estimateCallCost(inputTokens: number, pricing: TokenPricing, outputMultiplier = 1.0): number {
  const estimatedOutputTokens = Math.ceil(inputTokens * outputMultiplier);

  return (
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (estimatedOutputTokens / 1_000_000) * pricing.outputPerMillion
  );
}

// ============================================================================
// Wrapper
// ============================================================================

/**
 * Wrap an AgentRunner with cost budget guards.
 *
 * @example
 * ```typescript
 * const runner = withBudget(baseRunner, {
 *   maxCostPerCall: 0.10,
 *   pricing: { inputPerMillion: 3, outputPerMillion: 15 },
 *   budgets: [
 *     { window: "hour", maxCost: 5.00, pricing: { inputPerMillion: 3, outputPerMillion: 15 } },
 *     { window: "day", maxCost: 50.00, pricing: { inputPerMillion: 3, outputPerMillion: 15 } },
 *   ],
 * });
 * ```
 */
export function withBudget(runner: AgentRunner, config: BudgetConfig): BudgetRunner {
  const {
    maxCostPerCall,
    budgets = [],
    pricing,
    charsPerToken = 4,
    estimatedOutputMultiplier = 1.0,
    onBudgetExceeded,
  } = config;

  // Validate config
  if (!Number.isFinite(charsPerToken) || charsPerToken <= 0) {
    throw new Error("[Directive] withBudget: charsPerToken must be a positive finite number.");
  }
  if (maxCostPerCall != null && (!Number.isFinite(maxCostPerCall) || maxCostPerCall < 0)) {
    throw new Error("[Directive] withBudget: maxCostPerCall must be a non-negative finite number.");
  }
  if (!Number.isFinite(estimatedOutputMultiplier) || estimatedOutputMultiplier < 0) {
    throw new Error("[Directive] withBudget: estimatedOutputMultiplier must be a non-negative finite number.");
  }
  if (maxCostPerCall != null && !pricing) {
    console.warn("[Directive] withBudget: maxCostPerCall has no effect without pricing. Provide a pricing config to enable per-call cost estimation.");
  }
  for (const budget of budgets) {
    if (!Number.isFinite(budget.maxCost) || budget.maxCost < 0) {
      throw new Error(`[Directive] withBudget: budgets[${budget.window}].maxCost must be a non-negative finite number.`);
    }
  }

  // Per-window ledgers to avoid double-counting
  const windowLedgers = new Map<string, CostLedger>();
  for (const budget of budgets) {
    windowLedgers.set(budget.window, new CostLedger());
  }
  // Base pricing ledger (used when no budget windows are configured)
  const baseLedger = new CostLedger();

  const budgetRunner: AgentRunner = async <T = unknown>(
    agent: AgentLike,
    input: string,
    options?: RunOptions,
  ): Promise<RunResult<T>> => {
    const inputTokens = estimateInputTokens(input, charsPerToken);

    // Pre-call: Check per-call budget
    if (maxCostPerCall != null && pricing) {
      const estimated = estimateCallCost(inputTokens, pricing, estimatedOutputMultiplier);
      if (estimated > maxCostPerCall) {
        const details: BudgetExceededDetails = {
          estimated,
          remaining: maxCostPerCall,
          window: "per-call",
        };
        try { onBudgetExceeded?.(details); } catch { /* callback error must not disrupt budget flow */ }
        throw new BudgetExceededError(details);
      }
    }

    // Pre-call: Check rolling window budgets
    for (const budget of budgets) {
      const windowMs = WINDOW_MS[budget.window]!;
      const ledger = windowLedgers.get(budget.window)!;
      const spent = ledger.getCostInWindow(windowMs);
      const remaining = budget.maxCost - spent;
      const estimated = estimateCallCost(inputTokens, budget.pricing, estimatedOutputMultiplier);

      if (estimated > remaining) {
        const details: BudgetExceededDetails = {
          estimated,
          remaining: Math.max(0, remaining),
          window: budget.window,
        };
        try { onBudgetExceeded?.(details); } catch { /* callback error must not disrupt budget flow */ }
        throw new BudgetExceededError(details);
      }
    }

    // Execute the call
    const result = await runner<T>(agent, input, options);

    // Post-call: Record actual costs in per-window ledgers
    if (result.tokenUsage) {
      for (const budget of budgets) {
        const ledger = windowLedgers.get(budget.window)!;
        const actualCost = calculateCost(result.tokenUsage, budget.pricing);
        ledger.record(actualCost);
      }
      // Record in base ledger when no windows configured
      if (pricing && budgets.length === 0) {
        const actualCost = calculateCost(result.tokenUsage, pricing);
        baseLedger.record(actualCost);
      }
    }

    return result;
  };

  /**
   * Get cost spent within a given window. Useful for dashboards and preemptive alerts.
   *
   * @example
   * ```typescript
   * const runner = withBudget(baseRunner, { budgets: [{ window: "hour", maxCost: 10, pricing }] });
   * const spent = (runner as BudgetRunner).getSpent("hour");
   * if (spent > 8) console.warn("Approaching hourly budget limit!");
   * ```
   */
  function getSpent(window: "hour" | "day"): number {
    const ledger = windowLedgers.get(window);
    if (!ledger) {
      return 0;
    }
    const windowMs = WINDOW_MS[window]!;

    return ledger.getCostInWindow(windowMs);
  }

  // Attach getSpent as a direct property for type-safe access without casting
  (budgetRunner as unknown as Record<string, unknown>).getSpent = getSpent;

  return budgetRunner as unknown as BudgetRunner;
}

/** Helper type for accessing budget runner's getSpent method. */
export type BudgetRunner = AgentRunner & {
  /** Get cost spent within a rolling window. */
  getSpent(window: "hour" | "day"): number;
};
