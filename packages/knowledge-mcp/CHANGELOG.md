# @directive-run/knowledge-mcp

## 0.1.0

### Minor Changes

- [`a87bbb4`](https://github.com/directive-run/directive/commit/a87bbb4a60c4852d9c2214cebe58fd8bff1ab24c) Thanks [@jasoncomes](https://github.com/jasoncomes)! - New package `@directive-run/knowledge-mcp` — a Model Context Protocol server that exposes the Directive knowledge package as MCP tools so production AI agents can query at retrieval time instead of bundling a static snapshot.

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

### Patch Changes

- Updated dependencies [[`2cee19e`](https://github.com/directive-run/directive/commit/2cee19e9819be81a00ad8d1cd64a620c7621a032), [`06be54d`](https://github.com/directive-run/directive/commit/06be54d891c91a3ee0b170f4bc66e6e37fe5a023), [`92d7930`](https://github.com/directive-run/directive/commit/92d793041ea3aac3190b798304913359f8588e20)]:
  - @directive-run/claude-plugin@1.16.0
  - @directive-run/knowledge@1.16.0
