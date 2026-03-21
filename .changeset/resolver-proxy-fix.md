---
"@directive-run/core": patch
---

Fixed resolver facts proxy in multi-module systems to use the same scoped proxy as constraints/derive/effects. Previously, resolvers received a two-level namespace proxy (`facts.moduleName.key`) instead of the flat module-scoped proxy (`facts.key`), causing silent failures when writing facts. Also fixed batch resolver proxy wrapping (`resolveBatch`/`resolveBatchWithResults`) and added recovery for stuck requirements after reconcile max-depth bailout.
