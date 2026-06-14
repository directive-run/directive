# `@directive-run/claude-plugin`

Claude Code plugin providing coding guidance for the [Directive](https://directive.run) runtime. Delivers 12 skills that Claude automatically invokes when you're working with Directive code.

The package has two install paths: **Claude Code's plugin marketplace** for end users (the canonical path), and **npm** for tool authors who want to consume the skill bundles programmatically.

## Install for Claude Code (canonical)

Two steps in a Claude Code session – first register the marketplace, then install the plugin:

```
/plugin marketplace add directive-run/directive
/plugin install directive@directive-plugins
```

After install, verify the plugin is active with `/plugins` – you should see `directive` in the list.

## Install for tool authors (npm)

```bash
npm install @directive-run/claude-plugin
```

The npm package ships the pre-built `skills/` directory and exposes it through a small programmatic API. Use this when you're building a custom skill registry, doc-generation pipeline, evals harness, or AI orchestrator that wants to expose Directive skills via its own routing layer.

```typescript
import {
  listSkills,
  getSkill,
  getAllSkills,
  getSkillFile,
  type Skill,
} from "@directive-run/claude-plugin";

// All skill names, alphabetical
const names = listSkills();
// → ["building-ai-agents", "building-ai-orchestrators", ...]

// One skill – manifest + supporting files
const skill = getSkill("building-ai-orchestrators");
skill?.manifest;            // SKILL.md (with YAML frontmatter)
skill?.files.get("examples"); // examples.md contents

// All skills, keyed by name
const all = getAllSkills(); // Map<string, Skill>

// One supporting file
const ex = getSkillFile("building-ai-orchestrators", "examples");
```

The npm install path is not a replacement for the Claude Code plugin install – it does not register the skills with Claude Code itself. It only exposes the same `skills/` directory as a typed module so other tools can read it.

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
