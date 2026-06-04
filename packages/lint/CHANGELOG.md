# @directive-run/lint

## 0.1.1

### Patch Changes

- [`63e625e`](https://github.com/directive-run/directive/commit/63e625eb73c2795d867d31ab57cefda72f87242f) Thanks [@jasoncomes](https://github.com/jasoncomes)! - **Bug fix:** `@directive-run/lint@0.1.0` shipped with an empty rule registry — esbuild's treeshake + minify pipeline elided the array contents at publish time even though every rule import was referenced. `getRules()` returned `[]`, `review_source` reported zero findings on broken code, and `fix_code` had nothing to apply.

  Two-layer fix:

  - `tsup.config.ts` now sets `treeshake: false` for both `index` and `worker` entries on `@directive-run/lint`.
  - `src/rules.ts` builds `EXECUTABLE_RULES` with explicit `.push(...)` calls rather than the `Object.freeze([…literal])` pattern that the treeshaker was eliding. The matching `Object.freeze(EXECUTABLE_RULES)` after the pushes preserves the original immutability contract.

  `@directive-run/mcp` gets a patch bump because its `review_source` / `fix_code` / `list_review_rules` / `get_review_rule` tools depend on this rule registry being populated.

## 0.1.0

### Minor Changes

- [`f98c183`](https://github.com/directive-run/directive/commit/f98c1835e6c13f382420bd93412ff4a54b586d2a) Thanks [@jasoncomes](https://github.com/jasoncomes)! - `@directive-run/lint@0.1.0` — ts-morph-based static analysis for Directive code, with 10 rules and 6 mechanical autofixes.

  **Rules (10):**

  - `no-single-line-if-return` (warning, fixable) — adds braces around bare `if (x) return y;`.
  - `module-missing-facts-schema` (error) — catches flat schemas missing the `facts` wrapper.
  - `resolver-not-async` (warning, fixable) — adds `async` to non-async resolve functions.
  - `derivation-uses-imported-state` (warning) — flags derive fns reading identifiers outside the facts proxy.
  - `effect-mutates-facts` (error) — flags `facts.x = …` inside an effect.run handler.
  - `useState-alongside-facts` (warning) — flags React components mixing `useState` with `useFact` / `useDerived`.
  - `constraint-without-when-or-require` (error) — flags constraint entries missing either key.
  - `resolver-naming-mismatch` (warning) — flags resolver key not matching camelCase of requirement type.
  - `module-name-not-kebab` (warning, fixable) — rewrites `createModule("TrafficLight")` to `"traffic-light"`.
  - `imperative-task-in-effect` (error) — flags `setInterval` / `setTimeout` / `queueMicrotask` inside `effect.run`.

  **Public API:** `getRules()`, `getRuleById(id)`, `runRules(source, opts)`, `applyFix(source, finding)` plus `Finding`, `RuleMetadata`, `RunResult`, `FixResult`, `Severity`, `RuleCategory` types.

  **ts-morph is `optionalDependencies`** so read-only consumers (just listing rule metadata via `getRules()`) don't pay the ~25 MB install cost. `runRules` and `applyFix` lazy-import ts-morph and throw a structured error if it's missing.

  **`./worker` subpath export** for `worker_threads`-based timeout enforcement; see `@directive-run/mcp`'s `lint-runner.ts` for the pattern.
