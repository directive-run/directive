---
description: Pre-push validation – lint, typecheck, test, build
---

# Validate

Run all checks to verify the monorepo is healthy before pushing.

## Step 1: Lint

```bash
pnpm lint
```

Report pass/fail. If failures, list the first 10 issues.

## Step 2: Type Check

```bash
pnpm typecheck
```

Report pass/fail with error count. If failures, group errors by package.

## Step 3: Tests

```bash
pnpm test -- --run
```

Note: `--run` prevents Vitest from entering watch mode. Report pass/fail with total test count and pass rate.

## Step 4: Build

```bash
pnpm -r build
```

Report pass/fail. If failures, show which package(s) failed.

## Step 5: Code Quality Scan

Count `@ts-ignore` and `@ts-expect-error` instances:

```bash
grep -rEn "@ts-ignore|@ts-expect-error|@ts-nocheck" packages/*/src/ --include="*.ts" --include="*.tsx" || echo "None found"
```

List each occurrence with file and line number.

## Step 6: Version Consistency

Read `packages/*/package.json` and verify all packages within each fixed group (from `.changeset/config.json`) have the same version.

## Step 7: Uncommitted Changes

```bash
git status --porcelain
```

Report if there are uncommitted changes.

## Step 8: Summary

Format results as a summary table:

```
Step          | Status | Details
-------------|--------|--------
Lint          | PASS   |
Type Check    | PASS   | 0 errors
Tests         | PASS   | 1,630 tests
Build         | PASS   | 12 packages
@ts-ignore    | INFO   | 3 instances
Versions      | PASS   | Groups consistent
Uncommitted   | WARN   | 5 files modified
```

If all steps pass, show: "Ready to push."
If any step fails, show: "Fix issues before pushing."
