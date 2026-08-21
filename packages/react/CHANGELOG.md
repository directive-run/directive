# @directive-run/react

## 1.32.0

## 1.31.3

## 1.31.2

## 1.31.1

## 1.31.0

## 1.30.0

## 1.29.5

## 1.29.4

## 1.29.3

## 1.29.2

## 1.29.1

## 1.29.0

## 1.28.1

## 1.28.0

## 1.27.1

## 1.27.0

## 1.26.0

## 1.25.0

### Patch Changes

- [#109](https://github.com/directive-run/directive/pull/109) [`499d400`](https://github.com/directive-run/directive/commit/499d4007229595d6330919cb279bb2dac0e3c4bb) Thanks [@jasoncomes](https://github.com/jasoncomes)! - **The framework adapters now declare the core version they actually need.** All five accepted `@directive-run/core@^1.0.0` while calling `system.destroyAsync()`, which core did not have until 1.18.0.

  A range is a promise about what will work. This one let a package manager resolve a core anywhere in the 1.x line, report no conflict, and hand the adapter a system object with no `destroyAsync` on it — so unmounting a component threw `system.destroyAsync is not a function` at the one moment a teardown path is least likely to be covered by a test. The floor is `^1.18.0` on all five.

  `@directive-run/lit` also declares `@directive-run/query` as an optional peer. It exports `QuerySystemController`, whose own documentation tells you to import `createQuerySystem` from `@directive-run/query`, and it listed no query peer at all — so the one adapter with a query integration was the one that never told you it had one. React, Vue, Svelte and Solid already declared it this way.

  Nothing about the code changed. If your installed versions already satisfy the corrected ranges, upgrading changes nothing you can observe; if they do not, you now get the resolution warning that should have been there.

## 1.24.1

## 1.24.0

## 1.23.1

### Patch Changes

- [`3a86db7`](https://github.com/directive-run/directive/commit/3a86db7a9ff55cff81150eadc766ae3ca47e5790) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Bump `vitest` to `^3.2.6` across every package that pins it directly, closing GHSA-9crc-q9x8-hgqq (arbitrary file read via Vitest's UI server prior to 3.2.6). Dev-dependency only — no runtime code ships to consumers changes. The full workspace test suite (5,383 tests across 195 files) runs green on 3.2.7.

  Per-package `test` scripts now delegate to the workspace root (`cd ../.. && vitest run packages/<name>/`) to match Vitest 3's cwd-relative `include` resolution.

## 1.23.0

## 1.22.0

## 1.21.0

## 1.20.2

### Patch Changes

- [#76](https://github.com/directive-run/directive/pull/76) [`8577c06`](https://github.com/directive-run/directive/commit/8577c06131385983321d2297cff1751e53baec3b) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Hardening batch closing audit findings on top of the v1.20.x release.

  `@directive-run/core` (patch):

  - **`system.notify.guardrailBlocked` plugin-name validation.** The
    RFC 0010 surface accepted any `plugin` string. A third-party
    plugin holding a `System` reference could forge `"guardrail.blocked"`
    events claiming `plugin: "fact-pii-guardrail"`, misleading compliance
    audit consumers. The method now drops + warns when called with a
    plugin name that doesn't match a currently-registered plugin.
  - **`system.notify.guardrailBlocked` reentry depth cap.** A plugin's
    `onGuardrailBlocked` hook that re-emits via `notify.guardrailBlocked`
    would recurse through the broadcast fabric until stack overflow.
    Capped at depth 4 (shallow re-emission is fine; pathological
    recursion is dropped).
  - **`system.notify.guardrailBlocked` no-op after destroy.** Late hook
    firings post-`destroyAsync` no longer reach observers.
  - **`system.evict()` try/finally on `state.isEvicting`.** Without it, a
    rejected inner work would latch the flag forever and every
    subsequent `evict()` call would be a silent no-op. Cloudflare DO
    hibernation re-fire would become unrecoverable. The flag is now
    cleared in `finally`; the terminal flag (`isDestroyed`) is set by
    `destroyAsync()` on the happy path.
  - **`system.start()` refuses to start during eviction or after destroy.**
    Previously `start()` only checked `isRunning`, so a race between
    `evict()`'s `sourcesManager.evictAll()` and its `destroyAsync()`
    could re-attach sources the host runtime told us to tear down.
  - **`Plugin.onGuardrailBlocked` JSDoc** clarifies that `Error`-typed
    fact values always surface as `"detect"` regardless of the
    guardrail's configured mode.

  `@directive-run/ai` (patch):

  - **`createFactPIIGuardrail` default `walkDepth` raised from `1` → `2`.**
    Zero-config consumers now scan one level of `Error.cause` chain and
    shallow-nested-object shapes. The `walkDepth` JSDoc enumerates the
    cause-chain depth math (recurses at `depth - 1`, so `walkDepth >= 2`
    needed to scan one cause level). Real-world common shapes ship
    zero-config.
  - **File-level JSDoc** documents the `system.observe()` →
    `"guardrail.blocked"` dual surface (RFC 0010) so consumers reading
    the public docblock learn about the typed-event stream alongside
    the `onBlocked` callback.

  `@directive-run/lit` (patch):

  - **`ModuleController.hostDisconnected`** switched from sync `destroy()`
    to `destroyAsync().catch(...)`. The migration covered
    `SystemController` + `DirectiveQueryController` but missed the
    zero-config `ModuleController` — Lit users using the simplified
    controller were still dropping source-unsubscribe Promises on the
    floor.

  `@directive-run/react`, `@directive-run/vue`, `@directive-run/svelte`,
  `@directive-run/solid`, `@directive-run/lit` (patch):

  - **Dev-mode `console.warn` on `destroyAsync` rejection.** The
    fire-and-forget `.catch(() => {})` silently swallowed every
    unmount-time unsubscribe error. Operators had zero signal when a
    Supabase channel `removeChannel()` rejected. The catch now logs in
    development (`isDevelopment === true`); production behavior is
    unchanged (the manager's `phase: "runtime"` observability sink
    still receives the per-source error).

  Closes three critical and three major security findings plus three
  architecture findings. Larger items deferred to RFCs:
  Supabase channel-name reuse race, `attachGuardrailsToOtel` helper,
  timeline `guardrail.blocked` renderer, knowledge-bundle docs sync.

## 1.20.1

### Patch Changes

- [#74](https://github.com/directive-run/directive/pull/74) [`31ae328`](https://github.com/directive-run/directive/commit/31ae3284b66f2ccf1269902d9f6711415532e28e) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Framework adapter async-destroy migration.

  All five framework adapters now call `system.destroyAsync()` in their
  unmount paths instead of the synchronous `system.destroy()`:

  - `react` (`useDirective`, `useQuery`) — `useEffect` cleanup
  - `vue` (`useDirective`, `useQuery`) — `onScopeDispose`
  - `svelte` (`useDirective`, `useQuery`) — `onDestroy`
  - `solid` (`useDirective`, `useQuery`) — `onCleanup`
  - `lit` (`DirectiveController`, `DirectiveQueryController`) — `hostDisconnected`

  The adapter's lifecycle hook stays synchronous (frameworks don't await
  unmount); the `destroyAsync` Promise is fire-and-forget with a
  swallow-catch. The change makes source unsubscribes actually complete:
  a Supabase channel's `removeChannel()` returns a Promise the sync
  `destroy()` would have dropped on the floor, leaving the broker
  holding a ghost subscription until the next heartbeat. Now the
  broker drop completes before the host runtime hibernates.

  Any rejection from a source's `unsubscribe()` is already routed
  through the manager's `phase: "runtime"` observability sink (RFC
  0008), so the swallow-catch doesn't lose signal — it just prevents
  an unhandledRejection from surfacing if the framework lifecycle has
  no async error path.

  Test fixtures updated: lifecycle tests that spied on `system.destroy`
  now spy on `system.destroyAsync` to match the new call shape.

## 1.20.0

## 1.19.7

## 1.19.6

## 1.19.5

## 1.19.4

## 1.19.3

## 1.19.2

## 1.19.1

## 1.19.0

## 1.18.0

## 1.17.2

## 1.17.1

## 1.17.0

## 1.16.0

## 1.15.0

## 1.14.0

### Patch Changes

- [`8c59331`](https://github.com/directive-run/directive/commit/8c5933191502009871449c7610d78836a4863602) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Security hardening, a smaller AI bundle, and broader test coverage.

  ### Security fixes

  - **`@directive-run/vite-plugin-api-proxy`** – 10 MB body cap, a 30 s
    slowloris timeout, and a response-header allowlist. `set-cookie`,
    `authorization`, `x-api-key`, and `x-internal-*` are now explicitly
    dropped from upstream responses; only `content-type`, `cache-control`,
    `etag`, `last-modified`, `vary`, `content-encoding`, `content-language`,
    `expires`, and `pragma` are forwarded. Closes an upstream-header info
    leak and a body-flood denial-of-service.
  - **`@directive-run/core` worker adapter** – `request<T>()` accepts
    `timeoutMs?: number` (default 30 s; `0`/`Infinity` opts out). On timeout
    or `worker.onerror`, all pending entries reject and clear, closing an
    unbounded `pendingRequests` Map leak.
  - **`@directive-run/ai` structured output** – `extractJsonFromOutput` now
    runs `isPrototypeSafe` on every `JSON.parse` return point. LLM output
    with `__proto__`/`constructor`/`prototype` keys throws
    `[Directive] structured-output: extracted JSON contains unsafe
prototype keys` instead of silently passing through.

  ### Smaller AI bundle

  - **`@directive-run/ai` bundle split** – the main bundle drops from 120 KB
    to **44 KB** (-63%). New subpath exports (additive – the main barrel
    keeps re-exports with `@deprecated` JSDoc for one cycle):
    - `@directive-run/ai/multi-agent` – orchestrator, patterns, agent
      communication, checkpoints, breakpoints
    - `@directive-run/ai/predicate` – `predicateFromIntent*`,
      `predicateToolSpec*`, `PredicateFromIntentError`
    - `@directive-run/ai/guardrails` – PII, moderation, prompt-injection,
      semantic cache
    - `@directive-run/ai/devtools` – debug timeline, devtools WebSocket
      server, health monitor
    - `@directive-run/ai/evals` – eval harness
    - (`@directive-run/ai/mcp`, `/openai`, `/anthropic`, `/ollama`, `/gemini`
      unchanged)
  - **`@directive-run/core` audit-ledger refactor** – the audit ledger moved
    to `packages/core/src/plugins/audit-ledger/`. Public API unchanged; the
    tombstone-forgery defense is intact.

  ### Test coverage

  Added coverage for the `useAuditLedger` hooks across React, Vue, Svelte,
  and Solid (initial-value sync, reactive update, filter exclusion,
  `pollMs<50` clamp with dev warning, large-ledger warning, and cleanup on
  unmount), plus new tests for the vite-plugin-api-proxy body cap / header
  allowlist / timeout, the worker-adapter timeout and `onerror` paths, and
  the structured-output prototype-safety guard.

  ### Other fixes

  - Root README – added the 8 missing packages to the table (`el`, `query`,
    `cli`, `mutator`, `optimistic`, `timeline`, `vite-plugin-api-proxy`,
    `knowledge`) and fixed an adapter-count mismatch.
  - `@directive-run/vite-plugin-api-proxy` – new README documenting the CORS
    rationale, header allowlist, body cap, and production warning.
  - `AuditLedgerSink.erase` parameter renamed `tombstoneFactory` →
    `markerEntryFactory` (parameter-name rename only, no behavior change –
    positional args mean no consumer breakage).
  - Added 6 plugin concept docs (`logging`, `devtools`, `persistence`,
    `observability`, `circuit-breaker`, `performance`) under
    `docs/concepts/`.

## 1.13.0

### Minor Changes

- [`195480a`](https://github.com/directive-run/directive/commit/195480a1fe92234e023fa70db3a021b60f5efb91) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Security hardening, more honest audit-ledger claims, and two new public APIs.

  ### New public APIs

  ```ts
  import {
    // Plain-English renderer for FactPredicate
    describePredicate,
    // Content-addressed predicate fingerprint (djb2 32-bit; SHA-256 reserved for v2)
    predicateHash,
  } from "@directive-run/core";

  describePredicate({ cartTotal: { $gte: 50 }, region: { $in: ["US", "EU"] } });
  // → "cart total is at least 50 AND region is one of [US, EU]"

  predicateHash({ cartTotal: { $gte: 50 } });
  // → "a1b2c3d4" (stable across runs and runtimes)
  ```

  ### Security guarantees hardened

  - **Tombstone forgery defense** – `verify()` recognizes only `ledger.erase()`-stamped tombstones via an unforgeable internal sentinel symbol. Direct `sink.write({kind:"system.entry-erased",...})` is detected as tamper.
  - **PII redaction now walks predicate operands** – `{ email: { $eq: "alice@x.com" } }` no longer leaks the literal into `whenSpec`.
  - **Function-form `whenSource` → `sourceHash` only** – function source NEVER lands in audit entries; secrets in closures stay private.
  - **AuditEntry payloads are frozen** at write time. In-process mutation throws.
  - **`AbortSignal.any()` properly composes** runner timeouts with caller signals (previously caller signal silently disabled timeout).
  - **PII default-redaction** for `meta({ tags: ["pii"] })` fact values in the audit ledger. `capturePII: true` opts out.
  - **predicateFromIntent** ships `signal?: AbortSignal`, `redactIntent?: boolean`, `intentHash` provenance field, and `dangerousRegex` ReDoS detection.

  ### v1 boundaries (honest)

  The audit-ledger is **tamper-evident**, NOT cryptographic-grade:

  - djb2 32-bit hash chain – detects accidental + light-adversarial tamper. SHA-256 reserved for v2.
  - `verify({ strong: true })` throws "reserved for v2" (was a no-op silently returning valid in v1.12.0).
  - In-memory ring buffer drops oldest past `capacity` (default 10k). SQLite / Parquet sinks reserved for v2.
  - `ledger.erase()` provides per-subject GDPR Art.17 erasure in-sink only; persisted exports must be erased separately. Erased entries break the chain at the erasure point; `verify()` reports them in `erasedSeqs: number[]`.
  - No actor / operator / session attribution on entries (v2).
  - No read-tracking (constraint evaluations + writes only).
  - No trusted timestamps (RFC 3161 TSA) – `Date.now()` is operator-controlled.
  - No signing keys with rotation (v2).

  ### Migration (from v1.12.0)

  | Was                                                                                             | Now                                                                                                                                   |
  | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
  | `predicateToolSpec(schema)`                                                                     | `predicateToolSpecAnthropic(schema)` (deprecated alias retained)                                                                      |
  | (none)                                                                                          | `predicateToolSpecOpenAI(schema)` (new – OpenAI Chat Completions shape)                                                               |
  | `predicateFromIntentWithProvenance().rawOutputHash`                                             | `.predicateHash` (now canonicalized via `stableStringify` before hashing – semantically-identical responses produce identical hashes) |
  | `VerifyResult.erasedAt: number[]`                                                               | `VerifyResult.erasedSeqs: number[]` (avoids units collision with per-tombstone `erasedAt` timestamp)                                  |
  | `ledger.erase().tombstone`                                                                      | `.markerEntry` (renamed; plural mismatch resolved)                                                                                    |
  | `ledger.erase()` always emitted marker                                                          | Now `{ erased: 0, markerEntry: null }` for zero-match calls (no chain pollution)                                                      |
  | `PredictResult.predicate`                                                                       | removed (input reference; caller already has it)                                                                                      |
  | `predict({ cartTotal: { $changed: true } }, facts)`                                             | now synthesizes a warning in `missingChanges` when `prev` is omitted (previously silent)                                              |
  | `doctor.checkAgainst({ a: 100 }, [{ id: x, whenSpec: { a: 50 } }])` `subset` → `contradictions` | now → `warnings` (subset means "redundant", not "impossible")                                                                         |
  | `doctor.checkOwns()` returned `{ findings }`                                                    | now `{ warnings }` with `severity` discriminator                                                                                      |
  | `AuditEntry` (constraint.evaluate).whenSource.preview                                           | `.sourceHash` (secret-leak defense)                                                                                                   |
  | `Vue useAuditLedger` initial value sync                                                         | initial query fires immediately + microtask refresh (no empty-state flash)                                                            |
  | `Svelte` only `createAuditLedgerStore`                                                          | `useAuditLedger` alias added for cross-framework muscle memory                                                                        |
  | `dangerousRegex` exported from main barrel                                                      | moved to `@directive-run/core/internals` (the `@internal` tag was contradictory)                                                      |

  ### Audit-ledger AuditEntry kinds (14)

  `constraint.evaluate`, `resolver.write.rejected`, `fact.change`,
  `resolver.complete`, `resolver.error`, `system.init/start/stop/destroy`,
  `system.snapshot`, `system.history.navigate`, `system.truncated`,
  `system.entry-erased`, `system.subject-erased`. All entries carry
  `schemaVersion: 1` + `hashAlgo: "djb2-1"` for future v2 dual-format
  verify.

  ### useAuditLedger framework parity

  React / Vue / Svelte / Solid all expose `useAuditLedger(ledger, filter, { pollMs? })` returning a reactive array of matching entries. Lit ships `AuditLedgerController` as a `ReactiveController`. All five poll (default 250 ms; minimum clamp at 50 ms in dev mode). Pub/sub subscription API reserved for v2.

  ### What didn't change (back-compat)

  - The 14-variant `AuditEntry` discriminated union – every consumer's switch keeps working; new kinds were strictly additive (the compliance-audit demo gained an exhaustiveness `never` check to catch future drift at compile time).
  - All v1.12.0 APIs (`createAuditLedger`, `predicateFromIntent`, `predict`, `doctor`, `predicateToSQL/Mongo/Postgrest`, `whenExplain` panel) – same call signatures, hardened internals.
  - The newly added APIs (`describePredicate`, `predicateHash`) are net-new exports; no removed surface.

  ### Compliance demo updates

  `examples/compliance-audit` gained an ERASE button alongside TAMPER + VERIFY, demoing the full GDPR Art.17 → tombstone → verify-with-`erasedSeqs` flow. Bundle 146 kB / 46 kB gz.

  ### Not in this release

  Planned follow-ups include `ledger.replayUnder()`,
  `predicateToZod/JSONSchema/TypeScript`, an ensemble-jury `tuneFromIntent`,
  a `directive ledger render` English forensic timeline, a predict ×
  checkOwns preemptive collision check, and `RULES.md` codegen via
  `describePredicate`.

## 1.12.0

## 1.11.0

### Minor Changes

- [`280928d`](https://github.com/directive-run/directive/commit/280928dec0776fda998055fc9b47955abdf58c04) Thanks [@jasoncomes](https://github.com/jasoncomes)! - feat: predicate-from-intent + audit-ledger + predict + doctor

  The headline this release earns:

  > _"The LLM wrote a rule. The type-checker said no. The doctor said no.
  > The predictor said which facts must change. Two turns later, the rule
  > was in production – and every state change since then ships with a
  > tamper-evident, hash-chained (djb2 32-bit; SHA-256 reserved for v2)
  > explanation. Tamper one byte, the chain proves it."_

  Six new public APIs across three packages, all compounding on the
  rules-as-data substrate shipped earlier this quarter.

  ### `@directive-run/ai`: `predicateFromIntent`

  Let an LLM emit a `FactPredicate` JSON, structurally + semantically
  validated against your schema before it reaches the engine. Five layers:
  output-size cap (default 64 KiB DoS guard), `JSON.parse`,
  `validatePredicate` (closed operator set + depth + JSON-safety),
  operator-count cap, `validatePredicateAgainstSchema` (operator-on-kind).
  On failure: structured error feeds back to the model in the next
  attempt. Throws `PredicateFromIntentError` on retry exhaustion.

  ```ts
  const predicate = await predicateFromIntent({
    intent: "block checkout if cart is empty or user is unverified",
    schema: myModule.schema,
    runner,
  });
  // → typed FactPredicate, ready to drop into a constraint
  ```

  Tool-spec preset `predicateToolSpec(schema)` for OpenAI / Anthropic
  function-calling APIs.

  ### `@directive-run/core/plugins`: `createAuditLedger`

  Append-only, queryable, hash-chained log of every state change.
  Captures `constraint.evaluate` (with `whenSpec` + `whenExplain`),
  `fact.change` (prior/next), `resolver.write.rejected`,
  `resolver.complete/error`, system lifecycle. Query by fact path
  (exact match, no LIKE wildcards), constraint id, kind, time range.
  Sync djb2 hash chain (`verify()` is sync); optional async SHA-256
  strong verify reserved for v2.

  Built-in **PII redaction**: fact values for `meta({ tags: ["pii"] })`
  keys are replaced with `"[redacted]"` by default. Opt out with
  `capturePII: true`.

  ```ts
  const ledger = createAuditLedger();
  createSystem({ module, plugins: [ledger.plugin] });

  ledger.query({
    factPath: "cartTotal",
    changedBetween: ["2026-01-01", "2026-06-01"],
  });
  ledger.verify(); // tamper detection
  ```

  ### `@directive-run/core`: `predict()`

  "Would this predicate fire against these facts? If not, what's the
  smallest change that would make it fire?" Closes the LLM-emit
  iteration loop: model writes rule → `predict()` reports
  `missingChanges` with human-readable suggestions → model rewrites.

  ### `@directive-run/core`: `doctor.checkAgainst()`

  Structural contradiction detection between a candidate predicate and
  existing constraints. Three types: `direct` (mutually exclusive),
  `subset` (candidate is redundant), `overlap` (warning). Pairs with
  `predicateFromIntent` for the "doctor says no" gate before LLM-emitted
  rules reach production.

  ### `@directive-run/core`: schema introspection

  `getKind(schema)`, `getSchemaFieldKinds(schema)`,
  `getOperatorsForKind(kindNode)` – runtime discriminant for the
  operator-on-kind matrix that previously only lived in the
  `OperatorObject<V>` type. Used by `predicateFromIntent` and
  `validatePredicateAgainstSchema`; also useful for prompt builders,
  playground UIs, and `predicateToZod` (future).

  ### `@directive-run/react`: `useAuditLedger`

  Subscribe to an audit ledger and get the latest entries matching a
  filter, re-rendering as new entries land. The "drop `<AuditLog />`
  in your dev sidebar" hook.

  ```ts
  const entries = useAuditLedger(ledger, {
    kind: "constraint.evaluate",
    limit: 20,
  });
  ```

  ### What's deferred

  - **SQLite / Parquet / Loki sinks** – sink interface is open; v1 ships
    in-memory `memorySink` only.
  - **Audit-ledger devtools panel** – `useAuditLedger` hook ships;
    full panel integration with the floating devtools panel is a
    follow-up.
  - **Strong async SHA-256 verify** – v1 ships sync djb2 32-bit chain
    (fast, isomorphic, catches accidental + light-adversarial tamper).
    SHA-256 dual-chain reserved for v2.
  - **Full SMT-lite `doctor`** – z3.wasm-based satisfiability. v1 ships
    structural contradiction detection (direct / subset / overlap).
  - **`predicateToZod()`** – schema introspection unlocks this. ~0.5d
    follow-up once demanded.
  - **`useAuditLedger` for Vue / Svelte / Solid / Lit** – React only in
    v1; framework parity is mechanical.

  Pairs with `@directive-run/query`, data predicates, `replayUnder`,
  `diffRules`, and `predicateToSQL`. See the `eight-tools-from-one-decision`
  blog post.

  > Correction (later release): the original v1.11.0 language overpromised. The shipped substrate is tamper-evident with hash-chained (djb2 32-bit) entries; "court-admissible" and "GDPR-grade" were marketing claims that exceeded what the code delivers. See docs/concepts/audit-ledger.md for the accurate threat model.

## 1.10.0

## 1.9.0

## 1.8.0

## 1.7.0

## 1.6.1

### Patch Changes

- [`b506536`](https://github.com/directive-run/directive/commit/b506536aa7babfa2931b55c11ce6f36b13052e0d) Thanks [@jasoncomes](https://github.com/jasoncomes)! - fix: dev-mode validation runs in consumer production builds (v1.5.0 / v1.6.0)

  The published bundles in v1.5.0 and v1.6.0 baked `isDevelopment = true`
  as a literal – tsup resolved the `#is-development` package.json import
  to `dev-true.ts` (which was `export default true;`) and shipped the
  constant into the chunk. Every consumer's production build then ran
  dev-mode fact-validation as if `NODE_ENV` were `development`, and a
  fact-write that should have been valid threw mid-build:

  ```
  [Directive] Validation failed for "<key>": expected <type>, got null
  ```

  `directive.run` itself hit this – `next build` failed end-to-end on a
  clean v1.5.0 doc-site against the `@directive-run/ai` orchestrator's
  fact init.

  **The fix.** `dev-true.ts` is now a runtime expression that bundlers
  inline:

  ```ts
  export default typeof process !== "undefined" &&
    process.env?.NODE_ENV !== "production";
  ```

  - In a bundler (Webpack / Vite / Turbopack / Rollup / esbuild) for a
    consumer production build, the expression folds to literal `false` via
    the bundler's standard `process.env.NODE_ENV = "production"` define –
    dev-mode validation is dropped.
  - In a Node.js process, the check evaluates at runtime against the live
    `NODE_ENV`. Setting `NODE_ENV=production` correctly disables dev-mode
    validation; the default and `NODE_ENV=development` keep it on.
  - Edge / Workers / web-worker envs where `process` is undefined or
    partially polyfilled are guarded by the `typeof` check and the optional
    chain on `.env`.

  Also patched a sibling reference: `warnIfNotStarted` in `system.ts`
  read `process.env.NODE_ENV` without the same guard. Now mirrors the
  `dev-true.ts` form.

  **Required action for consumers on v1.5.0 / v1.6.0:** upgrade. There
  is no runtime workaround for the broken published bundle – the literal
  `true` was baked into the chunk and is read every time `createSystem`
  runs in any environment.

  Tested via the doc-site's `next build` against a local link of the
  patched packages – clean end-to-end after the change.

## 1.6.0

## 1.5.0

## 1.4.0

### Minor Changes

- [`9340e0d`](https://github.com/directive-run/directive/commit/9340e0d6af3c0ac85547cae9917162630c9ac445) Thanks [@jasoncomes](https://github.com/jasoncomes)! - feat: resolver constraint-binding (`bind: 'auto'`) + `useFactWithDefault`

  Adds opt-in resolver-constraint-binding that auto-rejects fact writes from
  resolvers whose triggering constraint has flipped to false. Eliminates the
  executor-tail-clobber footgun (event-driven terminal status getting
  overwritten by an in-flight resolver's tail). Default `bind: 'none'`
  preserves existing behavior; consumers opt in per-constraint.

  Also adds `useFactWithDefault(sys, key, factory)` for stable-identity
  nullable-fact fallbacks. Replaces the `useFact(sys, k) ?? factory()`
  pattern that breaks downstream memoization.

  **RFC-1 – Resolver constraint-binding (`@directive-run/core`):**

  ```ts
  constraints: {
    mutate: {
      when: (f) => f.status === "mutating",
      require: { type: "EXECUTE_ACTION" },
      bind: "auto", // NEW – default 'none'
    },
  }
  ```

  Semantics:

  - Each fact write through `ctx.facts` re-evaluates the constraint's
    `when()` predicate against the pre-write snapshot.
  - If the predicate returns `false`, the write is dropped, the resolver's
    `AbortController` is aborted, and `ctx.signal.aborted` becomes `true`
    on the next checkpoint.
  - One-shot per resolver invocation: once flipped false, the binding stays
    deactivated even if `when()` would later flip back to true mid-resolver.
  - Forbidden on async constraints (re-evaluating async predicates on every
    write would be unsound). Async + `bind: 'auto'` logs a dev warning and
    is treated as `'none'`.
  - No-op for `manager.callOne()` and out-of-band invocations (no source
    constraint).
  - Mixed-source batches fall back to no binding (predicate would be
    ambiguous).

  **RFC-2 – `useFactWithDefault` (`@directive-run/react`):**

  ```ts
  const markedCells = useFactWithDefault(sys, "markedCells", () =>
    deps.initializeMarkedCells()
  );
  ```

  The factory runs at most once per system instance. While the fact is
  `null`/`undefined`, every render returns the same cached identity. When
  the fact transitions to non-null, that value is returned. If the fact
  later returns to null, the cached factory result is reused (factory does
  NOT run again). Swapping the `system` argument re-runs the factory on the
  new system.

  Added test coverage for the new binding behavior (core: unit-level binding
  tests plus engine-level integration tests) and for `useFactWithDefault`
  (react), with no regressions in the existing suite.

  Migration guide: `docs/upgrade-guides/constraint-binding.md` (added).

## 1.3.0

## 1.1.2

### Patch Changes

- [`81da1e2`](https://github.com/directive-run/directive/commit/81da1e285e96f29f40451bcd2a05e61345f94487) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Bug fixes and added test coverage for the new features.

  **Core:**

  - Fix: `reconcile.end` observation event fields renamed to `resolversCompleted`/`resolversCanceled` (correct semantics)
  - Fix: Observer cap (100 max) prevents memory leaks from fast-remounting components
  - Fix: `hasPlugins` cached as boolean for O(1) hot-path access
  - Fix: Knowledge docs `inspect()` section rewritten with correct field names
  - Tests: 8 tests for `system.observe()`, 9 tests for coverage/observer utilities

  **Adapters (React, Vue, Svelte, Solid, Lit):**

  - All 5 framework adapters migrated to `#is-development` compile-time imports
  - Tests: 6 tests for `createDirectiveContext` (useFact, useDerived, useEvents, Provider override, error boundary, useSystem)

## 1.1.1

## 1.1.0

### Minor Changes

- [`8ae20b1`](https://github.com/directive-run/directive/commit/8ae20b1f0d9e06bfbc01a3ff79f7c47ee6aba241) Thanks [@jasoncomes](https://github.com/jasoncomes)! - XState-inspired improvements: React context provider, observation protocol, coverage testing

  **React (`@directive-run/react`):**

  - `createDirectiveContext(system)` – returns `{ Provider, useFact, useDerived, useEvents, useDispatch, useSelector, useWatch, useInspect, useExplain, useHistory, useSystem }`. Eliminates prop-drilling. Provider accepts `system` override for testing.

  **Core (`@directive-run/core`):**

  - `system.observe(observer)` – typed inspection protocol with 18 event types (`ObservationEvent`). Enables browser extensions, third-party tools, and inspection-based test assertions. Implemented as internal plugin – zero overhead when no observers.
  - `createCoverageTracker(system)` – run test scenarios, get coverage report showing which constraints/resolvers/effects/derivations were exercised and which were missed. Something XState can't do.
  - `createTestObserver(system)` – collect all observation events during tests, filter by type for assertions.
  - `CLAUDE.md` – AI contributor guide with architecture, key files, conventions.

## 1.0.1

## 1.0.0

### Patch Changes

- Updated dependencies [[`a6a23b2`](https://github.com/directive-run/directive/commit/a6a23b2e52377a07bbbde52a89dcffcc3db2f826)]:
  - @directive-run/core@1.0.0
  - @directive-run/query@1.0.0

## 0.8.9

## 0.8.8

## 0.8.7

### Patch Changes

- [`627b7a7`](https://github.com/directive-run/directive/commit/627b7a7349fe2be0f3aca5bc54127aafba4863e0) Thanks [@jasoncomes](https://github.com/jasoncomes)! - SSR hydration for all adapters, query cache persistence, audit fixes

  - core: Add `mergeHydrationFacts` shared utility, cache `wrapWithNestedWarning` proxies, wire resolver key to engine, ship observability from .lab, add `getInflightCount()`, consolidate `safeStringify`
  - react: `useHydratedSystem` uses shared `mergeHydrationFacts`
  - vue: Add `DirectiveHydrator` component + `useHydratedSystem` composable
  - svelte: Add `setHydrationSnapshot` + `useHydratedSystem`
  - solid: Add `DirectiveHydrator` + `useHydratedSystem`
  - lit: Add `HydrationController` with lifecycle management
  - ai: Split the orchestrator into smaller modules, rename `dispose()` to `destroy()`, enable bundle splitting (246KB -> 109KB), remove legacy shims
  - query: Add `persistQueryCache` plugin for offline cache persistence

## 0.8.6

### Patch Changes

- [`d7f49ab`](https://github.com/directive-run/directive/commit/d7f49ab70b3f9da49ba98a7acb76e571e4b3c439) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Monorepo audit fixes: performance, types, adapters, community infra

  - core: Add `getInflightCount()` to ResolversManager – zero-allocation hot path for `isSettled` and `settle()`
  - devtools: Unify protocol types with `@directive-run/ai` – 7 new event types (checkpoint, task, goal), shared DebugEventType/BreakpointState
  - devtools: Interactive JsonTree data explorer, refetch/invalidate/reset action buttons, detectKind fix for subscriptions/infinite queries
  - adapters: Cache `require("@directive-run/query")` in module-level lazy helper, add as optional peerDependency
  - adapters: `useQuerySystem` accepts config objects directly (no factory wrapper)

## 0.8.5

## 0.8.4

### Patch Changes

- [`97a780c`](https://github.com/directive-run/directive/commit/97a780c1d6bdf7b647e0118443dbedd6bbf6e6b7) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Post-release bug fixes:

  - Fix useSelector dep-retracking when selector function changes (React adapter)
  - Fix GraphQL headers function type (removed misleading facts parameter)
  - Fix expireAfter GC re-run bug (polling now restarts after re-activation cycles)
  - Cap mutateAsync pendingPromises Map at 100 with FIFO eviction
  - Harden replaceEqualDeep with Object.create(null) for prototype pollution defense
  - Document type inference tradeoff in createQuerySystem JSDoc
  - Add @directive-run/react install note to README

## 0.8.3

### Patch Changes

- [`0e51375`](https://github.com/directive-run/directive/commit/0e51375f17cb6b271b5af58b0c49f72b6ea945a5) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add @directive-run/query – declarative data fetching with causal cache invalidation.

  New package: createQuery, createMutation, createSubscription, createInfiniteQuery, createBaseQuery, createGraphQLQuery, createGraphQLClient, createQuerySystem, createQueryModule, withQueries, explainQuery. 191 tests across 15 test files.

  Framework adapters: useQuerySystem hook added to React, Vue, Svelte, Solid. QuerySystemController added to Lit. Factory pattern keeps @directive-run/query as zero-coupling optional dep.

## 0.8.2

## 0.8.1

### Patch Changes

- Fix `useFact` infinite re-render loop with React 19.

  - Fix `useFact` returning unstable object references from proxy access, causing `useSyncExternalStore` to trigger infinite update loops in React 19
  - Switch snapshot reads from facts proxy to raw `$store.get()` for stable references
  - Bump React dev dependencies from 18.x to 19.x

## 0.8.0

## 0.7.0

### Patch Changes

- [`702a3f6`](https://github.com/directive-run/directive/commit/702a3f6732f6c59ce95ab339b7b96d979d7d7fd7) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Fix missing `history` option on `useDirectiveRef` – `DirectiveRefBaseConfig` now accepts `history?: HistoryOption` and passes it through to `createSystem` in both single-module and namespaced modes.

## 0.6.0

### Minor Changes

- ### Breaking Changes

  - **Rename `debug.runHistory` → `trace`**: `createSystem({ debug: { runHistory: true } })` is now `createSystem({ trace: true })`. The `DebugConfig` type is removed; use `TraceOption` instead. `system.runHistory` is now `system.trace`. `RunChangelogEntry` is now `TraceEntry`.
  - **Rename `debug.timeTravel` → `history`**: `createSystem({ debug: { timeTravel: true } })` is now `createSystem({ history: true })`. `system.timeTravel` is now `system.history`. `snapshotEvents` moves from top-level module config to `history: { snapshotEvents: [...] }`.
  - **HistoryState API aligned with HistoryAPI**: `canUndo`/`canRedo`/`undo()`/`redo()` removed from `HistoryState` (returned by `useHistory` hooks). Use `canGoBack`/`canGoForward`/`goBack()`/`goForward()` instead.
  - **Observability plugin moved to lab**: `createObservability` and `createAgentMetrics` are no longer exported from `@directive-run/core/plugins` or `@directive-run/ai`. The implementation is preserved in `observability.lab.ts` for re-evaluation. Types are still exported.

  ### Features

  - Document full `getDistributableSnapshot` API including `includeFacts`, `excludeDerivations`, `metadata`, and `includeVersion` options.
  - Add `.lab.ts`/`.lab.md` feature lifecycle convention for managing lab → prod → deprecated phases.

  ### Fixes

  - Add global `cursor: pointer` to all buttons.
  - Narrow home page hero code block width.

## 0.5.0

## 0.4.2

## 0.4.1

## 0.4.0

## 0.3.0

## 0.2.0
