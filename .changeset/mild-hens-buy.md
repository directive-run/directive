---
"@directive-run/el": minor
---

New package: `@directive-run/el` — vanilla DOM adapter for Directive.

**Features**
- `el()` — typed element creation with full tag-to-element type inference
- `bind()` — subscribe an element to system state with automatic cleanup
- `bindText()` — shorthand for text content binding
- `mount()` — replace children on state change (lists, conditional rendering)
- Props auto-detection — skip empty `{}` when second arg is a child (`el("p", "text")`)
- Falsy/boolean children silently skipped (enables `condition && el(...)` pattern)
- Number children coerced to text nodes
- JSX runtime (`@directive-run/el/jsx-runtime`) — write JSX without React
- htm binding (`@directive-run/el/htm`) — tagged templates with no build step
