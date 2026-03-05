---
"@directive-run/core": patch
---

Fix overly restrictive object schema type and update knowledge content.

- Loosen `t.object<T>()` generic constraint to accept any type, not just `Record<string, unknown>`
- Update AI docs, core docs, and all example files in knowledge package
