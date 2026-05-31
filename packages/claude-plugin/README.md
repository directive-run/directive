# Directive Claude Code Plugin

Claude Code plugin providing coding guidance for the [Directive](https://directive.run) runtime. Delivers 12 skills that Claude automatically invokes when you're working with Directive code.

## Installation

Two steps in a Claude Code session — first register the marketplace, then install the plugin:

```
/plugin marketplace add directive-run/directive
/plugin install directive@directive-plugins
```

After install, verify the plugin is active with `/plugins` — you should see `directive` in the list.

## What happens after install

Skills are **model-invoked**: Claude reads each skill's description and automatically loads the relevant skill when your task matches. There is nothing to invoke manually. You write code, Claude pulls in the right skill.

Each of the 12 skills bundles:

- A concise `SKILL.md` with a decision tree and quick-reference patterns
- Supporting knowledge `.md` files copied from [`@directive-run/knowledge`](../knowledge)
- Working code examples extracted from the [`examples/`](../../examples) directory

When Claude invokes a skill, the skill name appears in the response (`/<plugin>:<skill>` namespaced). You can also call a skill directly:

```
/directive:writing-directive-modules
/directive:writing-directive-constraints
/directive:hardening-ai-systems
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

## Not using Claude Code?

The same knowledge ships through [`@directive-run/cli`](../cli) as rules files for every other AI assistant. Run it from your project:

```bash
npx directive ai-rules init
```

Generates `.cursorrules`, `.clinerules`, `copilot-instructions.md`, `windsurf.md`, OpenAI Codex `AGENTS.md`, and `CLAUDE.md` files tuned to each assistant's ingestion conventions.

See [/docs/ide-integration](https://directive.run/docs/ide-integration) for the full decision tree across Claude Code, Cursor, Copilot, Windsurf, Cline, and Codex.
