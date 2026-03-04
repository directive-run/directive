# Directive Claude Code Plugin

Claude Code plugin providing coding guidance for the [Directive](https://directive.run) runtime. Delivers 12 skills that Claude automatically invokes when you're working with Directive code.

## Installation

```
/plugin install directive@directive-plugins
```

## Skills

| Skill | Description |
|-------|-------------|
| `getting-started-with-directive` | Understand Directive fundamentals and mental model |
| `writing-directive-modules` | Write modules with correct schema, type builders, naming |
| `writing-directive-constraints` | Write constraints and resolvers with error boundaries |
| `building-directive-systems` | Build multi-module systems with plugins and React |
| `testing-directive-code` | Test with createTestSystem, mockResolver, time-travel |
| `building-ai-orchestrators` | Build single and multi-agent AI orchestrators |
| `building-ai-agents` | Create agents with streaming, adapters, communication |
| `hardening-ai-systems` | Add guardrails, budgets, security to AI systems |
| `testing-ai-systems` | Test AI systems with mock runners and evaluations |
| `reviewing-directive-code` | Review code for anti-patterns and naming violations |
| `scaffolding-directive-modules` | Generate module scaffolds with matching test files |
| `migrating-to-directive` | Migrate from Redux, Zustand, XState, MobX to Directive |

## How It Works

Skills are model-invoked: Claude reads the skill descriptions and automatically loads the relevant skill when your task matches. Each skill includes:
- A concise `SKILL.md` with decision trees and quick-reference patterns
- Supporting knowledge `.md` files with full details
- Relevant code examples

## Development

```bash
# Build skills from knowledge package
pnpm --filter @directive-run/claude-plugin build

# Run tests
pnpm --filter @directive-run/claude-plugin test

# Test locally with Claude Code
claude --plugin-dir packages/claude-plugin
```

Skills are built from `@directive-run/knowledge` + hand-authored templates in `templates/`. The build script (`scripts/build-skills.ts`) assembles the `skills/` directories.

## Alternative: CLI

If you don't use Claude Code, use the CLI instead:

```bash
npx directive ai-rules init
```

This generates `.cursorrules`, `.clinerules`, `copilot-instructions.md`, `windsurf.md`, or `CLAUDE.md` files.
