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

---

## Item 23 — Same-constraint re-fire is suppressed within a flushAsync window (B-Cycle-43)

**Important correction to Cycle-5 catalog claim** ("Chained
constraint→resolver pipelines fire in same flushAsync window").
That claim only holds when chains transition through *different*
constraints. Same-constraint re-fire is suppressed.

**Reproduced in B-Cycle-43 authModule:**

The MFA flow needs:
1. Constraint X fires resolver R.
2. R writes `pendingAction = { kind: 'createMfaChallenge', ... }`
   and `status = 'creatingMfaChallenge'`.
3. The same constraint X's `when` clause is now true again with
   different pending action.

But Directive does NOT re-fire R in the same window. 5/16 tests
failed with status stuck at `creatingMfaChallenge`. Splitting
into two constraints with two requirement types (`EXECUTE_ACTION`
+ `EXECUTE_MFA`) fixed it immediately.

**Why this matters for migrations:**
- The discriminated `pendingAction` pattern (Item 17) is built
  on the assumption that chained transitions through the same
  constraint work. They don't.
- Workaround: split MFA-style chains into separate constraints.
  Pays an extra ~15-20 LOC per cycle that uses chained mutations.
- C36 (tournament) has a `matchComplete` → `advancingPlayers`
  chain that *appeared* to work — likely because the user
  dispatches `MATCH_COMPLETE_DONE` between, breaking the
  same-constraint chain.

**Proposal (ranked):**
1. Document the constraint-dedup behavior in "chained pipelines"
   guide — add a section "Same-constraint re-fire is NOT supported."
2. Optionally: provide a `ctx.requeue()` API inside the resolver
   so a resolver can explicitly request itself to be re-evaluated
   if facts have changed.
3. Long-term: model "transitions" as their own primitive separate
   from constraints.

This is a P0/P1 limitation — undocumented, easy to hit, hard to
debug (the test failure looked like the constraint's `when` was
returning false, but it was actually returning true and being
ignored).

**Affected cycles going back:** any with chained mutations through
one constraint. Likely C30 (templateCreation save→reload), C40
(spacesAdmin mutation→loading), and others — they "work" by
dispatching the next event from the user side, not via resolver-
chained transition.

---

## Updated quick-win ranking (post-Cycle-43)

The most-bitten limitations after 43 cycles:

| Issue | Frequency | Severity |
|---|---|---|
| Item 20 (JSON-fact warning) | 4× cycles | High (silent breakage) |
| Item 17 (`t.mutator` helper) | 10× cycles | Medium (verbosity tax) |
| Item 23 (same-constraint re-fire) | NEW | High (silent stall) |
| Item 1 (flushAsync export) | every test harness | High (1× barrier per dev) |
| Item 3 (proxy serializer) | every test | Medium (debug-hidden) |
| Item 4 (`t.timer()`) | 8× cycles (timer machines) | Medium (per-cycle ceremony) |

---

## Item 24 — Map-in-fact silently breaks reactivity (B-Cycle-52)

Sibling to Item 20 (Date-in-fact), Item 32 (Set-in-fact). Discovered
during turnMachine port:

```ts
// XState shape
submissions: Map<string, TurnSubmission>  // ❌ proxy doesn't trap mutations

// Workaround
submissions: Record<string, TurnSubmissionFact>  // ✓ JSON-friendly
```

The Map appeared to work but `submissions.set(userId, sub)` mutations
weren't observed by Directive's reactive system. Same root cause
as Item 20 — non-JSON-roundtrippable values break the proxy. The
**JSON-fact rule** is now confirmed across 4 distinct shapes:
- Date instances (4 cycles: C4, C16, C46, C48)
- Set<T> (1 cycle: C32)
- Map<K, V> (1 cycle: C52)
- File objects in optimistic message uploads (1 cycle: C44 spaceMessage)

**Proposal escalation:** Item 20's "runtime warning on non-JSON
fact assignment" should also auto-detect Map and Set instances
specifically. Most-bitten limitation by far.

---

## Item 25 — Parent-event mechanism (`sendParent`) requires callback-shaped workaround (B-Cycle-31, C44, C51, C52)

`turnMachine` had 10+ different `sendParent({...})` calls. XState
spawns child machines that emit events to parents. Directive has
no equivalent: the workaround is a callback dep per parent event.

```ts
deps: {
  onSubmissionComplete?: (input) => void;
  onRevealed?: (input) => void;
  onCompleted?: (input) => void;
  onTimedOut?: (input) => void;
  onError?: (input) => void;
  onTimeWarning?: (input) => void;
  onHapticFeedback?: (input) => void;
  // ...10+ callbacks
}
```

This works but bloats the deps interface. Cycles 31 (formAdapter),
44 (fireXyz callbacks for spawnChild fire-and-forget), 51 (onCallMade),
52 (7 callbacks). 4 cycles confirmed.

**Proposal:** ship a peer-module declaration (already proposed in
Item 22). Then parent module declares `peers: { turn: createTurnModule(...) }`
and child can `ctx.peers.parent.dispatch({type: 'TURN_COMPLETED', ...})`.
Removes the per-event callback ceremony.

This is the highest-leverage missing primitive for the realtime
cluster (W9). Without it, the spawn-child shape pays scaffolding
~50 LOC per parent-child pair.

---

## Updated quick-win ranking (post-Cycle-52, near-final)

| Issue | Frequency | Severity |
|---|---|---|
| Item 20 (JSON-fact warning, expanded) | 7× cycles | **P0 most-bitten** |
| Item 22 + 25 (peer/spawn-child idiom) | 5× cycles + W9 | **P0 for realtime** |
| Item 23 (same-constraint re-fire) | 1× + risk on chains | P0 silent stall |
| Item 17 (`t.mutator` helper) | 12× cycles | High verbosity |
| Item 1 (flushAsync export) | every test harness | High onboarding |
| Item 4 (`t.timer()` declarative) | 10× cycles | Medium ceremony |
| Item 18 (`useTickWhile` React hook) | 8× cycles consumer-side | Medium DX |
| Item 3 (proxy serializer for vitest) | every test | Medium debug-hidden |

The 8 highest-leverage items if implemented would shave ~30%
of the LOC ceremony from a typical port and eliminate 3 of 4
silent-failure modes (Items 20, 23, 25).

---

## Item 26 — Spawning model: corrected analysis (post-Cycle-52 review)

This entry **corrects and supersedes** Items 22 and 25 in part.
After investigating Directive's actual multi-module APIs, the
"spawn" gap is narrower than initially logged.

### What Directive HAS for module composition

1. **Namespaced multi-module systems** — `createSystem({ modules: { auth: authModule, data: dataModule } })`. Each module gets its own namespace; facts/derivations/events accessible via `system.facts.auth.*`, `system.events.data.*`. Composes declaratively.

2. **`crossModuleDeps`** — A module can declare typed dependencies on other modules' schemas:
   ```ts
   createModule('data', {
     crossModuleDeps: { auth: authSchema },
     constraints: {
       loadIfAuthed: {
         when: (facts) => facts.auth.isAuthenticated,  // ✅ typed
         require: { type: 'LOAD' },
       },
     },
   });
   ```
   At runtime: `facts.self.*` for own module, `facts.{depName}.*` for deps.

3. **`registerModule()` at runtime** — Both single-module and namespaced systems support adding new modules into a RUNNING system. Perfect for lazy-loaded features:
   ```ts
   system.registerModule('chat', chatModule);
   ```

4. **Union events** — Cross-module dispatch works via `system.dispatch({ type: 'auth::LOGIN', ... })`. Each module's events are routed to that module.

5. **Init order strategies** — `initOrder: 'auto'` topologically sorts by `crossModuleDeps`; `'declaration'` uses object key order; or pass an explicit string array.

### What Directive does NOT have for spawning

The XState patterns that DON'T have a 1:1 Directive equivalent:

1. **N instances of the same module** — Each namespace is unique. You can't have `turn-1`, `turn-2`, `turn-3` of the same `turnModule` schema running simultaneously without explicit registration of each as a separate namespace. XState's `spawn(turnFactory, {input})` per child has no direct map.

2. **`unregisterModule()` / lifecycle teardown** — `registerModule` exists; the inverse does NOT. Once registered, a module cannot be removed. Memory grows monotonically.

3. **`sendParent` with payload** — Cross-module dispatch via `system.dispatch` works, but a *child module's resolver* dispatching upward to a *specific named parent* is not idiomatic. The recommended pattern is for the consumer to read child facts and dispatch parent events from the React component.

### Practical port strategies

For the W9 realtime cluster (3 remaining machines):

**Strategy A — Multi-module composition (preferred for 1:N child sets):**
```ts
const system = createSystem({
  modules: {
    host: createHostGameModule(deps),
    calling: createCallingModule(deps),
    turn: createTurnModule(deps),
    battle: createBattleRoyaleModule(deps),
    tournament: createTournamentModule(deps),
  },
});
// Cross-reads via crossModuleDeps; events via system.dispatch.
```
This is the right shape for `hostGameMachine` (parent) + 4 children. No callback-dep ceremony. ALL of my Cycles 35/36/37/49/51/52 should have been ports of CHILDREN that compose into a parent system, not standalone modules with callback deps.

**Strategy B — Single-instance reset for ephemeral children:**
For `turnBasedGame` spawning a fresh `turnMachine` per turn: keep ONE `turn` namespace; reset facts on turn change instead of spawning a new namespace. The lifecycle is "1 module, N reset cycles" rather than "N module instances."

**Strategy C — Dynamic registration for lazy/optional features:**
For features that may or may not exist (e.g., a tournament bracket that only some games have), use `system.registerModule('tournament', mod)` when needed. Memory leak caveat: never use this for short-lived features.

### Revised Item 22 + 25 status

- **Item 22 (spawn-child idiom)**: NOT a missing feature. The idiom is `createSystem({ modules: ... })` + `crossModuleDeps`. The gap is in DOCS — there's no "porting from XState's spawnChild" guide. **Downgrade severity: P2 docs gap, not P0 missing primitive.**
- **Item 25 (sendParent → callback workaround)**: PARTIAL gap. Cross-module dispatch works but isn't ergonomic for "child fires named event at named parent." The callback-dep pattern is a valid workaround, just less elegant than XState's `sendParent`. **Downgrade severity: P2 ergonomics, not P0 missing primitive.**

### Real remaining gaps (the actual spawn limitations)

1. **No `unregisterModule()`** — registered modules persist for system lifetime. Real limitation for any code path that wants to "kill a child."
2. **No multi-instance same-namespace** — can't run 5 instances of `turnModule` concurrently, each with its own facts. Workaround: re-design as a list-of-turns in a single module.
3. **Cross-module event ergonomics** — sending a typed event from module A's resolver to module B's event handler is verbose compared to sendParent. Could be solved with a `ctx.system.dispatch` helper that's typed.

### Migration policy (for cycles 53-55)

- Before porting `turnBasedGameMachine`: audit whether the parent-child relationship should be modeled as multi-module composition (turnBasedGame = system orchestrating turn module + others) or as a single module with reset semantics. The right answer is multi-module composition.
- The 4 callback-deps in C44 spaceModule (fireToggleFavorite/firePresenceHeartbeat/fireRemovePresence/fireFetchLeaderboard) are PROBABLY fine since they're fire-and-forget IO, not child-state ports. Keep as deps.
- The 7 callback-deps in C52 turnModule (onSubmissionComplete, onRevealed, etc.) ARE the right pattern for parent-event communication when child is a sibling module and parent reads child via crossModuleDeps. Mostly fine; could simplify to system.dispatch in places.

**This re-analysis means W9's remaining 3 ports should be done as multi-module systems, not standalone modules with callback ceremony.**

---

# AE-Reviewed Verdict Matrix (post-cycle-55, 5-reviewer consensus)

5 parallel AE reviews (Architecture, DX, Domain Expert, Innovation, Risk)
read this entire feedback doc and converged on the per-item verdicts below.
Each item carries a final ship/defer/reject decision and a target landing
location.

## P0 SHIP — strictly additive, no BC risk, ship first

| # | Item | Where | LOC | Why P0 |
|---|---|---|---|---|
| 1 | Export `flushAsync` | core/testing | ~5 | Every test, every dev, every project |
| 3 | Vitest pretty-format crash | core (proxy) | ~15 | First-test crash for fresh devs; use `Symbol.for('nodejs.util.inspect.custom')` NOT `toJSON` (BC risk) |
| 11 | `ModuleHooks.onResolverError` | core | ~20 | Centralizes error routing; opt-in default-undefined |
| 18 | `useTickWhile` React hook | @directive-run/react | ~15 | 8× cycles consumer-side, no core impact |
| 20 | JSON-fact runtime warning | core | ~30 | Highest-leverage (8× silent breakage). WARN not coerce. |
| 21 | `t.union<a\|b\|c>()` | core (schema-builders) | ~10 | Trivial; fills real type-safety gap |
| 23 | Same-constraint re-fire docs + `ctx.requeue()` | core + docs | ~25 | P0 silent stall. DO NOT lift suppression — ship explicit opt-in only |

## SHIP DOCS — pure documentation, no code change

| # | Item | Doc target |
|---|---|---|
| 5 | Bless `status`-as-event-bus pattern | docs/patterns/internal-events.md |
| 7 | Chained-pipeline assertion guide | docs/testing/chained-pipelines.md |
| 8 | Lead with `t.string<Union>()` | top-of-getting-started rewrite |
| 9 | Derivation-of-derivation composition | docs/derivations.md (top-of-docs per Domain Expert) |
| 12 | `server-only` vitest aliasing | docs/testing/next-integration.md |
| 13 | Helper-scope proxy contract | docs/api/facts.md |
| 14 | `events.X()` vs `dispatch()` canonical | docs/api/events.md (canonicalize one) |
| 15 | `vi.useFakeTimers()` escape hatch | docs/testing/fake-timers.md |
| 16 | Derivation purity rule | docs/derivations.md (purity section) |
| 25 | Cross-module dispatch ergonomics | docs/composition/cross-module-events.md |
| 26 | "Porting from XState's spawnChild" | docs/migrating-from-xstate.md |

## HELPER PACKAGES — SHIPPED 2026-04-29

| # | Item | Package | Status |
|---|---|---|---|
| 17 | `t.mutator<DiscriminatedUnion>()` | `@directive-run/mutator@0.1.0` | **SHIPPED.** Six-fragment spread API (`facts`/`events`/`requirements`/`eventHandlers`/`constraints`/`resolvers`); `mutate(kind, payload)` typed dispatch helper; `'pending' \| 'running' \| 'failed'` status union; proto-pollution-guarded handler lookup; truncated error capture. Pre-req `ctx.requeue` shipped (Item #23). Hardened through R1+R2 AE review. |
| 19 | `ctx.snapshot([keys])` optimistic | `@directive-run/optimistic@0.1.0` | **SHIPPED.** `createSnapshot(facts, keys)` + `withOptimistic<F>(keys)(handler)` curried HOC. Atomic capture (R2 fix); throws typed `OptimisticCloneError` on non-cloneable shape rather than silently mis-restoring. Resolver-scope only — NOT a system-wide tx. |

## RFC — design / partial-ship

| # | Item | Status |
|---|---|---|
| 4 | `t.timer({ms})` declarative timer | **v0.1 SHIPPED 2026-04-29.** RFC 0001 drafted; v0.1 ships the value layer (`SignalClock` interface, `realClock`/`virtualClock`/`defaultClock` factories, `TimerFactState` + pure transition helpers + `timerOps()` bundle). Engine-integrated `t.timer({ms})` schema constructor remains the v0.2 deliverable. v0.1 already obviates `vi.useFakeTimers` for module-side timer logic (use `virtualClock` + `advanceBy`); `useTickWhile` (#18) is now consumer-side polish only; clock-in-derivation (#16) is correct via `clock.now()` capture at module-factory time. |
| 26 | `unregisterModule()` + multi-instance | Open. Cancellation semantics for in-flight resolvers; identity for N-of-same-schema (atomFamily-style). |

## REJECT — would compromise framework design

| # | Item | Why reject |
|---|---|---|
| 2 | Magic `t.date()` schema base type | Legitimizes non-JSON facts; opens slippery slope to `t.set()`/`t.map()`. JSON-roundtrip is the design contract. Use #20 warn instead. |
| 5 | `module.fire('INTERNAL_EVENT')` API | Creates hidden second event channel parallel to dispatch. `status` discriminator is the right shape. |
| 22 | First-class peer/spawn-child API | Per Item 26 re-analysis: `createSystem({ modules })` + `crossModuleDeps` IS the idiom. Shipping a `peers:` API would duplicate composition. |

## SUBSUMED / INVESTIGATE

| # | Item | Status |
|---|---|---|
| 2 | Date corruption | Subsumed → #20 |
| 6 | Discriminated payload binding | Subsumed → #17 (helper) |
| 10 | `nullable()` equality oddity | **CLOSED 2026-04-29** — investigation reproduction (`packages/core/src/core/__tests__/nullable-equality.test.ts`, 7 tests covering direct equality, derivation reads, nullable objects/arrays, rapid set/clear cycles, multi-fact composition, init paths) all pass. Item 10 was either a B-Cycle-9 developer-side bug or got incidentally fixed by another P0 ship. No framework change required. |
| 24 | Map-in-fact | Subsumed → #20 |

---

## Game-Changer Picks (Innovation Review)

The Innovation reviewer found 3 items that, if reframed, become viral-demo
material rather than incremental fixes:

1. **Time-travel Test REPL** (reframe #1+#3+#7) — Vitest reporter that
   auto-opens a scrubbable causal-graph timeline on every test failure.
   Built on Directive's existing causal cache. **The lead.** No other state
   library has this. ETA: 1 week prototype.

2. **`t.mutator<>` with built-in optimistic + rollback** (reframe #17) —
   RTK Query's `createApi` energy. 80 lines of optimistic boilerplate
   collapse to 8. ETA: 2 weeks polished.

3. **Static analysis for silent stalls** (reframe #23) — IDE catches
   re-fire deadlocks at build time. ETA: 1 month (real flow analysis).

---

## What Minglingo Updates AFTER Each Directive Ship

**Are existing 682 tests at risk?** No. They use workarounds for current
gaps (local `flushAsync`, `dateMs` instead of Date, callback-deps instead
of `sendParent`). Future ships would simplify them, not break them.

| Directive ships | Minglingo cleanup | LOC saved |
|---|---|---|
| #1 (flushAsync) | Replace 55 local impls with one import | ~275 |
| #20 (JSON warn) | No rework — workarounds stay correct | 0 |
| #17 (mutator helper) | 12 modules collapse `pendingAction` ceremony | ~600 |
| #18 (useTickWhile) | ~6 React hooks consolidate | consumer-side |
| #23 (ctx.requeue) | C43 authModule MFA can re-merge constraints | ~30 |
| **Total** | | **~900 LOC removable, 0 test changes** |

---

## Track Sequence

**Track A** — Directive ships (~1 week per phase, sequential):
- Phase 1: 7 P0 items
- Phase 2: 11 docs items
- Phase 3: Helper packages (mutator + optimistic)
- Phase 4: `t.timer()` RFC → implementation
- Phase 5: Time-travel REPL (the Sherlock)

**Track B** — Minglingo rollout (parallel, 2-4 weeks):
- Wire `MINGLINGO_DIRECTIVE_<X>` feature flags
- Migrate React surfaces (`useMachine` → `@directive-run/react`)
- Per-module 7-day soaks
- Monitor production divergence

**Track C** — Migration retrospective (parallel, ~1 week):
- Per-cycle pattern catalog → docs/migrating-from-xstate.md
- Promote derivation-composition (#9) to top-of-docs
- Publish the 26-item learnings as a blog post

