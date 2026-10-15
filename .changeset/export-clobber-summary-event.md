---
"@directive-run/core": patch
---

Export `ClobberSummaryEvent` from `@directive-run/core/plugins`. It is the parameter type of `clobberAlertPlugin({ onSummary })`, which could not be named without reaching into an internal module.
