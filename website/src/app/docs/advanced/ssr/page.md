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
system.hydrate(() => window.__DIRECTIVE_STATE__);
system.start();

// Hydrate React using the pre-populated system – no provider needed
hydrateRoot(
  document.getElementById('root'),
  <App system={system} />
);
```

`system.hydrate()` restores facts from the serialized snapshot without triggering a full reconciliation.

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

- [Time-Travel & Snapshots](/docs/advanced/time-travel) – Serialization
- [React Adapter](/docs/adapters/react) – Client setup
- [Module and System](/docs/module-system) – Basics
