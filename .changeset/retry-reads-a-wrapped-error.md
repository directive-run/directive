---
"@directive-run/ai": patch
---

**A retry decision now reads the error that carries the HTTP details, not just the one on top.** `withRetry` wraps its last failure in a `RetryExhaustedError` and puts the original on `cause`; a fallback layer wraps that again. The status and `Retry-After` were read off the outermost error only, and a wrapped error has neither.

A missing status is treated as retryable, so one wrapper was enough to turn a documented non-retryable status into three attempts, and to discard the interval the server asked to be waited. Both readers now follow `cause` and `lastError` to the same depth the cost ledger already walks.

`Retry-After: 0` is also honoured. Zero is a legal delta-seconds value meaning retry now, and it is distinct from the server having sent no instruction at all — which is what falls back to exponential backoff.

**`ProviderHTTPError` is exported.** A streaming HTTP failure throws it and these notes describe it as the contract, but the class was not reachable from any entry point: `instanceof` needs the constructor, and reading `status`, `retryAfter` or the request id off a bare `Error` needed a cast.
