---
"@directive-run/el": patch
---

Mark `@directive-run/core` as optional peer dependency.

- `@directive-run/core` is now optional in `peerDependenciesMeta` — standalone `npm install @directive-run/el` no longer warns about missing core
- `el()`, JSX runtime, and htm work without `@directive-run/core` installed
- Only `bind()`, `bindText()`, and `mount()` require core for reactive bindings
