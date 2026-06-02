# AI MCP + RAG

> Covers `@directive-run/ai/mcp` and `@directive-run/ai` — MCP adapter (`createMCPAdapter`), RAG enricher, embedder utilities.

Model Context Protocol (MCP) server integration and Retrieval-Augmented Generation (RAG) enrichment for Directive AI agents. Import from `@directive-run/ai/mcp` for the MCP adapter (the main barrel re-exports it with `@deprecated` notices for v2 removal), and from `@directive-run/ai` for the RAG enricher + embedder utilities.

> **Client vs. server, two different packages.** This page covers the MCP **client** side — Directive AI agents calling out to external MCP servers. For the **server** side — exposing Directive itself (knowledge files, code examples, Claude Code skills) so other AI clients can consume it — that's `@directive-run/mcp`. Same protocol, opposite arrows.

## Decision tree

```
What do you need?
├── External tool servers (MCP)        → createMCPAdapter({ servers, ... })
│   ├── stdio transport                  → command-based MCP servers
│   └── SSE transport                    → HTTP-based MCP servers
│
├── Knowledge retrieval (RAG)          → createRAGEnricher({ embedder, storage })
│   ├── User-supplied embeddings        → EmbedderFn = (text) => Promise<number[]>
│   ├── Batched embedding calls         → createBatchedEmbedder({ embed, batchSize, ... })
│   ├── Vector storage                  → createJSONFileStore(opts) or your own RAGStorage
│   └── Ingest documents                → enricher.ingest(documents)
```

## MCP server integration

The MCP adapter manages connections to one or more MCP servers, exposes their tools to your agents, and provides constraint-driven approval + risk-scoring for tool calls.

```typescript
import { createMCPAdapter, type MCPTool } from "@directive-run/ai/mcp";

const mcp = createMCPAdapter({
  servers: [
    { name: "tools", transport: "stdio", command: "npx", args: ["mcp-server-tools"] },
    { name: "data",  transport: "sse",   url: "http://localhost:3001/sse" },
  ],
  toolConstraints: {
    "tools/dangerous-tool": { requireApproval: true, maxAttempts: 3 },
    "tools/read-only":      { requireApproval: false },
  },
  autoConnect: false,           // default false — opt-in to connecting on creation
  autoReconnect: true,          // default false — opt-in to reconnect on disconnect
  approvalTimeoutMs: 5 * 60 * 1000, // default 300_000
  allowDirectCalls: false,      // default false — must be true to use callToolDirect()
  clientFactory: (cfg) => new Client(cfg), // optional — supply a real MCP SDK client
  events: {
    onConnect:    ({ server }) => console.log(`mcp:${server} up`),
    onDisconnect: ({ server, reason }) => console.warn(`mcp:${server} down — ${reason}`),
    onToolCall:   ({ server, tool, args }) => log("mcp:tool", { server, tool }),
    onApproval:   (request) => showApprovalDialog(request),
  },
});

await mcp.connect();

// Get available tools — returns Map<serverName, MCPTool[]>, NOT a flat array
const toolsMap: Map<string, MCPTool[]> = mcp.getTools();
const flatTools = Array.from(toolsMap.values()).flat();

// Use tools with an agent
const agent = {
  name: "researcher",
  instructions: "Use available tools to research topics.",
  model: "claude-sonnet-4-5",
  tools: flatTools,
};
```

## MCP server lifecycle

The lifecycle verbs are `connect` / `connectServer(name)` for opening connections, and `disconnect()` / `disconnectServer(name)` for closing them. There is no `mcp.disconnect("name")` mixed form, no `mcp.disconnectAll()`, and no `mcp.getStatus()`.

```typescript
// Connect everything
await mcp.connect();

// Or one server at a time
await mcp.connectServer("tools");

// Status — typed per-server
const single: MCPServerState | undefined = mcp.getServerStatus("tools");
const all:    Map<string, MCPServerState> = mcp.getAllServerStatuses();

// Disconnect one server
await mcp.disconnectServer("tools");

// Disconnect all
await mcp.disconnect();
```

## Calling MCP tools with constraints

`callTool(server, tool, args, facts)` applies per-tool constraints (rate limits, approvals, argument-size caps). Use this in resolvers. `callToolDirect(server, tool, args)` bypasses the constraint pipeline — only available when `allowDirectCalls: true`.

```typescript
const result = await mcp.callTool(
  "tools",
  "search-docs",
  { query: "directive constraints" },
  context.facts, // for constraint evaluation
);

// For trusted internal calls only:
const direct = await mcp.callToolDirect("tools", "internal-ping", {});
```

## Approval workflow for sensitive tools

When `toolConstraints[…].requireApproval: true`, the adapter queues an `MCPApprovalRequest` instead of executing immediately. Surface it via `events.onApproval` and resolve via the instance methods.

```typescript
const pending = mcp.getPendingApprovals();
mcp.approve(request.id);
mcp.reject(request.id, "violates data policy");

// Read the rejection reason for a previously-resolved request
const reason = mcp.getRejectionReason(request.id);
```

## Resource sync

MCP also exposes resources (read-only content the agent can pull). `syncResources` materializes them into Directive facts so constraints can react to them.

```typescript
const resourcesMap = mcp.getResources();          // Map<serverName, MCPResource[]>
const oneResource  = await mcp.readResource("data", "file://config.yaml");
await mcp.syncResources(system.facts);
```

## RAG enrichment

`createRAGEnricher` wires an embedder + a vector store into an agent's input pipeline, retrieving relevant context chunks before the agent runs.

```typescript
import {
  createRAGEnricher,
  createJSONFileStore,
  createBatchedEmbedder,
  createTestEmbedder,
  type EmbedderFn,
  type RAGEnricher,
} from "@directive-run/ai";

// 1. Supply an embedder. EmbedderFn = (text: string) => Promise<number[]>
//    There is no createOpenAIEmbedder / createAnthropicEmbedder factory —
//    you bring your own and pass it through createBatchedEmbedder for production.
const rawEmbed: EmbedderFn = async (text) => {
  const res = await myEmbedAPI.embed(text);
  return res.embedding;
};

const { embed } = createBatchedEmbedder({
  embed: rawEmbed,
  batchSize: 16,
  flushIntervalMs: 50,
});

// 2. Storage — a JSON file store for prototyping, or your own RAGStorage adapter
const storage = createJSONFileStore({ path: "./rag-store.json" });

const enricher: RAGEnricher = createRAGEnricher({
  embedder: embed,
  storage,
  topK: 5,
  minSimilarity: 0.7,
});

// 3. Ingest documents
await enricher.ingest([
  { id: "doc-1", text: "Directive is a constraint-driven runtime…", metadata: { source: "README.md" } },
  { id: "doc-2", text: "Auto-tracked derivations recompute on read…", metadata: { source: "concepts" } },
]);

// 4. Use the enricher in your runner pipeline
const enrichedRunner: AgentRunner = async (agent, input, opts) => {
  const enriched = await enricher.enrich(input);
  return baseRunner(agent, enriched, opts);
};

const orchestrator = createAgentOrchestrator({ runner: enrichedRunner });
```

For testing without API calls, use `createTestEmbedder(dimensions?)` — deterministic, no network.

## Anti-patterns

### `mcp.disconnect(name)` / `mcp.disconnectAll()`

```typescript
// WRONG — neither shape exists
await mcp.disconnect("tools");
await mcp.disconnectAll();

// CORRECT
await mcp.disconnectServer("tools");
await mcp.disconnect();
```

### `mcp.getStatus()`

```typescript
// WRONG — no flat-object status method
const status = mcp.getStatus(); // ?? { tools: "connected", data: "connected" }

// CORRECT — typed per-server
const all = mcp.getAllServerStatuses(); // Map<name, MCPServerState>
const one = mcp.getServerStatus("tools"); // MCPServerState | undefined
```

### Treating `mcp.getTools()` as a flat array

```typescript
// WRONG — getTools() returns Map<serverName, MCPTool[]>
const flat: MCPTool[] = mcp.getTools();
agent.tools = flat;

// CORRECT — flatten if your agent expects a flat list
const flat = Array.from(mcp.getTools().values()).flat();
agent.tools = flat;
```

### Importing from `@directive-run/ai` only

```typescript
// WORKS, but fires v2-deprecation notices
import { createMCPAdapter } from "@directive-run/ai";

// PREFERRED — the subpath barrel is the v2-stable import
import { createMCPAdapter } from "@directive-run/ai/mcp";
```

### `MCPAdapterConfig` option names from a different library

```typescript
// WRONG — these options don't exist
createMCPAdapter({
  servers,
  connectionTimeout: 10_000,
  reconnect: true,
})

// CORRECT — the real names
createMCPAdapter({
  servers,
  autoConnect: true,
  autoReconnect: true,
  approvalTimeoutMs: 300_000,
  allowDirectCalls: false,
  clientFactory: (cfg) => new Client(cfg),
})
```

### `createOpenAIEmbedder` / `createAnthropicEmbedder`

```typescript
// WRONG — no provider-specific embedder factories ship from @directive-run/ai
import { createOpenAIEmbedder } from "@directive-run/ai/openai";
const embedder = createOpenAIEmbedder({ apiKey });

// CORRECT — supply your own EmbedderFn, optionally batched
const rawEmbed: EmbedderFn = async (text) => (await openai.embeddings.create({ input: text, model: "text-embedding-3-small" })).data[0].embedding;
const { embed } = createBatchedEmbedder({ embed: rawEmbed, batchSize: 16 });
```

### Treating `Embedder` as an object with `embed(texts[]): number[][]`

```typescript
// WRONG — there is no Embedder interface; the EmbedderFn signature takes ONE string
type Embedder = { embed(texts: string[]): Promise<number[][]>; dimensions: number };

// CORRECT — single string in, single vector out
type EmbedderFn = (text: string) => Promise<number[]>;
```

## Quick reference

| API | Path | Returns | Purpose |
|---|---|---|---|
| `createMCPAdapter(config)` | `@directive-run/ai/mcp` | `MCPAdapter` | Connect to MCP servers, expose tools |
| `mcp.connect()` / `connectServer(name)` | instance method | `Promise<void>` | Open one or all connections |
| `mcp.disconnect()` / `disconnectServer(name)` | instance method | `Promise<void>` | Close one or all connections |
| `mcp.getTools()` | instance method | `Map<string, MCPTool[]>` | All tools, keyed by server |
| `mcp.getResources()` | instance method | `Map<string, MCPResource[]>` | All resources, keyed by server |
| `mcp.callTool(server, tool, args, facts)` | instance method | `Promise<MCPToolResult>` | Constraint-checked tool call |
| `mcp.callToolDirect(server, tool, args)` | instance method | `Promise<MCPToolResult>` | Bypass constraints (requires `allowDirectCalls: true`) |
| `mcp.getServerStatus(name)` / `getAllServerStatuses()` | instance method | `MCPServerState` | Per-server connection state |
| `mcp.approve(id)` / `reject(id, reason?)` | instance method | `void` | Resolve a pending approval |
| `createRAGEnricher(config)` | `@directive-run/ai` | `RAGEnricher` | Embedding-driven context retrieval |
| `createBatchedEmbedder(config)` | `@directive-run/ai` | `{ embed, flush, dispose }` | Wrap an EmbedderFn with batching |
| `createTestEmbedder(dim?)` | `@directive-run/ai` | `EmbedderFn` | Deterministic embedder for tests |
| `createJSONFileStore(options)` | `@directive-run/ai` | `RAGStorage` | File-backed vector store for prototyping |

## See also

- [`ai-orchestrator.md`](./ai-orchestrator.md) — where MCP-supplied tools and RAG-enriched runners flow into agent runs
- [`ai-security.md`](./ai-security.md) — `toolConstraints[…].requireApproval` and the per-tool approval workflow the MCP adapter exposes
