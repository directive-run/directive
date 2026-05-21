# Predicate backtest — rule-change impact

`replayUnder` answers one question: **"if I change this rule, how many
recorded frames would it have matched differently?"** — measured against
real recorded history, before you merge the change.

It works because a data-form `when` is a **predicate, not a function**.
A predicate can be re-evaluated against any fact snapshot, so a recorded
history of fact states can be replayed through a *proposed* predicate
and diffed against the original. A function `when` is a black box — you
cannot replay last month's traffic through it.

## Limitations — read this first

`replayUnder` is a *static backtest*, not a behavioral simulation. Two
limitations bound what the numbers mean:

> **No cascade modeling.** `replayUnder` does not re-run the engine. It
> re-scores the *recorded* facts against the proposed predicate. If the
> proposed rule would have fired differently, the resulting requirement,
> resolver, and downstream fact changes are NOT modeled — later frames
> remain exactly as the original run produced them. This is a predicate
> backtest, not a behavioral simulation. Treat the numbers as a
> divergence scan, not a forecast.

> **Survivorship bias.** The recorded history contains only states the
> system actually reached *under the original rule*. A loosened rule that
> would have opened new paths has no recorded frames for those paths —
> `replayUnder` will under-count its new matches. A tightened rule's
> later frames exist only because the original rule fired. The history is
> not a random sample of behavior; it is filtered by the policy you are
> changing. Treat results as directional, not exact.

Other v1 limitations:

- The CLI requires `--original` explicitly; it does not yet recover the
  constraint's current `when` from a live system's
  `inspect().constraints[].whenSpec`.
- Replay is level-based (matched frames), not edge-based (constraint
  fires). See [Level semantics](#level-semantics).
- The unit is **frames**, not users or sessions, unless you pass
  `entityKey` — see [Frames vs. entities](#frames-vs-entities).
- A `RegExp` operand does not survive `JSON.parse` — see the
  [serialization notes](../rfcs/0004-data-configuration-triggers.md) for
  predicates loaded from JSON. `replayUnder` validates both specs up
  front and throws a clear error if a `$matches` clause carries a
  non-RegExp operand.

## The shape of the problem

Every team that has ever tightened a fraud rule, relaxed a paywall, or
moved an A/B threshold has asked the same thing: *how many recorded
frames would this have matched differently?* `replayUnder` answers it in
one function call, against the history you already have.

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

The returned `PredicateBacktestReport`:

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

Both specs are validated before the frame loop. A malformed spec — a
`$matches` operand that is not a RegExp, a non-predicate value, an
unknown `$frobnicate` operator — throws a clear `[Directive] replayUnder:`
error naming which spec (`original` / `proposed`) failed, rather than a
raw evaluation stack trace on frame 0.

A history larger than `MAX_REPLAY_FRAMES` (1,000,000) throws — split or
down-sample it first.

### Level semantics

`replayUnder` reports **matched frames** — frames where the predicate
evaluates true. A frame is one recorded fact snapshot. This is a level
measure ("the rule held here"), not an edge count ("the constraint
fired"); a rule that held across 100 consecutive frames matched 100
frames.

### Frames vs. entities

The base unit is a **frame** — one fact snapshot. `100` matched frames
could be one entity polled 100 times or 100 distinct entities matched
once. Without more information `replayUnder` cannot tell the two apart,
so by default it reports frames only — never "users" or "sessions".

To count distinct entities, pass `entityKey` — the fact key that
identifies an entity:

```ts
const report = replayUnder({
  frames,
  original: { plan: "free" },
  proposed: { plan: "free", logins: { $gte: 5 } },
  entityKey: "userId",
});

report.proposed.matched;          // 47 — matched frames
report.proposed.matchedEntities;  // 12 — distinct userId values
```

`original.matchedEntities` and `proposed.matchedEntities` are populated
only when `entityKey` is supplied. The CLI surfaces the same via
`--entity-key`.

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

## Recording a history

`replayUnder` needs a `ReplayFrame[]` — a chronological sequence of fact
snapshots. There are two real ways to capture one from a running system.

### From the history manager

A system created with `history: true` records a ring buffer of
snapshots. `system.history.export()` serializes them as JSON;
`framesFromHistory` converts that export into frames:

```ts
import { createSystem } from "@directive-run/core";
import { framesFromHistory, replayUnder } from "@directive-run/core";

const system = createSystem({ module, history: true });
// ...run the system...

const frames = framesFromHistory(system.history.export());
const report = replayUnder({ frames, original, proposed });
```

`framesFromHistory` accepts the parsed export object, the raw JSON
string, or a bare array of snapshots. The history ring buffer is capped
(`maxSnapshots`, default 100) — for a long-running capture, raise the
cap or use the `observe` recipe below.

### From `getSnapshot()` on each reconcile

For a capture not bounded by the ring buffer, push a snapshot on every
reconcile and convert with `framesFromSnapshots`:

```ts
import { framesFromSnapshots, replayUnder } from "@directive-run/core";

const snapshots: ReturnType<typeof system.getSnapshot>[] = [];
const stop = system.observe(() => {
  snapshots.push(system.getSnapshot());
});

// ...run the system; later...
stop();

const frames = framesFromSnapshots(snapshots);
const report = replayUnder({ frames, original, proposed });
```

This is the recommended path for an unbounded recording — it is a real,
working recipe with no ring-buffer limit.

Both helpers throw a clear `Error` on malformed input. Hand-authored
histories can also be passed directly as a `ReplayFrame[]`.

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
| `--entity-key <fact>` | Fact key identifying an entity — also reports distinct-entity counts |
| `--json` | Emit the full `PredicateBacktestReport` |

```
directive replay-under --history sessions.json \
  --original current-rule.json --proposed tightened-rule.json
```

With `--entity-key`, the report adds a distinct-entity line — "matched
47 frames across 12 userIds".

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

A frame that supplies its own `id` keeps it. A frame missing an `id`
(and every bare-fact frame) gets a `#`-prefixed index id (`"#0"`,
`"#1"`, …) so a fallback id can never collide with an explicit id in a
mixed history.
