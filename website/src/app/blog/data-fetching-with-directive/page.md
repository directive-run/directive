---
title: Data Fetching with Directive
description: The complete guide to fetching, caching, invalidation, deduplication, cancellation, batching, optimistic updates, and polling – all with constraints and resolvers.
layout: blog
date: 2026-02-14
dateModified: 2026-02-14
slug: data-fetching-with-directive
author: directive-labs
categories: [Tutorial, Architecture]
---

Every React application grows a custom data-fetching layer. It starts with a `useEffect` and a loading boolean. Then you add retry logic. Then abort on unmount. Then deduplication so two components don't fetch the same data twice. Then cache invalidation. Then polling. Then optimistic updates for drag-and-drop.

Each layer is hand-built, tested in isolation, and subtly broken when composed with the others.

Directive has no built-in `useFetch` hook. Instead, constraints decide *when* to fetch, resolvers decide *how*, and everything else &ndash; deduplication, cancellation, retry, batching, polling &ndash; falls out of the same primitives you already use for business logic.

This post builds a Kanban board from scratch. One domain, every data-fetching pattern.

---

## The imperative version

Here's a typical `useBoard` hook for loading a Kanban board:

```typescript
function useBoard(boardId: string) {
  const [columns, setColumns] = useState<Column[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const retryCount = useRef(0);

  useEffect(() => {
    if (!boardId) {
      return;
    }

    // Cancel previous request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    retryCount.current = 0;

    const fetchBoard = async () => {
      try {
        const res = await fetch(`/api/boards/${boardId}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setColumns(data.columns);
        setLoading(false);
      } catch (err: any) {
        if (err.name === "AbortError") {
          return;
        }

        if (retryCount.current < 3) {
          retryCount.current += 1;
          const delay = Math.min(1000 * 2 ** retryCount.current, 8000);
          setTimeout(fetchBoard, delay);
        } else {
          setError(err.message);
          setLoading(false);
        }
      }
    };

    fetchBoard();

    return () => controller.abort();
  }, [boardId]);

  return { columns, loading, error };
}
```

Forty lines for one endpoint. And it's missing:

- **Deduplication** &ndash; two components mounting with the same `boardId` fire two requests
- **Batching** &ndash; loading 30 assignee avatars means 30 individual fetches
- **Optimistic updates** &ndash; dragging a card waits for the server round-trip before moving
- **Polling** &ndash; the board goes stale the moment it loads
- **Invalidation** &ndash; a WebSocket event can't trigger a targeted refetch

This is one endpoint. A real board has six.

---

## The board module

Here's the Directive version. One module, one file:

```typescript
import { createModule, t } from "directive";

interface Column {
  id: string;
  title: string;
  cardIds: string[];
}

interface Card {
  id: string;
  title: string;
  assigneeId: string;
  columnId: string;
  position: number;
}

const kanban = createModule("kanban", {
  schema: {
    facts: {
      boardId: t.string().optional(),
      columns: t.array<Column>(),
      cards: t.array<Card>(),
      loading: t.boolean(),
      error: t.string().nullable(),
      fetchedAt: t.number(),
      staleAfterMs: t.number(),
    },
    requirements: {
      FETCH_BOARD: t.object<{ boardId: string }>(),
    },
  },

  init: (facts) => {
    facts.columns = [];
    facts.cards = [];
    facts.loading = false;
    facts.error = null;
    facts.fetchedAt = 0;
    facts.staleAfterMs = 30000;
  },

  derive: {
    cardsByColumn: (facts) => {
      const map: Record<string, Card[]> = {};
      for (const col of facts.columns) {
        map[col.id] = facts.cards
          .filter((c) => c.columnId === col.id)
          .sort((a, b) => a.position - b.position);
      }
      return map;
    },
    uniqueAssigneeIds: (facts) =>
      [...new Set(facts.cards.map((c) => c.assigneeId))],
  },

  constraints: {
    needsBoard: {
      when: (facts) =>
        facts.boardId !== undefined &&
        facts.fetchedAt === 0 &&
        !facts.loading &&
        facts.error === null,
      require: (facts) => ({
        type: "FETCH_BOARD",
        boardId: facts.boardId!,
      }),
    },
  },

  resolvers: {
    fetchBoard: {
      requirement: "FETCH_BOARD",
      timeout: 15000,
      retry: { attempts: 3, backoff: "exponential", initialDelay: 500 },
      resolve: async (request, context) => {
        context.facts.loading = true;
        context.facts.error = null;
        try {
          const res = await fetch(`/api/boards/${request.boardId}`, {
            signal: context.signal,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          context.facts.columns = data.columns;
          context.facts.cards = data.cards;
          context.facts.fetchedAt = Date.now();
        } catch (err: any) {
          if (err.name !== "AbortError") {
            context.facts.error = err.message;
          }
        } finally {
          context.facts.loading = false;
        }
      },
    },
  },
});
```

Here's what happens at runtime when `system.facts.boardId = "proj-42"`:

1. The fact mutation triggers the reconciliation loop.
2. `needsBoard` evaluates: `boardId` is set, `fetchedAt` is zero, not loading, no error. The constraint fires.
3. The requirement `{ type: "FETCH_BOARD", boardId: "proj-42" }` is emitted.
4. The `fetchBoard` resolver executes. It sets `loading = true`, calls the API with the abort signal, and writes the response into `columns` and `cards`.
5. `fetchedAt` is set to `Date.now()`. The constraint re-evaluates: `fetchedAt` is no longer zero. It goes quiet.
6. Derivations recompute: `cardsByColumn` groups cards into columns, `uniqueAssigneeIds` extracts the distinct assignee list. The system is settled.

No `useEffect`. No cleanup function. No dependency array. The constraint knows *when* to fetch, the resolver knows *how*, and the engine handles the lifecycle.

---

## Cancellation: switching boards

When a user navigates from one board to another, set the new board ID and reset the fetch timestamp:

```typescript
// User clicks "Project Alpha"
system.facts.boardId = "proj-alpha";
system.facts.fetchedAt = 0;
```

Here's what happens:

1. `boardId` changes. The `needsBoard` constraint fires with `boardId: "proj-alpha"`.
2. The old `FETCH_BOARD` requirement for `"proj-42"` is no longer in the diff &ndash; the constraint that emitted it now produces a different requirement.
3. The engine cancels the in-flight resolver. `context.signal` fires `abort`.
4. The HTTP request is cancelled. The new fetch begins.

No manual `AbortController`. No cleanup function. No race condition. The engine diffs requirements between reconciliation cycles. When a requirement disappears from the diff, its resolver is cancelled. When a new requirement appears, its resolver starts. The old request doesn't write stale data into facts because the abort signal fires before the response handler runs.

---

## Deduplication: one request per entity

By default, Directive deduplicates requirements using a stable hash of their payload: `{type}:{stableStringify(props)}`. Two constraints that emit `{ type: "FETCH_BOARD", boardId: "proj-42" }` produce one resolver execution, not two.

For human-readable dedup keys, add a `key` function to the resolver:

```typescript
const kanban = createModule("kanban", {
  schema: {
    facts: {
      // ... board facts ...
      assignees: t.object<Record<string, Assignee>>(),
    },
    requirements: {
      FETCH_BOARD: t.object<{ boardId: string }>(),
      FETCH_ASSIGNEE: t.object<{ userId: string }>(),
    },
  },

  // ...

  constraints: {
    needsAssignees: {
      when: (facts) =>
        facts.fetchedAt > 0 && facts.cards.length > 0,
      require: (facts) =>
        [...new Set(facts.cards.map((c) => c.assigneeId))]
          .filter((id) => !facts.assignees[id])
          .map((userId) => ({ type: "FETCH_ASSIGNEE", userId })),
    },
  },

  resolvers: {
    fetchAssignee: {
      requirement: "FETCH_ASSIGNEE",
      key: (request) => `assignee-${request.userId}`,
      resolve: async (request, context) => {
        const res = await fetch(`/api/users/${request.userId}`);
        const user = await res.json();
        context.facts.assignees = {
          ...context.facts.assignees,
          [request.userId]: user,
        };
      },
    },
  },
});
```

Ten cards reference the same assignee. The constraint emits ten `FETCH_ASSIGNEE` requirements with the same `userId`. The resolver's `key` function returns `"assignee-user-7"` for all ten. One request fires.

If a second constraint emits a `FETCH_ASSIGNEE` for a user that's already in flight, it's a no-op. The engine checks the inflight map by key and skips duplicates. No ref tracking, no request cache, no stale-while-revalidate config. The key function is the entire dedup strategy.

---

## Batching: one API call for thirty assignees

Deduplication reduces duplicates, but a board with 30 unique assignees still fires 30 individual HTTP requests. This is the N+1 problem.

Replace the individual `resolve` with `resolveBatch`:

```typescript
resolvers: {
  fetchAssignee: {
    requirement: "FETCH_ASSIGNEE",
    key: (request) => `assignee-${request.userId}`,
    batch: {
      enabled: true,
      windowMs: 50,
      maxSize: 100,
    },
    resolveBatch: async (requests, context) => {
      const userIds = requests.map((r) => r.userId);
      const res = await fetch("/api/users/batch", {
        method: "POST",
        body: JSON.stringify({ userIds }),
        signal: context.signal,
      });
      const users: Assignee[] = await res.json();
      const byId: Record<string, Assignee> = {};
      for (const user of users) byId[user.id] = user;
      context.facts.assignees = { ...context.facts.assignees, ...byId };
    },
  },
},
```

Here's the runtime sequence:

1. The `needsAssignees` constraint fires. Thirty `FETCH_ASSIGNEE` requirements are emitted (one per unique assignee).
2. The batch window opens. For 50ms, the engine collects requirements into a batch instead of dispatching them individually.
3. After 50ms (or when `maxSize` is reached), `resolveBatch` is called with all 30 requirements.
4. One HTTP POST to `/api/users/batch` with 30 user IDs.
5. The response writes all 30 assignees into `facts.assignees` in a single mutation.

`resolveBatch` is all-or-nothing: if the request fails, all 30 requirements retry together. For per-item error handling, use `resolveBatchWithResults` instead:

```typescript
resolveBatchWithResults: async (requests, context) => {
  const userIds = requests.map((r) => r.userId);
  const res = await fetch("/api/users/batch", {
    method: "POST",
    body: JSON.stringify({ userIds }),
    signal: context.signal,
  });
  const users: Assignee[] = await res.json();
  const byId: Record<string, Assignee> = {};
  for (const user of users) byId[user.id] = user;
  context.facts.assignees = { ...context.facts.assignees, ...byId };

  // Return per-item results
  return requests.map((request) => ({
    success: byId[request.userId] !== undefined,
    error: byId[request.userId] ? undefined : new Error(`User ${request.userId} not found`),
  }));
},
```

Failed items retry individually. Successful items are done. The engine handles the bookkeeping.

---

## Optimistic updates: drag a card

When a user drags a card from one column to another, the UI should update immediately. If the server rejects the move, roll back.

Add a `pendingMove` fact that stores the move details. When the user drops a card, set `pendingMove`. A constraint detects the pending move and emits a `MOVE_CARD` requirement. The resolver uses `context.snapshot()` to capture pre-mutation state, applies the optimistic update, calls the server, and rolls back on failure:

```typescript
const kanban = createModule("kanban", {
  schema: {
    facts: {
      // ... board facts ...
      pendingMove: t.object<{
        cardId: string;
        fromColumn: string;
        toColumn: string;
        position: number;
      }>().nullable(),
    },
    requirements: {
      // ...
      MOVE_CARD: t.object<{
        cardId: string;
        fromColumn: string;
        toColumn: string;
        position: number;
      }>(),
    },
  },

  init: (facts) => {
    // ... other init ...
    facts.pendingMove = null;
  },

  constraints: {
    needsMoveCard: {
      when: (facts) => facts.pendingMove !== null,
      require: (facts) => ({
        type: "MOVE_CARD",
        ...facts.pendingMove!,
      }),
    },
  },

  resolvers: {
    moveCard: {
      requirement: "MOVE_CARD",
      resolve: async (request, context) => {
        // 1. Snapshot before mutation
        const snapshot = context.snapshot();

        // 2. Optimistic update – move the card immediately
        context.facts.cards = context.facts.cards.map((card) =>
          card.id === request.cardId
            ? { ...card, columnId: request.toColumn, position: request.position }
            : card,
        );
        context.facts.pendingMove = null;

        try {
          // 3. Persist to server
          const res = await fetch(`/api/cards/${request.cardId}/move`, {
            method: "POST",
            body: JSON.stringify({
              toColumn: request.toColumn,
              position: request.position,
            }),
            signal: context.signal,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (err: any) {
          if (err.name === "AbortError") {
            return;
          }

          // 4. Roll back on failure
          context.facts.cards = snapshot.cards;
          context.facts.error = "Failed to move card. Reverted.";
        }
      },
    },
  },
});
```

Setting `pendingMove` triggers the constraint, which emits the requirement, which runs the resolver. The resolver clears `pendingMove` and applies the optimistic update in the same mutation. If the server rejects the move, `snapshot.cards` restores the original order.

The React side uses `useOptimisticUpdate`:

```tsx
import { useOptimisticUpdate } from "directive/react";

function BoardColumn({ column, statusPlugin, system }) {
  const { mutate, isPending, error, rollback } = useOptimisticUpdate(
    system,
    statusPlugin,
    "MOVE_CARD",
  );

  const handleDrop = (cardId: string, position: number) => {
    mutate(() => {
      system.facts.pendingMove = {
        cardId,
        fromColumn: column.id,
        toColumn: column.id,
        position,
      };
    });
  };

  return (
    <div className="column">
      <h3>{column.title}</h3>
      {isPending && <span className="saving">Saving...</span>}
      {error && (
        <button onClick={rollback}>Undo failed move</button>
      )}
      {/* ... card list with drag handlers ... */}
    </div>
  );
}
```

`mutate` wraps a fact mutation. Setting `pendingMove` fires the constraint, which dispatches the resolver. The UI updates immediately because the resolver applies the optimistic card move before calling the API. If the resolver fails, `rollback` restores the snapshot. `isPending` tracks whether the server call is in flight.

---

## Polling: keep the board fresh

A Kanban board goes stale the moment it loads. Other users move cards, add comments, change assignees. Constraint-based polling keeps the board fresh without `setInterval`:

```typescript
constraints: {
  needsBoard: {
    when: (facts) =>
      facts.boardId !== undefined &&
      facts.fetchedAt === 0 &&
      !facts.loading &&
      facts.error === null,
    require: (facts) => ({
      type: "FETCH_BOARD",
      boardId: facts.boardId!,
    }),
  },
  boardStale: {
    when: (facts) =>
      facts.boardId !== undefined &&
      facts.fetchedAt > 0 &&
      !facts.loading &&
      Date.now() - facts.fetchedAt > facts.staleAfterMs,
    require: (facts) => ({
      type: "FETCH_BOARD",
      boardId: facts.boardId!,
    }),
  },
},
```

`needsBoard` handles the initial fetch. `boardStale` handles every subsequent refresh. Same resolver, same retry logic, same cancellation behavior. The constraint fires when the data is older than `staleAfterMs` (30 seconds by default). Constraints re-evaluate on every reconciliation cycle &ndash; pass `tickMs` to `createSystem` (or `createSystemWithStatus`) to set a periodic re-evaluation interval that makes time-based constraints like `boardStale` fire reliably:

```typescript
const { system, statusPlugin } = createSystemWithStatus({
  module: kanban,
  tickMs: 5000, // Re-evaluate constraints every 5 seconds
});
```

The same pattern handles push-based invalidation. When a WebSocket event arrives:

```typescript
// WebSocket listener
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === "board_updated" && msg.boardId === system.facts.boardId) {
    system.facts.fetchedAt = 0; // Mark as stale – constraint fires immediately
  }
};
```

Setting `fetchedAt` to zero makes `needsBoard` fire again. No separate invalidation API, no cache keys, no manual refetch. The constraint already knows what to do when the data is stale.

Adjust the poll interval based on tab visibility:

```typescript
document.addEventListener("visibilitychange", () => {
  system.facts.staleAfterMs = document.hidden ? 120000 : 30000;
});
```

Background tabs poll every two minutes. Foreground tabs poll every thirty seconds. The constraint adapts automatically because it reads `staleAfterMs` from facts.

---

## React: the complete component

Bring it all together with `createSystemWithStatus` and Directive's React hooks:

```tsx
import { createSystemWithStatus } from "directive";
import {
  useFact,
  useDerived,
  useRequirementStatus,
  useInspect,
} from "directive/react";

// Create system with requirement status tracking
const { system, statusPlugin } = createSystemWithStatus({
  module: kanban,
});
system.start();

function KanbanBoard() {
  const { boardId, columns, error } = useFact(system, ["boardId", "columns", "error"]);
  const cardsByColumn = useDerived(system, "cardsByColumn");
  const inspection = useInspect(system);
  const fetchStatus = useRequirementStatus(statusPlugin, "FETCH_BOARD");

  if (!boardId) {
    return <BoardPicker onSelect={(id) => { system.facts.boardId = id; }} />;
  }

  if (fetchStatus.pending > 0 && columns.length === 0) {
    return <BoardSkeleton />;
  }

  return (
    <div className="board">
      <header>
        <h1>Board: {boardId}</h1>
        {!inspection.isSettled && <span className="syncing">Syncing...</span>}
        {error && <div className="error-banner">{error}</div>}
      </header>
      <div className="columns">
        {columns.map((col) => (
          <div key={col.id} className="column">
            <h3>{col.title} ({cardsByColumn[col.id]?.length ?? 0})</h3>
            {cardsByColumn[col.id]?.map((card) => (
              <div key={card.id} className="card">{card.title}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

`useFact` subscribes to facts &ndash; pass an array of keys to destructure multiple facts in one call. `useDerived` reads computed values. `useRequirementStatus` tracks pending/completed/failed counts for a requirement type. `useInspect` exposes system-level state like `isSettled`. Each hook re-renders only when its specific data changes.

---

## When not to use this

Not every fetch needs a constraint engine:

- **Static pages.** If data loads once at build time, use `getStaticProps` or a static site generator. No runtime fetching needed.
- **Server-side loading.** If the data is available before the component renders (RSC, loaders, `getServerSideProps`), fetch it there. Constraints solve *client-side* coordination.
- **One-shot form POSTs.** A login form that calls one endpoint and redirects on success doesn't need deduplication, batching, or polling.
- **Simple cache-and-refetch.** If your data fetching is a flat list of independent GET requests with stale-while-revalidate, TanStack Query or SWR are lighter tools built exactly for that pattern.

The threshold: when your component has more than one async data source with *interacting* logic &ndash; when fetch A depends on fetch B, when cancellation of one affects another, when batching requires collecting requirements across constraints &ndash; that's when Directive's constraint-and-resolver model replaces the hand-built layer.

---

## Get started

```bash
npm install directive
```

Explore the patterns used in this tutorial:

- **[Data Fetching Example](/docs/examples/data-fetching)** &ndash; constraints and resolvers for async data
- **[Resolvers](/docs/resolvers)** &ndash; retry, timeout, batching, and deduplication
- **[Constraints](/docs/constraints)** &ndash; declaring when to fetch with `when` and `require`
- **[React Hooks](/docs/api/react)** &ndash; `useFact`, `useDerived`, `useRequirementStatus`, and more
- **[Real-Time Dashboard](/blog/real-time-dashboard)** &ndash; multi-module composition with WebSocket and polling

Your Kanban board doesn't need a fetch library. It needs constraints that know when data is stale and resolvers that know how to fix it.
