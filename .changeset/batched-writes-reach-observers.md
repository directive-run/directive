---
"@directive-run/core": minor
"@directive-run/timeline": minor
---

**A write made inside `system.batch()` now reaches `system.observe()`.** It did
not before. The bridge behind `observe()` implemented the single-write plugin
hook and not the batched one, so the audit ledger — and anything else observing
— recorded an unwrapped write and missed the identical wrapped one.

That is not a corner of the API. Event handlers, effects, resolvers before their
first `await`, `initialFacts`, `hydrate` and every history navigation write
through a batch, so most of the writes a running system makes were arriving on
the path that recorded nothing. Wrapping a write in a batch was enough to keep
it out of the record entirely, while the plain write beside it was captured in
full.

**Each key gets one entry per batch**, carrying the value it held before the
batch and the value it holds after — not one entry per write. A body that writes
one key in a loop produces one entry: a hundred thousand writes to a single key
in one batch coalesce to a single row. The cost, which matters if you are
auditing rather than debugging, is that a value a fact held *only inside* a
batch is not recorded. Write a value and overwrite it before the batch closes
and the entry describes the first-to-last transition with nothing in between. If
you need every intermediate value, do not batch those writes.

**Every `fact.change` now carries an `origin`**: `"authored"` when your program
made the write, `"restore"` when a history navigation replayed it, `"hydrate"`
when stored state was loaded in through `hydrate`, `initialFacts` or
`system.restore`. It is stamped against each write as it is made rather than
read from a flag when the batch is reported — a batch can hold writes of more
than one origin, and one label taken at the end describes neither. Select on it
in the query (`ledger.query({ kind: "fact.change", origin: "authored" })`)
rather than filtering the result, because `query()` stops at `limit` before your
filter runs.

`origin` says how a write arrived, not whether to trust it. `"authored"` means
only that the write did not come through a replay or hydration door.

**`@directive-run/timeline`** marks non-authored frames in rendered output and
no longer re-dispatches them during `replayTimeline` — a timeline containing an
undo used to replay as two mutations where the user made one. `toMutate` counts
authored frames only. Timelines recorded before this release replay unchanged.
Its peer range on core moves to `^1.32.0`, since it now reads `origin`.

**Migration.** Expect more entries: on a workload of a hundred event dispatches
touching three facts each, ledger entries go from 102 to 405, and a system's
opening state now appears because `init` writes through a batch.
On the default in-memory sink — 10,000 entries — that rotates roughly four times
sooner, so size your sink for your write rate. Truncation markers share that
capacity: a steadily overflowing sink writes one marker per real entry, so ask
for about twice what you intend to keep. Anything asserting ledger row
counts in tests or dashboards will see different numbers. Ledger entries now
stamp `schemaVersion: 2`; entries written under 1 still verify, because the
version is part of what each entry is hashed over, and they answer
`origin: "authored"` to a query, since replayed writes could not be recorded
under that schema.

**One type-level break.** `origin` is required on `FactChange` and on the
`fact.change` member of `ObservationEvent`. Reading either is unaffected —
every event the runtime emits carries the field — but code that *constructs*
one in TypeScript, which in practice means plugin test fixtures and synthetic
timelines, needs the property added. It is required rather than optional
deliberately: a predicate that reads a missing field as "the program did it" is
the failure this field exists to prevent. `@directive-run/timeline` keeps it
optional on its serialized wire format, so timelines recorded before this
release still load.

**The ledger holds up better under someone trying to make it lie.** A sink that
refuses an entry no longer breaks the chain behind it — the entry never landed,
so nothing chains to it, and a new `onWriteError` option says which entry was
lost instead of leaving it to a console line inside a plugin-manager catch.
Truncation markers carry the same in-module sentinel tombstones do, so an
appended marker cannot make a hand-trimmed prefix read as routine rotation. An
entry claiming the current schema with no `origin` answers no origin query,
rather than passing as one the program made. And an `erase()` filter is checked
against the values `origin` can hold before any of it is copied into the
permanent, frozen marker — a filter can arrive from a request body, and that
marker is the record of the erasure.

None of this makes the in-memory sink evidentiary. The chain is unkeyed, so
anyone who can reach the buffer can recompute it; it detects accident and
in-process mutation, not an adversary holding your storage.

**A rotated ledger no longer reports itself tampered.** Once a bounded sink
fills, it drops its oldest entries — ordinary operation — but `verify()` began
every walk at the genesis hash, so the first link failed the moment the head
rotated out and a healthy ledger returned `valid: false` for the rest of its
life. It now starts from the surviving window and reports `windowStartSeq` on
the valid arm; a gap after that point is still a break. Two defects underneath
it are fixed too: an entry's hash is recorded before it is written, so a
truncation marker emitted from inside the write no longer shares a `prevHash`
with the entry that caused it, and drop counts now include the entry displaced
by the marker itself — the count was short by half. This is pre-existing, and it
is in this release because recording batched writes makes rotation roughly four
times more frequent.
