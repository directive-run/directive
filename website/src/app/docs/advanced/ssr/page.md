---
title: SSR and Hydration
description: Use Directive with server-side rendering and hydration.
---

Render on the server, hydrate on the client. {% .lead %}

---

## Server Rendering

Create a system on the server:

```typescript
// server.ts
import { createSystem } from 'directive';

export async function renderPage(req) {
  const system = createSystem({ module: pageModule });

  // Set initial facts from request
  system.facts.userId = req.user?.id;
  system.facts.path = req.path;

  // Wait for constraints to resolve
  await system.settle();

  // Serialize state for client
  const snapshot = system.snapshot();

  return {
    html: renderToString(<App system={system} />),
    state: snapshot,
  };
}
```

---

## Client Hydration

Hydrate on the client:

```typescript
// client.ts
import { createSystem, hydrate } from 'directive';

const system = createSystem({ module: pageModule });

// Hydrate from server state
hydrate(system, window.__DIRECTIVE_STATE__);

// React hydration
hydrateRoot(
  document.getElementById('root'),
  <DirectiveProvider system={system}>
    <App />
  </DirectiveProvider>
);
```

---

## Next.js Integration

```typescript
// app/page.tsx
import { createSystem } from 'directive';

export default async function Page() {
  const system = createSystem({ module: pageModule });
  await system.settle();

  return (
    <DirectiveProvider system={system} hydrate>
      <PageContent />
    </DirectiveProvider>
  );
}
```

---

## Streaming

Stream state updates:

```typescript
import { renderToReadableStream } from 'react-dom/server';

export async function streamPage(req) {
  const system = createSystem({ module: pageModule });

  const stream = await renderToReadableStream(
    <DirectiveProvider system={system} streaming>
      <App />
    </DirectiveProvider>,
    {
      onShellReady() {
        // Initial render complete
      },
    }
  );

  return stream;
}
```

---

## Avoiding Singletons

Never use module-level systems:

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

- See Snapshots for serialization
- See React Adapter for client setup
- See Module and System for basics
