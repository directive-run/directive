---
"@directive-run/ai": minor
---

**Provider pricing tables now compose with `withBudget` directly, and a mismatched pricing object fails loudly instead of silently disabling the budget.**

Each adapter published its rates in one shape only — `{ input, output }`, sized for `estimateCost`, which takes a bare per-million rate. `withBudget` and `withProviderRouting` are typed against `TokenPricing`, which spells the same two numbers `{ inputPerMillion, outputPerMillion }`. Handing a pricing table to a budget therefore left both rates `undefined`: every computed cost became `NaN`, every `estimated > remaining` check evaluated to `false`, and the budget never tripped. Spend was unbounded precisely when the caller believed it was capped, with nothing in the logs to say so.

Two changes close it.

New `ANTHROPIC_TOKEN_PRICING`, `OPENAI_TOKEN_PRICING`, `GEMINI_TOKEN_PRICING`, and `OLLAMA_TOKEN_PRICING` exports carry the same rates already in `TokenPricing` shape, so they pass straight into a budget with no conversion at the call site:

```typescript
import { withBudget } from "@directive-run/ai";
import { ANTHROPIC_TOKEN_PRICING } from "@directive-run/ai/anthropic";

const pricing = ANTHROPIC_TOKEN_PRICING["claude-sonnet-4-5-20250929"];
const guarded = withBudget(runner, {
  pricing,
  budgets: [{ window: "day", maxCost: 10, pricing }],
});
```

`withBudget` now also validates every `pricing` object it is given — both the top-level one and each budget window's — and throws at construction if either rate is missing or non-finite. When the object looks like a provider table, the error names the fix rather than describing the symptom. A budget guard that fails open is worse than no guard at all, so this is now a hard error rather than a silent `NaN`.

The existing `ANTHROPIC_PRICING` / `OPENAI_PRICING` / `GEMINI_PRICING` / `OLLAMA_PRICING` exports are unchanged and remain correct for `estimateCost`. Nothing needs migrating; reach for the `*_TOKEN_PRICING` variant when wiring budgets or provider routing.
