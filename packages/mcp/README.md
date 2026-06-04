# `@directive-run/mcp`

Run a Model Context Protocol (MCP) server that lets AI assistants — Claude Desktop, Cursor, Windsurf, or any MCP client — query Directive's knowledge base, code examples, lint rules, and scaffolding tools live. No pre-bundling, no stale snapshots: the assistant asks, the server answers from the current package contents.

Most readers want this package. Install it if you use Claude Desktop, Cursor, or another MCP-speaking client — or if you're hosting Directive's knowledge as a service for your team's agents.

> **Which side are you on?** This package is the **server**: it exposes Directive's knowledge so AI clients can read it. If instead you're building a Directive AI agent that needs to *call* external MCP servers (filesystem, GitHub, Slack), use [`@directive-run/ai/mcp`](../ai) and its `createMCPAdapter`.

## Install

The fastest path is zero-install via `npx`. Claude Desktop, Cursor, and other MCP clients will spawn it for you when their config block points here:

```bash
npx -y @directive-run/mcp --help
```

For environments that pin binaries, install globally instead:

```bash
npm install -g @directive-run/mcp
directive-mcp --help
```

## Try it (3 steps)

```jsonc
// 1. Paste into your AI client's MCP config and restart it.
//    Claude Desktop:  ~/Library/Application Support/Claude/claude_desktop_config.json
//    Cursor:          .cursor/mcp.json
{
  "mcpServers": {
    "directive": {
      "command": "npx",
      "args": ["-y", "@directive-run/mcp"]
    }
  }
}
```

```text
2. Verify the server is loaded.
   Claude Desktop:  click the tools/hammer icon — you should see `directive`
                    with 20 tools. Or ask Claude:
                    "Use the directive MCP server's get_server_info tool."
   Cursor:          open Settings → MCP → look for `directive` (status: connected).
   MCP Inspector:   npx @modelcontextprotocol/inspector npx -y @directive-run/mcp
                    → connect → /tools should list 20 entries.
```

```text
3. Send your first prompt. Any of these will fire a tool round-trip:

   • "Using the directive MCP server, list the knowledge files,
      then read the one about constraints."
   • "Generate a Directive module named 'cart' with constraints + resolvers
      using the directive MCP server."
   • "Review this code with directive's review_source tool, then call
      fix_code on any fixable findings:
      createModule('Cart', { schema: {} });"
```

## How it works

Every Directive MCP request follows the same shape: an AI client (Claude Desktop, Cursor, your own agent) speaks JSON-RPC to one of two transports — `stdio` for local subprocess clients, `SSE` for the hosted gateway. The server dispatches to a tool handler, which reads from one of three in-process data sources: the bundled `@directive-run/knowledge` package (markdown + extracted examples), the lazy-loaded `@directive-run/lint` registry (ts-morph rules, loaded on first call so the ~25 MB ts-morph cost only hits when `review_source` or `fix_code` actually runs), or the pure-string `@directive-run/scaffold` generators. Nothing touches disk; nothing calls out over the network — except `get_package_info`, which fetches `latest` from npm with a 1-hour cache.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  Claude Desktop / Cursor / Windsurf / MCP Inspector                            │
│                                                                                │
│  Reads ~/Library/Application Support/Claude/claude_desktop_config.json on      │
│  launch. For each mcpServers entry, spawns the subprocess and pipes JSON-RPC   │
│  over its stdin/stdout.                                                        │
└────────────────────────────┬───────────────────────────────────────────────────┘
                             │ stdio (or SSE for hosted)
                             ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│  @directive-run/mcp@0.2.x  (`npx -y @directive-run/mcp` subprocess)            │
│                                                                                │
│  src/cli.ts:                                                                   │
│    parseArgs() → { sse: false (default) }                                      │
│    setServerInfo({ transport: "stdio", authEnabled: false })                   │
│    createDirectiveServer() → McpServer with 20 tools registered                │
│                                                                                │
│  Tool surface (20):                                                            │
│    Knowledge:   list_knowledge, get_knowledge, search_knowledge,               │
│                 list_examples, get_example, search_examples                    │
│    Packages:    list_packages, get_package_info, get_composable_packages       │
│    Generate:    generate_module, list_module_sections                          │
│    Review:      list_review_rules, get_review_rule, review_source, fix_code    │
│    Migration:   list_migration_sources, get_migration_pattern                  │
│    Skills:      list_skills, get_skill                                         │
│    Server:      get_server_info                                                │
└──────┬─────────────────┬──────────────────┬──────────────────┬─────────────────┘
       │                 │                  │                  │
       ▼                 ▼                  ▼                  ▼
  ┌──────────┐    ┌────────────┐    ┌──────────┐       ┌───────────────────┐
  │knowledge │    │claude-plug-│    │ scaffold │       │      lint         │
  │          │    │   in       │    │          │       │  (lazy-loaded     │
  │ • core/* │    │ • skills/* │    │ pure     │       │   via separate    │
  │ • ai/*   │    │  bundled   │    │ functions│       │   tsup entry)     │
  │ • compo- │    │  from      │    │ in /     │       │                   │
  │   sitions│    │  knowledge │    │ strings  │       │ • 10 ts-morph     │
  │   .json  │    │  at build  │    │ out      │       │   rules           │
  │ • migra- │    │            │    │          │       │ • 6 fixable       │
  │   tion.  │    │            │    │ Zero     │       │ • Worker_threads  │
  │   json   │    │            │    │ runtime  │       │   ON by default   │
  │ • Lazy + │    │            │    │ deps     │       │ • 5-second        │
  │   cached │    │            │    │          │       │   parse budget    │
  │   parsers│    │            │    │          │       └──────┬────────────┘
  └──────────┘    └────────────┘    └──────────┘              │
                                                              ▼
                                                  ┌────────────────────────┐
                                                  │  ts-morph (lazy)       │
                                                  │  TypeScript compiler   │
                                                  │  API wrapper. Spins up │
                                                  │  in-memory Project,    │
                                                  │  parses src → AST.     │
                                                  │  Each rule walks the   │
                                                  │  AST via               │
                                                  │  getDescendantsOfKind  │
                                                  └────────────────────────┘
```

**Caching & limits.** First call to `list_knowledge` warms the knowledge cache (~700 KB markdown). First call to `review_source` spins up a worker thread + the ts-morph project, then keeps both for the process lifetime. Built-in caps: 200 KB max source for `review_source`/`fix_code`, 5-second parse budget, 1 MB body cap on SSE, 64 concurrent SSE sessions, 5-minute idle pruning. See `get_server_info` for the live counts.

For the request-flow trace in code, see `src/server.ts` (tool registration) and `src/lint-runner.ts` (worker dispatch).

## stdio transport (local clients)

Add to your AI client's MCP config (Claude Desktop's `claude_desktop_config.json`, Cursor's `.cursor/mcp.json`, etc.) and restart it:

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

Or run the MCP Inspector for a browser-based UI:

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

**Security defaults.** A public bind (`--host 0.0.0.0`) without `--token` exits with `error: --token is required when binding to a non-loopback host`. With a token set, every `/sse` and `/messages` request must send `Authorization: Bearer <token>`. Defaults: 1 MB body cap, 64 concurrent sessions, 5-minute idle timeout. Token can also come from the `DIRECTIVE_MCP_TOKEN` environment variable.

Endpoints:

- `GET /sse` — establish the SSE stream.
- `POST /messages?sessionId=…` — client→server JSON-RPC messages.
- `GET /healthz` — liveness probe.

## Tools (21)

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
| `get_package_info` | Single-package detail (baked metadata + live npm version, 1 h cache, 3 s timeout, falls back to baked on failure). |
| `get_composable_packages` | Outgoing and incoming composition edges for one package. Returns `isError: true` with `NOT_FOUND` prefix when the package isn't known. |

### Generate

| Tool | Purpose |
|---|---|
| `generate_module` | Generate NEW Directive module or AI orchestrator source. Returns the source string + suggested filenames + required-packages list; the caller writes to disk via its own file tool. |
| `list_module_sections` | Enumerate the valid `sections` values for `generate_module` (autodiscovery — no hallucinated enum values). |

### Review

| Tool | Purpose |
|---|---|
| `list_review_rules` | All 10 ts-morph rules as structured data (id, severity, category, title). |
| `get_review_rule` | One rule's full detail: WRONG/CORRECT example pair + explanation. |
| `review_source` | Run the rule registry against a TypeScript source string. Pre-parse 200 KB cap, 5-second budget enforced via `worker.terminate()`. Returns structured findings. |
| `fix_code` | Apply a rule's mechanical fix; returns diff + fixed source. 6 of 10 rules ship a fix; the rest return `{ ok: false, reason }`. |

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
| `get_server_info` | Version + transport + auth state + bundled-knowledge hash + session count + package-registry timestamp. |

### Playground

| Tool | Purpose |
|---|---|
| `playground_link` | Turn any TypeScript snippet (≤ 8 KB) into a `directive.run/playground` URL. The page decompresses the source from the URL hash, shows it with syntax highlighting, and offers a one-click **Open in StackBlitz** button that boots a real running Directive project with the snippet as `src/main.ts`. Pair it with any tool that returns code — `generate_module`, `get_example`, `fix_code` — to give the user a "try it now" link in chat. |

## Troubleshooting

The four most common first-time failures:

| Symptom | What's happening | Fix |
|---|---|---|
| Claude Desktop shows no `directive` server in the hammer/tools menu. | Config file wasn't read, or `npx` failed to install. | Fully quit Claude Desktop (Cmd-Q, not just close the window) and relaunch. Then check the log: `~/Library/Logs/Claude/mcp-server-directive.log` (macOS), `%APPDATA%\Claude\logs\mcp-server-directive.log` (Windows). |
| `review_source` returns `review_source failed — worker-error: ts-morph is not installed`. | npm install ran with `--no-optional`, or your package manager skipped `optionalDependencies`. | `npm install -g ts-morph` once. ts-morph (~25 MB) is loaded only when `review_source` / `fix_code` fires. |
| `--sse --host 0.0.0.0` exits with `--token is required`. | Public bind needs auth. | Pass `--token <secret>` or set `DIRECTIVE_MCP_TOKEN` in the environment. Loopback binds (the default `127.0.0.1`) don't need a token. |
| `npx -y @directive-run/mcp` is slow on first launch. | `npx` is downloading + installing the package + ts-morph (~25 MB). | First launch is ~10-20 s on a cold npm cache. Subsequent launches use the cached tarball. To pre-warm: `npm install -g @directive-run/mcp` and use `"command": "directive-mcp"` in the config. |

If a tool errors mid-conversation, the fastest recovery is: *"Ask the directive MCP server's `get_server_info` tool to verify connectivity."*

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

- [`@directive-run/ai/mcp`](../ai) — adapts external MCP servers as Directive resolvers (the *client* side; opposite arrow from this package).
- [`@directive-run/knowledge`](../knowledge) — markdown + JSON sources this server fronts.
- [`@directive-run/lint`](../lint) — the ts-morph rule registry behind `review_source` and `fix_code`.
- [`@directive-run/scaffold`](../scaffold) — the pure-function generators behind `generate_module`.
- [`@directive-run/claude-plugin`](../claude-plugin) — the Claude Code skill bundles also exposed via `get_skill`.
- [`@directive-run/cli`](../cli) — generates static `.cursorrules` / `CLAUDE.md` / `.windsurfrules` files for assistants that don't speak MCP.
- [directive.run/docs/ide-integration](https://directive.run/docs/ide-integration) — the cross-editor decision tree.
