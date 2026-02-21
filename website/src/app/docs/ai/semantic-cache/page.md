---
title: Semantic Cache
description: Embedding-based semantic caching for AI agent responses with ANN indexes and batched embedding.
---

Cache agent responses by semantic similarity so equivalent questions hit cache instead of calling the LLM. {% .lead %}

The semantic cache uses embeddings to match similar inputs, pluggable storage backends, and approximate nearest neighbor (ANN) indexes for fast lookups at scale.

---

## Quick Start

```typescript
import {
  createSemanticCache,
  createBruteForceIndex,
  createInMemoryStorage,
  createSemanticCacheGuardrail,
} from '@directive-run/ai';

const cache = createSemanticCache({
  embedder: async (texts) => {
    // Your embedding function – returns number[][] of vectors
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts,
    });

    return response.data.map((d) => d.embedding);
  },
  storage: createInMemoryStorage(),
  index: createBruteForceIndex(),
  similarity: 0.85,    // Cosine similarity threshold (0–1)
  maxAge: 3600000,      // Cache entries expire after 1 hour
  onHit: (key, cached) => console.log('Cache hit:', key),
  onMiss: (key) => console.log('Cache miss:', key),
});

// Use as a guardrail – short-circuits the agent call on cache hit
const guardrail = createSemanticCacheGuardrail(cache);

const orchestrator = createAgentOrchestrator({
  runner,
  guardrails: {
    input: [guardrail],
  },
});
```

---

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `embedder` | `EmbedderFn` | *required* | `(texts: string[]) => Promise<number[][]>` |
| `storage` | `CacheStorage` | *required* | Where to store cached entries |
| `index` | `ANNIndex` | *required* | Nearest-neighbor index |
| `similarity` | `number` | `0.85` | Cosine similarity threshold (0&ndash;1) |
| `maxAge` | `number` | &ndash; | Cache entry TTL (ms) |
| `onHit` | `(key, cached) => void` | &ndash; | Cache hit callback |
| `onMiss` | `(key) => void` | &ndash; | Cache miss callback |

---

## ANN Indexes

### Brute Force

Exact search &ndash; compares against every entry. Best for small datasets (<10K entries):

```typescript
import { createBruteForceIndex } from '@directive-run/ai';

const index = createBruteForceIndex();
```

### VP-Tree

Vantage-Point Tree for larger datasets. Reduces search from O(n) to O(log n) average:

```typescript
import { createVPTreeIndex } from '@directive-run/ai';

const index = createVPTreeIndex();
```

---

## Batched Embedding

Batch concurrent embedding calls to reduce API round-trips:

```typescript
import { createBatchedEmbedder } from '@directive-run/ai';

const batchedEmbedder = createBatchedEmbedder(
  async (texts) => {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts,
    });

    return response.data.map((d) => d.embedding);
  },
  {
    maxBatchSize: 100,
    maxWaitMs: 50,
  }
);
```

Concurrent `batchedEmbedder()` calls within the `maxWaitMs` window are collected into a single batch call to the underlying embedder.

---

## Storage

### In-Memory

```typescript
import { createInMemoryStorage } from '@directive-run/ai';

const storage = createInMemoryStorage();
```

### Custom Storage

Implement the `CacheStorage` interface for persistent backends:

```typescript
const storage = {
  get: async (key: string) => { /* ... */ },
  set: async (key: string, value: CacheEntry) => { /* ... */ },
  delete: async (key: string) => { /* ... */ },
  clear: async () => { /* ... */ },
  entries: async () => { /* ... */ },
};
```

---

## Cache Guardrail

`createSemanticCacheGuardrail` returns a guardrail that intercepts agent input and returns the cached response on a hit, bypassing the LLM entirely:

```typescript
import { createSemanticCacheGuardrail } from '@directive-run/ai';

const guardrail = createSemanticCacheGuardrail(cache);

// Use with either orchestrator
const orchestrator = createAgentOrchestrator({
  runner,
  guardrails: { input: [guardrail] },
});
```

On a cache miss, the agent runs normally and the result is cached for future queries.

---

## Testing

```typescript
import { createTestEmbedder } from '@directive-run/ai';

// Deterministic embedder for tests – consistent vectors for same input
const testEmbedder = createTestEmbedder();
```

---

## Embedder Function

The `EmbedderFn` type:

```typescript
type EmbedderFn = (texts: string[]) => Promise<number[][]>;
```

It receives an array of strings and returns an array of embedding vectors (number arrays). The vectors must all have the same dimensionality.

---

## Next Steps

- [Guardrails](/docs/ai/guardrails) &ndash; Input/output validation
- [Resilience & Routing](/docs/ai/resilience-routing) &ndash; Retry, fallback, budgets
- [RAG Enricher](/docs/ai/rag) &ndash; Retrieval-augmented generation
