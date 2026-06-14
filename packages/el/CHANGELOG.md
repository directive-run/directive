# @directive-run/el

## 1.1.1

### Patch Changes

- [`0c2d306`](https://github.com/directive-run/directive/commit/0c2d30637d854098286980309a00f2152c9997d4) Thanks [@jasoncomes](https://github.com/jasoncomes)! - XSS / prototype-pollution / inline-handler-injection hardening for the shared sanitize-props path used by `el()` and the JSX runtime.

  The previous deny-set only covered the markup-injection sinks (`innerHTML`, `outerHTML`, `srcdoc`). `Object.assign(element, props)` would happily forward three other dangerous shapes:

  - `__proto__`, `constructor`, `prototype` — prototype-pollution vectors reaching the element's prototype chain. Now mirrors `@directive-run/core`'s `BLOCKED_PROPS` so the deny-sets cannot drift.
  - String-valued `on<Event>` keys — `el("img", { onerror: facts.x })` would register an inline JS handler whenever `facts.x` was a string. Function-valued handlers (the legitimate JSX path) still pass through unchanged.

  `sanitizeProps` now iterates own keys via `Object.entries` rather than spreading (which copies an own-key `__proto__` straight through), applies the deny-set, and rejects unsafe handler keys. The JSX runtime mirrors the same filter on its `rest` object.

  Adds 4 regression tests covering each rejection path plus the function-handler preserve path.

## 1.1.0

### Minor Changes

- [`c0391ac`](https://github.com/directive-run/directive/commit/c0391acca4d4051e390bf5d9e0d193d39d2c171e) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Export the shared XSS prop blocklist so the two render paths can't drift.

  `el()` and the JSX runtime both refuse to write `innerHTML`, `outerHTML`,
  and `srcdoc` via `Object.assign`. Both used to keep their own copy of
  that list, which left room for one path to grow a new sink without the
  other knowing. The blocklist now lives once as `XSS_BLOCKED_PROPS` in
  `@directive-run/el`, with `el()` and the JSX runtime both reading from
  that single export.

  Also adds an `SSR` section to the README clarifying that `@directive-run/el`
  is browser-only (it calls `document.createElement` directly) and pointing
  SSR-needing apps at the framework adapters.

- [`3cc61df`](https://github.com/directive-run/directive/commit/3cc61df7aed8dd7f5b7f7faa190849b810650f99) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add `SystemFacts<T>` and `SystemDerived<T>` type helpers to
  `@directive-run/core` for extracting the typed facts and derivations
  shape from any Directive system or module schema.

  Both helpers accept a `SingleModuleSystem<S>`, a `NamespacedSystem<Modules>`,
  or a raw `ModuleSchema`, and return the value shape — not the writable
  proxy or the runtime-control surface. They make it possible to type
  adapter callbacks, render functions, and selector helpers against the
  schema's narrow types instead of falling back to `Record<string, unknown>`.

  ```ts
  import {
    createSystem,
    type SystemFacts,
    type SystemDerived,
  } from "@directive-run/core";

  const system = createSystem({ module: trafficLight });

  function paint(
    facts: SystemFacts<typeof system>, // { phase: "red" | "green" | "yellow" }
    derived: SystemDerived<typeof system> // { isRed: boolean }
  ) {
    return derived.isRed ? "STOP" : "GO";
  }
  ```

  `@directive-run/el`'s `bind`, `bindText`, and `mount` now thread the
  schema into their updater callbacks, so a `bind(system, span, (el, facts) => ...)`
  call gets `facts.phase` typed as the schema literal union instead of
  `unknown` — no `as` casts required at the call site. Existing call
  sites that did cast still compile; the casts are now noise.

## 1.0.0

### Patch Changes

- Updated dependencies [[`a6a23b2`](https://github.com/directive-run/directive/commit/a6a23b2e52377a07bbbde52a89dcffcc3db2f826)]:
  - @directive-run/core@1.0.0

## 0.5.0

### Minor Changes

- [`f15a4bf`](https://github.com/directive-run/directive/commit/f15a4bf653c0d8616227b7de678efb36563c57b0) Thanks [@jasoncomes](https://github.com/jasoncomes)! - New package: `@directive-run/el` – vanilla DOM adapter for Directive.

  **Features**

  - `el()` – typed element creation with full tag-to-element type inference
  - `bind()` – subscribe an element to system state with automatic cleanup
  - `bindText()` – shorthand for text content binding
  - `mount()` – replace children on state change (lists, conditional rendering)
  - Props auto-detection – skip empty `{}` when second arg is a child (`el("p", "text")`)
  - Falsy/boolean children silently skipped (enables `condition && el(...)` pattern)
  - Number children coerced to text nodes
  - JSX runtime (`@directive-run/el/jsx-runtime`) – write JSX without React
  - htm binding (`@directive-run/el/htm`) – tagged templates with no build step

### Patch Changes

- [`8f20339`](https://github.com/directive-run/directive/commit/8f203394a0320d108d1e06b89dac9e675094154a) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Mark `@directive-run/core` as optional peer dependency.
  - `@directive-run/core` is now optional in `peerDependenciesMeta` – standalone `npm install @directive-run/el` no longer warns about missing core
  - `el()`, JSX runtime, and htm work without `@directive-run/core` installed
  - Only `bind()`, `bindText()`, and `mount()` require core for reactive bindings
