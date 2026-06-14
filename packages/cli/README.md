# @directive-run/cli

CLI for [Directive](https://directive.run) – project scaffolding, system introspection, **AI coding rules for every assistant**, and more.

## Quick: install AI rules for your assistant

If you found this package looking for "how do I get Directive knowledge into my AI assistant?" – one command:

```bash
npx directive ai-rules init
```

Generates `.cursorrules` / `.clinerules` / `copilot-instructions.md` / `windsurf.md` / OpenAI Codex `AGENTS.md` / Claude Code `CLAUDE.md`, each tuned to that assistant's ingestion budget and conventions. The CLI auto-detects which assistants you have configured. See [IDE Integration](https://directive.run/docs/ide-integration) for the full decision tree.

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
- **counter** – Minimal: schema, init, derive, events
- **auth-flow** – Login flow with constraints, resolvers, retry, and effects
- **ai-orchestrator** – Agent module with memory, guardrails, and streaming

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
directive ai-rules init                 # Interactive – detect tools, prompt
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

Validate rules are current. Exits non-zero if stale – designed for CI.

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

### `directive replay <timeline.json>`

Re-dispatch a serialized [`@directive-run/timeline`](../timeline) JSON dump against a fresh system. Designed for the prod-error-to-local-repro flow: production captures the last N seconds of timeline frames via `serializeTimeline()`, ships the JSON to your bug tracker, and an engineer pastes the path into `replay`.

```bash
directive replay bug-1234.json --system src/app/system.ts
# ✓ replay complete: 47 dispatched / 18 skipped

directive replay bug-1234.json --system src/system.ts --json
# {"dispatched": 47, "skipped": 18, "truncated": 0}

directive replay bug-1234.json --system src/system.ts --max-frames 10000
```

The `--system <path>` file must export a started Directive system as either a default export or a named `system` export. Same shape as `inspect` / `graph` / `explain`.

**Requires `@directive-run/timeline` as a peer dep:** install it with `npm install --save-dev @directive-run/timeline`.

### `directive bisect <timeline.json>`

Binary-search a recorded timeline for the first frame whose inclusion flips a user-supplied assertion from passing to failing – git-bisect, but over `ObservationEvent` frames.

```bash
directive bisect bug-1234.json \
  --system test/bisect-system.ts \
  --assert 'facts.count >= 0'
# ✓ bisect complete: first failing frame is #47 (fact.change)
```

The `--system <path>` file must export a **factory** (not a started instance – bisect calls the factory once per midpoint to keep each replay hermetic). Looks for `createSystem` / `systemFactory` / `default` exports, in that order. The factory must return a started system:

```ts
// test/bisect-system.ts
export function createSystem() {
  const sys = makeSys({ module: counterModule });
  sys.start();
  return sys;
}
```

The `--assert <expression>` is evaluated as JS with `facts` and `system` in scope. Truthy = good prefix; falsy = bad prefix. Bisect locates the smallest bad prefix.

**SECURITY:** `--assert` runs as JavaScript in the CLI process. Only pass expressions from sources you trust. Don't paste expressions from untrusted issues / Slack / third parties.

Options: `--max-frames <n>` (default 100,000), `--no-determinism-check` (skip the replay-twice gate), `--json`, `--verbose`.

Exit codes: `0` (no failure to bisect / fails-on-empty), `2` (bisect found a frame OR refused due to non-determinism), `1` (CLI error).

### `directive timeline diff <a.json> <b.json>`

Semantic causal-graph diff between two serialized timelines. Not a textual JSON diff – per-category deltas (frame counts, constraint fires, mutation kinds, resolver runs, new errors).

```bash
directive timeline diff baseline.json regression.json
# Frames:           23 → 31  (+8)
# Constraint fires:
#   loadOnLoading                    1 →    4  (+3)
# Mutations:
#   submit                           2 →    3  (+1)
# Resolver runs:
#   loader              starts 1→2 (+1)  completes 1→1 ( 0)  errors 0→1 (+1)
# New errors:
#   b-only  frame #15  resolver.error 'loader'  "timeout"

directive timeline diff a.json b.json --json | jq .constraintFires
```

Exit codes: `0` (identical), `2` (differences found, CI-gate friendly), `1` (CLI error).

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

## Composes with

- [`@directive-run/knowledge`](../knowledge) – the source-of-truth knowledge package the CLI reads from. Every rules-file generator pulls from here, so a knowledge update reaches every assistant on the next `ai-rules update`.
- [`@directive-run/claude-plugin`](../claude-plugin) – the Claude Code plugin built from the same knowledge. Use the plugin for Claude Code; use `directive ai-rules init` for everything else.

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for development setup and contribution guidelines.
