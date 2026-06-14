# @directive-run/knowledge

The **source of truth** for all Directive coding knowledge – used by Claude Code skills, Cursor / Copilot / Windsurf / Cline / Codex rules files, the website's `/llms.txt` route, and the programmatic API for downstream tooling.

If you want your AI assistant to write idiomatic Directive code, you do not install this package directly – you install one of its consumers below.

## Using the knowledge

### Claude Code

Two commands in a Claude Code session:

```
/plugin marketplace add directive-run/directive
/plugin install directive@directive-plugins
```

Ships 12 skills bundled from this package. Skills are model-invoked – Claude reads each skill's description and auto-loads the relevant one when your task matches.

### Cursor, Copilot, Windsurf, Cline, OpenAI Codex

Run [`@directive-run/cli`](../cli) from your project root:

```bash
npx directive ai-rules init
```

Generates `.cursorrules` / `.clinerules` / `copilot-instructions.md` / `windsurf.md` / `AGENTS.md` / `CLAUDE.md` tuned to each assistant's ingestion convention.

### LLM agents crawling docs at runtime

Point your agent at `https://directive.run/llms.txt`. The route bundles a comparison framing + the full sitemap so an agent doing one-shot retrieval gets a coherent picture.

### Full decision tree

See [`/docs/ide-integration`](https://directive.run/docs/ide-integration) for the full path-per-editor decision tree and verification commands.

## Programmatic API

For tool builders who consume Directive knowledge in their own code (custom AI integrations, doc renderers, etc.):

```typescript
import {
  getKnowledge,
  getAllKnowledge,
  getExample,
  getAllExamples,
  getKnowledgeFiles,
  getExampleFiles,
  clearCache,
} from "@directive-run/knowledge";

// Get a single knowledge file
const patterns = getKnowledge("core-patterns");

// Get multiple files joined with --- separator
const combined = getKnowledgeFiles(["constraints", "resolvers"]);

// Get all examples as a Map<name, content>
const examples = getAllExamples();

// Clear cached knowledge and examples (useful for dev/watch mode)
clearCache();
```

If you're just trying to write code with AI help, you don't need this – install the Claude plugin or run `directive ai-rules` above.

## What's in the package

| Directory | Count | Description |
|-----------|-------|-------------|
| `core/` | 13 | Core Directive knowledge (modules, constraints, resolvers, etc.) |
| `ai/` | 12 | AI orchestrator knowledge (agents, streaming, guardrails, etc.) |
| `examples/` | 37 | Extracted examples (auto-generated, DOM wiring stripped) |
| `api-skeleton.md` | 1 | Auto-generated API reference skeleton |
| `sitemap.md` | 1 | Auto-generated docs site sitemap (125+ pages) |

## Contributing

### Scripts

```bash
pnpm --filter @directive-run/knowledge generate          # Regenerate api-skeleton.md
pnpm --filter @directive-run/knowledge extract-examples  # Re-extract examples
pnpm --filter @directive-run/knowledge validate          # Validate symbol references
pnpm --filter @directive-run/knowledge test              # Run all tests
pnpm --filter @directive-run/knowledge build             # Full build (generate + extract + tsup)
```

### Adding examples

Examples are **auto-discovered** from `examples/*/` in the repo root. The `extract-examples.ts` script:

1. Scans all example directories
2. Finds the best source file (prefers `<name>.ts` > `module.ts` > `main.ts`)
3. Strips DOM wiring code
4. Outputs clean TypeScript

To exclude an example, add it to `EXCLUDED_EXAMPLES` in `scripts/extract-examples.ts`.
