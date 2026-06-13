---
"@directive-run/sources": patch
---

Align the exported `VERSION` constant with `package.json`. The package shipped 0.3.0 while the runtime export still claimed `"0.1.0"`. Consumers reading the constant for gating got the wrong number.
