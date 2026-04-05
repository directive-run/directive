# @directive-run/knowledge

Knowledge files, examples, and validation scripts for the [Directive](https://directive.run) runtime.

This package is the **source of truth** for all Directive coding knowledge used by:
- `@directive-run/cli` – generates AI rules files (`.cursorrules`, `CLAUDE.md`, etc.)
- `@directive-run/claude-plugin` – builds Claude Code plugin skills
- `directive.run/llms.txt` – website LLM reference

## Contents

| Directory | Count | Description |
|-----------|-------|-------------|
| `core/` | 13 | Core Directive knowledge (modules, constraints, resolvers, etc.) |
| `ai/` | 12 | AI orchestrator knowledge (agents, streaming, guardrails, etc.) |
| `examples/` | 37 | Extracted examples (auto-generated, DOM wiring stripped) |
| `api-skeleton.md` | 1 | Auto-generated API reference skeleton |
| `sitemap.md` | 1 | Auto-generated docs site sitemap (125+ pages) |

## Programmatic API

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

## Scripts

```bash
pnpm --filter @directive-run/knowledge generate          # Regenerate api-skeleton.md
pnpm --filter @directive-run/knowledge extract-examples  # Re-extract examples
pnpm --filter @directive-run/knowledge validate          # Validate symbol references
pnpm --filter @directive-run/knowledge test              # Run all tests
pnpm --filter @directive-run/knowledge build             # Full build (generate + extract + tsup)
```

## Adding Examples

Examples are **auto-discovered** from `examples/*/` in the repo root. The `extract-examples.ts` script:
1. Scans all example directories
2. Finds the best source file (prefers `<name>.ts` > `module.ts` > `main.ts`)
3. Strips DOM wiring code
4. Outputs clean TypeScript

To exclude an example, add it to `EXCLUDED_EXAMPLES` in `scripts/extract-examples.ts`.
