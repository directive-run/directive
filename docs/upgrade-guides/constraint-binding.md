# Upgrade Guide: Resolver Constraint-Binding (`abortOn`)

**RFC-0003.** Available in `@directive-run/core` ≥ v1.22.0. Renamed from
`owns:` to `abortOn:` on 2026-06-16.

## TL;DR

A resolver fires from a constraint, does async work, then writes a fact in its
tail. While it was mid-`await`, an event changed that fact. The resolver's tail
then silently overwrites what the event wrote.

Declare the facts the resolver **aborts on** when changed mid-flight and
Directive drops the clobbering write for you – while leaving the resolver's
other writes alone:

```ts
constraints: {
  mutate: {
    when: (f) => f.status === "mutating",
    require: { type: "EXECUTE_ACTION" },
    abortOn: ["status"], // <-- abort if `status` changes mid-flight
  },
}
```

Omit `abortOn` (the default) and every write lands – current behavior.

`abortOn:` is verb-first by design: reads aloud as "abort on changes to
these facts." It does **not** prevent other writers from touching the
listed facts; it only protects *this* resolver from writing stale data
over a fresher value.

## The bug this fixes

```ts
// status: "idle" | "mutating" | "playing" | "left"
resolvers: {
  execute: {
    requirement: "EXECUTE_ACTION",
    resolve: async (_req, ctx) => {
      await mutate();                 // <-- await
      ctx.facts.status = "playing";   // <-- the tail write
    },
  },
}
```

If a `forceLeft` event sets `status = "left"` between the await resolving and
the tail running, the tail's `status = "playing"` clobbers the user's intent.

The naive defense is a manual guard at every mutation site:

```ts
await mutate();
if (ctx.facts.status === "mutating") {
  ctx.facts.status = "playing";
}
```

`abortOn` replaces that boilerplate – and, unlike a blanket guard, it is
precise: it protects *only* the facts you name.

## How it works

`abortOn` lists the facts this resolver aborts on when changed mid-flight.
For each listed fact the binding remembers the value the resolver last wrote
or started with. A write to a listed fact:

- **lands** if the fact still holds that value – nobody else wrote it;
- **is dropped** (and `ctx.signal` is aborted) if the fact's live value
  differs – an event or another resolver changed it. That fact is then
  locked dropped for the rest of the invocation.

Writes to any fact **not** listed always land. The constraint's `when()`
predicate is never consulted by the binding.

## Before / after

**Before** – manual guards, easy to miss, and they have to be surgical:

```ts
resolve: async (_req, ctx) => {
  try {
    const result = await mutate();
    ctx.facts.lastResult = result;                       // data – keep
    if (ctx.facts.status === "mutating")                 // ❌ forget this and
      ctx.facts.status = "playing";                      //    you clobber `left`
  } catch {
    if (ctx.facts.status === "mutating")
      ctx.facts.status = "rolled-back";
  }
}
```

**After** – declare the abort-binding, write plainly:

```ts
// constraint: abortOn: ["status"]
resolve: async (_req, ctx) => {
  try {
    const result = await mutate();
    ctx.facts.lastResult = result;   // data – always lands
    ctx.facts.status = "playing";    // abort-bound – dropped if `status` was clobbered
  } catch {
    ctx.facts.status = "rolled-back"; // abort-bound – dropped too
  }
}
```

`lastResult` lands either way – the async work succeeded, the data is real.
Only the abort-bound `status` write is clobber-checked. Optionally bail
early:

```ts
const result = await mutate();
ctx.facts.lastResult = result;
if (ctx.signal.aborted) return; // an abort-bound write was already dropped
ctx.facts.status = "playing";
```

## Choosing the fields

Name the facts the resolver re-asserts in its tail that an event could change
out from under it – the "phase" facts (`status`, `phase`, `mode`). This is
almost always a single fact.

**Do not** list the data facts the resolver produces (`lastResult`,
`callHistory`, `winRecord`). Those should land regardless – that is the whole
point of per-fact binding.

## Notes

### Resolvers are not cancelled on requirement removal

Normally the engine cancels an in-flight resolver when its requirement goes
away (the constraint flipped false). A **bound** resolver is exempt – it runs
to completion so its data writes land; the binding drops only the
abort-bound clobber. A bound resolver's `ctx.signal` is aborted only by a
dropped abort-bound write, an explicit `cancel()`, or a timeout.

### Async constraints

Not supported. The binding snapshots the listed facts when the resolver is
dispatched; an async constraint `await`s between predicate evaluation and
dispatch, so an event could move a listed fact before the snapshot is taken.
`abortOn` on an async constraint is ignored (dev-mode warning).

### Runtime async detection

A function `when` that **returns a Promise** is promoted to async at runtime
even if you did not set `async: true`. That promotion silently disables the
`abortOn` binding for that constraint – the engine logs:

> `[Directive] constraint '<id>': abortOn binding disabled because when() returned a Promise – convert to a synchronous when, mark the constraint async: true and accept the binding being off, or use a data-form when (always sync).`

The fix is one of:

1. Convert the `when` to a synchronous predicate (move the async work to a
   derivation that watches the dependency it would have `await`ed).
2. Use a **data-form `when`** – data predicates are structurally sync and the
   binding works.
3. Mark the constraint `async: true` explicitly if you genuinely need an async
   predicate and accept that the binding will be off.

### `callOne()` and out-of-band invocations

No-op. `callOne` has no source constraint, so there is nothing to bind.

### Mixed-source batches

No-op. A batch resolver fed by multiple constraints has no single source;
same-source batches are bound normally.

### One-shot per fact

Once an abort-bound write is dropped, further writes to *that fact* are
dropped for the rest of the invocation – even if the fact transiently
returns to its expected value. Writes to other listed facts are unaffected.

### ABA

The check is value-based. If an external writer changes a listed fact and
then changes it back to the resolver's expected value before the resolver
writes, no clobber is detected – correctly: the external change netted to
nothing. A clobber that matters (an event moving a fact to a terminal value
and leaving it there) is always caught.

## Migrating from `bind: 'auto'`

The reverted v1 used `bind: 'auto'` and gated every write by re-evaluating
`when()`. Replace it:

```diff
- bind: 'auto',
+ abortOn: ['status'],
```

Pick the fact(s) the resolver re-asserts in its tail. No change to `when()`.

## Migrating from `owns:` (v1.5 – v1.21)

The constraint-binding field was originally named `owns:` (introduced in
v1.5 alongside RFC 0003). Renamed to `abortOn:` in v1.22.0 to reflect the
actual semantics – the resolver yields when listed facts change; it does
not assert ownership. Same engine, clearer name.

### Vocabulary in one sentence

The `abortOn:` config (declaration) causes the engine to fire a
`resolver.write.rejected` event with `reason: "clobbered"` (runtime
discriminator) whenever a listed fact changed mid-flight. **Three nouns,
one concept** – kept distinct deliberately so production log queries on
`"clobbered"` keep working while the source-code vocabulary updates to
`abortOn:`.

### What renamed

```diff
- owns: ['status'],
+ abortOn: ['status'],
```

Also renamed for consistency (mechanical replacements – no semantic
change):

- `doctor.checkOwns()` → `doctor.checkAbortOn()`
- `CheckOwnsResult` / `CheckOwnsFinding` types → `CheckAbortOnResult` /
  `CheckAbortOnFinding`
- `DoctorConstraintOwnsConflict` interface → `DoctorConstraintAbortOnConflict`
- `system.inspect().constraints[].owns` → `.abortOn`
- The `source` discriminant on doctor findings: `source: "owns"` →
  `source: "abortOn"`

### What did NOT rename

- Audit event payload `resolver.write.rejected { reason: "clobbered" }` –
  unchanged. Grafana / Splunk / Datadog queries keyed on `"clobbered"` keep
  firing.
- `onResolverWriteRejected` plugin hook signature – unchanged.
- Internal `ConstraintBindingInfo.fields` runtime shape – unchanged.
- Reserved-key validator behaviour – `__proto__`, `constructor`,
  `prototype`, `$-prefixed` keys still throw at registration time, just
  with the new field name in the error message.

### Helper functions typed over `string[]`

The field type stays `readonly string[]`. Consumer helper functions like
`function validateBindingFields(fields: readonly string[]): void` keep
working without changes – only the field NAME on the constraint
definition moved.

### Internal runbooks searching the source tree

If your IR runbook or SRE playbook says "when you see
`resolver.write.rejected`, grep the repo for `owns:` matching this fact,"
update the grep target to `abortOn:`. The event payload is unchanged but
the source-side vocabulary is not.

### CI grep gates

If your security CI or pre-deploy lint greps for `checkOwns(`,
`CheckOwnsResult`, `validateOwnsKeys`, or `DoctorConstraintOwnsConflict`,
update to `checkAbortOn(`, `CheckAbortOnResult`, `validateAbortOnKeys`,
and `DoctorConstraintAbortOnConflict`. The renamed methods do not export
under the old names; gates grepping for the old names will silently
false-pass.

### Stored `system.inspect()` snapshots (SOC2 evidence, audit captures)

If your compliance pipeline persists `system.inspect().constraints[]`
into a long-term evidence store, captures taken before v1.22.0 hold
`owns:` and captures taken after hold `abortOn:`. The field type is
identical (`readonly string[]`). Record the `@directive-run/core`
version alongside the snapshot so the field shape is unambiguous on
replay.

No RoPA / Privacy Notice update is required – the rename is an internal
field-shape change. The "processed data" the audit ledger persists (fact
paths, `reason` discriminator, `expected` / `actual` values) is
unchanged.

## Migrating from `$matches: string` (pre-v1.5)

Before v1.5, the `$matches` operator accepted a string operand and
compiled it to a `RegExp` at runtime. v1.5 requires a `RegExp` literal –
a string operand throws at evaluation. The change is type-safe (flags
are now explicit) and ReDoS-aware (no implicit `new RegExp` over
arbitrary strings).

```ts
// Before (pre-v1.5, ran at runtime)
when: { name: { $matches: "^foo" } }

// After (v1.5+, type-safe and ReDoS-aware)
when: { name: { $matches: /^foo/ } }
```

If you persisted predicate specs to storage before v1.5, walk them at
load time and convert the string operand to a `RegExp`:

```ts
if (typeof spec.$matches === "string") {
  spec.$matches = new RegExp(spec.$matches);
}
```

Caution: an attacker-supplied pattern is still subject to catastrophic
backtracking. Keep `$matches` for code-form predicates, or run an
untrusted pattern through a ReDoS linter before constructing the
`RegExp`. See the
[RFC 0004 – Security: untrusted predicate sources](../rfcs/0004-data-configuration-triggers.md#security-untrusted-predicate-sources)
section.

## Observing rejected writes

When the binding drops an abort-bound write, Directive emits a
`resolver.write.rejected` observation event with `reason: "clobbered"` so
you can surface the drop in tests, devtools, or production logging:

The event is a discriminated union on `kind` – branch on it before reading
the arm-specific fields:

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

The same event is delivered to plugins through the `onResolverWriteRejected`
hook – devtools and the logging plugin handle it by default. The `reason`
field keeps the event backend-neutral; the `"summary"` arm is the
per-resolver suppression summary. See
[RFC-0003](../rfcs/0003-resolver-constraint-binding.md#observing-rejected-writes)
for the full event surface.
