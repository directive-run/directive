# @directive-run/query

Declarative data fetching for Directive. Constraint-driven queries with causal cache invalidation.

[![npm](https://img.shields.io/npm/v/@directive-run/query)](https://www.npmjs.com/package/@directive-run/query)

## Install

```bash
npm install @directive-run/query @directive-run/core
```

## Quick Start

```typescript
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
          method: "PATCH", body: JSON.stringify(vars), signal,
        });
        return res.json();
      },
      invalidates: ["users"],
    },
  },
});

// Use it
app.facts.userId = "42";                      // query fires automatically
const { data, isPending } = app.read("user"); // ResourceState
app.queries.user.refetch();                   // bound handle, no ceremony
app.mutations.updateUser.mutate({ id: "42", name: "New" });
app.explain("user");                          // "why did that fetch?"
```

React:

```tsx
const { data, isPending, error } = useDerived(system, "user");
```

## Why Not TanStack Query?

TanStack Query is excellent. Use it if you're happy with it. Directive Query adds things no competitor can:

1. **Causal cache invalidation** — no query keys, no manual invalidation. Change a fact, the query re-fetches.
2. **`explainQuery("user")`** — "Why did that fetch?" Full causal chain.
3. **Time-travel through API responses** — cache is facts, facts are snapshotted.
4. **Constraint composition** — queries depend on queries via auto-tracked facts.

## Choose Your Path

| Path | When to use | Setup |
|------|------------|-------|
| **`createQuerySystem`** | Most apps. Single module, bound handles, auto-start. | 1 function, 1 import |
| **`createQueryModule`** | Multi-module systems. Compose query modules with auth, UI, etc. | `createQueryModule` + `createSystem` |
| **`createQuery` + `withQueries`** | Full control. Custom constraints, resolvers, cross-module deps. | `createQuery` + `withQueries` + `createModule` + `createSystem` |

## API

### createQuerySystem (simple path)

One call to create a fully wired system with bound handles.

```typescript
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

  // Optional
  plugins: [],
  history: { maxSnapshots: 50 },
  autoStart: true, // default
});

// Bound handles — no passing facts around
app.queries.user.refetch();
app.queries.user.invalidate();
app.queries.user.setData(newData);
app.mutations.updateUser.mutate({ id: "42", name: "New" });
await app.mutations.updateUser.mutateAsync({ id: "42" });
app.infiniteQueries.feed.fetchNextPage();
app.subscriptions.prices.setData({ price: 150 });
app.explain("user"); // causal chain
```

### createQueryModule (multi-module path)

For composing query modules with other modules in a namespaced system.

```typescript
import { createModule, createSystem, t } from "@directive-run/core";
import { createQueryModule, createQuery, createMutation } from "@directive-run/query";

const dataModule = createQueryModule("data", [
  createQuery({ name: "user", key: ..., fetcher: ... }),
  createMutation({ name: "updateUser", mutator: ..., invalidateTags: ["users"] }),
], {
  schema: { facts: { userId: t.string() } },
  init: (f) => { f.userId = ""; },
});

const system = createSystem({
  modules: { data: dataModule, auth: authModule, ui: uiModule },
});
system.start();

system.facts.data.userId = "42";  // namespaced
system.read("data.user");         // namespaced derivation
```

### createQuery (advanced path)

For full control with custom constraints, resolvers, and cross-module deps.

```typescript
import { createModule, createSystem, t } from "@directive-run/core";
import { createQuery, withQueries } from "@directive-run/query";

const user = createQuery({
  name: "user",
  key: (facts) => facts.userId ? { userId: facts.userId } : null,
  fetcher: async (params, signal) => api.getUser(params.userId),
  transform: (raw) => normalizeUser(raw),
  refetchAfter: 30_000,
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

### createBaseQuery (shared fetcher config)

```typescript
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
```

### explainQuery (the differentiator)

```typescript
console.log(app.explain("user"));
// Query "user"
//   Status: refetching in background (stale-while-revalidate)
//   Cache key: {"userId":"42"}
//   Data age: 45s
//   Last fetch causal chain:
//     Fact changed: userId "41" -> "42"
//     Constraint: _q_user_fetch (priority 50)
//     Resolved in: 145ms
```

## ResourceState\<T\>

Every query and subscription exposes a `ResourceState<T>` derivation:

```typescript
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

## License

[MIT OR Apache-2.0](../../LICENSE)
