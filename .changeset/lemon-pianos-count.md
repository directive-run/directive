---
"@directive-run/ai": patch
---

Corrects the published provider rate tables against each provider's own pricing
page, and adds the current model generations. The `*_PRICING_AS_OF` dates shipped
in 1.29.0 asserted these tables had been checked; they had not.

**Rates that were wrong:**

| Model | Was | Published |
|---|---|---|
| `claude-sonnet-5` | $3 / $15 | **$2 / $10** |
| `o3` | $10 / $40 | **$2 / $8** |
| `gemini-2.5-flash` | $0.15 / $0.60 | **$0.30 / $2.50** |

`claude-sonnet-5` carried the figures from a repricing that was cancelled — $2/$10
was introduced as promotional and is now the standard rate. `o3` over-charged five
times on input. `gemini-2.5-flash` *under*-charged, which is the worse direction: a
budget built on it had quietly stopped stopping anything.

**Models added.** OpenAI's table held nine legacy entries and none of the gpt-5
family; all fourteen are now present, along with `o1`, `o1-pro` and `o3-pro`.
Gemini gained the 3.x line and `gemini-2.5-flash-lite`.

**Models removed.** `gemini-2.0-flash` and `gemini-2.0-flash-lite` were shut down
on 2026-06-01. A caller naming one now gets an error naming the model rather than
a price for something that cannot be called.

**Cached-input rates** are now populated for OpenAI and Gemini, where they were
absent. Neither provider charges for cache writes — caching is automatic — so
`cacheWrite` is deliberately unset rather than defaulted to the input rate.

**The freshness claim now expires.** A table whose checked-on date is more than
ninety days old fails its test, with a message naming what to do. The date said a
person compared these numbers to the provider's page; that claim decays, and
nothing used to notice.
