---
"@directive-run/core": minor
---

`abortOn:` rename Tier 2: verb-consistency, defensive coverage, async-disable observability, new `clobberAlertPlugin`.

Follow-on to the v1.22.0 `owns:` → `abortOn:` rename, closing the
remaining items an adversarial review panel surfaced.

**Verb consistency across the lifecycle surface.** Three verbs collapsed
to two coherent layers:

- `abortOn:` (declarative on constraint)
- `ctx.signal` (AbortSignal, Web Platform name)
- `resolversManager.abort()` / `resolversManager.abortAll()` (was
  `cancel()` / `cancelAll()` — renamed for symmetry with
  `AbortController.abort()`)

`ResolversManager` is `@internal`, so the rename is not a public API
break for consumers — only adapter authors hitting the internal manager
will see the new names.

**Defensive parity for `bind:` v2 reservation.** A new
`validateBindKeys` (mirroring `validateAbortOnKeys`) rejects reserved
property names (`__proto__`, `constructor`, `prototype`, `$`-prefixed)
on the `bind:` field at module-registration time. `bind:` has no runtime
semantics yet — but the validator ships now so the symmetry with
`abortOn:` is locked in code review before any v2 runtime wires the
field. Closes the reserved-key bypass surface preemptively.

**SIEM-facing observation event for async-disabled bindings.** The
engine now emits `constraint.binding.disabled { id, reason }` when it
silently disables a constraint's `abortOn:` binding because the
constraint is async (`reason: "async-declared"` for `async: true` opt-in,
`reason: "async-promoted"` for a runtime-promoted `when()` that returned
a Promise). The dev-mode `console.warn` is unchanged — this is the
machine-facing pair, so production plugins can detect a constraint
silently losing its clobber-protection. Plugin hook:
`onConstraintBindingDisabled(id, reason)`.

**New `clobberAlertPlugin`** (under `@directive-run/core/plugins`). Default
high-severity alerting for clobber events landing on irreversible facts:

```ts
createSystem({
  module: m,
  plugins: [
    clobberAlertPlugin({
      irreversibleTags: ["money", "pii", "irreversible"], // default
      onAlert: (e) => pagerduty.trigger({
        severity: "critical",
        summary: `Clobber on ${e.fact} (${e.tags.join(", ")})`,
        details: e,
      }),
    }),
  ],
});
```

Fires `console.error` by default; route to PagerDuty / Slack / Sentry by
passing `onAlert`. Reads `system.meta.fact(name)?.tags` to filter — any
fact with at least one tag in `irreversibleTags` triggers the alert.
Per-fact cooldown supported (`cooldownMs`).

**Planned v2 `AbortDetector` interface naming.** The RFC's "Single-process
scope" section previously called the future multi-process interface
`ClobberDetector`. Renamed to `AbortDetector` in the RFC text before v2
ships, so the v2 interface name is verb-consistent with `abortOn:` from
day one. No runtime change (interface doesn't exist yet).
