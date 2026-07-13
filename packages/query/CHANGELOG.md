# @directive-run/query

## 1.2.1

### Patch Changes

- [`3a86db7`](https://github.com/directive-run/directive/commit/3a86db7a9ff55cff81150eadc766ae3ca47e5790) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Bump `vitest` to `^3.2.6` across every package that pins it directly, closing GHSA-9crc-q9x8-hgqq (arbitrary file read via Vitest's UI server prior to 3.2.6). Dev-dependency only — no runtime code ships to consumers changes. The full workspace test suite (5,383 tests across 195 files) runs green on 3.2.7.

  Per-package `test` scripts now delegate to the workspace root (`cd ../.. && vitest run packages/<name>/`) to match Vitest 3's cwd-relative `include` resolution.

## 1.2.0

### Minor Changes

- [`b529dfe`](https://github.com/directive-run/directive/commit/b529dfebb47c0bc0b1dd12765af575202c041254) Thanks [@jasoncomes](https://github.com/jasoncomes)! - `createSubscription` gains an `onComplete` callback for stream-terminal signalling.

  Push-based subscriptions previously had no way to say "the stream is done"
  distinct from "another value just arrived." Every `onData` call set
  `status: "success"` / `isFetching: false`, so streaming consumers couldn't
  tell a partial chunk from the final one. AI streaming code that finalised
  on the first success status would tear the underlying transport down after
  one or two tokens.

  ```ts
  const chat = createSubscription({
    name: "reply",
    key: (f) => (f.prompt ? { prompt: f.prompt } : null),
    subscribe: (params, { onData, onError, onComplete, signal }) => {
      const es = new EventSource(`/api/chat?prompt=${params.prompt}`);
      es.onmessage = (e) => {
        const frame = JSON.parse(e.data);
        if (frame.type === "done") {
          onComplete();
          es.close();
        } else {
          onData((prev) => (prev ?? "") + frame.text);
        }
      };
      es.onerror = () => onError(new Error("stream error"));
      signal.addEventListener("abort", () => es.close());
    },
  });
  ```

  `ResourceState<T>` now carries an `isComplete: boolean` flag:

  - `isSuccess && !isComplete` – data updated, more chunks may arrive
  - `isComplete` – stream ended cleanly, no further values will be pushed

  The flag is reset to `false` whenever the subscription is re-keyed.

  Also fixes a long-standing bug where the subscription effect re-ran on its
  own writes, firing the cleanup and aborting the live `AbortController` on
  the first emission. Prev-key bookkeeping now lives in a closure
  `WeakMap<facts, string>` instead of in the fact store, and prev state
  reads are untracked. The auto-tracked deps now match what `keyFn(facts)`
  reads, which is the right identity for a subscription.

  For one-shot queries and mutations, `isComplete` is always `false`.

### Patch Changes

- [`0a7326a`](https://github.com/directive-run/directive/commit/0a7326ad52e8c6123d78f1de30e881c8254d7ab6) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Subscription cleanup, atomic tag invalidation, louder matcher registration.

  Also includes a `@directive-run/vite-plugin-api-proxy` enhancement —
  new `cors?: boolean | CorsOptions` per-route option that wires up an
  opt-in OPTIONS preflight responder. The package is `"private": true`
  (not published to npm) so the bump is tracked only in this repo's
  internal history.

  - `@directive-run/query`: subscriptions whose `key()` returns `null` now
    reset both the in-memory prev-key bookkeeping and the resource state back
    to idle, so a future re-key to the same value establishes a fresh
    subscription (instead of the early-return skipping setup). Tag
    invalidation in `withQueries` now runs the "clear invalidated tags +
    fire each matching query trigger" sequence inside `$store.batch(...)`
    so a subscriber listening on both sides cannot observe a half-applied
    state.
  - `@directive-run/timeline`: matcher auto-registration emits a clear
    `console.warn` when `globalThis.__vitest_expect` isn't available
    instead of failing silently. The explicit `registerMatchers(expect)`
    path suppresses the duplicate warning. A new `isAutoRegistered()`
    helper lets tests assert the side-effect path took effect.

- [`9472c51`](https://github.com/directive-run/directive/commit/9472c51fc4dd5b513373bc019a5eff5bc134039f) Thanks [@jasoncomes](https://github.com/jasoncomes)! - `serializeKey` filters `__proto__`, `constructor`, and `prototype` out of
  input keys. The internal accumulator was already null-prototype but the
  input itself wasn't sanitised, which left a prototype-pollution surface
  the next time the serialized JSON was parsed and merged upstream. With
  the filter, a cache key shape that includes one of those names produces
  the same serialised string as one that does not.

## 1.1.0

### Minor Changes

- [`f2b306b`](https://github.com/directive-run/directive/commit/f2b306b86ea9df3820fedd7513d9b1e9f065524d) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add `createListQuery` – per-key cached fetches for the "N items each fetched independently" pattern

  `createQuery` is intentionally singular: one ResourceState per query name; key change replaces the entry. That fits page-level "current entity" patterns but breaks "render N cards each fetching its own data" – the canonical TanStack Query case where you'd call `useQuery({queryKey: ["X", id]})` N times and each component gets independent state.

  `createListQuery` keeps the rest of Directive Query's contract – facts as cache, ResourceState derivation, structural sharing, retry, polling – but the cache is `Record<serializedKey, ResourceState<T>>` instead of a single slot. The constraint emits ONE requirement per active key, so the resolver runs in parallel, one invocation per item. Existing requirement coalescing in core dedupes simultaneous fetches for the same key.

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

  - `createListQuery({name, keys, fetcher, refetchAfter, refetchInterval, retry, ...})` – most `createQuery` options carry over.
  - `keys: (facts) => TKey[] | null` – return the active list of keys (null/empty disables).
  - Bound handle (`system.listQueries.X`) exposes:
    - `peek(params)` – pure cache lookup, returns `ResourceState<T> | null`.
    - `refetch(params)` – single-key refetch.
    - `refetchAll()` – re-fire every active key.
    - `setData(params, data)` – optimistic write for one key.
    - `invalidate(params)` / `invalidateAll()` – mark stale.
  - New `bindListQueryHandle(facts, name)` for callers using `createModule` + `withQueries` directly (without `createQuerySystem`).

  **Why the storage is `Record<string, ResourceState>` (not `Map`):** facts must be JSON-serializable for time-travel snapshots and structuredClone safety. Plain objects keyed by `serializeKey()` round-trip cleanly. The derivation exposes the record directly – consumers iterate via `Object.entries()` or look up by stringified key (the bound handle's `peek()` does the lookup for you).

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
  - ai: Split the orchestrator into smaller modules, rename `dispose()` to `destroy()`, enable bundle splitting (246KB -> 109KB), remove legacy shims
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
