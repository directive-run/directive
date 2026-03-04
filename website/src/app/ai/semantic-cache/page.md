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
  similarityThreshold: 0.85,  // Cosine similarity threshold (0–1)
  ttlMs: 3600000,             // Cache entries expire after 1 hour
  onHit: (entry, similarity) => console.log('Cache hit:', entry.query, similarity),
  onMiss: (query) => console.log('Cache miss:', query),
});

// Use as a guardrail – short-circuits the agent call on cache hit
const guardrail = createSemanticCacheGuardrail({ cache });

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
| `similarityThreshold` | `number` | `0.9` | Cosine similarity threshold (0&ndash;1) |
| `maxCacheSize` | `number` | `1000` | Maximum number of entries to cache |
| `ttlMs` | `number` | `3600000` | Cache entry TTL (ms) |
| `namespace` | `string` | &ndash; | Cache namespace for multi-tenant scenarios |
| `storage` | `SemanticCacheStorage` | &ndash; | Custom storage backend (defaults to in-memory) |
| `perAgent` | `boolean` | &ndash; | Include agent name in cache key |
| `onHit` | `(entry, similarity) => void` | &ndash; | Cache hit callback |
| `onMiss` | `(query) => void` | &ndash; | Cache miss callback |
| `onError` | `(error) => void` | &ndash; | Cache lookup error callback |

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

Implement the `SemanticCacheStorage` interface for persistent backends:

```typescript
const storage = {
  getEntries: async (namespace: string) => { /* ... */ },
  addEntry: async (namespace: string, entry: CacheEntry) => { /* ... */ },
  updateEntry: async (namespace: string, id: string, updates: Partial<CacheEntry>) => { /* ... */ },
  removeEntry: async (namespace: string, id: string) => { /* ... */ },
  clear: async (namespace: string) => { /* ... */ },
};
```

---

## Cache Guardrail

`createSemanticCacheGuardrail` returns a guardrail that intercepts agent input and returns the cached response on a hit, bypassing the LLM entirely:

```typescript
import { createSemanticCacheGuardrail } from '@directive-run/ai';

const guardrail = createSemanticCacheGuardrail({ cache });

// Single-agent
const orchestrator = createAgentOrchestrator({
  runner,
  guardrails: { input: [guardrail] },
});

// Multi-agent – cache guardrail at orchestrator level applies to all agents
const multi = createMultiAgentOrchestrator({
  runner,
  agents: { researcher: { agent: researcher }, writer: { agent: writer } },
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

- [Guardrails](/ai/guardrails) &ndash; Input/output validation
- [Resilience & Routing](/ai/resilience-routing) &ndash; Retry, fallback, budgets
- [RAG Enricher](/ai/rag) &ndash; Retrieval-augmented generation
