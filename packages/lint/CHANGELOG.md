# @directive-run/lint

## 0.1.4

### Patch Changes

- [#172](https://github.com/directive-run/directive/pull/172) [`a41aea3`](https://github.com/directive-run/directive/commit/a41aea3994204fc9c6e74acb3a8f45be076df5fa) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Effects can no longer write facts, effects re-run after a history rewind, and
  writes made while a pass is running are no longer lost.

  **Effects are read-only.** An effect is for talking to the outside world: a
  log line, the DOM, a socket. A fact written from one used to be accepted and
  then handled halfway. Constraints and derivations saw the write, but other
  effects never did. Now:

  - Each effect receives its own read-only view of the facts. It is a different
    object from `system.facts`, with no prototype, so identity checks against
    `system.facts` no longer match inside an effect.
  - Assigning to it, deleting from it, or writing through `facts.$store` throws
    in development with a message naming the effect, the key, a one-line example
    and a docs link (`/docs/effects#effects-never-write-facts`). Production drops
    the write.
  - Nested values are the stored values themselves, in every build, so
    `structuredClone`, `postMessage` and identity checks behave the same in
    development and production (inside an effect, `structuredClone(facts.obj)`
    now works in development too). Development records a copy of each object,
    array, Map, Set or Date an effect reads, and after the run reports the
    first path changed in place (`facts.pos.x = 7`, `facts.list.push(1)`, `Object.freeze(facts.obj)`).
    The same check covers `prevFacts` and `derived`, whose values are live too.
  - Every refused write is reported in every build through the new plugin hook
    `onEffectWriteBlocked(id, key)` and the `effect.write-blocked` observation
    event, which is how a production build sees the write it dropped.
  - Effect `facts` and `prevFacts` are typed read-only one level down (new
    `EffectFacts` type), in single-module, cross-module and dynamic effects, so
    assigning a fact fails to compile. Values keep their own types, so an effect
    can pass an array or object fact to an ordinary helper without a cast;
    changing one in place is caught by the development check above.

  Where the write belongs instead: an event handler for a change caused by
  input, a derivation for a computed value, a resolver for work a constraint
  requires, and a source or resolver for data coming back from async work.
  Dispatching an event from an effect is unchanged.

  **Effects re-run after `goBack()`, `goForward()`, `goTo()`, `replay()` and
  `import()`.** Effect-driven views (a canvas, the DOM, the document title) used
  to stay on the state from before the rewind. Effects whose dependencies were
  restored now run again. That pass takes no snapshot, attaches no gated
  sources, and dispatches no resolvers. An effect that dispatches an event while
  re-running for a rewind gets a development warning; set `onNavigate: "skip"`
  on effects that record acts rather than mirror state. Writes such an effect
  causes belong to the navigation, so they no longer destroy the redo stack.

  **Fixed: requirements after a rewind.** The requirement set from before the
  rewind stayed as the baseline, so a later write that satisfied a constraint
  again did not dispatch its resolver. A rewind now rebuilds the baseline from a
  full evaluation, without dispatching. A constraint reading a key written in
  the same pass as the rewind is left out of that baseline, so the write still
  dispatches.

  **Fixed: writes made while a pass is running.** A write that landed while
  effects were running (an event an effect dispatched, a captured
  `system.facts`, a caller writing while an async effect awaited) reached
  constraints but never effects. The first write right after `start()` was lost
  the same way. These writes now carry into the next pass. They are folded into
  the history snapshot of the pass that caused them rather than taking one of
  their own, so undo lands on a settled state. A chain of passes started only
  by such writes is cut after 100 passes with a development warning, so an
  effect that feeds its own dependency cannot spin; the cut drops only what the
  chain keeps writing, never another write made meanwhile.

  **Fixed: the `retry` error strategy for effects** never re-ran anything. It now
  re-runs the failed effect on the next pass, up to three times in a row.

  `@directive-run/query` no longer writes facts from effects: its focus,
  reconnect, polling, cache-expiry and stream handling are sources (see its own
  changeset). `@sizls/ai-harness` closes its composition from a constraint and
  resolver instead of an effect.

## 0.1.3

### Patch Changes

- [`3a86db7`](https://github.com/directive-run/directive/commit/3a86db7a9ff55cff81150eadc766ae3ca47e5790) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Bump `vitest` to `^3.2.6` across every package that pins it directly, closing GHSA-9crc-q9x8-hgqq (arbitrary file read via Vitest's UI server prior to 3.2.6). Dev-dependency only — no runtime code ships to consumers changes. The full workspace test suite (5,383 tests across 195 files) runs green on 3.2.7.

  Per-package `test` scripts now delegate to the workspace root (`cd ../.. && vitest run packages/<name>/`) to match Vitest 3's cwd-relative `include` resolution.

## 0.1.2

### Patch Changes

- [`e4e3d08`](https://github.com/directive-run/directive/commit/e4e3d0809fc44892cbd1a28c76ebe61e8b7317ad) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Post-0.2.2 production-readiness review — 12 critical fixes shipped together.

  **`@directive-run/mcp@0.2.3`**

  - Worker_threads is now ON by default for `review_source` and `fix_code`. Falls back to in-process only inside vitest (`VITEST=true`) or when `DIRECTIVE_MCP_USE_LINT_WORKER=0` is set explicitly. Hostile or pathological sources can no longer pin the event loop past the 5-second budget — the original v0.2.0 hard requirement is finally the default.
  - `get_composable_packages` returns `isError: true` with a structured `NOT_FOUND` / `NO_COMPOSITIONS` prefix when the package name isn't known to the graph, instead of a misleading success-with-prose response. LLM clients can now distinguish "you typed it wrong" from "data absent."
  - SSE session-cap hardened against future SDK changes that might add async-leaky behavior to the transport constructor — a synchronous `pendingConnects` counter is incremented before any yield, so the cap can't be over-shot by N concurrent connects observing the same `sessions.size`.
  - `prepublishOnly` script chains `clean && build` so the published tarball can't ship a stale baked package registry.
  - README rebuilt around a 3-step Try it block, a full `## How it works` section with an ASCII architecture diagram, a `## Troubleshooting` table covering the four most common first-time failures, and accurate prose throughout (no more "queryable at retrieval time instead of bundled as a static snapshot" jargon).

  **`@directive-run/lint@0.1.2`**

  - **Lazy ts-morph is finally true at the bundle level.** v0.1.0 and v0.1.1 statically imported `SyntaxKind` from `ts-morph` in every rule file, so tsup inlined the rules barrel into `dist/index.js` and ESM hoisted ts-morph to the top — every consumer of `getRules()` paid the ~25 MB ts-morph load at module-init. Fixed by extracting the metadata into `rule-metadata.ts` (no ts-morph chain) and splitting the executable rules into a separate tsup entry (`./executable`) that's loaded only when `runRules` or `applyFix` fires. Verified: `dist/index.js` has zero references to ts-morph or `SyntaxKind`.
  - `resolver-naming-mismatch` dropped from `warning` to `info` severity, with explanation rewritten. No canonical Directive doc requires the camelCase convention; warning-level was lint-blasting real codebases. Disable via `ruleFilter` in projects that use semantic keys.
  - `module-missing-facts-schema` explanation rewritten — flat schemas don't produce a runtime error, they silently register no facts. The previous wording misled users.
  - New `./executable` subpath export and `./executable.d.ts` types so worker-thread consumers can resolve the rule registry without going through the main entry.

  **`@directive-run/knowledge@1.17.1`**

  - Redux migration's concept map fixed: `useSelector → useFact("x") / useDerived("y")`. The previous mapping pointed migrators at a `useSelector` API that doesn't exist with that shape in `@directive-run/react`. The steps section already said the right thing; the concept map now agrees.

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
