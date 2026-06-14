# RFC 0007 – Source backpressure + coalesce strategy

- **Status:** Accepted – shipped 2026-06-07 in `feat/source-primitive` (PR #52, merge `ab97b028`); pending v1.18.0 release
- **Author:** Jason Comes
- **Related:** R5 distributed-systems reviewer findings (R5-CR3
  "10k events/sec into Tier 2 path"); R6 architecture reviewer's
  back-pressure gap; `docs/IDEAS.md` Tier 1 architectural follow-up.

## Summary

The R5 distributed-systems reviewer ran throughput analysis and found
**no back-pressure primitive** in the source path. At 10k publishes/sec
into Tier 2 (publish → fact → constraint → async resolver), the resolver
pool grows unbounded, the reconcile-depth guard trips at depth 50, and
`previousRequirements` is silently reset – **data loss disguised as
"recovery."**

This RFC adds an optional `coalesce` field on `SourceDef` so high-frequency
sources (cursor movement, sensor telemetry, Supabase channel storms) can
declare their throughput posture once and let the manager debounce
publishes to the reconcile loop.

## Proposed API

```ts
interface SourceDefinition {
  attach: (publish: SourcePublishFn) => SourceUnsubscribeFn;
  meta?: DefinitionMeta;
  /**
   * How to absorb publishes that would overwhelm the reconcile loop.
   * Default: "none" – every publish dispatches.
   *
   * - "none" (default): no debounce. Every publish flows into the engine.
   *   Correct for low-frequency lifecycle events (MCP connect, DO alarm).
   * - "lastWriteWins": coalesce same-event-name publishes within one
   *   microtask. The last payload of the cycle wins; earlier are dropped
   *   silently (bumps `dropCount` / `lastDropReason: "coalesced"` per
   *   source). Correct for telemetry / cursor / scroll sources.
   * - "all": no coalesce; preserve every payload. Same as "none" but
   *   names the intent for readers.
   */
  coalesce?: "none" | "lastWriteWins" | "all";
}
```

## Throughput budget (from R5)

| Tier | Today's behavior | Recommended budget |
|---|---|---|
| Bare publish → event dispatch (no constraint cares) | ~50k-200k/sec | **20k/sec sustained, 100k burst** |
| publish → fact update (constraint re-evaluates) | ~5k-10k/sec before microtask drain visible | **5k/sec sustained, 10k burst** |
| publish → fact → derivation → async resolver fires | 500/sec before pool unbounded | **500/sec sustained, 2k burst – only with bounded resolver pool** |
| 10k/sec into Tier 2 (worst case) | **MELT**: reconcile depth 50, previousRequirements reset, data loss | **CAP at 5k/sec via coalesce** |

## Coalescing strategy

For `coalesce: "lastWriteWins"`:

- Per source, per event-name, the manager keeps a single pending publish
  (with its payload) in a `Map<eventName, payload>`.
- The pending map flushes on `queueMicrotask`. Every flush drains the
  entire map in one batch.
- Each coalesced publish (one or more raw publishes mapped into one
  dispatched publish) bumps `publishCount` once; the dropped-due-to-
  coalesce raw publishes bump `dropCount` and set
  `lastDropReason: "coalesced"`.

For `coalesce: "none" | "all"`: no change vs. current behavior.

## Drop-reason addition

`SourceCounters.lastDropReason` (shipped in R6) gains a fifth variant:

```ts
type SourceDropReason =
  | "post-destroy"
  | "post-stop"
  | "blocked-event-name"
  | "invalid-event-name"
  | "coalesced";  // NEW
```

The new variant is additive – existing callers do not need updates.

## Observability requirements

- `system.inspect().sources[i]` already surfaces `dropCount` /
  `lastDropReason` / `lastDropAt` (shipped R6). The new "coalesced"
  reason flows through unchanged.
- Logging plugin's `onSourcePublish` fires once per FLUSHED publish, not
  once per raw publish. (Otherwise the coalesce primitive doesn't reduce
  log cardinality, defeating the purpose.)
- Audit-ledger does not capture publishes – drops here are visible only
  via inspect + observation events (no new ledger entries needed).

## Acceptance criteria

- `SourceDef.coalesce` lands additively (default `"none"` preserves
  current behavior).
- `lastWriteWins` mode coalesces same-event-name publishes within one
  microtask.
- `dropCount` bumps per coalesce-dropped raw publish; `lastDropReason`
  records `"coalesced"`.
- 10k-publishes-per-tick test passes without tripping the reconcile-
  depth guard at depth 50.
- `packages/knowledge/core/sources.md` adds a "High-frequency sources"
  section describing the throughput tiers + coalesce recipes.
- Changeset describes the additive option + the throughput budget.
