---
description: Create a changeset for unreleased changes
---

# Changeset

Create an accurate changeset by analyzing actual package changes since the last version bump.

**IMPORTANT:** Only `packages/` changes matter. Ignore `website/`, `docs/`, `.claude/`, config files, etc. — those are not published to npm.

## Step 1: Detect Last Version Bump

Find the most recent version bump commit:
```bash
git log --oneline --all --grep="Bump\|bump\|version\|0\.\|1\." -- packages/*/package.json | head -5
```

If unclear, read `.changeset/config.json` for the fixed groups, then check current versions:
```bash
for f in packages/*/package.json; do echo "$(basename $(dirname $f)): $(jq -r '.name + " " + .version' $f)"; done
```

Also check for any npm version tags:
```bash
git tag --sort=-v:refname | head -10
```

## Step 2: Analyze Package Changes

Run a diff from the last version bump to HEAD, scoped to `packages/` source code only (not READMEs or tests):

```bash
git log --oneline <last-bump-hash>..HEAD -- packages/*/src/
```

Then get the file-level diff for source files:
```bash
git diff <last-bump-hash>..HEAD --stat -- packages/*/src/
```

For significant changes, read the actual diff to understand new/changed exports:
```bash
git diff <last-bump-hash>..HEAD -- packages/core/src/ packages/react/src/ packages/ai/src/
```

**Ignore these entirely** — they don't affect the published package:
- `website/` (docs site, not published)
- `packages/*/README.md` (docs only, not a code change)
- `packages/*/__tests__/` or `packages/*/test/` (tests, not shipped)
- `.claude/`, `.changeset/`, root config files

## Step 3: Classify Changes Per Package

For each affected package, classify the **source code** changes:
- **Features** (new exports, new APIs, new options) → **minor** bump
- **Bug fixes** (behavior corrections, edge case fixes) → **patch** bump
- **Breaking changes** (removed/renamed exports, changed signatures) → **major** bump
- **Internal only** (refactors with no public API change) → **patch** bump

The highest classification wins per group:
- Any breaking change in any package in the group → major for the group
- Any new feature in any package in the group → minor for the group
- Only fixes/internal → patch for the group

## Step 4: Present Findings

Show the user a summary of detected **source code** changes per package:

**All packages** (single fixed group — all bump together):
- `@directive-run/core`: [list actual src/ changes found]
- `@directive-run/ai`: [list actual src/ changes found]
- `@directive-run/cli`: [list actual src/ changes found]
- (etc. — only list packages that actually changed)

**Recommended bump:** [patch/minor/major] because [reason]

**Use AskUserQuestion** to confirm:
- The bump type (with your recommendation marked)
- Whether the detected changes are complete (user may know about unlisted changes)

## Step 5: Generate Changeset

Generate a unique filename (adjective-noun-verb, e.g., `bright-foxes-leap.md`).

Write **one** `.changeset/<name>.md` file:

```markdown
---
"@directive-run/core": minor
---

Add tasks system and harden resolver lifecycle.

- Add `createTask` and `TaskModule` for structured async work
- Fix resolver cancel/finally race condition causing orphaned statuses
- Add circuit breaker pattern to multi-agent orchestrator
- Improve debug timeline with resolver flamechart visualization
- **BREAKING:** `ResolverContext.cancel()` now returns `Promise<void>`
```

**How the fixed group works:**
- All `@directive-run/*` packages share one version (core, react, vue, svelte, solid, lit, ai, cli, knowledge)
- List only ONE package (e.g., `@directive-run/core`) &ndash; changesets bumps all packages in the group automatically
- Do NOT list every package just for the version bump &ndash; that's redundant

**Per-package changelogs:** All packages share a version number, but changelog entries only appear for packages explicitly listed in the changeset file. If a package has its own meaningful changes, list it explicitly so it gets its own changelog entry. Example: if `core` adds a new API and `react` adds a new hook, list both. Packages with no changes of their own don't need listing &ndash; they still get the version bump.

**Summary rules:**
- Write a **headline sentence** (imperative mood, what the release does)
- Follow with a **bullet list** of individual changes
- Group bullets by category when 5+: **Features**, **Fixes**, **Improvements**
- Prefix breaking changes with `**BREAKING:**`
- User-facing changelog text only (no internal jargon, no review references)
- Focus on what npm consumers get: new APIs, fixed bugs, improved behavior
- Use imperative mood: "Add X", "Fix Y", "Improve Z"

## Step 6: Confirm

Show the created changeset and remind the user:

> Changeset created. Run `/release` when ready to version bump + publish to npm.

## Fixed Group Reference

From `.changeset/config.json`:
- **All packages** (single fixed group, one version): core, react, vue, svelte, solid, lit, ai, cli, knowledge
- **Not managed by changesets:** claude-plugin (private), vite-plugin-api-proxy
