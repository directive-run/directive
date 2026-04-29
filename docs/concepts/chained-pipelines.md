# Chained Pipelines & `ctx.requeue()`

> Status: stable
> Audience: authors writing constraint-driven flows that intentionally re-fire the same constraint with updated state.

## TL;DR

Directive's reconciliation engine **suppresses** re-fires of the same constraint within a single `flushAsync` window. If a resolver writes facts that cause its owning constraint's `when` to re-evaluate `true` and emit the **same requirement ID**, the engine treats the requirement as unchanged across reconciles and the resolver does **not** run again.

This is intentional. It prevents accidental infinite loops in shipped user code.

When you genuinely want a chain — the resolver knowingly produces more work, writes the next step, and wants its constraint re-evaluated — opt in with `ctx.requeue()`:

```ts
resolve: async (req, ctx) => {
  if (ctx.facts.pendingAction?.kind === "first") {
    await doFirst();
    ctx.facts.pendingAction = { kind: "second" };
    ctx.requeue(); // re-fire the same constraint
    return;
  }
  await doSecond();
  ctx.facts.status = "done";
}
```

## The default behavior (and why)

Directive runs constraints, builds a `RequirementSet`, diffs it against the previous reconcile's set, and dispatches resolvers only for **added** requirements. Two requirements with the same identity string are considered the same requirement; identity defaults to `${type}:${stableJson(otherProps)}`, with an optional custom `key()` per resolver.

When a resolver mutates facts that flip its constraint's `when` from `true` → `false` → `true` within the resolver body, the constraint emits a requirement with **the same identity** as before. The diff sees no change, so no re-dispatch happens.

Without this suppression, a one-line bug like

```ts
constraints: {
  bumpCount: {
    when: (f) => f.tick < 100,
    require: { type: "TICK" },
  },
},
resolvers: {
  tick: {
    requirement: "TICK",
    resolve: async (_req, ctx) => { ctx.facts.tick += 1; },
  },
},
```

would burn a CPU core. The suppression makes Directive safe by default — same-constraint re-fires are an explicit opt-in, not an accident.

## When to use `ctx.requeue()`

Use it when:

- You're modeling an explicit multi-step pipeline (e.g. an MFA flow, a download/transform/upload chain, a retry-then-finalize sequence).
- Each step writes the next `pendingAction` (or analogous discriminator) and you want the constraint to be re-evaluated immediately, not on the next external event.
- You've consciously decided not to model the steps as separate constraints.

Calling `ctx.requeue()` opts **only the current invocation** out of suppression. The next reconciliation pass treats the constraint's still-emitted requirement as a fresh addition and re-dispatches the resolver.

## When NOT to use `ctx.requeue()`

Most resolvers should not requeue. Prefer:

1. **Separate constraints**, one per step:

   ```ts
   constraints: {
     handleFirst: {
       when: (f) => f.pendingAction?.kind === "first",
       require: { type: "PROCESS_FIRST" },
     },
     handleSecond: {
       when: (f) => f.pendingAction?.kind === "second",
       require: { type: "PROCESS_SECOND" },
     },
   }
   ```

   Each step is its own resolver, and each has a distinct requirement type — so the diff naturally treats them as different requirements. No requeue needed; chains compose cleanly through the standard reconcile loop.

2. **Distinct mutation kinds** that produce distinct requirement IDs:

   ```ts
   constraints: {
     process: {
       when: (f) => f.pendingAction != null,
       require: (f) => ({ type: "PROCESS", kind: f.pendingAction.kind }),
     },
   }
   ```

   The `kind` becomes part of the identity string, so each step is a different requirement. The default suppression still applies — but it suppresses *only* the exact kind you've already handled, not the chain itself.

The `requeue()` escape hatch exists for cases where neither of those refactors fits. If you find yourself reaching for it routinely, the underlying model probably wants more constraints rather than more requeues.

## Semantics & guarantees

- **Scope:** A `requeue()` call applies to the calling resolver's owning requirement(s). For batch resolvers, it applies to **all** requirements in the batch.
- **One-shot:** Each `requeue()` opts out of suppression for **one** subsequent reconcile pass. If the resolver runs again and wants another re-fire, it must call `requeue()` again.
- **No infinite-loop guarantee:** If the resolver's facts no longer satisfy the constraint's `when`, the constraint won't emit the requirement, and no re-fire happens — even if `requeue()` was called. Directive's existing reconcile-depth guard (`MAX_RECONCILE_DEPTH = 50`) is still in effect as a final safety net for buggy chains, but the recommended pattern is to terminate the chain by writing the facts that make `when` return `false`.
- **Backwards compatible:** Resolvers that don't call `requeue()` see the same suppression behavior as before. Existing flows are unaffected.

## Diagnostic hint

If you suspect a chain isn't firing and you don't see "second" / "next-step" log lines, the cause is almost always the default suppression. Check whether the second invocation would emit the same requirement ID as the first (default identity = `type` + stable JSON of other props). If yes, either:

- Add `ctx.requeue()` if a chain is what you want, or
- Make the second step's requirement distinct (different `type` or `kind`), or
- Split into separate constraints.

## See also

- `MIGRATION_FEEDBACK.md` Item 23 — the cycle-43 authMachine MFA flow that motivated this.
- `ResolverContext` JSDoc in `@directive-run/core` — full API contract.
