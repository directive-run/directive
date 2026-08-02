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

import {
  type ResolvedPricing,
  type TokenPricing,
  type UnpricedReason,
  type UsageSnapshot,
  describeUnpricedReason,
  estimateCallCost,
  estimateInputTokens,
  isZeroRated,
  priceCall,
  snapshotCallUsage,
  snapshotTokenPricing,
} from "./pricing.js";
import type { AgentLike, AgentRunner, RunOptions, RunResult } from "./types.js";

// ============================================================================
// Types
// ============================================================================

// The rate shapes live in `pricing.ts`, next to the validation and the cost
// math that read them, and are re-exported here so existing imports keep
// working. `withBudget` is one consumer of the pricing type among several —
// `createConstraintRouter` and every adapter table are others — so a module
// that only needs the type should not have to import a budget to get it.
export {
  toTokenPricingTable,
  type BareTokenRates,
  type ModelPricing,
  type TokenPricing,
} from "./pricing.js";

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
  /**
   * The pre-call cost estimate, in dollars. Always an estimate, in both
   * phases — see {@link BudgetExceededDetails.actual} for what was billed.
   */
  estimated: number;
  /**
   * What the provider actually billed, in dollars. Present only when
   * `phase` is `"post-call"`; there is no billed figure before the call runs.
   */
  actual?: number;
  /** Dollars left against the cap that was checked. */
  remaining: number;
  window: "per-call" | "hour" | "day";
  /**
   * Whether the overrun was caught before the call ran or after it returned.
   *
   * `"pre-call"` means the call was blocked and a {@link BudgetExceededError}
   * was thrown — no spend occurred. `"post-call"` means the provider billed
   * more than the estimate predicted: the call already completed and the money
   * is already spent, so this is a report, not a block, and nothing is thrown.
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

  /**
   * Record one call's cost.
   *
   * A non-finite cost is dropped rather than stored. Rates and token counts are
   * both validated, but their product can still overflow to `Infinity`, and one
   * `Infinity` in the ledger is permanent: every later window total is
   * `Infinity`, so every subsequent call trips the budget and the runner is
   * bricked until it is rebuilt.
   */
  record(cost: number): void {
    if (!Number.isFinite(cost)) {
      return;
    }

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

/**
 * Window name to duration.
 *
 * A `Map`, not an object literal: `WINDOW_MS["__proto__"]` on a literal returns
 * `Object.prototype` rather than `undefined`, which would sail past a
 * presence check and leave every comparison against the window `NaN`.
 */
const WINDOW_MS = new Map<string, number>([
  ["hour", 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
]);

const WINDOW_NAMES = [...WINDOW_MS.keys()]
  .map((name) => `"${name}"`)
  .join(", ");

/** The public function name used in this module's error messages. */
const API = "withBudget";

/**
 * One rolling window's shared ledger.
 *
 * Budgets are per-cap; ledgers are per-window. Two budgets on the same window
 * are two caps reading one running total, so a call is recorded there once. The
 * post-call loop used to record once per *budget*, which billed a $3 call as $6
 * against a shared hour: `getSpent("hour")` read double, and a pair of $100
 * hourly caps blocked after $51 of real spend.
 *
 * One ledger, one price. Budgets sharing a window must therefore agree on the
 * rates, and {@link withBudget} rejects the configuration at construction when
 * they do not — see the check there.
 */
interface WindowLedger {
  window: "hour" | "day";
  windowMs: number;
  pricing: ResolvedPricing;
  ledger: CostLedger;
}

/** Whether two validated rate sets price every token class identically. */
function sameRates(a: ResolvedPricing, b: ResolvedPricing): boolean {
  return (
    a.inputPerMillion === b.inputPerMillion &&
    a.outputPerMillion === b.outputPerMillion &&
    a.cacheReadPerMillion === b.cacheReadPerMillion &&
    a.cacheWritePerMillion === b.cacheWritePerMillion
  );
}

/** Render a rate set for an error message. */
function describeRates(pricing: ResolvedPricing): string {
  return `in ${pricing.inputPerMillion}/out ${pricing.outputPerMillion}/cache-read ${pricing.cacheReadPerMillion}/cache-write ${pricing.cacheWritePerMillion} per million`;
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

  // Every caller-supplied scalar below is read exactly once, into a local,
  // then validated and stored. Reading a config value more than once is the
  // same check-then-use gap pricing snapshotting closes: a getter that returns
  // `10, 10, NaN` would pass validation and still store `NaN`.

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
    ? snapshotTokenPricing(pricing, "pricing", API)
    : undefined;

  // Per-window ledgers, keyed by window so two budgets on the same window
  // share one running total rather than double-counting against each other.
  const windowLedgers = new Map<string, WindowLedger>();

  // Each budget window is flattened into an owned plan at construction: its
  // name, its cap, its rates, and its window's shared ledger, all read once and
  // snapshotted. The hot path never reads the caller's `budgets` array again.
  const plans = Array.from(budgets, (budget, index) => {
    const window = budget.window;
    const maxCost = budget.maxCost;
    const windowMs = WINDOW_MS.get(window as string);

    if (windowMs === undefined) {
      throw new Error(
        `[Directive] ${API}: budgets[${index}].window must be one of ${WINDOW_NAMES} (received ${JSON.stringify(window)}). An unrecognized window has no duration to measure spend over, so the cap can never trip and the budget is inert.`,
      );
    }

    if (
      typeof maxCost !== "number" ||
      !Number.isFinite(maxCost) ||
      maxCost < 0
    ) {
      throw new Error(
        `[Directive] ${API}: budgets[${window}].maxCost must be a non-negative finite number.`,
      );
    }

    const budgetPricing = snapshotTokenPricing(
      budget.pricing,
      `budgets[${window}].pricing`,
      API,
    );

    let shared = windowLedgers.get(window);
    if (!shared) {
      shared = {
        window,
        windowMs,
        pricing: budgetPricing,
        ledger: new CostLedger(),
      };
      windowLedgers.set(window, shared);
    } else if (!sameRates(shared.pricing, budgetPricing)) {
      // One call cannot cost two amounts. Budgets on the same window share one
      // running total by design, so the ledger has to record at one set of
      // rates; whichever budget's rates lose, its cap then gates against a
      // total that was never computed at its rates. It is not a tie worth
      // breaking, it is an incoherent configuration: two hourly caps, one at
      // $0.001/M and one at $15/$75, recorded fifty real calls costing $4,500
      // as ten cents. Neither cap tripped and nothing was logged.
      throw new Error(
        `[Directive] ${API}: budgets[${index}] shares the ${JSON.stringify(window)} window with an earlier budget but prices it differently (${describeRates(shared.pricing)} vs ${describeRates(budgetPricing)}). Budgets on one window share one running total, so a call recorded at one set of rates would be gated by a cap expecting the other. Give every budget on a window the same pricing, or move one to a different window.`,
      );
    }

    return { window, maxCost, windowMs, pricing: budgetPricing, shared };
  });

  // A cap that no number of tokens can reach is not a cap. Zero rates are
  // legitimate for local models, but pairing them with a non-zero cap always
  // means the cap is doing nothing.
  const inertCaps: string[] = [];
  if (
    maxCostPerCall != null &&
    maxCostPerCall > 0 &&
    callPricing &&
    isZeroRated(callPricing)
  ) {
    inertCaps.push("maxCostPerCall");
  }
  for (const plan of plans) {
    if (plan.maxCost > 0 && isZeroRated(plan.pricing)) {
      inertCaps.push(`budgets[${plan.window}].maxCost`);
    }
  }
  if (inertCaps.length > 0) {
    console.warn(
      `[Directive] ${API}: ${inertCaps.join(", ")} set against pricing where every rate is 0, so no call can ever cost anything and the cap can never trip. Either supply real rates or drop the cap.`,
    );
  }

  // Lifetime spend, priced with whichever rates actually priced the call: the
  // top-level `pricing` when supplied, otherwise the first window's. A running
  // total rather than a ledger: it is never pruned, so storing entries would
  // grow without bound for the life of the runner.
  const totalPricing = callPricing ?? plans[0]?.pricing;
  let totalSpent = 0;
  let unpricedCalls = 0;
  const warnedReasons = new Set<UnpricedReason>();

  /**
   * Notify the caller, never letting their callback disrupt the budget flow.
   *
   * The callback gets a frozen copy, not the object the error is built from.
   * Rewriting `estimated` to a string on the shared object made
   * `BudgetExceededError`'s own message template throw a `TypeError`, so a hard
   * budget block surfaced as a transient failure and callers retried it.
   */
  function report(details: BudgetExceededDetails): void {
    try {
      onBudgetExceeded?.(Object.freeze({ ...details }));
    } catch {
      /* callback error must not disrupt budget flow */
    }
  }

  /**
   * Flag a call the provider gave no usable price for.
   *
   * Once per distinct condition, not once per call: a runner that never reports
   * usage would otherwise turn every call into the same log line.
   * `getUnpricedCallCount()` carries the running tally for anyone who wants to
   * alert on it.
   *
   * The missing-usage case warns too. It was the quieter of the two and the
   * likelier one — a runner that simply never populates `tokenUsage` is an
   * ordinary thing to write — and it left the ledger running entirely on
   * estimates with nothing in the log to say so.
   */
  function warnUnpricedOnce(reason: UnpricedReason): void {
    if (warnedReasons.has(reason)) {
      return;
    }
    warnedReasons.add(reason);
    console.warn(
      `[Directive] ${API}: ${describeUnpricedReason(reason)}. The pre-call estimate is being charged instead — see getUnpricedCallCount() for how many calls this covers. Logged once per condition.`,
    );
  }

  const budgetRunner: AgentRunner = async <T = unknown>(
    agent: AgentLike,
    input: string,
    options?: RunOptions,
  ): Promise<RunResult<T>> => {
    const inputTokens = estimateInputTokens(input, charsPerToken);

    // The per-call estimate is kept: it gates the call below, and it is what
    // the ledger falls back to when the provider reports no usable usage.
    const callEstimate = callPricing
      ? estimateCallCost(inputTokens, callPricing, estimatedOutputMultiplier)
      : 0;

    // Pre-call: Check per-call budget
    if (maxCostPerCall != null && callPricing) {
      if (callEstimate > maxCostPerCall) {
        const details: BudgetExceededDetails = {
          estimated: callEstimate,
          remaining: maxCostPerCall,
          window: "per-call",
          phase: "pre-call",
        };
        report(details);
        throw new BudgetExceededError(details);
      }
    }

    // Pre-call: Check rolling window budgets
    const planChecks: {
      plan: (typeof plans)[number];
      remaining: number;
      estimated: number;
    }[] = [];
    for (const plan of plans) {
      const spent = plan.shared.ledger.getCostInWindow(plan.windowMs);
      const remaining = plan.maxCost - spent;
      const estimated = estimateCallCost(
        inputTokens,
        plan.pricing,
        estimatedOutputMultiplier,
      );
      planChecks.push({ plan, remaining, estimated });

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

    /**
     * Reconcile one completed attempt against every cap, and record it.
     *
     * Takes a {@link UsageSnapshot}, never a result: the usage is read once, at
     * the boundary below, and this function prices that *value* against each
     * window's rates and again for the lifetime total. Handing it the result
     * instead would put N+1 reads of a provider-owned object on the hot path,
     * and a `tokenUsage` backed by getters answers each one differently.
     */
    function reconcile(snapshot: UsageSnapshot): void {
      // `tokenUsage` is optional, and plenty of runners never populate it. Left
      // uncounted, such a runner reads as $0 spent forever while real money
      // goes out, and every window budget is silently inert. `priceCall`
      // charges the pre-call estimate whenever usage cannot price the call, and
      // reports which it did, so the substitution is visible rather than
      // inferred.
      let estimatedReason: UnpricedReason | null = null;

      // One record per window, not per budget: the ledger is shared, so a
      // second budget on the same window must not bill the same call twice.
      const billedByWindow = new Map<string, number>();
      for (const shared of windowLedgers.values()) {
        const estimate = estimateCallCost(
          inputTokens,
          shared.pricing,
          estimatedOutputMultiplier,
        );
        const priced = priceCall(snapshot, shared.pricing, estimate);
        if (priced.basis === "estimated") {
          estimatedReason ??= priced.reason;
        }
        billedByWindow.set(shared.window, priced.cost);
        shared.ledger.record(priced.cost);
      }

      // The pre-call check gates an *estimate*, against a window cap as much as
      // against the per-call cap. A call that estimated under its remaining
      // hour and billed over it used to land in the ledger with nothing said,
      // and the *next* call was the one that got blocked. It cannot be undone —
      // the money is spent — but the cap it overran can be named when it
      // happens.
      for (const check of planChecks) {
        const billed = billedByWindow.get(check.plan.window) ?? 0;
        if (billed > check.remaining) {
          report({
            estimated: check.estimated,
            actual: billed,
            remaining: Math.max(0, check.remaining),
            window: check.plan.window,
            phase: "post-call",
          });
        }
      }

      if (totalPricing) {
        const totalEstimate = callPricing
          ? callEstimate
          : (planChecks[0]?.estimated ?? 0);
        const priced = priceCall(snapshot, totalPricing, totalEstimate);
        if (priced.basis === "estimated") {
          estimatedReason ??= priced.reason;
        }
        totalSpent += priced.cost;

        // Same reasoning as the window overruns above, for the per-call cap.
        if (
          priced.basis === "metered" &&
          callPricing &&
          maxCostPerCall != null &&
          priced.cost > maxCostPerCall
        ) {
          report({
            estimated: callEstimate,
            actual: priced.cost,
            remaining: maxCostPerCall,
            window: "per-call",
            phase: "post-call",
          });
        }
      }

      if (estimatedReason !== null) {
        unpricedCalls++;
        warnUnpricedOnce(estimatedReason);
      }
    }

    // Execute the call.
    let result: RunResult<T>;
    try {
      result = await runner<T>(agent, input, options);
    } catch (error) {
      // A throw is not a refund. Plenty of runners fail *after* the provider
      // has generated and billed the tokens — a structured-output parse that
      // rejects the completion, an output guardrail that blocks it, a
      // post-stream validation. Dropping the cost there meant every retry under
      // `withRetry` burned real money that no window ledger and no lifetime
      // total ever saw, and the caller's first evidence was the invoice. The
      // estimate is charged and counted before the error propagates; over-
      // estimating is the safe direction for a spend guard.
      reconcile({ kind: "unusable", reason: "failed-call" });

      throw error;
    }

    // Post-call: read the provider's usage exactly once, then reconcile the
    // value against every cap.
    reconcile(snapshotCallUsage(result));

    return result;
  };

  /**
   * Get cost spent within a given window. Useful for dashboards and preemptive alerts.
   *
   * `"hour"` and `"day"` read the rolling ledger for that window and return `0`
   * if no budget was configured for it. `"total"` is lifetime spend for this
   * runner, priced with whichever rates actually priced the call — the
   * top-level `pricing` when supplied, otherwise the first budget window's. It
   * returns `0` only when neither was configured, since there is then no rate
   * to price a call with.
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

    const shared = windowLedgers.get(window);
    if (!shared) {
      return 0;
    }

    return shared.ledger.getCostInWindow(shared.windowMs);
  }

  /**
   * How many calls were charged at the pre-call estimate rather than at what
   * the provider billed.
   *
   * Three conditions land here: the result carried no `tokenUsage`, it carried
   * a non-finite or negative count, or the counts and rates were both valid but
   * priced out to a non-finite cost. A non-zero count means the ledger is
   * approximate for that many calls. A count that tracks the call count means
   * the runner never reports usable usage at all, and every figure `getSpent`
   * returns is an estimate.
   */
  function getUnpricedCallCount(): number {
    return unpricedCalls;
  }

  // Attach the accessors as direct properties for type-safe access without casting
  const accessors = budgetRunner as unknown as Record<string, unknown>;
  accessors.getSpent = getSpent;
  accessors.getUnpricedCallCount = getUnpricedCallCount;

  return budgetRunner as unknown as BudgetRunner;
}

/** Helper type for accessing a budget runner's spend accessors. */
export type BudgetRunner = AgentRunner & {
  /**
   * Get cost spent within a rolling window, or `"total"` for lifetime spend.
   */
  getSpent(window: "hour" | "day" | "total"): number;
  /**
   * Get the number of calls whose spend was charged at the pre-call estimate
   * rather than at what the provider billed — no `tokenUsage`, an unusable
   * token count, or a cost that priced out non-finite.
   */
  getUnpricedCallCount(): number;
};
