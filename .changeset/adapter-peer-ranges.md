---
"@directive-run/react": patch
"@directive-run/vue": patch
"@directive-run/svelte": patch
"@directive-run/solid": patch
"@directive-run/lit": patch
---

**The framework adapters now declare the core version they actually need.** All five accepted `@directive-run/core@^1.0.0` while calling `system.destroyAsync()`, which core did not have until 1.18.0.

A range is a promise about what will work. This one let a package manager resolve a core anywhere in the 1.x line, report no conflict, and hand the adapter a system object with no `destroyAsync` on it — so unmounting a component threw `system.destroyAsync is not a function` at the one moment a teardown path is least likely to be covered by a test. The floor is `^1.18.0` on all five.

`@directive-run/lit` also declares `@directive-run/query` as an optional peer. It exports `QuerySystemController`, whose own documentation tells you to import `createQuerySystem` from `@directive-run/query`, and it listed no query peer at all — so the one adapter with a query integration was the one that never told you it had one. React, Vue, Svelte and Solid already declared it this way.

Nothing about the code changed. If your installed versions already satisfy the corrected ranges, upgrading changes nothing you can observe; if they do not, you now get the resolution warning that should have been there.
