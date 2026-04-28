# Directive — improvements + gaps surfaced from 22 XState→Directive cycles

Captured live during Workstream-B migrations of Minglingo's
state-machine layer. Each item is a real friction point, with the
cycle number where it bit, and a concrete proposal where one has
crystallized.

---

## P0 — Blocked or surprised a session for >1 hour

### 1. Resolver-flush test harness is undocumented (B-Cycle-2)

The canonical way to drain a constraint→resolver chain in a vitest
test isn't on the docs site. Pulled from `core/utils/testing.ts` after
hours of debug:

```ts
async function flushAsync() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
```

**Proposal:** export `flushAsync` (or `system.settle({ deep: true })`)
from `@directive-run/core/testing`. Add a "Testing async resolvers"
guide to the docs.

### 2. Date instances corrupted by fact proxy (B-Cycle-4)

Storing `tx.date: Date` in a fact and calling `tx.date.getTime()`
inside a derivation throws:
```
TypeError: Method Date.prototype.toString called on incompatible
receiver [object Date]
```
And `new Date(proxiedDate)` throws "this is not a Date." Diagnosed
empirically; not in any docs.

**Proposal (ranked):**
1. Add a `t.date()` schema type that converts Date↔ms internally.
2. At minimum, surface a runtime warning when a Date instance is
   assigned to a fact, with a docs link explaining the proxy
   incompatibility.
3. Document the workaround (`dateMs: number`) prominently.

### 3. `toEqual` on proxied facts crashes vitest's pretty-format (B-Cycle-2, B-Cycle-4)

```
TypeError: Cannot read properties of undefined (reading 'name')
  at printComplexValue (vitest pretty-format)
```
The crash hides the actual assertion failure, leading to long
debugging detours. Caused by Vitest reflecting on Directive's fact
proxy.

**Proposal:** ensure proxies expose an iterable shape that the
Vitest serializer can introspect — likely needs a `toJSON` or
`Symbol.toPrimitive` on the proxy. Even a default that serializes
to the underlying plain value would fix this.

---

## P1 — Pattern friction recurring every cycle

### 4. No first-class `after` / declarative timer

Every machine with `after: { 1000: 'next' }` requires:
- A `setTimer` dep injection.
- A `hooks.onStop` to clear it.
- Module-scoped `pendingCancel: (() => void) | null` closure.

Recurs on: B-C2, B-C5, B-C8. ~30 LOC of scaffolding per machine.

**Proposal:** ship a `t.timer({ ms })` schema primitive or a
`scheduler` resolver type that participates in causal cache + replay.
Cycle-5 spec §8 Q1 had this as an open question; the recurring tax
is real.

### 5. No first-class internal-event convention

Sequential async chains use a `status` fact as the discriminator:
the resolver writes `status = 'next'` to fire the next constraint.
Works, but the internal `status` value is mixed with externally-
observable status. We worked around with status names like
`loadingFriends`, `loadingMore`, `togglingReady`.

**Proposal:** either bless the status-as-event-bus pattern in docs,
OR introduce a `module.fire('INTERNAL_EVENT')` API that doesn't go
through the public events dispatcher.

### 6. Two-source-of-truth for resolver inputs

Cycle-2 (`inventoryMachine`) needed both `status='equipping'` AND
`pendingItemId='abc'` to fire the equip resolver, then constraint
required both with an `as string` cast. Cycle-17 (`quickMatch`),
Cycle-19 (`payoutsOnboarding`) hit similar shapes.

**Proposal:** `pending: t.discriminatedUnion({ kind: ..., payload: ... })`
or richer constraint-payload binding. Documented in the
`inventoryMachine.md §21` debt list.

### 7. Constraint side-effect ordering is implicit

When a resolver writes status to a value that triggers another
constraint, the second resolver fires "in the same flushAsync window"
(per Cycle-5's chained skipping → starting → started). Test harness
must assert TERMINAL state, never intermediate. Easy footgun:
```ts
sys.events.SKIP();
await flushAsync(); // skipping → starting → started ALL fire
expect(sys.facts.status).toBe('starting'); // ❌ FAILS — already 'started'
```
**Proposal:** docs guide on "asserting against chained pipelines."
Optional `system.settle({ until: 'idle' | 'next-yield' })` API.

---

## P2 — Quality-of-life / docs gaps

### 8. No `t.string<UnionType>()` discoverability

Cycle 1 used plain `t.string()`. Cycle 2 review surfaced
`t.string<MyStatus>()`. The narrow-string generic IS in the JSDoc
but not promoted in the getting-started examples. Adopting it
made every status fact type-safe (Cycles 6+).

**Proposal:** lead with `t.string<'a' | 'b'>()` in the docs example
for any state-machine-shaped use case.

### 9. `derive: (facts, deps) => deps.<otherDerivation>` (B-Cycle-4)

Surprise win. Saved ~25 LOC + closed an inconsistency window in
`transactionsModule` where 4 derivations duplicated filter logic.
Not visible in any of the 5 example modules I read.

**Proposal:** highlight derivation composition as a first-class
pattern. "Derived facts can consume other derived facts" deserves
its own docs page.

### 10. `nullable()` value semantics on init

Setting `f.x = null` where `f.x: t.string().nullable()` sometimes
made `f.x !== null` evaluate true downstream (B-Cycle-9 derivation
oddity). Worked around by relying on `status` fact instead of the
nullable check.

**Proposal:** investigate; possibly a proxy / strict-equality issue
specific to the nullable wrapper. May overlap with #3.

### 11. `hooks.onStop` only — no `onError` / `onUnhandled`

Cycles with multiple resolvers each individually try/catch. A
module-level `hooks.onResolverError` would let us route failures to
a single error-store fact without per-resolver scaffolding.

**Proposal:** `ModuleHooks.onResolverError?: (err, req) => void`.

### 12. Test-environment integration (`server-only` aliasing)

Every consumer with a server-marked module needs a vitest alias to
`@/test/server-only-stub.ts`. Captured in
`apps/web/vitest.config.ts`; should be a documented pattern in the
Directive testing guide.

---

## P3 — Minor / nice-to-have

### 13. Fact-proxy reassignment via helper

Inside an event handler, `f.queue = f.queue.slice(1)` works. Inside
a helper called from the handler, the same assignment also works
but it's not obvious from docs whether the proxy traps the helper-
scope mutation. Document the contract explicitly.

### 14. `system.events.X(payload)` vs `system.dispatch({type, ...payload})`

Both work; one is shown in some tests and one in others. Pick a
canonical shape.

### 15. No `vi.useFakeTimers()` compatibility

Mixing fake timers with the constraint→resolver flow is documented
to break (Cycle 2 catalog entry: "DO NOT mix `vi.useFakeTimers()`
with constraint→resolver flows"). Workaround: capture the timer
callback via a deps mock and fire it manually. This is a
test-pattern catalog item that should be the documented escape
hatch.

---

## Quick wins ranked by impact / effort

| Win | Effort | Cycles affected so far |
|---|---|---|
| Export `flushAsync` from testing helpers | 5 LOC + doc | every test harness |
| Add `t.date()` or warn on Date assignment | 30 LOC | Cycle-4, every future Date-using machine |
| Fix proxy serialization for vitest format | unknown | every test |
| Lead with `t.string<'a' \| 'b'>()` in docs | doc only | every status fact |
| Document derivation-deps composition | doc only | every multi-derivation module |
| Introduce `t.timer()` or scheduler resolver | medium | every timer-using machine (3+ so far, more coming) |
| `ModuleHooks.onResolverError` | small | every multi-resolver machine |

The two highest-leverage items by far are #1 (flushAsync export +
testing docs) and #3 (proxy/serializer fix) — together they would
have saved 4+ hours of debug time across the migration so far.
