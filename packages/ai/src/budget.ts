/**
 * Cost Budget Guards — Pre-call estimation + rolling budget windows.
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

import type {
  AgentLike,
  AgentRunner,
  RunOptions,
  RunResult,
  TokenUsage,
} from "./types.js";

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
  /**
   * Refuse further calls once this many have been charged at estimate rather
   * than at reported usage.
   *
   * An unpriced call is one the provider declined to count, or one that threw
   * after reaching the provider. Both are charged, so the window still accrues
   * and the ceiling still trips — but at an estimate, and an estimate for an
   * agent that declares no {@link AgentLike.maxTokens} can be off by orders of
   * magnitude in either direction. Past some number of them a hard budget is
   * not being enforced against spend any more, it is being enforced against a
   * guess.
   *
   * Unset by default, which keeps the count advisory: read it from
   * {@link BudgetRunner.getUnpricedCallCount} and decide for yourself. Set it
   * when the budget is a real ceiling rather than a monitor — a gateway that
   * silently stops reporting usage is otherwise indistinguishable from one that
   * never did.
   *
   * @example
   * ```typescript
   * const runner = withBudget(baseRunner, {
   *   budgets: [{ window: "hour", maxCost: 5, pricing }],
   *   // Tolerate a handful of unreported calls, then stop.
   *   maxUnpricedCalls: 25,
   * });
   * ```
   */
  maxUnpricedCalls?: number;
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

/**
 * Error thrown when too many calls in a row could only be charged at estimate.
 *
 * Distinct from {@link BudgetExceededError}: the budget has not been spent, it
 * has stopped being measurable. Raised only when
 * {@link BudgetConfig.maxUnpricedCalls} is set.
 */
export class UnpricedCallLimitError extends Error {
  /** How many calls have been charged at estimate. */
  readonly unpricedCalls: number;
  /** The configured tolerance. */
  readonly maxUnpricedCalls: number;

  constructor(unpricedCalls: number, maxUnpricedCalls: number) {
    super(
      `[Directive] Budget can no longer be enforced against reported usage: ${unpricedCalls} call(s) were charged at estimate, at or above the configured limit of ${maxUnpricedCalls}. The endpoint is not returning token counts – a gateway dropping \`stream_options.include_usage\` is the usual cause. Fix the endpoint, raise \`maxUnpricedCalls\`, or set \`agent.maxTokens\` so the estimate is a real bound.`,
    );
    this.name = "UnpricedCallLimitError";
    this.unpricedCalls = unpricedCalls;
    this.maxUnpricedCalls = maxUnpricedCalls;
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
    while (
      pruneIndex < this.entries.length &&
      this.entries[pruneIndex]!.timestamp < cutoff
    ) {
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

function costOf(
  inputTokens: number,
  outputTokens: number,
  pricing: TokenPricing,
): number {
  return (
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion
  );
}

/**
 * How many output tokens to assume for a call whose real count is unavailable.
 *
 * Three sources, best first:
 *
 * 1. **The output itself**, when the call completed and only its counts are
 *    missing. The text is in hand and `length / charsPerToken` is the estimate
 *    this module already applies to input.
 * 2. **`agent.maxTokens`**, when the call threw and produced nothing to
 *    measure. It is the provider's own ceiling for the call, so it bounds what
 *    the response could have cost rather than guessing at it.
 * 3. **`inputTokens × estimatedOutputMultiplier`**, the historical fallback,
 *    for an agent that declares no ceiling.
 *
 * The third is only ever a guess about a quantity it has no relation to: a
 * 50k-token retrieval prompt answered in 200 tokens is priced at 50k of output
 * and over-charges by nearly six times, while a one-line prompt answered at
 * length under-charges by two to three orders of magnitude. Either error turns
 * a correctly sized budget into the wrong one, which is why the first two
 * sources are preferred wherever they exist.
 */
function estimateOutputTokens(
  agent: AgentLike,
  outputText: string | undefined,
  inputTokens: number,
  charsPerToken: number,
  outputMultiplier: number,
): number {
  if (outputText !== undefined && outputText.length > 0) {
    return Math.ceil(outputText.length / charsPerToken);
  }

  const ceiling = agent.maxTokens;
  if (typeof ceiling === "number" && Number.isFinite(ceiling) && ceiling > 0) {
    return Math.ceil(ceiling);
  }

  return Math.ceil(inputTokens * outputMultiplier);
}

/**
 * Everything a run produced that the provider generated, for measuring output
 * when it declined to count it.
 *
 * Assistant messages are the generated text; the user turn and any tool
 * results are input to the next call, not output of this one.
 */
function assistantText(result: RunResult<unknown>): string | undefined {
  let text = "";
  for (const message of result.messages) {
    if (message.role === "assistant" && typeof message.content === "string") {
      text += message.content;
    }
  }
  if (text.length > 0) {
    return text;
  }

  return typeof result.output === "string" ? result.output : undefined;
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
export function withBudget(
  runner: AgentRunner,
  config: BudgetConfig,
): BudgetRunner {
  const {
    maxCostPerCall,
    budgets = [],
    pricing,
    charsPerToken = 4,
    estimatedOutputMultiplier = 1.0,
    maxUnpricedCalls,
    onBudgetExceeded,
  } = config;

  // Validate config
  if (!Number.isFinite(charsPerToken) || charsPerToken <= 0) {
    throw new Error(
      "[Directive] withBudget: charsPerToken must be a positive finite number.",
    );
  }
  if (
    maxCostPerCall != null &&
    (!Number.isFinite(maxCostPerCall) || maxCostPerCall < 0)
  ) {
    throw new Error(
      "[Directive] withBudget: maxCostPerCall must be a non-negative finite number.",
    );
  }
  if (
    !Number.isFinite(estimatedOutputMultiplier) ||
    estimatedOutputMultiplier < 0
  ) {
    throw new Error(
      "[Directive] withBudget: estimatedOutputMultiplier must be a non-negative finite number.",
    );
  }
  if (
    maxUnpricedCalls != null &&
    (!Number.isFinite(maxUnpricedCalls) || maxUnpricedCalls < 0)
  ) {
    throw new Error(
      "[Directive] withBudget: maxUnpricedCalls must be a non-negative finite number.",
    );
  }
  if (maxCostPerCall != null && !pricing) {
    console.warn(
      "[Directive] withBudget: maxCostPerCall has no effect without pricing. Provide a pricing config to enable per-call cost estimation.",
    );
  }
  for (const budget of budgets) {
    if (!Number.isFinite(budget.maxCost) || budget.maxCost < 0) {
      throw new Error(
        `[Directive] withBudget: budgets[${budget.window}].maxCost must be a non-negative finite number.`,
      );
    }
  }

  // Per-window ledgers to avoid double-counting
  const windowLedgers = new Map<string, CostLedger>();
  for (const budget of budgets) {
    windowLedgers.set(budget.window, new CostLedger());
  }
  // Base pricing ledger (used when no budget windows are configured)
  const baseLedger = new CostLedger();
  // Calls the provider declined to report usage for, charged at estimate.
  let unpricedCalls = 0;

  const budgetRunner: AgentRunner = async <T = unknown>(
    agent: AgentLike,
    input: string,
    options?: RunOptions,
  ): Promise<RunResult<T>> => {
    const inputTokens = estimateInputTokens(input, charsPerToken);
    // Pre-call there is no output to measure, so the ceiling is the bound.
    const estimatedOutputTokens = estimateOutputTokens(
      agent,
      undefined,
      inputTokens,
      charsPerToken,
      estimatedOutputMultiplier,
    );
    const estimateCallCost = (forPricing: TokenPricing): number =>
      costOf(inputTokens, estimatedOutputTokens, forPricing);

    // Pre-call: a provider that has stopped reporting usage cannot be
    // budgeted, only approximated. Past the configured tolerance, refuse
    // rather than let a hard ceiling go on being enforced against estimates.
    if (maxUnpricedCalls != null && unpricedCalls >= maxUnpricedCalls) {
      throw new UnpricedCallLimitError(unpricedCalls, maxUnpricedCalls);
    }

    // Pre-call: Check per-call budget
    if (maxCostPerCall != null && pricing) {
      const estimated = estimateCallCost(pricing);
      if (estimated > maxCostPerCall) {
        const details: BudgetExceededDetails = {
          estimated,
          remaining: maxCostPerCall,
          window: "per-call",
        };
        try {
          onBudgetExceeded?.(details);
        } catch {
          /* callback error must not disrupt budget flow */
        }
        throw new BudgetExceededError(details);
      }
    }

    // Pre-call: Check rolling window budgets
    for (const budget of budgets) {
      const windowMs = WINDOW_MS[budget.window]!;
      const ledger = windowLedgers.get(budget.window)!;
      const spent = ledger.getCostInWindow(windowMs);
      const remaining = budget.maxCost - spent;
      const estimated = estimateCallCost(budget.pricing);

      if (estimated > remaining) {
        const details: BudgetExceededDetails = {
          estimated,
          remaining: Math.max(0, remaining),
          window: budget.window,
        };
        try {
          onBudgetExceeded?.(details);
        } catch {
          /* callback error must not disrupt budget flow */
        }
        throw new BudgetExceededError(details);
      }
    }

    // How many times the provider was actually called for this one invocation.
    // Every wrapper that re-invokes the runner beneath it reports the boundary
    // on `onStreamRestart` — `withRetry`, `withFallback`, a structured-output
    // schema retry, a self-healing reroute — so a budget wrapped around any of
    // them can see the requests they make on its behalf. Without the count, a
    // budget outside a retrying, falling-back stack charged once for what was
    // measured as six billed requests.
    let providerCalls = 1;
    const callerOnStreamRestart = options?.onStreamRestart;
    const budgetOptions: RunOptions = {
      ...options,
      onStreamRestart: (reason) => {
        providerCalls++;
        callerOnStreamRestart?.(reason);
      },
    };

    /**
     * Charge one call at an estimate, and count it as one the ledger could not
     * price. `outputText` is whatever the call produced, when it produced
     * anything; `times` is how many provider requests the charge covers.
     */
    const recordEstimated = (
      outputText: string | undefined,
      times = providerCalls,
    ): void => {
      if (times <= 0) {
        return;
      }
      unpricedCalls += times;
      const outputTokens = estimateOutputTokens(
        agent,
        outputText,
        inputTokens,
        charsPerToken,
        estimatedOutputMultiplier,
      );
      for (const budget of budgets) {
        const ledger = windowLedgers.get(budget.window)!;
        ledger.record(
          costOf(inputTokens, outputTokens, budget.pricing) * times,
        );
      }
      if (pricing && budgets.length === 0) {
        baseLedger.record(costOf(inputTokens, outputTokens, pricing) * times);
      }
    };

    // Execute the call. Everything past this point has reached the provider,
    // so everything past this point is charged — including the paths that
    // throw.
    let result: RunResult<T>;
    try {
      result = await runner<T>(agent, input, budgetOptions);
    } catch (err) {
      // A call that threw after the provider generated its response was still
      // billed for it. Recording only on the success path meant none of it was:
      // measured against a marker-stripping gateway, five runs behind
      // `withRetry` and `withFallback` became thirty billed requests and
      // fifteen hundred delivered tokens, with recorded spend of zero and an
      // unpriced-call count of zero — no ceiling, and no signal that there was
      // no ceiling. A stream that failed on its terminal-marker check is the
      // clearest case: the response was generated, delivered and charged, and
      // the throw comes afterwards.
      //
      // A budget below this one refused its call before dispatch, so nothing
      // was sent and nothing is owed; that is the one throw not charged.
      if (!(err instanceof BudgetExceededError)) {
        recordEstimated(undefined);
      }

      throw err;
    }

    // A provider that reported no usage has not told us the call was free —
    // an OpenAI-compatible endpoint that ignores `stream_options.include_usage`
    // returns zeros for a call that cost real money. Recording those zeros
    // means the window never accrues and the ceiling never trips, so charge an
    // estimate instead and count the call as one the ledger could not price.
    if (result.usageReported === false) {
      recordEstimated(assistantText(result));

      return result;
    }

    // Attempts that failed before this one were generated and billed too, and
    // the usage on the successful result describes only itself.
    recordEstimated(undefined, providerCalls - 1);

    // Post-call: Record actual costs in per-window ledgers
    if (result.tokenUsage) {
      for (const budget of budgets) {
        windowLedgers
          .get(budget.window)!
          .record(calculateCost(result.tokenUsage, budget.pricing));
      }
      // Record in base ledger when no windows configured
      if (pricing && budgets.length === 0) {
        baseLedger.record(calculateCost(result.tokenUsage, pricing));
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

  /**
   * How many calls were charged at estimate because the provider reported no
   * token usage.
   *
   * Also counts calls that threw after reaching the provider, which are
   * charged at estimate for the same reason: the response was generated and
   * billed whether or not it arrived intact.
   *
   * Non-zero means the recorded spend is an approximation: the endpoint is not
   * returning usage (a gateway that drops `stream_options.include_usage` is
   * the usual cause), or calls are failing after dispatch. The spend it stands
   * in for is real either way. Set {@link BudgetConfig.maxUnpricedCalls} to
   * make it a ceiling rather than a reading.
   *
   * @example
   * ```typescript
   * if (runner.getUnpricedCallCount() > 0) {
   *   console.warn("Provider is not reporting token usage — budgets are estimates.");
   * }
   * ```
   */
  function getUnpricedCallCount(): number {
    return unpricedCalls;
  }

  // Attach getSpent as a direct property for type-safe access without casting
  (budgetRunner as unknown as Record<string, unknown>).getSpent = getSpent;
  (budgetRunner as unknown as Record<string, unknown>).getUnpricedCallCount =
    getUnpricedCallCount;

  return budgetRunner as unknown as BudgetRunner;
}

/** Helper type for accessing budget runner's getSpent method. */
export type BudgetRunner = AgentRunner & {
  /** Get cost spent within a rolling window. */
  getSpent(window: "hour" | "day"): number;
  /** How many calls were charged at estimate because usage was not reported. */
  getUnpricedCallCount(): number;
};
