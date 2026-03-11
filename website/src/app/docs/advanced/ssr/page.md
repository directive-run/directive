---
title: SSR and Hydration
description: Use Directive with server-side rendering and hydration.
---

Render on the server, hydrate on the client. {% .lead %}

---

## Server Rendering

Create a system on the server and wait for it to settle:

```typescript
// server.ts
import { createSystem } from '@directive-run/core';

export async function renderPage(req) {
  // Create a fresh system per request to avoid shared state
  const system = createSystem({ module: pageModule });
  system.start();

  // Seed the system with data from the incoming request
  system.facts.userId = req.user?.id;
  system.facts.path = req.path;

  // Block until all constraints evaluate and resolvers finish
  await system.settle();

  // Capture the fully resolved state for client hydration
  const snapshot = system.getSnapshot();

  return {
    html: renderToString(<App system={system} />),
    state: snapshot, // Embed this in the HTML for the client to pick up
  };
}
```

`system.settle()` waits until all active constraints have been evaluated and all in-flight resolvers have completed (or the optional timeout is reached).

---

## Client Hydration

Hydrate the system on the client using the server snapshot:

```typescript
// client.ts
import { createSystem } from '@directive-run/core';

// Create the same module structure as the server
const system = createSystem({ module: pageModule });

// Restore facts from the server snapshot – skips a full reconciliation
system.restore(window.__DIRECTIVE_STATE__);
system.start();

// Hydrate React using the pre-populated system – no provider needed
hydrateRoot(
  document.getElementById('root'),
  <App system={system} />
);
```

`system.restore()` restores facts from the serialized snapshot without triggering a full reconciliation.

---

## Next.js Integration

```typescript
// app/layout.tsx
import { createSystem } from '@directive-run/core';

export default async function Page() {
  // Server Component: create, start, and settle before rendering
  const system = createSystem({ module: pageModule });
  system.start();
  await system.settle();

  // Pass the settled system to child components – no provider needed
  return <PageContent system={system} />;
}
```

---

## Express / Fastify

Directive works with any Node.js HTTP framework. Create a system per request, seed facts, settle, and return JSON:

```typescript
// Express route handler
import express from 'express';
import { createSystem } from '@directive-run/core';

const app = express();

app.get('/api/user/:id', async (req, res) => {
  const system = createSystem({ module: userModule });
  system.start();

  // Seed facts from the request
  system.facts.userId = req.params.id;

  // Block until constraints + resolvers settle
  await system.settle(5000);

  // Return the settled state as JSON
  res.json(system.getSnapshot());
  system.destroy();
});
```

The same pattern works with Fastify, Hono, Koa, or any framework that supports `async` handlers.

---

## Distributable Snapshots for APIs

For API responses, prefer `getDistributableSnapshot()` over `getSnapshot()`. Distributable snapshots include computed derivations and support TTL expiry:

```typescript
await system.settle(5000);

const snapshot = system.getDistributableSnapshot({
  includeDerivations: ['effectivePlan', 'canUseFeature'],
  ttlSeconds: 3600, // Expires after 1 hour
});

// Cache in Redis, serve from CDN, or return directly
res.json(snapshot);
```

The snapshot includes `createdAt` and `expiresAt` timestamps. Use `isSnapshotExpired()` to check validity before serving cached values. See [Time-Travel & Snapshots](/docs/advanced/history) for the full API.

---

## Avoiding Singletons

Never use module-level systems in SSR – they would be shared across requests:

```typescript
// Bad – module-level singletons are shared across all server requests
const system = createSystem({ module });

// Good – factory function creates an isolated system per request
export function getSystem() {
  return createSystem({ module });
}
```

---

## Next Steps

- [Time-Travel & Snapshots](/docs/advanced/history) &ndash; Distributable snapshots, signing, TTL, serialization
- [React Adapter](/docs/adapters/react) &ndash; Client setup
- [Module and System](/docs/module-system) &ndash; Basics
