---
"@directive-run/core": patch
---

`clobberAlertPlugin` refinements: optional `irreversibleResolvers` filter, cooldown keys by (fact, resolver), error-isolated `onAlert`.

Three follow-ons to the v1.22.0 `clobberAlertPlugin` after consumer-feedback patterns:

- **`irreversibleResolvers` option** — when irreversibility is modeled on the resolver (e.g. `stripeCharge`) rather than on a fact tag, list the resolver ID in `irreversibleResolvers`. The plugin OR's the two filters. The JSDoc on `irreversibleTags` now explains *why* tagging the fact is the default modeling choice (the audit event names the fact, not the side effect).
- **Cooldown keys by `(fact, resolver)`** — two different resolvers fighting on the same fact within the cooldown window now both alert (it's a different operational incident than one resolver retrying). The audit ledger still records every clobber regardless of cooldown.
- **`onAlert` error isolation** — a throwing `onAlert` callback (PagerDuty 503, Slack rate limit, etc.) is caught and surfaced via `console.error` so it never breaks the resolver dispatch path.

Plus a clearer dev-mode warning for declared-async constraints (`async: true`) explaining the workarounds. Symmetric with the existing runtime-promoted-async advice.

Adds 3 new tests covering the new filter and error-isolation paths.
