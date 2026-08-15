---
"@directive-run/ai": minor
---

Every published rate table now carries the date it was last checked, exported
alongside it: `ANTHROPIC_PRICING_AS_OF`, `OPENAI_PRICING_AS_OF`,
`GEMINI_PRICING_AS_OF`, `OLLAMA_PRICING_AS_OF`.

A rate change is the quietest thing that can go wrong with these tables. Nothing
throws, nothing is missing, no shape changes — every cost the package reports
drifts by a constant factor, in the same direction, for every caller. The docs
said the rates "may not reflect the latest," but there was no value a program
could read, so a consumer could not tell a table checked yesterday from one
checked eight months ago, and nothing in CI had a constant to compare against.

The date is that value. Read it to decide whether these numbers are fresh enough
to bill against:

```ts
import { ANTHROPIC_PRICING, ANTHROPIC_PRICING_AS_OF } from "@directive-run/ai/anthropic";

const daysOld =
  (Date.now() - Date.parse(ANTHROPIC_PRICING_AS_OF)) / 86_400_000;

if (daysOld > 90) {
  // Re-check against the provider before trusting a bill to these.
}
```

Internally the tables are also pinned by a digest of their own rates, so a rate
that moves without its date moving fails a test rather than shipping quietly.
