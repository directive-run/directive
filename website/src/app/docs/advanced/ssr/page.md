---
title: SSR and Hydration
description: Use Directive with server-side rendering and hydration.
---

Render on the server, hydrate on the client. {% .lead %}

---

## Overview

Directive provides four mechanisms for populating a system with external state. Choose based on your use case:

| Mechanism | When | Async | Framework |
|---|---|---|---|
| `initialFacts` | Construction time | No | Any |
| `system.hydrate(loader)` | Before `start()` | Yes | Any |
| `system.restore(snapshot)` | After construction | No | Any |
| `DirectiveHydrator` + `useHydratedSystem` | RSC/SSR render | No | React |

---

## Server Rendering

Create a system per request, seed it with `initialFacts`, settle, snapshot, and destroy:

```typescript
// server.ts
import { createSystem } from '@directive-run/core';

export async function renderPage(req) {
  const system = createSystem({
    module: pageModule,
    initialFacts: {
      userId: req.user?.id,
      path: req.path,
    },
  });
  system.start();

  // Block until all constraints evaluate and resolvers finish
  await system.settle();

  const snapshot = system.getSnapshot();
  const html = renderToString(<App system={system} />);

  system.stop();
  system.destroy();

  return { html, state: snapshot };
}
```

`system.settle()` waits until all active constraints have been evaluated and all in-flight resolvers have completed. Pass a timeout in milliseconds to prevent hanging:

```typescript
try {
  await system.settle(5000);
} catch (err) {
  // SettleTimeoutError – includes details about what's still pending
  console.error('System did not settle in time:', err.message);
  // Render with partial state or return an error page
}
```

---

## Client Hydration: initialFacts

The simplest hydration path. Works with every framework:

```typescript
// client.ts
import { createSystem } from '@directive-run/core';

const system = createSystem({
  module: pageModule,
  initialFacts: window.__DIRECTIVE_STATE__.facts,
});
system.start();

hydrateRoot(
  document.getElementById('root'),
  <App system={system} />
);
```

`initialFacts` is applied during the init phase before the first reconciliation cycle, so the system starts with the correct state and avoids a flash of default values.

---

## Client Hydration: system.hydrate()

Use `hydrate()` when the state source is async — `localStorage`, `fetch`, IndexedDB, etc.:

```typescript
// client.ts
import { createSystem } from '@directive-run/core';

const system = createSystem({ module: pageModule });

await system.hydrate(async () => {
  const res = await fetch('/api/state');

  return res.json();
});

system.start();
```

`hydrate()` must be called **before** `start()`. It accepts a loader function that returns facts (sync or async). Hydrated facts take precedence over `initialFacts`.

---

## React: DirectiveHydrator + useHydratedSystem

For React SSR and RSC, use `DirectiveHydrator` to pass a distributable snapshot from server to client, and `useHydratedSystem` to create a hydrated system from it.

**Server component:**

```typescript
import { createSystem } from '@directive-run/core';

export async function getServerSnapshot() {
  const system = createSystem({
    module: pageModule,
    initialFacts: { userId: 'user-1' },
  });
  system.start();
  await system.settle();

  const snapshot = system.getDistributableSnapshot({
    includeDerivations: ['displayName', 'isReady'],
    includeFacts: ['userId', 'profile'],
    ttlSeconds: 300,
  });

  system.stop();
  system.destroy();

  return snapshot;
}
```

**Client component:**

```tsx
'use client';

import { DirectiveHydrator, useHydratedSystem, useFact } from '@directive-run/react';

function ClientApp() {
  const system = useHydratedSystem(pageModule);
  const profile = useFact(system, 'profile');

  return <div>{profile.name}</div>;
}

// In the parent (server or client):
export default async function Page() {
  const snapshot = await getServerSnapshot();

  return (
    <DirectiveHydrator snapshot={snapshot}>
      <ClientApp />
    </DirectiveHydrator>
  );
}
```

`useHydratedSystem` extracts facts from the snapshot's `data` field and passes them as `initialFacts` to a new system. The system is created once and reused across re-renders.

---

## Next.js Integration

The previous example had a broken pattern — passing a non-serializable system object across the RSC boundary. Here's the correct approach:

**Server Component** (`app/page.tsx`):

```tsx
import { createSystem } from '@directive-run/core';
import { DirectiveHydrator } from '@directive-run/react';
import { ClientPage } from './client-page';

export default async function Page() {
  const system = createSystem({
    module: pageModule,
    initialFacts: { path: '/dashboard' },
  });
  system.start();
  await system.settle();

  const snapshot = system.getDistributableSnapshot({
    includeDerivations: ['isReady'],
    includeFacts: ['path', 'user'],
  });

  system.stop();
  system.destroy();

  return (
    <DirectiveHydrator snapshot={snapshot}>
      <ClientPage />
    </DirectiveHydrator>
  );
}
```

**Client Component** (`app/client-page.tsx`):

```tsx
'use client';

import { useHydratedSystem, useFact, useDerived } from '@directive-run/react';

export function ClientPage() {
  const system = useHydratedSystem(pageModule);
  const user = useFact(system, 'user');
  const isReady = useDerived(system, 'isReady');

  if (!isReady) {
    return <div>Loading...</div>;
  }

  return <div>Welcome, {user.name}</div>;
}
```

Key points:
- Only **serializable** data (the snapshot) crosses the RSC boundary — never a system instance
- The server system is destroyed after extracting the snapshot
- The client system is created fresh via `useHydratedSystem`

---

## Express / Fastify

Directive works with any Node.js HTTP framework. Create a system per request, seed facts via `initialFacts`, settle, and return JSON:

```typescript
import express from 'express';
import { createSystem } from '@directive-run/core';

const app = express();

app.get('/api/user/:id', async (req, res) => {
  const system = createSystem({
    module: userModule,
    initialFacts: { userId: req.params.id },
  });
  system.start();

  try {
    await system.settle(5000);
    res.json(system.getSnapshot());
  } catch (err) {
    res.status(504).json({ error: 'System did not settle in time' });
  } finally {
    system.stop();
    system.destroy();
  }
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
  includeFacts: ['userId', 'plan'],
  ttlSeconds: 3600,
});

// Cache in Redis, serve from CDN, or return directly
res.json(snapshot);
```

Use the snapshot utility functions to validate cached snapshots:

```typescript
import { isSnapshotExpired, validateSnapshot } from '@directive-run/core';

// Check if expired (returns boolean)
if (isSnapshotExpired(cachedSnapshot)) {
  // Re-fetch or re-generate
}

// Validate and return data (throws if expired)
try {
  const data = validateSnapshot(cachedSnapshot);
  res.json(data);
} catch (err) {
  // Snapshot expired — regenerate
}
```

---

## Snapshot Types

Directive has two snapshot types:

| Type | Contents | Use Case |
|---|---|---|
| `SystemSnapshot` | Facts only | `getSnapshot()` / `restore()` — internal state transfer |
| `DistributableSnapshot` | Facts + derivations + metadata + TTL | `getDistributableSnapshot()` — APIs, caching, `DirectiveHydrator` |

`SystemSnapshot` is a plain object of fact key-value pairs. `DistributableSnapshot` adds `createdAt`, `expiresAt`, `data` (selected derivations/facts), and optional `version` for conflict detection.

---

## Other Frameworks

Vue, Svelte, Solid, and Lit use `initialFacts` or `system.hydrate()` directly. There are no dedicated hydration components for these frameworks:

```typescript
// Vue/Svelte/Solid/Lit — same pattern
const system = createSystem({
  module: pageModule,
  initialFacts: serverState,
});
system.start();
```

---

## Error Handling

### settle() Timeout

`system.settle(timeoutMs)` throws if the system doesn't settle within the timeout. The error includes details about what's still pending:

```typescript
try {
  await system.settle(5000);
} catch (err) {
  // err.message includes pending resolver/constraint info
  console.error('SSR settle failed:', err.message);

  // Option 1: Return partial state
  const snapshot = system.getSnapshot();
  return { html: renderFallback(), state: snapshot };

  // Option 2: Return error page
  return { html: renderError(), state: null };
}
```

### hydrate() Loader Errors

If the `hydrate()` loader throws, the error propagates to the caller. The system remains in a pre-start state and can be started without hydrated data:

```typescript
try {
  await system.hydrate(async () => {
    const res = await fetch('/api/state');

    return res.json();
  });
} catch (err) {
  console.warn('Hydration failed, starting with defaults:', err);
}
system.start();
```

---

## Avoiding Singletons

Never use module-level systems in SSR. A singleton system is shared across all concurrent requests on the server, causing state from one user's request to leak into another's:

```typescript
// BAD – shared across all server requests
const system = createSystem({ module });

export function handler(req) {
  system.facts.userId = req.user.id; // Overwrites for ALL concurrent requests
}

// GOOD – factory function creates an isolated system per request
export function handler(req) {
  const system = createSystem({
    module,
    initialFacts: { userId: req.user.id },
  });
  system.start();
  // ... use, then destroy
  system.stop();
  system.destroy();
}
```

---

## Next Steps

- [Time-Travel & Snapshots](/docs/advanced/history) &ndash; Distributable snapshots, signing, TTL, serialization
- [React Adapter](/docs/adapters/react) &ndash; Full hook reference including `useHydratedSystem`
- [Module and System](/docs/module-system) &ndash; Basics
