# Migrating 55 XState Machines to Directive: A Field Report

*Posted 2026-04-29 · ~12 min read*

We just finished porting 55 XState machines — about 26,000 lines of orchestration code — from one large Next.js app onto Directive, the constraint-driven runtime we ship as Sizls's flagship state library. This is the field report. It's an honest record of what worked, what hurt, and what shipped back to Directive itself as a result.

If you're considering Directive, or you're shopping for an XState alternative, or you're just curious whether constraint-driven state management is real or a marketing fiction, this is the longest piece of evidence we'll have for a while.

## Why migrate at all?

XState was working. The 47 visible state machines (plus eight that lived as spawned children) were tested, shipped, and stable. Nothing was on fire.

The migration was a strategic call, not a tactical one. Sizls runs four products — IntentKit, Pluck, Minglingo, Directive AI — and Directive itself. If we want our flagship runtime to be credible, we need to be running it. Not a small example; not a benchmark; the actual production app, with realtime multiplayer, auth flows, dashboards, the whole stack.

The decision sounds obvious in retrospect. At the time, an internal AE review pegged it as 3-6× capacity for a solo developer. That review was right about the hours. It was wrong about whether the calendar tax was worth paying.

It was. Here's why.

## The shape of the work

55 machines, ranging from `notificationMachine` (282 LOC, simplest) to `hostGameMachine` (1,814 LOC, hardest). Each one went through a six-stage cycle:

1. **Pre-flight spec** — written before any code. States, events, guards, actors, parent/child relationships, current LOC, target LOC, parity-test plan, risk grade. Saved to `docs/migrations/<machine-name>.md`.
2. **User review** — the spec was the contract. No code until approved.
3. **Execution** — build the Directive module, wire parity tests, run cassettes against both old and new.
4. **AE review loop** — four-lens parallel reviewers (security, architecture, DX, innovation). Cycle until 0 critical + 0 major findings.
5. **Per-machine give-up gate** — five criteria: ≤2 weeks wall-time, ≥30% LOC reduction (or near-flat for FSMs), ≥10% re-render perf, 100% cassette parity, 0 P1 bugs in 7-day soak.
6. **Final commit, move on** — XState file renamed `*.legacy.ts`, deleted two weeks later. Feature flag flipped on for 7 days, then deleted.

3-of-5 gate criteria green = continue. 2-of-5 = warn. <2 = roll back. Three consecutive misses = freeze the program at the current line.

We didn't hit a freeze. We did roll back twice (mid-cycle, before commit) when the spec turned out to be wrong about the surface area.

## What shrunk, what stayed flat, what grew

Per the pre-flight LOC estimates, here's the actual delta by machine shape:

| Shape | Typical LOC delta | Why |
|---|---|---|
| Query / derived (browse, leaderboard) | **−40 to −50%** | Causal cache + `useDerivation` collapse render-pipeline boilerplate |
| Page state / dashboards | **−30 to −45%** | Granular subscriptions replace `useSelector` pyramids |
| Wizards / sequential flows | **−20 to −30%** | Discriminated `status` + `pendingAction` |
| Pure FSM (auth, signup) | **near-flat to +5%** | Verbosity tax — every transition becomes a constraint, no causal cache wins |
| Realtime cluster (game, lobby) | **−15 to −25%** | Wins concentrate in derivations, not transitions |

There's a lesson buried in that table. Directive optimizes for **derived state** and **causal-cache invalidation**. Where your code has rich queries, multiple subscribers, and lots of computed values that change in lockstep with facts, you win 30-50%. Where your code is pure transitions — auth, multistep wizards — you pay a small verbosity tax in exchange for type safety and tooling that XState doesn't give you.

That's the right trade. Pure FSMs are 5-10% of any large app; query-driven page state is 60-80%. The optimizer is pointed at the bigger surface.

## The pattern catalog

Twelve modules independently converged on the same shape: a discriminated `pendingAction` fact gating a single constraint that switches on the discriminator, runs the matching async work, and clears the fact. Nobody documented this pattern; everyone discovered it.

```ts
schema: {
  status: t.string<'idle' | 'submitting' | 'error'>(),
  pendingAction: t
    .union<
      | { type: 'submit'; payload: SubmitPayload }
      | { type: 'cancel' }
      | { type: 'retry'; reason: string }
    >()
    .nullable(),
}
```

A single constraint fires on `pendingAction != null`, dispatches the right handler, then nulls the fact. This collapses 4-8 XState transitions into one constraint with a switch.

After cycle 12 it became obvious that this pattern wasn't a bug — it was the right shape for "multi-variant async work with a discriminator." The framework just hadn't blessed it yet. As a direct result of the migration, that pattern now ships as `@directive-run/mutator`. Six lines of spread-fragments replace the per-module 50-line ceremony.

The other patterns that emerged — and now have docs:

- **`status` as the only event bus.** Don't add a parallel internal-event channel. Discriminated `status` transitions are observable, replayable, and devtools-visible by default.
- **JSON-roundtrippable facts.** `Date`, `Set`, `Map`, `File`, class instances all break the proxy reactivity layer silently. Convert at the boundary; assign a `Date.now()` number, never a `Date`.
- **Realtime fan-in is external.** Don't subscribe inside a resolver. Wire the WebSocket subscription in the consumer (React `useEffect`, Next.js route handler, edge worker) and `sys.events.PEER_UPDATE(payload)` on each frame.
- **Same-constraint re-fire is suppressed.** A constraint cannot trigger itself within one flush window. If your XState machine had a self-loop, you need an explicit opt-in (`ctx.requeue()`, shipped this week).
- **Derivation composition reads via `derive`, not `sys.derive`.** Inside a derivation body, the `derive` parameter goes through the cache; the system reference doesn't. We saw this trip up four reviewers across the migration before the docs caught up.

All five are now in `docs/`.

## The 26 framework gaps

Every cycle ended with a "what was painful?" note. Across 55 cycles, those notes consolidated into 26 distinct items spanning four severity tiers. The full record is in `docs/MIGRATION_FEEDBACK.md`. Highlights:

**Things that took >1 hour to figure out the first time** (P0):
- The async test-flush incantation (3 microtask passes, 2 setTimeouts, settled exactly so) — every test had a local copy until we shipped the canonical `flushAsync` helper.
- Vitest pretty-format crashing on proxied facts when an assertion failed — the failure-message itself produced a different failure, hiding the real error.
- The same-constraint re-fire suppression with no diagnostic — debugging by `console.log` for half a day before anyone realized.

**Recurring pattern friction** (P1):
- No declarative `after: { 5000: 'TIMEOUT' }` — every timer became imperative `setTimeout` glue.
- No first-class internal-event convention until cycle 12 (see "status as the event bus" above).
- Two callable shapes for events — `sys.events.X(payload)` versus `sys.dispatch({type, ...})` — and we didn't pick one until late.

**Quality-of-life docs gaps** (P2-P3):
- `t.string<UnionType>()` was undiscoverable. Once you knew about it, every module used it. New cycles re-learned its existence at the AE-review stage when a reviewer suggested it.
- `nullable()` semantics on init were ambiguous — `null` versus `undefined` versus default-to-empty.
- Derivation-of-derivation composition wasn't anywhere in the docs.

By the end, we had a verdict matrix on each item with five disposition tags:

- **P0 SHIP** (7 items, additive, no BC risk) — fixed this week.
- **SHIP DOCS** (11 items, no code) — written this week.
- **HELPER PACKAGES** (2 items) — `@directive-run/mutator` and `@directive-run/optimistic`, shipped this week.
- **RFC** (2 items) — `t.timer({ms})` is the big one, draft published.
- **REJECT** (3 items) — including a tempting `module.fire('INTERNAL_EVENT')` API that would have created a hidden second event channel. Said no on principle.

## What shipped back to Directive

This is the part of the story I wish more framework retrospectives told.

The seven P0 fixes that landed in `@directive-run/core@1.2.0` came directly from migration pain:

1. `flushAsync` exported from `@directive-run/core/testing`. 49 local copies in the consuming app collapsed to one import, ~250 LOC removed.
2. `Symbol.for('nodejs.util.inspect.custom')` on the proxy hook — vitest's pretty-format no longer crashes when an assertion fails on a proxied fact.
3. `ModuleHooks.onResolverError` side-channel observer for forwarding resolver failures into module-local error sinks (toasts, telemetry) without coupling them to the engine plugin system.
4. `t.union<a | b | c>()` zero-argument generic form — fills a real gap for polymorphic event payloads.
5. JSON-fact runtime warning — assigning a `Date` / `Set` / `Map` / `File` in dev mode now emits a console warning. Production builds tree-shake it.
6. `useTickWhile<S>(system, predicate, eventName, intervalMs)` React hook for predicate-gated interval dispatch — eight cycles independently wrote a version of this.
7. `ctx.requeue()` opt-in for same-constraint re-fire — the silent-stall escape hatch, with explicit semantics so the engine still catches infinite loops.

Plus three new packages built on those fixes:

- **`@directive-run/mutator@0.1.0`** — six fragment-spreads collapse the 12-instance `pendingAction` ceremony into a typed handler map. Estimated downstream cleanup: ~600 LOC.
- **`@directive-run/optimistic@0.1.0`** — `withOptimistic([keys], handler)` HOC for snapshot + automatic rollback on throw. Composes with the mutator for full optimistic-UI flows.
- **`@directive-run/timeline@0.1.0`** — the Sherlock pick. A vitest reporter that, on test failure, prints the entire causal chain that got the system into the failing state. Built on Directive's existing `system.observe(observer)` API; no core changes needed. When `expect(facts.status).toBe('ready')` fails, you don't get "expected 'loading' to be 'ready'" — you get every fact change, constraint evaluation, requirement lifecycle, and resolver run, timestamped, in the order they happened.

And one design RFC, the largest piece of futures work surfaced by the migration:

- **`t.timer({ms})`** — a first-class timer schema type that the engine owns. Items 4 (no `after`), 15 (fake-timer integration), 16 (clock-in-derivation), and 18 (`useTickWhile`) all converge on the same root: time isn't a first-class fact today. Three clock-source models considered, recommendation locked, draft published. Implementation deferred until at least one Minglingo prototype validates the API shape.

## What this teaches about framework design

A few things, more or less in order of how surprised I was:

**The right substrate makes hard features feel like wiring.** The time-travel test REPL took half a day to build because Directive had already shipped `system.observe(observer)`. The same feature on a framework without that substrate is a multi-week undertaking. When ranking innovation ideas, weight "data already exists" heavily.

**Sample size 55 caught patterns that sample size 5 would have missed.** The discriminated `pendingAction` shape didn't become obvious until cycle 12. If we'd done five flagship migrations and called it done, we'd never have seen the regularity, never have shipped the mutator helper, never have closed the corresponding 600 LOC of consumer boilerplate. The cost of doing 55 was real; the savings only arrived because we did 55.

**An uncomfortable amount of "framework friction" is actually missing diagnostics.** Same-constraint re-fire would have been a one-day learning instead of a half-day debugging if the engine had logged a warning the first time it suppressed a re-fire. JSON-fact corruption would have been a Day 1 lesson if the assignment had warned. Neither feature requires a new API; both are diagnostic-only changes that turn silent footguns into loud ones.

**The verbosity tax on pure FSMs is real and that's fine.** Auth, signup, and password-reset machines came in flat or +5%. Pure transition machines aren't where Directive earns its keep. Anyone selling a state library that promises to win on every shape is selling marketing. The honest answer is "we win on derived/query state, we tie on FSM state, and we earn the trade because most apps are mostly the former."

**The "AE review loop" methodology shipped more value than any individual feature.** Four lenses (security, architecture, DX, innovation) running in parallel after each cycle — it caught things no single reviewer would have. The mutator helper came out of the innovation lens noticing the 12-instance recurrence. The same-constraint diagnostic came out of the DX lens. Run reviews in parallel. Run them every cycle. Don't batch.

## What's next

Two tracks remain. They're operational, not architectural:

- **Track B — feature-flag rollout in production.** Each migrated module ships behind `MINGLINGO_DIRECTIVE_<MachineName>`, runs in parallel with the legacy XState path for 7 days, logs divergence, then flips. The 55-machine batch is queued; the calendar will play out over weeks.
- **Track C — broader adoption signal.** Both 0.x packages (`mutator` and `optimistic`) want at least three external consumers before settling on v1.0 API shapes. The migration is consumer #1; we're looking for two more.

The end state is Sizls's stack alignment story complete: every product runs on Directive, Directive runs on production-validated patterns, the docs and helper packages are written by people who actually used them at scale.

That story would be marketing if we hadn't done the work. We did the work.

## Try it

- [`@directive-run/core`](https://www.npmjs.com/package/@directive-run/core) — the runtime
- [`@directive-run/react`](https://www.npmjs.com/package/@directive-run/react) — `useFact`, `useDerivation`, `useTickWhile`
- [`@directive-run/mutator`](https://www.npmjs.com/package/@directive-run/mutator) — discriminated mutation helper
- [`@directive-run/optimistic`](https://www.npmjs.com/package/@directive-run/optimistic) — snapshot + rollback
- [`@directive-run/timeline`](https://www.npmjs.com/package/@directive-run/timeline) — time-travel test REPL
- [Migration cheat-sheet from XState](../migrating-from-xstate.md)
- [`MIGRATION_FEEDBACK.md`](../MIGRATION_FEEDBACK.md) — the full 26-item gap log if you want to read the source material yourself

If you migrate something non-trivial onto Directive, please open an issue with what hurt. The next 55 cycles' pain is the next release's roadmap.

— *Jason, on behalf of the Sizls team*
