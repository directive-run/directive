---
title: How to Connect to WebSockets
description: Manage WebSocket lifecycle, reconnection, and message dispatching with Directive effects and constraints.
---

WebSocket lifecycle via effects, automatic reconnection via constraints, and message dispatching via facts. {% .lead %}

---

## The Problem

WebSocket connections need careful lifecycle management: open on mount, close on unmount, reconnect on disconnect, buffer messages during reconnection, and dispatch incoming messages to the right handlers. Imperative approaches scatter this across component lifecycle methods, leading to leaked connections, lost messages, and reconnection loops.

## The Solution

```typescript
import { createModule, t } from 'directive';

const ws = createModule('ws', {
  schema: {
    url: t.string(),
    status: t.string<'disconnected' | 'connecting' | 'connected' | 'error'>(),
    lastMessage: t.object<{ type: string; payload: unknown }>().optional(),
    retryCount: t.number(),
    maxRetries: t.number(),
  },

  init: (facts) => {
    facts.url = '';
    facts.status = 'disconnected';
    facts.lastMessage = undefined;
    facts.retryCount = 0;
    facts.maxRetries = 5;
  },

  derive: {
    isConnected: (facts) => facts.status === 'connected',
    shouldReconnect: (facts) =>
      facts.status === 'error' &&
      facts.retryCount < facts.maxRetries &&
      facts.url !== '',
  },

  effects: {
    // Manages the WebSocket lifecycle
    connection: {
      deps: ['url', 'status'],
      run: (facts, prev, ctx) => {
        if (facts.url === '' || facts.status !== 'connecting') return;

        const socket = new WebSocket(facts.url);

        socket.onopen = () => {
          ctx.system.batch(() => {
            ctx.facts.status = 'connected';
            ctx.facts.retryCount = 0;
          });
        };

        socket.onmessage = (event) => {
          ctx.facts.lastMessage = JSON.parse(event.data);
        };

        socket.onclose = () => {
          ctx.facts.status = 'error';
        };

        socket.onerror = () => {
          ctx.facts.status = 'error';
        };

        // Cleanup: close socket when effect re-runs or system stops
        return () => {
          socket.close();
        };
      },
    },
  },

  constraints: {
    // Auto-reconnect with backoff
    reconnect: {
      when: (facts, derive) => derive.shouldReconnect,
      require: (facts) => ({
        type: 'RECONNECT',
        delay: Math.min(1000 * 2 ** facts.retryCount, 30_000),
      }),
    },
  },

  resolvers: {
    reconnect: {
      requirement: 'RECONNECT',
      resolve: async (req, ctx) => {
        await new Promise((r) => setTimeout(r, req.delay));
        ctx.system.batch(() => {
          ctx.facts.retryCount = ctx.facts.retryCount + 1;
          ctx.facts.status = 'connecting';
        });
      },
    },
  },
});
```

```tsx
// Usage: connect and react to messages
function Chat({ system }) {
  const { facts, derived } = useDirective(system);

  // Connect on mount
  useEffect(() => {
    system.batch(() => {
      system.facts.url = 'wss://api.example.com/ws';
      system.facts.status = 'connecting';
    });
  }, []);

  return (
    <div>
      <StatusBadge connected={derived.isConnected} />
      {facts.lastMessage && (
        <Message data={facts.lastMessage} />
      )}
    </div>
  );
}
```

## Step by Step

1. **Effect manages the socket** — the `connection` effect runs when `url` or `status` changes. It only opens a socket when status is `'connecting'`, and the cleanup return closes it when the effect re-runs or the system stops.

2. **`system.batch()` prevents glitches** — when `onopen` fires, both `status` and `retryCount` update atomically. Without batch, constraints would evaluate between the two updates.

3. **Constraint triggers reconnect** — `shouldReconnect` derivation checks if we're in error state and haven't exceeded retries. The constraint emits `RECONNECT` with exponential backoff delay.

4. **Resolver adds delay then reconnects** — waits the backoff period, increments retry count, and sets status back to `'connecting'`, which triggers the effect to open a new socket.

## Common Variations

### Sending messages

```typescript
// Add a send helper
function sendMessage(system, type: string, payload: unknown) {
  system.dispatch({ type: 'WS_SEND', message: { type, payload } });
}

// Add resolver
resolvers: {
  send: {
    requirement: 'WS_SEND',
    resolve: async (req, ctx) => {
      // Access socket through a shared ref or module state
      if (ctx.facts.status !== 'connected') {
        throw new Error('Not connected');
      }
      // Socket reference managed by the effect
    },
  },
},
```

### Message routing to other modules

```typescript
// In a chat module, react to WebSocket messages
const chat = createModule('chat', {
  constraints: {
    handleMessage: {
      crossModuleDeps: ['ws.lastMessage'],
      when: (facts, derive, cross) =>
        cross.ws.lastMessage?.type === 'CHAT_MESSAGE',
      require: (facts, derive, cross) => ({
        type: 'PROCESS_CHAT',
        message: cross.ws.lastMessage,
      }),
    },
  },
});
```

## Related

- [Effects](/docs/effects) — cleanup functions and dependency tracking
- [Batch Mutations](/docs/how-to/batch-mutations) — atomic multi-field updates
- [Multi-Module](/docs/advanced/multi-module) — cross-module dependencies
- [Error Handling](/docs/advanced/errors) — retry and circuit breaker patterns
