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
5. Adding an export is a minor change and needs no approval. Removing or
   changing one needs an entry in `api-changes.json`, signed by Jason.

## What is checked

| Contract | Check | Files |
| --- | --- | --- |
| Public API of every entry point, from built `.d.ts` | `api-surface.test.ts` | `api-surface.json` (from 1.35.0), `api-changes.json` |
| A system satisfies 1.35.0's `adapter-utils` `SystemLike` | `types.test.ts` | `types/check.ts` (a) |
| The 46 Plugin hook names, and their signatures | `types.test.ts` | `types/frozen.ts`, `types/check.ts` (b) |
| `ObservationEvent` types and each payload | `types.test.ts` | `types/frozen.ts`, `types/check.ts` (c) |
| `inspect()` return shape | `types.test.ts` | `types/check.ts` (d) |
| History export, persistence saved data, signed snapshot, audit-ledger chain | `golden.test.ts` | `golden/` (written by 1.35.0) |

The goldens are checked both ways: the workspace reads what 1.35.0 wrote
exactly as 1.35.0 does and writes the same bytes for the same script, and
1.35.0 reads what the workspace writes.

To approve an API change: Jason adds `{ entry, name, change, reason,
approvedBy, date }` to `api-changes.json`, then `oracle:update`, with the
`oracle-change` label. An agent never adds an entry or fills `approvedBy`.
To re-freeze after the v1 pin moves: `contracts:freeze`, review the diff,
`oracle:update`, label.

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
