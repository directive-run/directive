---
"@directive-run/knowledge-mcp": minor
---

New package `@directive-run/knowledge-mcp` — a Model Context Protocol server that exposes the Directive knowledge package as MCP tools so production AI agents can query at retrieval time instead of bundling a static snapshot.

Two transports ship in one binary:

- **stdio** (`directive-knowledge-mcp`) — Claude Desktop, Cursor MCP, MCP Inspector, and any client that spawns the server as a subprocess.
- **SSE** (`directive-knowledge-mcp --sse --port <port> --host <host>`) — HTTP transport for hosting at `mcp.directive.run` or a private MCP gateway.

Seven tools:

- `list_knowledge` / `get_knowledge` — knowledge file discovery + read.
- `list_examples` / `get_example` — code-example discovery + read.
- `search_knowledge` — case-insensitive substring search across every knowledge file (up to 50 hits with line context).
- `list_skills` / `get_skill` — Claude Code skill discovery + read (manifest + supporting files concatenated).

Programmatic exports: `createDirectiveKnowledgeServer()` returns a transport-agnostic `McpServer`; `startSseServer({ port, host, logger })` returns the underlying `http.Server` so callers can shut it down.

Pattern matches zustand's `docs.pmnd.rs/api/sse`.
