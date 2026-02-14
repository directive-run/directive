---
description: Scaffold a new package in the monorepo
---

# New Package

Scaffold a new `@directive-run/*` package with all config files, ready to develop.

## Step 1: Package Name

**Use AskUserQuestion:** What should the package be named?

Examples: `adapter-groq`, `preact`, `devtools`, `middleware`

The npm name will be `@directive-run/<name>` and directory will be `packages/<name>/`.

**Validate:** The name must match `^[a-z][a-z0-9-]*$` (lowercase alphanumeric with hyphens, starting with a letter). Reject and re-prompt if invalid.

## Step 2: Package Type

**Use AskUserQuestion:** What type of package?

Options:
- **Framework adapter** (e.g., preact, angular) – peer dep on `@directive-run/core` + framework
- **AI adapter** (e.g., adapter-groq) – peer dep on `@directive-run/ai`
- **Utility** (e.g., devtools, middleware) – peer dep on `@directive-run/core`

## Step 3: Create Directory

```bash
mkdir -p packages/<name>/src/__tests__
```

## Step 4: Generate package.json

Use the appropriate template based on package type. Match the structure from existing packages (`packages/react/package.json` for framework, `packages/adapter-openai/package.json` for AI).

All types include:
- `version`: Read the current version from an existing package in the target fixed group and use that version (e.g., if core is at `0.2.0`, use `0.2.0`)
- `license`: `"MIT"`
- `author`: `"Jason Comes"`
- `repository.url`: `"https://github.com/DirectiveRun/DirectiveJS"`
- `repository.directory`: `"packages/<name>"`
- `homepage`: `"https://directive.run"`
- `engines.node`: `">=18"`
- `sideEffects`: `false`
- `type`: `"module"`
- Standard exports map (types/require/import)
- Standard scripts (build, dev, test, typecheck, clean)
- `files`: `["dist"]`

**Framework adapter** peer deps:
```json
"peerDependencies": {
  "@directive-run/core": "workspace:*",
  "<framework>": ">=<version>"
}
```

**AI adapter** peer deps:
```json
"peerDependencies": {
  "@directive-run/ai": "workspace:*"
}
```

**Utility** peer deps:
```json
"peerDependencies": {
  "@directive-run/core": "workspace:*"
}
```

## Step 5: Generate tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

## Step 6: Generate tsup.config.ts

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: "es2022",
});
```

## Step 7: Create Source Files

**`src/index.ts`:**
```typescript
/**
 * @directive-run/<name>
 * <description from package.json>
 */
```

**`src/__tests__/index.test.ts`:**
```typescript
import { describe, it, expect } from "vitest";

describe("@directive-run/<name>", () => {
  it("should be importable", () => {
    expect(true).toBe(true);
  });
});
```

## Step 8: Add to Fixed Group

Read `.changeset/config.json` and add the new package to the appropriate fixed group:
- Framework adapters go in the core+frameworks group
- AI adapters go in the ai+adapters group
- Utilities: ask the user which group, or create standalone

Write the updated config back.

## Step 9: Install Dependencies

```bash
pnpm install
```

## Step 10: Report

Show created files:
```
packages/<name>/
  package.json
  tsconfig.json
  tsup.config.ts
  src/
    index.ts
    __tests__/
      index.test.ts
```

Next steps:
1. Implement the package in `src/index.ts`
2. Add tests in `src/__tests__/`
3. Run `/validate` to verify everything builds
4. Run `/changeset` before releasing
