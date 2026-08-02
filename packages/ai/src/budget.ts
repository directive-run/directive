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
 * A pricing entry that carries both field spellings for the same two rates.
 *
 * `estimateCost(tokenUsage, ratePerMillionTokens)` takes a bare per-million
 * number, so it reads `.input` / `.output`. `withBudget` and
 * `createConstraintRouter` are typed against {@link TokenPricing}, so they read
 * `.inputPerMillion` / `.outputPerMillion`. Every adapter pricing table is
 * published in this widened shape, derived from one source of numbers, so the
 * pairs cannot drift and no constant is the wrong constant.
 */
export interface ModelPricing extends TokenPricing {
  /** Cost per million input tokens, as a bare rate for `estimateCost`. */
  input: number;
  /** Cost per million output tokens, as a bare rate for `estimateCost`. */
  output: number;
}

/**
 * Widen a table of bare `{ input, output }` rates into {@link ModelPricing},
 * where each entry carries both field spellings of the same two numbers.
 *
 * Adapters call this to publish their pricing tables. Both rate pairs are
 * derived from the single `{ input, output }` source, so `entry.input` and
 * `entry.inputPerMillion` are the same number by construction — there is no
 * second list of rates to keep in sync.
 *
 * @example
 * ```typescript
 * const MY_PRICING = toTokenPricingTable({ "my-model": { input: 3, output: 15 } });
 *
 * estimateCost(inputTokens, MY_PRICING["my-model"].input);
 * withBudget(runner, { maxCostPerCall: 1, pricing: MY_PRICING["my-model"] });
 * ```
 */
export function toTokenPricingTable(
  table: Record<string, { input: number; output: number }>,
): Record<string, ModelPricing> {
  const widened: Record<string, ModelPricing> = {};
  for (const [model, rates] of Object.entries(table)) {
    widened[model] = Object.freeze({
      input: rates.input,
      output: rates.output,
      inputPerMillion: rates.input,
      outputPerMillion: rates.output,
    });
  }

  return widened;
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
  /**
   * Whether the overrun was caught before the call ran or after it returned.
   *
   * `"pre-call"` means the call was blocked and a {@link BudgetExceededError}
   * was thrown — no spend occurred. `"post-call"` means the provider billed
   * more than the estimate predicted: the call already completed and the money
   * is already spent, so this is a report, not a block. `estimated` carries the
   * actual cost in that case.
   */
  phase: "pre-call" | "post-call";
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

function estimateCallCost(
  inputTokens: number,
  pricing: TokenPricing,
  outputMultiplier = 1.0,
): number {
  const estimatedOutputTokens = Math.ceil(inputTokens * outputMultiplier);

  return (
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (estimatedOutputTokens / 1_000_000) * pricing.outputPerMillion
  );
}

/**
 * Whether a provider-reported token usage can be priced without corrupting the
 * ledger.
 *
 * `tokenUsage` crosses a trust boundary: it is whatever the provider (or a
 * wrapping runner, or a test double) put on the result. A single `NaN`,
 * `Infinity`, or negative count added to a running total is not a bad data
 * point, it is a permanent one — every later `getSpent()` inherits it and no
 * subsequent call can bring the ledger back.
 */
function isUsableTokenUsage(usage: TokenUsage): boolean {
  const { inputTokens, outputTokens } = usage;

  return (
    typeof inputTokens === "number" &&
    typeof outputTokens === "number" &&
    Number.isFinite(inputTokens) &&
    Number.isFinite(outputTokens) &&
    inputTokens >= 0 &&
    outputTokens >= 0
  );
}

/** Render a rate for an error message, keeping `-0` distinguishable from `0`. */
function formatRate(rate: number): string {
  return Object.is(rate, -0) ? "-0" : String(rate);
}

/**
 * Validate a pricing object and snapshot its rates into owned primitives.
 *
 * Two failure modes are closed here, and the snapshot is what closes the
 * second one.
 *
 * A rate that is missing or non-finite makes every cost `NaN`, every
 * `estimated > remaining` comparison `false`, and the budget never trips. A
 * rate that is negative is worse: costs come out negative, the comparison is
 * still never true, and each call *lowers* the recorded spend, so the window
 * ledger walks backwards forever. Either way the guard fails open — spend
 * unbounded precisely when the caller believed it was capped. Zero is allowed
 * and meaningful: local models genuinely bill nothing.
 *
 * The returned object is a frozen copy read once, at construction. Validating
 * the caller's live object and then re-reading it on every call would be a
 * check-then-use gap: a getter, a Proxy, or a plain `pricing.inputPerMillion =
 * NaN` after `withBudget` returned would reopen the exact hole the validation
 * exists to close. Nothing downstream touches the caller's object again.
 */
function snapshotTokenPricing(
  pricing: TokenPricing,
  label: string,
): TokenPricing {
  const source = pricing as unknown as Record<string, unknown> | undefined;
  const looksLikeBareRatePair =
    typeof source?.input === "number" &&
    typeof source?.output === "number" &&
    typeof source?.inputPerMillion !== "number" &&
    typeof source?.outputPerMillion !== "number";

  const snapshot: TokenPricing = { inputPerMillion: 0, outputPerMillion: 0 };

  for (const field of ["inputPerMillion", "outputPerMillion"] as const) {
    // Read exactly once, and keep the primitive rather than the property.
    const raw = source?.[field];
    const rate = typeof raw === "number" ? raw : Number.NaN;

    if (!Number.isFinite(rate)) {
      const hint = looksLikeBareRatePair
        ? " Received { input, output } — a bare per-million rate pair. Every adapter *_PRICING export (e.g. ANTHROPIC_PRICING) already carries inputPerMillion / outputPerMillion alongside those; if this object is hand-built, add both fields."
        : "";

      throw new Error(
        `[Directive] withBudget: ${label}.${field} must be a finite number.${hint}`,
      );
    }

    if (rate < 0 || Object.is(rate, -0)) {
      throw new Error(
        `[Directive] withBudget: ${label}.${field} must be a non-negative number (received ${formatRate(rate)}). A negative rate makes every computed cost negative, so no budget can ever trip and the ledger runs backwards.`,
      );
    }

    snapshot[field] = rate;
  }

  return Object.freeze(snapshot);
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
  if (maxCostPerCall != null && !pricing) {
    console.warn(
      "[Directive] withBudget: maxCostPerCall has no effect without pricing. Provide a pricing config to enable per-call cost estimation.",
    );
  }
  // Snapshot the top-level pricing. Everything past this line reads the
  // snapshot, never `config.pricing`.
  const callPricing = pricing
    ? snapshotTokenPricing(pricing, "pricing")
    : undefined;

  // Per-window ledgers, keyed by window so two budgets on the same window
  // share one ledger rather than double-counting against each other.
  const windowLedgers = new Map<"hour" | "day", CostLedger>();
  for (const budget of budgets) {
    if (!windowLedgers.has(budget.window)) {
      windowLedgers.set(budget.window, new CostLedger());
    }
  }

  // Each budget window is flattened into an owned plan at construction: its
  // cap, its rates, and its ledger, all snapshotted. The hot path never reads
  // the caller's `budgets` array again.
  const plans = budgets.map((budget) => {
    if (!Number.isFinite(budget.maxCost) || budget.maxCost < 0) {
      throw new Error(
        `[Directive] withBudget: budgets[${budget.window}].maxCost must be a non-negative finite number.`,
      );
    }

    return {
      window: budget.window,
      maxCost: budget.maxCost,
      windowMs: WINDOW_MS[budget.window]!,
      pricing: snapshotTokenPricing(
        budget.pricing,
        `budgets[${budget.window}].pricing`,
      ),
      ledger: windowLedgers.get(budget.window)!,
    };
  });

  // Lifetime spend, priced with the top-level `pricing`. A running total
  // rather than a ledger: it is never pruned, so storing entries would grow
  // without bound for the life of the runner.
  let totalSpent = 0;
  let warnedUnusableUsage = false;

  /** Notify the caller, never letting their callback disrupt the budget flow. */
  function report(details: BudgetExceededDetails): void {
    try {
      onBudgetExceeded?.(details);
    } catch {
      /* callback error must not disrupt budget flow */
    }
  }

  const budgetRunner: AgentRunner = async <T = unknown>(
    agent: AgentLike,
    input: string,
    options?: RunOptions,
  ): Promise<RunResult<T>> => {
    const inputTokens = estimateInputTokens(input, charsPerToken);

    // Pre-call: Check per-call budget
    if (maxCostPerCall != null && callPricing) {
      const estimated = estimateCallCost(
        inputTokens,
        callPricing,
        estimatedOutputMultiplier,
      );
      if (estimated > maxCostPerCall) {
        const details: BudgetExceededDetails = {
          estimated,
          remaining: maxCostPerCall,
          window: "per-call",
          phase: "pre-call",
        };
        report(details);
        throw new BudgetExceededError(details);
      }
    }

    // Pre-call: Check rolling window budgets
    for (const plan of plans) {
      const spent = plan.ledger.getCostInWindow(plan.windowMs);
      const remaining = plan.maxCost - spent;
      const estimated = estimateCallCost(
        inputTokens,
        plan.pricing,
        estimatedOutputMultiplier,
      );

      if (estimated > remaining) {
        const details: BudgetExceededDetails = {
          estimated,
          remaining: Math.max(0, remaining),
          window: plan.window,
          phase: "pre-call",
        };
        report(details);
        throw new BudgetExceededError(details);
      }
    }

    // Execute the call
    const result = await runner<T>(agent, input, options);

    // Post-call: Reconcile against what the provider actually billed.
    const usage = result.tokenUsage;
    if (usage) {
      if (!isUsableTokenUsage(usage)) {
        // Skipping the update loses one call's spend. Applying it would lose
        // every future reading, since NaN and Infinity never wash out of a
        // running total. Warn once so a misreporting provider is visible
        // without turning every call into a log line.
        if (!warnedUnusableUsage) {
          warnedUnusableUsage = true;
          console.warn(
            "[Directive] withBudget: ignoring result.tokenUsage with a non-finite or negative token count. " +
              "Recording it would permanently corrupt the cost ledger, so this call's spend is not counted.",
          );
        }
      } else {
        for (const plan of plans) {
          plan.ledger.record(calculateCost(usage, plan.pricing));
        }

        if (callPricing) {
          const actualCost = calculateCost(usage, callPricing);
          totalSpent += actualCost;

          // The pre-call check gates an *estimate*. A call estimated at a cent
          // that bills five dollars clears the gate and, without this, is
          // absorbed in silence. It cannot be blocked — the money is spent —
          // but it can be reported.
          if (maxCostPerCall != null && actualCost > maxCostPerCall) {
            report({
              estimated: actualCost,
              remaining: maxCostPerCall,
              window: "per-call",
              phase: "post-call",
            });
          }
        }
      }
    }

    return result;
  };

  /**
   * Get cost spent within a given window. Useful for dashboards and preemptive alerts.
   *
   * `"hour"` and `"day"` read the rolling ledger for that window and return `0`
   * if no budget was configured for it. `"total"` is lifetime spend for this
   * runner, priced with the top-level `pricing` — it is the only reading
   * available when `budgets` is empty, where the rolling windows have nothing
   * to report. It returns `0` when no top-level `pricing` was supplied, since
   * there is then no rate to price a call with.
   *
   * @example
   * ```typescript
   * const runner = withBudget(baseRunner, { budgets: [{ window: "hour", maxCost: 10, pricing }] });
   * const spent = (runner as BudgetRunner).getSpent("hour");
   * if (spent > 8) console.warn("Approaching hourly budget limit!");
   * ```
   */
  function getSpent(window: "hour" | "day" | "total"): number {
    if (window === "total") {
      return totalSpent;
    }

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
  /**
   * Get cost spent within a rolling window, or `"total"` for lifetime spend.
   */
  getSpent(window: "hour" | "day" | "total"): number;
};
