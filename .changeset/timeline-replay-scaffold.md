---
"@directive-run/timeline": minor
---

Add `serializeTimeline` + `deserializeTimeline` + `replayTimeline` (R1.A scaffold)

Recorded timelines are now JSON-roundtrippable and replayable against a fresh system. This is the BUILD CANDIDATE from the AE-review-loop's innovation pass — the substrate for "production error JSON → auto-derived vitest test file."

**New exports:**
- `serializeTimeline(timeline) → SerializedTimeline` — JSON-safe wire format with version stamp.
- `deserializeTimeline(input: unknown) → SerializedTimeline` — validates structure + schema version; throws on mismatch.
- `replayTimeline(timeline, system, opts?) → Promise<void>` — walks frames in order, re-dispatches recoverable events.
- `SerializedTimeline` + `ReplayOptions` + `ReplayableSystem` types.

**v0.1 scope (deliberately narrow):** today reconstructs `MUTATE` dispatches from `@directive-run/mutator`-shaped `pendingMutation` fact.change frames. Other dispatch sources land when core emits first-class `event.dispatch` observation events. The dispatchable-frame filter (`{ dispatchable: true }`, default) skips lifecycle-internal events (`system.start`, `reconcile.*`, `derivation.compute`, ...).

**v0.2 scope (deferred):** auto-derived vitest source codegen (`directive replay <id>.json` → `<id>.test.ts`); determinism gate; mock-stub generation from recorded resolver pairs.

5 new tests covering JSON round-trip, deserialize validation, dispatchable replay, non-dispatchable skip, and `dispatchable: false` walk mode.
