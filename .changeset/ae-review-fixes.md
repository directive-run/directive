---
"@directive-run/core": patch
"@directive-run/react": patch
"@directive-run/vue": patch
"@directive-run/svelte": patch
"@directive-run/solid": patch
"@directive-run/lit": patch
---

AE review fixes + test coverage for new features

**Core:**
- Fix: `reconcile.end` observation event fields renamed to `resolversCompleted`/`resolversCanceled` (correct semantics)
- Fix: Observer cap (100 max) prevents memory leaks from fast-remounting components
- Fix: `hasPlugins` cached as boolean for O(1) hot-path access
- Fix: Knowledge docs `inspect()` section rewritten with correct field names
- Tests: 8 tests for `system.observe()`, 9 tests for coverage/observer utilities

**Adapters (React, Vue, Svelte, Solid, Lit):**
- All 5 framework adapters migrated to `#is-development` compile-time imports
- Tests: 6 tests for `createDirectiveContext` (useFact, useDerived, useEvents, Provider override, error boundary, useSystem)
