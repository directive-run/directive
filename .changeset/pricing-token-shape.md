---
"@directive-run/ai": minor
"@directive-run/core": minor
---

**Cost enforcement: adapter pricing tables now work with every cost surface, and the surfaces no longer fail open.**

The short version: if you use `withBudget` or `createConstraintRouter`, your recorded spend was probably too low &ndash; sometimes zero &ndash; and your caps may never have tripped. Upgrade, then re-read the four action items at the bottom.

### Pricing tables and the budget speak the same language

Each adapter published rates as `{ input, output }`, sized for `estimateCost`; the budget surfaces are typed against `TokenPricing`, which spells the same numbers `{ inputPerMillion, outputPerMillion }`. Handing a table to a budget left both rates `undefined`: every cost was `NaN`, every `estimated > remaining` check was `false`, and the budget never tripped. Every `*_PRICING` entry now carries both field pairs, derived from one source so they cannot drift:

```typescript
import { estimateCost, withBudget } from "@directive-run/ai";
import { ANTHROPIC_PRICING } from "@directive-run/ai/anthropic";

const pricing = ANTHROPIC_PRICING["claude-opus-5"];

const cost = estimateCost(inputTokens, pricing.input);
const guarded = withBudget(runner, {
  pricing,
  budgets: [{ window: "day", maxCost: 10, pricing }],
});
```

`ANTHROPIC_TOKEN_PRICING`, `OPENAI_TOKEN_PRICING`, `GEMINI_TOKEN_PRICING`, and `OLLAMA_TOKEN_PRICING` remain as aliases for the same tables. `ModelPricing` describes the widened entry; `toTokenPricingTable` is exported so you can widen your own the same way. `TokenPricing`, `ModelPricing`, `BareTokenRates`, and `toTokenPricingTable` moved into the pricing module and are re-exported from `budget.ts`, so existing imports keep working.

### One place decides what an unpriceable call costs

`withBudget` charged the pre-call estimate for a call it could not price; `createConstraintRouter`, given the same helper, charged `0`. A runner that never populates `tokenUsage` therefore held `facts.totalCost` at exactly zero for the router's whole life, and a documented `facts.totalCost > 10` failover never fired &ndash; no cost, no counter, no warning. The pricing module now owns that decision instead of handing each caller a `null` to interpret, and returns a dollar figure together with how it was priced. Five conditions charge the estimate, count against `getUnpricedCallCount()`, and warn once:

- No `tokenUsage` at all.
- A non-finite or negative count. One `NaN` in a running total is permanent.
- **New:** a report of zero input, output, *and* cache tokens. A call that ran had a prompt, and a prompt has tokens &ndash; all-zero is a gateway that dropped the usage block, not a free call. A genuinely free local model is unaffected: its rates are zero, so the estimate is zero.
- **New:** a runner that threw. A throw is not a refund &ndash; a structured-output parse failure, a blocking guardrail, or post-stream validation all reject a completion the provider already generated and billed. Under `withRetry` every attempt burned money no ledger ever saw.
- Counts that price out to a non-finite cost.

`createConstraintRouter` gains `getUnpricedCallCount()` and the same once-per-condition warning.

### Untrusted input is read once, at the boundary

Rates were already snapshotted at construction, so a getter or a post-construction `pricing.inputPerMillion = NaN` no longer reaches the cost math. Token counts now get the same treatment. `withBudget` prices one call against every window ledger and once more for the lifetime total, so it priced the call N+1 times; each of those read `result.tokenUsage` itself, and a usage backed by getters answered each one differently &ndash; one recorded run read `$0` against a one-dollar hourly cap while the lifetime total read `$1800`, every result labelled metered, the unpriced counter at zero, not one warning. `result.tokenUsage` is now read exactly once per call into a value threaded everywhere, and `priceCall` will not accept a raw `tokenUsage`, so a second read site is a type error. Same change in `createConstraintRouter`.

Every read of a caller-supplied object in the cost path is also gated on `Object.hasOwn` through a single helper. Ungated, a polluted `Object.prototype` reached every object that omits an optional field &ndash; for cache rates and cache counts, most of them. `cacheRead = 0` made cache tokens free through the documented JSON-table path; `cacheWrite = -1` made every table construction throw; `cacheWriteTokens = NaN` downgraded every metered call to the estimate; `cacheReadTokens = 1e15` inflated every bill into a false `BudgetExceeded`.

### Cached tokens are billed, under one name

`TokenPricing` gains optional `cacheReadPerMillion` and `cacheWritePerMillion`. On providers that report cache usage, `inputTokens` is the *uncached remainder* and the cache counts are additive, so pricing only input and output billed a heavily cached call at close to zero. All four classes are now priced in both surfaces; absent cache rates default to the input rate, which is conservative and never free. The published `cacheWritePerMillion` values assume the **5-minute** cache TTL &ndash; a 1-hour cache writes at 2.0x input rather than 1.25x, so pass your own rate if you use it.

The count has one canonical name, `cacheWriteTokens`, matching the rate that prices it; `cacheCreationTokens` is a documented alias, and adapters populate that one. Supply either. Both resolve in a single function, `normalizeTokenUsage` in `@directive-run/core`, that every consumer of token usage now routes through &ndash; including `createAgentMetrics().trackRun`, which read only `cacheWriteTokens` while every shipped adapter emitted the other, so adapter usage passed straight through reported no cache writes and a total of 150 rather than 10,000,150. `trackRun` also drops non-finite and negative counts, since a counter is cumulative and one bad addend is permanent.

### Budgets, caps, and reporting

- **Budgets on one window must agree on rates.** They share one ledger, so it records at one set of rates while the other budget's cap gates against a total never computed at its rates. One call cannot cost two amounts: `[{hour, $1M cap, $0.001/M}, {hour, $100 cap, $15/$75}]` recorded fifty calls costing $4,500 as ten cents, and neither cap tripped. That configuration now throws at construction &ndash; **this may reject a config that previously built.**
- **A call is recorded once per window, not once per budget.** Two budgets on `"hour"` double-charged: ten $3 calls read as $60, and a pair of $100 hourly caps blocked after $51 of real spend.
- **`maxCostPerCall` is enforced after the call as well as before.** A call estimated at a cent that billed five dollars passed the gate and was absorbed in silence. The money is already spent, so this reports rather than throws, distinguished by a new `phase: "pre-call" | "post-call"` on `BudgetExceededDetails`.
- **Window overruns are reported too**, not only per-call ones. A call that estimated under its remaining hour and billed over it landed in the ledger unremarked, and the *next* call got blocked.
- **`BudgetExceededDetails.estimated` always holds the pre-call estimate.** The billed figure moved to a new `actual` field, present on `phase: "post-call"`. It previously carried the actual cost in that phase, so a handler logging it printed one thing under a name meaning another.
- **The `onBudgetExceeded` payload is frozen** before the callback sees it, and the thrown error is built from the untouched original. A callback could previously rewrite the fields of the error about to be thrown; assigning a non-number surfaced a `TypeError` in place of `BudgetExceededError`, which callers read as transient and retried.
- **`getSpent("total")`** reports lifetime spend, previously unobservable with no windows configured.
- **`budgets[].window` is validated.** Any string was accepted; `"hourly"` produced a window whose spend always read zero, so the cap could never trip.
- **Every caller-supplied budget value is read exactly once**, `maxCost` and `window` included.
- **The pre-call estimate reads the cache rates**, charging input tokens at the highest of input, cache-read, and cache-write &ndash; before the call there is no way to know how the provider will split them, and an estimate under the eventual bill is a cap that does not gate. It still reads only the input string, so it remains a floor, not a prediction.
- **The inert-cap warning tests what the estimate can produce**, not whether every rate is zero. `{input: 0, output: 0, cacheRead: 5}` is not all-zero, yet its estimate was zero and the cap never blocked anything.
- **`createConstraintRouter` gets `withBudget`'s protections.** Provider pricing was read live and unvalidated on every call: a negative rate won `preferCheapest` every time and drove the cost fact negative.
- **Pricing tables are frozen, null-prototype containers**, so a `__proto__` key from parsed JSON cannot reroute one and an entry cannot be swapped for an all-zero one that leaves a cap inert.

### Anthropic pricing table

Rows for the current generation &ndash; Fable 5, Mythos 5, Opus 5, Opus 4.8/4.7/4.6, Sonnet 5, Sonnet 4.6, Haiku 4.5 &ndash; plus undated aliases alongside the dated keys for models that have both. Without them, a caller on any current model got no pricing at all and could not use `withBudget` windows. Sonnet 5 is priced at **list**, not its introductory promotion: a promotion expires, and a spend guard that reads low is a spend guard that does not gate.

Two malformed keys are corrected: `claude-haiku-4-5-20250514` was never a model ID (it is `claude-haiku-4-5-20251001`) and its rates were $0.80/$4.00 rather than $1/$5, so the derived cache rates were wrong throughout; `claude-haiku-4-5-20241022` should be `claude-3-5-haiku-20241022`. Either way the caller passing the real ID got nothing. New `requireModelPricing(TABLE, model)` fails at the lookup naming the model, the table, and its known models, instead of returning `undefined` that surfaces much later as a complaint about a missing rate.

### Action items

1. **Re-read your spend numbers.** Anything recorded before this release may be far too low. `getSpent()` and `facts.totalCost` are now correct; historical figures are not.
2. **Check `getUnpricedCallCount()`.** Non-zero means that many calls were priced by estimate. A count tracking your call count means your runner never reports usable usage and every figure is an estimate.
3. **Two budgets on one window?** Give them the same pricing, or construction now throws.
4. **`@directive-run/ai` now requires `@directive-run/core` >= 1.25.0** as a peer, for the shared token-usage normalizer.
