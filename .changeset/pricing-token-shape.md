---
"@directive-run/ai": minor
"@directive-run/core": minor
---

**Cost enforcement: adapter pricing tables now work with every cost surface, and the surfaces no longer fail open.**

The short version: if you use `withBudget` or `createConstraintRouter`, your recorded spend was probably too low &ndash; sometimes zero &ndash; and your caps may never have tripped. Upgrade, then re-read the action items at the bottom.

### Pricing tables and the budget speak the same language

Each adapter published rates as `{ input, output }`, sized for `estimateCost`; the budget surfaces are typed against `TokenPricing`, which spells the same numbers `{ inputPerMillion, outputPerMillion }`. Handing a table to a budget left both rates `undefined`: every cost was `NaN`, every `estimated > remaining` check was `false`, and the budget never tripped. Every `*_PRICING` entry now carries both field pairs, derived from one source so they cannot drift:

```typescript
import { estimateCost, requireModelPricing, withBudget } from "@directive-run/ai";
import { ANTHROPIC_PRICING } from "@directive-run/ai/anthropic";

// The tables are `Record<string, ModelPricing>`, so a bare index gives you
// `ModelPricing | undefined` under `noUncheckedIndexedAccess` — and an
// unrecognised model reads as "no rates" much later, where it looks like a
// missing-rate complaint rather than a typo. `requireModelPricing` throws at
// the lookup, naming the model and the table's known models.
const pricing = requireModelPricing(ANTHROPIC_PRICING, "claude-opus-5");

const cost = estimateCost(inputTokens, pricing.input);
const guarded = withBudget(runner, {
  pricing,
  budgets: [{ window: "day", maxCost: 10, pricing }],
});
```

`ANTHROPIC_TOKEN_PRICING`, `OPENAI_TOKEN_PRICING`, `GEMINI_TOKEN_PRICING`, and `OLLAMA_TOKEN_PRICING` remain as aliases for the same tables. `ModelPricing` describes the widened entry; `toTokenPricingTable` is exported so you can widen your own the same way. `TokenPricing`, `ModelPricing`, `BareTokenRates`, and `toTokenPricingTable` moved into the pricing module and are re-exported from `budget.ts`, so existing imports keep working.

### One place decides what an unpriceable call costs

`withBudget` charged the pre-call estimate for a call it could not price; `createConstraintRouter`, given the same helper, charged `0`. A runner that never populates `tokenUsage` therefore held `facts.totalCost` at exactly zero for the router's whole life, and a documented `facts.totalCost > 10` failover never fired &ndash; no cost, no counter, no warning. The pricing module now owns that decision instead of handing each caller a `null` to interpret, and returns a dollar figure together with how it was priced. Six conditions charge from what the call delivered rather than from what the provider billed, count against `getUnpricedCallCount()`, and warn once:

- No `tokenUsage` at all.
- A count that is not a non-negative integer. A token is a discrete thing, so a real report is a whole number: one `NaN` in a running total is permanent, and a fractional or subnormal count fails quietly instead &ndash; `5e-324` is finite, positive, and not zero, so it priced out to nothing while also slipping past the all-zero check below. A count supplied as a string is refused rather than read as absent; previously a `cacheReadTokens` of `"10000000"` billed as zero while the same string in `inputTokens` was correctly refused.
- **New:** a report of zero input, output, *and* cache tokens. A call that ran had a prompt, and a prompt has tokens &ndash; all-zero is a gateway that dropped the usage block, not a free call. A genuinely free local model is unaffected: its rates are zero, so the estimate is zero.
- **New:** a runner that threw. A throw is not a refund &ndash; a structured-output parse failure, a blocking guardrail, or post-stream validation all reject a completion the provider already generated and billed. Under `withRetry` every attempt burned money no ledger ever saw.
- **New:** text delivered for a generation the surviving result does not describe &ndash; a retry, a fallback, or a schema re-ask replayed over. The provider billed for it; the usage on the result that survived describes only itself.
- Counts that price out to a non-finite cost.

`createConstraintRouter` gains `getUnpricedCallCount()` and the same once-per-condition warning.

**Charging for a throw, without pretending it is the same as spend.** A cap that fills with money that was never spent is no better than one that misses money that was &ndash; five refused connections consumed $9 of a $10 hourly cap in testing, indistinguishable from real spend. Three changes:

- A `BudgetExceededError` or `UnpricedCallLimitError` from a nested `withBudget` is charged **nothing**. That guard raises both from its own pre-call checks, before it invokes the runner it wraps, so the provider was provably never contacted. Chained guards no longer bill each other for calls none of them made.
- Every other throw is charged **what it delivered**, measured off the deltas that reached the caller's `onToken` before it failed &ndash; which for a gateway that strips the completion marker is the whole response the provider generated and billed. A throw that delivered nothing is charged nothing; there is no observation to price, and a DNS failure should not consume an hour of a budget.
- What *is* charged for a throw is reported separately by a new **`getFailedCallSpend(window)`** on `BudgetRunner`, alongside `getSpent`. `getSpent(w) - getFailedCallSpend(w)` is spend attributable to calls that returned; a figure approaching `getSpent` means a cap is being consumed by calls that break part-way through rather than by work.

`createConstraintRouter` gets the nested-refusal exemption and the separate figure, for the same reason it gets everything else here: a `facts.totalCost` that moves on a call the provider never saw makes a `facts.totalCost > N` failover fire on spend that never happened. It sees no deltas of its own, so it still charges the estimate for a throw that reached it; its accessor is `getFailedCallSpend()` &ndash; no window argument, since the router keeps a lifetime total. A blocked call still counts toward `facts.errorCount`, because the routing constraints should see that it failed.

### Untrusted input is read once, at the boundary

Rates were already snapshotted at construction, so a getter or a post-construction `pricing.inputPerMillion = NaN` no longer reaches the cost math. Token counts now get the same treatment. `withBudget` prices one call against every window ledger and once more for the lifetime total, so it priced the call N+1 times; each of those read `result.tokenUsage` itself, and a usage backed by getters answered each one differently &ndash; one recorded run read `$0` against a one-dollar hourly cap while the lifetime total read `$1800`, every result labelled metered, the unpriced counter at zero, not one warning. `result.tokenUsage` is now read exactly once per call into a value threaded everywhere, and `priceCall` will not accept a raw `tokenUsage`, so a second read site is a type error. Same change in `createConstraintRouter`.

Every read of a caller-supplied object in the cost path is also gated on `Object.hasOwn` through a single helper. Ungated, a polluted `Object.prototype` reached every object that omits an optional field &ndash; for cache rates and cache counts, most of them. `cacheRead = 0` made cache tokens free through the documented JSON-table path; `cacheWrite = -1` made every table construction throw; `cacheWriteTokens = NaN` downgraded every metered call to the estimate; `cacheReadTokens = 1e15` inflated every bill into a false `BudgetExceeded`; `cost = 1e308` summed into `createAgentMetrics`' cost counter on a call that supplied no cost.

### Cached tokens are billed, under one name

`TokenPricing` gains optional `cacheReadPerMillion` and `cacheWritePerMillion`. On providers that report cache usage, `inputTokens` is the *uncached remainder* and the cache counts are additive, so pricing only input and output billed a heavily cached call at close to zero.

**Expect your recorded spend to rise, and by a lot on cached workloads.** The rates did not change and neither did your provider bill; what changed is how much of that bill the ledger sees. A long-context agent turn on Sonnet 4.5 — a 200k prompt served mostly from cache, 2k uncached input, 190k cache reads, 8k cache writes, 500 output — recorded $0.0135 and now records $0.1005, which is 7.4x for that shape. It scales with how much of your prompt is cached, so a short uncached call barely moves and a long cached one moves most.

If you have a cap sized against the old figures, resize it before upgrading. A budget that sat comfortably under its ceiling can start tripping on the first call, and it will be right to. All four classes are now priced in both surfaces; absent cache rates default to the input rate, which is conservative and never free. The published `cacheWritePerMillion` values assume the **5-minute** cache TTL &ndash; a 1-hour cache writes at 2.0x input rather than 1.25x, so pass your own rate if you use it.

The count has one canonical name, `cacheWriteTokens`, matching the rate that prices it; `cacheCreationTokens` is a documented alias, and adapters populate that one. Supply either. Both resolve in a single function, `normalizeTokenUsage` in `@directive-run/core`, that every consumer of token usage now routes through. Two metrics consumers were reading counts their own way:

- `createAgentMetrics().trackRun` read only `cacheWriteTokens` while every shipped adapter emitted the other, so adapter usage passed straight through reported no cache writes and a total of 150 rather than 10,000,150. It now also drops non-finite and negative counts, and reads `cost` and `toolCalls` through the same own-property gate and the same validation &ndash; a counter is cumulative and one bad addend is permanent.
- The **debug timeline's `agent_complete` event** recorded input and output only, so a run that read ten million tokens from the provider's cache showed as a tiny one &ndash; `inputTokens` is the uncached remainder when a provider reports cache usage. `AgentCompleteEvent` gains optional `cacheReadTokens` and `cacheWriteTokens`, and both orchestrators populate all four classes. A count no ledger would accept is reported as `0` rather than rendering `NaN` into a timeline row.

### Budgets, caps, and reporting

- **Every set of rates on one runner must agree.** Budgets sharing a window share one ledger, so it records at one set of rates while the other budget's cap gates against a total never computed at its rates: `[{hour, $1M cap, $0.001/M}, {hour, $100 cap, $15/$75}]` recorded fifty calls costing $4,500 as ten cents, and neither cap tripped. The top-level `pricing` is held to the same rule, because it prices the same call &ndash; it drives `maxCostPerCall` and `getSpent("total")` while the window rates drive the window ledgers, so `pricing: {0.001/M}` beside `budgets: [{hour, $15/$75}]` reported `getSpent("hour")` of $450 next to a `getSpent("total")` of one cent, with `maxCostPerCall` estimating 15,000x low. Both configurations now throw at construction &ndash; **this may reject a config that previously built.**
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
- **Pricing tables are frozen, null-prototype objects &ndash; the table and every entry in it.** A `__proto__` key from parsed JSON cannot reroute the table, an entry cannot be swapped for an all-zero one that leaves a cap inert, and a missing cache rate reads as missing. That last part needs the *entries*, not just the table: `estimateCost(tokens, rates.cacheRead)` is the documented way to price cache tokens and reads the field directly, so on a plain object literal `Object.prototype.cacheRead = 0` answered for every entry that omits the rate &ndash; which is most of them.

### Anthropic pricing table

The table stopped at Sonnet 4.5 and held five keys. Missing pricing throws, so a caller on anything else had no pricing at all and could not use `withBudget` windows. It now carries the current generation &ndash; Fable 5, Opus 5, Opus 4.8/4.7/4.6, Sonnet 5, Sonnet 4.6, Haiku 4.5 &ndash; and the previous one &ndash; Opus 4.5, Opus 4.1, Opus 4, Sonnet 4.5, Sonnet 4 &ndash; with undated aliases alongside the dated keys for models that have both. Sonnet 5 is priced at **list**, not its introductory promotion: a promotion expires, and a spend guard that reads low is a spend guard that does not gate.

The inclusion rule is now written down beside the rates: every model ID a caller might pass, in every spelling, and rows go in and stay in. A model leaving the API moves its row down rather than deleting it &ndash; reconciling last quarter's invoice needs the rates that quarter was billed at, which is why retired Haiku 3.5 is still listed and why Opus 4.1 is listed despite its retirement date.

Two malformed keys are corrected. `claude-haiku-4-5-20250514` was never a model ID &ndash; it is `claude-haiku-4-5-20251001` &ndash; and it carried $0.80/$4.00 rather than $1/$5, so every rate derived from it was wrong. `claude-haiku-3-5-20241022` should be `claude-3-5-haiku-20241022`. Either way the caller passing the real ID got nothing back. New `requireModelPricing(TABLE, model)` fails at the lookup naming the model, the table, and its known models, instead of returning `undefined` that surfaces much later as a complaint about a missing rate.

### Action items

1. **Re-read your spend numbers.** Anything recorded before this release may be far too low. `getSpent()` and `facts.totalCost` are now correct; historical figures are not.
2. **Check `getUnpricedCallCount()`.** Non-zero means that many recent calls were charged from what they delivered rather than from what the provider billed. It is kept over a rolling window &ndash; the widest budget window configured, or an hour when there is none &ndash; so a count tracking your call rate means your runner never reports usable usage and every figure is a measurement.
3. **Check `getFailedCallSpend()` too.** It is the part of `getSpent()` charged for calls that threw after delivering something. A figure close to `getSpent()` means a cap is filling with calls that break part-way through, not work.
4. **More than one set of rates on a runner?** Two budgets on one window, or a top-level `pricing` beside window budgets, must price a call identically &ndash; otherwise construction now throws.
5. **`@directive-run/ai` now requires `@directive-run/core` >= 1.25.0** as a peer, for the shared token-usage normalizer. `normalizeTokenUsage` is a runtime function imported by name from `@directive-run/core/plugins`, and an older core does not export it — so this is not a misprice you would have to go looking for. The module fails to load:

   ```
   SyntaxError: The requested module '@directive-run/core/plugins' does not
   provide an export named 'normalizeTokenUsage'
   ```

   It surfaces the first time anything imports `@directive-run/ai`, before any of your code runs. If your package manager reports a peer conflict here, resolve it rather than override it — there is no degraded mode on the other side of that warning.
