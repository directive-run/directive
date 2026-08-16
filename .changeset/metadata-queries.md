---
"@directive-run/core": minor
"@directive-run/ai": minor
---

**BREAKING:** metadata queries ask per definition, and tell you when the answer moves.

`system.meta.byTag("pii")` decides what gets redacted before a value reaches a
model, a log, or a hash-chained audit ledger. Answering it walks every definition
in the system, so all three consumers cached the answer — and every defect this
area has had was a cache built once and never rebuilt.

**New:**

```ts
// O(1) for a fact. `undefined` means "could not answer" — not "no tag".
system.meta.carriesTag("fact", key, "pii");

// Replaces the polled revision() counter. Fires for dynamic
// register/assign/unregister as well as module registration.
system.meta.subscribe(["pii"], rebuild, { immediate: true });

// Narrow the walk when you only want one kind.
system.meta.byTag("pii", { kind: "fact" });
```

**Renamed, with no aliases:**

| Before | After |
| --- | --- |
| `MetaMatch.type` | `kind`, typed `DefinitionKind` |
| `via?: "inherited"` | `tagOrigin: "authored" \| "inherited"`, always present |
| `meta: { inheritsTags: false }` | `meta: { tagBoundary: true }` |
| `byCategory(...)` | removed |
| `revision()` | removed — use `subscribe` |

**Fixed along the way:**

- Plugins are now told about a write *after* the graph is invalidated, so a
  plugin asking what a value carries during `onFactSet` is told about the write
  it is being notified of. The batched path already worked this way, so the two
  disagreed with each other.
- A throwing `system.subscribe` / `system.watch` callback no longer aborts the
  write it was notified of, taking every plugin behind it down.
- A fact's tags can no longer be taken back. Schema types are frozen,
  `registerKeys` refuses to re-declare an existing key, and `tags` must be a
  plain array of strings — an `Array` subclass could override `includes` and
  answer differently on each call.
- The audit ledger and the clobber-loop detector refreshed their pii sets from a
  hook `registerModule` does not emit, so a module registered after start put raw
  values into a sink that cannot be edited afterwards. Both now ask per lookup,
  and both resolve a dotted clause path to the fact that carries the tag.
- The fact-PII guardrail screens `initialFacts` and hydrated state regardless of
  where it sits in the plugin list.

**New event:** `guardrail.coverage` reports what a guardrail covers rather than
what it caught, so a screen that has stopped covering anything is no longer
indistinguishable from one with nothing to report.

See `docs/rfcs/0011-metadata-queries.md` for the measurements and the two
rejected designs.
