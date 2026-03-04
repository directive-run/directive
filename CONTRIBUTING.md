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
   │                                             │
   ├── @directive-run/react   (peer: core)       │
   ├── @directive-run/vue     (peer: core)       │
   ├── @directive-run/svelte  (peer: core)       │
   ├── @directive-run/solid   (peer: core)       │
   └── @directive-run/lit     (peer: core)       │
                                            m    │
@directive-run/ai ───────────────────────────────┘
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
| Core + Frameworks | `core`, `react`, `vue`, `svelte`, `solid`, `lit` | 0.2.0 |
| AI | `ai` | 0.2.0 (independent) |

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

### Docs Pipeline

The full docs pipeline runs 6 steps across 3 packages, feeding outputs forward:

```
  TS Source Files                    Knowledge Files
  (core/src, ai/src)                 (core/*.md, ai/*.md)
        │                                  │
        ▼                                  │
  ┌──────────────────┐                     │
  │ extract-api-docs │ website/scripts     │
  │ (ts-morph)       │                     │
  └────────┬─────────┘                     │
           │                               │
           ▼                               │
  docs/generated/                          │
  ├── api-reference.json ──┐               │
  └── api-reference.md     │               │
                           │               │
           ┌───────────────┘               │
           ▼                               │
  ┌─────────────────────┐                  │
  │ generate-api-skeleton│ knowledge/      │
  └────────┬────────────┘  scripts         │
           │                               │
           ▼                               │
  knowledge/api-skeleton.md                │
           │                               │
           ├───────────────────────────────┐│
           ▼                               ▼│
  ┌──────────────────┐            ┌────────────────┐
  │ extract-examples │            │validate-knowledge│
  └────────┬─────────┘            └────────────────┘
           │                               │
           ▼                               │
  knowledge/examples/*.ts                  │
           │                               │
           ├───────────────────────────────┘
           ▼
  ┌──────────────────┐
  │ build-skills     │ claude-plugin/scripts
  └────────┬─────────┘
           │
           ▼
  claude-plugin/skills/
  (12 skill directories)
           │
           ▼
  ┌─────────────────────┐
  │ generate-embeddings  │ website/scripts
  │ (OpenAI API)         │
  └────────┬─────────────┘
           │
           ▼
  public/embeddings.json
```

### One-Command Pipeline

```bash
pnpm build:docs-pipeline
```

Runs all 6 steps in sequence: package builds &rarr; extract API docs &rarr; knowledge build (skeleton + examples) &rarr; build skills &rarr; generate embeddings.

### Individual Steps

| Step | Command | Reads | Writes |
|------|---------|-------|--------|
| 1. Extract API Docs | `pnpm --filter directive-website build:api-docs` | `packages/{core,ai}/src/**/*.ts` | `docs/generated/api-reference.{json,md}` |
| 2. Generate API Skeleton | `pnpm --filter @directive-run/knowledge generate` | `docs/generated/api-reference.json` | `packages/knowledge/api-skeleton.md` |
| 3. Extract Examples | `pnpm --filter @directive-run/knowledge extract-examples` | `examples/*/src/*.ts` | `packages/knowledge/examples/*.ts` |
| 4. Validate Knowledge | `pnpm --filter @directive-run/knowledge validate` | `api-skeleton.md`, `{core,ai}/*.md` | (validation only) |
| 5. Build Skills | `pnpm --filter @directive-run/claude-plugin build` | `knowledge/{core,ai,examples}/*` | `claude-plugin/skills/` |
| 6. Generate Embeddings | `pnpm --filter directive-website build:embeddings` | docs, api-reference.json, knowledge | `public/embeddings.json` |

### Generated Files

These files are gitignored and must be rebuilt:

| File | Rebuilt By | When to Rebuild |
|------|-----------|-----------------|
| `docs/generated/api-reference.json` | Step 1 | JSDoc or exports change in core/ai |
| `docs/generated/api-reference.md` | Step 1 | Same as above |
| `packages/knowledge/api-skeleton.md` | Step 2 | After step 1, or manually |
| `packages/knowledge/examples/*.ts` | Step 3 | Example source files change |
| `claude-plugin/skills/*` | Step 5 | Knowledge files or templates change |
| `public/embeddings.json` | Step 6 | Any content change (docs, API, knowledge) |

### When to Run What

| What Changed | Run |
|--------------|-----|
| TypeScript source (JSDoc, exports) | Full pipeline: `pnpm build:docs-pipeline` |
| Knowledge files (`core/*.md`, `ai/*.md`) | Steps 4-6: validate &rarr; build-skills &rarr; embeddings |
| Example source files | Steps 3-6: extract-examples &rarr; build-skills &rarr; embeddings |
| Skill templates | Step 5: `pnpm --filter @directive-run/claude-plugin build` |
| Doc pages (Markdoc) | Step 6: `pnpm --filter directive-website build:embeddings` |
| Everything / not sure | `pnpm build:docs-pipeline` |

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
│  PR opened/updated          Merge to main     Merge to main │
│       │                          │                  │       │
│       ▼                          ▼                  ▼       │
│   ci.yml                    release.yml         Vercel      │
│   ┌──────────┐              ┌──────────┐      ┌──────────┐  │
│   │ test     │              │ typecheck│      │ embeds   │  │
│   │ lint     │              │ test     │      │ next     │  │
│   │ typecheck│              │ publish  │      │ build    │  │
│   └──────────┘              └──────────┘      └──────────┘  │
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

Runs on push to main when `packages/`, `.changeset/`, `release.yml`, or `pnpm-lock.yaml` change. Skips website-only and docs-only pushes.

1. Checkout + pnpm setup (Node 22)
2. `pnpm install`
3. `pnpm -r build`
4. `pnpm typecheck`
5. `pnpm test -- --run`
6. **Changesets action:**
   - If pending changesets exist → creates/updates a "Version Packages" PR
   - If no pending changesets (version PR was just merged) → publishes to npm with provenance, creates git tags, creates GitHub Releases

### Merge to main &ndash; Vercel

Vercel auto-deploys the website on every push to main:

1. Detects `pnpm-workspace.yaml` → builds workspace dependencies first
2. Runs `pnpm --filter website build` (the full chain: API docs → embeddings → Next.js)
3. Deploys to production at directive.run

---

## Release Process

### Flow Diagram

```mermaid
flowchart TD
    A[Developer creates changeset] --> B[Push to main]
    B --> C[release.yml triggers]
    C --> D[Build + Typecheck + Test]
    D --> E{Pending changesets?}
    E -- Yes --> F["Version mode:<br/>Creates 'Version Packages' PR"]
    F --> G[Developer merges PR]
    G --> B
    E -- No --> H[Publish mode]
    H --> I[npm publish with provenance]
    I --> J[Git tags created]
    J --> K[GitHub Releases created]
    K --> L[Vercel redeploys website]
```

### Step-by-Step

**1. Create a changeset**

```bash
pnpm changeset
```

Or use the `/changeset` skill in Claude Code. Select the affected packages and describe the change.

**Tips for fixed groups:**
- List one package from the group (e.g., `@directive-run/core`) &ndash; all group members bump automatically
- If an adapter (react, vue, etc.) has its own meaningful changes, list it explicitly for a proper changelog entry
- Packages with no changes of their own don't need listing &ndash; they get the version bump from the group

**2. Push to main**

The changeset file (`.changeset/*.md`) is committed with your code changes. CI runs on the PR. Merge when green.

**3. Version Packages PR (automatic)**

After merge, `release.yml` runs the Changesets action. It detects pending changesets and creates a "Version Packages" PR that:
- Bumps versions in all affected `package.json` files (fixed groups bump together)
- Updates `CHANGELOG.md` in each package
- Removes the consumed `.changeset/*.md` files

**4. Merge the Version PR**

Review the version bumps and changelogs, then merge.

**5. Publish (automatic)**

Merging triggers `release.yml` again. This time there are no pending changesets, so the Changesets action:
- Publishes to npm with provenance signing (`id-token: write` permission)
- Creates git tags (e.g., `@directive-run/core@0.2.0`)
- Creates GitHub Releases for each published package
- Vercel auto-redeploys the website with updated API docs

### `pnpm changeset publish` vs `pnpm publish -r`

| Feature | `changeset publish` | `publish -r` |
|---------|---------------------|--------------|
| Creates git tags | Yes | No |
| GitHub Releases (via action) | Yes | No |
| Skips already-published versions | Yes | No (fails on conflict) |
| Reads `access` from config | Yes | Needs `--access public` |
| Provenance signing | Yes (with `id-token`) | Yes (with `id-token`) |

### Changeset Configuration

Key settings in `.changeset/config.json`:

| Setting | Value | Purpose |
|---------|-------|---------|
| `fixed` | `[["core", "react", "vue", ...]]` | Fixed groups &ndash; all bump together |
| `access` | `"public"` | Publish as public scoped packages |
| `baseBranch` | `"main"` | PR target branch |
| `onlyUpdatePeerDependentsWhenOutOfRange` | `true` | Prevents major bumps from peer dep changes |
| `changelog` | `"@changesets/changelog-github"` | GitHub-linked changelog entries |

### Changelog Behavior

Fixed groups share version numbers, but **changelog entries only appear for packages explicitly listed in the changeset file**. If only `@directive-run/core` is listed, the other group members (react, vue, svelte, solid, lit) get the version bump but their `CHANGELOG.md` files won't have an entry for that release. If an adapter has its own changes, list it explicitly in the changeset for a proper changelog entry.

### Local Fallback

Only use this if GitHub Actions isn't working:

```bash
pnpm changeset version        # Bump versions + generate changelogs
pnpm -r build                 # Build all packages
pnpm test -- --run             # Run tests
npm whoami                     # Verify npm auth
pnpm changeset publish         # Publish to npm + create git tags
git push --follow-tags         # Push commits + tags
```

**Note:** Local publishes don't create GitHub Releases. Create them manually at [github.com/directive-run/directive/releases/new](https://github.com/directive-run/directive/releases/new) using the git tags created by `changeset publish`.

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
