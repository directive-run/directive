---
"@directive-run/core": patch
"@directive-run/ai": patch
"@directive-run/cli": minor
---

Enforce stricter lint rules and add CLI + knowledge packages.

**Features**
- Add `@directive-run/cli` with `ai-rules init` command for installing AI coding rules across editors (Claude, Cursor, Copilot, Cline, Windsurf)
- Add `@directive-run/knowledge` for extracting structured knowledge from Directive packages

**Improvements**
- Promote 8 Biome lint rules from warn to error: `noUnusedTemplateLiteral`, `useLiteralKeys`, `useExponentiationOperator`, `useConst`, `noUselessElse`, `noConfusingVoidType`, `noCommaOperator`, `noDelete`
- Auto-fix all lint violations across source files (no API changes)
