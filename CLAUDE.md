# Directive — AI Contributor Guide

## What is Directive?

A constraint-driven runtime for TypeScript. You declare constraints (what must be true), resolvers handle the rest (how to make it true). Facts change → constraints evaluate → requirements emit → resolvers execute → facts change again.

## Architecture

```
packages/
├── core/       — Engine, facts, constraints, resolvers, derivations, effects, plugins
├── ai/         — AI agent orchestration (single + multi-agent, guardrails, streaming)
├── react/      — React hooks (useFact, useDerived, useEvents, createDirectiveContext)
├── vue/        — Vue composables
├── svelte/     — Svelte stores
├── solid/      — Solid signals
├── lit/        — Lit controllers
├── el/         — Vanilla DOM (el(), JSX, htm)
├── query/      — Data fetching layer
├── devtools/   — Devtools panel (PROPRIETARY — not MIT/Apache-2.0)
├── cli/        — CLI tool (directive init, rules generation)
├── knowledge/  — Knowledge files for AI assistants
└── claude-plugin/ — Claude Code plugin
```

## Key Files

- `packages/core/src/core/engine.ts` — Reconciliation loop (the heart)
- `packages/core/src/core/facts.ts` — Proxy-based reactive store
- `packages/core/src/core/constraints.ts` — Constraint evaluation
- `packages/core/src/core/resolvers.ts` — Resolver execution with retry/batch
- `packages/core/src/core/derivations.ts` — Auto-tracked computed values
- `packages/core/src/core/types/` — All type definitions
- `packages/core/src/core/types/meta.ts` — DefinitionMeta (labels, tags, etc.)

## Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Build all packages
pnpm test -- --run    # Run all tests
pnpm bench            # Run benchmarks
```

## Conventions

- **Resolver params:** `(req, context)` — `req` is short for requirement, never abbreviate `context`
- **Returns:** Always use braces — no single-line `if (x) return y;`
- **Blank line before returns** when there's code above
- **No unnecessary type casting** when reading facts/derivations — the schema provides types
- **Derivation composition param:** `(facts, derived) =>` — `derived` is a value, not a verb
- **endash not emdash** in docs

## Testing

- Vitest for all tests
- 4,100+ tests across the monorepo
- `packages/core/src/core/__tests__/` for core tests
- Run specific: `npx vitest run packages/core/src/core/__tests__/meta.test.ts`

## Important: DefinitionMeta

Every definition type supports optional `meta` for debugging/devtools:
- Constraints, resolvers, effects: `meta: { label, description, category, color, tags }`
- Derivations: `{ compute: (facts) => ..., meta: { ... } }` object form
- Events: `{ handler: (facts) => ..., meta: { ... } }` object form
- Facts: `t.number().meta({ label: "Score", tags: ["pii"] })`
- Modules: `meta: { label: "Auth Module" }` on createModule

Access: `system.meta.constraint("id")`, `system.meta.byTag("pii")`, etc.
All meta is frozen at registration. Zero hot-path cost.
