---
title: RAG Enricher
description: Retrieve relevant document chunks by semantic similarity and assemble enriched inputs for any agent – composable retrieval-augmented generation for Directive.
---

Embed a query, search a chunk store, and build context-enriched agent inputs automatically. {% .lead %}

---

## Overview

`createRAGEnricher` pairs an embedder with a storage backend to retrieve relevant document chunks by cosine similarity and assemble them into a single enriched input string. The enricher is storage-agnostic – plug in the built-in JSON file store or bring your own vector database.

```typescript
import {
  createRAGEnricher,
  createJSONFileStore,
  createOpenAIEmbedder,
} from '@directive-run/ai';

const enricher = createRAGEnricher({
  embedder: createOpenAIEmbedder({ apiKey: process.env.OPENAI_API_KEY! }),
  storage: createJSONFileStore({ filePath: './embeddings.json' }),
  topK: 5,
  minSimilarity: 0.3,
});
```

---

## API

### `createRAGEnricher(config)`

Returns a `RAGEnricher` with two methods: `retrieve()` and `enrich()`.

#### `RAGEnricherConfig`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `embedder` | `EmbedderFn` | *required* | Function to generate query embeddings |
| `storage` | `RAGStorage` | *required* | Storage backend for document chunks |
| `topK` | `number` | `5` | Number of top results to return |
| `minSimilarity` | `number` | `0.3` | Minimum cosine similarity to include (clamped to [0, 1]) |
| `formatChunk` | `(chunk, similarity) => string` | built-in | Custom chunk formatter |
| `formatContext` | `(formattedChunks, query) => string` | built-in | Custom context block formatter |
| `onError` | `(error: Error) => void` | – | Error callback (embedder/storage errors are non-fatal by default) |

### `retrieve(query, topK?)`

Returns the top-K chunks sorted by descending cosine similarity, each annotated with a `similarity` score. Uses the storage backend's optimized `search()` method when available, otherwise performs a full scan via `getChunks()`. Errors from the embedder or storage propagate to the caller; use `enrich()` for automatic error handling via the `onError` callback.

```typescript
const chunks = await enricher.retrieve('How do constraints work?');
// => Array<RAGChunk & { similarity: number }>

for (const chunk of chunks) {
  console.log(`${chunk.id} (${chunk.similarity.toFixed(2)}): ${chunk.content.slice(0, 80)}`);
}
```

### `enrich(input, options?)`

Calls `retrieve()` internally, applies an optional `filter`, formats the results, and assembles all parts (prefix, context, history, query) separated by `---` delimiters.

```typescript
const enrichedInput = await enricher.enrich('How do constraints work?', {
  prefix: 'User is viewing: /docs/constraints',
  history: [
    { role: 'user', content: 'What is Directive?' },
    { role: 'assistant', content: 'A constraint-driven runtime for TypeScript.' },
  ],
  topK: 3,
  filter: (chunk) => chunk.metadata.section === 'constraints',
});

// Pass the enriched input to any agent runner — returns RunResult<T>
const result = await stack.run('docs-qa', enrichedInput);
```

#### `RAGEnrichOptions`

| Property | Type | Description |
|----------|------|-------------|
| `prefix` | `string` | Prefix line prepended to the enriched input (e.g. current page URL) |
| `history` | `Array<{ role: string, content: string }>` | Conversation history included between context and query |
| `topK` | `number` | Per-call override for the number of results |
| `filter` | `(chunk: RAGChunk) => boolean` | Filter chunks after retrieval but before formatting |

---

## RAGStorage Interface

Any object that implements `RAGStorage` can be used as the storage backend:

```typescript
interface RAGStorage {
  /** Return all stored chunks */
  getChunks(): Promise<RAGChunk[]>;
  /** Return the total number of chunks */
  size(): Promise<number>;
  /** Optional: optimized vector search (bypasses full getChunks scan) */
  search?(query: Embedding, topK: number, minSimilarity: number):
    Promise<Array<RAGChunk & { similarity: number }>>;
  /** Reload storage (clear cache, re-read from source) */
  reload?(): Promise<void>;
  /** Dispose of resources */
  dispose?(): void;
}
```

Each `RAGChunk` has the following shape:

```typescript
interface RAGChunk {
  id: string;
  content: string;
  embedding: Embedding;       // Embedding is number[] (vector of floats)
  metadata: Record<string, unknown>;
}
```

### Metadata Conventions

The `metadata` field is intentionally untyped to support any use case. The built-in `defaultFormatChunk` recognizes these optional fields:

| Field | Type | Used for |
|-------|------|----------|
| `title` | `string` | Chunk header (e.g. page title) |
| `section` | `string` | Sub-section label |
| `url` | `string` | Link to the source document |

When all three are present, the default formatter renders `[Title – Section](url)` as the chunk header. You can add any additional metadata fields for use in custom formatters or filters.

If your storage backend provides a `search()` method (e.g. a vector database with built-in ANN search), the enricher will use it instead of loading all chunks and scanning in memory.

---

## Built-in: JSON File Store

`createJSONFileStore` creates a storage backend that reads chunks from a JSON file on disk. The file is lazy-loaded and cached in memory.

```typescript
import { createJSONFileStore } from '@directive-run/ai';

const storage = createJSONFileStore({
  filePath: './embeddings.json',
  ttlMs: 60_000,  // Re-read the file every 60 seconds
  mapEntry: (raw) => ({
    id: raw.slug as string,
    content: raw.body as string,
    embedding: raw.vec as number[],
    metadata: { title: raw.title, url: raw.href },
  }),
});
```

### `JSONFileStoreOptions`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `filePath` | `string` | *required* | Absolute or relative path to the JSON embeddings file |
| `mapEntry` | `(entry) => RAGChunk` | identity | Transform raw JSON entries into `RAGChunk` objects |
| `ttlMs` | `number` | `0` | Cache TTL in ms. `0` means cache forever until `reload()` or `dispose()` |

The store uses dynamic `import('node:fs')` so it can be imported isomorphically without breaking browser bundles. Load failures log a dev-mode warning and return an empty chunk array.

---

## Built-in: OpenAI Embedder

`createOpenAIEmbedder` creates an `EmbedderFn` that calls the OpenAI embeddings API directly (no SDK dependency).

```typescript
import { createOpenAIEmbedder } from '@directive-run/ai';

const embedder = createOpenAIEmbedder({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'text-embedding-3-small',
  dimensions: 1536,
});
```

### `OpenAIEmbedderOptions`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `apiKey` | `string` | *required* | OpenAI API key |
| `model` | `string` | `'text-embedding-3-small'` | Embedding model name |
| `dimensions` | `number` | `1536` | Output embedding dimensions |
| `baseURL` | `string` | `'https://api.openai.com/v1'` | API base URL (for proxies or compatible APIs) |
| `fetch` | `typeof fetch` | `globalThis.fetch` | Custom fetch implementation |

Requests time out after 30 seconds via `AbortSignal.timeout`.

---

## Custom Formatters

Override how chunks and the final context block are formatted:

```typescript
const enricher = createRAGEnricher({
  embedder,
  storage,
  formatChunk: (chunk, similarity) =>
    `## ${chunk.metadata.title} (${(similarity * 100).toFixed(0)}% match)\n${chunk.content}`,
  formatContext: (formattedChunks, query) =>
    formattedChunks.length > 0
      ? `Use the following documentation to answer "${query}":\n\n${formattedChunks.join('\n\n')}`
      : 'No relevant documentation found.',
});
```

The default `formatChunk` renders `[Title – Section](url)` when all three metadata fields are present, otherwise falls back to `title` alone or `chunk.id`. The default `formatContext` wraps the chunks under a "Relevant documentation context:" header.

---

## Integration with AgentStack and SSE Transport

Combine the RAG enricher with [AgentStack](/docs/ai/agent-stack) and [SSE Transport](/docs/ai/sse-transport) for a full server-side chat pipeline:

```typescript
import {
  createAgentStack,
  createAnthropicRunner,
  createAnthropicStreamingRunner,
  createRAGEnricher,
  createJSONFileStore,
  createOpenAIEmbedder,
  createSSETransport,
} from '@directive-run/ai';

// 1. Enricher
const enricher = createRAGEnricher({
  embedder: createOpenAIEmbedder({ apiKey: process.env.OPENAI_API_KEY! }),
  storage: createJSONFileStore({ filePath: './embeddings.json' }),
});

// 2. Agent stack
const stack = createAgentStack({
  runner: createAnthropicRunner({ apiKey: process.env.ANTHROPIC_API_KEY! }),
  streaming: {
    runner: createAnthropicStreamingRunner({ apiKey: process.env.ANTHROPIC_API_KEY! }),
  },
  agents: {
    'docs-qa': {
      agent: {
        name: 'docs-qa',
        instructions: 'Answer questions using the provided documentation context.',
        model: 'claude-sonnet-4-5-20250929',
      },
      capabilities: ['chat'],
    },
  },
});

// 3. SSE transport
const transport = createSSETransport({ maxResponseChars: 10_000 });

// 4. Route handler (Next.js App Router)
export async function POST(request: Request) {
  const { message, history } = await request.json();
  const enrichedInput = await enricher.enrich(message, { history });

  return transport.toResponse(stack, 'docs-qa', enrichedInput);
}
```

---

## Next Steps

- [SSE Transport](/docs/ai/sse-transport) – Stream enriched responses over HTTP
- [Agent Stack](/docs/ai/agent-stack) – Compose all AI features in one factory
- [Guardrails](/docs/ai/guardrails) – Input/output validation and safety
- [Streaming](/docs/ai/streaming) – Real-time token streaming and backpressure
