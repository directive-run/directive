---
"@directive-run/core": patch
"@directive-run/ai": patch
---

Two follow-on defensive fixes.

## core: batch-resolver cancellation handles requirements that span multiple in-flight batches

The reverse index from requirement id → owning batch was a `Map<string, string>` — when two batch resolver definitions ended up processing the same requirement instance concurrently (rare, but legal in the type system), the second registration silently overwrote the first. Cancelling the requirement aborted the most recently registered batch only; the other ran to completion despite the explicit cancel.

The index is now `Map<string, Set<string>>`. A requirement that participates in N batches at once tracks all N owners; cancelling iterates the snapshot and aborts every batch. The unwind path mirrors the change so the `Set` collapses cleanly per batch and the requirement is removed from the index only when the last owner releases it. All-or-nothing batch semantics are preserved within each batch.

## ai: self-healing fallback respects the orchestrator's token budget

`applySelfHealingFallback` calls the user-supplied `runner` (and any `fallbackRunners`) directly. With `budgetEstimateTokens` configured, the primary path reserved tokens against `maxTokenBudget` via `runAgentWithGuardrails`'s pre-flight check — but every fallback call entered the runner without that reservation. A primary failure CAUSED by budget pressure would then drive the fallback into the same overshoot the pre-flight existed to prevent.

The new `withFallbackBudgetReservation` wrapper reserves tokens against the running `inFlightReservation`, runs the fallback work, and releases the reservation in `finally`. When `budgetEstimateTokens` is undefined (default) the reservation is 0 and the wrapper is a no-op — strict back-compat for consumers that haven't adopted the new option.
