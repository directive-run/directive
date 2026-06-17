---
"@directive-run/core": patch
---

Stop `constraint.binding.disabled` from flooding observers on hot
async constraints, and preserve `clobberAlertPlugin` telemetry past
the per-resolver rate-limit cap with a new `onSummary` callback.

**`constraint.binding.disabled` is now deduped per (constraint, reason).**
The event (and its companion dev-mode `console.warn`) fires at most
once per (constraint id, reason) pair across the lifetime of the
registered constraint. A hot async-disabled constraint that dispatches
thousands of times per second produces exactly one event per reason,
so SIEM and log streams cannot be flooded by the binding-disabled
signal. The bit clears on `unregister()` so re-registering a
constraint resets the once-per-lifetime contract.

**New `onSummary` callback on `clobberAlertPlugin`.** When the engine's
per-resolver clobber rate-limit folds the 11th+ per-write event into a
single `kind: "summary"` event, `onSummary` now surfaces it — but only
when the resolver is in `irreversibleResolvers` OR has previously
fired `onAlert` in this session. That preserves SIEM telemetry on
resolvers that have proven they touch irreversible state, without
flooding on noise resolvers whose summary events are expected.

```ts
clobberAlertPlugin({
  irreversibleResolvers: ["chargeCard"],
  onAlert: (e) => pagerduty.trigger({ ... }),
  // NEW: also page when N>10 clobbers fold into one summary.
  onSummary: (e) => pagerduty.trigger({
    severity: "critical",
    summary: `${e.resolver} suppressed ${e.dropped} clobbers past the cap`,
    details: e,
  }),
});
```

`ClobberSummaryEvent` carries `resolver`, `requirementId`, `dropped`,
`matchedBy: "resolver-listed" | "prior-irreversible-alert"`, and
`timestamp`. A throwing `onSummary` callback is caught and surfaced
via `console.error` so it never breaks the resolver dispatch path —
parity with the existing `onAlert` error isolation.

Tests: 5360 → 5365 across the monorepo (+5: dedupe across many
dispatches, three `onSummary` paths, one `onSummary`-throws path).
