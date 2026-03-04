# @directive-run/cli

CLI for [Directive](https://directive.run) — project scaffolding, system introspection, AI coding rules, and more.

## Installation

```bash
# Run directly (no install needed)
npx directive --help

# Or install globally
npm install -g @directive-run/cli
```

The binary is aliased as both `directive` and `dr`.

## Commands

### `directive init`

Interactive project scaffolding wizard. Creates a starter module + system entry file.

```bash
directive init                          # Interactive wizard
directive init --template counter       # Skip prompts, use counter template
directive init --template auth-flow     # Constraints + resolvers starter
directive init --template ai-orchestrator  # AI agent starter
directive init --no-interactive         # Defaults only (counter template)
directive init --dir ./my-project       # Target directory
```

Templates:
- **counter** — Minimal: schema, init, derive, events
- **auth-flow** — Login flow with constraints, resolvers, retry, and effects
- **ai-orchestrator** — Agent module with memory, guardrails, and streaming

### `directive new module <name>`

Generate a typed module file.

```bash
directive new module auth               # Full module (all sections)
directive new module auth --minimal     # Schema + init only
directive new module auth --with derive,constraints,resolvers
directive new module auth --dir ./src/modules
```

### `directive new orchestrator <name>`

Generate an AI orchestrator module with `@directive-run/ai`.

```bash
directive new orchestrator my-agent
directive new orchestrator my-agent --dir ./src
```

### `directive inspect <file>`

Load a Directive system and print structured overview: facts, constraints, resolvers, unmet requirements, inflight status.

```bash
directive inspect src/main.ts           # Pretty-printed table
directive inspect src/main.ts --json    # JSON output
directive inspect src/main.ts --module auth  # Specific module
```

Warns on unresolved requirements (no matching resolver).

### `directive explain <file> [requirement-id]`

Explain why a requirement exists. Wraps `system.explain()` for terminal use.

```bash
directive explain src/main.ts           # List all requirements + status
directive explain src/main.ts req-123   # Detailed explanation for one
```

### `directive graph <file>`

Visual dependency graph: facts → constraints → requirements → resolvers.

```bash
directive graph src/main.ts             # HTML output, opens in browser
directive graph src/main.ts --ascii     # Terminal-only box-drawing output
directive graph src/main.ts --no-open   # Generate HTML but don't open
directive graph src/main.ts --output graph.html
```

### `directive doctor`

Non-interactive health check for project setup.

```bash
directive doctor                        # Check current directory
directive doctor --dir ./my-project     # Check specific directory
```

Checks:
- `@directive-run/core` installed
- Package version compatibility
- TypeScript 5.3+ with `strict: true` and correct `moduleResolution`
- No duplicate Directive instances in `node_modules`
- AI rules freshness (if installed)

Exits non-zero on failures.

### `directive ai-rules init`

Install AI coding rules for your AI coding assistant.

```bash
directive ai-rules init                 # Interactive — detect tools, prompt
directive ai-rules init --tool cursor   # Specific tool
directive ai-rules init --force         # Overwrite existing files
directive ai-rules init --merge         # Update Directive section only
directive ai-rules init --dir ./project
```

### `directive ai-rules update`

Regenerate all existing rule files to the latest knowledge version.

```bash
directive ai-rules update
directive ai-rules update --dir ./project
```

### `directive ai-rules check`

Validate rules are current. Exits non-zero if stale — designed for CI.

```bash
directive ai-rules check
directive ai-rules check --dir ./project
```

### `directive examples list`

Browse available examples from `@directive-run/knowledge`.

```bash
directive examples list                 # All examples, grouped by category
directive examples list --filter ai     # Filter by category or name
```

### `directive examples copy <name>`

Extract an example to your project. Rewrites workspace imports to published package names.

```bash
directive examples copy counter
directive examples copy auth-flow --dest ./src/examples
```

## Supported AI Tools

| Tool | Output File |
|------|-------------|
| Cursor | `.cursorrules` |
| Cline | `.clinerules` |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Windsurf | `windsurf.md` |
| Claude Code | `CLAUDE.md` |
| LLMs.txt | `llms.txt` |

## Programmatic API

```typescript
import { getTemplate, loadSystem, detectTools } from "@directive-run/cli";

// Generate AI rules content
const cursorRules = getTemplate("cursor");

// Load a Directive system from a TS file
const system = await loadSystem("./src/main.ts");
const inspection = system.inspect();

// Detect AI coding tools in a directory
const tools = detectTools("./my-project");
```

## Development

```bash
pnpm --filter @directive-run/cli build
pnpm --filter @directive-run/cli test
pnpm --filter @directive-run/cli typecheck
```
