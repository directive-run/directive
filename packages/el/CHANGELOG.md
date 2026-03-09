# @directive-run/el

## 0.5.0

### Minor Changes

- [`f15a4bf`](https://github.com/directive-run/directive/commit/f15a4bf653c0d8616227b7de678efb36563c57b0) Thanks [@jasoncomes](https://github.com/jasoncomes)! - New package: `@directive-run/el` — vanilla DOM adapter for Directive.

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

### Patch Changes

- [`8f20339`](https://github.com/directive-run/directive/commit/8f203394a0320d108d1e06b89dac9e675094154a) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Mark `@directive-run/core` as optional peer dependency.
  - `@directive-run/core` is now optional in `peerDependenciesMeta` — standalone `npm install @directive-run/el` no longer warns about missing core
  - `el()`, JSX runtime, and htm work without `@directive-run/core` installed
  - Only `bind()`, `bindText()`, and `mount()` require core for reactive bindings
