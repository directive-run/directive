---
"@directive-run/query": patch
"@directive-run/react": patch
"@directive-run/vue": patch
"@directive-run/svelte": patch
"@directive-run/solid": patch
"@directive-run/lit": patch
---

Add @directive-run/query – declarative data fetching with causal cache invalidation.

New package: createQuery, createMutation, createSubscription, createInfiniteQuery, createBaseQuery, createGraphQLQuery, createGraphQLClient, createQuerySystem, createQueryModule, withQueries, explainQuery. 191 tests across 15 test files.

Framework adapters: useQuerySystem hook added to React, Vue, Svelte, Solid. QuerySystemController added to Lit. Factory pattern keeps @directive-run/query as zero-coupling optional dep.
