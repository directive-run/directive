---
"@directive-run/core": patch
---

Refactor system internals and fix proxy hardening gaps.

- Extract proxy factories and module transformation into dedicated modules for maintainability
- Fix tickMs dispatching only searching first module instead of all modules
- Harden single-module events proxy with missing security traps (has, deleteProperty, ownKeys)
- Replace O(n) array lookup with O(1) Set check in topological sort
