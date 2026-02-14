---
description: Run TypeScript type checking across all packages
---

# Type Check

Run TypeScript type checking across the entire monorepo and report results.

## Step 1: Run Type Check

```bash
pnpm typecheck 2>&1
```

This runs `tsc --noEmit` in every package via the workspace.

## Step 2: Parse Results

If there are errors, group them by package:

```
@directive-run/core (3 errors):
  src/engine.ts:42 - TS2345: Argument of type 'string' is not assignable...
  src/resolvers.ts:88 - TS2322: Type 'undefined' is not assignable...
  src/constraints.ts:15 - TS7006: Parameter 'x' implicitly has an 'any' type

@directive-run/react (1 error):
  src/hooks.ts:23 - TS2769: No overload matches this call...
```

## Step 3: TypeScript Suppressions

Find all `@ts-ignore` and `@ts-expect-error` instances:

```bash
grep -rEn "@ts-ignore|@ts-expect-error|@ts-nocheck" packages/*/src/ --include="*.ts" --include="*.tsx" || echo "None found"
```

List each with file:line and the suppressed line for context.

## Step 4: Summary

Format as a table:

```
Package                      | Errors | @ts-ignore | @ts-expect-error
-----------------------------|--------|------------|------------------
@directive-run/core           | 0      | 1          | 0
@directive-run/react          | 0      | 0          | 0
@directive-run/ai             | 0      | 2          | 0
...
-----------------------------|--------|------------|------------------
Total                         | 0      | 3          | 0
```

If all packages pass with zero errors: "All packages pass type checking."

If there are errors: "Fix the errors above before pushing. Run `/validate` for a full check."

**Note:** This is a quick type-only check. For full pre-push validation including lint, tests, and build, use `/validate` instead.
