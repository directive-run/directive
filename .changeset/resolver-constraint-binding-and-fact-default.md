---
"@directive-run/core": minor
"@directive-run/react": minor
---

feat: resolver constraint-binding (`bind: 'auto'`) + `useFactWithDefault`

Adds opt-in resolver-constraint-binding that auto-rejects fact writes from
resolvers whose triggering constraint has flipped to false. Eliminates the
executor-tail-clobber footgun (event-driven terminal status getting
overwritten by an in-flight resolver's tail). Default `bind: 'none'`
preserves existing behavior; consumers opt in per-constraint.

Also adds `useFactWithDefault(sys, key, factory)` for stable-identity
nullable-fact fallbacks. Replaces the `useFact(sys, k) ?? factory()`
pattern that breaks downstream memoization.

**RFC-1 — Resolver constraint-binding (`@directive-run/core`):**

```ts
constraints: {
  mutate: {
    when: (f) => f.status === "mutating",
    require: { type: "EXECUTE_ACTION" },
    bind: "auto", // NEW — default 'none'
  },
}
```

Semantics:
- Each fact write through `ctx.facts` re-evaluates the constraint's
  `when()` predicate against the pre-write snapshot.
- If the predicate returns `false`, the write is dropped, the resolver's
  `AbortController` is aborted, and `ctx.signal.aborted` becomes `true`
  on the next checkpoint.
- One-shot per resolver invocation: once flipped false, the binding stays
  deactivated even if `when()` would later flip back to true mid-resolver.
- Forbidden on async constraints (re-evaluating async predicates on every
  write would be unsound). Async + `bind: 'auto'` logs a dev warning and
  is treated as `'none'`.
- No-op for `manager.callOne()` and out-of-band invocations (no source
  constraint).
- Mixed-source batches fall back to no binding (predicate would be
  ambiguous).

**RFC-2 — `useFactWithDefault` (`@directive-run/react`):**

```ts
const markedCells = useFactWithDefault(
  sys,
  "markedCells",
  () => deps.initializeMarkedCells(),
);
```

The factory runs at most once per system instance. While the fact is
`null`/`undefined`, every render returns the same cached identity. When
the fact transitions to non-null, that value is returned. If the fact
later returns to null, the cached factory result is reused (factory does
NOT run again). Swapping the `system` argument re-runs the factory on the
new system.

**Tests added (+21):** 14 in core (12 unit-level binding tests in
`resolvers.test.ts` + 2 engine-level integration tests in `engine.test.ts`)
+ 7 in react (`useFactWithDefault.test.tsx`). 0 regressions in the existing
4091-test suite.

Migration guide: `docs/upgrade-guides/constraint-binding.md` (added).
