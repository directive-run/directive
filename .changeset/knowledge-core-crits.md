---
"@directive-run/knowledge": patch
---

Fix the five core-CRIT knowledge issues flagged by the v1.14 AE audit.

**core/testing.md** rewritten against the actual `createTestSystem`
overload — options-object only (`{ module: ... }` or `{ modules: ... }`),
no separate `createTestSystemFromModules` factory, mocks keyed by
type under `mocks.resolvers: { TYPE: { resolve: (req, context) => ... } }`,
and assertion helpers exposed as methods on the test-system instance
(`system.assertRequirement`, `system.assertFactSet`,
`system.assertResolverCalled`, `system.assertFactChanges`) rather
than as top-level imports. Inspect results now reference the real
`inspection.unmet` / `inspection.inflight` accessors instead of the
fictitious `inspection.requirements` field.

**core/constraints.md** changes the very first "basic anatomy"
example to use the function form of `require:` so that `facts.userId`
is actually in scope. The previous static-object example with a bare
`facts.userId` reference would not compile.

**core/multi-module.md** and **core/anti-patterns.md** reconciled on
`dispatch()`: the string-keyed two-argument form
(`system.dispatch("login", payload)`) does not exist, but the
single-arg object form (`system.dispatch({ type: "login", token })`)
is supported and is the right escape hatch for forwarding
programmatically-built events. The events accessor remains the
preferred path; both files now say the same thing.

**core/naming.md** rewrites the "Always Use Braces" section to stop
flip-flopping between WRONG and "wait actually". The rule is now
stated plainly: arrow-expression bodies (single-line derivations,
predicates, computed requirements) stay concise; control-flow blocks
(`if` / `for` / `while`) always use braces.

No code changes; no API changes; content fix to the published
knowledge package.
