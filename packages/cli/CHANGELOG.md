# @directive-run/cli

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
