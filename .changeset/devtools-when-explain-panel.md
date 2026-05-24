---
"@directive-run/core": minor
---

feat: devtools panel renders per-clause `whenExplain` tree (R4.E)

The devtools floating panel now has a `Constraints` section that renders
the per-clause ✓/✗ breakdown for every data-form `when` constraint, live,
as evaluations fire. When `engine.explain()` would print:

```
constraint transition
  ✗ phase = red
  ✗ elapsed >= 30  (actual: 20)
```

…the panel now shows the same tree inline, color-coded (green for pass,
red for fail), and updates in place on every re-evaluation.

```ts
const trafficLight = createModule("traffic", {
  schema: { phase: t.string<"red" | "green">(), elapsed: t.number() },
  constraints: {
    transition: {
      // Data-form `when` — predicate, not function. Gives the panel
      // a structural tree to render.
      when: { phase: { $eq: "red" }, elapsed: { $gte: 30 } },
      require: { type: "TRANSITION" },
    },
  },
});

createSystem({
  module: trafficLight,
  plugins: [devtoolsPlugin({ panel: true, defaultOpen: true })],
});
```

The plumbing already existed: `evaluatePredicateExplained` returns
`ClauseResult[]`, the `constraint.evaluate` observation event carries an
optional `whenExplain?: ClauseResult[]` field, and the engine gates
`explainWhen()` behind `hasPlugins()` so the per-clause walk only runs
when something is listening. This release is the **visual panel
renderer** that completes the loop.

Function-form `when` constraints (no predicate tree available) render
with the constraint id + active mark + a small "function-form when (no
clause tree)" note — no clause tree, no surprise.

Operators render with mathematical symbols (`=`, `≠`, `≥`, `∈`, …) and
the failed clause includes the actual value (`(actual: 20)`) so the
panel reads at a glance: *which clause is the blocker, and what value
would unblock it?*

Internals:

- New `renderConstraintRow` export from `@directive-run/core/plugins`
  (internal-tagged, but available for custom panel layouts).
- New `PanelRefs.constraintsSection` / `.constraintsBody` /
  `.constraintsCount` for downstream devtools consumers.
- Time-travel jumps wipe the clause tree and let the next reconcile
  repopulate it (avoids stale ✓/✗ from before the snapshot).
