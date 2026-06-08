---
"@directive-run/core": minor
---

Source primitive — R5 hardening: lifecycle parity, audit-ledger coverage, per-source telemetry, internals export

Closes the gaps surfaced by a maximum-scope review of `@directive-run/core`'s
`source` primitive across security, lifecycle, observability, privacy, and
portability lenses. All changes are additive (no breaking changes for
existing source declarations).

What changed:

- **Dispatch guard parity with `system.dispatch`.** The engine's source
  dispatcher now drops publishes that arrive after `system.stop()` (between
  stop and the next start), drops publishes whose event names walk the
  prototype chain (`__proto__`, `constructor`, `prototype`) — mirroring the
  BLOCKED_PROPS check `system.dispatch` already enforces — and drops empty
  / non-string event names so logging and audit sinks aren't forced to
  render placeholder rows.

- **Per-record `detached` flag on the publish closure.** Closes the
  re-registration race window: an OLD source's external transport firing an
  in-flight callback AFTER the R3 registry swap now hits a `detached`
  guard and no-ops, instead of dispatching with stale attribution. R3
  closed the registry leak; this closes the in-flight publish leak.

- **`registerModule` emits `onDefinitionRegister("source", ...)`.** Runtime
  source registration is now visible to plugins — including the
  audit-ledger — closing the privilege-change blind spot that left
  hot-reload and dynamic-module source attach unrecorded.

- **Audit-ledger captures `source.attach` / `source.detach` / `source.error`.**
  Three new `AuditEntryKind` variants land in the ledger automatically.
  `source.publish` is intentionally NOT captured — high-volume sources
  would blow up the ledger, and the resulting `fact.change` entries
  already encode the outcome and remain queryable.

- **Per-source telemetry on `system.inspect().sources`.** Each row now
  carries `attached`, `attachedAt`, `detachedAt`, `publishCount`,
  `lastPublishAt`, `errorCount`, and `lastError`, so operators can answer
  "is this source publishing?" "when did it last fire?" "is it errored?"
  without registering a custom plugin. Counters reset at every `system.start()`.

- **Logging plugin wires `onSourceAttach` / `onSourcePublish` /
  `onSourceDetach` / `onSourceError`.** The default observability surface
  now logs the full source lifecycle (attach/detach/error at the
  configured level, publish at `debug` so high-rate sources don't dominate
  the log at typical "info"-level config).

- **`createSourcesManager` re-exported from `@directive-run/core/internals`.**
  Closes the parity gap with every other manager factory and unblocks
  sandbox / sibling-package consumers that want to drive sources at the
  lower level.

- **Promise-shaped unsubscribe returns get a targeted diagnostic.** Authors
  who write `attach: async (publish) => () => undefined` now see a
  Promise-specific error message ("attach() must be synchronous — rewrite
  as `attach: (publish) => { ... return () => unsubscribe(); }`") instead
  of the generic "did not return an unsubscribe function" diagnostic.

- **Anti-patterns + sources.md cross-references corrected.** The dead
  `effects.md` link in sources.md's "Related" section is replaced with
  `core-patterns.md` + `naming.md` + the now-canonical `anti-patterns.md #20`
  entry. The stale "19 most common mistakes" intro line in
  `anti-patterns.md` is updated to reflect the 20th entry on hand-rolled
  subscriptions.

Five new regression tests cover the changes (BLOCKED_PROPS on event names,
post-stop dispatch guard, re-registration race detached flag, Promise
unsubscribe diagnostic, per-source publish counter).
