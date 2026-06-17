# RFC 0003 – Resolver constraint-binding (`abortOn`)

- **Status:** Draft (2026-05-18); renamed `owns:` → `abortOn:` 2026-06-16.
- **Author:** Jason Comes
- **Supersedes:** the `bind: 'auto'` constraint-binding shipped (and reverted) with the v1.4.0 release attempts.
- **Related:** the production XState→Directive migration (executor-tail-clobber finding).

## Summary

`abortOn` lets a constraint declare the facts its resolver **aborts on**
when changed mid-flight. A write from that resolver to a listed fact is
dropped – and the resolver aborted – if the fact was changed by anything
else (an event, another resolver) since the resolver last wrote or observed
it. This is per-fact optimistic concurrency.

```ts
constraints: {
  mutate: {
    when: (f) => f.status === 'mutating',
    require: { type: 'EXECUTE_ACTION' },
    abortOn: ['status'],
  },
}
```

## Motivation – the executor-tail-clobber bug

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
   was dropped – including writes to *data* facts that the resolver
   legitimately produced (e.g. "this player won", "this number was called").
   A resolver that writes `data` then `status` lost the data. In production
   this silently dropped a player's win if the round ended a moment after
   they claimed it.

2. **Predicate coupling.** Re-evaluating the *whole* `when()` meant that if
   the resolver itself wrote a fact `when()` reads (e.g. clearing a
   `pendingAction` discriminant), the predicate flipped false and the
   resolver's *own* subsequent writes were dropped – freezing the module.

`when()` was the wrong thing to consult. The bug is narrow: *"is the resolver
about to overwrite a fact an event already changed?"* – a per-fact clobber
check, not a predicate re-evaluation.

## Design

> `abortOn` is **value-based per-fact compare-and-swap**, with one-shot
> fact-level poisoning. It is *not*: HTTP If-Match (header-driven,
> request-level), Postgres row locks (pessimistic), Mongoose `__v`
> (whole-document versioning), or RxJS `share` (multicast). The closest
> concept is STM's optimistic per-cell retry – but Directive **drops**
> the write instead of retrying.

`abortOn` names the facts the resolver aborts on when changed mid-flight.
The resolver's `ctx.facts` is a proxy that, per listed fact, remembers the
value the resolver last wrote or started with (snapshotted at resolver
dispatch). A write to a listed fact:

- **lands** if the fact still holds that remembered value (nobody else wrote
  it) – and the remembered value is updated;
- **is dropped**, and the resolver's `AbortController` aborted, if the fact's
  live value differs (an external writer intervened). The binding for that
  fact is then released for the rest of the invocation
  (**one-shot per fact**).

Writes to any fact **not** in `abortOn` always land. `when()` is never
consulted by the binding – it remains purely the constraint trigger.

The name `abortOn` describes the runtime action the resolver takes when
a listed fact changes – it aborts. The other constraint config keys
(`when:`, `require:`, `priority:`, `after:`, `deps:`) describe the
*configuration*; `abortOn:` describes the *reaction*. The verb is the
point: declaring this list says "this resolver aborts on changes to
these facts," which is exactly what the runtime enforces.

**This is caller-aborting OCC, not server-gating CAS.** Distributed-systems
readers will recognize the shape from HTTP `If-Match`, CosmosDB
`optimisticConcurrencyToken`, and EventStore `expectedVersion` – but
those mechanisms *reject the write at the server boundary*. Directive
does the opposite: the listed facts are written freely by anyone, and
the constrained resolver is the one that yields (drops its writes,
aborts its signal) when it observes the divergence.

**`abortOn` does NOT prevent other writers.** It protects this resolver
from writing stale data over a fresher value. Anything else can still
write to the listed facts at any time – the binding only intercepts
writes by *this* resolver.

### Properties

- **Data-safe.** Only the named facts are clobber-checked; the resolver's
  other writes are untouched. Fixes flaw 1.
- **Predicate-independent.** The binding never runs `when()`, so the
  resolver writing any fact (listed or not) cannot deactivate it. Fixes
  flaw 2.
- **Sync constraints only.** The abort-binding baseline is snapshotted when
  the resolver is dispatched. Async constraints `await` between predicate
  evaluation and dispatch – an event in that window would move the listed
  fact before the snapshot, so the clobber would go undetected. `abortOn` on
  an async constraint is therefore ignored (dev-mode warning). A future
  revision could snapshot at predicate-evaluation time to lift this.
- **One-shot per fact.** Once a write is dropped, later writes to that fact
  are dropped too – a resolver whose intent was superseded cannot
  resurrect it, even if the fact transiently returns to the expected value.

### Resolver lifecycle – detach instead of cancel

Normally the engine **cancels** an in-flight resolver when its requirement is
removed (the constraint flipped false) – it aborts the resolver's signal. A
resolver that checks `ctx.signal.aborted` after its `await` then bails.

For a **bound** constraint this is replaced by **detach**: when the
requirement is removed, the bound resolver is untracked from the engine's
in-flight set but its signal is *not* aborted – it runs to completion. This
is essential. Cancelling would make the resolver bail at its first
post-`await` signal check, and its data writes would never happen – the
binding (which only acts on the *listed* fact) would never even be reached.
Detach lets the data writes land; the binding still drops the abort-bound
clobber.

Detach (rather than merely skipping cancellation) also keeps re-dispatch
correct: because the resolver no longer occupies the in-flight slot for its
requirement id, if the constraint flips true again the requirement
re-dispatches a fresh resolver cleanly. If the original resolver is still
running at that point, both run concurrently – harmless, since the binding
clobber-checks each against its own snapshot. In practice a constraint's
event guards usually prevent re-entry before the first resolver finishes.

A bound resolver's signal is therefore aborted only by the binding itself (a
dropped write), by an explicit `cancel()`, or by a timeout – never by
requirement removal.

### Known limitation – ABA

The check is value-based (`Object.is`). If an external writer changes a
listed fact and then changes it *back* to the resolver's expected value
before the resolver writes, no clobber is detected. This is intentional and
correct: the external actor's net effect was a no-op, so the resolver
completing its transition is legitimate. A clobber that matters – an event
moving a fact to a terminal value and leaving it there – is always detected.

## API

```ts
interface ConstraintDef {
  // ...
  /** Fact keys this resolver aborts on when changed mid-flight; writes to these are clobber-checked. */
  abortOn?: readonly string[];
}
```

Omit `abortOn` (the default) for no binding – every write lands, current
behavior. An empty array is treated as no binding.

`abortOn` is a no-op for out-of-band invocations (`callOne`) and for
mixed-source batch resolvers, where there is no single triggering constraint.

## Migration from the reverted v1

`bind: 'auto'` → `abortOn: [<the phase fact>]`. The fields are the facts
the resolver re-asserts in its tail and that an event might change out from
under it – typically a single `status`/`phase`/`mode` fact. The constraint's
`when()` predicate needs no change; the binding ignores it.

## Future work (not in this RFC)

- **Module-level default field list.** `abortOn` is intentionally
  per-constraint – within a module, mutator constraints are bound but loader
  constraints must not be (a loader legitimately writes the phase fact
  forward). A blanket module/system-level `abortOn` would break loaders. The
  repetition worth removing is the *field list*: a module could declare
  `phaseFacts: ['status']` once, and constraints opt in with a lightweight
  `abortOn: true` (inherit) – keeping per-constraint opt-in while staying
  DRY. Deferred until enough bound constraints exist to justify the API
  surface.
- **Async constraints.** Bindable if the abort-binding baseline is
  snapshotted at predicate-evaluation time rather than resolver-dispatch
  time (see "Sync constraints only" above). Deferred.
- **Auto-detected fields.** Inferring listed facts from what `when()` reads
  is *not* viable – it gates discriminant facts the resolver legitimately
  clears (e.g. `pendingAction`), re-creating the freeze. The author must
  name the phase fact explicitly.
- **Richer trigger object form.** Widening from `abortOn: string[]` to
  `abortOn: (string | AbortTrigger)[]` so consumers can express
  conditional abort (e.g. `{ fact: 'status', when: { $eq: 'cancelled' } }`).
  Captured as a follow-on; deferred until consumer demand surfaces. See
  IDEAS.md R8.A.
- **Per-constraint declarative `on*` callbacks.** A second surface
  alongside the event stream (`onAbort`, `onClobber`, etc.). Captured as a
  follow-on; deferred. See IDEAS.md R8.B.
- **`bind:` (v2, distinct surface).** The `bind:` field is type-reserved
  on `system.inspect().constraints[]` and on `CheckAbortOnFinding.source`
  as a v2 promise – but it is *not* the v1 `bind: 'auto'` that this RFC
  supersedes, and it is *not* a synonym for `abortOn:`. The intent: where
  `abortOn:` is *caller-aborting* (this resolver yields), `bind:` will be
  *single-writer-binding* (no other writer may touch the listed facts
  while the resolver runs). The runtime does not emit `bind` on inspect
  snapshots today; doctor's `bind` check returns zero findings until
  v2 lands. **Reserved-property validation already in place**:
  `validateBindKeys` (in `module.ts`) rejects `__proto__`, `constructor`,
  `prototype`, and `$`-prefixed `bind:` keys at registration time, so the
  reserved-key bypass surface is closed before v2 wires the field.
  Design deferred until the v2 multi-process story crystallizes –
  `bind:` semantics ride on the planned `AbortDetector` interface
  (see "Single-process scope" below).

### Runtime async detection

A function `when` that returns a Promise is promoted to async at runtime –
*even when `async: true` was not set*. The engine then silently disables
`abortOn` for that constraint and logs:

> `[Directive] constraint '<id>': abortOn binding disabled because when() returned a Promise – convert to a synchronous when, mark the constraint async: true and accept the binding being off, or use a data-form when (always sync).`

The workaround is a **data-form `when`** (always sync – the binding works)
or a sync function `when` that pushes the async dependency into a derivation.

## Observing rejected writes

When the binding drops a listed-fact write, Directive emits a
`resolver.write.rejected` observation event with `reason: "clobbered"` so
devtools, the logging plugin, and user-installed observers can surface the
drop. The `reason` field keeps the observation protocol backend-neutral –
clobber detection is the in-memory implementation; future write-rejecting
backends can report other reasons under the same event type.

The `reason: "clobbered"` discriminant stays even though the field was
renamed from `owns:` to `abortOn:` – it's established vocabulary across the
plugin hook payload and the clobber-loop detector (IDEAS.md R4.J), and
renaming it would break consumer log queries with no clarity upside.

### Async-disable observation event

When the engine silently disables a constraint's `abortOn:` binding
because the constraint is async (declared `async: true` OR runtime-promoted
because its `when()` returned a Promise), it emits
`constraint.binding.disabled` with `reason: "async-declared"` or
`reason: "async-promoted"`. The dev-mode `console.warn` is the
human-facing signal; the event is the SIEM-facing one. Without it, a
production constraint loses its clobber-protection with no plugin /
observer trail. The plugin hook is `onConstraintBindingDisabled(id,
reason)`.

A typical observer:

```ts
system.observe((e) => {
  if (e.type === "constraint.binding.disabled") {
    metrics.increment("directive.binding.disabled", {
      constraint: e.id,
      reason: e.reason, // "async-declared" | "async-promoted"
    });
    if (e.reason === "async-promoted") {
      // Author probably didn't realize — escalate
      logger.warn(`Constraint ${e.id} silently lost clobber protection`);
    }
  }
});
```

The event (and its companion dev-mode `console.warn`) fires **at most
once per (constraint id, reason) pair** across the lifetime of the
registered constraint. A hot async constraint that dispatches thousands
of times per second still produces exactly one event per reason, so
the SIEM / log stream cannot be flooded by the binding-disabled
signal. The bit is cleared if the constraint is `unregister()`-ed and
re-registered.

### Default high-severity alerting

The built-in `clobberAlertPlugin` ships a default rule that fires
`console.error` on every `resolver.write.rejected { reason: "clobbered" }`
whose fact's schema meta carries any of the tags in `irreversibleTags`
(default: `["money", "pii", "irreversible"]`) OR whose resolver is
listed in `irreversibleResolvers`. The two filters OR — use whichever
matches how irreversibility is modeled in your system (fact tags when
the trigger surface is the right anchor, resolver IDs when the side
effect itself is what makes it irreversible). Replace the `onAlert`
callback to route to PagerDuty / Slack / Sentry / your SIEM of choice.
The audit ledger already records every clobber; the plugin separates
"noise" from "page an engineer NOW" without consumer wiring.

For long-running clobber bursts past the engine's per-resolver
rate-limit cap (10 per-write events per resolver instance), set
`onSummary` to receive the aggregated summary event with the dropped
count. The plugin only surfaces summaries when the resolver is in
`irreversibleResolvers` or has previously fired `onAlert` in the
session — so SIEM keeps telemetry on resolvers that have proven they
touch irreversible state, without flooding on noise resolvers.

The event is a discriminated union on `kind`: branch on it before reading
the arm-specific fields.

```ts
system.observe((e) => {
  if (e.type === "resolver.write.rejected") {
    if (e.kind === "summary") {
      console.warn(
        `[rejected] ${e.resolver}: ${e.dropped} further writes dropped (rate-limited)`,
      );
    } else {
      console.warn(
        `[rejected] ${e.resolver} dropped ${e.fact}: ` +
          `expected=${JSON.stringify(e.expected)} actual=${JSON.stringify(e.actual)}`,
      );
    }
  }
});
```

The `"summary"` arm is the per-resolver suppression summary – emitted once
when a single resolver instance exceeds the per-instance write-rejection cap
(10), with `dropped` reporting how many per-write events were suppressed.
`fact`/`expected`/`actual` exist only on the `"rejection"` arm.

The same event is delivered to plugins through the `onResolverWriteRejected`
hook:

```ts
type ResolverWriteRejected =
  | {
      kind: "rejection";
      resolver: string;
      req: RequirementWithId;
      reason: "clobbered";
      fact: string;
      expected: unknown;
      actual: unknown;
    }
  | {
      kind: "summary";
      resolver: string;
      req: RequirementWithId;
      reason: "clobbered";
      dropped: number;
    };

interface Plugin {
  onResolverWriteRejected?: (event: ResolverWriteRejected) => void;
}
```

The plugin hook payload uses `req: RequirementWithId` (carrying the full
requirement object, including `req.id`) while the observation event
payload uses `requirementId: string` (the id alone). The two differ
deliberately: observation events stream to many observers and ship the
minimal id; the plugin hook fires on a single trusted backend and
carries the full requirement so a plugin can read `req.fromConstraint`,
`req.type`, etc. without a separate lookup.

Devtools and the logging plugin handle this event by default.

## Single-process scope (v1.5)

The clobber detection described in this RFC uses an in-memory `Map` per
process (the `expected` map inside `createBoundFacts`). It guards against
sibling resolvers in the same reconcile tick and out-of-band event mutations
within the same process – that's the only race surface a single-process
Directive runtime has.

`abortOn` is a per-process Map. In multi-tab same-origin scenarios with a
shared backing store (e.g., IndexedDB via `BroadcastChannel`), each tab
has its own clobber detection – cross-tab writes are not caught. For
multi-tab safety, serialize writes through a single coordinator tab or
wait for v2's distributed `AbortDetector`.

Multi-process Directive (planned v2) will introduce a `AbortDetector`
interface to abstract the per-fact value lookup. Single-process
implementations will plug into the same surface today's `createBoundFacts`
uses internally – no resolver-author-visible change. Distributed
implementations (Redis, Postgres advisory locks, durable execution
backends) will satisfy the same interface so the binding semantics
carry across processes. Architectural design is deferred until the
v2 cross-process story lands.

## Naming history

The constraint-binding field was originally named `owns:`. The semantic
was clear once you understood it (per-fact compare-and-swap on snapshot,
write-drop on mismatch) but the name pointed the wrong way: `owns:` reads
as "this resolver asserts ownership of these facts," when the runtime
actually enforces "this resolver yields when these facts change."

Renamed to `abortOn:` on 2026-06-16 (`@directive-run/core` v1.22.x):
verb-first, accurate to the mechanism, reads aloud as "abort on changes
to these facts." Same semantics, same audit event payload
(`resolver.write.rejected { reason: "clobbered" }` is unchanged). Old
references to `owns:` in shipped issues and blog posts are preserved as
the historical record.
