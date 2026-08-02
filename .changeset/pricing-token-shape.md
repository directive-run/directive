---
"@directive-run/ai": minor
"@directive-run/core": minor
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

**One place decides what an unpriceable call costs.** `withBudget` charged the pre-call estimate for a call the provider reported no usable usage for; `createConstraintRouter`, handed the same shared helper and the same `null`, charged `0`. A runner that never populates `tokenUsage` therefore held `facts.totalCost` at exactly zero for the router's whole life, and a documented `facts.totalCost > 10` failover constraint never fired once &ndash; no cost, no counter, no warning. The shared pricing module now owns the policy instead of handing each caller a `null` to interpret: it returns a dollar figure together with how it was priced (metered from reported usage, or estimated), and there is no shape meaning "nothing to bill" for a caller to drop. `createConstraintRouter` gains `getUnpricedCallCount()` and the same once-per-condition warning `withBudget` has, because a guard present on one surface and absent on the next is not half a guard.

**Two budgets on the same window no longer double-charge.** Budgets sharing a `window` share one ledger by design, but each budget recorded the call into it, so ten $3 calls read as $60 and a pair of `{ window: "hour", maxCost: 100 }` budgets began blocking after $51 of real spend. The call is now recorded once per window, at the first budget's rates for that window; each budget's own rates still gate its own pre-call estimate. `getSpent`, which is documented for dashboards, no longer reports double.

**A cache-write count is read under either spelling.** The count was `tokenUsage.cacheCreationTokens`; the rate that prices it is `cacheWritePerMillion`. A runner that followed the rate's spelling reported a field nothing read, so ten million cache-write tokens billed as $0 &ndash; past validation, because input and output were present, and past the counter, because nothing looked wrong. `TokenUsage` now accepts `cacheWriteTokens` as an alias, both are validated, and the larger is billed when both are present.

**A rate inherited from `Object.prototype` is no longer treated as a rate the caller supplied.** Pricing fields were read without an own-property check, and the optional-cache fallback only triggered on `undefined`. A polluted `Object.prototype.cacheReadPerMillion` therefore reached every pricing object that omits cache rates &ndash; which is the openai, gemini, and ollama tables &ndash; making cache tokens free at `0` and making every `withBudget` and `createConstraintRouter` construction throw at `-1`. Every read is now gated on `Object.hasOwn`.

**Window overruns are reported after the call, not only per-call ones.** `phase: "post-call"` fired only for `maxCostPerCall`. A call that estimated under its remaining hour and billed over it landed in the ledger unremarked, and the *next* call was the one that got blocked. `onBudgetExceeded` now fires with the window that was overrun.

**The pre-call estimate reads the cache rates.** It priced input tokens at `inputPerMillion` only, ignoring a rate dimension `TokenPricing` carries, so on a table where cache writes cost more than input the estimate sat below the bill on every cached call. It now charges input tokens at the highest of the input, cache-read, and cache-write rates: before the call there is no way to know how the provider will split them, and an estimate under the eventual bill is a cap that does not gate. The estimate still reads only the input string &ndash; no instructions, no history, no tools &ndash; so it remains a floor rather than a prediction, and that is now stated where it is documented rather than implied.

**The inert-cap warning tests what the estimate can produce.** It tested whether every rate was zero, which is not the same question: `{ input: 0, output: 0, cacheRead: 5 }` is not all-zero, so no warning fired, and yet the estimate came out at `0` and a `maxCostPerCall` never blocked anything. Both now read the same rate through one helper.

**A runner that never reports `tokenUsage` warns.** The warning fired only when `tokenUsage` was present but unusable. The commoner case &ndash; a runner that simply does not populate it &ndash; left the ledger running entirely on estimates with nothing in the log to say so. It warns once, as the other conditions do, and `getUnpricedCallCount()` still carries the tally.

**Anthropic pricing corrections.** The Haiku 4.5 row shipped under `claude-haiku-4-5-20250514`, which is not a model ID: anyone passing the real one, `claude-haiku-4-5-20251001`, got no pricing at all and priced their run at nothing. Its rates were wrong as well &ndash; $1 / $5 per million, not $0.80 / $4.00 &ndash; and the cache rates derived from the wrong base were wrong throughout. The Haiku 3.5 key was likewise not a model ID and is corrected to `claude-3-5-haiku-20241022`. The remaining rows verified as correct and are unchanged.

**`TokenPricing`, `ModelPricing`, `BareTokenRates`, and `toTokenPricingTable` now live in the pricing module** and are re-exported from `budget.ts`, so existing imports keep working. `createConstraintRouter` no longer reaches into a budget for a type neither owns. Non-breaking.

**Provider-reported token counts are validated before they reach the ledger.** `result.tokenUsage` crosses a trust boundary, and a single `NaN`, `Infinity`, or negative count added to a running total is permanent &ndash; every later `getSpent()` inherits it and no subsequent call washes it out. Unusable counts are now rejected rather than recorded, and the call is priced by its pre-call estimate instead &ndash; see below.

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

**`createAgentMetrics().trackRun` carries the cache token classes** (`@directive-run/core`). It accepted `inputTokens` and `outputTokens` only, and on a provider that reports prompt-cache usage `inputTokens` is the *uncached remainder* &ndash; so `agent.tokens` under-reported a cached run by the whole cached prefix, the same margin the cost ledger was under-counting before cache tokens were priced. `cacheReadTokens` and `cacheWriteTokens` are now accepted, counted under `agent.tokens.cache_read` / `agent.tokens.cache_write`, and added to `agent.tokens`. Both are optional; omitting them records nothing, exactly as before.
