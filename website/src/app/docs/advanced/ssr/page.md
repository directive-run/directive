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
import { createSystem } from 'directive';

export async function renderPage(req) {
  const system = createSystem({ module: pageModule });

  // Set initial facts from request
  system.facts.userId = req.user?.id;
  system.facts.path = req.path;

  // Wait for all constraints and resolvers to complete
  await system.settle();

  // Serialize state for the client
  const snapshot = system.getSnapshot();

  return {
    html: renderToString(<App system={system} />),
    state: snapshot,
  };
}
```

`system.settle()` waits until all active constraints have been evaluated and all in-flight resolvers have completed (or the optional timeout is reached).

---

## Client Hydration

Hydrate the system on the client using the server snapshot:

```typescript
// client.ts
import { createSystem } from 'directive';

const system = createSystem({ module: pageModule });

// Hydrate from server state
system.hydrate(window.__DIRECTIVE_STATE__);

// React hydration — hooks take system directly, no provider needed
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
import { createSystem } from 'directive';

export default async function Page() {
  const system = createSystem({ module: pageModule });
  await system.settle();

  // No provider needed — pass system to components, hooks take it directly
  return <PageContent system={system} />;
}
```

---

## Avoiding Singletons

Never use module-level systems in SSR — they would be shared across requests:

```typescript
// Bad - shared across requests
const system = createSystem({ module });

// Good - per-request system
export function getSystem() {
  return createSystem({ module });
}
```

---

## Next Steps

- See [Snapshots](/docs/advanced/snapshots) for serialization
- See [React Adapter](/docs/adapters/react) for client setup
- See [Module and System](/docs/module-system) for basics
