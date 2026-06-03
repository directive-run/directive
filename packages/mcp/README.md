# `@directive-run/mcp`

A Model Context Protocol server that exposes Directive to AI clients. Today's tools cover knowledge files, code examples, and Claude Code skill bundles — queryable at retrieval time instead of bundled as a static snapshot. The package is the umbrella for "Directive as an MCP server," with room to grow into runtime introspection, system state, and tooling.

Two transports ship in the same binary:

- **stdio** — the canonical MCP local-client pattern. Plugs into Claude Desktop, Cursor MCP, the MCP Inspector, and any other client that spawns an MCP server as a subprocess.
- **SSE (HTTP)** — for hosting at `mcp.directive.run` or a private MCP gateway. Production AI agents query the hosted endpoint at runtime; no embedding pipeline, no bundle bloat.

> **Client vs. server, two different packages.** This package is the MCP **server** side — it serves Directive to outside clients. If you want the **client** side — Directive AI agents calling out to external MCP servers (filesystem, GitHub, etc.) — that's `@directive-run/ai/mcp` (`createMCPAdapter`). Same protocol, opposite arrows.

## Install

```bash
npm install -g @directive-run/mcp
# or run directly without installing:
npx @directive-run/mcp --help
```

## stdio transport (local clients)

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "directive": {
      "command": "npx",
      "args": ["-y", "@directive-run/mcp"]
    }
  }
}
```

Or test with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector npx -y @directive-run/mcp
```

## SSE transport (hosted)

```bash
# Loopback (local dev) — no token required
directive-mcp --sse --port 3000

# Public host — token is mandatory
directive-mcp --sse --port 3000 --host 0.0.0.0 \
  --token "$DIRECTIVE_MCP_TOKEN" \
  --allow-origin https://app.example.com
```

The SSE server **refuses to start** on a non-loopback host without `--token` (or `DIRECTIVE_MCP_TOKEN`). When a token is set, every request to `/sse` and `/messages` must carry `Authorization: Bearer <token>`. Body size is capped at 1 MB; concurrent sessions at 64; idle sessions are pruned at 5 minutes.

Endpoints:

- `GET /sse` — establish the SSE stream.
- `POST /messages?sessionId=…` — client→server JSON-RPC messages.
- `GET /healthz` — liveness probe.

## Tools (20)

### Knowledge

| Tool | Purpose |
|---|---|
| `list_knowledge` | Every knowledge file name (core + AI + skeleton). |
| `get_knowledge` | Read one knowledge file by name. |
| `search_knowledge` | Case-insensitive substring search across every knowledge file. |
| `list_examples` | Every code example name. |
| `get_example` | Read one example by name (returned as a TypeScript code block). |
| `search_examples` | Case-insensitive substring search across the 37 bundled example .ts files. |

### Packages

| Tool | Purpose |
|---|---|
| `list_packages` | Every `@directive-run/*` package with one-line description. |
| `get_package_info` | Single-package detail (baked metadata + live npm version, 1 h cache). |
| `get_composable_packages` | Outgoing and incoming composition edges for one package. |

### Generate

| Tool | Purpose |
|---|---|
| `generate_module` | Generate NEW Directive module or AI orchestrator source. Returns the source string; never writes to disk. |
| `list_module_sections` | Enumerate the valid `sections` values for `generate_module`. |

### Review

| Tool | Purpose |
|---|---|
| `list_review_rules` | Directive anti-patterns and ts-morph rules as structured data. |
| `get_review_rule` | One rule's full detail: WRONG/CORRECT example pair + explanation. |
| `review_source` | Run the rule registry against a TypeScript source string. Returns structured findings. |
| `fix_code` | Apply a rule's mechanical fix; returns diff + fixed source. |

### Migration

| Tool | Purpose |
|---|---|
| `list_migration_sources` | Source libraries `get_migration_pattern` accepts. |
| `get_migration_pattern` | Concept map + steps + before/after for migrating from Redux / Zustand / XState / MobX / Jotai / Recoil. |

### Skills

| Tool | Purpose |
|---|---|
| `list_skills` | Every Claude Code skill bundled in `@directive-run/claude-plugin`. |
| `get_skill` | One skill's `SKILL.md` + supporting knowledge files as a single document. |

### Server

| Tool | Purpose |
|---|---|
| `get_server_info` | Version + transport + auth state + bundled-knowledge hash + session count. |

## Programmatic embedding

For tool authors who want to mount the server inside their own host process:

```typescript
import { createDirectiveServer, startSseServer } from "@directive-run/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// stdio
const server = createDirectiveServer();
await server.connect(new StdioServerTransport());

// SSE — returns the underlying http.Server
const httpServer = await startSseServer({ port: 3000, host: "0.0.0.0" });
```

## See also

- [`@directive-run/ai/mcp`](../ai) — the MCP **client** side of Directive. Use it inside a Directive AI agent to call out to external MCP servers.
- [`@directive-run/knowledge`](../knowledge) — the knowledge package this server fronts.
- [`@directive-run/claude-plugin`](../claude-plugin) — the Claude Code skill bundles also exposed.
- [`@directive-run/cli`](../cli) — generate static `.cursorrules` / `CLAUDE.md` / `.windsurfrules` files for assistants that don't speak MCP.
- [docs/ide-integration](https://directive.run/docs/ide-integration) — decision tree across every install path.
