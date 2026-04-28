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
| Document "deps inside derivations are not reactive" | doc only | C34 winValidation (canContest reading nowMs) |

The two highest-leverage items by far are #1 (flushAsync export +
testing docs) and #3 (proxy/serializer fix) — together they would
have saved 4+ hours of debug time across the migration so far.

---

## Item 16 — Derivations reading external state (e.g. clock) aren't reactive (B-Cycle-34)

In `winValidationModule`, `canContest` derivation reads `deps.nowMs()`
inside its body:

```ts
canContest: (f) =>
  isContestActive(f.contestPeriodEndsAtMs, deps.nowMs()) &&
  !f.contests.some((c) => c.contestedBy === f.currentUserId),
```

When the test ticks the clock forward (a fake `nowMs` impl), the
derivation does NOT recompute — Directive's reactive system tracks
fact dependencies, not closure-captured values. So `canContest`
returns stale `true` even though the contest period should now be
expired.

This is a real-world footgun: any derivation that reads a `Date.now()`
or random number or globalThis state will silently go stale.

**Workarounds today:**
- Promote the time to a fact: `clockMs: t.number()`. Consumer ticks
  it explicitly via an event. Derivation depends on the fact.
- Make the derivation impure (use `nowMs` only on read paths through
  a getter, not memoized).
- Don't use derivations for time-dependent values; compute on read.

**Proposal:** runtime warning when a derivation closure reads from
non-`facts` non-`derivations` arguments. Probably impossible to
detect statically; could be a doc-only "derivation purity" rule.

**Affected:** any time/clock/random derivation. Likely to bite
realtime cluster cycles (45-54) heavily — those have polling/poll-
through behavior.

---

## Item 17 — Discriminated `pendingAction` is the de-facto pattern but unclaimed (B-Cycles 23, 24, 26, 30, 33, 36, 37, 38, 40, 41)

**The pattern that emerged organically in 10 cycles:**

```ts
type PendingAction =
  | { kind: 'create'; data: Form }
  | { kind: 'delete'; id: string }
  | { kind: 'verify'; id: string };

facts: { pendingAction: t.object<PendingAction>().nullable(), status: ... }
constraint: when: f.status === 'mutating' && f.pendingAction !== null
resolver: switch (action.kind) { ... }
events: (f, payload) => { f.pendingAction = {kind, ...payload}; f.status = 'mutating'; }
```

Replaces N separate states + N separate resolvers. 10 cycles
converged on it independently. It works, but:

1. There's no first-class API for it — every cycle re-derives it.
2. Tests have to re-derive `isVerifying`-style booleans as
   derivations (`status === 'mutating' && pendingAction?.kind === 'verify'`).
3. The constraint `when` always reads `f.pendingAction !== null`
   in addition to the status — duplicate gate.
4. Cycles where mutations have non-symmetric outcomes (C34, C39)
   abandon the pattern and pay a verbosity tax instead.

**Proposal:** ship a higher-level helper:
```ts
mutator: t.mutator<PendingAction>({
  kinds: { create: { args: { data: t.object<Form>() } }, delete: ... },
  resolve: { create: async (args, ctx) => ..., ... }
})
```
The schema generates the pendingAction fact + constraint +
discriminated resolver + per-kind boolean derivations
(`isCreating`, `isDeleting`). 10× of these in the surveyed
codebase = a real abstraction worth promoting.

---

## Item 18 — `setInterval` / recurring-tick wiring has no canonical pattern (B-Cycles 5, 26, 27, 34, 35, 39)

**Recurring shape:** consumer wires `setInterval(() => sys.events.TICK(), 1000)`
while in some status, clears it on status change. Each cycle
re-implements the same React useEffect:

```ts
useEffect(() => {
  if (!sys.derive.isPending) return;
  const id = setInterval(() => sys.events.TICK(), 5000);
  return () => clearInterval(id);
}, [sys.derive.isPending]);
```

This becomes 6+ near-identical hook copies across the consumer
surface. Module is cleanly testable but the consumer pays.

**Proposal (ranked):**
1. `@directive-run/react` ships a `useTickWhile(sys, derivation, eventName, intervalMs)` hook.
2. A scheduler-resolver primitive (already proposed in Item 4) that
   takes a periodic source and emits events to a dispatcher.

---

## Item 19 — Optimistic update + rollback has a manual snapshot ceremony (B-Cycle-41)

`friendsManagementMachine` had 5 mutations that each:
1. Snapshot 3 facts (`friends`, `pendingRequests`, `sentRequests`)
   into a `previousState` object.
2. Apply optimistic mutation.
3. Resolver on success: clear `previousState`.
4. Resolver on failure: restore from `previousState`.

The XState equivalent had a per-mutation `optimisticX` action +
`rollbackOptimisticUpdate` action. Directive collapses to
1 fact + 1 resolver, but the snapshot ceremony in the event
handler is verbose:

```ts
f.previousState = {
  friends: f.friends,
  pendingRequests: f.pendingRequests,
  sentRequests: f.sentRequests,
};
f.friends = ...optimisticMutation;
```

3-fact snapshots are easy; 5+ fact snapshots get tedious. And if
a fact is added later, every snapshot site needs updating.

**Proposal:** ship `system.transaction()` or
`ctx.snapshot(['friends', 'pendingRequests', 'sentRequests'])` →
returns a restore function. Resolvers on failure call
`restore()`; on success let it fall out of scope. Removes the
3-fact-tuple boilerplate and makes "which facts are part of the
optimistic update" a single declaration.

---

## Item 20 — `Set` and `Map` proxies break silently (B-Cycle-32)

`gameCreationMachine` had `expandedSections: Set<string>` in its
context. Directive proxy doesn't trap Set methods (`add`, `delete`,
`has`) — they appear to work but the reactive system doesn't
register the change. Switching to `string[]` with
`includes`/filter restored reactivity.

Same as Item 2 (Date) but for collections. The unifying claim:
**facts must be JSON-round-trippable.** Date, Set, Map, regex,
class instances all break the proxy invisibly.

**Proposal:** runtime warning at `init` time when a non-JSON-
plain value is assigned to a fact. Either:
- Throw with a docs link explaining the JSON-roundtrip rule.
- Auto-coerce Set→array, Map→object, Date→ms with a deprecation log.

Confirmed across 4 cycles: C4 (Date), C16 (Date), C32 (Set),
C34 (Date again). This is the most-frequent-cycle limitation.

---

## Item 21 — `t.string<UnionType>()` lost on payload union types (B-Cycle-25, C28)

```ts
events: {
  UPDATE_FIELD: {
    field: t.string<keyof FormData>(),
    value: t.unknown(),
  },
}
```

`t.unknown()` was needed because `value` can be `string | number |
boolean`. There's no `t.union<string | number | boolean>()` shown
anywhere in docs, so cycles fell back to `unknown` and lost type
safety. The downstream event handler has to cast.

**Proposal:** ship `t.union<string | number | boolean>()` or
document the pattern for "polymorphic event payload."

---

## Item 22 — No first-class "spawn child module" idiom (B-Cycle-31)

`scheduleGameMachine` spawned a child `formMachine` via
`spawnChild`. The Directive port ducked it via a `formAdapter`
dep — consumer wires the form externally. Works, but:

1. There's no Directive idiom for "this module owns a sub-module's
   lifecycle."
2. Cross-module event passing requires the adapter shape, not a
   declared peer.

**Proposal:** define a `peers: { form: createFormModule(...) }`
schema entry; the parent module's events can dispatch to the peer
via `ctx.peers.form.send(...)`. This is in the master plan as a
Wave-0 toolchain item but hasn't shipped.

Will become critical for realtime cluster (Wave 9) — `hostGameMachine`
spawns 4 children, `partyLobbyMachine` spawns 1+. Without this
the verbosity tax compounds.

---

## Updated quick-win ranking (post-session 24-41)

| Win | Effort | Cycles affected so far |
|---|---|---|
| Export `flushAsync` from testing helpers | 5 LOC + doc | every test harness |
| Runtime warn on non-JSON fact values (Date/Set/Map/class) | 30 LOC | C4, C16, C32, C34 (4× — most frequent) |
| Fix proxy serialization for vitest format | unknown | every test |
| `t.mutator<DiscriminatedUnion>()` higher-level helper | medium | C23, C24, C26, C30, C33, C36-C38, C40, C41 (10×) |
| Lead with `t.string<'a' \| 'b'>()` in docs | doc only | every status fact |
| Document derivation-deps composition | doc only | every multi-derivation module |
| Introduce `t.timer()` or scheduler resolver | medium | C2, C5, C8, C26, C27, C34, C35, C39 |
| `useTickWhile()` hook in @directive-run/react | small | C5, C26, C27, C34, C35, C39 |
| `ctx.snapshot()` for optimistic-update ceremony | small | C41 + heavy social cycles ahead |
| Peer-module declaration for spawned children | medium | C31 + ALL realtime cluster (W9) |
| `ModuleHooks.onResolverError` | small | every multi-resolver machine |

The 10×-occurrence patterns (`t.mutator` + JSON-fact warning)
are now the single biggest leverage points. A `t.mutator()`
helper alone would shave ~50-80 LOC × 10 cycles = ~500-800 LOC
of mutator scaffolding from this codebase.
