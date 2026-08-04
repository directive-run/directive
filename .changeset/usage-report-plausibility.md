---
"@directive-run/ai": patch
---

**A usage report far under what the call delivered is no longer priced as written.** Reporting *no* usage was always safe — the ledger falls back to charging what it observed arriving and counts the call as unpriced. Reporting almost none was the hole: the figure was present, so it was trusted, and a call that delivered thousands of tokens was billed for the handful it admitted to.

That is the shape a gateway produces. Anthropic carries output tokens in `message_delta`, the second-to-last frame on the wire; a proxy that truncates, reorders or nulls the tail loses it while `message_stop` still arrives, so the stream closes cleanly and nothing looks wrong.

It went quiet everywhere at once, because every cap reads the same number: the graceful stop kept authorizing calls, the hard ceiling never tripped, and no overrun was announced. Measured against a real provider frame: **$1.53 spent against a $1.00 ceiling, reported as $0.81, with no event raised.**

A report is now checked against what arrived before it is used as a price. Past a wide margin it is treated as unusable rather than quietly corrected — the call is charged from what was observed and counted by `getUnpricedCallCount()`, so the ledger says out loud that it is a floor there.

The check is deliberately blunt, and it does not adjudicate small differences. Four characters per token is a rough count that under-measures code by a wide margin, so a report modestly below its delivery is ordinary and is left exactly as reported. What it catches is a count that is absent in all but name.

**A call whose result cannot be read is now charged.** The block that reads the provider's usage runs on caller-supplied data, and a property read can throw — an accessor over a disposed handle, a Proxy, a getter that asserts. That throw used to unwind past the recording entirely: nothing was charged, the unpriced count did not move, and a call that had in fact succeeded surfaced as a failure, which a retry policy then read as transient and bought again. It now charges what was observed, counts the call as unpriced, and returns the result.
