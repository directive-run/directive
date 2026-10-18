---
"@directive-run/ai": patch
---

`createJSONFileStore` now loads `node:path` lazily, so browser bundles of `@directive-run/ai` no longer pull it in. Path validation (including the `baseDir` escape check) now runs on the first load instead of at construction, and a rejected path throws from `getChunks()` / `size()` / `reload()`.
