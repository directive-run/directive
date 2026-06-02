# @directive-run/core

## 1.16.0

## 1.15.0

### Minor Changes

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

## 1.14.0

### Minor Changes

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

### Minor Changes

- Security hardening, more honest audit-ledger claims, and two new public APIs.

- **New public APIs**

  - `describePredicate(spec)` – plain-English renderer for `FactPredicate`. `{ cartTotal: { $gte: 50 }, region: { $in: ["US","EU"] } }` → `"cart total is at least 50 AND region is one of [US, EU]"`. Powers `RULES.md` codegen.
  - `predicateHash(spec)` – content-addressed fingerprint (djb2 32-bit; SHA-256 reserved for v2). Canonicalized via `stableStringify` so semantically-identical predicates produce identical hashes across runs and runtimes.

- **Audit-ledger hardening**

  - Tombstone-forgery defense – `verify()` recognizes only `ledger.erase()`-stamped tombstones via an unforgeable in-module sentinel symbol. Direct `sink.write({ kind: "system.entry-erased", ... })` is now detected as tamper.
  - PII redaction walks predicate operands – `{ email: { $eq: "alice@x.com" } }` no longer leaks the literal into cached `whenSpec` operands flowing into `constraint.evaluate` entries.
  - Function-form constraints capture `whenSource.sourceHash` only – raw function source NEVER lands in audit entries (closures routinely reference secrets in scope).
  - `AuditEntry` payloads are frozen at write time. In-process mutation throws.
  - `verify({ strong: true })` THROWS "reserved for v2" (previously silently returned `{ valid: true }` regardless of state).
  - `ledger.erase()` skips the `system.subject-erased` marker when nothing matched the filter (`{ erased: 0, markerEntry: null }`) – no chain pollution from empty erasures.
  - `AbortSignal.any()` properly composes runner timeouts with caller signals via portable `combineSignals()` (Node < 20 no longer throws on combined signals).
  - `VerifyResult.erasedAt: number[]` renamed to `.erasedSeqs: number[]` (avoids units collision with per-tombstone `erasedAt` timestamp).

- **`doctor` API refinements**

  - `doctor.checkAgainst({ a: 100 }, [{ id: x, whenSpec: { a: 50 } }])`: `subset` finding now surfaces as `warnings` rather than `contradictions` (subset means "redundant", not "impossible").
  - `doctor.checkOwns()` return shape: `{ findings }` → `{ warnings }` with a `severity` discriminator.

- **`predict` honesty**

  - `predict({ cartTotal: { $changed: true } }, facts)` now synthesizes a warning in `missingChanges` when `prev` is omitted (previously silent).
  - `PredictResult.predicate` removed (input reference – caller already has it).

- **`predicateFromIntent` polish**

  - New options: `signal?: AbortSignal`, `redactIntent?: boolean`. Provenance entry gains `intentHash`. `dangerousRegex` ReDoS detection on incoming predicates (now exported from `@directive-run/core/internals`).
  - `predicateFromIntentWithProvenance().rawOutputHash` → `.predicateHash` (canonicalized).

- **Tool-spec presets split per provider** – `predicateToolSpec(schema)` → `predicateToolSpecAnthropic(schema)` (Claude function-calling shape) and `predicateToolSpecOpenAI(schema)` (Chat Completions shape). Old name retained as a deprecated alias.

- **Audit-ledger ships 14 `AuditEntry` kinds** – every entry carries `schemaVersion: 1` and `hashAlgo: "djb2-1"` so future v2 verifiers can dual-format.

- **v1 boundaries (honest)** – `docs/concepts/audit-ledger.md` corrected to drop overpromised "court-admissible / GDPR-grade" language. Substrate is **tamper-evident** (djb2 32-bit hash chain), NOT cryptographic-grade. In-memory ring buffer (default capacity 10k); SQLite / Parquet sinks reserved for v2. No actor/session attribution, no read-tracking, no trusted timestamps, no signing keys – all queued for v2.

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

  ### What's deferred (tracked in IDEAS.md)

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

### Minor Changes

- [`8b4af1d`](https://github.com/directive-run/directive/commit/8b4af1d521c547b3c137e2848512620a552d6db8) Thanks [@jasoncomes](https://github.com/jasoncomes)! - feat: devtools panel renders per-clause `whenExplain` tree

  The devtools floating panel now has a `Constraints` section that renders
  the per-clause ✓/✗ breakdown for every data-form `when` constraint, live,
  as evaluations fire. When `engine.explain()` would print:

  ```
  constraint transition
    ✗ phase = red
    ✗ elapsed >= 30  (actual: 20)
  ```

  …the panel now shows the same tree inline, color-coded (green for pass,
  red for fail), and updates in place on every re-evaluation.

  ```ts
  const trafficLight = createModule("traffic", {
    schema: { phase: t.string<"red" | "green">(), elapsed: t.number() },
    constraints: {
      transition: {
        // Data-form `when` – predicate, not function. Gives the panel
        // a structural tree to render.
        when: { phase: { $eq: "red" }, elapsed: { $gte: 30 } },
        require: { type: "TRANSITION" },
      },
    },
  });

  createSystem({
    module: trafficLight,
    plugins: [devtoolsPlugin({ panel: true, defaultOpen: true })],
  });
  ```

  The plumbing already existed: `evaluatePredicateExplained` returns
  `ClauseResult[]`, the `constraint.evaluate` observation event carries an
  optional `whenExplain?: ClauseResult[]` field, and the engine gates
  `explainWhen()` behind `hasPlugins()` so the per-clause walk only runs
  when something is listening. This release is the **visual panel
  renderer** that completes the loop.

  Function-form `when` constraints (no predicate tree available) render
  with the constraint id + active mark + a small "function-form when (no
  clause tree)" note – no clause tree, no surprise.

  Operators render with mathematical symbols (`=`, `≠`, `≥`, `∈`, …) and
  the failed clause includes the actual value (`(actual: 20)`) so the
  panel reads at a glance: _which clause is the blocker, and what value
  would unblock it?_

  Internals:

  - New `renderConstraintRow` export from `@directive-run/core/plugins`
    (internal-tagged, but available for custom panel layouts).
  - New `PanelRefs.constraintsSection` / `.constraintsBody` /
    `.constraintsCount` for downstream devtools consumers.
  - Time-travel jumps wipe the clause tree and let the next reconcile
    repopulate it (avoids stale ✓/✗ from before the snapshot).

## 1.9.0

### Minor Changes

- [`cc42608`](https://github.com/directive-run/directive/commit/cc42608e91b1da61f129035df50d0edef4173264) Thanks [@jasoncomes](https://github.com/jasoncomes)! - feat: predicate codegen – one predicate, three targets

  Compile a `FactPredicate` to parameterized SQL, a MongoDB query, or a
  PostgREST querystring. Same JSON spec, same semantics, three execution
  sites – the end of dual-write hell for filter logic.

  ```ts
  import {
    predicateToSQL,
    predicateToMongo,
    predicateToPostgrest,
    evaluatePredicate,
  } from "@directive-run/core";

  const adults = {
    age: { $gte: 18 },
    status: { $in: ["active", "pending"] },
  };

  evaluatePredicate(adults, user); // client (boolean)

  predicateToSQL(adults, { table: "users" });
  // → { sql: "SELECT * FROM users WHERE (age >= $1 AND status = ANY($2))",
  //     where: "(age >= $1 AND status = ANY($2))",
  //     params: [18, ["active", "pending"]] }

  predicateToMongo(adults);
  // → { age: { $gte: 18 }, status: { $in: ["active", "pending"] } }

  predicateToPostgrest(adults, { mode: "raw" });
  // → "age=gte.18&status=in.(active,pending)"
  ```

  **Safe by construction.** Operand values never appear in the SQL string
  – they always flow through the `params` array. Table and column
  identifiers are validated against a strict regex
  (`[A-Za-z_][A-Za-z0-9_]*`). LIKE wildcards (`%`, `_`) in
  `$startsWith` / `$endsWith` / `$contains` operands are escaped
  automatically with an explicit `ESCAPE '\'` clause for cross-database
  determinism. Effects-only operators (`$changed`) are rejected.

  **`$where` injection blocked on Mongo.** Field names starting with `$`
  are refused – closes the predicate-as-RCE class for AI-generated
  queries. Sub-document paths (`"user.role"`) require explicit
  `allowDottedPaths: true`.

  **Combinator-and-sibling-key rejection.** `{ $all: [aiPredicate],
tenant_id: req.user.id }` throws instead of silently dropping the
  tenant check – closes the cross-tenant data-leak attack class. Nest
  your conditions inside the combinator instead.

  **Depth limit.** All three codegens enforce the same 64-level recursion
  ceiling as `evaluatePredicate`, catching cyclic spec objects and DoS
  attempts.

  **Allowlisted keys** for AI/user-supplied predicates: pass `allowedKeys`
  to reject any predicate key that isn't on the list. Three layers of
  defense for LLM-emitted queries: type-system parse, allowlist check,
  sibling-key rejection.

  **Dialect support.** Default is Postgres-style `$1, $2` placeholders;
  pass `placeholder: () => "?"` for MySQL/SQLite. `predicateToWhere`
  returns just the WHERE clause body for embedding in
  UPDATE/DELETE/COUNT/JOIN.

  **$between is portable.** Decomposes to `$gte`+`$lte` in Mongo
  (`{ age: { $gte: 18, $lte: 65 } }`) and PostgREST
  (`age=gte.18&age=lte.65`), so a single predicate works across all three
  targets.

  What's not in v1 (deferred): JOINs (predicates describe rows, not
  relationships), Mongo array-of-objects `$elemMatch`, ReDoS pattern
  detection for `$matches` operands. See
  `docs/concepts/predicate-codegen.md`.

  Pairs with `@directive-run/query`, data-form predicates, LLM-emitted
  predicates, and edge-runtime predicates (Cloudflare Workers).

## 1.8.0

### Minor Changes

- [`a1b2230`](https://github.com/directive-run/directive/commit/a1b22305c90c7e96f159d3a4dde2d068ecd9aa9c) Thanks [@jasoncomes](https://github.com/jasoncomes)! - feat: structural rules diff (`diffRules` + `directive rules-diff`)

  Structural diff between two snapshots of a system's constraint
  whenSpec map – the "git diff for business rules" that operates on the
  predicate AST instead of source-text lines. Pairs with `replayUnder`
  for before-you-merge causal-impact review.

  ```ts
  import { diffRules } from "@directive-run/core";

  const report = diffRules({
    before: { blockCheckout: { cartTotal: { $gte: 100 } } },
    after: { blockCheckout: { cartTotal: { $gte: 50 } } },
  });

  report.constraints[0].changes[0];
  // { path: "cartTotal", kind: "relaxed",
  //   before: { op: "$gte", value: 100 },
  //   after:  { op: "$gte", value: 50 } }
  ```

  Walks both predicate trees in parallel, reports added/removed clauses
  with dotted paths, and classifies numeric-threshold changes as
  **relaxed** (matches more) or **tightened** (matches fewer) for
  `$gte`/`$gt`/`$lte`/`$lt`/`$between`/`$in`/`$nin`. Combinator-aware –
  `$all` / `$any` / `$not` children get indexed paths. Output is
  deterministically sorted for git-tracked snapshots.

  CLI: three output modes.

  ```
  directive rules-diff --before snapshot-old.json --after snapshot-new.json
  directive rules-diff --before ... --after ... --markdown   # GitHub PR comment
  directive rules-diff --before ... --after ... --json
  ```

  Either flat `{ id: whenSpec }` map or the `system.inspect().constraints`
  array form is accepted – the `toRulesMap` adapter normalizes both.

  What's not in v1 (deferred): reachability counting, combinator
  flattening, direct git-ref input (use `git show ref:path > file.json`
  in the meantime). See `docs/concepts/rules-diff.md`.

## 1.7.0

### Minor Changes

- [`fa51447`](https://github.com/directive-run/directive/commit/fa514479e397d1223aeb0e76b01fb88b9af29f49) Thanks [@jasoncomes](https://github.com/jasoncomes)! - feat: parameter sweep (`sweepUnder` + `directive tune`)

  `replayUnder` diffs _one_ proposed predicate against the original.
  `sweepUnder` is the grid-search counterpart: take a predicate template
  with one or more `{ $hole: "name" }` markers, sweep candidate values,
  return the whole response curve plus the argmax under a user-supplied
  objective.

  ```ts
  import { sweepUnder } from "@directive-run/core";

  const report = sweepUnder({
    frames: recordedSessions,
    original: { cartTotal: { $gte: 100 } },
    template: { cartTotal: { $gte: { $hole: "threshold" } } },
    sweep: { threshold: [25, 50, 100, 200] },
  });

  report.best.values; // { threshold: 25 }
  report.best.report.proposed.matched; // 9210
  report.baseline.score; // 4217 – original's matched count
  ```

  Multi-hole sweeps grid-search:

  ```ts
  sweepUnder({
    ...
    template: {
      $all: [
        { riskScore: { $gte: { $hole: "minRisk" } } },
        { age:       { $gte: { $hole: "minAge"  } } },
      ],
    },
    sweep: { minRisk: [0.5, 0.7, 0.9], minAge: [13, 18, 21] },
  });
  // → 9 points (3 × 3)
  ```

  `MAX_SWEEP_POINTS = 10,000` caps the grid so runaway sweeps throw at
  the start rather than at frame 100,000.

  The CLI wraps it:

  ```
  directive tune --history sessions.json --original current.json \
    --template proposed-template.json --sweep threshold:25..200:25
  ```

  Numeric range syntax `start..end:step` or discrete `key:val1,val2,val3`.
  The curve renders as an ASCII table with a per-row bar plus a one-line
  sparkline; the argmax row highlights green.

  Same caveats as `replayUnder` apply (no cascade modeling, survivorship
  bias, frames-vs-entities) – see `docs/concepts/tune.md`.

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

### Minor Changes

- [`94db2f4`](https://github.com/directive-run/directive/commit/94db2f4af0cee8f28ad27102ab246a87aa4a580c) Thanks [@jasoncomes](https://github.com/jasoncomes)! - fix + feat: hardening of `owns` (RFC-0003) and data-form predicates (RFC-0004)

  Hardening pass on the v1.5.0 `owns` and data-form predicate surface. The
  release pairs a headline bug fix – `owns` was silently broken in every
  multi-module system – with a handful of new public exports for
  observability and safety. Pure-function fixes; no breaking API changes
  against v1.5.0.

  **Critical bug fixes (visible in v1.5.0)**

  - `owns:` keys are now namespace-prefixed inside `prefixConstraints`. In
    v1.5.0 the entire RFC-0003 clobber-detection feature silently no-op'd
    in every multi-module system – a constraint owning `["status"]` in
    module `counter` kept `owns=["status"]` while resolver writes flowed
    as `"counter::status"`, so the proxy's ownership check missed every
    namespaced write.
  - `$changed` inside a constraint `when` now throws **unconditionally**
    at registration. v1.5.0 threw only in dev and silently mis-evaluated
    in production (collapsing to a defined-check via `prev=undefined`).
  - `$matches` now requires a `RegExp` operand and throws on a string
    operand. JSON-loaded predicates were a real ReDoS surface.
  - Every registered spec is now **deeply** frozen (was shallow), so
    post-registration mutation of a nested operand can't silently
    change the compiled closure.
  - Three predicate AST walkers (evaluatePredicate, validatePredicate,
    containsChangedOperator) are now depth- and cycle-guarded with
    `MAX_PREDICATE_DEPTH = 64`.
  - `evaluateKeySelector` typed-value collisions fixed – `stableStringify`
    now handles `bigint`, `Date`, `RegExp`, `Map`, `Set` with distinct
    prefixes (was producing `"{}"` for all).
  - `evaluateTemplate` now uses `Object.hasOwn` (was walking the
    prototype chain – `${toString}` returned the function source).
  - Facts proxy `getOwnPropertyDescriptor` now honours `BLOCKED_PROPS`
    consistently with the `get` trap.
  - Bound-facts intended-value staging fixed (the proxy now stores the
    resolver's intended value before `Reflect.set`, so a listener
    mutation during the write can't silently transfer ownership).
  - Sibling bound-resolver clobber gap fixed via a pre-dispatch
    `factsBaseline` snapshot threaded into `createBoundFacts`.
  - `validateOwnsKeys` rejects `BLOCKED_PROPS` / `$`-prefixed owns keys
    at registration. `self`, `prev`, `current` reserved as fact names.
  - `validatePivotNameConflicts` rejects same-named facts at
    registration (was a silent shadowing).

  **New public exports (additive)**

  - `validatePredicate(spec: unknown): void` – opt-in JSON-safety
    validator. Throws on non-RegExp `$matches`, `bigint`, `Set`, `Map`,
    or nested non-rehydratable operands. Call after `JSON.parse` of a
    persisted predicate.
  - `MAX_PREDICATE_DEPTH = 64` – exported so a caller designing a deep
    predicate can see the cap.
  - `resolver.write.rejected` observation event + `onResolverWriteRejected`
    plugin hook. Surfaces dropped owned-fact writes through the standard
    observation channel. Discriminated union on `kind`:
    ```ts
    | { type: "resolver.write.rejected"; kind: "rejection";
        resolver; requirementId; fact; expected; actual; reason: "clobbered" }
    | { type: "resolver.write.rejected"; kind: "summary";
        resolver; requirementId; dropped: number; reason: "clobbered" }
    ```
    Devtools and the logging plugin surface this event by default.
    Per-resolver-instance rate-limit caps per-write events at 10 and
    fires one summary event with the dropped count.

  **DX / docs**

  - Owner attribution on predicate throws: errors thrown from a
    constraint / effect / derivation predicate now identify the owning
    definition (`[Directive] constraint '<id>': ...`) and preserve the
    original error as `cause`.
  - Runtime-async-`when` warning is explicit about the runtime promotion
    case (your `when()` returned a Promise) and suggests three fixes.
  - Pivot-name conflict error lists three remediations (rename / drop
    from `crossModuleDeps` / wrap under a namespace).

  See `docs/rfcs/0003-resolver-constraint-binding.md`,
  `docs/rfcs/0004-data-configuration-triggers.md`, and
  `docs/upgrade-guides/constraint-binding.md` for the full reference.

- [`5717706`](https://github.com/directive-run/directive/commit/571770648302b3ac27a2ab6671660a0ed4710faf) Thanks [@jasoncomes](https://github.com/jasoncomes)! - feat: predicate backtest (`replayUnder` + `directive replay-under`)

  Replay a recorded fact-state history through a _proposed_ change to a
  constraint's `when` predicate and get a before-you-merge impact report:
  how many frames matched under the current rule, how many would match
  under the proposed one, and the exact frames that newly match or no
  longer match.

  ```ts
  import { replayUnder } from "@directive-run/core";

  const report = replayUnder({
    frames: recordedHistory, // [{ id, facts }, ...]
    original: { phase: "red" }, // the current `when`
    proposed: { phase: "red", elapsed: { $gte: 30 } }, // the proposed `when`
  });

  report.original.matched; // 4
  report.proposed.matched; // 2
  report.delta; // -2
  report.lostMatches; // sampled frames, with per-clause explain
  ```

  The mechanism is a static backtest – each recorded frame is re-scored
  against both predicates with `evaluatePredicate`, and the boolean is
  diffed. The engine is **not** re-run: downstream cascades are not
  modeled, so treat the numbers as a divergence scan, not a forecast. The
  previous frame's facts are threaded as `prev`, so a replayed effect `on`
  predicate using `$changed` replays correctly too. Diff frames carry an
  `evaluatePredicateExplained` breakdown so you can see which clause
  flipped.

  Both predicates are validated up front – a malformed spec throws a clear
  `[Directive] replayUnder:` error naming which spec failed. Histories are
  capped at `MAX_REPLAY_FRAMES`. Pass `entityKey` to also count distinct
  entities (not just frames). `framesFromHistory` / `framesFromSnapshots`
  convert a live system's recorded history into replay frames.

  The CLI wraps it:

  ```
  directive replay-under --history sessions.json \
    --original current-rule.json --proposed tightened-rule.json
  ```

  History JSON is accepted as a bare array of frames, an object with a
  `frames` array, a bare array of fact objects, or a `system.history.export()`
  file. `--entity-key` reports distinct-entity counts; `--json` emits the
  full `PredicateBacktestReport`.

  This builds directly on the RFC-0004 data-form predicate runtime – a
  predicate is data, so it can be re-evaluated against history a function
  `when` never could. See `docs/concepts/replay-under.md`.

## 1.5.0

### Minor Changes

- [`3bbf4d9`](https://github.com/directive-run/directive/commit/3bbf4d96fc880a5abb85a5055b44b35b97b7ef10) Thanks [@jasoncomes](https://github.com/jasoncomes)! - feat: data-form definitions (`FactPredicate`, `FactTemplate`)

  Every Directive definition can now express its trigger or matcher as a
  plain data object in addition to the function form. The function form
  is unchanged; the data form is purely additive.

  ```ts
  constraints: {
    transition: {
      when: { phase: "red", elapsed: { $gte: 30 } },   // NEW – was: (f) => …
      require: { type: "TRANSITION", to: "green" },
    },
  },
  effects: {
    ledOn: {
      on: { phase: "red" },                            // NEW – was: deps: [...]
      run: () => turnLedOn(),
    },
  },
  resolvers: {
    fetcher: {
      requirement: "FETCH",
      key: ["id"],                                     // NEW – was: (req) => req.id
      resolve: doFetch,
    },
  },
  events: {
    setStatus: {
      patch: {                                         // NEW – alongside handler
        $set: {
          status: { $ref: "value" },
          label:  { $template: "user ${name}" },
        },
      },
    },
  },
  derive: {
    isAdult:  { compute: { age: { $gte: 18 } } },                          // boolean
    fullName: { compute: { $template: "${firstName} ${lastName}" } },      // string
  },
  ```

  Operators: `$eq`, `$ne`, `$in`, `$nin`, `$exists`, `$gt`, `$gte`, `$lt`,
  `$lte`, `$between`, `$matches`, `$contains`, `$changed` (effects only).
  Combinators: `$all`, `$any`, `$not`. Nested predicates handle
  cross-module namespaced facts.

  The data form unlocks introspection that a function form cannot:

  - `system.inspect().constraints[]` exposes `whenSpec` – the original
    predicate object – for any consumer (devtools, custom inspectors).
  - The `constraint.evaluate` observation event carries `whenExplain` –
    a per-clause breakdown showing which clauses passed and which failed.
  - `system.explain(requirementId)` renders the clause tree:
    ```
    ├─ Predicate clauses:
    │  ├─ ✓ phase $eq red (actual: red)
    │  └─ ✗ elapsed $gte 30 (actual: 20)
    ```

  A data `when` is always sync, so the auto-tracking deps capture
  correctly without an explicit `deps` array. The function escape hatch
  remains on every surface.

  See `docs/rfcs/0004-data-configuration-triggers.md` and
  `docs/concepts/data-triggers.md` for the full reference.

- [`ff1121c`](https://github.com/directive-run/directive/commit/ff1121cc2be14fc13dff544a6e142bc2c5b55eff) Thanks [@jasoncomes](https://github.com/jasoncomes)! - feat: resolver constraint-binding (`owns`)

  Adds opt-in resolver constraint-binding (RFC-0003). A constraint can declare
  the facts its resolver _owns_; a write from that resolver to an owned fact is
  dropped – and the resolver aborted – if the fact was changed by anything else
  since the resolver last wrote it. Eliminates the executor-tail-clobber footgun
  (an in-flight resolver's tail overwriting a terminal status an event just set)
  without touching the resolver's other ("data") writes.

  ```ts
  constraints: {
    mutate: {
      when: (f) => f.status === "mutating",
      require: { type: "EXECUTE_ACTION" },
      owns: ["status"], // NEW – omit for no binding (default)
    },
  }
  ```

  Semantics:

  - Per owned fact, the binding remembers the value the resolver last wrote or
    started with. A write to an owned fact lands only if the fact still holds
    that value; otherwise it is dropped, `ctx.signal` is aborted, and that
    fact's ownership is lost (one-shot).
  - Writes to facts not listed in `owns` always land.
  - The constraint's `when()` predicate is never consulted by the binding.
    Sync constraints only – `owns` on an async constraint is ignored (the
    owned-fact snapshot would race the predicate await; dev-mode warning).
  - A bound resolver is **detached, not cancelled**, when its requirement is
    removed – it runs to completion so its data writes land (the binding drops
    only the owned-fact clobber), and the requirement can re-dispatch cleanly.
  - No-op for `callOne()` and mixed-source batch resolvers.

  This supersedes the `bind: 'auto'` constraint-binding from the reverted
  v1.4.0 release, which re-evaluated `when()` on every write – that was
  all-or-nothing (dropped legitimate data writes) and coupled to predicate
  shape (could freeze a resolver). Migrate `bind: 'auto'` →
  `owns: [<phase fact>]`. See `docs/upgrade-guides/constraint-binding.md`.

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

### Minor Changes

- [`08ac983`](https://github.com/directive-run/directive/commit/08ac9830ae062dbc61de66ca51c77e7049b0bd47) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add `SignalClock` + timer helpers (RFC 0001 v0.1)

  Covers declarative `after`, fake-timer integration, clock-in-derivation, and predicate-gated tick wiring in one shape.

  **New exports** (all from `@directive-run/core`):

  - `SignalClock` interface – injectable time source.
  - `realClock()` – production clock backed by `Date.now()` + `globalThis.setTimeout`.
  - `virtualClock(initialMs?)` – test clock; advance synchronously via `clock.advanceBy(ms)` to fire scheduled callbacks in deadline order.
  - `defaultClock()` – auto-detects vitest (`process.env.VITEST === 'true'`) and returns `virtualClock()` there, `realClock()` everywhere else.
  - `TimerFactState` interface – JSON-roundtrippable timer state (idle / running / paused / completed) suitable for storing inside any Directive fact.
  - `initialTimerState()`, `startTimer()`, `pauseTimer()`, `resumeTimer()`, `resetTimer()`, `completeTimer()`, `registerRepeat()` – pure transition helpers.
  - `elapsedMs()`, `remainingMs()`, `tickTimer()` – pure read helpers; `tickTimer` returns a structured signal (`'no-op' | 'complete' | 'repeat'`).
  - `timerOps({ms, mode})` – convenience bundle of all of the above closed over a single timer's options.

  **Scope:** v0.1 ships the value layer. The engine doesn't auto-tick timer facts yet – consumers wire a small `setInterval(() => sys.events.TICK(), 100)`. Engine-integrated `t.timer({ms})` schema is the v0.2 deliverable.

  **Replay determinism:** the clock is the only source of time in timer ops. Replaying through a `virtualClock` seeded from a recorded stream reproduces fact streams byte-for-byte. Pause durations survive dehydrate/hydrate intact.

  35 new tests (`clock.test.ts` ×14, `timer.test.ts` ×21).

  Docs: [`docs/api/timer.md`](https://github.com/directive-run/directive/blob/main/docs/api/timer.md).

### Patch Changes

- [`dcad00d`](https://github.com/directive-run/directive/commit/dcad00db373f7d77cffb9e3f7f971e40118b1d48) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Fix: `t.union<>()` declaration emit cycle

  The 1.2.0 release shipped `t.union<T>()` as a generic-only schema constructor. The runtime works correctly, but the declaration emitter hit a self-reference cycle when typing the `t` object – the overload-cast pattern (`(impl) as { ovl1; ovl2 }`) inside an object literal triggered:

  ```
  error TS7022: 't' implicitly has type 'any' because it does not have a
  type annotation and is referenced directly or indirectly in its own
  initializer.
  ```

  Downstream consumers running `tsc --noEmit` against `@directive-run/core@1.2.0` saw type errors. Hoist `unionImpl` to a typed top-level const (`unionImpl: UnionFn`) and reference it as `union: unionImpl` in the `t` object – runtime semantics unchanged, declaration emit walks cleanly.

  Caught when Minglingo's `apps/web` tried to consume `@directive-run/core/testing.flushAsync` – the JS dist built fine but the DTS build failed for the union exports, masking the entire testing surface from typed downstream usage.

## 1.1.2

### Patch Changes

- [`81da1e2`](https://github.com/directive-run/directive/commit/81da1e285e96f29f40451bcd2a05e61345f94487) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Bug fixes and added test coverage for the new features.

  **Core:**

  - Fix: `reconcile.end` observation event fields renamed to `resolversCompleted`/`resolversCanceled` (correct semantics)
  - Fix: Observer cap (100 max) prevents memory leaks from fast-remounting components
  - Fix: `hasPlugins` cached as boolean for O(1) hot-path access
  - Fix: Knowledge docs `inspect()` section rewritten with correct field names
  - Tests: added coverage for `system.observe()` and the coverage/observer utilities

  **Adapters (React, Vue, Svelte, Solid, Lit):**

  - All 5 framework adapters migrated to `#is-development` compile-time imports
  - Tests: added coverage for `createDirectiveContext` (useFact, useDerived, useEvents, Provider override, error boundary, useSystem)

## 1.1.1

### Patch Changes

- [`0561920`](https://github.com/directive-run/directive/commit/0561920b8096a69253f7a02ba5184842943bd2f8) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Performance: #is-development imports (+11-35% across all benchmarks) plus bug fixes

  - Replace 40 `process.env.NODE_ENV` checks with `#is-development` compile-time imports (XState pattern)
  - Fix: `system.observe()` now fires all events when no initial plugins configured (stale `hasPlugins` flag → live function)
  - Fix: `reconcile.end` event now correctly reports `added`/`removed` from ReconcileResult
  - Fix: `adapter-utils.ts` migrated to `isDevelopment` import
  - Fix: `CoverageReport` now includes `effectCoverage` and `derivationCoverage` percentages
  - Fix: SVG architecture diagram uses inline styles (GitHub CSP strips `<style>`)

  Benchmarks (vs previous release):

  - Minimal reconcile cycle: 34.9K → 47.2K ops/sec (+35%)
  - Single constraint: 47.3K → 57.1K ops/sec (+21%)
  - Fact write: 4.8M → 6.2M ops/sec (+27%)
  - Auth flow: 32K → 36.1K ops/sec (+13%)

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

### Patch Changes

- [`2c922f9`](https://github.com/directive-run/directive/commit/2c922f955e61a438bc9afa89f8e2d8c841ca77d0) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Performance optimizations: +36-95% faster derivations, +8-17% faster reconcile

  - Gate `validateValue` behind `__DEV__` – skip schema validation in production builds (+7-11% writes)
  - Eliminate TrackingContext object allocation – bare Set<string> dep stack (+50-112% derivation compute)
  - Skip plugin emit callbacks when no plugins registered (+14-16% reconcile)
  - Remove unused `unchanged` array from RequirementSet.diff() (+8-17% reconcile)
  - Short-circuit disabled constraint filter when disabled.size === 0
  - Remove TrackingContext interface (pre-launch cleanup – replaced with getCurrentDeps)

## 1.0.0

### Minor Changes

- [`a6a23b2`](https://github.com/directive-run/directive/commit/a6a23b2e52377a07bbbde52a89dcffcc3db2f826) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add DefinitionMeta – optional metadata for all 7 definition types

  **Core (`@directive-run/core`):**

  - `DefinitionMeta` type: label, description, category, color, tags, extensible index signature
  - `meta?` on modules, facts (via `t.number().meta()`), events (`{ handler, meta }`), constraints, resolvers, effects, derivations (`{ compute, meta }`)
  - `system.meta` O(1) accessor: module, fact, event, constraint, resolver, effect, derivation
  - `system.meta.byCategory()` and `system.meta.byTag()` bulk queries with `MetaMatch` return type
  - `system.inspect()` surfaces meta on all 7 definition types + modules array
  - `system.explain()` uses meta.label and meta.description in causal chains
  - Trace entries enriched with inline meta on all sub-arrays (factChanges, constraintsHit, resolversStarted, resolversCompleted, resolversErrored, effectsRun, derivationsRecomputed)
  - All meta frozen at registration via Object.create(null) + Object.freeze (prototype pollution defense)
  - Devtools graph renders meta.label for node labels, meta.color for node colors, meta.description as SVG tooltips

  **AI (`@directive-run/ai`):**

  - `formatSystemMeta(inspection)` – formats SystemInspection into LLM-readable markdown context
  - `toAIContext(system)` – convenience wrapper
  - `metaContext: true` option on both single-agent and multi-agent orchestrators
  - Token-efficient: only includes annotated definitions, omits empty sections

## 0.8.9

### Patch Changes

- [`a4adaca`](https://github.com/directive-run/directive/commit/a4adaca26a2536e052b15b737e6e940f68449f14) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add head-to-head benchmark suite comparing Directive against Zustand, Redux Toolkit, MobX, Jotai, Preact Signals, and XState

  - 11 comparison scenarios: single read/write, 1K cycles, derived values, batch writes, 10K throughput, multi-key read, alternating R/W, 3 derived values, subscribe+notify, store creation
  - 7 adapter modules wrapping each library into a common BenchAdapter interface
  - Run with `pnpm bench`

## 0.8.8

### Patch Changes

- [`d8f7341`](https://github.com/directive-run/directive/commit/d8f73411fac1cae004e7532600a4ef892938d451) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Performance optimizations: 3.1x faster reads, 97x faster reconcile

  - Hoist `__DEV__` const – prevents V8 JIT deopt in proxy get trap (fact reads 6.1M -> 18.9M ops/sec)
  - Fast-path `trackAccess` – skip when no tracking context active (+25% on reads)
  - Reorder proxy get trap – symbols first for React probe elimination
  - Replace `setTimeout(0)` with `queueMicrotask` in settle() – reconcile cycles 813 -> 18,780 ops/sec
  - Skip `withTracking` for derivations with stable deps – benefits multi-component renders
  - Guard `onCompute` allocation – eliminates array spread when no plugin listens
  - Add benchmark suite (15 benchmarks across 10 categories)

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

## 0.8.3

### Patch Changes

- [`634c825`](https://github.com/directive-run/directive/commit/634c825d6daf22836b07df5713a949f036422222) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Fixed resolver facts proxy in multi-module systems to use the same scoped proxy as constraints/derive/effects. Previously, resolvers received a two-level namespace proxy (`facts.moduleName.key`) instead of the flat module-scoped proxy (`facts.key`), causing silent failures when writing facts. Also fixed batch resolver proxy wrapping (`resolveBatch`/`resolveBatchWithResults`) and added recovery for stuck requirements after reconcile max-depth bailout.

## 0.8.2

### Patch Changes

- [`5257894`](https://github.com/directive-run/directive/commit/52578949f868d5c17aec80f30c13f0391bac56c2) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Refactor system internals and fix proxy hardening gaps.

  - Extract proxy factories and module transformation into dedicated modules for maintainability
  - Fix tickMs dispatching only searching first module instead of all modules
  - Harden single-module events proxy with missing security traps (has, deleteProperty, ownKeys)
  - Replace O(n) array lookup with O(1) Set check in topological sort

## 0.8.1

## 0.8.0

### Minor Changes

- ### Features

  - Dev-mode nested mutation detection in facts store
  - Docs-artifacts CI job with knowledge bundling

  ### Refactors

  - Extract engine subsystems (accessors, definitions, trace) and deduplicate system.ts

  ### Chores

  - Update docs references for standalone directive-docs repo
  - Website extraction cleanup

## 0.7.0

### Minor Changes

- [`72ed25c`](https://github.com/directive-run/directive/commit/72ed25c1a6b00019a3f6e9e119de85d5107a5676) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add type-safe runtime dynamics for dynamic definition APIs.
  - Add `DynamicConstraintDef`, `DynamicEffectDef`, `DynamicResolverDef` types for typed `register()` and `assign()` callbacks
  - Parameterize `ConstraintsControl`, `EffectsControl`, `DerivationsControl`, `ResolversControl` on module schema – dynamic definition callbacks now receive typed `facts` with autocomplete
  - Add generic `call<T>()` on `DerivationsControl` for typed derivation return values
  - Thread type params through `System<M>` and `SingleModuleSystem<S>`

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

### Minor Changes

- [`7229881`](https://github.com/directive-run/directive/commit/72298811032bbaf988bf8c200cc8ba481f0132f7) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add dynamic runtime definitions, harden security, and refactor internals.

  **Features**

  - Add `register()`, `assign()`, `getOriginal()`, `restoreOriginal()` for constraints, resolvers, derivations, and effects at runtime
  - Add `DerivationsControl` type for dynamic definition methods on `system.derive`
  - Add `read()` overload for fact keys on `SingleModuleSystem`

  **Fixes**

  - Fix command injection vulnerability in CLI `graph` command (`exec` → `execFile`)
  - Reject schema keys starting with `$` to prevent internal collision
  - Prefix all testing assertion errors with `[Directive]`
  - Harden all 11 proxies with `defineProperty`, `getPrototypeOf`, `setPrototypeOf` traps

  **Improvements**

  - Extract shared adapter utilities (SSE parsing, hooks, error handling) in AI package
  - Split orchestrator into pattern-composition, pattern-factories, pattern-serialization
  - Split `facts.ts` into `schema-builders.ts` + facts store
  - Consolidate `BLOCKED_PROPS` to single export in `tracking.ts`
  - Remove 7 internal builder types from public exports

  **BREAKING:** `constraintFactory` renamed to `createConstraintFactory`, `resolverFactory` renamed to `createResolverFactory`

### Patch Changes

- [`02ee740`](https://github.com/directive-run/directive/commit/02ee7409536a59dd6492576252070127184dcca5) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Performance and correctness improvements to the core runtime.

  **Performance**

  - Convert recursive `invalidateDerivation` to iterative work queue (prevents stack overflow on 50+ deep derivation chains)
  - Effects auto-tracking stability optimization (skips `withTracking` overhead after 3 consecutive stable runs)
  - Resolver cache uses LRU eviction instead of FIFO (recently-used entries no longer evicted at capacity)
  - Conditional topo sort rebuild in constraints (skips full graph traversal when registering constraints without `after` deps)

  **Fixes**

  - Add `destroy()` to FactsStore – clears all listeners on system destroy (prevents memory leaks)
  - Add `setPrototypeOf` trap to all 13 proxies for consistent prototype pollution protection
  - Share visited Set across `invalidateMany` calls for correct deduplication
  - Reset effects dependency stability on errors and `runAll()`
  - Re-entrance guard on `engine.destroy()`

## 0.4.2

### Patch Changes

- [`4a0ca9d`](https://github.com/directive-run/directive/commit/4a0ca9d9ce710da4215b6d66f7dd1228187b0960) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Fix overly restrictive object schema type and update knowledge content.
  - Loosen `t.object<T>()` generic constraint to accept any type, not just `Record<string, unknown>`
  - Update AI docs, core docs, and all example files in knowledge package

## 0.4.1

### Patch Changes

- [`73a604e`](https://github.com/directive-run/directive/commit/73a604e68f86f785f413fbfb9314f9fac90fef2a) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Enforce stricter lint rules and add CLI + knowledge packages.

  **Features**

  - Add `@directive-run/cli` with `ai-rules init` command for installing AI coding rules across editors (Claude, Cursor, Copilot, Cline, Windsurf)
  - Add `@directive-run/knowledge` for extracting structured knowledge from Directive packages

  **Improvements**

  - Promote 8 Biome lint rules from warn to error: `noUnusedTemplateLiteral`, `useLiteralKeys`, `useExponentiationOperator`, `useConst`, `noUselessElse`, `noConfusingVoidType`, `noCommaOperator`, `noDelete`
  - Auto-fix all lint violations across source files (no API changes)

## 0.4.0

### Minor Changes

- [`ed2475d`](https://github.com/directive-run/directive/commit/ed2475d4b01e87e198fe87d1f846abe19e8ce3ff) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add tasks system, supervisor resilience, and enriched debug timeline to the AI orchestrator. Consolidate error handling and harden resolvers in core. Simplify DevTools with rewritten session panel and removed dead views. Fix memory message deduplication in multi-agent orchestrator.

## 0.3.0

### Minor Changes

- [`b418d25`](https://github.com/directive-run/directive/commit/b418d259eb663bd79c769b89a5069e4a10ed160c) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add run history, constraint disable API, and DevTools overhaul with graph visualization, panel UI, and AI bridge. Rewrite AI package with modular orchestrator architecture, multi-agent orchestrator, evals framework, OTEL tracing, breakpoints, checkpoints, health monitoring, reflection patterns, and Gemini adapter. Add full DevTools React UI with timeline, DAG, flamechart, compare, replay, and anomaly detection views.

## 0.2.0

### Minor Changes

- [`7e3e3ed`](https://github.com/directive-run/directive/commit/7e3e3ed20754c1b605596d1f7a2969590af73f7c) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add `snapshotEvents` option to `createModule` for controlling which events create time-travel snapshots. Add optional equality function parameter to `useSelector` across all framework adapters. Remove deprecated `bus`, `obs`, `multi`, and `costRatePerMillion` aliases from `createAgentStack`.
