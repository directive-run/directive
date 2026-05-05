# Directive v2.0 — Forward-Looking Plan

> **Status: deferred.** This document describes what a future Directive
> 2.0 release will look like when the queued work ships. **It is not the
> current release** — the current release is `1.4.0` (constraint-binding
> RFC + `useFactWithDefault`). See [release-notes for 1.4](./constraint-binding.md)
> for what shipped now.

## Why this doc exists

Directive's `main` branch carries 7 unreleased changesets that
collectively amount to a 2.0 release: the `timeline` and `mutator`
packages graduate from `0.x` to `1.0`, which (combined with the
`onlyUpdatePeerDependentsWhenOutOfRange` config flag) cascades a
major-version bump through the fixed-version group. Rather than
silently bundle this with an unrelated minor RFC, we deferred the
cascade to a deliberate 2.0 release with proper migration notes.

This file is the migration notes — staged ahead of time so the eventual
2.0 ship doesn't write them under deadline pressure.

## The deferred queue

Sitting in `.changeset/` waiting to consume on the next `pnpm changeset
version`:

- `r2a-bisect.md` — `directive bisect` CLI command + timeline minor
- `r2b-recordReplayable.md` — `recordReplayable()` HOC on mutator
- `r2c-timeline-diff.md` — `directive timeline diff` CLI + timeline minor
- `r2-fixpack.md` — R2 critical/major fixes from AE review
- `r5-fixpack.md` — R5 fix-pack closing R2.A/B/C criticals
- `r5-hardening.md` — production-readiness pass on R2 ship
- `cli-replay.md` — `directive replay <timeline.json>` command

All commits for these features are already on `main` and shipped as part of `1.4.0`'s
binary artifact — they're code-live, just changelog-deferred.

## Projected version bumps

| Package | 1.4.x | v2 (projected) | Cause |
|---|---|---|---|
| `@directive-run/core` | 1.4.0 | **2.0.0** | fixed-group cascade from `timeline` 1.0 |
| `@directive-run/react` | 1.4.0 | **2.0.0** | fixed-group cascade |
| `@directive-run/vue` | 1.4.0 | **2.0.0** | fixed-group cascade |
| `@directive-run/svelte` | 1.4.0 | **2.0.0** | fixed-group cascade |
| `@directive-run/solid` | 1.4.0 | **2.0.0** | fixed-group cascade |
| `@directive-run/lit` | 1.4.0 | **2.0.0** | fixed-group cascade |
| `@directive-run/ai` | 1.4.0 | **2.0.0** | fixed-group cascade |
| `@directive-run/cli` | 1.4.0 | **2.0.0** | new commands (bisect, replay, timeline diff) + dep on timeline 1.0 |
| `@directive-run/knowledge` | 1.4.0 | **2.0.0** | fixed-group cascade |
| `@directive-run/claude-plugin` | 1.4.0 | **2.0.0** | fixed-group cascade |
| `@directive-run/timeline` | **0.2.0** | **1.0.0** | API stabilization + bisect/diff additions |
| `@directive-run/mutator` | **0.2.0** | **1.0.0** | `recordReplayable()` HOC + R2 fixes |

The 2.0 major is honest about the dependency-shape change: `timeline`
and `mutator` graduate from `0.x` to `1.0`, and consumers of those
packages need to update their version ranges.

## What v2 will ship

### Timeline — durable replay primitives (`@directive-run/timeline`)

The `0.2 → 1.0` jump stabilizes the `serializeTimeline()` /
`replayTimeline()` API and adds two operator commands:

- **`directive bisect`** — git-bisect for timelines. Binary-searches a
  recorded timeline for the first frame whose inclusion in the replay
  prefix flips a user-supplied assertion from passing to failing. CLI
  surface mirrors `git bisect run`.
- **`directive timeline diff`** — semantic causal-graph diff between two
  serialized timelines. Reports per-category deltas (frame counts,
  constraint fires, mutation kinds, resolver runs, new errors) instead
  of textual JSON diff.

### Mutator — `recordReplayable()` HOC (`@directive-run/mutator`)

```ts
import { recordReplayable } from "@directive-run/mutator";
```

Wraps a mutator handler with the same supersession + timeout semantics
as `cancellable()`, plus a synchronous `onCancel` callback that fires
the moment the AbortController calls `abort()`. The callback receives
a `CancelEvent<F, P>` carrying the cancelled frame and payload —
useful for replay-aware mutations that want to emit a structured
cancel record into the timeline.

### CLI — `directive replay` (`@directive-run/cli`)

```bash
directive replay path/to/timeline.json
```

Replays a serialized timeline through a fresh module + system, emits
the final fact snapshot. Pairs with `serializeTimeline()` from
`@directive-run/timeline`.

## Projected breaking changes (when v2 ships)

### `@directive-run/timeline` 0.2 → 1.0

If you depend on `@directive-run/timeline` directly, update your
package.json range from `^0.2.0` to `^1.0.0`. The public surface
(`serializeTimeline`, `replayTimeline`, `ObservationEvent`) is
backwards-compatible across this jump — the major bump signals API
stability, not a behavioral break.

### `@directive-run/mutator` 0.2 → 1.0

Same shape: bump your range to `^1.0.0`. The `cancellable()` HOC's
public surface is unchanged. New `recordReplayable()` is purely
additive.

### Fixed-group cascade

If your project depends on multiple `@directive-run/*` packages
from the fixed group (any combo of core, react, vue, svelte, solid,
lit, ai, cli, knowledge, claude-plugin), bump them **together** to
`2.0.0`. Mismatched fixed-group versions are not supported.

```diff
 {
   "dependencies": {
-    "@directive-run/core": "^1.4.0",
-    "@directive-run/react": "^1.4.0"
+    "@directive-run/core": "^2.0.0",
+    "@directive-run/react": "^2.0.0"
   }
 }
```

## What WON'T be breaking in v2

Despite the major version bump, these stay backwards-compatible:

- Module schema syntax (`createModule`, facts/derivations/resolvers/events/effects)
- `useFact`, `useDerived`, `useEvent`, `useFactWithDefault` from `@directive-run/react`
- All existing constraint definitions (default `bind: 'none'` preserves
  current behavior — opt in per-constraint)
- `createSystem`, `system.start()`, `system.destroy()`
- Plugin contracts (`devtoolsPlugin`, `observabilityPlugin`)

Consumers will be able to bump from `1.4.0` to `2.0.0` and code keeps
running. The major bump is honest signaling that some peer-dep shapes
(`timeline` and `mutator`) crossed `0.x → 1.0`, not that anyone's code
broke.

## When v2 will ship

No fixed date. The trigger is one of:

1. A new feature lands that genuinely needs the `timeline` 1.0 surface
   (e.g. a new replay-debugger UI in `@directive-run/devtools`).
2. A consumer (Pluck, IntentKit, Minglingo, Kite) requests stable
   timeline APIs for their own production deployment.
3. The `.changeset/` queue grows past ~12 changesets and bundling
   becomes overdue regardless of trigger.

When the time comes, the release manager:

1. Reviews this doc and updates "v2-plan" → "v2-migration."
2. Runs `pnpm changeset version` (consumes all queued changesets).
3. Verifies the version bumps match the table above (or updates the doc).
4. Builds + tests.
5. Pushes to remote.
6. Runs `pnpm changeset publish`.
7. Renames this file `v2-plan.md` → archived.

## Why this doc lives here pre-release

Writing migration docs at release time creates the temptation to write
them quickly. Writing them ahead, while the constraint-binding RFC
is fresh in mind, locks the explanation while context is still
available. When v2 ships in (probably) Q3-2026, the migration story
is already documented — only date, version-confirmation, and any
last-minute additions need to be added.

If a queued feature changes shape between now and then, edit this
file. If a queued changeset gets dropped, delete its entry here too.
This is a living plan.
