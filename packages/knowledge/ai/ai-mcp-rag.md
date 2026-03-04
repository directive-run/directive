# AI MCP and RAG

MCP (Model Context Protocol) server integration and RAG (Retrieval-Augmented Generation) enrichment for Directive AI agents.

## Decision Tree: "How do I connect external tools or knowledge?"

```
What do you need?
├── External tool servers (MCP) → createMCPAdapter({ servers: [...] })
│   ├── stdio transport      → command-based MCP servers
│   └── SSE transport        → HTTP-based MCP servers
│
├── Knowledge retrieval (RAG) → createRAGEnricher({ embedder, storage })
│   ├── Need embeddings       → createOpenAIEmbedder() or createAnthropicEmbedder()
│   ├── Need vector storage   → createJSONFileStore() or custom VectorStore
│   └── Need chunk ingestion  → enricher.ingest(documents)
│
Where do I import from?
├── MCP adapter → import { createMCPAdapter } from '@directive-run/ai'
├── RAG enricher → import { createRAGEnricher } from '@directive-run/ai'
└── Embedders → import from '@directive-run/ai/openai' (subpath)
```

## MCP Server Integration

Connect to MCP servers to give agents access to external tools:

```typescript
import { createMCPAdapter } from "@directive-run/ai";

const mcp = createMCPAdapter({
  servers: [
    // stdio transport — runs a local process
    {
      name: "tools",
      transport: "stdio",
      command: "npx mcp-server-tools",
    },
    // SSE transport — connects to an HTTP server
    {
      name: "data",
      transport: "sse",
      url: "http://localhost:3001/sse",
    },
  ],

  // Per-tool constraints
  toolConstraints: {
    "tools/dangerous-tool": {
      requireApproval: true,
      maxAttempts: 3,
    },
    "tools/read-only": {
      requireApproval: false,
    },
  },

  // Connection options
  connectionTimeout: 10000,
  reconnect: true,
});

// Connect to all servers
await mcp.connect();

// Get available tools (normalized for Directive agents)
const tools = mcp.getTools();

// Use tools with an agent
const agent = {
  name: "researcher",
  instructions: "Use available tools to research topics.",
  model: "claude-sonnet-4-5",
  tools: tools,
};
```

### Anti-Pattern #36: Importing MCP from subpath

```typescript
// WRONG — there is no /mcp subpath export
import { createMCPToolProvider } from "@directive-run/ai/mcp";

// CORRECT — MCP adapter is exported from the main package
import { createMCPAdapter } from "@directive-run/ai";
```

## MCP Server Lifecycle

```typescript
// Connect to all configured servers
await mcp.connect();

// Check server status
const status = mcp.getStatus();
// { tools: "connected", data: "connected" }

// Disconnect a specific server
await mcp.disconnect("tools");

// Disconnect all servers
await mcp.disconnectAll();

// Reconnect after disconnect
await mcp.connect();
```

## MCP with Orchestrator

```typescript
import { createAgentOrchestrator } from "@directive-run/ai";

const mcp = createMCPAdapter({
  servers: [
    { name: "tools", transport: "stdio", command: "npx mcp-server-tools" },
  ],
});

await mcp.connect();

const orchestrator = createAgentOrchestrator({
  runner,
  hooks: {
    onStart: async () => {
      await mcp.connect();
    },
  },
});

const agent = {
  name: "worker",
  instructions: "Complete tasks using available tools.",
  model: "claude-sonnet-4-5",
  tools: mcp.getTools(),
};

const result = await orchestrator.run(agent, "Search for recent AI papers");
```

---

## RAG Enrichment

Augment agent prompts with relevant context from a knowledge base:

```typescript
import { createRAGEnricher } from "@directive-run/ai";
import { createOpenAIEmbedder } from "@directive-run/ai/openai";

const enricher = createRAGEnricher({
  // Embedder for similarity search
  embedder: createOpenAIEmbedder({
    apiKey: process.env.OPENAI_API_KEY,
  }),

  // Vector storage backend
  storage: createJSONFileStore({ filePath: "./chunks.json" }),

  // Retrieval settings
  topK: 5,              // Max chunks to retrieve
  minSimilarity: 0.3,   // Minimum cosine similarity threshold

  // Format each retrieved chunk
  formatChunk: (chunk, similarity) => {
    return `[${similarity.toFixed(2)}] ${chunk.content}`;
  },
});
```

## Ingesting Documents

```typescript
// Ingest raw text with metadata
await enricher.ingest([
  {
    content: "Directive uses proxy-based facts for auto-tracking.",
    metadata: { source: "docs", topic: "facts" },
  },
  {
    content: "Derivations are auto-tracked computed values.",
    metadata: { source: "docs", topic: "derivations" },
  },
]);

// Ingest from files (chunks automatically)
await enricher.ingestFile("./docs/architecture.md", {
  chunkSize: 500,
  chunkOverlap: 50,
  metadata: { source: "architecture" },
});
```

## Enriching Prompts

```typescript
// Basic enrichment — prepends relevant context
const enrichedInput = await enricher.enrich("How do facts work?", {
  prefix: "Use this context to answer:\n",
});
// Result: "Use this context to answer:\n[0.92] Directive uses proxy-based..."

// With conversation history for better retrieval
const enrichedInput = await enricher.enrich("Tell me more about that", {
  prefix: "Use this context:\n",
  history: messages,
});
```

## RAG with Orchestrator

```typescript
import { createAgentOrchestrator } from "@directive-run/ai";

const orchestrator = createAgentOrchestrator({
  runner,
  hooks: {
    onBeforeRun: async (agent, prompt) => {
      // Enrich every prompt with relevant context
      const enriched = await enricher.enrich(prompt, {
        prefix: "Relevant context:\n",
      });

      return { approved: true, modifiedPrompt: enriched };
    },
  },
});
```

## Custom Embedders

Implement the `Embedder` interface for any provider:

```typescript
import type { Embedder } from "@directive-run/ai";

const customEmbedder: Embedder = {
  embed: async (texts: string[]) => {
    // Return float arrays, one per input text
    const embeddings = await myEmbeddingAPI.embed(texts);

    return embeddings.map((e) => e.vector);
  },

  dimensions: 1536, // Vector dimensions
};

const enricher = createRAGEnricher({
  embedder: customEmbedder,
  storage: createJSONFileStore({ filePath: "./chunks.json" }),
  topK: 5,
  minSimilarity: 0.3,
});
```

## Custom Vector Storage

Implement the `VectorStore` interface for any backend:

```typescript
import type { VectorStore } from "@directive-run/ai";

const pgStore: VectorStore = {
  add: async (chunks) => {
    await db.query("INSERT INTO chunks ...", chunks);
  },
  search: async (vector, topK) => {
    const results = await db.query(
      "SELECT * FROM chunks ORDER BY embedding <=> $1 LIMIT $2",
      [vector, topK],
    );

    return results.rows;
  },
  clear: async () => {
    await db.query("DELETE FROM chunks");
  },
};
```

## Quick Reference

| API | Import Path | Purpose |
|---|---|---|
| `createMCPAdapter` | `@directive-run/ai` | Connect to MCP tool servers |
| `createRAGEnricher` | `@directive-run/ai` | RAG pipeline for prompt enrichment |
| `createOpenAIEmbedder` | `@directive-run/ai/openai` | OpenAI text embeddings |
| `createAnthropicEmbedder` | `@directive-run/ai/anthropic` | Anthropic text embeddings |
| `createJSONFileStore` | `@directive-run/ai` | File-based vector storage |
