---
"@directive-run/optimistic": patch
---

Repair two README examples that didn't compile.

`withOptimistic<F>` is a single-generic curried helper, but two worked examples in the cancel-supersession layering section called `withOptimistic<Facts, "draft">(["draft"])(...)`. The second generic was a leftover from an older two-arg shape — copy-paste produced an "Expected 1 type argument, got 2" compile error. Dropped to `withOptimistic<Facts>` so the example matches the function's actual signature.

No code changes.
