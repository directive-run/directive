---
"@directive-run/core": minor
---

Pair every `source.publish` with a new `source.drop` observation event so plugin observers see both halves of the publish path without polling `inspect().sources[i].dropCount`.

- New `Plugin.onSourceDrop(id, moduleId, eventName, reason)` hook fires whenever the engine OR the manager rejects a publish.
- New `system.observe()` `source.drop` ObservationEvent variant carries the same payload.
- New `SourceDropReason` type (exported from the public surface) is the shared union the inspect row, the plugin hook, and the observation event all reference, so the three surfaces cannot drift.
- `reason` mirrors `SourceInspectionRow.lastDropReason`:
  - `"post-destroy"` / `"post-stop"` — leaked transport firing after teardown
  - `"blocked-event-name"` / `"invalid-event-name"` — engine guard probe
  - `"coalesced"` — manager debounced a same-event publish within one microtask

The existing `onSourcePublish` semantics are unchanged — accepted publishes still fire there, drops fire only on `onSourceDrop`.
