# Stability contract (frozen at 1.35)

What 2.0 must keep from `@directive-run/core` 1.35, and the rules for
changing it. Every rule here that can be checked is checked by the files
next to this one; they run in the `conformance:checks` project and are
pinned by `harness.lock.json`.

## Stability tiers

| Tier | What | Promise |
| --- | --- | --- |
| Public | Every export of `.`, `/plugins`, `/testing`, `/adapter-utils`, `/worker`, `/migration` | Semver. A removal or an incompatible change is a major. Frozen in `api-surface.json`. |
| Core kernel | The behaviour the conformance suite and the differential traces pin: hook order and arguments, `observe()` events, notifications, `inspect()` shape | Semver, through the oracle. Changes need an approved divergence (`diff/divergences.json`). |
| Internals | `/internals`, and any name prefixed `unstable_` | No promise. May change in any release. Still snapshotted, so a change is visible, but approving it is routine. |

## Evolution rules

1. **Options objects only.** A new parameter goes into an options object,
   never a new positional argument.
2. **Unknown config keys warn**, in development, and are otherwise ignored.
   They never throw, so config written for a newer release still loads.
3. **Unions are open.** Consumers must handle an unknown `type` / `kind` /
   origin; the engine may add members (an `ObservationEvent` type, an audit
   entry kind, a hook). Members are never renamed or removed.
4. **New behaviour is a feature value**, opted into by an option, not a
   change to what existing config does.
5. Adding an export is a minor change, but it must be listed in
   `api-changes.json` (`kind: "add"`) or the check fails: the 2.0 surface has
   to carry it. Adding a hook (or any other export) is allowed only through
   such an entry. An addition may sit as `approvedBy: null, status:
   "pending-gate"`; it passes, and the census prints it under "pending
   approvals" until Jason signs it at the Phase 0 gate. Removing or changing
   an export needs an entry with a non-null `approvedBy`, always.
6. Not in 1.35: `KERNEL_VERSION`, `kernel.has(cap)` and `hasFeature(system,
   feature)` are planned for core-next and are not part of this contract.

## What is checked

| Contract | Check | Files |
| --- | --- | --- |
| Public API of every entry point, from built `.d.ts`, plus every declaration an export refers to transitively, exported or not (`#ref:<module>:<name>` keys) | `api-surface.test.ts` | `api-surface.json` (from 1.35.0, sorted, deterministic), `api-changes.json` |
| A system satisfies 1.35.0's `adapter-utils` `SystemLike` | `types.test.ts` | `types/check.ts` (a) |
| The 46 Plugin hook names, and their signatures | `types.test.ts` | `types/frozen.ts`, `types/check.ts` (b) |
| `ObservationEvent` types and each payload | `types.test.ts` | `types/frozen.ts`, `types/check.ts` (c) |
| `inspect()` return shape | `types.test.ts` | `types/check.ts` (d) |
| History export, persistence saved data, signed snapshot, audit-ledger chain | `golden.test.ts` | `golden/` (written by 1.35.0) |

The goldens are checked both ways. The workspace reads what 1.35.0 wrote
exactly as 1.35.0 does, including reads that must fail (a tampered audit
entry, a changed snapshot value or signature byte, an expired signature
with `ignoreExpiry` unset). Byte-identical output is required only for the
signed or hashed goldens (signed snapshot, audit chain). For history and
persistence the requirement is that 1.35.0 reads the workspace's output
exactly as it reads its own. (1.35 facts are JSON-only: Date, Map and Set are
rejected with a warning, so the scripts carry none; the comparison itself
keeps them distinct.)

**Golden changes.** An approved difference in a history or persistence
golden is a `goldenChanges` entry in `api-changes.json`, one per named case
and row: `{ case, direction, engines, row, part, expected2, reason,
approvedBy, date }`.

- `case` is one of `GOLDEN_CASES` in `contracts/lib/golden.ts`: "history
  read", "persistence read", "history re-export", "persistence re-save" and
  "persistence write" (`checkGoldens`); "U10 flat", "U10 development", "U10 production", and the
  rollback of each, "U10 flat rollback", "U10 development rollback" and "U10
  production rollback" (`checkEnvelope`). `part` is that case's part.
- Every write the workspace makes over 1.35.0's data is judged by 1.35.0
  reading it, against 1.35.0 reading its own write from the same data: the
  re-export, re-save and write cases, and a rollback case for each U10
  stored value.
  These are `1.35-reads` cases, so a `read-1.35` entry never excuses a write
  1.35.0 reads differently. (The U10 `read-1.35` cases compare the load and
  whether it logged, not the save.)
- 1.35.0 reads persistence for a rollback through a module with no init
  (`restoreRun`): what it loaded, and whether it logged. The script's init
  runs after 1.35.0's restore and overwrites it, so through that init any
  bytes would read alike. 1.35.0 must restore its own golden exactly as the
  golden holds it.
- "persistence write" is the save after a load and a write
  (`persistenceWrite`): the workspace loads 1.35.0's golden through the
  script's values set with `??=`, writes `count`, and saves; 1.35.0 loads
  the same golden with no init, makes the same write, and saves; 1.35.0 must
  read both saves alike. The golden holds every key the init sets and `??=`
  keeps a restored value, so under (ai) and on 1.35.0's order alike the
  store holds the golden's values before the write, and an honest workspace
  needs no entry. It catches a save that drops or changes data only after a
  load and a change, or only when the module has an init.
- `direction` is `read-1.35` (the workspace starts on data where 1.35.0 reads
  it, compared with what 1.35.0 makes of the same data) or `1.35-reads`
  (1.35.0 reads what the workspace wrote: rollback). Each case lists the
  directions it compares.
- `engines` are the engines it covers, from those its case runs (`v2`,
  `v2:dist`, `v2:dist:prod`). `row` is the one decisions-page row it rests
  on, as `(ai)`.
- `expected2` is the recorded 2.0 value, as JSON. For that case, direction
  and engine only, the comparison uses it instead of 1.35.0's value. A
  different 2.0 value still fails, and so does 1.35.0's own value (the entry
  is stale). An entry never passes a case unconditionally.
- An unsigned, malformed or overlapping entry fails and covers nothing. The
  signed snapshot and the audit chain have no cases: no entry relaxes them.

Owner decision (Jason, 2026-11-02), in his words: "Extend it; Claude signs
(Recommended)". A signed entry may also cover the read of 1.35's data
(`read-1.35`), one entry per named case and row. Claude may sign an entry
only for a row Jason has approved, quoting that approval, as with
`diff/divergences.json`; never for any other row. Rollback stays strict:
1.35.0 must still read what 2.0 writes. Claude signs no `1.35-reads` entry;
a format change that breaks 1.35.0's read of the workspace's output needs a
`1.35-reads` entry Jason signs himself.

To approve an API change: Jason adds `{ entry, name, change, reason,
approvedBy, date }` to `api-changes.json`, then `oracle:update`, with the
`oracle-change` label. An agent never adds an API-change entry or fills its
`approvedBy` (golden changes: see "Golden changes" above).
One exception, by owner decision (Jason, 2026-11-03): the 13 `/internals`
removals he chose one name at a time ("I'd go with your recommendation but
let's go through them one at a time so o can see what's being removed"),
each answered "Remove (Recommended)" or, for `withoutTracking`, "Remove it
(Recommended)". Claude signed those 13 entries for him, each quoting his
answer; it covers no other entry.
To re-freeze after the v1 pin moves: `contracts:freeze`, review the diff,
`oracle:update`, label.

## Not part of the contract: view mechanics

Decided at the Phase 1 gate (`GATE-1.md`, decision 4). The views a system
hands out (`system.facts`, `system.derive`, `system.events`, a resolver's
`ctx.deps`, the read-only and prev views) are Proxies in 1.35; 2.0 builds
them from compiled accessors.

**Contract.** Reading and writing every declared key; `in` for every key,
declared or not; `Object.keys`, spread, `for...in`, `JSON.stringify` and
iteration order; every write, delete or `Object.defineProperty` that 1.35
refuses must still throw (in strict code a trap that returns `false` is what
makes it throw); every read, through any view, reads the same live state
a fresh view would; and `Object.hasOwn` / `hasOwnProperty` on a view never
throws.

**Not contract** (a mutant that changes only these is `proxy-mechanics`):

- `trap-result`: a trap's return value where it changes nothing above: the
  trap throws before it returns, or the result reaches only `Reflect.*`
  called directly on the view, never an ordinary assignment, `delete`, `in`
  or define.
- `descriptor`: the flags `Object.getOwnPropertyDescriptor` reports, as long
  as key listings, spread and every throw above are unchanged.
- `identity`: whether two reads of a view return the same object.
- `cache`: a memo of a view object (not of a value) that changes only
  identity or cost. Caching a value is never `proxy-mechanics`: a cached view
  that reads stale state breaks the contract.

## Known 1.35 bugs (kept, not frozen as intent)

- `onFactDelete` is declared but never emitted (`diff/unfired-hooks.json`).
  The hook name is frozen; 2.0 may start emitting it.
- An effect's nested write can mutate a fact value in place. 2.0 may fix
  this; it is not part of the contract.

## The write-log record

2.0 records every write and event in one shape. It is frozen now, as types
only (`write-log.ts`); nothing in 1.x emits it.

```ts
export type WriteOrigin = "authored" | "restore" | "hydrate" | (string & {});

export interface WriteLogRecordV1 {
  readonly v: 1;            // record format version
  readonly t: string;       // record type, dotted; open union
  readonly seq: number;     // per system, from 0, +1, no gaps
  readonly sys: string;     // system id
  readonly at: number;      // epoch ms from the system's clock
  readonly by?: string;     // responsible definition, e.g. "resolver:load"
  readonly origin?: WriteOrigin;
  readonly [field: string]: unknown; // type-specific payload
}
```

A new field is optional. Changing or removing a field is `v: 2`, and a
reader of `v: 1` must keep working.
