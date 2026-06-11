---
"@directive-run/core": minor
"@directive-run/ai": patch
---

RFC 0010 — `guardrail.blocked` ObservationEvent + `system.notify` surface.

`@directive-run/core` (minor — additive public API):

- New `ObservationEvent` variant `"guardrail.blocked"` with `plugin`,
  `key`, `kind` (`"redact" | "alert" | "detect"`), `count`, optional
  `category`.
- New `Plugin.onGuardrailBlocked` hook.
- New `PluginManager.emitGuardrailBlocked` broadcast.
- New `System.notify.guardrailBlocked(...)` surface — plugin authoring
  API that fans out to every plugin's `onGuardrailBlocked` hook
  (including the synthetic plugin that backs `system.observe()`).
- Synthetic observe plugin maps the hook to the typed event.

`@directive-run/ai` (patch — feature add):

- `createFactPIIGuardrail` calls `system.notify.guardrailBlocked` on
  every detection, in addition to the existing `onBlocked` callback.
  The `kind` field reports `"redact"` (rewrote via follow-up write),
  `"alert"` (configured mode), or `"detect"` (read-only structured
  type like `Error` — the walker matched but cannot construct a new
  instance with guaranteed `stack` parity).

Backend wiring (`attachSourcesToOtel`, `@directive-run/timeline`,
audit-ledger) is consumer-driven via `system.observe()` and is
deferred to follow-up patches.

Closes R18-C6.
