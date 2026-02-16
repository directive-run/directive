---
title: Building a Real-Time Dashboard with Directive
description: A step-by-step tutorial for building a sales analytics dashboard with multiple async data sources, live WebSocket updates, and cross-module derivations using Directive.
layout: blog
date: 2026-02-05
dateModified: 2026-02-05
slug: real-time-dashboard
author: directive-labs
categories: [Tutorial, Architecture]
---

Real-time dashboards look simple. A few numbers, a couple of charts, maybe a live feed. But underneath that surface is a coordination problem that scales poorly with imperative code.

Consider a sales analytics dashboard. It pulls historical data from a REST API, receives live transaction updates over a WebSocket, and polls a summary endpoint every 60 seconds for aggregate stats. Three data sources, each with its own loading state, error state, retry logic, and staleness window. Cross those with derived aggregations &ndash; total revenue, active users, error rate &ndash; and a single missed edge case means stale numbers on a screen that people make decisions from.

Most teams solve this with `useEffect` hooks scattered across components, manually tracking which source is loading, which failed, and when the last fetch happened. A WebSocket disconnects silently. A polling interval fires during a page transition. A derived value reads from a source that hasn't loaded yet.

Directive solves this with the same pattern it applies everywhere: declare what must be true, let the runtime handle how. Each data source becomes a module. The system composes them, and derivations compute aggregated views automatically.

---

## Module Design: One Module Per Source

Each data source gets its own Directive module. Each source has independent state, independent failure modes, and independent lifecycle. Forcing them into one module would recreate the tangled imperative code we're trying to avoid.

- `historyModule` &ndash; fetches historical sales data from a REST API on initialization
- `liveModule` &ndash; manages a WebSocket connection for real-time transaction updates
- `pollModule` &ndash; polls a summary stats endpoint on a recurring interval

They share nothing directly. Cross-module aggregation happens at the system level.

---

## The History Module

The simplest of the three. It fetches once on load, with retry logic for transient failures:

```typescript
import { createModule, t } from '@directive-run/core';

interface SaleRecord {
  id: string;
  amount: number;
  region: string;
  timestamp: number;
}

const historyModule = createModule("history", {
  schema: {
    facts: {
      records: t.array<SaleRecord>(),
      loading: t.boolean(),
      error: t.string().nullable(),
      fetchedAt: t.number(),
    },
    requirements: {
      FETCH_HISTORY: t.object<{ since: number }>(),
    },
  },

  init: (facts) => {
    facts.records = [];
    facts.loading = false;
    facts.error = null;
    facts.fetchedAt = 0;
  },

  derive: {
    historicalRevenue: (facts) =>
      facts.records.reduce((sum, r) => sum + r.amount, 0),
    recordCount: (facts) => facts.records.length,
  },

  constraints: {
    needsHistory: {
      when: (facts) =>
        facts.fetchedAt === 0 && !facts.loading && facts.error === null,
      require: () => ({
        type: "FETCH_HISTORY",
        since: Date.now() - 24 * 60 * 60 * 1000,
      }),
    },
  },

  resolvers: {
    fetchHistory: {
      requirement: "FETCH_HISTORY",
      retry: { attempts: 3, backoff: "exponential" },
      timeout: 15000,
      resolve: async (req, context) => {
        context.facts.loading = true;
        context.facts.error = null;
        try {
          const res = await fetch(`/api/sales/history?since=${req.since}`);
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }

          context.facts.records = await res.json();
          context.facts.fetchedAt = Date.now();
        } catch (err) {
          context.facts.error = err.message;
        } finally {
          context.facts.loading = false;
        }
      },
    },
  },
});
```

The constraint fires exactly once &ndash; when `fetchedAt` is zero and no request is in flight. After the resolver sets `fetchedAt`, it's satisfied permanently. If the fetch fails and the user clears the error, the constraint reactivates automatically.

---

## The Live Module

WebSocket lifecycle management &ndash; connecting, disconnecting, reconnecting &ndash; is notoriously messy in imperative code. With Directive, it becomes a set of declarative rules:

```typescript
interface LiveTransaction {
  id: string;
  amount: number;
  region: string;
  timestamp: number;
}

const liveModule = createModule("live", {
  schema: {
    facts: {
      connected: t.boolean(),
      shouldConnect: t.boolean(),
      transactions: t.array<LiveTransaction>(),
      lastMessageAt: t.number(),
      reconnectCount: t.number(),
      error: t.string().nullable(),
    },
  },

  init: (facts) => {
    facts.connected = false;
    facts.shouldConnect = true;
    facts.transactions = [];
    facts.lastMessageAt = 0;
    facts.reconnectCount = 0;
    facts.error = null;
  },

  derive: {
    liveRevenue: (facts) =>
      facts.transactions.reduce((sum, tx) => sum + tx.amount, 0),
    isStale: (facts) =>
      facts.connected && facts.lastMessageAt > 0 &&
      Date.now() - facts.lastMessageAt > 30000,
  },

  constraints: {
    needsConnection: {
      when: (facts) =>
        facts.shouldConnect && !facts.connected && facts.error === null,
      require: { type: "CONNECT_WS" },
      priority: 80,
    },
    needsReconnect: {
      when: (facts) =>
        facts.shouldConnect && !facts.connected && facts.error !== null,
      require: { type: "RECONNECT_WS" },
      priority: 60,
    },
  },

  resolvers: {
    connect: {
      requirement: "CONNECT_WS",
      resolve: async (_req, context) => {
        const ws = new WebSocket("wss://api.example.com/sales/live");

        ws.onopen = () => {
          context.facts.connected = true;
          context.facts.reconnectCount = 0;
        };
        ws.onmessage = (event) => {
          const tx: LiveTransaction = JSON.parse(event.data);
          context.facts.transactions = [...context.facts.transactions, tx];
          context.facts.lastMessageAt = Date.now();
        };
        ws.onclose = () => { context.facts.connected = false; };
        ws.onerror = () => {
          context.facts.connected = false;
          context.facts.error = "WebSocket connection failed";
        };
      },
    },
    reconnect: {
      requirement: "RECONNECT_WS",
      retry: { attempts: 5, backoff: "exponential" },
      resolve: async (_req, context) => {
        context.facts.reconnectCount += 1;
        context.facts.error = null;
        // Clearing error re-activates needsConnection
      },
    },
  },

  effects: {
    capBuffer: {
      run: (facts) => {
        if (facts.transactions.length > 500) {
          facts.transactions = facts.transactions.slice(-500);
        }
      },
    },
  },
});
```

Two constraints handle the full lifecycle. `needsConnection` fires when the socket should be connected but isn't. `needsReconnect` fires when a previous connection failed &ndash; its resolver clears the error with exponential backoff, which cycles back to `needsConnection` for the actual reconnection. The effect `capBuffer` keeps memory bounded, trimming to the last 500 entries whenever `transactions` changes.

---

## The Polling Module

The polling module refreshes summary statistics on a fixed interval. The constraint detects when data is stale and triggers a refresh:

```typescript
interface SummaryStats {
  activeUsers: number;
  avgOrderValue: number;
  errorRate: number;
  topRegion: string;
}

const pollModule = createModule("poll", {
  schema: {
    facts: {
      stats: t.object<SummaryStats>().nullable(),
      loading: t.boolean(),
      error: t.string().nullable(),
      lastFetchAt: t.number(),
      pollIntervalMs: t.number(),
    },
  },

  init: (facts) => {
    facts.stats = null;
    facts.loading = false;
    facts.error = null;
    facts.lastFetchAt = 0;
    facts.pollIntervalMs = 60000;
  },

  derive: {
    isStale: (facts) =>
      facts.lastFetchAt > 0 &&
      Date.now() - facts.lastFetchAt > facts.pollIntervalMs,
    secondsSinceUpdate: (facts) =>
      facts.lastFetchAt > 0
        ? Math.floor((Date.now() - facts.lastFetchAt) / 1000)
        : null,
  },

  constraints: {
    needsInitialFetch: {
      when: (facts) =>
        facts.lastFetchAt === 0 && !facts.loading && facts.error === null,
      require: { type: "REFRESH_STATS" },
      priority: 70,
    },
    needsRefresh: {
      when: (facts) =>
        facts.lastFetchAt > 0 &&
        Date.now() - facts.lastFetchAt > facts.pollIntervalMs &&
        !facts.loading,
      require: { type: "REFRESH_STATS" },
      priority: 40,
    },
  },

  resolvers: {
    refreshStats: {
      requirement: "REFRESH_STATS",
      retry: { attempts: 2, backoff: "exponential" },
      timeout: 10000,
      resolve: async (_req, context) => {
        context.facts.loading = true;
        context.facts.error = null;
        try {
          const res = await fetch("/api/sales/summary");
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }

          context.facts.stats = await res.json();
          context.facts.lastFetchAt = Date.now();
        } catch (err) {
          context.facts.error = err.message;
        } finally {
          context.facts.loading = false;
        }
      },
    },
  },
});
```

The `needsRefresh` constraint checks whether enough time has elapsed since the last fetch. After a successful fetch updates `lastFetchAt`, the constraint goes quiet until the interval elapses. No `setInterval`. No cleanup. No forgotten timers leaking after unmount.

---

## Composing the System

All three modules compose into a single system with one call:

```typescript
import { createSystem } from '@directive-run/core';
import { loggingPlugin } from '@directive-run/core/plugins';

const dashboard = createSystem({
  modules: {
    history: historyModule,
    live: liveModule,
    poll: pollModule,
  },
  plugins: [loggingPlugin({ level: "warn" })],
});

dashboard.start();
```

Each module's facts live under its namespace &ndash; `dashboard.facts.history.records`, `dashboard.facts.live.transactions`, `dashboard.facts.poll.stats`. If the WebSocket disconnects while a poll is in flight, each module handles its own situation without blocking the others.

---

## Cross-Module Derivations and React

The real power of composition shows up in aggregated views. `useSelector` computes values that span module namespaces with auto-tracked dependencies:

```tsx
import { useSelector, useFact, useDerived, useInspect } from '@directive-run/react';

function DashboardPage() {
  const inspection = useInspect(dashboard);

  return (
    <div className="dashboard">
      <header>
        <h1>Sales Analytics</h1>
        {!inspection.isSettled && <span className="syncing">Syncing...</span>}
      </header>
      <RevenueCard />
      <LiveFeed />
      <StatsPanel />
      <SourceStatus />
    </div>
  );
}

function RevenueCard() {
  const totalRevenue = useSelector(dashboard, (state) =>
    state.history.records.reduce((sum, r) => sum + r.amount, 0) +
    state.live.transactions.reduce((sum, tx) => sum + tx.amount, 0),
  );
  return (
    <div className="card">
      <h2>Total Revenue</h2>
      <p className="value">${totalRevenue.toLocaleString()}</p>
    </div>
  );
}

function LiveFeed() {
  const transactions = useFact(dashboard, "live.transactions");
  const connected = useFact(dashboard, "live.connected");
  const recent = transactions.slice(-10).reverse();

  return (
    <div className="card">
      <h2>Live Transactions <span className={connected ? "dot green" : "dot red"} /></h2>
      <ul>
        {recent.map((tx) => (
          <li key={tx.id}>${tx.amount.toFixed(2)} &ndash; {tx.region}</li>
        ))}
      </ul>
    </div>
  );
}

function StatsPanel() {
  const stats = useFact(dashboard, "poll.stats");
  const secondsSince = useDerived(dashboard, "poll.secondsSinceUpdate");
  if (!stats) {
    return <div className="card">Loading stats...</div>;
  }

  return (
    <div className="card">
      <h2>Summary Stats</h2>
      <dl>
        <dt>Active Users</dt><dd>{stats.activeUsers}</dd>
        <dt>Avg Order Value</dt><dd>${stats.avgOrderValue.toFixed(2)}</dd>
        <dt>Error Rate</dt><dd>{(stats.errorRate * 100).toFixed(1)}%</dd>
      </dl>
      {secondsSince !== null && <p className="meta">Updated {secondsSince}s ago</p>}
    </div>
  );
}

function SourceStatus() {
  const historyError = useFact(dashboard, "history.error");
  const connected = useFact(dashboard, "live.connected");
  const pollError = useFact(dashboard, "poll.error");
  const reconnects = useFact(dashboard, "live.reconnectCount");

  return (
    <div className="card">
      <h2>Data Sources</h2>
      <div className={historyError ? "source-error" : "source-ok"}>Historical</div>
      <div className={connected ? "source-ok" : "source-error"}>
        Live Feed {reconnects > 0 && <span>({reconnects} reconnects)</span>}
      </div>
      <div className={pollError ? "source-error" : "source-ok"}>Stats</div>
    </div>
  );
}
```

Each component subscribes to exactly the facts it needs. `RevenueCard` re-renders when either history or live data changes. `LiveFeed` re-renders on new transactions. `StatsPanel` re-renders on poll updates.

The `totalRevenue` selector reads from two module namespaces and recomputes whenever either changes. When the history module is still loading, its contribution is zero. No null checks, no conditional logic based on which source loaded first.

---

## Error Resilience

With separate modules, failures are isolated by design. If the WebSocket disconnects:

- `liveModule` activates its `needsReconnect` constraint with exponential backoff
- `historyModule` continues serving cached data from the initial fetch
- `pollModule` continues its polling cycle on schedule
- Derivations still work &ndash; they use the last known live data plus fresh data from other sources

No module knows or cares about the others' error states. The system degrades gracefully because each module handles its own recovery. The `SourceStatus` component surfaces per-source health so users know exactly which data is fresh and which is reconnecting.

---

## Getting Started

Install Directive and start building:

```bash
npm install @directive-run/core
```

Explore the patterns used in this tutorial:

- **[Multi-Module Composition](/docs/advanced/multi-module)** &ndash; composing independent modules into a single system
- **[Multi-Module Example](/docs/examples/multi-module)** &ndash; full e-commerce example with auth, cart, and checkout
- **[Data Fetching Example](/docs/examples/data-fetching)** &ndash; constraints and resolvers for async data
- **[Effects](/docs/effects)** &ndash; fire-and-forget side effects
- **[React Hooks](/docs/api/react)** &ndash; `useSelector`, `useFact`, `useDerived`, and more

If you haven't read the first article in this series, **[Constraint-Driven Architecture](/blog/constraint-driven-architecture)** explains the paradigm from scratch.

The same reconciliation loop that manages a traffic light manages a production dashboard. Declare what must be true. Let the runtime handle the rest.
