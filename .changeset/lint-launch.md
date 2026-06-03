---
"@directive-run/lint": minor
---

`@directive-run/lint@0.1.0` — ts-morph-based static analysis for Directive code, with 10 rules and 6 mechanical autofixes.

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
