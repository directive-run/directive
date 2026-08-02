/**
 * Shared cost-pricing primitives for every surface that turns tokens into
 * dollars — `withBudget` and `createConstraintRouter` today, anything that
 * prices a call tomorrow.
 *
 * These live in one module on purpose, and the module owns the *policy*, not
 * just the arithmetic. Handing each caller a `null` and trusting it to decide
 * what an unpriceable call costs is how one surface came to charge the pre-call
 * estimate while the other charged zero: same input, same rates, two answers,
 * and the caller holding the runner cannot tell which one they have. So the
 * only way to price a call is {@link priceCall}, which always returns a dollar
 * amount together with how it arrived at it. There is no shape that means
 * "nothing to bill here" for the caller to drop on the floor.
 *
 * @module
 */

import type { TokenUsage } from "./types.js";

// ============================================================================
// Caller-facing rate shapes
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
   *
   * **One rate, two TTLs.** Providers that offer more than one cache lifetime
   * charge a different write multiplier for each: Anthropic bills a cache write
   * at 1.25x the input rate for the 5-minute cache and 2.0x for the 1-hour
   * cache. This field carries one number, so it cannot express both, and the
   * published adapter tables use the **5-minute** multiplier — the default TTL,
   * and the one the shipped adapters request. Callers using a 1-hour cache
   * should pass their own rate, or their ledger will under-count cache writes
   * by a factor of 1.6.
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
  /**
   * Omit when the provider does not price cache writes separately. When a
   * provider offers more than one cache TTL, this is the rate for the shortest
   * one — see {@link TokenPricing.cacheWritePerMillion}.
   */
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

// ============================================================================
// Validated rates
// ============================================================================

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

/** The bare-rate fields, read only to sharpen the error message. */
const BARE_RATE_FIELDS = ["input", "output"] as const;

/** Render a rate for an error message, keeping `-0` distinguishable from `0`. */
function formatRate(rate: number): string {
  return Object.is(rate, -0) ? "-0" : String(rate);
}

/**
 * Validate a caller-supplied pricing object and snapshot its rates into owned
 * primitives.
 *
 * Three failure modes are closed here.
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
 * Every read is gated on {@link Object.hasOwn}, so an inherited property is not
 * mistaken for a rate the caller supplied. Without that gate a polluted
 * `Object.prototype.cacheReadPerMillion` reaches every pricing object that
 * omits cache rates — which is most of them — and sets cache tokens free at `0`
 * or makes every construction throw at `-1`.
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

  // Read every property this function considers exactly once, up front, and
  // keep the primitive rather than the property. Re-reading is the same
  // check-then-use gap the snapshot exists to close, and the rule holds for the
  // fields that only feed the error message too — an object that reports one
  // shape to the hint and another to the validator is an object describing a
  // bug that is not there.
  const owned = new Map<string, unknown>();
  for (const field of [...RATE_FIELDS, ...BARE_RATE_FIELDS]) {
    if (source !== undefined && Object.hasOwn(source, field)) {
      owned.set(field, source[field]);
    }
  }

  const looksLikeBareRatePair =
    typeof owned.get("input") === "number" &&
    typeof owned.get("output") === "number" &&
    !owned.has("inputPerMillion") &&
    !owned.has("outputPerMillion");

  const snapshot = {
    inputPerMillion: 0,
    outputPerMillion: 0,
    cacheReadPerMillion: 0,
    cacheWritePerMillion: 0,
  };

  for (const field of RATE_FIELDS) {
    const raw = owned.get(field);
    const optional =
      field === "cacheReadPerMillion" || field === "cacheWritePerMillion";

    if (optional && (!owned.has(field) || raw === undefined)) {
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

// ============================================================================
// Estimating a call before it runs
// ============================================================================

/** Approximate characters per input token, when a caller does not say. */
export const DEFAULT_CHARS_PER_TOKEN = 4;

/** Estimated output tokens per input token, when a caller does not say. */
export const DEFAULT_OUTPUT_MULTIPLIER = 1;

/**
 * Estimate a call's input tokens from its input string.
 *
 * This counts the input string and nothing else. A real call also carries the
 * agent's instructions, the conversation history, and any tool definitions, all
 * of which the provider bills and none of which are visible here — so the
 * estimate runs *under* the eventual bill, sometimes by orders of magnitude. It
 * is a floor, useful for gating and for standing in when a provider reports no
 * usage at all; it is not a prediction.
 */
export function estimateInputTokens(
  input: string,
  charsPerToken: number,
): number {
  return Math.ceil(input.length / charsPerToken);
}

/**
 * The rate the pre-call estimate charges input tokens at.
 *
 * The estimate knows roughly how many tokens go in, but not how the provider
 * will split them across uncached input, a cache read, and a cache write — that
 * depends on a caching strategy and a cache state that do not exist yet. It
 * charges the highest of the three. The alternative is an estimate that sits
 * below the eventual bill on every call that touches the cache, and a cap that
 * gates a too-low estimate is a cap that does not gate.
 */
export function estimateInputRate(pricing: ResolvedPricing): number {
  return Math.max(
    pricing.inputPerMillion,
    pricing.cacheReadPerMillion,
    pricing.cacheWritePerMillion,
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
    (inputTokens / 1_000_000) * estimateInputRate(pricing) +
    (estimatedOutputTokens / 1_000_000) * pricing.outputPerMillion
  );
}

/**
 * Whether no call can ever be estimated above zero under these rates, so a cap
 * compared against the estimate can never trip.
 *
 * Written in terms of the rates {@link estimateCallCost} actually reads rather
 * than in terms of every rate the type carries. Those are not the same set: a
 * table that prices input and output at zero but cache reads at $5 is not
 * all-zero, yet the estimate it produces was zero and the cap that gated on it
 * was inert with nothing said. Sharing {@link estimateInputRate} between the
 * two keeps the answer true as the estimate changes.
 */
export function isZeroRated(pricing: ResolvedPricing): boolean {
  return estimateInputRate(pricing) === 0 && pricing.outputPerMillion === 0;
}

// ============================================================================
// Pricing a call after it runs
// ============================================================================

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

/** Why a call was priced by estimate rather than by what the provider reported. */
export type UnpricedReason =
  /** The result carried no `tokenUsage` at all. */
  | "missing-usage"
  /** `tokenUsage` was present but carried a count no ledger can accept. */
  | "unusable-usage"
  /** The counts and rates were both valid, but their product overflowed. */
  | "unusable-cost";

/**
 * What one call costs, and how that number was arrived at.
 *
 * There is deliberately no "unpriceable" variant. Every call has a dollar
 * figure attached; `basis` says whether it came from what the provider reported
 * (`"metered"`) or from the pre-call estimate standing in (`"estimated"`).
 * A caller that only handles the metered case does not compile, which is the
 * point: the bug this shape replaces was a caller reading a `null` and
 * returning `0`, leaving a spend guard that had stopped guarding and a cost
 * fact that never moved.
 */
export type PricedCall =
  | { readonly basis: "metered"; readonly cost: number }
  | {
      readonly basis: "estimated";
      readonly cost: number;
      readonly reason: UnpricedReason;
    };

/**
 * The one-line explanation for a call priced by estimate, shared so that every
 * surface says the same thing about the same condition — a warning that reads
 * differently on two runners wrapping the same provider is a warning that gets
 * treated as two different problems.
 */
export function describeUnpricedReason(reason: UnpricedReason): string {
  switch (reason) {
    case "missing-usage":
      return "the runner returned no result.tokenUsage, so there is nothing to price the call from";
    case "unusable-usage":
      return "result.tokenUsage carried a non-finite or negative token count, and recording it would permanently corrupt the running total";
    case "unusable-cost":
      return "the reported token counts priced out to a non-finite cost, which is unrecoverable once recorded";
  }
}

function isUsableCount(count: unknown): count is number {
  return typeof count === "number" && Number.isFinite(count) && count >= 0;
}

/**
 * Resolve the cache-write count from either spelling the ecosystem uses.
 *
 * `TokenUsage` named the field `cacheCreationTokens`, after Anthropic's wire
 * format; the rate that prices it is `cacheWritePerMillion`, and the resolved
 * count is `cacheWriteTokens`. A runner that followed the rate's spelling
 * reported a field nothing read, so ten million cache-write tokens billed as
 * zero, passed validation because input and output were present, and warned
 * nothing. Both spellings are accepted now, and when both are present the
 * larger wins — under-billing is the failure mode worth avoiding.
 *
 * Returns `null` when either present value is unusable.
 */
function resolveCacheWriteTokens(usage: TokenUsage): number | null {
  const creationTokens = usage.cacheCreationTokens;
  const writeTokens = usage.cacheWriteTokens;
  let resolved = 0;

  if (creationTokens !== undefined) {
    if (!isUsableCount(creationTokens)) {
      return null;
    }
    resolved = creationTokens;
  }

  if (writeTokens !== undefined) {
    if (!isUsableCount(writeTokens)) {
      return null;
    }
    resolved = Math.max(resolved, writeTokens);
  }

  return resolved;
}

/**
 * Read a provider-reported token usage exactly once and validate it, returning
 * `null` when it cannot be priced.
 *
 * Deliberately module-private: {@link priceCall} is the only way to turn a
 * usage into money, because a `null` handed to a caller is a decision handed to
 * a caller, and the two callers that had it made it differently.
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
function snapshotTokenUsage(
  usage: TokenUsage | undefined,
): ResolvedUsage | null {
  if (!usage) {
    return null;
  }

  const inputTokens = usage.inputTokens;
  const outputTokens = usage.outputTokens;
  const cacheReadTokens = usage.cacheReadTokens ?? 0;
  const cacheWriteTokens = resolveCacheWriteTokens(usage);

  if (
    !isUsableCount(inputTokens) ||
    !isUsableCount(outputTokens) ||
    !isUsableCount(cacheReadTokens) ||
    cacheWriteTokens === null
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
 * astronomically large token counts, which is why {@link priceCall} checks it.
 */
function calculateUsageCost(
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

/** Keep an estimate that is itself unusable from becoming the billed figure. */
function usableEstimate(estimate: number): number {
  return Number.isFinite(estimate) && estimate >= 0 ? estimate : 0;
}

/**
 * Price one call: what it cost, and on what basis.
 *
 * This is the whole unusable-usage policy, in one place, for every surface that
 * bills. When the provider reports counts a ledger can accept, the call is
 * priced from them. When it does not — no `tokenUsage` at all, a poisoned
 * count, or a product that overflows — the pre-call estimate stands in and the
 * result says so. The estimate is a poor number. It is a far better one than
 * zero, which reads as "this call was free" and leaves a configured cap that
 * can never trip and a cost fact that never moves.
 *
 * @param usage - The provider-reported usage, exactly as it arrived.
 * @param pricing - Validated rates from {@link snapshotTokenPricing}.
 * @param estimate - The pre-call estimate to charge when usage cannot price the call.
 */
export function priceCall(
  usage: TokenUsage | undefined,
  pricing: ResolvedPricing,
  estimate: number,
): PricedCall {
  const resolved = snapshotTokenUsage(usage);

  if (resolved === null) {
    return {
      basis: "estimated",
      cost: usableEstimate(estimate),
      reason: usage ? "unusable-usage" : "missing-usage",
    };
  }

  const cost = calculateUsageCost(resolved, pricing);

  if (!Number.isFinite(cost)) {
    return {
      basis: "estimated",
      cost: usableEstimate(estimate),
      reason: "unusable-cost",
    };
  }

  return { basis: "metered", cost };
}
