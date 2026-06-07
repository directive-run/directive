---
"@directive-run/core": minor
"@directive-run/timeline": patch
---

Source primitive — R6 hardening: dispatch ordering, drop telemetry, error truncation, AuditEntry coverage, timeline render

Closes a second round of cross-cutting findings against the source primitive
covering security, observability, privacy, and DX. All changes are additive
on top of R5.

**Engine — `emitDefinitionRegister("source", ...)` no longer leaks the live `def.attach` callback.**
The privilege-change emission now hands plugins an opaque descriptor
(`{ moduleId, meta }`) instead of the raw `SourceDef`. A malicious or buggy
plugin receiving the live def could call `def.attach(...)` to install a
parallel subscription bypassing the manager — the manager wouldn't track it,
wouldn't tear it down at stop, and wouldn't surface it via `inspect()`. The
descriptor exposes nothing callable; plugins that need to react beyond the
attach/publish/detach hooks can subscribe to `system.observe()`.

**Engine — emission order is now `register → attach`, matching constraints / resolvers / derivations / effects.**
Previously `sourcesManager.registerDefinitions` ran before
`emitDefinitionRegister("source", ...)`, so observers saw `source.attach`
before `definition.register`. Audit replays and devtools timelines now read
the source lifecycle in the same order as every other primitive.

**Manager — counter bump + `onPublish` fire ONLY for engine-accepted publishes.**
Pre-R6, `perSourcePublish` bumped `publishCount` + fired the `onPublish`
plugin hook BEFORE invoking the engine's dispatch lambda. When the lambda
silently rejected the publish (post-stop, BLOCKED_PROPS event name, empty /
non-string name), telemetry and observers saw "publish happened" for events
the engine swallowed. The dispatch lambda now returns a typed
`SourceDispatchResult` so the manager can split accepted / rejected: accepted
publishes bump `publishCount` + fire `onPublish`; rejected publishes bump
`dropCount` + record `lastDropReason` instead.

**`SystemInspection.sources[i]` gains `dropCount` / `lastDropReason` / `lastDropAt`.**
Operators can now diagnose "publishes happening, nothing changing" without a
custom plugin. The four drop reasons (`"post-destroy"`, `"post-stop"`,
`"blocked-event-name"`, `"invalid-event-name"`) attribute each rejection to a
specific guard. Closes the silent-block telemetry gap that let an attacker
probe BLOCKED_PROPS / the `isRunning` guard invisibly.

**Manager — error messages truncated at 256 characters.**
A source whose `attach()` throws with a payload-embedded message
(`throw new Error(\`bad row: ${JSON.stringify(piiRow)}\`)`) previously
landed the full payload in (a) `inspect().sources[i].lastError.message`,
(b) the audit ledger's `source.error` entry, and (c) the logging plugin's
error-level emission. R6 caps the message at a fixed length with a
`[N chars truncated]` marker so the leak surface is bounded. Source authors
who need the full message in development can opt into a custom logging
plugin that captures the raw `Error` object.

**Audit-ledger — `AuditEntry` discriminated union now includes `source.attach` / `source.detach` / `source.error`.**
The R5 `AuditEntryKind` listed these, but the `AuditEntry` union didn't
have matching arms — the `as AuditEntry` cast at `index.ts` masked the
type hole. Consumers can now `entry.kind === "source.*"` narrow on
`sourceId` / `moduleId` / `phase` / `error` without `as` escape hatches.

**Manager — late-bind unsubscribe via direct assignment.**
The R5 `Object.assign(attachedRecord, { unsubscribe })` was bypassing the
`readonly unsubscribe` declaration on `AttachedSource`. Drop the `readonly`
modifier to make the late-bind honest and remove the type-system lie.

**Hot-path allocation — `emptyCounters()` is no longer allocated per publish.**
`perSourcePublish` now relies on the counters entry being seeded at the top
of `attachOne` (so publish-during-attach is also counted). At 1M publishes
per tick the eliminated allocation removes ~1M small-object GC pressure.

**Timeline — source.* events now render with detail + color.**
`@directive-run/timeline`'s `formatEventDetail` switch now has cases for
`source.attach`, `source.publish`, `source.detach`, `source.error`. Pre-R6,
the timeline showed bare `source.publish` with no module / id / event name.
Also added `KIND_COLORS` entries (magenta for attach/detach, cyan for
publish, red for error).

**Docs — `system-api.md` documents `inspection.sources` + `attachedSourceCount`.**
The R5 telemetry fields were the SystemInspection JSDoc but absent from the
canonical knowledge doc. R6 lands the full schema reference.

**Bundle gate — `packages/core/dist/index.js` added to `size-budgets.json` at 18 KB gz.**
Current 14.7 KB gz leaves ~22% headroom. The largest package in the
workspace was previously ungated; any future feature now lands measured.

Three new regression tests cover the changes: drop telemetry on
`inspect().sources`, `onPublish` only fires for accepted publishes, and
`lastError.message` truncation at 256 chars. Sources test file goes from
39 → 42; full core suite 2105 → 2108 passing.
