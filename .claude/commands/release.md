---
description: Full release orchestration – version, build, test, publish to npm
---

# Release

Orchestrate a full release: version bumps, builds, tests, and npm publish.

## Step 1: Check for Pending Changesets

```bash
pnpm changeset status
```

If there are **no pending changesets**, stop and tell the user:

> No pending changesets found. Run `/changeset` first to create one, then re-run `/release`.

## Step 2: Version Bump

Run changeset version to bump package versions and generate changelogs:

```bash
pnpm changeset version
```

Show which packages were bumped and to what versions.

## Step 3: Build All Packages

```bash
pnpm -r build
```

If the build fails, stop and report errors. Do not continue to publish.

## Step 4: Run Tests

```bash
pnpm test -- --run
```

Note: `--run` prevents Vitest from entering watch mode. If tests fail, stop and report failures. Do not continue to publish.

## Step 5: Review Changes

Show the user:
- Version diffs (`git diff packages/*/package.json` focusing on version fields)
- Generated changelog entries
- List of packages that will be published

**Use AskUserQuestion** to confirm:
- "Publish these versions to npm?" (Yes / No, abort)

If the user aborts, stop. Changes remain uncommitted so they can adjust.

## Step 6: Create Release Commit

Stage only the files that changesets modified (version bumps + changelogs):

```bash
git add packages/*/package.json packages/*/CHANGELOG.md .changeset/
```

Show `git diff --cached --stat` so the user can verify what will be committed.

Then commit following project conventions. **Do NOT include Co-Authored-By or AI attribution** (per `/commit` guidelines):

```bash
git commit -m "chore: release $(date +%Y-%m-%d)"
```

## Step 7: Publish to npm

First verify npm auth:

```bash
npm whoami 2>/dev/null || echo "ERROR: Not logged in to npm – run npm login first"
```

If not authenticated, stop and instruct the user to run `npm login`.

Then publish:

```bash
pnpm changeset publish
```

Report for each package:
- Package name
- Published version
- npm URL (`https://www.npmjs.com/package/@directive-run/<name>`)
- Any errors

## Step 8: Create Git Tags

```bash
pnpm changeset tag
```

This creates git tags like `@directive-run/core@0.2.0` for each published package.

## Step 9: Post-Release Checklist

Show the user:

> **Post-release steps:**
> 1. Push commits and tags: `git push --follow-tags`
> 2. Create GitHub release (if desired)
> 3. Website auto-redeploys via Vercel on push to main (API docs + embeddings regenerated automatically)
> 4. Announce on social channels
