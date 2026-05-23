---
"@directive-run/core": minor
"@directive-run/cli": minor
---

feat: parameter sweep (`sweepUnder` + `directive tune`)

`replayUnder` diffs *one* proposed predicate against the original.
`sweepUnder` is the grid-search counterpart: take a predicate template
with one or more `{ $hole: "name" }` markers, sweep candidate values,
return the whole response curve plus the argmax under a user-supplied
objective.

```ts
import { sweepUnder } from "@directive-run/core";

const report = sweepUnder({
  frames: recordedSessions,
  original: { cartTotal: { $gte: 100 } },
  template: { cartTotal: { $gte: { $hole: "threshold" } } },
  sweep: { threshold: [25, 50, 100, 200] },
});

report.best.values;                  // { threshold: 25 }
report.best.report.proposed.matched; // 9210
report.baseline.score;               // 4217 — original's matched count
```

Multi-hole sweeps grid-search:

```ts
sweepUnder({
  ...
  template: {
    $all: [
      { riskScore: { $gte: { $hole: "minRisk" } } },
      { age:       { $gte: { $hole: "minAge"  } } },
    ],
  },
  sweep: { minRisk: [0.5, 0.7, 0.9], minAge: [13, 18, 21] },
});
// → 9 points (3 × 3)
```

`MAX_SWEEP_POINTS = 10,000` caps the grid so runaway sweeps throw at
the start rather than at frame 100,000.

The CLI wraps it:

```
directive tune --history sessions.json --original current.json \
  --template proposed-template.json --sweep threshold:25..200:25
```

Numeric range syntax `start..end:step` or discrete `key:val1,val2,val3`.
The curve renders as an ASCII table with a per-row bar plus a one-line
sparkline; the argmax row highlights green.

Same caveats as `replayUnder` apply (no cascade modeling, survivorship
bias, frames-vs-entities) — see `docs/concepts/tune.md`.
