---
"@directive-run/react": patch
---

Fix missing `history` option on `useDirectiveRef` — `DirectiveRefBaseConfig` now accepts `history?: HistoryOption` and passes it through to `createSystem` in both single-module and namespaced modes.
