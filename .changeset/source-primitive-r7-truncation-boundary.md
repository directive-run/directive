---
"@directive-run/core": patch
---

Source primitive — R7: error-message truncation applies at the manager
boundary so audit-ledger and logging plugin observe a bounded message too

R6's `lastError.message` truncation closed the inspect-output leak surface,
but the `onError` plugin callback continued to receive the raw `Error`
object. The audit-ledger's `source.error` entry read `event.error.message`
directly, and the logging plugin's `error`-level emission logged the raw
error — both still wrote the full payload into their respective sinks.

R7 truncates at the `reportError` boundary inside the source manager: any
`Error` whose `message` exceeds `SOURCE_ERROR_MESSAGE_MAX` (256 chars) is
replaced with a sanitized `Error` instance carrying the truncated message
before the `onError` callback fires. The privacy invariant is now "one
bounded message ceiling across all three sinks" — `inspect()`, the audit
ledger, and the logging plugin. Short errors pass through unchanged so the
sanitization has zero allocation overhead in the common case.

`SourceInspectionRow`, `SourceLastError`, and `SourceDispatchResult` are
also now re-exported from `@directive-run/core/internals` so consumers
writing helpers over `inspect().sources[i]` can name the types directly
(previously possible only via `SystemInspection["sources"][number]`).

Docs:
- `system-api.md`'s "23 event types" reference now lists the four
  `source.*` variants (previously stale at "18 event types").
- `docs/IDEAS.md` Tier 0 entry cites the 256-char interim ceiling as
  the floor that `createFactPIIGuardrail` will eventually lift.
