# `@directive-run/knowledge-mcp`

A Model Context Protocol server that exposes the Directive knowledge package as MCP tools — every knowledge doc, code example, and Claude Code skill bundle, queryable at retrieval time instead of bundled as a static snapshot.

Two transports ship in the same binary:

- **stdio** — the canonical MCP local-client pattern. Plugs into Claude Desktop, Cursor MCP, the MCP Inspector, and any other client that spawns an MCP server as a subprocess.
- **SSE (HTTP)** — for hosting at `mcp.directive.run` or a private MCP gateway. Production AI agents query the hosted endpoint at runtime; no embedding pipeline, no bundle bloat.

## Install

```bash
npm install -g @directive-run/knowledge-mcp
# or run directly without installing:
npx @directive-run/knowledge-mcp --help
```

## stdio transport (local clients)

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "directive": {
      "command": "npx",
      "args": ["-y", "@directive-run/knowledge-mcp"]
    }
  }
}
```

Or test with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector npx -y @directive-run/knowledge-mcp
```

## SSE transport (hosted)

```bash
directive-knowledge-mcp --sse --port 3000 --host 0.0.0.0
```

Endpoints:

- `GET /sse` — establish the SSE stream.
- `POST /messages?sessionId=…` — client→server JSON-RPC messages.
- `GET /healthz` — liveness probe.

## Tools

| Tool | Purpose |
|---|---|
| `list_knowledge` | Every knowledge file name (core + AI + skeleton). |
| `get_knowledge` | Read one knowledge file by name. |
| `list_examples` | Every code example name. |
| `get_example` | Read one example by name (returned as a TypeScript code block). |
| `search_knowledge` | Case-insensitive substring search across every knowledge file. |
| `list_skills` | Every Claude Code skill bundled in `@directive-run/claude-plugin`. |
| `get_skill` | One skill's `SKILL.md` + supporting knowledge files as a single document. |

## Programmatic embedding

For tool authors who want to mount the server inside their own host process:

```typescript
import { createDirectiveKnowledgeServer, startSseServer } from "@directive-run/knowledge-mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// stdio
const server = createDirectiveKnowledgeServer();
await server.connect(new StdioServerTransport());

// SSE — returns the underlying http.Server
const httpServer = await startSseServer({ port: 3000, host: "0.0.0.0" });
```

## See also

- [`@directive-run/knowledge`](../knowledge) — the knowledge package this server fronts.
- [`@directive-run/claude-plugin`](../claude-plugin) — the Claude Code skill bundles also exposed.
- [`@directive-run/cli`](../cli) — generate static `.cursorrules` / `CLAUDE.md` / `.windsurfrules` files for assistants that don't speak MCP.
- [docs/ide-integration](https://directive.run/docs/ide-integration) — decision tree across every install path.
