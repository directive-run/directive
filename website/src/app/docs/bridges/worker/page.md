---
title: Web Worker Bridge
description: Run the Directive engine in a Web Worker to keep heavy computation off the main thread.
---

Run your Directive engine in a dedicated Web Worker so constraint evaluation, resolution, and derivation never block the UI. {% .lead %}

---

## Installation

The worker adapter ships with the main `directive` package under the `directive/worker` subpath:

```bash
npm install directive
```

```typescript
// Main thread
import { createWorkerClient } from 'directive/worker';

// Worker script
import { registerWorkerModule, handleWorkerMessages } from 'directive/worker';
```

---

## Worker Script Setup

Modules contain functions, so they cannot be serialized over `postMessage`. Define and register them directly inside the worker script, then call `handleWorkerMessages()` to start listening for commands from the main thread.

```typescript
// directive.worker.ts
import { registerWorkerModule, handleWorkerMessages } from 'directive/worker';
import { analyticsModule } from './modules/analytics';
import { pricingModule } from './modules/pricing';

registerWorkerModule('analytics', analyticsModule);
registerWorkerModule('pricing', pricingModule);

handleWorkerMessages();
```

`registerWorkerModule(name, module)` adds the module to an internal registry. When the main thread sends an `INIT` message, the worker looks up each requested module name in that registry and creates a real `createSystem` internally.

---

## Main Thread Client

Use `createWorkerClient` to get a `WorkerClient` that communicates with the worker over `postMessage`:

```typescript
import { createWorkerClient } from 'directive/worker';

const worker = new Worker(
  new URL('./directive.worker.ts', import.meta.url)
);

const client = createWorkerClient({
  worker,

  onFactChange(key, value, prev) {
    console.log(`Fact "${key}" changed:`, prev, '->', value);
  },

  onDerivationChange(key, value) {
    console.log(`Derivation "${key}" recomputed:`, value);
  },

  onRequirementCreated(requirement) {
    console.log('Requirement created:', requirement.type, requirement.id);
  },

  onRequirementMet(requirementId, resolverId) {
    console.log(`Requirement ${requirementId} met by ${resolverId}`);
  },

  onError(error, source) {
    console.error(`Worker error (${source}):`, error);
  },
});
```

{% callout type="warning" title="Not a system" %}
`WorkerClient` is **not** a Directive system. You cannot access `client.facts.key` or read derivations as properties. All state flows back through the callbacks above. Use `setFact` / `setFacts` to write, and `getSnapshot` / `inspect` to read.
{% /callout %}

### Callback Reference

| Callback | Fires when |
|----------|-----------|
| `onFactChange(key, value, prev)` | A fact changes inside the worker |
| `onDerivationChange(key, value)` | A derivation recomputes |
| `onRequirementCreated(requirement)` | A constraint emits a new requirement |
| `onRequirementMet(requirementId, resolverId)` | A resolver fulfills a requirement |
| `onError(error, source?)` | An error occurs (source is the message type that caused it) |

---

## Controlling the Worker System

### Lifecycle

Initialize the system by telling the worker which registered modules to use, then start it:

```typescript
await client.init({
  moduleNames: ['analytics', 'pricing'],
  debug: { timeTravel: true, maxSnapshots: 50 },
});

await client.start();
```

Stop and destroy when done:

```typescript
await client.stop();
await client.destroy();
```

Call `client.terminate()` to immediately terminate the underlying `Worker` without waiting for a graceful shutdown.

### Setting Facts

Write facts by key. These calls are fire-and-forget -- they post a message and return immediately:

```typescript
// Single fact
client.setFact('userId', 'user-42');

// Multiple facts (batched in the worker)
client.setFacts({
  userId: 'user-42',
  region: 'us-east',
  tier: 'premium',
});
```

### Dispatching Events

Send events into the worker system:

```typescript
client.dispatch({ type: 'PRICE_REFRESH', currency: 'USD' });
```

---

## Async Queries

Because the system lives in another thread, reads are async. Each returns a `Promise` that resolves when the worker responds.

### getSnapshot

Retrieve a distributable snapshot of the entire system state:

```typescript
const snapshot = await client.getSnapshot();
console.log(snapshot.facts);
console.log(snapshot.derivations);
```

Pass options to control what is included:

```typescript
const snapshot = await client.getSnapshot({ includeMetadata: true });
```

### inspect

Get a detailed inspection of the running system (constraints, resolvers, pending requirements):

```typescript
const inspection = await client.inspect();
console.log(inspection.constraints);
console.log(inspection.pendingRequirements);
```

### settle

Wait for all pending requirements to resolve. Useful in tests or before reading a consistent snapshot:

```typescript
await client.settle();
const snapshot = await client.getSnapshot();
```

Pass a timeout in milliseconds:

```typescript
await client.settle(5000); // Rejects if not settled within 5 seconds
```

---

## Type-Safe Client

Cast the client to `TypedWorkerClient<M>` to get compile-time checks on `setFact`, `setFacts`, and `dispatch`:

```typescript
import type { TypedWorkerClient } from 'directive/worker';
import type { analyticsModule } from './modules/analytics';

type AnalyticsClient = TypedWorkerClient<typeof analyticsModule.schema>;

const client = createWorkerClient({ worker }) as AnalyticsClient;

client.setFact('userId', 'user-42');   // Type-checked key and value
client.setFact('userId', 123);         // Type error: number not assignable to string
client.setFact('nonExistent', true);   // Type error: key doesn't exist

client.dispatch({ type: 'PRICE_REFRESH', currency: 'USD' }); // Type-checked event
```

---

## Use Cases

- **Heavy computation** -- Run expensive constraint evaluation or resolver logic without blocking the UI thread.
- **Background data processing** -- Stream data into the worker with `setFacts`, let resolvers transform it, read results via `getSnapshot`.
- **Isolation** -- Keep third-party module execution in a separate thread so errors or hangs do not freeze the page.
- **Server-like patterns** -- Use the worker as a local "backend" that owns state and business logic while the main thread handles rendering.

---

## Next Steps

- **[Module](/docs/module-system)** and **[Facts](/docs/facts)** -- Build the modules you register in the worker.
- **[Constraints](/docs/constraints)** and **[Resolvers](/docs/resolvers)** -- Define the rules that run off-thread.
- **[Redux Bridge](/docs/bridges/redux)** -- Sync worker-managed state with an existing Redux store.
