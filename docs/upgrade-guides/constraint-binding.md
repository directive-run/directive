# Upgrade Guide: Resolver Constraint-Binding (`owns`)

**RFC-0003.** Available in `@directive-run/core` ≥ next minor.

## TL;DR

A resolver fires from a constraint, does async work, then writes a fact in its
tail. While it was mid-`await`, an event changed that fact. The resolver's tail
then silently overwrites what the event wrote.

Declare the facts the resolver **owns** and Directive drops the clobbering
write for you — while leaving the resolver's other writes alone:

```ts
constraints: {
  mutate: {
    when: (f) => f.status === "mutating",
    require: { type: "EXECUTE_ACTION" },
    owns: ["status"], // <-- the resolver owns `status`
  },
}
```

Omit `owns` (the default) and every write lands — current behavior.

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

`owns` replaces that boilerplate — and, unlike a blanket guard, it is precise:
it protects *only* the facts you name.

## How it works

`owns` lists the facts the resolver owns. For each owned fact the
binding remembers the value the resolver last wrote or started with. A write
to an owned fact:

- **lands** if the fact still holds that value — nobody else wrote it;
- **is dropped** (and `ctx.signal` is aborted) if the fact's live value
  differs — an event or another resolver changed it. That fact is then
  locked dropped for the rest of the invocation.

Writes to any fact **not** listed always land. The constraint's `when()`
predicate is never consulted by the binding.

## Before / after

**Before** — manual guards, easy to miss, and they have to be surgical:

```ts
resolve: async (_req, ctx) => {
  try {
    const result = await mutate();
    ctx.facts.lastResult = result;                       // data — keep
    if (ctx.facts.status === "mutating")                 // ❌ forget this and
      ctx.facts.status = "playing";                      //    you clobber `left`
  } catch {
    if (ctx.facts.status === "mutating")
      ctx.facts.status = "rolled-back";
  }
}
```

**After** — declare the owned fact, write plainly:

```ts
// constraint: owns: ["status"]
resolve: async (_req, ctx) => {
  try {
    const result = await mutate();
    ctx.facts.lastResult = result;   // data — always lands
    ctx.facts.status = "playing";    // owned — dropped if `status` was clobbered
  } catch {
    ctx.facts.status = "rolled-back"; // owned — dropped too
  }
}
```

`lastResult` lands either way — the async work succeeded, the data is real.
Only the owned `status` write is clobber-checked. Optionally bail early:

```ts
const result = await mutate();
ctx.facts.lastResult = result;
if (ctx.signal.aborted) return; // an owned write was already dropped
ctx.facts.status = "playing";
```

## Choosing the fields

Name the facts the resolver re-asserts in its tail that an event could change
out from under it — the "phase" facts (`status`, `phase`, `mode`). This is
almost always a single fact.

**Do not** list the data facts the resolver produces (`lastResult`,
`callHistory`, `winRecord`). Those should land regardless — that is the whole
point of per-fact binding.

## Notes

### Resolvers are not cancelled on requirement removal

Normally the engine cancels an in-flight resolver when its requirement goes
away (the constraint flipped false). A **bound** resolver is exempt — it runs
to completion so its data writes land; the binding drops only the owned-fact
clobber. A bound resolver's `ctx.signal` is aborted only by a dropped owned
write, an explicit `cancel()`, or a timeout.

### Async constraints

Not supported. The binding snapshots the owned facts when the resolver is
dispatched; an async constraint `await`s between predicate evaluation and
dispatch, so an event could move an owned fact before the snapshot is taken.
`owns` on an async constraint is ignored (dev-mode warning).

### Runtime async detection

A function `when` that **returns a Promise** is promoted to async at runtime
even if you did not set `async: true`. That promotion silently disables the
`owns` binding for that constraint — the engine logs:

> `[Directive] constraint '<id>': owns binding disabled because when() returned a Promise — convert to a synchronous when, mark the constraint async: true and accept the binding being off, or use a data-form when (always sync).`

The fix is one of:

1. Convert the `when` to a synchronous predicate (move the async work to a
   derivation that watches the dependency it would have `await`ed).
2. Use a **data-form `when`** — data predicates are structurally sync and the
   binding works.
3. Mark the constraint `async: true` explicitly if you genuinely need an async
   predicate and accept that the binding will be off.

### `callOne()` and out-of-band invocations

No-op. `callOne` has no source constraint, so there is nothing to bind.

### Mixed-source batches

No-op. A batch resolver fed by multiple constraints has no single owner;
same-source batches are bound normally.

### One-shot per fact

Once an owned write is dropped, further writes to *that fact* are dropped for
the rest of the invocation — even if the fact transiently returns to its
expected value. Writes to other owned facts are unaffected.

### ABA

The check is value-based. If an external writer changes an owned fact and then
changes it back to the resolver's expected value before the resolver writes,
no clobber is detected — correctly: the external change netted to nothing.
A clobber that matters (an event moving a fact to a terminal value and leaving
it there) is always caught.

## Migrating from `bind: 'auto'`

The reverted v1 used `bind: 'auto'` and gated every write by re-evaluating
`when()`. Replace it:

```diff
- bind: 'auto',
+ owns: ['status'],
```

Pick the fact(s) the resolver re-asserts in its tail. No change to `when()`.

## Observing clobbers in v1.5

When the binding drops an owned-fact write, Directive emits a
`resolver.clobber` observation event so you can surface the drop in tests,
devtools, or production logging:

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

The same event is delivered to plugins through the `onResolverClobber` hook
— devtools and the logging plugin handle it by default. See
[RFC-0003](../rfcs/0003-resolver-constraint-binding.md#observing-clobbers)
for the full event surface.
