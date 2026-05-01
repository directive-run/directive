---
"@directive-run/cli": minor
---

Add `directive replay <timeline.json>` command — wires the R1.A scaffold to the public CLI

Pairs with `@directive-run/timeline`'s `serializeTimeline()`. Workflow:

1. Production captures the last N seconds of timeline frames via `recordTimeline(sys, ...)` + `serializeTimeline(t)` and ships the JSON to a bug tracker.
2. A developer runs `directive replay bug-1234.json --system path/to/module.ts`.
3. The CLI loads the user's system, replays every dispatchable frame, prints `ReplayResult` (dispatched / skipped / truncated counts).

```sh
directive replay bug-1234.json --system src/app/system.ts
# ✓ replay complete: 47 dispatched / 18 skipped

directive replay error.json --system src/system.ts --json
# {"dispatched": 47, "skipped": 18, "truncated": 0}

directive replay error.json --system src/system.ts --max-frames 10000
```

**Options:**
- `--system, -s <path>` (required) — TypeScript file exporting a Directive system.
- `--max-frames <n>` — cap on frames replayed (default 100,000).
- `--all-frames` — walk every frame, not just dispatchable ones (diagnostic mode).
- `--json` — emit `ReplayResult` as JSON.
- `--verbose, -v` — per-frame trace.

**Peer dep:** `@directive-run/timeline@^0.2.0` is now an optional peer of `@directive-run/cli`. The CLI surfaces a clear install-prompt error if the user runs `directive replay` without it installed.

**v0.2 scope (deferred per `docs/IDEAS.md`):**
- `--as-test` flag emits a vitest source file with R1.B matchers.
- `--bisect <good.json>` for git-bisect over timeline frames (R2.A BUILD CANDIDATE).
- `--diff <other.json>` for causal-graph diff output (R2.C).

7 new tests covering arg parsing, file-not-found / invalid-JSON / invalid-shape error paths, plus a happy-path integration test that replays a synthetic mutator-shape frame against a stub system.
