---
"@directive-run/ai": minor
---

`withStructuredOutput` now reports what the whole call spent, not what its last
attempt spent.

The wrapper re-prompts when a model's answer will not parse, so one call from
the caller's side can be several calls to the provider — each one billed. It
reported only the attempt that finally succeeded, treating the failed ones as
free. On three attempts of thirty tokens it reported thirty against ninety
spent, and the under-count is worst exactly when a model is struggling and
costing the most. A budget reading that total will authorise spend it has
already made.

Failed attempts leave no trace anywhere else — they happen inside the wrapper,
emit no event, and produce no separate result — so this was the only place the
number could be recovered.

**`totalTokens` now sums every attempt**, and `tokenUsage` sums the input,
output, and cache breakdown alongside it. Cache writes are read through
`normalizeTokenUsage`, so the two spellings a provider may use are reconciled by
the one function that owns that rule.

**New `structuredOutputAttempts` on `RunResult`** — how many provider calls were
paid for. Two attempts at thirty tokens is not the same event as one attempt at
sixty, and a total alone cannot tell them apart. Present only when this wrapper
ran.

**`StructuredOutputError` now carries `totalTokens` and `attempts`.** A run that
exhausts its retries produces nothing a caller can use and still costs money;
the error previously carried a single attempt's result and no total at all.
