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
  calculateUsageCost,
  estimateCallCost,
  isZeroRated,
  snapshotTokenPricing,
  snapshotTokenUsage,
} from "./pricing.js";
import type { AgentLike, AgentRunner, RunOptions, RunResult } from "./types.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Per-million-token rates for a specific model or provider.
 *
 * Every adapter publishes its rates in this shape, so the usual answer is to
 * import a table rather than write the rates out: `ANTHROPIC_PRICING`,
 * `OPENAI_PRICING`, `GEMINI_PRICING`, `OLLAMA_PRICING`. To publish your own
 * table in the same shape, widen a bare `{ input, output }` map with
 * {@link toTokenPricingTable} rather than hand-writing both field spellings.
 *
 * The two cache rates are optional. When omitted, cache tokens are billed at
 * the **input** rate — conservative, and never free. Pricing them at zero would
 * make a heavily cached run read as almost costless while the provider bills it
 * in full, and a cache *write* bills more than plain input on every provider
 * that offers one.
 *
 * @example
 * ```typescript
 * import { ANTHROPIC_PRICING } from '@directive-run/ai/anthropic';
 *
 * // Preferred: a published table entry, already in TokenPricing shape.
 * const pricing: TokenPricing = ANTHROPIC_PRICING["claude-sonnet-4-5-20250929"]!;
 *
 * // Hand-written, for a model with no published table:
 * const custom: TokenPricing = {
 *   inputPerMillion: 5,
 *   outputPerMillion: 15,
 *   cacheReadPerMillion: 0.5,   // optional — defaults to inputPerMillion
 *   cacheWritePerMillion: 6.25, // optional — defaults to inputPerMillion
 * };
 * ```
 */
export interface TokenPricing {
  /** Cost per million input tokens (in dollars). */
  inputPerMillion: number;
  /** Cost per million output tokens (in dollars). */
  outputPerMillion: number;
  /**
   * Cost per million tokens read from the provider's prompt cache.
   * Defaults to {@link TokenPricing.inputPerMillion} when omitted.
   */
  cacheReadPerMillion?: number;
  /**
   * Cost per million tokens written to the provider's prompt cache.
   * Defaults to {@link TokenPricing.inputPerMillion} when omitted — which
   * under-counts, since a cache write typically bills above the input rate.
   */
  cacheWritePerMillion?: number;
}

/**
 * A pricing entry that carries both field spellings for the same rates.
 *
 * `estimateCost(tokenUsage, ratePerMillionTokens)` takes a bare per-million
 * number, so it reads `.input` / `.output` / `.cacheRead` / `.cacheWrite`.
 * `withBudget` and `createConstraintRouter` are typed against
 * {@link TokenPricing}, so they read the `*PerMillion` spellings. Every adapter
 * pricing table is published in this widened shape, derived from one source of
 * numbers, so the pairs cannot drift and no constant is the wrong constant.
 */
export interface ModelPricing extends TokenPricing {
  /** Cost per million input tokens, as a bare rate for `estimateCost`. */
  input: number;
  /** Cost per million output tokens, as a bare rate for `estimateCost`. */
  output: number;
  /** Cost per million cache-read tokens, as a bare rate for `estimateCost`. */
  cacheRead?: number;
  /** Cost per million cache-write tokens, as a bare rate for `estimateCost`. */
  cacheWrite?: number;
}

/** A bare per-million rate set, the input shape of {@link toTokenPricingTable}. */
export interface BareTokenRates {
  input: number;
  output: number;
  /** Omit when the provider does not price cache reads separately. */
  cacheRead?: number;
  /** Omit when the provider does not price cache writes separately. */
  cacheWrite?: number;
}

/**
 * Widen a table of bare `{ input, output }` rates into {@link ModelPricing},
 * where each entry carries both field spellings of the same numbers.
 *
 * Adapters call this to publish their pricing tables. Both rate pairs are
 * derived from the single bare source, so `entry.input` and
 * `entry.inputPerMillion` are the same number by construction — there is no
 * second list of rates to keep in sync. Optional `cacheRead` / `cacheWrite`
 * rates are carried through the same way.
 *
 * The returned table is frozen and has a null prototype: a pricing table read
 * from JSON cannot reroute the table's prototype through an own `__proto__`
 * key, and an entry cannot be swapped for an all-zero one that would silently
 * make a configured cap unreachable.
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
  table: Record<string, BareTokenRates>,
): Record<string, ModelPricing> {
  const widened = Object.create(null) as Record<string, ModelPricing>;
  for (const [model, rates] of Object.entries(table)) {
    widened[model] = Object.freeze({
      input: rates.input,
      output: rates.output,
      inputPerMillion: rates.input,
      outputPerMillion: rates.output,
      ...(rates.cacheRead !== undefined
        ? { cacheRead: rates.cacheRead, cacheReadPerMillion: rates.cacheRead }
        : {}),
      ...(rates.cacheWrite !== undefined
        ? {
            cacheWrite: rates.cacheWrite,
            cacheWritePerMillion: rates.cacheWrite,
          }
        : {}),
    });
  }

  return Object.freeze(widened);
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

function estimateInputTokens(input: string, charsPerToken: number): number {
  return Math.ceil(input.length / charsPerToken);
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
  // share one ledger rather than double-counting against each other.
  const windowLedgers = new Map<string, CostLedger>();

  // Each budget window is flattened into an owned plan at construction: its
  // name, its cap, its rates, and its ledger, all read once and snapshotted.
  // The hot path never reads the caller's `budgets` array again.
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

    let ledger = windowLedgers.get(window);
    if (!ledger) {
      ledger = new CostLedger();
      windowLedgers.set(window, ledger);
    }

    return {
      window,
      maxCost,
      windowMs,
      pricing: snapshotTokenPricing(
        budget.pricing,
        `budgets[${window}].pricing`,
        API,
      ),
      ledger,
    };
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
  let warnedUnusableUsage = false;

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
   * Flag a provider that reported a token count no ledger can accept.
   *
   * Once, not once per call: a misreporting provider should be visible without
   * turning every call into a log line. `getUnpricedCallCount()` carries the
   * running tally for anyone who wants to alert on it.
   */
  function warnUnusableUsageOnce(): void {
    if (warnedUnusableUsage) {
      return;
    }
    warnedUnusableUsage = true;
    console.warn(
      `[Directive] ${API}: result.tokenUsage carried a non-finite or negative token count. Recording it would permanently corrupt the cost ledger, so the pre-call estimate is being charged instead. See getUnpricedCallCount() for how many calls this covers.`,
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
    const planEstimates: number[] = [];
    for (const plan of plans) {
      const spent = plan.ledger.getCostInWindow(plan.windowMs);
      const remaining = plan.maxCost - spent;
      const estimated = estimateCallCost(
        inputTokens,
        plan.pricing,
        estimatedOutputMultiplier,
      );
      planEstimates.push(estimated);

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
    //
    // `tokenUsage` is optional, and plenty of runners never populate it. Left
    // uncounted, such a runner reads as $0 spent forever while real money goes
    // out, and every window budget is silently inert. The pre-call estimate is
    // a poor number, but it is a far better one than zero, so it stands in
    // whenever usage is missing or unusable — and the substitution is counted,
    // so it is visible rather than inferred.
    const usage = snapshotTokenUsage(result.tokenUsage);

    if (result.tokenUsage !== undefined && usage === null) {
      warnUnusableUsageOnce();
    }

    let pricedFromUsage = usage !== null;

    for (let index = 0; index < plans.length; index++) {
      const plan = plans[index]!;
      const billed = usage
        ? calculateUsageCost(usage, plan.pricing)
        : Number.NaN;
      if (!Number.isFinite(billed)) {
        pricedFromUsage = false;
      }
      plan.ledger.record(
        Number.isFinite(billed) ? billed : planEstimates[index]!,
      );
    }

    if (totalPricing) {
      const totalEstimate = callPricing
        ? callEstimate
        : (planEstimates[0] ?? 0);
      const billed = usage
        ? calculateUsageCost(usage, totalPricing)
        : Number.NaN;
      const billedIsUsable = Number.isFinite(billed);
      if (!billedIsUsable) {
        pricedFromUsage = false;
      }

      const cost = billedIsUsable ? billed : totalEstimate;
      if (Number.isFinite(cost)) {
        totalSpent += cost;
      }

      // The pre-call check gates an *estimate*. A call estimated at a cent
      // that bills five dollars clears the gate and, without this, is
      // absorbed in silence. It cannot be blocked — the money is spent —
      // but it can be reported.
      if (
        billedIsUsable &&
        callPricing &&
        maxCostPerCall != null &&
        billed > maxCostPerCall
      ) {
        report({
          estimated: callEstimate,
          actual: billed,
          remaining: maxCostPerCall,
          window: "per-call",
          phase: "post-call",
        });
      }
    }

    if (totalPricing && !pricedFromUsage) {
      unpricedCalls++;
    }

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

    const ledger = windowLedgers.get(window);
    const windowMs = WINDOW_MS.get(window);
    if (!ledger || windowMs === undefined) {
      return 0;
    }

    return ledger.getCostInWindow(windowMs);
  }

  /**
   * How many calls were charged at the pre-call estimate because the provider
   * reported no usable `tokenUsage`.
   *
   * A non-zero count means the ledger is approximate for that many calls. A
   * count that tracks the call count means the runner never reports usage at
   * all, and every figure `getSpent` returns is an estimate.
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
   * because the provider reported no usable `tokenUsage`.
   */
  getUnpricedCallCount(): number;
};
