# Counterfactual rule replay

`replayUnder` answers one question: **"if I change this rule, how many
times would it have behaved differently?"** — measured against real
recorded history, before you merge the change.

It works because a data-form `when` is a **predicate, not a function**.
A predicate can be re-evaluated against any fact snapshot, so a recorded
history of fact states can be replayed through a *proposed* predicate
and diffed against the original. A function `when` is a black box — you
cannot replay last month's traffic through it.

## The shape of the problem

Every team that has ever tightened a fraud rule, relaxed a paywall, or
moved an A/B threshold has asked the same thing: *how many users would
this have affected?* The usual answer is a data-science ticket and a
two-week turnaround. `replayUnder` answers it in one function call.

## `replayUnder()`

```ts
import { replayUnder } from "@directive-run/core";

const report = replayUnder({
  // Recorded fact-state frames, in chronological order.
  frames: [
    { id: "s1", facts: { phase: "red", elapsed: 10 } },
    { id: "s2", facts: { phase: "red", elapsed: 35 } },
    { id: "s3", facts: { phase: "green", elapsed: 50 } },
  ],
  // The constraint's current `when`.
  original: { phase: "red" },
  // The proposed replacement.
  proposed: { phase: "red", elapsed: { $gte: 30 } },
});
```

The returned `CounterfactualReport`:

```ts
{
  framesEvaluated: 3,
  original: { matched: 2 },   // frames the current rule matched
  proposed: { matched: 1 },   // frames the proposed rule matched
  delta: -1,
  newMatchCount: 0,           // frames: original false -> proposed true
  lostMatchCount: 1,          // frames: original true  -> proposed false
  unchanged: 2,
  newMatches: [],             // sampled diff frames, with clause explain
  lostMatches: [ /* { frameId, facts, originalExplain, proposedExplain } */ ],
}
```

The invariant always holds:

```
proposed.matched === original.matched + newMatchCount - lostMatchCount
```

### Level semantics

`replayUnder` reports **matched frames** — frames where the predicate
evaluates true. A frame is one recorded fact snapshot. This is a level
measure ("the rule held here"), not an edge count ("the constraint
fired"); a rule that held across 100 consecutive frames matched 100
frames.

### Diff samples

Up to `maxSamples` frames per bucket (default 20, `0` for count-only)
are attached as `ReplayDiffSample`s. Each carries the frame's facts plus
an `evaluatePredicateExplained` breakdown under **both** predicates — so
you can see exactly which clause flipped:

```ts
report.lostMatches[0];
// {
//   frameId: "s1",
//   facts: { phase: "red", elapsed: 10 },
//   originalExplain: [{ path: "phase", op: "$eq", expected: "red", actual: "red", pass: true }],
//   proposedExplain: [
//     { path: "phase",   op: "$eq",  expected: "red", actual: "red", pass: true  },
//     { path: "elapsed", op: "$gte", expected: 30,    actual: 10,    pass: false },
//   ],
// }
```

The previous frame's facts are threaded as `prev`, so a replayed effect
`on` predicate using `$changed` replays correctly too.

## CLI

```
directive replay-under --history <frames.json> --proposed <spec.json> [options]
```

| Option | Meaning |
| --- | --- |
| `--history <path>` | Recorded frames JSON (required) |
| `--proposed <path>` | Proposed predicate JSON (required) |
| `--original <path>` | Original predicate JSON (required in v1) |
| `--max-samples <n>` | Diff frames sampled per bucket (default 20) |
| `--json` | Emit the full `CounterfactualReport` |

```
directive replay-under --history sessions.json \
  --original current-rule.json --proposed tightened-rule.json
```

### History JSON formats

The `--history` file is accepted in three shapes:

```jsonc
// 1. A bare array of frames
[{ "id": "s1", "facts": { "phase": "red" } }, ...]

// 2. An object wrapping them
{ "frames": [{ "id": "s1", "facts": { "phase": "red" } }, ...] }

// 3. A bare array of fact objects — each is wrapped, keyed by index
[{ "phase": "red" }, { "phase": "green" }, ...]
```

## Limitations (v1)

- The CLI requires `--original` explicitly; it does not yet recover the
  constraint's current `when` from a live system's
  `inspect().constraints[].whenSpec`.
- Replay is level-based (matched frames), not edge-based (constraint
  fires). Grouping frames into sessions is left to the caller.
- A `RegExp` operand does not survive `JSON.parse` — see the
  [serialization notes](../rfcs/0004-data-configuration-triggers.md) for
  predicates loaded from JSON.
