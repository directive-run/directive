# Contributing to Directive

Everything you need to know about how the monorepo fits together &ndash; from local setup through production deployment.

---

## Architecture Overview

```
directive/
├── .changeset/              # Changesets config (versioning + npm publishing)
├── .claude/                 # Claude Code skills + project context
│   └── commands/            # 9 skills (/release, /changeset, /deploy, etc.)
├── .github/workflows/
│   ├── ci.yml               # PR quality gate
│   └── release.yml          # npm publish on merge to main
├── e2e/                     # Playwright end-to-end tests
│   └── fixtures/            # Framework-specific test apps (React, Vue, etc.)
├── packages/
│   ├── core/                # @directive-run/core  (runtime engine)
│   ├── ai/                  # @directive-run/ai    (AI orchestration)
│   ├── react/               # @directive-run/react
│   ├── vue/                 # @directive-run/vue
│   ├── svelte/              # @directive-run/svelte
│   ├── solid/               # @directive-run/solid
│   ├── lit/                 # @directive-run/lit
│   └── vite-plugin-api-proxy/
├── website/                 # Next.js 15 docs site (directive.run)
│   ├── scripts/
│   │   ├── extract-api-docs.ts    # ts-morph → JSON/MD from JSDoc
│   │   └── generate-embeddings.ts # OpenAI embeddings for chatbot
│   └── docs/generated/      # Build artifacts (gitignored)
└── docs/                    # Internal planning docs
```

### Package Dependency Graph

```
@directive-run/core ─────────────────────────────┐
   │                                              │
   ├── @directive-run/react   (peer: core)        │
   ├── @directive-run/vue     (peer: core)        │
   ├── @directive-run/svelte  (peer: core)        │
   ├── @directive-run/solid   (peer: core)        │
   └── @directive-run/lit     (peer: core)        │
                                                  │
@directive-run/ai ────────────────────────────────┘
   (peer: core)
```

### Tech Stack

| Tool | Version | Purpose |
|------|---------|---------|
| pnpm | 9.15+ | Package manager (workspaces) |
| TypeScript | 5.7+ | Language |
| tsup | &ndash; | Build: ESM + CJS + `.d.ts` + sourcemaps, target ES2022 |
| Vitest | 2.1+ | Unit + integration tests |
| Biome | 1.9+ | Lint + format (single tool) |
| Changesets | 2.29+ | Versioning + npm publishing |
| Playwright | 1.49+ | End-to-end framework tests |
| Next.js | 15 | Documentation website |
| Vercel | &ndash; | Website hosting (auto-deploy on push to main) |

---

## Package System

### Release Groups

Changesets uses **fixed groups** so packages in the same group always share the same version number:

| Group | Packages | Current Version |
|-------|----------|-----------------|
| Core + Frameworks | `core`, `react`, `vue`, `svelte`, `solid`, `lit` | 0.1.0 |
| AI | `ai` | 0.1.0 (independent) |

`vite-plugin-api-proxy` is excluded from changesets.

### Subpath Exports

Packages expose multiple entry points via `exports` in `package.json`:

```
@directive-run/core          # Main runtime
@directive-run/core/plugins  # Built-in plugins (logging, devtools, persistence)
@directive-run/core/testing  # Test utilities (mock resolvers, assertion helpers)
@directive-run/core/migration # Codemods (Redux/Zustand/XState → Directive)

@directive-run/ai            # AI agent orchestration
@directive-run/ai/openai     # OpenAI adapter
@directive-run/ai/anthropic  # Anthropic adapter
@directive-run/ai/ollama     # Ollama adapter
@directive-run/ai/testing    # AI test utilities
```

### Build Output

Each package builds with tsup:
- **ESM** (`.js`) + **CJS** (`.cjs`) dual format
- **TypeScript declarations** (`.d.ts`)
- **Sourcemaps** enabled
- **Target:** ES2022
- **Tree-shakeable** (`sideEffects: false`)

Dependencies use `workspace:*` locally. When published, pnpm replaces these with the actual version numbers.

---

## Development Setup

### Prerequisites

- **Node.js 22+** (CI uses 22; engine requirement is >=18)
- **pnpm** (corepack or standalone install)

### Getting Started

```bash
git clone https://github.com/directive-run/directive.git
cd directive
pnpm install
pnpm -r build          # Build all packages (required before tests)
pnpm test              # Run all tests
```

### Environment Variables

| Variable | Required | Where | Purpose |
|----------|----------|-------|---------|
| `OPENAI_API_KEY` | Website build (embeddings) | Vercel env, local `.env` | Generates doc embeddings for AI chatbot |
| `ANTHROPIC_API_KEY` | AI adapter tests | Local `.env` | Running Anthropic adapter tests |
| `NPM_TOKEN` | Release workflow | GitHub secret | npm publishing (pre-configured) |
| `GITHUB_TOKEN` | Release workflow | GitHub secret (auto) | Changesets PR creation (auto-provided) |

### Common Commands

```bash
pnpm install              # Install all dependencies
pnpm -r build             # Build all packages
pnpm test                 # Run tests (Vitest, watch mode)
pnpm test -- --run        # Run tests once (no watch)
pnpm lint                 # Lint + format check (Biome)
pnpm lint:fix             # Auto-fix lint + format issues
pnpm typecheck            # TypeScript type checking (all packages)
pnpm dev                  # Watch mode (all packages)
pnpm clean                # Remove all dist/ and node_modules/
```

### Per-Package Commands

```bash
pnpm --filter @directive-run/core build
pnpm --filter @directive-run/core test
pnpm --filter website dev          # Start docs site at localhost:3000
pnpm --filter website build        # Full website build (API docs → embeddings → Next.js)
```

---

## Build Pipeline

### Package Builds

`pnpm -r build` runs tsup in each package. Build order follows the dependency graph automatically &ndash; core builds first, then framework adapters and AI.

### Website Build Chain

The website build runs three steps in sequence:

```
extract-api-docs.ts ──→ generate-embeddings.ts ──→ next build
      │                         │                       │
      ▼                         ▼                       ▼
  docs/generated/          public/                  .next/
  ├── api-reference.json   └── embeddings.json      (production build)
  └── api-reference.md
```

**Step 1: API Docs** (`tsx scripts/extract-api-docs.ts`)
- Uses ts-morph to parse JSDoc from `packages/core/src/` and `packages/ai/src/`
- Extracts function signatures, parameters, return types, examples
- Outputs JSON (for embeddings) + Markdown (for human reference)
- Reads source files directly &ndash; packages don't need to be built first

**Step 2: Embeddings** (`tsx scripts/generate-embeddings.ts`)
- Chunks Markdoc doc pages by paragraph
- Chunks API reference entries by symbol
- Deduplicates overlapping content
- Embeds all chunks via OpenAI `text-embedding-3-small` (1536 dimensions)
- Writes `public/embeddings.json` for the AI chatbot
- Gracefully skips if `OPENAI_API_KEY` is missing (logs warning, doesn't fail)

**Step 3: Next.js Build** (`next build`)
- Compiles the docs site with all generated content available

### LLMs.txt

The website exposes dynamic API routes that serve documentation content formatted for AI context windows. These are generated at request time from the doc pages.

---

## CI/CD Pipeline

Three parallel processes trigger on different events:

```
┌─────────────────────────────────────────────────────────────┐
│                     Push / PR to main                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  PR opened/updated          Merge to main     Merge to main│
│       │                          │                  │       │
│       ▼                          ▼                  ▼       │
│   ci.yml                    release.yml         Vercel      │
│   ┌──────────┐              ┌──────────┐      ┌──────────┐ │
│   │ build    │              │ build    │      │ API docs │ │
│   │ test     │              │ typecheck│      │ embeds   │ │
│   │ lint     │              │ test     │      │ next     │ │
│   │ typecheck│              │ publish  │      │ build    │ │
│   └──────────┘              └──────────┘      └──────────┘ │
│   Quality gate              npm release       Website deploy│
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### PR to main &ndash; `ci.yml`

Runs on every pull request. **All checks must pass** before merge.

1. Checkout + pnpm setup (Node 22)
2. `pnpm install`
3. `pnpm -r build` &ndash; build all packages
4. `pnpm test -- --run` &ndash; run all tests
5. `pnpm lint` &ndash; Biome lint + format
6. `pnpm typecheck` &ndash; TypeScript across all packages

### Merge to main &ndash; `release.yml`

Runs on push to main. Handles npm publishing via Changesets.

1. Checkout + pnpm setup (Node 22)
2. `pnpm install`
3. `pnpm -r build`
4. `pnpm typecheck`
5. `pnpm test -- --run`
6. **Changesets action:**
   - If pending changesets exist → creates/updates a "Version Packages" PR
   - If no pending changesets (version PR was just merged) → publishes to npm with provenance

### Merge to main &ndash; Vercel

Vercel auto-deploys the website on every push to main:

1. Detects `pnpm-workspace.yaml` → builds workspace dependencies first
2. Runs `pnpm --filter website build` (the full chain: API docs → embeddings → Next.js)
3. Deploys to production at directive.run

---

## Release Process

### Step-by-Step

**1. Create a changeset**

```bash
pnpm changeset
```

Or use the `/changeset` skill in Claude Code. Select the affected packages and describe the change.

**2. Open a PR and merge**

The changeset file (`.changeset/*.md`) is committed with your code changes. CI runs on the PR. Merge when green.

**3. Version Packages PR**

After merge, `release.yml` runs the Changesets action. It detects pending changesets and creates a "Version Packages" PR that:
- Bumps versions in all affected `package.json` files
- Updates `CHANGELOG.md` in each package
- Removes the consumed `.changeset/*.md` files

**4. Merge the Version PR**

Merging this PR triggers `release.yml` again. This time there are no pending changesets, so the Changesets action **publishes to npm** with provenance signing.

### Version Groups

All packages in a fixed group get the same version bump:

- Bumping `core` also bumps `react`, `vue`, `svelte`, `solid`, `lit`
- `ai` versions independently

### Post-Release

After npm publish, Vercel auto-redeploys the website. The new API docs are regenerated from the updated source.

---

## Website Deployment

### Automatic (Vercel)

Every push to main triggers a Vercel deployment. The build command runs the full pipeline (API docs → embeddings → Next.js build).

**Requirements:**
- `OPENAI_API_KEY` set in Vercel project environment variables (production + preview)
- Without it, embeddings are skipped (chatbot search won't work, but site still builds)

### Manual Deploy

Use the `/deploy` skill in Claude Code for ad-hoc production pushes.

### When to Regenerate Embeddings

Embeddings are regenerated on every Vercel deploy. They should be regenerated when:
- Documentation content changes (new pages, updated guides)
- API signatures change (JSDoc updates, new exports)
- New blog posts are added

Since Vercel rebuilds on every push to main, this happens automatically.

---

## Skills Reference

Claude Code skills available via `/command`:

| Skill | Description |
|-------|-------------|
| `/release` | Full release orchestration &ndash; version, build, test, publish to npm |
| `/changeset` | Create a changeset for unreleased changes |
| `/validate` | Pre-push validation &ndash; lint, typecheck, test, build |
| `/typecheck` | TypeScript type checking across all packages |
| `/audit` | Security and code quality audit (deps, secrets, licenses) |
| `/status` | Project health dashboard &ndash; versions, tests, build, bundle sizes |
| `/deploy` | Build and deploy the website to production |
| `/blog` | Scaffold a new blog post with frontmatter and structure |
| `/new-package` | Scaffold a new `@directive-run/*` package in the monorepo |

### Common Workflows

**"I changed source code in a package"**
```bash
pnpm test               # Verify tests pass
pnpm lint                # Check formatting
pnpm typecheck           # Check types
# or all at once: /validate
```

**"I changed documentation"**
```bash
pnpm --filter website dev              # Preview locally at localhost:3000
pnpm --filter website build:api-docs   # Regenerate API docs (if JSDoc changed)
pnpm --filter website build:embeddings # Regenerate embeddings (needs OPENAI_API_KEY)
```

**"I'm ready to release"**
```bash
pnpm changeset           # Create changeset describing changes
git add . && git commit   # Commit changeset with your changes
# Push, open PR, merge → Changesets handles the rest
```

**"I need to deploy the website now"**
```bash
# Use /deploy skill, or push to main (Vercel auto-deploys)
```

---

## Code Style

- **Linter/Formatter:** Biome (replaces ESLint + Prettier)
- **Run:** `pnpm lint` to check, `pnpm lint:fix` to auto-fix
- All code must pass lint + typecheck before merge (enforced by CI)

---

## Testing

- **Framework:** Vitest
- **Run all:** `pnpm test` (watch mode) or `pnpm test -- --run` (single run)
- **Run one package:** `pnpm --filter @directive-run/core test`
- **E2E:** `pnpm test:e2e` (Playwright, tests framework integrations)

---

## Project Links

- **npm:** [@directive-run](https://www.npmjs.com/org/directive-run)
- **GitHub:** [directive-run/directive](https://github.com/directive-run/directive)
- **Docs:** [directive.run](https://directive.run)
