---
title: Web Worker Bridge
description: Run Directive systems in Web Workers for off-main-thread processing.
---

Offload Directive processing to Web Workers. {% .lead %}

---

## Installation

```bash
npm install directive directive/worker
```

---

## Basic Setup

Create a worker-based system:

```typescript
// main.ts
import { createWorkerClient } from 'directive/worker';

const system = await createWorkerClient({
  worker: new Worker('./directive.worker.ts'),
  module: 'my-module',
});

// Use like a normal system
system.facts.count = 10;
```

```typescript
// directive.worker.ts
import { createWorkerHost } from 'directive/worker';
import { myModule } from './modules';

createWorkerHost({
  modules: { 'my-module': myModule },
});
```

---

## Async Communication

All operations are async over the worker boundary:

```typescript
// Reading facts
const count = await system.read('count');

// Batch reads
const { count, user } = await system.readMany(['count', 'user']);

// Writing facts
await system.write('count', 10);

// Batch writes
await system.writeMany({
  count: 10,
  user: { name: 'John' },
});
```

---

## Event Streaming

Stream events from worker to main thread:

```typescript
system.on('DATA_UPDATED', (payload) => {
  // Runs on main thread
  updateUI(payload);
});
```

---

## Transferable Objects

Optimize large data transfers:

```typescript
await system.write('buffer', arrayBuffer, {
  transfer: [arrayBuffer],
});
```

---

## Shared Workers

Use SharedWorker for multiple tabs:

```typescript
const system = await createWorkerClient({
  worker: new SharedWorker('./directive.shared-worker.ts'),
  module: 'my-module',
});
```

---

## Use Cases

- Heavy computation without blocking UI
- Background data processing
- Shared state across browser tabs
- Isolating third-party module execution

---

## Next Steps

- See Module and System for basic setup
- See Advanced topics for more patterns
- See Performance for optimization tips
