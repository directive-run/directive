---
"@directive-run/core": patch
---

`clobberAlertPlugin` refinements: optional `irreversibleResolvers`
filter, `matchedBy` discriminator on the event payload, cooldown keys
by (fact, resolver), error-isolated `onAlert`, bounded cooldown map.

- **`irreversibleResolvers` option** — when irreversibility is modeled on
  the resolver (e.g. `stripeCharge`) rather than as a fact-meta tag, list
  the resolver ID in `irreversibleResolvers`. The plugin OR's the two
  filters. The JSDoc on `irreversibleTags` now explains *why* tagging the
  fact is the default modeling choice (the audit event names the fact,
  not the side effect).
- **`matchedBy: "tag" | "resolver" | "both"`** added to `ClobberAlertEvent`
  so consumers can route alerts based on which filter triggered them.
  `tags` may now be empty when only the resolver filter matched.
- **Cooldown keys by `(fact, resolver)`** — two different resolvers
  racing on the same fact within the cooldown window now both alert
  (a real incident) while a single resolver retrying the same fact
  (noise) is suppressed.
- **`onAlert` error isolation** — a throwing `onAlert` callback (PagerDuty
  503, Slack rate limit, etc.) is caught and surfaced via `console.error`
  so it never breaks the resolver dispatch path. The cooldown slot is
  stamped only after the callback succeeds, so a transient outage does
  not silence the next genuine alert.
- **Bounded cooldown map** — entries cap at 1000 with FIFO eviction so a
  long-running system with high resolver churn cannot grow memory
  unboundedly.

Plus a clearer dev-mode warning for declared-async constraints
(`async: true`) explaining the workarounds. Symmetric with the existing
runtime-promoted-async advice.

Adds 6 new tests covering the new filter, error isolation, `matchedBy`
discriminator, retry-after-throw, and the FIFO cap.
