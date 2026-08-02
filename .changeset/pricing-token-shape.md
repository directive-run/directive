---
"@directive-run/ai": minor
---

**Adapter pricing tables now work with every cost surface, and `withBudget` no longer fails open on a bad rate or a bad token count.**

Each adapter published its rates in one shape only &ndash; `{ input, output }`, sized for `estimateCost`, which takes a bare per-million rate. `withBudget` and `createConstraintRouter` are typed against `TokenPricing`, which spells the same two numbers `{ inputPerMillion, outputPerMillion }`. Handing a pricing table to a budget therefore left both rates `undefined`: every computed cost became `NaN`, every `estimated > remaining` check evaluated to `false`, and the budget never tripped. Spend was unbounded precisely when the caller believed it was capped, with nothing in the logs to say so.

**Every `*_PRICING` entry now carries both field pairs.** Rather than publish a second constant and leave "which one do I want" as a permanent trap, each entry is widened to `{ input, output, inputPerMillion, outputPerMillion }`, all four derived from one source of numbers so they cannot drift. Whichever constant you reach for works with whichever function you call:

```typescript
import { estimateCost, withBudget } from "@directive-run/ai";
import { ANTHROPIC_PRICING } from "@directive-run/ai/anthropic";

const pricing = ANTHROPIC_PRICING["claude-sonnet-4-5-20250929"];

const cost = estimateCost(inputTokens, pricing.input);
const guarded = withBudget(runner, {
  pricing,
  budgets: [{ window: "day", maxCost: 10, pricing }],
});
```

`ANTHROPIC_TOKEN_PRICING`, `OPENAI_TOKEN_PRICING`, `GEMINI_TOKEN_PRICING`, and `OLLAMA_TOKEN_PRICING` are exported as aliases for the same tables, so code that already names them keeps working. The new `ModelPricing` type describes the widened entry, and `toTokenPricingTable` is exported so you can widen your own rate table the same way.

**Pricing validation is stricter, and now sticks.** `withBudget` validates every pricing object it is given &ndash; the top-level one and each budget window's &ndash; and rejects a rate that is missing, non-finite, or negative. A negative rate was previously accepted: costs came out negative, the budget could never trip, and each call *lowered* the recorded spend, so the ledger walked backwards forever. Zero is still accepted, since local models genuinely bill nothing.

Validated rates are also snapshotted into owned primitives at construction. The hot path used to re-read the caller's object on every call, so a getter, a `Proxy`, or a plain `pricing.inputPerMillion = NaN` after `withBudget` returned reopened the exact hole the validation closes.

**Provider-reported token counts are validated before they reach the ledger.** `result.tokenUsage` crosses a trust boundary, and a single `NaN`, `Infinity`, or negative count added to a running total is permanent &ndash; every later `getSpent()` inherits it and no subsequent call washes it out. Unusable counts are now skipped with a one-time warning instead of poisoning the ledger.

**`getSpent("total")`** reports lifetime spend for the runner. Spend was previously unobservable when no budget windows were configured, since `getSpent` only read the per-window ledgers.

**`maxCostPerCall` is now enforced after the call, not just before it.** It gated the pre-call estimate only, so a call estimated at a cent that actually billed five dollars passed the gate and was absorbed in silence. The real cost is now recorded, and `onBudgetExceeded` fires when it exceeds the cap. The call cannot be blocked at that point &ndash; the money is spent &ndash; so this is a report rather than a throw, distinguished by a new `phase: "pre-call" | "post-call"` field on `BudgetExceededDetails`.

**Cached tokens are billed.** `TokenPricing` gains optional `cacheReadPerMillion` and `cacheWritePerMillion`. On providers that report cache usage, `inputTokens` is the *uncached remainder* and the cache counts are additive, so pricing only input and output billed a heavily cached call at close to zero while the provider billed it in full &ndash; and cache *writes* cost more than ordinary input, roughly 1.25x, not nothing. All four token classes are now priced, in the budget ledger and in `createConstraintRouter` alike. When the cache rates are absent they default to the input rate: conservative, and never free. The Anthropic table carries its published ratios.

**Budget windows are validated.** `budgets[].window` accepted any string. An unrecognized value &ndash; from a JSON config, or a typo like `"hourly"` &ndash; produced an undefined duration, a `NaN` cutoff, and a window whose spend always read as zero, so the cap could never trip. Unrecognized windows now throw at construction and name the valid values.

**Every caller-supplied budget value is read exactly once.** The snapshotting applied to pricing now covers `maxCost` and `window` too. A getter that returned a valid number during validation and `NaN` afterwards previously stored the second value, leaving `remaining` permanently `NaN`.

**`createConstraintRouter` gets the same protections as `withBudget`.** Provider pricing was read live from the caller's object on every call, unvalidated. A negative rate won `preferCheapest` on every call and drove the cost fact negative; an unusable token count poisoned it permanently, so a cost-threshold failover constraint would never fire again. Providers are now flattened into owned records at construction and their pricing validated and snapshotted through the same helper.

**Calls with no usable token usage are charged the pre-call estimate** rather than nothing, and counted. A runner that does not populate `tokenUsage` previously left every window ledger at zero, silently disabling budgets that looked configured. The new `getUnpricedCallCount()` on `BudgetRunner` reports how many calls were priced by estimate.

**`BudgetExceededDetails.estimated` always holds the pre-call estimate.** The billed figure moved to a new `actual` field, present on `phase: "post-call"`. Previously `estimated` carried the actual cost in that phase, so a handler logging it printed one thing under a name meaning another.

**The `onBudgetExceeded` payload is frozen** before it reaches the callback, and the thrown `BudgetExceededError` is built from the untouched original. A callback could previously rewrite the fields of the error about to be thrown, and assigning a non-number could make a `TypeError` surface in place of `BudgetExceededError` &ndash; which callers would read as transient and retry.

**Pricing tables are frozen containers**, built with a null prototype so a `__proto__` key from parsed JSON cannot reroute the table. Entry substitution previously allowed an all-zero table to pass validation and leave a configured cap inert; that combination now warns once and names the caps it disables.
