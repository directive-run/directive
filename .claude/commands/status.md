---
description: Project health dashboard – versions, tests, build, bundle sizes
---

# Status

Show a project health dashboard with versions, build status, and metrics.

**Note:** Steps 3-4 (tests + build) are optional and may take several minutes. Use AskUserQuestion to ask the user whether to run them or just show cached/quick status.

## Step 1: Package Versions

Read all `packages/*/package.json` files and list each package with its version.

## Step 2: Unreleased Changesets

```bash
pnpm changeset status 2>&1 || echo "No changesets pending"
```

Report how many changesets are pending.

## Step 3: Tests

```bash
pnpm test -- --run 2>&1
```

Note: `--run` prevents Vitest from entering watch mode. Capture total test count and pass rate from the output.

## Step 4: Build Status

```bash
pnpm -r build 2>&1
```

Report pass/fail for each package.

## Step 5: Code Quality Metrics

Count `@ts-ignore` / `@ts-expect-error`:

```bash
grep -rEn "@ts-ignore|@ts-expect-error|@ts-nocheck" packages/*/src/ --include="*.ts" --include="*.tsx" 2>/dev/null | wc -l
```

Count TODO/FIXME/HACK:

```bash
grep -rEn "TODO|FIXME|HACK" packages/*/src/ --include="*.ts" --include="*.tsx" 2>/dev/null | wc -l
```

## Step 6: Recent Activity

```bash
git log --oneline -5
```

## Step 7: Published Versions

Check npm for what's currently published. Check all publishable packages (read names from Step 1):

```bash
for pkg in core ai react vue svelte solid lit adapter-openai adapter-anthropic adapter-ollama; do
  echo "@directive-run/$pkg: $(npm view @directive-run/$pkg version 2>/dev/null || echo 'Not published')"
done
```

## Step 8: Bundle Sizes

Check dist sizes for each package:

```bash
du -sh packages/*/dist 2>/dev/null || echo "No dist directories (run build first)"
```

## Step 9: Dashboard

Format everything as a dashboard:

```
Directive Project Status
========================

Packages (12):
  @directive-run/core         0.1.0  (npm: not published)
  @directive-run/react        0.1.0  (npm: not published)
  ...

Health:
  Tests:        1,630 passing
  Build:        All green
  @ts-ignore:   3
  TODO/FIXME:   12
  Changesets:   2 pending

Recent Commits:
  abc1234  [feat] Add streaming support
  def5678  [fix] Resolve race condition
  ...

Bundle Sizes:
  core:    45K
  react:   12K
  ...
```
