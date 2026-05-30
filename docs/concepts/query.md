# `@directive-run/query` – declarative data fetching, causally invalidated

> Constraint-driven queries with **causal cache invalidation** – no
> query keys, no manual `invalidateQueries`, no `useEffect`. Change a
> fact, the query re-fetches. Ask the system "why did that fetch?" and
> it tells you.

## What it solves

Every data-fetching layer eventually grows the same three problems:

1. **Keying drift** – the query key array and the params you actually
   read out of state drift apart silently.
2. **Manual invalidation** – `queryClient.invalidateQueries(["users"])`
   in seventeen places that all need to stay in sync.
3. **No causal trace** – "why did that fetch?" has no answer beyond
   "something called refetch somewhere."

Directive's engine already tracks which facts a derivation reads. Layer
queries on top of that and the cache key is the fact set. Change a
fact, the cache key changes, the query re-fires.

```ts
import { createQuerySystem } from "@directive-run/query";

const app = createQuerySystem({
  facts: { userId: "" },
  queries: {
    user: {
      key: (f) => f.userId ? { userId: f.userId } : null,
      fetcher: async (p, signal) => {
        const res = await fetch(`/api/users/${p.userId}`, { signal });
        return res.json();
      },
    },
  },
  mutations: {
    updateUser: {
      mutator: async (vars, signal) => {
        const res = await fetch(`/api/users/${vars.id}`, {
          method: "PATCH",
          body: JSON.stringify(vars),
          signal,
        });
        return res.json();
      },
      invalidates: ["users"],
    },
  },
});

app.facts.userId = "42";                       // query fires automatically
const { data, isPending } = app.read("user");  // ResourceState
app.queries.user.refetch();                     // bound handle, no ceremony
app.mutations.updateUser.mutate({ id: "42", name: "New" });
app.explain("user");
// → "Query 'user' refetched because fact 'userId' changed '41' → '42'"
```

## Why this is different from TanStack Query

TanStack Query is excellent – use it if you are happy with it. Directive
Query adds four things no competitor ships:

1. **Causal cache invalidation** – no query keys, no manual
   invalidation. Change a fact, the query re-fetches.
2. **`explainQuery("user")`** – "Why did that fetch?" Full causal
   chain, every time.
3. **Time-travel through API responses** – cache is facts, facts are
   snapshotted by `@directive-run/core`'s history plugin.
4. **Constraint composition** – queries depend on queries via
   auto-tracked facts. `derivation(facts, derived) => derived.user.data?.role === "admin"`.

The tradeoff: queries live inside a Directive system. If you do not
already use one, the surface is bigger than TanStack's drop-in
`useQuery`. The simple path (`createQuerySystem`) erases most of that
cost.

## Choose your path

| Path | When | Setup |
| --- | --- | --- |
| `createQuerySystem` | Most apps. Single module, bound handles, auto-start. | 1 function, 1 import |
| `createQueryModule` | Multi-module systems. Compose queries with auth, UI, etc. | `createQueryModule` + `createSystem` |
| `createQuery` + `withQueries` | Full control – custom constraints, resolvers, cross-module deps. | `createQuery` + `withQueries` + `createModule` + `createSystem` |

## Setup – simple path

```ts
import { createQuerySystem } from "@directive-run/query";

const app = createQuerySystem({
  facts: { userId: "", ticker: "" },

  queries: {
    user: {
      key: (f) => f.userId ? { userId: f.userId } : null,
      fetcher: async (p, signal) => api.getUser(p.userId),
      tags: ["users"],
      refetchAfter: 30_000,
      keepPreviousData: true,
    },
  },

  mutations: {
    updateUser: {
      mutator: async (vars, signal) => api.updateUser(vars),
      invalidates: ["users"],
    },
  },

  subscriptions: {
    prices: {
      key: (f) => f.ticker ? { ticker: f.ticker } : null,
      subscribe: (params, { onData, onError, signal }) => {
        const ws = new WebSocket(`wss://api.example.com/${params.ticker}`);
        ws.onmessage = (e) => onData(JSON.parse(e.data));
        ws.onerror = () => onError(new Error("Connection lost"));
        signal.addEventListener("abort", () => ws.close());
        return () => ws.close();
      },
    },
  },

  infiniteQueries: {
    feed: {
      key: (f) => f.userId ? { userId: f.userId } : null,
      fetcher: async (p, signal) => api.getFeed(p.userId, p.pageParam),
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      initialPageParam: null,
    },
  },
});

// Bound handles – no passing facts around
app.queries.user.refetch();
app.queries.user.invalidate();
app.queries.user.setData(newData);
app.mutations.updateUser.mutate({ id: "42", name: "New" });
await app.mutations.updateUser.mutateAsync({ id: "42" });
app.infiniteQueries.feed.fetchNextPage();
app.subscriptions.prices.setData({ price: 150 });
app.explain("user");
// → causal chain string
```

## API surface

| Symbol | What |
| --- | --- |
| `createQuerySystem(config)` | Simple path. One call, bound handles, auto-start. |
| `createQueryModule(name, defs, moduleConfig)` | Module path. Compose with other modules under one system. |
| `createQuery(def)` | Single query definition. Use with `withQueries` for advanced wiring. |
| `createMutation(def)` | Single mutation. Carries `invalidateTags` to mark dependent queries stale. |
| `createSubscription(def)` | Long-lived data source – WebSocket, SSE, polling loop. |
| `createInfiniteQuery(def)` | Paginated query with `getNextPageParam`. |
| `createListQuery(def)` | N parallel queries, one `ResourceState` per active key. |
| `createBaseQuery(config)` | Shared fetcher factory – auth headers, error transforms, timeout. |
| `createGraphQLQuery` / `createGraphQLClient` | Typed GraphQL client over the same engine. |
| `withQueries(defs, moduleConfig)` | Merge query definitions into a hand-written module config. |
| `explainQuery(system, name)` | Causal chain – why did this query fetch? |
| `serializeKey(params)` | Canonical cache key (sorted, prototype-pollution-safe). Re-exported for framework adapters. |
| `persistQueryCache(system, storage, opts?)` | Persist + hydrate cache via your `QueryCacheStorage`. |

## ResourceState shape

Every query and subscription exposes a `ResourceState<T>` derivation:

```ts
interface ResourceState<T> {
  data: T | null;
  error: Error | null;
  status: "pending" | "error" | "success";
  isPending: boolean;
  isFetching: boolean;
  isStale: boolean;
  isSuccess: boolean;
  isError: boolean;
  isPreviousData: boolean;
  dataUpdatedAt: number | null;
  failureCount: number;
  failureReason: Error | null;
}
```

Reading is a derivation, so consumers re-render only when the
specifically-read field changes:

```tsx
import { useDerived } from "@directive-run/react";
const { data, isPending, error } = useDerived(system, "user");
```

## Examples

### List queries – "N items each fetched independently"

`createQuery` is intentionally singular: one `ResourceState` per query
name, key change replaces the entry. That fits page-level "current
entity" reads. For "render N cards each fetching its own data" – the
TanStack `useQuery({ queryKey: ["X", id] })`-per-component pattern – use
`createListQuery` (or the `listQueries:` config field on
`createQuerySystem`):

```ts
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

sys.facts.activeGameIds = ["abc", "xyz", "and-30-more-ids"];
// → one requirement per key, resolver runs in parallel per item

const drift = sys.listQueries.drift.peek({ gameId: "abc" });
if (drift?.isSuccess) renderCard(drift.data);
// → ResourceState | null
```

Cache is `Record<serializedKey, ResourceState>` – JSON-serializable so
time-travel snapshots and `structuredClone` keep working.

### Causal-cache invalidation – `explainQuery`

```ts
console.log(app.explain("user"));
// → Query "user"
// →   Status: refetching in background (stale-while-revalidate)
// →   Cache key: {"userId":"42"}
// →   Data age: 45s
// →   Last fetch causal chain:
// →     Fact changed: userId "41" → "42"
// →     Constraint: _q_user_fetch (priority 50)
// →     Resolved in: 145ms
```

The differentiator. No competing data layer can give you this because
the causal substrate – which facts drove which constraint to fire which
requirement – does not exist outside Directive.

### Shared fetcher config – `createBaseQuery`

```ts
const api = createBaseQuery({
  baseUrl: "/api/v1",
  prepareHeaders: (headers) => {
    headers.set("Authorization", `Bearer ${getToken()}`);
    return headers;
  },
  transformError: (error, response) => ({
    status: response?.status,
    message: error instanceof Error ? error.message : "Unknown error",
  }),
  timeout: 10_000,
});

const users = createQuery({
  name: "users",
  key: () => ({ all: true }),
  fetcher: (params, signal) => api({ url: "/users" }, signal),
});
// → users.fetch() now goes through the shared base
```

### Advanced – cross-module deps + custom resolvers

```ts
import { createModule, createSystem, t } from "@directive-run/core";
import { createQuery, withQueries } from "@directive-run/query";

const user = createQuery({
  name: "user",
  key: (facts) => facts.userId ? { userId: facts.userId } : null,
  fetcher: async (params, signal) => api.getUser(params.userId),
  transform: (raw) => normalizeUser(raw),
  refetchAfter: 30_000,
  expireAfter: 5 * 60_000,
  retry: { attempts: 3, backoff: "exponential" },
  tags: ["users"],
  keepPreviousData: true,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  placeholderData: (prev) => prev,
  suspense: true,
  throwOnError: true,
  onSuccess: (data) => console.log("Fetched:", data),
});

const app = createModule("app", withQueries([user], {
  schema: { facts: { userId: t.string() } },
  init: (facts) => { facts.userId = ""; },
}));

const system = createSystem({ module: app });
system.start();
```

## What it does NOT do

- ✅ Causal cache invalidation via the auto-tracked fact set.
- ✅ Bound handles (`refetch` / `invalidate` / `setData` / `mutate`).
- ✅ `explainQuery("name")` – why did this fetch?
- ✅ `ResourceState<T>` per query / subscription / list entry.
- ✅ Cache persistence via `persistQueryCache`.
- ❌ Not a transport library – you write the `fetcher`. Use `createBaseQuery` for shared config.
- ❌ Not a state-machine library – use `@directive-run/mutator` for discriminated mutations.
- ❌ Not a websocket client – the `subscribe` field is a thin shim over your transport of choice.
- ❌ **Streaming subscriptions: known v1 gap.** `createSubscription` covers callback-driven streams (WebSocket onmessage, SSE), but the chatbot / LLM-token-stream use case – where each chunk is a delta on a single resource – currently falls back to raw `fetch` + manual fact writes. Tracked for v2; do not block on it.
- ❌ Not magical – every query is a constraint + resolver under the hood. `inspect()` shows you exactly what was registered.

## See also

- [Package README on GitHub](https://github.com/directive-run/directive/tree/main/packages/query)
- [Introducing @directive-run/query](https://directive.run/blog/introducing-directive-query) – causal cache invalidation, bound handles, and `explainQuery`
- [Data Fetching with Directive](https://directive.run/blog/data-fetching-with-directive) – caching, invalidation, deduplication, polling
- [`@directive-run/mutator`](./mutator.md) – pairs naturally with query mutations for optimistic UI
- [`@directive-run/optimistic`](./optimistic.md) – snapshot + rollback for the optimistic write path
