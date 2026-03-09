# @directive-run/cli

## 0.5.0

### Minor Changes

- [`7229881`](https://github.com/directive-run/directive/commit/72298811032bbaf988bf8c200cc8ba481f0132f7) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add dynamic runtime definitions, harden security, and refactor internals.

  **Features**
  - Add `register()`, `assign()`, `getOriginal()`, `restoreOriginal()` for constraints, resolvers, derivations, and effects at runtime
  - Add `DerivationsControl` type for dynamic definition methods on `system.derive`
  - Add `read()` overload for fact keys on `SingleModuleSystem`

  **Fixes**
  - Fix command injection vulnerability in CLI `graph` command (`exec` → `execFile`)
  - Reject schema keys starting with `$` to prevent internal collision
  - Prefix all testing assertion errors with `[Directive]`
  - Harden all 11 proxies with `defineProperty`, `getPrototypeOf`, `setPrototypeOf` traps

  **Improvements**
  - Extract shared adapter utilities (SSE parsing, hooks, error handling) in AI package
  - Split orchestrator into pattern-composition, pattern-factories, pattern-serialization (10,272 → 8,729 LOC)
  - Split `facts.ts` into `schema-builders.ts` + facts store
  - Consolidate `BLOCKED_PROPS` to single export in `tracking.ts`
  - Remove 7 internal builder types from public exports

  **BREAKING:** `constraintFactory` renamed to `createConstraintFactory`, `resolverFactory` renamed to `createResolverFactory`

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@0.5.0

## 0.4.2

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@0.4.2

## 0.2.0

### Minor Changes

- [`73a604e`](https://github.com/directive-run/directive/commit/73a604e68f86f785f413fbfb9314f9fac90fef2a) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Enforce stricter lint rules and add CLI + knowledge packages.

  **Features**
  - Add `@directive-run/cli` with `ai-rules init` command for installing AI coding rules across editors (Claude, Cursor, Copilot, Cline, Windsurf)
  - Add `@directive-run/knowledge` for extracting structured knowledge from Directive packages

  **Improvements**
  - Promote 8 Biome lint rules from warn to error: `noUnusedTemplateLiteral`, `useLiteralKeys`, `useExponentiationOperator`, `useConst`, `noUselessElse`, `noConfusingVoidType`, `noCommaOperator`, `noDelete`
  - Auto-fix all lint violations across source files (no API changes)

### Patch Changes

- Updated dependencies []:
  - @directive-run/knowledge@0.2.0
