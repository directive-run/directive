---
"@directive-run/core": minor
---

Add `clobberLoopPlugin` — detects sustained clobber loops on a fact and emits a structured warning naming the participants, the clauses that co-fire, and the suggested fix. A single clobber on an `abortOn:`-bound fact is a benign race that the binding already catches and the audit ledger records. A *loop* is two or more resolvers whose `when:` predicates both satisfy a shared state and keep rewriting the fact every reconcile tick — invisible until a customer screenshots a flapping value, even though the audit ledger holds 800 clobbers/sec of evidence.

Defaults: 5 distinct-requirement rejections from 2+ resolvers within 1s fires one `resolver.clobber.loop.detected` event. The event carries a `PredicateOverlapProof` built from `flattenPredicate` + `compareClauses` (existing internals from `doctor`) so the warning points at the specific `whenSpec` clauses that co-fire — not just "these resolvers fight." Operands are PII-redacted at event-construction time via the audit-ledger's `redactWhenSpec` against `system.meta.byTag("pii")`; opt out via `capturePII: true`.

Production default sink is `console.error` to stderr (NOT noop), so the signal lands in CloudWatch / Loki / Datadog log pipelines even when consumers haven't explicitly wired routing. Dev defaults to `console.warn`. The plugin returns a `{ plugin, disable, enable, isEnabled }` handle so SREs can flip the detector off during incident response without redeploying. A companion `resolver.clobber.loop.resolved` event fires when the loop quiets, so monitoring shows "active loops" rather than "historical loops."

Audit-ledger captures both `resolver.clobber.loop.detected` and `resolver.clobber.loop.resolved` entries with cross-references (`rejectionSeqs`) back to the contributing `resolver.write.rejected` entries, so an auditor reading a loop entry can walk to every individual rejection.

Add reason-aware `RetryPolicy.shouldRetry`. The existing two-argument signature continues to work; an optional third `context` argument carries `{ reason: "clobbered" | "timeout" | "cancelled" | "error", clobber? }` so a retry policy can decide based on WHY the attempt failed. The motivating case: "retry on race-loss, fail loud on bug." Before this change, a clobber-induced abort never reached `shouldRetry` at all — the controller's aborted signal short-circuited the retry path silently. Now a resolver can express `shouldRetry: (err, n, ctx) => ctx?.reason === "clobbered" && n < 5` to opt into bounded retries on contention while still failing loud on real errors.
