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

import type { TokenSink } from "./streaming.js";
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
   * Refuse further calls once this many recent ones have been charged at
   * estimate rather than at reported usage.
   *
   * An unpriced call is one the provider declined to count, or one that threw.
   * Whatever such a call delivered is charged, so the window still accrues and
   * the ceiling still trips — but from measured text rather than a counted
   * response, and a call that delivered nothing before failing is charged
   * nothing at all. Past some number of them a hard budget is not being
   * enforced against spend any more, it is being enforced against a guess.
   *
   * Counted over a rolling window, like the budgets themselves: the widest
   * window configured, or an hour when there is none. An outage that ends
   * stops refusing calls once its failures age out.
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
  /** How many calls in the current window have been charged at estimate. */
  readonly unpricedCalls: number;
  /** The configured tolerance. */
  readonly maxUnpricedCalls: number;

  constructor(unpricedCalls: number, maxUnpricedCalls: number) {
    super(
      `[Directive] Budget can no longer be enforced against reported usage: ${unpricedCalls} recent call(s) were charged at estimate, at or above the configured limit of ${maxUnpricedCalls}. The endpoint is not returning token counts – a gateway dropping \`stream_options.include_usage\` is the usual cause – or calls are failing after dispatch. Fix the endpoint, or raise \`maxUnpricedCalls\`.`,
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

/**
 * The window the unpriced-call count is kept over: the widest budget window
 * configured, or an hour when none is.
 *
 * Every other figure this module keeps decays, and this one did not — it only
 * ever incremented, for the life of the runner. Twenty-five transient failures
 * during one provider outage therefore refused every call afterwards, forever,
 * with the provider healthy again and the budget untouched. Sharing the ledgers'
 * basis makes the count say what the ledgers say: what has happened lately.
 */
function unpricedWindowMs(budgets: BudgetWindow[]): number {
  let widest = 0;
  for (const budget of budgets) {
    widest = Math.max(widest, WINDOW_MS[budget.window] ?? 0);
  }

  return widest > 0 ? widest : WINDOW_MS.hour!;
}

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
 * How many output tokens to charge for a call whose real count is unavailable.
 *
 * Two sources:
 *
 * 1. **The output that arrived**, whenever any did — the text on a completed
 *    result, or the deltas already delivered by a call that threw part-way
 *    through. `length / charsPerToken` is the estimate this module already
 *    applies to input, and it is a measurement of the response rather than a
 *    prediction of one.
 * 2. **`inputTokens × estimatedOutputMultiplier`**, before the call, where
 *    there is by definition nothing yet to measure.
 *
 * The second is only ever a guess about a quantity it has no relation to: a
 * 50k-token retrieval prompt answered in 200 tokens is priced at 50k of output
 * and over-charges by nearly six times, while a one-line prompt answered at
 * length under-charges by two to three orders of magnitude. It is used for the
 * pre-call check because a pre-call check has nothing better, and never after.
 *
 * `agent.maxTokens` used to sit between them, on the reasoning that a declared
 * ceiling bounds the response. It does not bound anything here: it is written
 * by the caller whose spend is being limited, and `maxTokens: 1` shrank the
 * pre-call estimate until a five-cent per-call cap admitted a call that cost
 * eighteen dollars. Nothing in this module reads it now.
 */
function estimateOutputTokens(
  outputText: string | undefined,
  inputTokens: number,
  charsPerToken: number,
  outputMultiplier: number,
): number {
  if (outputText !== undefined && outputText.length > 0) {
    return Math.ceil(outputText.length / charsPerToken);
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
  // Calls charged at estimate rather than at reported usage, timestamped so
  // the count decays on the same basis as the ledgers beside it.
  const unpricedLedger = new CostLedger();
  const unpricedMs = unpricedWindowMs(budgets);
  const countUnpriced = (): number =>
    unpricedLedger.getCostInWindow(unpricedMs);

  const budgetRunner: AgentRunner = async <T = unknown>(
    agent: AgentLike,
    input: string,
    options?: RunOptions,
  ): Promise<RunResult<T>> => {
    const inputTokens = estimateInputTokens(input, charsPerToken);
    // Pre-call there is nothing to measure, so the multiplier is all there is.
    const estimatedOutputTokens = estimateOutputTokens(
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
    const unpricedSoFar = countUnpriced();
    if (maxUnpricedCalls != null && unpricedSoFar >= maxUnpricedCalls) {
      throw new UnpricedCallLimitError(unpricedSoFar, maxUnpricedCalls);
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

    // What the provider actually delivered for this call, counted as it
    // arrives. This is the only figure here that is observed rather than
    // declared, and every charge below is derived from it.
    //
    // The previous version counted requests off `onStreamRestart` instead, on
    // the reasoning that every re-invoking wrapper already emits it. It is an
    // option on the caller's own options object: five hundred calls to it
    // alongside one real request recorded seven hundred and fifty dollars. A
    // wrapper's extra requests are charged here when their bytes arrive, and a
    // caller can no longer charge anything by asking.
    //
    // Only wrapped when the caller supplied one — installing a callback of our
    // own would ask every buffered call to stream.
    let deliveredChars = 0;
    const callerOnToken = options?.onToken as TokenSink | undefined;
    const budgetOptions: RunOptions | undefined = callerOnToken
      ? {
          ...options,
          onToken: ((token: string): unknown => {
            deliveredChars += token.length;

            return callerOnToken(token);
          }) as RunOptions["onToken"],
        }
      : options;

    /**
     * Charge one call at an estimate measured from what arrived, and count it
     * as one the ledger could not price.
     *
     * `arrived` is whether the provider delivered anything at all: a response,
     * or bytes before it failed. A call that delivered nothing is charged
     * nothing — there is no observation to price — and is still counted,
     * because a call that fails after dispatch may have been billed for work
     * whose size is unknowable from here.
     */
    const recordUnpriced = (arrived: boolean, outputChars: number): void => {
      unpricedLedger.record(1);
      if (!arrived) {
        return;
      }
      const outputTokens = Math.ceil(Math.max(0, outputChars) / charsPerToken);
      for (const budget of budgets) {
        const ledger = windowLedgers.get(budget.window)!;
        ledger.record(costOf(inputTokens, outputTokens, budget.pricing));
      }
      if (pricing && budgets.length === 0) {
        baseLedger.record(costOf(inputTokens, outputTokens, pricing));
      }
    };

    let result: RunResult<T>;
    try {
      result = await runner<T>(agent, input, budgetOptions);
    } catch (err) {
      // A budget below this one refused before dispatch, so nothing was sent
      // and nothing is owed — neither a charge nor a count. Both refusals are
      // pre-dispatch by construction; the nested unpriced-call refusal used to
      // be charged, which cost an outer ledger thirty dollars across twenty
      // calls that made no HTTP request at all, and cascaded its own lockout
      // outward.
      if (
        err instanceof BudgetExceededError ||
        err instanceof UnpricedCallLimitError
      ) {
        throw err;
      }

      // Otherwise: charge what arrived before it failed, which for a stream cut
      // short by a marker check or a truncated body is the whole response the
      // provider generated and billed. A call that delivered nothing — a DNS
      // failure, a refused connection, a pre-flight throw — cost nothing and is
      // charged nothing. Charging those at a declared ceiling locked a $5/hour
      // budget for a full hour on seventy-four connection refusals that never
      // reached a provider.
      recordUnpriced(deliveredChars > 0, deliveredChars);

      throw err;
    }

    const deliveredByResult = assistantText(result)?.length ?? 0;

    // A provider that reported no usage has not told us the call was free —
    // an OpenAI-compatible endpoint that ignores `stream_options.include_usage`
    // returns zeros for a call that cost real money. Recording those zeros
    // means the window never accrues and the ceiling never trips, so charge
    // what arrived instead and count the call as one the ledger could not
    // price.
    if (result.usageReported === false) {
      recordUnpriced(true, Math.max(deliveredByResult, deliveredChars));

      return result;
    }

    // Bytes delivered beyond what the result describes came from a generation
    // that was replayed over — a retry, a fallback, a schema re-ask — and the
    // provider billed for those as well, while the usage on the surviving
    // result describes only itself. They were observed, so they are charged.
    if (deliveredChars > deliveredByResult) {
      recordUnpriced(true, deliveredChars - deliveredByResult);
    }

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
   * How many recent calls were charged at estimate rather than at reported
   * token usage.
   *
   * Counts calls the provider declined to count, and calls that threw, which
   * cannot be priced from a report that never came. Kept over a rolling window
   * — the widest configured budget window, or an hour when no window is
   * configured — so it reads as "lately", like the ledgers it sits beside. A
   * lifetime total meant one bad afternoon refused every call a long-lived
   * runner ever made afterwards.
   *
   * Non-zero means the recorded spend is an approximation: the endpoint is not
   * returning usage (a gateway that drops `stream_options.include_usage` is
   * the usual cause), or calls are failing after dispatch. Set
   * {@link BudgetConfig.maxUnpricedCalls} to make it a ceiling rather than a
   * reading.
   *
   * @example
   * ```typescript
   * if (runner.getUnpricedCallCount() > 0) {
   *   console.warn("Provider is not reporting token usage — budgets are estimates.");
   * }
   * ```
   */
  function getUnpricedCallCount(): number {
    return countUnpriced();
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
