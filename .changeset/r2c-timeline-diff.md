---
"@directive-run/timeline": minor
"@directive-run/cli": minor
---

R2.C: `directive timeline diff` — semantic causal-graph diff between two serialized timelines

Not a textual JSON diff — a causal one. Reports per-category deltas (frame counts, constraint fires, mutation kinds, resolver runs, new errors) so a reviewer can see "Run B fired constraint `loadOnLoading` 3 extra times Run A didn't" without eyeballing a 4000-line diff.

The diff vocabulary mirrors `@directive-run/timeline/matchers` inverted into reporters: where the matcher surface asserts `toFireConstraint(id, count)` / `toMutate(kind)` / `toResolveWithinMs(resolver)`, the diff surfaces the same buckets as count deltas. Same vocabulary, opposite direction.

**`diffTimelines()` library API** (`@directive-run/timeline`):

```ts
import { diffTimelines, deserializeTimeline } from "@directive-run/timeline";

const a = deserializeTimeline(JSON.parse(goodJson));
const b = deserializeTimeline(JSON.parse(badJson));
const diff = diffTimelines(a, b);

if (diff.identical) {
  // semantically same — no further work
} else {
  for (const c of diff.constraintFires) {
    console.log(`'${c.id}': ${c.aCount} → ${c.bCount} (${c.delta})`);
  }
}
```

Result categories (only differing entries surface — identical ones are elided):
- `constraintFires` — per-constraint `constraint.evaluate` count delta, sorted by descending |delta|.
- `mutations` — per-mutation-kind dispatch count delta. Aligned with `replayTimeline`'s dispatchable filter (`pendingMutation` writes with `status: 'pending'` and a string `kind`).
- `resolverRuns` — per-resolver `start` / `complete` / `error` axis counts.
- `newErrors` — `constraint.error` / `resolver.error` / `effect.error` frames that appear on one side but not the other (or differ structurally at the same frame index).
- `identical` — fast `true` if no category surfaced any difference.

Defensive `safeStringify` guards the diff against unstringifiable error values (circular refs, BigInts, etc.) — diffing two timelines with hostile error payloads doesn't crash.

**`directive timeline diff` CLI** (`@directive-run/cli`):

```sh
directive timeline diff baseline.json regression.json
# Exit 0 = identical, 2 = differences found, 1 = CLI argument error.

directive timeline diff a.json b.json --json | jq .constraintFires
```

Exit code 2 (not 0/1) so CI can distinguish "diff found differences" from "CLI failed to run." Suitable as a CI gate on PRs that change state-management code.

**Tests:** 10 new library tests (identical, constraint deltas, sort order, mutations, resolver runs, errors, lifecycle frames ignored, circular refs, same-shape error elision, two empty timelines) + 9 new CLI tests (arg parsing, file errors, validation errors, identical exit 0, diverging exit 2, --json mode). Workspace: 4069 → 4088 (+19).

Closes R2.C from `docs/IDEAS.md`. Cascade-edge diff and Mermaid sequence-diagram emission are deferred to v0.2.
