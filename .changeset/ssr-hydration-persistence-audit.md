---
"@directive-run/core": patch
"@directive-run/react": patch
"@directive-run/vue": patch
"@directive-run/svelte": patch
"@directive-run/solid": patch
"@directive-run/lit": patch
"@directive-run/ai": patch
"@directive-run/query": patch
---

SSR hydration for all adapters, query cache persistence, audit fixes

- core: Add `mergeHydrationFacts` shared utility, cache `wrapWithNestedWarning` proxies, wire resolver key to engine, ship observability from .lab, add `getInflightCount()`, consolidate `safeStringify`
- react: `useHydratedSystem` uses shared `mergeHydrationFacts`
- vue: Add `DirectiveHydrator` component + `useHydratedSystem` composable
- svelte: Add `setHydrationSnapshot` + `useHydratedSystem`
- solid: Add `DirectiveHydrator` + `useHydratedSystem`
- lit: Add `HydrationController` with lifecycle management
- ai: Split orchestrator (8.7K -> 7.4K LOC), rename `dispose()` to `destroy()`, enable bundle splitting (246KB -> 109KB), remove legacy shims
- query: Add `persistQueryCache` plugin for offline cache persistence
