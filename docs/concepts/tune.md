# Parameter sweep – `sweepUnder` / `directive tune`

`sweepUnder` answers the question `replayUnder` does not: **"what's the
best value for this rule's threshold?"** Where `replayUnder` diffs *one*
proposed predicate against the original, `sweepUnder` takes a
**template** with one or more `{ $hole: "name" }` markers, runs the
recorded history once per candidate value, and returns the whole
response curve plus the argmax under a user-supplied objective.

It is `replayUnder` in a loop, exposed as a single primitive.

## The shape of the problem

Every paywall threshold, fraud cutoff, rate-limit ceiling, and
discount-eligibility floor in every app is a hand-tuned magic number
that nobody has ever swept. The reason is plumbing – running a
parameter scan against last month's traffic was a multi-day project. It
isn't anymore.

```ts
import { sweepUnder } from "@directive-run/core";

const report = sweepUnder({
  frames: recordedSessions,
  original: { cartTotal: { $gte: 100 } },
  template: { cartTotal: { $gte: { $hole: "threshold" } } },
  sweep: { threshold: [25, 50, 75, 100, 150, 200, 300] },
});

report.best.values;                       // { threshold: 25 }
report.best.report.proposed.matched;      // 9210
report.baseline.score;                    // 4217 – original's matched count
report.points.length;                     // 7
```

## API

```ts
function sweepUnder<F>(options: SweepUnderOptions<F>): SweepReport;

interface SweepUnderOptions<F> {
  frames: readonly ReplayFrame<F>[];
  original: FactPredicate<F>;
  template: unknown;                                   // contains { $hole: name } markers
  sweep: Record<string, readonly unknown[]>;            // hole → candidate values
  objective?: (report: PredicateBacktestReport) => number;  // default: r => r.proposed.matched
  entityKey?: string;
  maxSamples?: number;                                   // default 0 – count-only
}

interface SweepReport {
  points: readonly SweepPoint[];   // one entry per candidate (cartesian-product order)
  bestIndex: number;
  best: SweepPoint;                 // = points[bestIndex]
  baseline: SweepPoint;             // original replayed against itself – score under same objective
}

interface SweepPoint {
  values: Record<string, unknown>;   // hole name → value for this point
  report: PredicateBacktestReport;   // full backtest output
  score: number;                     // objective(report)
}
```

The `objective` defaults to `(r) => r.proposed.matched` – maximize the
match count. Pass any function for other goals: minimize distance from
the baseline, maximize distinct-entity coverage, weight by business
value, anything. A throwing objective or non-finite return is logged
once and the offending point sinks in the ranking instead of crashing
the sweep.

> **Sweep values are opaque payloads, not templates.** A value that
> itself looks like `{ $hole: "x" }` lands literally in the proposed
> predicate – substitution never recurses into a substituted value.
> This means you cannot chain holes (which would be ambiguous anyway).

## Multi-hole grid search

Pass two holes and `sweepUnder` walks the cartesian product:

```ts
sweepUnder({
  frames,
  original,
  template: {
    $all: [
      { riskScore: { $gte: { $hole: "minRisk" } } },
      { age:       { $gte: { $hole: "minAge"  } } },
    ],
  },
  sweep: {
    minRisk: [0.5, 0.7, 0.9],
    minAge:  [13,  18,  21 ],
  },
});
// → 9 points (3 × 3), argmax under the default objective
```

The total grid size is capped at `MAX_SWEEP_POINTS` (10,000) – a sweep
larger than that throws at the start so a runaway grid can't crash a
process. Narrow the ranges or split the run.

## CLI

```
directive tune --history <frames.json> --original <orig.json> \
               --template <tmpl.json> --sweep <key:range>
```

| Option | Meaning |
| --- | --- |
| `--history <path>` | Recorded frames JSON (required) |
| `--original <path>` | Original predicate JSON – the baseline (required) |
| `--template <path>` | Predicate template with `{ "$hole": "name" }` markers (required) |
| `--sweep <key:range>` | Repeatable. Numeric range `key:25..200:25` or discrete `key:a,b,c` |
| `--entity-key <fact>` | Also report distinct-entity counts (e.g. `userId`) |
| `--json` | Emit the `SweepReport` as JSON |

The numeric range uses `start..end:step` syntax with `step` defaulting
to `1`. `25..275:50` produces `25, 75, 125, 175, 225, 275`. For
discrete values use comma-separated tokens – `plan:free,plus,pro`.

The output is a table with one row per candidate plus an ASCII
sparkline summarizing the curve. The argmax row renders in green:

```
$ directive tune --history sessions.json \
    --original current.json --template proposed-template.json \
    --sweep threshold:25..275:50 --entity-key userId

directive tune – parameter sweep

  frames evaluated   6
  baseline (current) matched 4 frames
  points evaluated   6

  sparkline   █▇▅▅▂▂

  threshold      matched    delta   userIds  bar
  25                   6       +2         6  ████████████████████████
  75                   5       +1         5  ████████████████████
  125                  3       -1         3  ████████████
  175                  3       -1         3  ████████████
  225                  1       -3         1  ████
  275                  1       -3         1  ████

  best – threshold=25 → matched 6 (score 6)
```

## Limitations

`sweepUnder` is `replayUnder` in a loop and inherits all of its
caveats – see the [predicate backtest concept page](./replay-under.md):

- **No cascade modeling.** Each candidate is scored against the
  recorded facts. Downstream behavior is not simulated.
- **Survivorship bias.** Only paths the system actually reached under
  the original rule are in the history. A loosened threshold's
  newly-eligible behavior is under-represented.
- **Frames, not entities, by default.** A polling fact counted across
  100 ticks for one user shows up as 100 matched frames, not one
  matched user. Pass `entityKey` to grade by distinct entities.

Treat the curve as **directional**, not as a behavioral forecast.
