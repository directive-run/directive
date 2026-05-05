---
"@directive-run/query": minor
---

Add `createListQuery` — per-key cached fetches for the "N items each fetched independently" pattern

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
