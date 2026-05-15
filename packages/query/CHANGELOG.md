# @directive-run/query

## 1.1.0

### Minor Changes

- [`f2b306b`](https://github.com/directive-run/directive/commit/f2b306b86ea9df3820fedd7513d9b1e9f065524d) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add `createListQuery` — per-key cached fetches for the "N items each fetched independently" pattern

  `createQuery` is intentionally singular: one ResourceState per query name; key change replaces the entry. That fits page-level "current entity" patterns but breaks "render N cards each fetching its own data" — the canonical TanStack Query case where you'd call `useQuery({queryKey: ["X", id]})` N times and each component gets independent state.

  `createListQuery` keeps the rest of Directive Query's contract — facts as cache, ResourceState derivation, structural sharing, retry, polling — but the cache is `Record<serializedKey, ResourceState<T>>` instead of a single slot. The constraint emits ONE requirement per active key, so the resolver runs in parallel, one invocation per item. Existing requirement coalescing in core dedupes simultaneous fetches for the same key.

  ```ts
  import { createQuerySystem } from "@directive-run/query";

  const sys = createQuerySystem({
    facts: { activeGameIds: [] as string[] },
    listQueries: {
      drift: {
        keys: (f) =>
          f.activeGameIds.length > 0
            ? f.activeGameIds.map((id) => ({ gameId: id }))
            : null,
        fetcher: async ({ gameId }, signal) => {
          const res = await fetch(`/api/drift?id=${gameId}`, { signal });
          return res.json();
        },
        refetchAfter: 30_000,
      },
    },
  });

  // Page sets the active list:
  sys.facts.activeGameIds = ["abc", "xyz", ...32_more_ids];

  // Each card component reads its own entry by params:
  const drift = sys.listQueries.drift.peek({ gameId: "abc" });
  if (drift?.isSuccess) render(drift.data);
  ```

  **API surface:**

  - `createListQuery({name, keys, fetcher, refetchAfter, refetchInterval, retry, ...})` — most `createQuery` options carry over.
  - `keys: (facts) => TKey[] | null` — return the active list of keys (null/empty disables).
  - Bound handle (`system.listQueries.X`) exposes:
    - `peek(params)` — pure cache lookup, returns `ResourceState<T> | null`.
    - `refetch(params)` — single-key refetch.
    - `refetchAll()` — re-fire every active key.
    - `setData(params, data)` — optimistic write for one key.
    - `invalidate(params)` / `invalidateAll()` — mark stale.
  - New `bindListQueryHandle(facts, name)` for callers using `createModule` + `withQueries` directly (without `createQuerySystem`).

  **Why the storage is `Record<string, ResourceState>` (not `Map`):** facts must be JSON-serializable for time-travel snapshots and structuredClone safety. Plain objects keyed by `serializeKey()` round-trip cleanly. The derivation exposes the record directly — consumers iterate via `Object.entries()` or look up by stringified key (the bound handle's `peek()` does the lookup for you).

  **Why state is replaced (not mutated) on each write:** matches `createQuery`'s reactivity convention. The engine's fact-change tracker fires on reference replacement; in-place mutation of a record's keys would silently bypass it.

## 1.0.0

### Patch Changes

- Updated dependencies [[`a6a23b2`](https://github.com/directive-run/directive/commit/a6a23b2e52377a07bbbde52a89dcffcc3db2f826)]:
  - @directive-run/core@1.0.0

## 0.1.3

### Patch Changes

- [`627b7a7`](https://github.com/directive-run/directive/commit/627b7a7349fe2be0f3aca5bc54127aafba4863e0) Thanks [@jasoncomes](https://github.com/jasoncomes)! - SSR hydration for all adapters, query cache persistence, audit fixes

  - core: Add `mergeHydrationFacts` shared utility, cache `wrapWithNestedWarning` proxies, wire resolver key to engine, ship observability from .lab, add `getInflightCount()`, consolidate `safeStringify`
  - react: `useHydratedSystem` uses shared `mergeHydrationFacts`
  - vue: Add `DirectiveHydrator` component + `useHydratedSystem` composable
  - svelte: Add `setHydrationSnapshot` + `useHydratedSystem`
  - solid: Add `DirectiveHydrator` + `useHydratedSystem`
  - lit: Add `HydrationController` with lifecycle management
  - ai: Split orchestrator (8.7K -> 7.4K LOC), rename `dispose()` to `destroy()`, enable bundle splitting (246KB -> 109KB), remove legacy shims
  - query: Add `persistQueryCache` plugin for offline cache persistence

## 0.1.2

### Patch Changes

- [`97a780c`](https://github.com/directive-run/directive/commit/97a780c1d6bdf7b647e0118443dbedd6bbf6e6b7) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Post-release bug fixes:

  - Fix useSelector dep-retracking when selector function changes (React adapter)
  - Fix GraphQL headers function type (removed misleading facts parameter)
  - Fix expireAfter GC re-run bug (polling now restarts after re-activation cycles)
  - Cap mutateAsync pendingPromises Map at 100 with FIFO eviction
  - Harden replaceEqualDeep with Object.create(null) for prototype pollution defense
  - Document type inference tradeoff in createQuerySystem JSDoc
  - Add @directive-run/react install note to README

## 0.1.1

### Patch Changes

- [`0e51375`](https://github.com/directive-run/directive/commit/0e51375f17cb6b271b5af58b0c49f72b6ea945a5) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add @directive-run/query – declarative data fetching with causal cache invalidation.

  New package: createQuery, createMutation, createSubscription, createInfiniteQuery, createBaseQuery, createGraphQLQuery, createGraphQLClient, createQuerySystem, createQueryModule, withQueries, explainQuery. 191 tests across 15 test files.

  Framework adapters: useQuerySystem hook added to React, Vue, Svelte, Solid. QuerySystemController added to Lit. Factory pattern keeps @directive-run/query as zero-coupling optional dep.
