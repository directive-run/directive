/**
 * Shared cost-pricing primitives for every surface that turns tokens into
 * dollars — `withBudget` and `createConstraintRouter` today, anything that
 * prices a call tomorrow.
 *
 * These live in one module on purpose. Each of them closes a fail-open path,
 * and a fail-open path closed in one caller and left open in the next is worth
 * very little: a spend guard that stops guarding is worse than no guard, and
 * the caller cannot tell the difference from the outside.
 *
 * @module
 */

import type { TokenPricing } from "./budget.js";
import type { TokenUsage } from "./types.js";

/**
 * A pricing object that has been validated and copied — all four rates
 * resolved to owned, finite, non-negative numbers.
 *
 * Every cost computation reads one of these, never a caller-supplied object.
 */
export interface ResolvedPricing {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  readonly cacheReadPerMillion: number;
  readonly cacheWritePerMillion: number;
}

/** The rate fields read off a caller-supplied pricing object, in read order. */
const RATE_FIELDS = [
  "inputPerMillion",
  "outputPerMillion",
  "cacheReadPerMillion",
  "cacheWritePerMillion",
] as const;

/** Render a rate for an error message, keeping `-0` distinguishable from `0`. */
function formatRate(rate: number): string {
  return Object.is(rate, -0) ? "-0" : String(rate);
}

/**
 * A provider-reported token usage that has been read once and validated —
 * all four token counts resolved to owned, finite, non-negative numbers.
 */
export interface ResolvedUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

function isUsableCount(count: unknown): count is number {
  return typeof count === "number" && Number.isFinite(count) && count >= 0;
}

/**
 * Read a provider-reported token usage exactly once and validate it, returning
 * `null` when it cannot be priced.
 *
 * `tokenUsage` crosses a trust boundary: it is whatever the provider (or a
 * wrapping runner, or a test double) put on the result. A single `NaN`,
 * `Infinity`, or negative count added to a running total is not a bad data
 * point, it is a permanent one — every later reading inherits it and no
 * subsequent call can bring the total back.
 *
 * All four token classes are checked, not just input and output: a
 * present-but-poisoned cache count is exactly as destructive as a poisoned
 * input count. The counts are copied rather than re-read for the same reason
 * pricing is snapshotted — validating an object the provider still owns and
 * then reading it again later is a check-then-use gap.
 */
export function snapshotTokenUsage(
  usage: TokenUsage | undefined,
): ResolvedUsage | null {
  if (!usage) {
    return null;
  }

  const inputTokens = usage.inputTokens;
  const outputTokens = usage.outputTokens;
  const cacheReadTokens = usage.cacheReadTokens ?? 0;
  const cacheWriteTokens = usage.cacheCreationTokens ?? 0;

  if (
    !isUsableCount(inputTokens) ||
    !isUsableCount(outputTokens) ||
    !isUsableCount(cacheReadTokens) ||
    !isUsableCount(cacheWriteTokens)
  ) {
    return null;
  }

  return Object.freeze({
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  });
}

/**
 * Price a validated token usage against resolved rates.
 *
 * All four token classes are billed. `inputTokens` is the *uncached* remainder
 * on providers that report cache usage, and the cache counts are additive, so
 * pricing only input and output bills a heavily cached call at close to zero
 * while the provider bills it in full.
 *
 * The result can still be non-finite when astronomically large rates meet
 * astronomically large token counts. That is the caller's to handle: recording
 * a non-finite cost in a ledger is unrecoverable, since every later comparison
 * against the total is then meaningless.
 */
export function calculateUsageCost(
  usage: ResolvedUsage,
  pricing: ResolvedPricing,
): number {
  return (
    (usage.inputTokens / 1_000_000) * pricing.inputPerMillion +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMillion +
    (usage.cacheReadTokens / 1_000_000) * pricing.cacheReadPerMillion +
    (usage.cacheWriteTokens / 1_000_000) * pricing.cacheWritePerMillion
  );
}

/** Estimate a call's cost before it runs, from an input-token estimate. */
export function estimateCallCost(
  inputTokens: number,
  pricing: ResolvedPricing,
  outputMultiplier: number,
): number {
  const estimatedOutputTokens = Math.ceil(inputTokens * outputMultiplier);

  return (
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (estimatedOutputTokens / 1_000_000) * pricing.outputPerMillion
  );
}

/** Whether every rate is zero, so no number of tokens can ever cost anything. */
export function isZeroRated(pricing: ResolvedPricing): boolean {
  return (
    pricing.inputPerMillion === 0 &&
    pricing.outputPerMillion === 0 &&
    pricing.cacheReadPerMillion === 0 &&
    pricing.cacheWritePerMillion === 0
  );
}

/**
 * Validate a caller-supplied pricing object and snapshot its rates into owned
 * primitives.
 *
 * Two failure modes are closed here, and the snapshot is what closes the
 * second one.
 *
 * A rate that is missing or non-finite makes every cost `NaN`, every
 * `estimated > remaining` comparison `false`, and the budget never trips. A
 * rate that is negative is worse: costs come out negative, the comparison is
 * still never true, and each call *lowers* the recorded spend, so the ledger
 * walks backwards forever. Either way the guard fails open — spend unbounded
 * precisely when the caller believed it was capped. Zero is allowed and
 * meaningful: local models genuinely bill nothing.
 *
 * The returned object is a frozen copy, read once, at construction. Validating
 * the caller's live object and then re-reading it on every call would be a
 * check-then-use gap: a getter, a Proxy, or a plain `pricing.inputPerMillion =
 * NaN` after construction would reopen the exact hole the validation exists to
 * close. Nothing downstream touches the caller's object again.
 *
 * @param pricing - The caller-supplied pricing object.
 * @param label - Where this pricing came from, for the error message (e.g. `"budgets[day].pricing"`).
 * @param api - The public function being called, for the error message.
 */
export function snapshotTokenPricing(
  pricing: TokenPricing | undefined,
  label: string,
  api: string,
): ResolvedPricing {
  const source = pricing as unknown as Record<string, unknown> | undefined;
  const looksLikeBareRatePair =
    typeof source?.input === "number" &&
    typeof source?.output === "number" &&
    typeof source?.inputPerMillion !== "number" &&
    typeof source?.outputPerMillion !== "number";

  const snapshot = {
    inputPerMillion: 0,
    outputPerMillion: 0,
    cacheReadPerMillion: 0,
    cacheWritePerMillion: 0,
  };

  for (const field of RATE_FIELDS) {
    // Read exactly once, and keep the primitive rather than the property.
    const raw = source?.[field];
    const optional =
      field === "cacheReadPerMillion" || field === "cacheWritePerMillion";

    if (optional && raw === undefined) {
      // Cache tokens are billed at the input rate unless the caller says
      // otherwise. Never free: a cache write bills more than plain input on
      // every provider that offers one, so a zero default would under-count
      // the ledger by the whole cached prefix.
      snapshot[field] = snapshot.inputPerMillion;
      continue;
    }

    const rate = typeof raw === "number" ? raw : Number.NaN;

    if (!Number.isFinite(rate)) {
      const hint = looksLikeBareRatePair
        ? " Received { input, output } — a bare per-million rate pair. Every adapter *_PRICING export (e.g. ANTHROPIC_PRICING) already carries inputPerMillion / outputPerMillion alongside those; if this object is hand-built, add both fields."
        : "";

      throw new Error(
        `[Directive] ${api}: ${label}.${field} must be a finite number.${hint}`,
      );
    }

    if (rate < 0) {
      throw new Error(
        `[Directive] ${api}: ${label}.${field} must not be negative (received ${formatRate(rate)}). A negative rate makes every computed cost negative, so no budget can ever trip and the ledger runs backwards.`,
      );
    }

    if (Object.is(rate, -0)) {
      throw new Error(
        `[Directive] ${api}: ${label}.${field} must not be -0 (signed zero). It compares equal to 0 but carries a negative sign through the cost math, so products come out as -0 and sums can land on the wrong side of a comparison. Use plain 0, which is accepted and is the correct rate for local models that bill nothing.`,
      );
    }

    snapshot[field] = rate;
  }

  return Object.freeze(snapshot);
}
