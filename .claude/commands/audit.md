---
description: Security and code quality audit across the monorepo
---

# Audit

Run a security and code quality audit across all packages.

## Step 1: Dependency Vulnerabilities

```bash
pnpm audit
```

Report any vulnerabilities with severity level.

## Step 2: TypeScript Suppressions

Find all `@ts-ignore` and `@ts-expect-error` with file and line:

```bash
grep -rEn "@ts-ignore|@ts-expect-error|@ts-nocheck" packages/*/src/ --include="*.ts" --include="*.tsx" || echo "None found"
```

## Step 3: `any` in Public API

Search for `any` in exported function signatures across all source files (public API surface):

```bash
grep -rEn "export.+\bany\b" packages/*/src/ --include="*.ts" --exclude-dir="__tests__" --exclude="*.test.ts" 2>/dev/null || echo "None found"
```

Exclude obvious false positives (words like `anyone`, `anything`, `anyways`). Focus on type annotations like `: any`, `<any>`, `any[]`.

## Step 4: License Fields

Read every `packages/*/package.json` and verify each has a `license` field.

## Step 5: Secret Patterns

Search for potential secrets in non-test source files:

```bash
grep -rEn "API_KEY|SECRET|password|token|sk-|ghp_|-----BEGIN|Bearer |AWS_ACCESS_KEY|PRIVATE_KEY" packages/*/src/ --include="*.ts" --exclude-dir="__tests__" --exclude="*.test.ts" || echo "None found"
```

Exclude obvious false positives (type names, variable names for auth flows, etc.).

## Step 6: TODO/FIXME/HACK Comments

```bash
grep -rEn "TODO|FIXME|HACK" packages/*/src/ --include="*.ts" --include="*.tsx" || echo "None found"
```

Count total and list each with file:line.

## Step 7: Git History Secrets

Check git history for accidentally committed secrets:

```bash
git log --all --max-count=50 -p -S "API_KEY" --oneline -- "*.ts" "*.env" 2>/dev/null | head -20 || echo "None found"
git log --all --max-count=50 -p -S "SECRET_KEY" --oneline -- "*.ts" "*.env" 2>/dev/null | head -20 || echo "None found"
git log --all --max-count=50 -p -S "PRIVATE_KEY" --oneline -- "*.ts" "*.env" 2>/dev/null | head -20 || echo "None found"
```

## Step 8: Report

Group findings by severity:

**Critical** – Secrets in code/history, known vulnerabilities with exploits
**Major** – High/medium dep vulnerabilities, `any` in public API
**Minor** – `@ts-ignore` usage, missing license fields, TODO/FIXME comments
**Info** – HACK comments, advisory-only dep warnings

Format as:

```
Severity | Category              | Count | Details
---------|----------------------|-------|--------
Critical | Secrets in source     | 0     | Clean
Major    | Dep vulnerabilities   | 2     | lodash, axios
Minor    | @ts-ignore            | 3     | See list below
Info     | TODO comments         | 12    | See list below
```
