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

import {
  type ResolvedPricing,
  type TokenPricing,
  type UnpricedReason,
  type UsageSnapshot,
  describeUnpricedReason,
  estimateCallCost,
  estimateInputRate,
  estimateInputTokens,
  isZeroRated,
  priceCall,
  snapshotCallUsage,
  snapshotTokenPricing,
} from "./pricing.js";
import type { TokenSink } from "./streaming.js";
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
  /**
   * Lifetime ceiling on this runner's recorded spend, in dollars.
   *
   * **A floor, not a forecast.** Every other cap here gates a *prediction*: the
   * pre-call estimate is compared against what is left, and the call is refused
   * before it runs. This one gates the ledger. Once `getSpent("total")` has
   * reached `maxTotalCost`, no further call is dispatched — and until it has,
   * nothing is refused, however large the next call looks.
   *
   * That asymmetry is the point, and it is what makes this cap composable with a
   * caller's own stopping rule rather than a competitor to it. A chain that
   * decides for itself when to stop — because it knows things this runner does
   * not, like the token cap of the call it is about to make, or that a closing
   * document still has to be paid for — wants its own rule to be the one that
   * fires in the ordinary case, and wants a hard floor underneath for the case
   * where its own estimate was wrong. A cap that also predicted would fire
   * *instead of* the caller's rule as soon as its prediction was the more
   * pessimistic of the two, which is exactly the arrangement where two ceilings
   * at the same number disagree about what happened.
   *
   * Spend can therefore exceed `maxTotalCost` by at most the cost of the one
   * call that crossed it. Nothing enforced after the fact against a provider
   * that bills after the fact can do better without predicting, and a caller who
   * wants the prediction has {@link BudgetConfig.maxCostPerCall} and
   * {@link BudgetConfig.budgets} for it.
   *
   * Priced with the same rates as `getSpent("total")` — the top-level
   * {@link BudgetConfig.pricing} when supplied, otherwise the first window's — so
   * a cap set without either can never trip and is refused at construction.
   *
   * @example
   * ```typescript
   * const runner = withBudget(baseRunner, {
   *   pricing,
   *   // Whatever else stops this run, it does not get to spend past $5.
   *   maxTotalCost: 5,
   * });
   * ```
   */
  maxTotalCost?: number;
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
   * Refuse further calls once this many recent ones have been charged from what
   * they delivered rather than from reported usage.
   *
   * An unpriced call is one the provider gave no usable price for — no
   * `tokenUsage`, a count no ledger can accept, an all-zero or explicitly
   * unreported usage, a cost that overflowed, or a call that threw. Whatever
   * such a call delivered is charged, so the window still accrues and the
   * ceiling still trips — but from measured text rather than a counted
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

/**
 * Which ceiling a {@link BudgetExceededDetails} is about.
 *
 * `"total"` is the lifetime ledger floor ({@link BudgetConfig.maxTotalCost}) and
 * is the one entry here that reports recorded spend rather than a prediction.
 */
export type BudgetWindowName = "per-call" | "total" | "hour" | "day";

export interface BudgetExceededDetails {
  /**
   * The pre-call cost estimate, in dollars. Always an estimate, in both
   * phases — except for `window: "total"`, where it is the recorded lifetime
   * spend the ceiling was measured against, since that cap gates the ledger and
   * never a forecast.
   */
  estimated: number;
  /**
   * What the provider actually billed, in dollars. Present only when
   * `phase` is `"post-call"`; there is no billed figure before the call runs.
   */
  actual?: number;
  /** Dollars left against the cap that was checked. */
  remaining: number;
  window: BudgetWindowName;
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
  readonly window: BudgetWindowName;

  constructor(details: BudgetExceededDetails) {
    super(
      details.window === "total"
        ? `[Directive] Budget exhausted (total): spent $${details.estimated.toFixed(4)} of a $${(details.estimated + details.remaining).toFixed(4)} lifetime ceiling. No further calls will be dispatched on this runner.`
        : `[Directive] Budget exceeded (${details.window}): estimated $${details.estimated.toFixed(4)}, ` +
            `remaining $${details.remaining.toFixed(4)}`,
    );
    this.name = "BudgetExceededError";
    this.estimated = details.estimated;
    this.remaining = details.remaining;
    this.window = details.window;
  }
}

/**
 * Error thrown when too many recent calls could only be charged at estimate.
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
  /**
   * The subset of `ledger` charged for calls that threw.
   *
   * Every entry here is also in `ledger` — this is a second view of the same
   * spend, not a second charge. It exists because a caller looking at
   * `getSpent("hour")` cannot otherwise tell money the provider counted from
   * money charged for a delivery this guard had to measure for itself. See
   * {@link BudgetRunner.getFailedCallSpend}.
   */
  failedLedger: CostLedger;
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

/**
 * Everything a run produced that the provider generated, for measuring output
 * when it declined to count it.
 *
 * Assistant messages are the generated text; the user turn and any tool
 * results are input to the next call, not output of this one.
 */
function assistantText(result: RunResult<unknown>): string | undefined {
  let text = "";
  if (Array.isArray(result.messages)) {
    for (const message of result.messages) {
      if (message.role === "assistant" && typeof message.content === "string") {
        text += message.content;
      }
    }
  }
  if (text.length > 0) {
    return text;
  }

  return typeof result.output === "string" ? result.output : undefined;
}

/**
 * Whether the runner said outright that the provider counted nothing.
 *
 * Read as an own property: an inherited `usageReported` would otherwise send
 * every call on every runner down the estimate path. A runner that omits the
 * field is saying nothing, which reads as "usage is trustworthy" — the behavior
 * every runner had before the flag existed.
 */
function declaredUnreported(result: RunResult<unknown>): boolean {
  return (
    Object.hasOwn(result, "usageReported") && result.usageReported === false
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
export function withBudget(
  runner: AgentRunner,
  config: BudgetConfig,
): BudgetRunner {
  const {
    maxCostPerCall,
    maxTotalCost,
    budgets = [],
    pricing,
    charsPerToken = 4,
    estimatedOutputMultiplier = 1.0,
    maxUnpricedCalls,
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
    maxTotalCost != null &&
    (!Number.isFinite(maxTotalCost) || maxTotalCost < 0)
  ) {
    throw new Error(
      "[Directive] withBudget: maxTotalCost must be a non-negative finite number.",
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
        failedLedger: new CostLedger(),
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

  // The top-level `pricing` is one more set of rates for the same call, so it
  // is held to the same rule as two budgets sharing a window: one call cannot
  // cost two amounts. It prices `maxCostPerCall` and the lifetime total while
  // the window rates price the window ledgers, and when the two disagree the
  // two figures describe different runs. `pricing` at $0.001/M against an
  // hourly budget at $15/$75 reported `getSpent("hour")` of $450 beside a
  // `getSpent("total")` of one cent, and left `maxCostPerCall` estimating
  // fifteen thousand times low — a cap that cannot trip, on a runner that was
  // configured to have one.
  if (callPricing) {
    for (const shared of windowLedgers.values()) {
      if (!sameRates(callPricing, shared.pricing)) {
        throw new Error(
          `[Directive] ${API}: pricing prices a call differently from budgets[${JSON.stringify(shared.window)}].pricing (${describeRates(callPricing)} vs ${describeRates(shared.pricing)}). Both price the same call — the top-level rates drive maxCostPerCall and getSpent("total"), the window's drive that window's cap — so a disagreement makes the two report different spend for the same run. Give every set of rates on one runner the same values, or drop the one you did not mean to configure.`,
        );
      }
    }
  }

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

  // A lifetime ceiling with nothing to price a call at is a ceiling the ledger
  // can never reach: `totalSpent` stays at zero for the life of the runner and
  // the cap silently does nothing. Refused rather than warned, because unlike
  // zero rates — legitimate for a local model — there is no configuration this
  // is the right shape of.
  if (maxTotalCost != null && !totalPricing) {
    throw new Error(
      `[Directive] ${API}: maxTotalCost was set but no rates were supplied, so lifetime spend is never priced and the ceiling can never trip. Pass \`pricing\`, or configure at least one budget window.`,
    );
  }
  if (
    maxTotalCost != null &&
    maxTotalCost > 0 &&
    totalPricing &&
    isZeroRated(totalPricing)
  ) {
    console.warn(
      `[Directive] ${API}: maxTotalCost set against pricing where every rate is 0, so no call can ever cost anything and the ceiling can never trip. Either supply real rates or drop the cap.`,
    );
  }

  let totalSpent = 0;
  /** The part of `totalSpent` charged for calls that threw. */
  let totalFailedSpent = 0;

  /**
   * Calls charged from what they delivered rather than from reported usage,
   * timestamped so the count decays on the same basis as the ledgers beside it.
   *
   * Every other figure this module keeps decays, and this one did not — it only
   * ever incremented, for the life of the runner. Twenty-five transient
   * failures during one provider outage therefore refused every call
   * afterwards, forever, with the provider healthy again and the budget
   * untouched. Sharing the ledgers' basis makes the count say what the ledgers
   * say: what has happened lately.
   */
  const unpricedLedger = new CostLedger();
  /** The widest configured budget window, or an hour when none is. */
  const unpricedMs =
    plans.reduce((widest, plan) => Math.max(widest, plan.windowMs), 0) ||
    WINDOW_MS.get("hour")!;
  const warnedReasons = new Set<UnpricedReason>();

  function countUnpriced(): number {
    return unpricedLedger.getCostInWindow(unpricedMs);
  }

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
   * Count one call the provider gave no usable price for, and flag it.
   *
   * The count is the ledger; the log line is once per distinct condition, not
   * once per call, because a runner that never reports usage would otherwise
   * turn every call into the same line. `getUnpricedCallCount()` carries the
   * running tally for anyone who wants to alert on it, and
   * {@link BudgetConfig.maxUnpricedCalls} turns that tally into a ceiling.
   *
   * The missing-usage case warns too. It was the quietest of the conditions and
   * the likeliest one — a runner that simply never populates `tokenUsage` is an
   * ordinary thing to write — and it left the ledger running entirely on
   * measurements with nothing in the log to say so.
   */
  function noteUnpriced(reason: UnpricedReason): void {
    unpricedLedger.record(1);
    if (warnedReasons.has(reason)) {
      return;
    }
    warnedReasons.add(reason);
    console.warn(
      `[Directive] ${API}: ${describeUnpricedReason(reason)}. What the call delivered is being charged instead — see getUnpricedCallCount() for how many calls this covers. Logged once per condition.`,
    );
  }

  const budgetRunner: AgentRunner = async <T = unknown>(
    agent: AgentLike,
    input: string,
    options?: RunOptions,
  ): Promise<RunResult<T>> => {
    const inputTokens = estimateInputTokens(input, charsPerToken);

    // The per-call estimate gates the call below. It is a prediction, not a
    // measurement, and nothing after the call is charged from it.
    const callEstimate = callPricing
      ? estimateCallCost(inputTokens, callPricing, estimatedOutputMultiplier)
      : 0;

    /**
     * What one generation cost, measured from the text that actually arrived.
     *
     * `estimatedOutputMultiplier` is a guess about a quantity it has no
     * relation to: a 50k-token retrieval prompt answered in 200 tokens is
     * priced at 50k of output and over-charges by nearly six times, while a
     * one-line prompt answered at length under-charges by orders of magnitude.
     * It gates the pre-call check because a pre-call check has nothing better,
     * and it is never used again — once a response exists,
     * `length / charsPerToken` measures it.
     *
     * Clamped to a finite figure: astronomically large rates meeting a long
     * response can overflow, and one `Infinity` in a ledger is permanent.
     */
    function measuredCost(
      outputChars: number,
      forPricing: ResolvedPricing,
    ): number {
      const outputTokens = Math.ceil(Math.max(0, outputChars) / charsPerToken);
      const cost =
        (inputTokens / 1_000_000) * estimateInputRate(forPricing) +
        (outputTokens / 1_000_000) * forPricing.outputPerMillion;

      return Number.isFinite(cost) && cost >= 0 ? cost : 0;
    }

    // Pre-call: a provider that has stopped reporting usage cannot be
    // budgeted, only approximated. Past the configured tolerance, refuse
    // rather than let a hard ceiling go on being enforced against estimates.
    const unpricedSoFar = countUnpriced();
    if (maxUnpricedCalls != null && unpricedSoFar >= maxUnpricedCalls) {
      throw new UnpricedCallLimitError(unpricedSoFar, maxUnpricedCalls);
    }

    // Pre-call: the lifetime floor.
    //
    // First, because it is the only check here that is not arguing about a
    // prediction. Once the ledger has reached the ceiling there is no estimate
    // that makes the next call affordable, and nothing below needs consulting.
    if (maxTotalCost != null && totalSpent >= maxTotalCost) {
      const details: BudgetExceededDetails = {
        estimated: totalSpent,
        remaining: Math.max(0, maxTotalCost - totalSpent),
        window: "total",
        phase: "pre-call",
      };
      report(details);
      throw new BudgetExceededError(details);
    }

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

    // What the provider actually delivered for this call, counted as it
    // arrives. This is the only figure here that is observed rather than
    // declared, and every charge that reported usage cannot cover is derived
    // from it.
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
     * Reconcile one completed attempt against every cap, and record it.
     *
     * Takes a {@link UsageSnapshot}, never a result: the usage is read once at
     * the boundary below, and this prices that *value* against each window's
     * rates and again for the lifetime total.
     *
     * `observedChars` is the text delivered for the generation the snapshot
     * describes, charged when usage cannot price it. `extraChars` is text
     * delivered for generations the snapshot says nothing about — a retry, a
     * fallback, a schema re-ask — which are always charged from what arrived,
     * since no usage report covers them.
     *
     * `chargeable` is whether anything arrived at all. A refused connection
     * delivered nothing, so there is nothing to price and nothing is recorded;
     * it is still counted, because a call that fails after dispatch may have
     * been billed for work whose size is unknowable from here.
     */
    function settle(settlement: {
      snapshot: UsageSnapshot;
      observedChars: number;
      extraChars: number;
      failed: boolean;
      chargeable: boolean;
    }): void {
      const { snapshot, observedChars, extraChars, failed, chargeable } =
        settlement;

      // `tokenUsage` is optional, and plenty of runners never populate it. Left
      // uncounted, such a runner reads as $0 spent forever while real money
      // goes out, and every window budget is silently inert. `priceCall`
      // charges the measured figure whenever usage cannot price the call, and
      // reports which it did, so the substitution is visible rather than
      // inferred.
      let estimatedReason: UnpricedReason | null =
        snapshot.kind === "unusable"
          ? snapshot.reason
          : extraChars > 0
            ? "replayed-generation"
            : null;

      if (chargeable) {
        // One record per window, not per budget: the ledger is shared, so a
        // second budget on the same window must not bill the same call twice.
        const billedByWindow = new Map<string, number>();
        for (const shared of windowLedgers.values()) {
          const priced = priceCall(
            snapshot,
            shared.pricing,
            measuredCost(observedChars, shared.pricing),
          );
          if (priced.basis === "estimated") {
            estimatedReason ??= priced.reason;
          }
          const billed =
            extraChars > 0
              ? priced.cost + measuredCost(extraChars, shared.pricing)
              : priced.cost;

          billedByWindow.set(shared.window, billed);
          shared.ledger.record(billed);
          // A charge for a call that threw goes into the window's failed ledger
          // as well as its main one — same money, recorded twice for two
          // different questions. See `getFailedCallSpend`.
          if (failed) {
            shared.failedLedger.record(billed);
          }
        }

        // The pre-call check gates an *estimate*, against a window cap as much
        // as against the per-call cap. A call that estimated under its
        // remaining hour and billed over it used to land in the ledger with
        // nothing said, and the *next* call was the one that got blocked. It
        // cannot be undone — the money is spent — but the cap it overran can be
        // named when it happens.
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
          const priced = priceCall(
            snapshot,
            totalPricing,
            measuredCost(observedChars, totalPricing),
          );
          if (priced.basis === "estimated") {
            estimatedReason ??= priced.reason;
          }
          const billed =
            extraChars > 0
              ? priced.cost + measuredCost(extraChars, totalPricing)
              : priced.cost;

          if (Number.isFinite(billed)) {
            const before = totalSpent;
            totalSpent += billed;
            if (failed) {
              totalFailedSpent += billed;
            }

            // The call that crossed the lifetime floor. It ran — the floor
            // gates the *next* one — so this is a report of the overshoot, and
            // the overshoot is exactly `billed`. Reported once, on the
            // crossing, not on every call afterwards, which is the only one
            // worth a callback: after this the runner refuses outright.
            if (
              maxTotalCost != null &&
              before < maxTotalCost &&
              totalSpent >= maxTotalCost
            ) {
              report({
                estimated: before,
                actual: totalSpent,
                remaining: Math.max(0, maxTotalCost - before),
                window: "total",
                phase: "post-call",
              });
            }
          }

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
      }

      if (estimatedReason !== null) {
        noteUnpriced(estimatedReason);
      }
    }

    // Execute the call.
    let result: RunResult<T>;
    try {
      result = await runner<T>(agent, input, budgetOptions);
    } catch (error) {
      // A budget below this one refused before dispatch, so nothing was sent
      // and nothing is owed — neither a charge nor a count. Both refusals are
      // pre-dispatch by construction: the inner guard raises them from its own
      // pre-call checks, before it invokes the runner it wraps. Charging them
      // would let a chain of guards bill each other for calls none of them
      // made, and the nested unpriced-call refusal cascaded its own lockout
      // outward on top of that.
      if (
        error instanceof BudgetExceededError ||
        error instanceof UnpricedCallLimitError
      ) {
        throw error;
      }

      // Otherwise: charge what arrived before it failed, which for a stream cut
      // short by a marker check or a truncated body is the whole response the
      // provider generated and billed. A call that delivered nothing — a DNS
      // failure, a refused connection, a pre-flight throw — cost nothing and is
      // charged nothing; charging those at a predicted ceiling locked a $5/hour
      // budget for a full hour over seventy-four connection refusals that never
      // reached a provider.
      //
      // What *is* charged here is recorded separately as well, and
      // `getFailedCallSpend` reports it. An operator watching a cap fill up can
      // then see how much of it is money a provider counted and how much is a
      // delivery this guard had to measure for itself, which is the question
      // the single figure could not answer.
      settle({
        snapshot: { kind: "unusable", reason: "failed-call" },
        observedChars: deliveredChars,
        extraChars: 0,
        failed: true,
        chargeable: deliveredChars > 0,
      });

      throw error;
    }

    // Post-call: read the provider's usage exactly once, then reconcile the
    // value against every cap.
    //
    // A provider that reported no usage has not said the call was free — an
    // OpenAI-compatible endpoint that ignores `stream_options.include_usage`
    // returns zeros for a call that cost real money, and a runner that says as
    // much outright with `usageReported: false` is not to be taken for one
    // reporting a free call either. Recording those zeros means the window
    // never accrues and the ceiling never trips.
    const reported = snapshotCallUsage(result);
    const snapshot: UsageSnapshot =
      reported.kind === "resolved" && declaredUnreported(result)
        ? { kind: "unusable", reason: "zero-usage" }
        : reported;
    const metered = snapshot.kind === "resolved";
    const deliveredByResult = assistantText(result)?.length ?? 0;

    settle({
      snapshot,
      // Nothing to price the call from: charge the largest delivery observed,
      // whether it was counted as it streamed or read off the finished result.
      observedChars: metered
        ? deliveredByResult
        : Math.max(deliveredByResult, deliveredChars),
      // Bytes delivered beyond what the result describes came from a generation
      // that was replayed over — a retry, a fallback, a schema re-ask — and the
      // provider billed for those as well, while the usage on the surviving
      // result describes only itself. They were observed, so they are charged.
      extraChars: metered ? Math.max(0, deliveredChars - deliveredByResult) : 0,
      failed: false,
      chargeable: true,
    });

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
   * Includes what was charged for deliveries that failed part-way — see
   * {@link BudgetRunner.getFailedCallSpend} to separate that out.
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
   * How much of what {@link getSpent} reports was charged for calls that threw.
   *
   * Read alongside `getSpent`, never instead of it: `getSpent("hour")` is what
   * the cap gates on, and this says how much of that figure came from a call
   * that never returned. A throw carries no usage report, so whatever the
   * provider delivered before it failed is measured and charged — right, since
   * the provider generated and billed exactly that text, and unavoidably
   * approximate, since no count for it ever arrived. A failure that delivered
   * nothing is charged nothing and appears in neither figure.
   *
   * A figure that approaches `getSpent` means the cap is being consumed by
   * calls that break part-way through: a gateway truncating responses, a
   * guardrail rejecting completions, a schema that never parses. That is worth
   * alerting on, and it used to be indistinguishable from a runner spending
   * ordinary money.
   *
   * Windows use the same rolling cutoff and the same rates as `getSpent`, so
   * `getSpent(w) - getFailedCallSpend(w)` is spend attributable to calls that
   * returned. Calls blocked by this runner's own caps are in neither figure —
   * they never ran.
   */
  function getFailedCallSpend(window: "hour" | "day" | "total"): number {
    if (window === "total") {
      return totalFailedSpent;
    }

    const shared = windowLedgers.get(window);
    if (!shared) {
      return 0;
    }

    return shared.failedLedger.getCostInWindow(shared.windowMs);
  }

  /**
   * How many recent calls were charged from what they delivered rather than
   * from what the provider billed.
   *
   * The result carried no `tokenUsage`, it carried a count that was not a
   * non-negative integer, it reported zero of every token class or said
   * outright that usage was not reported, the call threw, bytes arrived for a
   * generation the surviving result does not describe, or the counts and rates
   * were both valid but priced out to a non-finite cost.
   *
   * Kept over a rolling window — the widest configured budget window, or an
   * hour when none is configured — so it reads as "lately", like the ledgers it
   * sits beside. A lifetime total meant one bad afternoon refused every call a
   * long-lived runner ever made afterwards.
   *
   * A non-zero count means the recorded spend is an approximation for that many
   * calls. A count that tracks the call count means the endpoint is not
   * returning usage at all — a gateway that drops
   * `stream_options.include_usage` is the usual cause — and every figure
   * `getSpent` returns is measured rather than billed. Set
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

  // Attach the accessors as direct properties for type-safe access without casting
  const accessors = budgetRunner as unknown as Record<string, unknown>;
  accessors.getSpent = getSpent;
  accessors.getFailedCallSpend = getFailedCallSpend;
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
   * Get how much of {@link BudgetRunner.getSpent}'s figure was charged for
   * calls that threw, rather than for calls the provider completed.
   *
   * A throw reports no usage, so whatever arrived before it is measured and
   * charged against every cap; a failure that delivered nothing is charged
   * nothing. Subtract this from `getSpent` for spend attributable to calls that
   * returned.
   */
  getFailedCallSpend(window: "hour" | "day" | "total"): number;
  /**
   * Get the number of recent calls whose spend was charged from what they
   * delivered rather than from what the provider billed — no `tokenUsage`, a
   * count that was not a non-negative integer, an all-zero or unreported usage,
   * a throw, bytes from a replayed generation, or a cost that priced out
   * non-finite. Counted over the widest configured budget window, or an hour
   * when none is configured.
   */
  getUnpricedCallCount(): number;
};
