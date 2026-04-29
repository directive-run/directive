# Session Handoff — 2026-04-29

This doc closes a long working session. The next session can read this
file alone to pick up cold context.

## Headline

**30 commits ahead of `origin/main` on a clean working tree.** Three
unconsumed changesets are queued. Pushing to main triggers the release
workflow which opens a Version Packages PR; merging that PR publishes
all the packages below to npm.

## What's queued for npm

### Linked group bump → `1.3.0`
The `fixed` array in `.changeset/config.json` ties these together. They
all bump together regardless of which one had a real change.

| Package | 1.2.0 → 1.3.0 reason |
|---|---|
| `@directive-run/core` | Real changes: DTS-emit fix for `t.union<>()`; RFC 0001 v0.1 timer/clock helpers |
| `@directive-run/react` | No real changes; locked to the group |
| `@directive-run/vue` | No real changes; locked |
| `@directive-run/svelte` | No real changes; locked |
| `@directive-run/solid` | No real changes; locked |
| `@directive-run/lit` | No real changes; locked |
| `@directive-run/ai` | No real changes; locked |
| `@directive-run/cli` | No real changes; locked |
| `@directive-run/knowledge` | No real changes; locked |
| `@directive-run/claude-plugin` | No real changes; locked |

### First publishes (no version bump — declared at v0.1.0 / v0.2.0 in package.json)
These have no changesets but `pnpm changeset publish` detects they
aren't on npm yet and ships them.

| Package | Version | Notes |
|---|---|---|
| `@directive-run/mutator` | `0.1.0` | Discriminated mutation helper. Through R3 hardening. |
| `@directive-run/optimistic` | `0.1.0` | Resolver-scope rollback. Atomic snapshot, throws `OptimisticCloneError` on non-cloneable. |
| `@directive-run/timeline` | `0.2.0` | Time-travel test REPL + R1.A scaffold (serialize/deserialize/replay). |

### Examples
The `fixed` group cascade also patch-bumps every example package
(`@directive-run/example-*`). They're `private: true` and don't
publish. Cosmetic only.

## The actual ship command

```sh
cd /Users/jasonwcomes/Desktop/Sizls/projects/directive
git push origin main
```

The `.github/workflows/release.yml` workflow runs on push to main:

1. Installs deps with frozen lockfile.
2. Builds all `packages/*`.
3. Runs typecheck + tests.
4. Runs `changesets/action` which sees three unconsumed changesets and
   opens a "Version Packages" PR.

When you merge that PR, the same workflow re-runs and this time
`changesets/action` runs `pnpm changeset publish`:

1. Bumps versions per the now-consumed changesets.
2. Generates CHANGELOG.md entries from the changeset bodies.
3. `npm publish` for everything that's now ahead of npm — including
   the three new packages whose version simply doesn't exist on npm
   yet.
4. Creates GitHub Releases.

Required secrets in the repo settings: `NPM_TOKEN`. The workflow
already references it.

## Verification before push

- ✅ Working tree clean (just worktree `m` markers, untracked).
- ✅ 30 commits ahead of `origin/main`.
- ✅ All 14 publishable packages build clean (`pnpm -r --filter './packages/*' build`).
- ✅ Test suite: 3,996 / 3,997 (1 skipped, 0 failures) — `npx vitest run`.
- ✅ Three pending changesets:
  - `dts-emit-fix.md` — core patch
  - `timer-v0-1.md` — core minor (wins; group bumps to 1.3.0)
  - `timeline-replay-scaffold.md` — timeline minor

## What just shipped this session (16 commits)

| # | Commit | Track |
|---|---|---|
| 1 | `2e28ca66` | DTS-emit fix |
| 2 | `29d2a0db` | 11 SHIP DOCS files (testing, patterns, API, composition, migration) |
| 3 | `0f486d37` | RFC 0001 — `t.timer({ms})` |
| 4 | `c358498b` | `@directive-run/mutator@0.1.0` |
| 5 | `e8c42ab8` | `@directive-run/optimistic@0.1.0` |
| 6 | `7ab11e43` | `@directive-run/timeline@0.1.0` |
| 7 | `95e1d0be` | Migration retrospective post + docs index |
| 8 | `dcad00db` | Changeset core 1.2.0 → 1.2.1 (DTS fix) |
| 9 | `80c246f0` | Timer/clock helpers + Item 10 closure |
| 10 | `08ac9830` | Changeset core 1.2.x → 1.3.0 (timer minor bump) |
| 11 | `2641832f` | AE-review R1 fix-pack (5 critical + ~30 major) |
| 12 | `b9fb0a65` | AE-review R3 fix-pack (R2 findings + doc drift) |
| 13 | `77ec15d1` | R4 backlog + RFC 0002 draft |
| 14 | `b63f4a94` | R1.A scaffold (serialize/deserialize/replay) |
| 15 | `27a2a838` | Docs index + IDEAS.md status updates |

## What's NOT shipped (next session backlog)

In rough priority order. Each is its own dedicated session.

### A — `t.timer({ms})` v0.2 engine integration
RFC 0001's deferred half. Engine subscribes to the SignalClock,
ticks timer facts directly, eliminates the consumer-side
`setInterval(() => sys.events.TICK())` from the v0.1 pattern.
~1-1.5 weeks per the RFC. Needs:
- `t.timer({ms})` schema-builder
- Engine integration in `packages/core/src/core/engine.ts`
- Replay determinism for engine-emitted timer ticks
- AE-review-loop on the new surface

### B — RFC 0002 implementation (`unregisterModule()` + multi-instance)
Drafted in `docs/rfcs/0002-unregister-and-multi-instance.md`. Needs
AE-review-loop on the doc + at least one concrete Minglingo
prototype before implementation. Estimated 2-3 weeks per the RFC.
Best-fit prototype: `turnMachine`-per-turn pattern from the
realtime cluster.

### C — R1.A v0.2 (auto-derived vitest source codegen)
The scaffold that shipped this session reconstructs and replays
dispatches. v0.2 generates a vitest source file from a serialized
timeline:
- `directive replay <id>.json` CLI
- `vi.mock(...)` stub generation from recorded `resolver.start` /
  `resolver.complete` pairs
- Determinism gate — assert replay's frame stream matches input
  byte-for-byte
- Updates `@directive-run/cli`

### D — R1.B causal-graph vitest matchers
`expect(timeline).toReachIn(N).ms('status', 'ready')` etc. New
package: `@directive-run/timeline-matchers`. ~2 days per the
innovation review.

### E — R1.C `defineMutator.cancellable()`
AbortSignal plumbing through mutator handlers + supersession-aware
cancellation. Closes type-ahead/debounce/throttle/dedup as 3-line
declarations. ~2 days. Needs RFC 0001 v0.2 (engine timer
integration) for the timeout side.

### F — R1.D live timeline scrubber UI
WebSocket-streamed `system.observe()` + browser scrubber. ~1 week.
The HN front-page screenshot.

### G — R1.E `defineMutator.invariant(...)`
Inline state-machine spec compiled into a constraint. ~1 week.
Risky scope creep; needs aggressive cap on surface (one invariant
per mutation, no nesting).

### H — Minglingo XState legacy sweep (54 machines)
Each machine has consumer-side `useMachine(...)` calls that need
provider-refactor (the same shape as the `NotificationProvider` work
already done). ~30-60 minutes per cycle × 54. Multi-session. Pre-launch
priority is low — the duplicate-path code isn't shipping to users.

### I — Kite ↔ Minglingo integration (Workstream A from the original 12-week plan)
12 weeks. Phase 1 (local adapter) → Phase 2 (Postgres-coord dev only)
→ Phase 3 (CF DO authoritative party + game runtimes). Paused since
Minglingo isn't launched. Unblocks when product launches.

### J — IntentKit
Your primary CWD project. `STATUS.md` at
`/Users/jasonwcomes/Desktop/Sizls/projects/intentkit/STATUS.md` is
authoritative. Whatever is next on its roadmap is its own session
focus.

## Minglingo state at session close

- 3 commits ahead — flushAsync migration (`c496727`), outliers
  cleanup (`a1719ae`), pre-launch single-Directive notification
  provider with `useFact`/`useDerived` (`3736c80`).
- 53 XState machines still coexist with their Directive ports — see
  Track H above.
- Working tree has unrelated dirty state in `.claude/` that I left
  untouched.

## Session context for cold-start

The retrospective post at
`/Users/jasonwcomes/Desktop/Sizls/projects/directive/docs/posts/migrating-55-machines.md`
is the best ~12-min read for someone picking up this work cold. It
covers:

- Why Directive (Sizls-stack alignment, dogfooding rationale)
- The migration cycle template (six stages × 55 machines)
- LOC delta by machine shape (-40-50% on query-driven; flat on FSMs)
- The pattern catalog (`pendingAction`, `status`-as-event-bus, etc.)
- The 26 framework gaps + verdict matrix (in `MIGRATION_FEEDBACK.md`)
- What shipped back to Directive itself (7 P0s + 3 packages + 1 RFC)
- What this teaches about state-management framework design

The backlog tracks above (A-J) are the next-session candidates. Pick
based on priority + available time.

## Last green test count

`3996 / 3997 (1 skipped, 0 failures)` — `npx vitest run` from
`/Users/jasonwcomes/Desktop/Sizls/projects/directive`.
