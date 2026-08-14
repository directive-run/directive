# @directive-run/el

## 1.1.3

### Patch Changes

- [#126](https://github.com/directive-run/directive/pull/126) [`044822c`](https://github.com/directive-run/directive/commit/044822cc70894b35b5d5f1840e31b19143433d21) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Fixes from a review of the 1.27.1 watched-set change, including a correction to what that release claimed.

  **The prune no longer runs when there is nothing to prune.** Rebuilding the watched set costs a walk of every constraint's and every effect's dependency set, and 1.27.1 paid it on every reconcile — including systems where nothing reads a derivation at all, where there is nothing to gain because the invalidation walk already short-circuits on the same emptiness. Measured at 4% to 23% of a reconcile in that shape. It is now guarded.

  **A disabled effect no longer pins what it read.** Disabling a constraint dropped its dependency set; disabling an effect did not, so every derivation that effect had read stayed watched for the life of the system — the same growth 1.27.1 set out to end, surviving in one path. The error boundary's disable strategy reaches this, so an effect that threw once pinned its derivations permanently.

  **A derivation may be named after a member of Object.prototype.** `toString`, `valueOf` and `hasOwnProperty` resolved to the inherited builtin function instead of the derivation's value, so a constraint gated on one was unconditionally truthy, with no error anywhere.

  **`@directive-run/el` now declares the core version it actually needs** — `^1.15.0` rather than `^1.0.0`. It imports two types that did not exist before 1.15.0, so the old range let a consumer install a core whose types cannot satisfy it while the package manager reported the peer as met.

  **Correcting the 1.27.1 note.** That release reported the change as roughly 29 to 18 microseconds per reconcile. That measurement is real but was taken only on the shape where the change wins — a deep derivation chain behind narrow readers. On wide readers it was a 12% to 20% regression, and where nothing is watched it was a 4% to 23% regression for no benefit. The guard above removes the second case; the first remains a real trade and is now stated rather than implied.

## 1.1.2

### Patch Changes

- [`3a86db7`](https://github.com/directive-run/directive/commit/3a86db7a9ff55cff81150eadc766ae3ca47e5790) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Bump `vitest` to `^3.2.6` across every package that pins it directly, closing GHSA-9crc-q9x8-hgqq (arbitrary file read via Vitest's UI server prior to 3.2.6). Dev-dependency only — no runtime code ships to consumers changes. The full workspace test suite (5,383 tests across 195 files) runs green on 3.2.7.

  Per-package `test` scripts now delegate to the workspace root (`cd ../.. && vitest run packages/<name>/`) to match Vitest 3's cwd-relative `include` resolution.

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
