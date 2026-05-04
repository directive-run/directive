# Upgrade Guide: Resolver Constraint-Binding (`bind: 'auto'`)

**RFC-1.** Available in `@directive-run/core` ≥ next minor.

## TL;DR

A resolver fires from a constraint whose `when` predicate is true. While
the resolver is mid-`await`, an event flips the predicate to false. The
resolver's tail then writes to a fact and silently overwrites whatever
the event just wrote.

Set `bind: 'auto'` on the constraint and Directive will drop those late
writes for you, and abort the resolver's signal so you can early-exit.

```ts
constraints: {
  mutate: {
    when: (f) => f.status === "mutating",
    require: { type: "EXECUTE_ACTION" },
    bind: "auto", // <-- opt in
  },
}
```

Default is `bind: 'none'` — existing code keeps the current behavior.

## The bug this fixes

The canonical Minglingo Phase A bug, generalized:

```ts
// status: "idle" | "mutating" | "playing" | "left"
// constraint:
//   when: (f) => f.status === "mutating"
//   require: { type: "EXECUTE_ACTION" }

resolvers: {
  execute: {
    requirement: "EXECUTE_ACTION",
    resolve: async (_req, ctx) => {
      ctx.facts.progress = 0;
      await mutate();          // <-- await
      ctx.facts.status = "playing"; // <-- the tail write
    },
  },
}
```

If a `forceLeft` event sets `status = "left"` between the await
resolving and the tail running, the tail's `status = "playing"` clobbers
the user's intent. The user is now back in a stale state.

The naive defensive pattern is to gate every post-await write on the
fact you care about:

```ts
await mutate();
if (ctx.facts.status === "mutating") {
  ctx.facts.status = "playing";
}
```

That's a per-write boilerplate burden that scales linearly with mutation
sites — and is easy to forget in a recovery branch or a rare retry path.

## Before / after

**Before** — manual gates, easy to miss:

```ts
constraints: {
  mutate: { when: (f) => f.status === "mutating", require: { type: "EXECUTE_ACTION" } },
}
resolvers: {
  execute: {
    requirement: "EXECUTE_ACTION",
    resolve: async (_req, ctx) => {
      ctx.facts.progress = 0;
      try {
        await mutate();
        // ❌ forget this guard and you clobber an event-driven `left` status:
        if (ctx.facts.status === "mutating") ctx.facts.status = "playing";
      } catch {
        if (ctx.facts.status === "mutating") ctx.facts.status = "rolled-back";
      }
    },
  },
}
```

**After** — declarative, single line:

```ts
constraints: {
  mutate: {
    when: (f) => f.status === "mutating",
    require: { type: "EXECUTE_ACTION" },
    bind: "auto", // ✅
  },
}
resolvers: {
  execute: {
    requirement: "EXECUTE_ACTION",
    resolve: async (_req, ctx) => {
      ctx.facts.progress = 0;
      try {
        await mutate();
        ctx.facts.status = "playing"; // dropped automatically if status flipped
      } catch {
        ctx.facts.status = "rolled-back"; // dropped automatically too
      }
    },
  },
}
```

Optionally short-circuit on the abort signal to skip expensive
post-await work:

```ts
await mutate();
if (ctx.signal.aborted) return; // binding deactivated → bail early
ctx.facts.status = "playing";
```

## When to use `bind: 'auto'` vs leave as `'none'`

Reach for `bind: 'auto'` when:

- The constraint encodes a **transient operation phase** (`status === 'mutating'`,
  `phase === 'submitting'`, `mode === 'editing'`) and external events can
  abort that phase.
- The resolver does **stateful tail writes** that are only correct while
  the constraint is active.
- The cost of a late clobber is a **stale UI state** the user has to
  manually recover from.

Leave at `'none'` (default) when:

- The constraint is a **steady-state derivation** (`isOnline`,
  `hasPermission`) — the resolver's writes are valid regardless of any
  flip.
- The resolver is **idempotent** and the constraint will simply re-fire
  if it flips back true.
- You want explicit control over which writes are conditional.

## Edge cases

### Async constraints

Forbidden. `bind: 'auto'` requires a synchronous `when()` predicate
because the binding checker re-evaluates `when()` on every fact write.
Async predicates would force every write to await, which is unsound and
prohibitively slow.

Setting `bind: 'auto'` on `async: true` constraints logs a dev-mode
warning and is treated as `'none'`:

```
[Directive] Constraint "fetchUserStatus" has bind: 'auto' but is async.
Binding is disabled — async predicates cannot be re-evaluated synchronously
on every fact write.
```

### `manager.callOne()` and out-of-band invocations

No-op. `callOne` has no source constraint, so binding cannot determine a
predicate to gate against. Writes go through unconditionally.

```ts
// Even if the equivalent constraint is currently false:
await sys.resolvers.callOne("execute", { type: "EXECUTE_ACTION" });
// → all writes land
```

### Pre-await synchronous writes

Pass through. The constraint was true when the resolver fired (otherwise
the resolver wouldn't have been dispatched). Synchronous writes before
the first `await` see the same predicate state and pass.

### Mixed-source batches

Fall back to no binding. When a single batch resolver receives
requirements from multiple constraints, the binding's predicate is
ambiguous. Same-source batches are bound normally.

### One-shot per invocation

Binding is **one-shot**: once the predicate flips false during a write
attempt, the binding stays deactivated even if `when()` would later
flip back to true mid-resolver. This prevents zombie writes from
"resurrecting" a stale intent after the user has moved past it.

### Error-recovery branches

Recovery branches are bound too. If your `catch` block writes facts
expecting the constraint to still be active, those writes are dropped
when the constraint has flipped:

```ts
try {
  await mutate();
} catch {
  ctx.facts.status = "rolled-back"; // dropped if `mutating` is no longer true
}
```

This is usually what you want — the user has already moved on, so the
rollback is moot.

## Companion: `useFactWithDefault` (RFC-2)

If you're migrating from the `useFact(sys, k) ?? factory()` pattern in
React, swap to `useFactWithDefault` for stable identity. See
`@directive-run/react` exports.

```ts
// Before — fresh identity every render where fact is null:
const marked = useFact(sys, "markedCells") ?? deps.initializeMarkedCells();

// After — stable identity, factory runs once per system:
const marked = useFactWithDefault(sys, "markedCells", () =>
  deps.initializeMarkedCells(),
);
```

## Implementation notes

- The bound `ctx.facts` is a `Proxy` wrapper around the engine's facts
  proxy. Reads pass through; writes consult the binding before
  delegating.
- Predicate evaluation runs against the **pre-write** snapshot. If the
  resolver itself writes a value that would flip `when()` false, the
  write still lands (you cannot lock yourself out by writing).
- The `AbortController` is shared with the resolver's existing
  cancellation channel — if the resolver was already aborted (timeout,
  cancel(), etc.), binding is a moot wrapper.
- Constraint definitions: `bind?: 'none' | 'auto'`. The literal type is
  exported as `ConstraintBindMode` from `@directive-run/core`.
