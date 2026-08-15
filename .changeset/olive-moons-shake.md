---
"@directive-run/core": patch
"@directive-run/ai": patch
---

Three fixes for defects in 1.28.0 and 1.29.0, two of them silent data exposure
and one a duplicate side effect. Upgrade if you use `factPIIGuardrail` or run
chains longer than fifty reconcile passes.

**The personal-data screen could latch open permanently.** 1.28.0 taught it to
rebuild its screened-key list when the system's metadata changed. That rebuild
emptied the live list and marked itself current *before* asking which keys to
screen — so if the lookup failed, or answered with nothing, the screen was left
holding nothing with the marker already advanced, and every later write took the
"already current" shortcut. One transient fault, and the screen never looked
again. It now builds a new list to the side and swaps it in only on success, so
a failure leaves the previous screen in place and the next write retries.

**A single unscannable member switched the screen off for the whole value.** The
walker copies a value before inspecting it, and when that copy was refused — by
a function property, a class instance carrying methods, a DOM node — it reported
"nothing found", which a caller cannot tell from "scanned and clean". A payload
of `{ email, ssn, retry: () => {} }` committed both the address and the number
in the clear. A member the copier refuses says nothing about its siblings, so
refused members are now dropped and everything else is scanned.

**A reconcile chain longer than fifty passes could re-run resolvers that had
already finished.** 1.28.0 made a long-dormant depth ceiling reachable. It turned
out to be reachable by ordinary bounded work — a sixty-item queue drain, cursor
pagination, a backoff counter — and tripping it clears the requirement diff, so
every live requirement is treated as new and dispatched again, including ones
that had nothing to do with the long chain. For a resolver that charges a card
or sends a message, that is a duplicate. The ceiling is dormant again while a
proper instrument is built: depth cannot see the runaway it was aimed at anyway,
because a resolver that reschedules without writing a fact resets the counter
every pass.
