---
"@directive-run/ai": patch
---

**`withBudget` now charges a call the provider counted and never finished, instead of recording it as free.**

A call that threw was charged only from the text it had delivered. That covered a stream cut short part-way through its answer and missed the case that costs the most: a run cancelled during time-to-first-token. Anthropic reports the input token count in its opening `message_start` frame, before a token of the answer exists, and bills for it whether or not the answer ever arrives. On a long transcript the input side is most of the bill. Under a guard that only measured delivered text, such a run went into the ledger at zero – with no delivery to measure, there was nothing to charge – and every window total, every lifetime ceiling, and every consumer reading accumulated spend to decide what a later step may spend was short by exactly the calls that failed most expensively.

Counts a stream reported before it failed now travel out on the error it throws, and the budget prices the call from them. Nothing is charged twice: the report covers the same call the delivered text does, and the two are reconciled rather than added. Where they disagree the larger figure wins, which matters because the two sides of a report arrive at different moments – Anthropic sends the input count in its first frame and the output count in its last, so a stream cut off in between carries a real input figure beside an output figure of zero, however much text has already arrived. The output side takes whichever is larger, the count or the measurement.

A failure that left nothing behind – a DNS failure, a refused connection, a throw before dispatch – is still charged nothing, since it cost nothing.

Every failed call is still counted as one the ledger could not price exactly, including the ones now priced from a report, and `getUnpricedCallCount()` and `maxUnpricedCalls` are unchanged in meaning. A report that arrived before a failure describes the part of the call that had happened by then and says nothing about what the provider billed afterwards, so the charge is a floor under the real figure rather than the figure itself, and the count is what says so.

`getSpent` and `getFailedCallSpend` will read higher than before for any runner whose calls are being cancelled or cut off. That is the correction: the money was always going out.
