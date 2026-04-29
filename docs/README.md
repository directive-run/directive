# Directive Documentation

Source-of-truth docs for [`@directive-run/core`](https://www.npmjs.com/package/@directive-run/core)
and the surrounding package family. Most of these docs were written or
expanded during the 55-machine Minglingo migration (April 2026); the
field-report lives in [`posts/migrating-55-machines.md`](./posts/migrating-55-machines.md).

## Start here

- **New to Directive?** Read [Getting Started — typed string unions](./getting-started/typed-string-unions.md). Then [Derivations](./derivations.md). Then come back here.
- **Coming from XState?** [Migrating from XState](./migrating-from-xstate.md) is the cheat-sheet.
- **Debugging a test?** [Testing — chained pipelines](./testing/chained-pipelines.md) covers the canonical `flushAsync` pattern and how to spot a same-constraint stall.

## Concepts

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — the runtime architecture in one diagram + 1500 words.
- [`concepts/chained-pipelines.md`](./concepts/chained-pipelines.md) — how facts → constraints → resolvers → facts forms causal chains.
- [`derivations.md`](./derivations.md) — purity rule, composition (`derive` parameter, not `sys.derive`), top-of-funnel placement.
- [`patterns/internal-events.md`](./patterns/internal-events.md) — `status`-as-event-bus; why no `module.fire('INTERNAL_EVENT')` API.

## API reference

- [`api/facts.md`](./api/facts.md) — schema declaration, proxy contract, JSON-roundtrippability rule, nullability vs optional.
- [`api/events.md`](./api/events.md) — `events.X(payload)` canonical, generic `dispatch({type, ...})` for adapters, when not to dispatch from inside a constraint.

## Composition

- [`composition/cross-module-events.md`](./composition/cross-module-events.md) — `crossModuleDeps` for read access, `system.modules.X.events.Y(payload)` for cross-module dispatch. No `sendParent`/`sendChild`; modules are flat peers.

## Testing

- [`testing/chained-pipelines.md`](./testing/chained-pipelines.md) — `flushAsync` from `@directive-run/core/testing`, when 3 deep isn't enough, the same-constraint re-fire stall.
- [`testing/fake-timers.md`](./testing/fake-timers.md) — when (rarely) `vi.useFakeTimers()` integrates cleanly.
- [`testing/next-integration.md`](./testing/next-integration.md) — `server-only` aliasing for vitest in Next.js apps.

## Migration

- [`migrating-from-xstate.md`](./migrating-from-xstate.md) — full concept mapping, 55-cycle learnings, LOC delta by machine shape, recommended migration order.
- [`MIGRATION_FEEDBACK.md`](./MIGRATION_FEEDBACK.md) — 26-item framework-gap log from the migration. Verdict matrix at the bottom.

## RFCs

- [`rfcs/0001-t-timer.md`](./rfcs/0001-t-timer.md) — `t.timer({ms})` declarative timer primitive (synthesizes feedback items #4, #15, #16, #18). **Status: v0.1 SHIPPED 2026-04-29** as helper layer (`SignalClock`, `realClock`/`virtualClock`, `TimerFactState`, `timerOps()`); v0.2 engine-integrated schema deferred.
- [`rfcs/0002-unregister-and-multi-instance.md`](./rfcs/0002-unregister-and-multi-instance.md) — `system.unregisterModule()` + multi-instance module spawning (closes feedback Item 26). Status: Draft. Awaits AE-review-loop + concrete prototype before implementation.

## Innovation backlog

- [`IDEAS.md`](./IDEAS.md) — Game-changer ideas surfaced during AE-review-loop rounds. R1.A scaffold (`directive replay` from prod error JSON) shipped in `@directive-run/timeline@0.2.0`; R1.B-E queued.

## Field reports

- [`posts/migrating-55-machines.md`](./posts/migrating-55-machines.md) — *Migrating 55 XState machines to Directive: a field report.* What worked, what hurt, what shipped back to Directive itself. ~12-min read.

## Companion packages

Each has its own README under `packages/<name>/`:

| Package | What it is |
|---|---|
| [`@directive-run/core`](../packages/core) | The runtime + schema-builders + plugins API |
| [`@directive-run/react`](../packages/react) | React hooks: `useFact`, `useDerivation`, `useTickWhile` |
| [`@directive-run/query`](../packages/query) | Causal-cache-backed async query primitives |
| [`@directive-run/mutator`](../packages/mutator) | Discriminated mutation helper (collapses `pendingAction` ceremony) |
| [`@directive-run/optimistic`](../packages/optimistic) | Resolver-scope snapshot + rollback |
| [`@directive-run/timeline`](../packages/timeline) | Time-travel test REPL — vitest reporter that auto-prints causal chains on failure |

## Contributing

Open issues on [github.com/directive-run/directive](https://github.com/directive-run/directive). For feedback shaped like the migration feedback log — i.e. "I tried to do X, the framework made me write Y verbose lines, here's the pattern" — tag the issue `migration-feedback` and we'll sort by recurrence.

## License

MIT OR Apache-2.0
