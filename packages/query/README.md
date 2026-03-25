# @directive-run/query

Declarative data fetching for Directive. Constraint-driven queries with causal cache invalidation.

[![npm](https://img.shields.io/npm/v/@directive-run/query)](https://www.npmjs.com/package/@directive-run/query)

## Install

```bash
npm install @directive-run/query @directive-run/core
```

## Quick Start

```typescript
import { createModule, createSystem, t } from "@directive-run/core";
import { createQuery, withQueries } from "@directive-run/query";

const user = createQuery({
  name: "user",
  key: (facts) => facts.userId ? { userId: facts.userId } : null,
  fetcher: async (params, signal) => {
    const res = await fetch(`/api/users/${params.userId}`, { signal });
    return res.json();
  },
  refetchAfter: 30_000,
});

const app = createModule("app", withQueries([user], {
  schema: { facts: { userId: t.string() } },
  init: (facts) => { facts.userId = ""; },
  events: {
    setUser: (facts, { id }) => { facts.userId = id; },
  },
}));

const system = createSystem({ module: app });
system.start();
system.facts.userId = "42"; // Query fires automatically
```

React — zero new hooks:

```tsx
const { data, isPending, error } = useDerived(system, "user");
```

## Why Not TanStack Query?

TanStack Query is excellent. Use it if you're happy with it. Directive Query adds things no competitor can:

1. **Causal cache invalidation** — no query keys, no manual invalidation. Change a fact, the query re-fetches.
2. **`explainQuery("user")`** — "Why did that fetch?" Full causal chain.
3. **Time-travel through API responses** — cache is facts, facts are snapshotted.
4. **Constraint composition** — queries depend on queries via auto-tracked facts.

## API

### createQuery (pull-based)

For request/response data: REST, GraphQL, gRPC, AI agents.

```typescript
createQuery({
  name: "user",
  key: (facts) => facts.userId ? { userId: facts.userId } : null,
  fetcher: async (params, signal) => api.getUser(params.userId),
  transform: (raw) => normalizeUser(raw),
  refetchAfter: 30_000,
  expireAfter: 5 * 60_000,
  retry: { attempts: 3, backoff: "exponential" },
  tags: ["users"],
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  placeholderData: (prev) => prev,
  onSuccess: (data) => console.log("Fetched:", data),
});
```

### createMutation (write + invalidate)

```typescript
createMutation({
  name: "updateUser",
  mutator: async (vars, signal) => api.updateUser(vars),
  invalidateTags: ["users"],
  onMutate: (vars) => ({ previous: currentData }),
  onSuccess: (data, vars, context) => { /* ... */ },
  onError: (error, vars, context) => { /* rollback */ },
});
```

### createSubscription (push-based)

For WebSocket, SSE, AI streaming.

```typescript
createSubscription({
  name: "price",
  key: (facts) => facts.ticker ? { ticker: facts.ticker } : null,
  subscribe: (params, { onData, onError, signal }) => {
    const ws = new WebSocket(`wss://api.example.com/${params.ticker}`);
    ws.onmessage = (e) => onData(JSON.parse(e.data));
    ws.onerror = () => onError(new Error("Connection lost"));
    signal.addEventListener("abort", () => ws.close());
    return () => ws.close();
  },
});
```

### withQueries (merge into module)

```typescript
const module = createModule("app", withQueries([user, posts, notifications], {
  schema: { facts: { userId: t.string() } },
  // ... your module config
}));
```

### explainQuery (the differentiator)

```typescript
import { explainQuery } from "@directive-run/query";

console.log(explainQuery(system, "user"));
// Query "user"
//   Status: refetching in background (stale-while-revalidate)
//   Cache key: {"userId":"42"}
//   Data age: 45s
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
  dataUpdatedAt: number | null;
}
```

## License

[MIT OR Apache-2.0](../../LICENSE)
