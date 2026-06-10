---
"@directive-run/ai": patch
---

R18 walker hardening — `createFactPIIGuardrail`:

- **R18-C1 (Proxy TOCTOU on pre-clone cap):** the R17 pre-clone array cap read `value.length` twice (once for the comparison, once during `value.slice`). A hostile `Proxy` whose `length` getter lied on the first read (returning a small number) and on the second read (returning 1e9) could bypass the cap and OOM `structuredClone`. The cap now materializes via a fixed-length `new Array(len)` loop that reads each index exactly once, so the Proxy's traps can't TOCTOU. `structuredClone` then operates on a plain Array of bounded length.
- **R18-C2 (`Error.cause` + `AggregateError.errors` blind spot):** R17 only scanned `Error.message`. PII inside `error.cause` (string or wrapped Error) or inside an `AggregateError`'s `errors` array was missed. The walker now recurses into both, decrementing `walkDepth` for the recursion so depth bounds still apply.
- **R18-C3 (idempotency-gate restriction):** the `value === _prev` skip in `onFactSet` / `onFactsBatch` is now restricted to primitives. Object references that survived the engine's own dedup (or arrived via direct `facts.$store.set` writes) are re-inspected on every emission rather than skipped.
- **R18-C5 (Error redact-mode is now alert-only):** the Error path returns the input reference as `redacted` (Error instances are not deep-cloned with new identity). The follow-up `$store.set` is now skipped when `result.redacted === value`, preventing the writes-back-the-same-ref no-op + the gate-skip cascade on the next emit. The redaction action for Error values is therefore detection-only regardless of the configured `mode`; this is the correct semantic for read-only structured types.

Closes R18 Critical findings 1, 2, 3, 5. R18-C6 (`guardrail.blocked` `ObservationEvent` variant) deferred to a follow-up RFC since it touches the `@directive-run/core` observation API.
