# Migrating from XState

Distilled from porting 55 XState machines (~26,000 LOC) to Directive across the
Minglingo codebase. This guide is the cheat-sheet you wish existed before
starting. It covers concept mapping, recurring patterns, and a few non-obvious
gotchas the first port through each shape will hit.

## TL;DR concept mapping

| XState | Directive |
|---|---|
| `setup({...}).createMachine({...})` | `createModule(name, { schema, ... })` composing facts (state) + constraints (guards) + derivations (computed) + events (transitions) + resolvers (async) + effects (side-effects) |
| Finite state names (`idle`, `loading`, `success`) | Discriminated `status` fact with `t.string<UnionType>()` |
| `assign({field: ...})` | `event.handle(...)` writing a fact, or a `derivation` recomputing from upstream facts |
| `fromPromise(async fn)` | `resolver` (async fact source). Bonus: causal cache invalidation via `@directive-run/query` |
| `sendTo(child, event)` | Direct `event.dispatch` on same module, or cross-module event bus (see [Cross-Module Events](./composition/cross-module-events.md)) |
| `spawnChild(machine, {input})` | `createSystem({ modules })` + `crossModuleDeps` — see [Porting from XState's spawnChild](#porting-from-xstates-spawnchild) below |
| Parallel states | Multiple independent facts on the same module |
| `useMachine(...)` (React) | `useFact` / `useDerivation` from `@directive-run/react`. Granular subscriptions = fewer re-renders |
| `useSelector(state, selector)` | First-class `useDerivation` |
| `@statelyai/inspect` | `devtoolsPlugin` from `@directive-run/core/plugins`. Loses the visual statechart — gap accepted |
| `after: { 5000: 'TIMEOUT' }` | No declarative `after`. Becomes imperative `setTimeout` in an effect, OR the `useTickWhile` React hook for predicate-gated dispatch (see [fake timers](./testing/fake-timers.md)) |
| Realtime subscription inside actor | `createSubscription` from `@directive-run/query` feeding facts. Causal cache handles dedup |

## Mental-model shift

XState says "what state am I in, and what events legally transition me to the
next state?" Directive says "what facts must hold true, and what produces them?"

In practice: you stop writing transition tables and start writing the **shape of
the world** + the **rules that maintain it**. Constraints fire when their inputs
change; resolvers run when a constraint declares a fact missing or stale.

The result is fewer explicit transitions and more *truth-preserving* logic.
Most ports come in 25-40% smaller. The exceptions are pure FSMs (auth, signup
wizards) where Directive's verbosity tax shows up — see the [LOC delta
analysis](#loc-delta-by-machine-shape).

## Discriminated `status` is the de-facto pattern

This wasn't documented anywhere, but every port settled on it.

```ts
const schema = {
  status: t.string<'idle' | 'loading' | 'ready' | 'error'>(),
  data: t.array<Item>(),
  error: t.string().nullable(),
};
```

Use `t.string<Union>()` (the typed-union form) so derivations and event handlers
can narrow without explicit predicates. Without the generic, every consumer has
to re-validate the union shape.

## The `pendingAction` pattern (12+ cycles confirmed)

When a single state has multiple paths forward — submit, cancel, retry, undo —
don't model each as its own constraint. Use a discriminated `pendingAction`
fact:

```ts
const schema = {
  pendingAction: t
    .union<
      | { type: 'submit'; payload: SubmitPayload }
      | { type: 'cancel' }
      | { type: 'retry'; reason: string }
    >()
    .nullable(),
};
```

A single constraint fires on `pendingAction != null`, dispatches the matching
resolver, then nulls it. This collapses what would be 4-8 XState transitions
into one constraint with a switch. See the upcoming
[`@directive-run/mutator`](https://github.com/directive-run/directive/discussions)
helper which formalizes this — it ships in Phase 3.

## JSON-roundtrippable facts (load-bearing rule)

Facts MUST be JSON-roundtrippable. `Date`, `Set`, `Map`, `File`, `Promise`,
class instances — none of these survive Directive's proxy reactivity layer. A
Date assigned to a fact silently becomes a frozen object that compares unequal
to itself.

As of `@directive-run/core@1.2.0`, assigning one of these in dev mode emits a
runtime warning. In production builds the warning is tree-shaken — your app
will silently misbehave. **Convert at the boundary**:

```ts
// resolver:
async () => {
  const row = await db.query(...);
  return {
    ...row,
    createdAtMs: row.createdAt.getTime(), // Date → number
  };
}
```

## Test-flushing canonical pattern

Use `flushAsync` from `@directive-run/core/testing` (shipped in 1.2.0). It runs
3 microtask passes + 2 setTimeout(0)s, which is sufficient for any
chained-resolver pipeline up to 3 deep.

```ts
import { flushAsync } from '@directive-run/core/testing';

it('full pipeline', async () => {
  const sys = createSystem({ module: createXModule(deps) });
  sys.start();
  sys.events.START();
  await flushAsync();
  expect(sys.facts.status).toBe('ready');
  sys.destroy();
});
```

See the [chained-pipelines testing guide](./testing/chained-pipelines.md) for
the deeper picture: when 3 passes isn't enough, what to do with `vi.useFakeTimers`,
and how to spot a same-constraint re-fire stall (the most common test bug).

## Porting from XState's `spawnChild`

XState's `invoke: { src: child, input }` pattern doesn't have a 1:1 in
Directive. There is no `spawnChild()` API. Instead, **compose at the system
level**:

```ts
const sys = createSystem({
  modules: {
    party: createPartyModule(),
    game: createGameModule(),
  },
  crossModuleDeps: ({ party }) => ({
    game: { currentPartyId: () => party.facts.currentPartyId },
  }),
});

// Cross-module event:
sys.modules.party.events.GAME_ENDED({ gameId });
```

When you need *N-of-the-same-shape* (e.g. one module per active game), today
the answer is "instantiate one Directive system per shape" or "fold the N items
into a single module's facts as an array." Both work. A first-class
`atomFamily`-style API is in RFC (item #26 in `MIGRATION_FEEDBACK.md`).

Caveat: in-flight resolver cancellation across module unmount is not yet
defined. If your spawn-equivalent has long-running resolvers, plan to drain
explicitly before destroying the parent system.

## Same-constraint re-fire (the silent stall)

A constraint cannot re-fire itself within the same `flushAsync` window. If
your XState machine had `[transition: 'self']` or a state self-loop, naively
mapping that to a Directive constraint that re-evaluates its trigger fact will
appear to stall — the test won't fail, the assertion just never resolves.

`ctx.requeue()` is the explicit opt-in (shipped in 1.2.0). Use it inside the
constraint body when you intentionally want a same-constraint re-fire. See
[chained pipelines](./testing/chained-pipelines.md) for the test-side smell
(an awaited assertion times out at 5s, the constraint silently stopped).

## Realtime / WebSocket fan-in

Treat Supabase Realtime / WebSocket subscriptions as **external event sources
that dispatch into the module**. Don't try to subscribe inside a resolver:
resolvers are one-shot. Wire the subscription in the consumer (the React
component or Next.js route) and call `sys.events.UPSTREAM_EVENT(payload)` on
each frame.

```ts
// In a React component:
useEffect(() => {
  const sub = supabase.channel(...).on('postgres_changes', (e) => {
    sys.events.PEER_UPDATE(e.new);
  }).subscribe();
  return () => sub.unsubscribe();
}, [sys]);
```

Inside the module, `PEER_UPDATE` is a normal event handler.

## LOC delta by machine shape

From the 55-cycle migration:

| Machine kind | Typical LOC delta | Why |
|---|---|---|
| Query/derived (browse, leaderboard) | **-40 to -50%** | Causal cache + `useDerivation` collapse render-pipeline boilerplate |
| Page state / dashboards | **-30 to -45%** | Granular subscriptions replace `useSelector` pyramids |
| Wizards / sequential flows | **-20 to -30%** | Discriminated `status` + `pendingAction` |
| Pure FSM (auth, signup) | **near-flat to +5%** | Verbosity tax: every transition becomes a constraint, no causal cache wins |
| Realtime cluster (game, lobby) | **-15 to -25%** | Wins concentrate in derivations, not transitions |

Default rule: if the machine is mostly query-driven, expect a big shrink. If
it's mostly transition-driven, expect parity. This is by design — Directive
optimizes for **derived state**, not finite states.

## Migration order (lessons from doing it in the wrong order)

1. Smallest non-realtime machines first — proves the cycle template
2. Pure-logic / validation machines next — lowest risk
3. Query-driven (browse, leaderboard) — biggest wins, build confidence
4. Auth / forms — verbosity tax, but contained
5. Page state / dashboards — bulk volume, easy
6. Realtime cluster LAST — needs all the above patterns plus subscription wiring

Don't migrate a machine that's actively being developed. Use the WRAP model
(Directive owns facts, XState becomes a thin view layer reading them) for
those, until feature work pauses.

## Per-module rollout pattern

Ship each port behind a feature flag (`MINGLINGO_DIRECTIVE_<MachineName>` in
the Minglingo case). Run both implementations in parallel for 7 days, log
divergence, then flip. Delete the XState file two weeks after the soak.

This pattern is independent of Directive — it's the rollback-discipline part
that makes solo-dev migration tractable.

---

## See also

- [Chained pipelines testing](./testing/chained-pipelines.md) — the canonical flushing pattern
- [Fake timers](./testing/fake-timers.md) — when `vi.useFakeTimers()` plays well with Directive
- [Internal events](./patterns/internal-events.md) — `status`-as-event-bus
- [Derivations](./derivations.md) — composition + purity rules
- [Cross-module events](./composition/cross-module-events.md) — peer dispatch ergonomics
- [`MIGRATION_FEEDBACK.md`](./MIGRATION_FEEDBACK.md) — full 26-item gap log from the migration
