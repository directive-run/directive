---
"@directive-run/core": minor
"@directive-run/cli": minor
---

feat: counterfactual rule replay (`replayUnder` + `directive replay-under`)

Replay a recorded fact-state history through a *proposed* change to a
constraint's `when` predicate and get a before-you-merge impact report:
how many frames matched under the current rule, how many would match
under the proposed one, and the exact frames that newly match or no
longer match.

```ts
import { replayUnder } from "@directive-run/core";

const report = replayUnder({
  frames: recordedHistory,                        // [{ id, facts }, ...]
  original: { phase: "red" },                     // the current `when`
  proposed: { phase: "red", elapsed: { $gte: 30 } }, // the proposed `when`
});

report.original.matched; // 4
report.proposed.matched; // 2
report.delta;            // -2
report.lostMatches;      // sampled frames, with per-clause explain
```

The mechanism is pure — each recorded frame is evaluated against both
predicates with `evaluatePredicate`, and the boolean is diffed. The
previous frame's facts are threaded as `prev`, so a replayed effect
`on` predicate using `$changed` replays correctly too. Diff frames
carry an `evaluatePredicateExplained` breakdown so you can see which
clause flipped.

The CLI wraps it:

```
directive replay-under --history sessions.json \
  --original current-rule.json --proposed tightened-rule.json
```

History JSON is accepted as a bare array of frames, an object with a
`frames` array, or a bare array of fact objects. `--json` emits the
full `CounterfactualReport`.

This builds directly on the RFC-0004 data-form predicate runtime — a
predicate is data, so it can be re-evaluated against history a function
`when` never could. See `docs/concepts/replay-under.md`.
