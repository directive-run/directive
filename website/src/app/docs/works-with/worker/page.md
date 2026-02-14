---
title: Directive + Web Worker
description: Run the Directive engine in a Web Worker to keep heavy computation off the main thread.
---

Run your Directive engine in a dedicated Web Worker so constraint evaluation, resolution, and derivation never block the UI. {% .lead %}

---

## Installation

The worker adapter ships with the `@directive-run/core` package under the `@directive-run/core/worker` subpath:

```bash
npm install @directive-run/core
```

```typescript
// Main thread – communicates with the worker over postMessage
import { createWorkerClient } from '@directive-run/core/worker';

// Worker script – registers modules and handles messages
import { registerWorkerModule, handleWorkerMessages } from '@directive-run/core/worker';
```

---

## Worker Script Setup

Modules contain functions, so they cannot be serialized over `postMessage`. Define and register them directly inside the worker script, then call `handleWorkerMessages()` to start listening for commands from the main thread.

```typescript
// directive.worker.ts
import { registerWorkerModule, handleWorkerMessages } from '@directive-run/core/worker';
import { analyticsModule } from './modules/analytics';
import { pricingModule } from './modules/pricing';

// Register modules by name (looked up when main thread sends INIT)
registerWorkerModule('analytics', analyticsModule);
registerWorkerModule('pricing', pricingModule);

// Start listening for commands from the main thread
handleWorkerMessages();
```

`registerWorkerModule(name, module)` adds the module to an internal registry. When the main thread sends an `INIT` message, the worker looks up each requested module name in that registry and creates a real `createSystem` internally.

---

## Main Thread Client

Use `createWorkerClient` to get a `WorkerClient` that communicates with the worker over `postMessage`:

```typescript
import { createWorkerClient } from '@directive-run/core/worker';

// Create a Web Worker from the worker script
const worker = new Worker(
  new URL('./directive.worker.ts', import.meta.url)
);

// Connect to the worker with event callbacks
const client = createWorkerClient({
  worker,

  // Called when a fact changes inside the worker
  onFactChange(key, value, prev) {
    console.log(`Fact "${key}" changed:`, prev, '->', value);
  },

  // Called when a derivation recomputes
  onDerivationChange(key, value) {
    console.log(`Derivation "${key}" recomputed:`, value);
  },

  // Called when a constraint emits a new requirement
  onRequirementCreated(requirement) {
    console.log('Requirement created:', requirement.type, requirement.id);
  },

  // Called when a resolver fulfills a requirement
  onRequirementMet(requirementId, resolverId) {
    console.log(`Requirement ${requirementId} met by ${resolverId}`);
  },

  // Called on any worker error
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
// Initialize the system with registered modules and options
await client.init({
  moduleNames: ['analytics', 'pricing'],
  debug: { timeTravel: true, maxSnapshots: 50 },
});

// Start the system (triggers init, constraints, resolvers)
await client.start();
```

Stop and destroy when done:

```typescript
// Gracefully stop the system
await client.stop();

// Destroy the system and clean up resources
await client.destroy();
```

Call `client.terminate()` to immediately terminate the underlying `Worker` without waiting for a graceful shutdown.

### Setting Facts

Write facts by key. These calls are fire-and-forget – they post a message and return immediately:

```typescript
// Write a single fact (fire-and-forget via postMessage)
client.setFact('userId', 'user-42');

// Write multiple facts at once (batched in the worker)
client.setFacts({
  userId: 'user-42',
  region: 'us-east',
  tier: 'premium',
});
```

### Dispatching Events

Send events into the worker system:

```typescript
// Send an event into the worker system
client.dispatch({ type: 'PRICE_REFRESH', currency: 'USD' });
```

---

## Async Queries

Because the system lives in another thread, reads are async. Each returns a `Promise` that resolves when the worker responds.

### getSnapshot

Retrieve a distributable snapshot of the entire system state:

```typescript
// Retrieve the full system state from the worker
const snapshot = await client.getSnapshot();
console.log(snapshot.facts);
console.log(snapshot.derivations);
```

Pass options to control what is included:

```typescript
// Include metadata (constraints, resolvers, etc.)
const snapshot = await client.getSnapshot({ includeMetadata: true });
```

### inspect

Get a detailed inspection of the running system (constraints, resolvers, pending requirements):

```typescript
// Get detailed system inspection (constraints, resolvers, pending requirements)
const inspection = await client.inspect();
console.log(inspection.constraints);
console.log(inspection.pendingRequirements);
```

### settle

Wait for all pending requirements to resolve. Useful in tests or before reading a consistent snapshot:

```typescript
// Wait for all pending requirements to resolve
await client.settle();
const snapshot = await client.getSnapshot();
```

Pass a timeout in milliseconds:

```typescript
// With a timeout – rejects if not settled within 5 seconds
await client.settle(5000);
```

---

## Type-Safe Client

Cast the client to `TypedWorkerClient<M>` to get compile-time checks on `setFact`, `setFacts`, and `dispatch`:

```typescript
import type { TypedWorkerClient } from '@directive-run/core/worker';
import type { analyticsModule } from './modules/analytics';

// Cast the client for compile-time key and value checks
type AnalyticsClient = TypedWorkerClient<typeof analyticsModule.schema>;
const client = createWorkerClient({ worker }) as AnalyticsClient;

// Type-checked fact writes
client.setFact('userId', 'user-42');   // OK
client.setFact('userId', 123);         // Type error: number not assignable to string
client.setFact('nonExistent', true);   // Type error: key doesn't exist

// Type-checked event dispatch
client.dispatch({ type: 'PRICE_REFRESH', currency: 'USD' });
```

---

## Use Cases

- **Heavy computation** – Run expensive constraint evaluation or resolver logic without blocking the UI thread.
- **Background data processing** – Stream data into the worker with `setFacts`, let resolvers transform it, read results via `getSnapshot`.
- **Isolation** – Keep third-party module execution in a separate thread so errors or hangs do not freeze the page.
- **Server-like patterns** – Use the worker as a local "backend" that owns state and business logic while the main thread handles rendering.

---

## Next Steps

- **[Module](/docs/module-system)** and **[Facts](/docs/facts)** – Build the modules you register in the worker.
- **[Constraints](/docs/constraints)** and **[Resolvers](/docs/resolvers)** – Define the rules that run off-thread.
- **[Works With](/docs/works-with/overview)** – Connect Directive to Redux, Zustand, XState, or React Query.
