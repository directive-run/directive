# RFC 0003 — Resolver constraint-binding (`owns`)

- **Status:** Draft (2026-05-18)
- **Author:** Jason Comes
- **Supersedes:** the `bind: 'auto'` constraint-binding shipped (and reverted) with the v1.4.0 release attempts.
- **Related:** the Minglingo XState→Directive migration (Phase A — executor-tail-clobber).

## Summary

`owns` lets a constraint declare the facts its resolver **owns**. A write from
that resolver to an owned fact is dropped — and the resolver aborted — if the
fact was changed by anything else (an event, another resolver) since the
resolver last wrote or observed it. This is per-fact optimistic concurrency.

```ts
constraints: {
  mutate: {
    when: (f) => f.status === 'mutating',
    require: { type: 'EXECUTE_ACTION' },
    owns: ['status'],
  },
}
```

## Motivation — the executor-tail-clobber bug

A resolver fires from a constraint, does async work, then writes a fact in its
tail. While it was `await`-ing, an event flipped that fact to a terminal value.
The resolver's tail then overwrites the event's value:

```ts
// status: 'mutating' | 'playing' | 'left'
resolve: async (_req, ctx) => {
  await mutate();
  ctx.facts.status = 'playing'; // clobbers an event-driven status = 'left'
}
```

The hand-written defense is a per-write guard (`if (ctx.facts.status === 'mutating') ...`)
that scales linearly with mutation sites and is easy to forget in a recovery
branch.

## What the first attempt got wrong

The reverted v1 (`bind: 'auto'`) gated **every** resolver write by
re-evaluating the constraint's `when()` predicate. Two fatal flaws:

1. **All-or-nothing.** Once `when()` flipped false, *every* subsequent write
   was dropped — including writes to *data* facts that the resolver
   legitimately produced (e.g. "this player won", "this number was called").
   A resolver that writes `data` then `status` lost the data. In Minglingo
   this silently dropped a player's win if the round ended a moment after
   they claimed it.

2. **Predicate coupling.** Re-evaluating the *whole* `when()` meant that if
   the resolver itself wrote a fact `when()` reads (e.g. clearing a
   `pendingAction` discriminant), the predicate flipped false and the
   resolver's *own* subsequent writes were dropped — freezing the module.

`when()` was the wrong thing to consult. The bug is narrow: *"is the resolver
about to overwrite a fact an event already changed?"* — a per-fact clobber
check, not a predicate re-evaluation.

## Design

> `owns` is **value-based per-fact compare-and-swap**, with one-shot
> fact-level poisoning. It is *not*: HTTP If-Match (header-driven,
> request-level), Postgres row locks (pessimistic), Mongoose `__v`
> (whole-document versioning), or RxJS `share` (multicast). The closest
> concept is STM's optimistic per-cell retry — but Directive **drops**
> the write instead of retrying.

`owns` names the facts the resolver owns. The resolver's `ctx.facts`
is a proxy that, per owned fact, remembers the value the resolver last wrote
or started with (snapshotted at resolver dispatch). A write to an owned fact:

- **lands** if the fact still holds that remembered value (nobody else wrote
  it) — and the remembered value is updated;
- **is dropped**, and the resolver's `AbortController` aborted, if the fact's
  live value differs (an external writer intervened). Ownership of that fact
  is then lost for the rest of the invocation (**one-shot per fact**).

Writes to any fact **not** in `owns` always land. `when()` is never
consulted by the binding — it remains purely the constraint trigger.

### Properties

- **Data-safe.** Only the named facts are clobber-checked; the resolver's
  other writes are untouched. Fixes flaw 1.
- **Predicate-independent.** The binding never runs `when()`, so the
  resolver writing any fact (owned or not) cannot deactivate it. Fixes
  flaw 2.
- **Sync constraints only.** The owned-fact baseline is snapshotted when the
  resolver is dispatched. Async constraints `await` between predicate
  evaluation and dispatch — an event in that window would move the owned
  fact before the snapshot, so the clobber would go undetected. `owns` on an
  async constraint is therefore ignored (dev-mode warning). A future
  revision could snapshot at predicate-evaluation time to lift this.
- **One-shot per fact.** Once an owned write is dropped, later writes to that
  fact are dropped too — a resolver whose intent was superseded cannot
  resurrect it, even if the fact transiently returns to the expected value.

### Resolver lifecycle — detach instead of cancel

Normally the engine **cancels** an in-flight resolver when its requirement is
removed (the constraint flipped false) — it aborts the resolver's signal. A
resolver that checks `ctx.signal.aborted` after its `await` then bails.

For a **bound** constraint this is replaced by **detach**: when the
requirement is removed, the bound resolver is untracked from the engine's
in-flight set but its signal is *not* aborted — it runs to completion. This
is essential. Cancelling would make the resolver bail at its first
post-`await` signal check, and its data writes would never happen — the
binding (which only acts on the *owned* fact) would never even be reached.
Detach lets the data writes land; the binding still drops the owned-fact
clobber.

Detach (rather than merely skipping cancellation) also keeps re-dispatch
correct: because the resolver no longer occupies the in-flight slot for its
requirement id, if the constraint flips true again the requirement
re-dispatches a fresh resolver cleanly. If the original resolver is still
running at that point, both run concurrently — harmless, since the binding
clobber-checks each against its own snapshot. In practice a constraint's
event guards usually prevent re-entry before the first resolver finishes.

A bound resolver's signal is therefore aborted only by the binding itself (a
dropped owned write), by an explicit `cancel()`, or by a timeout — never by
requirement removal.

### Known limitation — ABA

The check is value-based (`Object.is`). If an external writer changes an
owned fact and then changes it *back* to the resolver's expected value
before the resolver writes, no clobber is detected. This is intentional and
correct: the external actor's net effect was a no-op, so the resolver
completing its transition is legitimate. A clobber that matters — an event
moving a fact to a terminal value and leaving it there — is always detected.

## API

```ts
interface ConstraintDef {
  // ...
  /** Fact keys the triggering resolver owns; writes to these are clobber-checked. */
  owns?: readonly string[];
}
```

Omit `owns` (the default) for no binding — every write lands, current
behavior. An empty array is treated as no binding.

`owns` is a no-op for out-of-band invocations (`callOne`) and for mixed-source
batch resolvers, where there is no single triggering constraint.

## Migration from the reverted v1

`bind: 'auto'` → `owns: [<the phase fact>]`. The fields are the facts the
resolver re-asserts in its tail and that an event might change out from
under it — typically a single `status`/`phase`/`mode` fact. The constraint's
`when()` predicate needs no change; the binding ignores it.

## Future work (not in this RFC)

- **Module-level default field list.** `owns` is intentionally per-constraint
  — within a module, mutator constraints are bound but loader constraints
  must not be (a loader legitimately writes the phase fact forward). A
  blanket module/system-level `owns` would break loaders. The repetition
  worth removing is the *field list*: a module could declare `phaseFacts:
  ['status']` once, and constraints opt in with a lightweight `owns: true`
  (inherit) — keeping per-constraint opt-in while staying DRY. Deferred until
  enough bound constraints exist to justify the API surface.
- **Async constraints.** Bindable if the owned-fact baseline is snapshotted
  at predicate-evaluation time rather than resolver-dispatch time (see
  "Sync constraints only" above). Deferred.
- **Auto-detected fields.** Inferring owned facts from what `when()` reads is
  *not* viable — it gates discriminant facts the resolver legitimately
  clears (e.g. `pendingAction`), re-creating the freeze. The author must
  name the phase fact explicitly.

### Runtime async detection

A function `when` that returns a Promise is promoted to async at runtime —
*even when `async: true` was not set*. The engine then silently disables
`owns` for that constraint and logs:

> `[Directive] constraint '<id>': owns binding disabled because when() returned a Promise — convert to a synchronous when, mark the constraint async: true and accept the binding being off, or use a data-form when (always sync).`

The workaround is a **data-form `when`** (always sync — the binding works)
or a sync function `when` that pushes the async dependency into a derivation.

## Observing clobbers

When the binding drops an owned-fact write, Directive emits a
`resolver.clobber` observation event so devtools, the logging plugin, and
user-installed observers can surface the drop:

```ts
system.observe((e) => {
  if (e.type === "resolver.clobber") {
    console.warn(
      `[clobber] resolver ${e.resolverId} dropped ${e.fact}: ` +
        `expected=${JSON.stringify(e.expected)} actual=${JSON.stringify(e.actual)}`,
    );
  }
});
```

The same event is delivered to plugins through the `onResolverClobber` hook:

```ts
interface Plugin {
  onResolverClobber?: (
    resolverId: string,
    requirementId: string,
    fact: string,
    expected: unknown,
    actual: unknown,
  ) => void;
}
```

Devtools and the logging plugin handle this event by default.

## Single-process scope (v1.5)

The clobber detection described in this RFC uses an in-memory `Map` per
process (the `expected` map inside `createBoundFacts`). It guards against
sibling resolvers in the same reconcile tick and out-of-band event mutations
within the same process — that's the only race surface a single-process
Directive runtime has.

`owns` is a per-process Map. In multi-tab same-origin scenarios with a
shared backing store (e.g., IndexedDB via `BroadcastChannel`), each tab
has its own clobber detection — cross-tab writes are not caught. For
multi-tab safety, serialize writes through a single coordinator tab or
wait for v2's distributed `ClobberDetector`.

Multi-process Directive (planned v2) will introduce a `ClobberDetector`
interface to abstract the per-fact owned-value lookup. Single-process
implementations will plug into the same surface today's `createBoundFacts`
uses internally — no resolver-author-visible change. Distributed
implementations (Redis, Postgres advisory locks, durable execution
backends) will satisfy the same interface so the binding semantics
carry across processes. Architectural design is deferred until the
v2 cross-process story lands.
