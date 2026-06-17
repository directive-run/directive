---
"@directive-run/core": minor
---

Follow-ons to the v1.22.0 `owns:` → `abortOn:` rename: verb-consistent
abort lifecycle, defensive `bind:` validator, SIEM event for
async-disabled bindings, new `clobberAlertPlugin`.

**Verb-consistent abort lifecycle.** Three surfaces, one verb:

- `abortOn:` — declarative on the constraint
- `ctx.signal` — `AbortSignal` on the resolver context (Web Platform)
- `resolversManager.abort()` / `resolversManager.abortAll()` — renamed
  from `cancel()` / `cancelAll()` so the imperative method pairs with
  `AbortController.abort()`

`ResolversManager` is `@internal`, so the rename is not a public-API
break — only adapter authors hitting the internal manager will see the
new names.

**`validateBindKeys` defensive parity for the `bind:` v2 reservation.**
A new module-registration validator (mirroring `validateAbortOnKeys`)
rejects `__proto__`, `constructor`, `prototype`, and `$`-prefixed entries
on the `bind:` field. `bind:` has no runtime semantics yet — the
validator ships now so the reserved-key bypass surface stays closed
before any v2 runtime wires the field.

**SIEM-facing observation event for async-disabled bindings.** The
engine now emits a new `constraint.binding.disabled` observation event
(and `onConstraintBindingDisabled(id, reason)` plugin hook) when it
silently disables a constraint's `abortOn:` because the constraint is
async:

- `reason: "async-declared"` — the constraint def has `async: true`
- `reason: "async-promoted"` — `when()` returned a Promise at runtime
  (the author probably didn't realize they opted out of clobber
  protection)

The dev-mode `console.warn` is unchanged — this is the machine-facing
pair so production plugins can detect a constraint silently losing its
clobber protection.

**New `clobberAlertPlugin`** (under `@directive-run/core/plugins`).
Default high-severity alerting for `resolver.write.rejected` events
landing on facts that carry irreversible meta tags. Replace the default
`console.error` with a PagerDuty / Slack / Sentry call:

```ts
createSystem({
  module: m,
  plugins: [
    clobberAlertPlugin({
      irreversibleTags: ["money", "pii", "irreversible"], // default
      // Or list resolver IDs when irreversibility lives on the resolver
      // rather than on a fact tag:
      irreversibleResolvers: ["stripeCharge"],
      onAlert: (e) => pagerduty.trigger({
        severity: "critical",
        summary: `Clobber on ${e.fact} (${e.tags.join(", ")})`,
        details: e,
      }),
    }),
  ],
});
```

Reads `system.meta.fact(name)?.tags` to filter; either filter (tag or
resolver) firing triggers the alert. Cooldown keys by `(fact, resolver)`
pair so two different resolvers racing on the same fact both alert (a
real incident) while a single resolver retrying the same fact (noise)
is suppressed. A throwing `onAlert` callback is caught and surfaced via
`console.error` so it never breaks the resolver dispatch path.

**Future v2 `AbortDetector` interface naming.** The RFC's
"Single-process scope" section previously called the planned
multi-process interface `ClobberDetector`. Renamed to `AbortDetector`
in the RFC text before v2 ships, so the v2 interface name is
verb-consistent with `abortOn:` from day one. No runtime change — the
interface doesn't exist yet.
