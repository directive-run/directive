# @directive-run/core

## 1.23.0

### Minor Changes

- [`7fe108a`](https://github.com/directive-run/directive/commit/7fe108a430ad58b76dc737ab2a5dc5731047085f) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add `clobberLoopPlugin` — detects sustained clobber loops on a fact and emits a structured warning naming the participants, the clauses that co-fire, and the suggested fix. A single clobber on an `abortOn:`-bound fact is a benign race that the binding already catches and the audit ledger records. A _loop_ is two or more resolvers whose `when:` predicates both satisfy a shared state and keep rewriting the fact every reconcile tick — invisible until a customer screenshots a flapping value, even though the audit ledger holds 800 clobbers/sec of evidence.

  Defaults: 5 distinct-requirement rejections from 2+ resolvers within 1s fires one `resolver.clobber.loop.detected` event. The event carries a `PredicateOverlapProof` built from `flattenPredicate` + `compareClauses` (existing internals from `doctor`) so the warning points at the specific `whenSpec` clauses that co-fire — not just "these resolvers fight." Operands are PII-redacted at event-construction time via the audit-ledger's `redactWhenSpec` against `system.meta.byTag("pii")`; opt out via `capturePII: true`.

  Production default sink is `console.error` to stderr (NOT noop), so the signal lands in CloudWatch / Loki / Datadog log pipelines even when consumers haven't explicitly wired routing. Dev defaults to `console.warn`. The plugin returns a `{ plugin, disable, enable, isEnabled }` handle so SREs can flip the detector off during incident response without redeploying. A companion `resolver.clobber.loop.resolved` event fires when the loop quiets, so monitoring shows "active loops" rather than "historical loops."

  Audit-ledger captures both `resolver.clobber.loop.detected` and `resolver.clobber.loop.resolved` entries with cross-references (`rejectionSeqs`) back to the contributing `resolver.write.rejected` entries, so an auditor reading a loop entry can walk to every individual rejection.

  Add reason-aware `RetryPolicy.shouldRetry`. The existing two-argument signature continues to work; an optional third `context` argument carries `{ reason: "clobbered" | "timeout" | "cancelled" | "error", clobber? }` so a retry policy can decide based on WHY the attempt failed. The motivating case: "retry on race-loss, fail loud on bug." Before this change, a clobber-induced abort never reached `shouldRetry` at all — the controller's aborted signal short-circuited the retry path silently. Now a resolver can express `shouldRetry: (err, n, ctx) => ctx?.reason === "clobbered" && n < 5` to opt into bounded retries on contention while still failing loud on real errors.

## 1.22.0

### Minor Changes

- [`d85fa45`](https://github.com/directive-run/directive/commit/d85fa4569e6fcf7a15be0f896dfe2aaf3b226ccc) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Rename constraint-binding API from `owns:` to `abortOn:`.

  The constraint-binding field — the per-fact compare-and-swap that drops a
  resolver's writes when listed facts mutate mid-flight — was named `owns:`.
  Reading `owns: ['kyc.status']` suggested the resolver asserts ownership of
  `kyc.status`. The runtime enforces the opposite: the resolver **yields**
  when `kyc.status` changes during dispatch.

  `abortOn:` reads correctly: "this resolver aborts on changes to these
  facts." Same semantics, clearer name, same audit-event payload (the
  `resolver.write.rejected { reason: "clobbered" }` event is unchanged — no
  Grafana / Splunk query updates needed).

  **Before:**

  ```ts
  constraints: {
    finalizeKyc: {
      when: (f) => f.kyc.status === 'pending',
      require: { type: 'FINALIZE_KYC' },
      owns: ['kyc.status'],
    },
  },
  ```

  **After:**

  ```ts
  constraints: {
    finalizeKyc: {
      when: (f) => f.kyc.status === 'pending',
      require: { type: 'FINALIZE_KYC' },
      abortOn: ['kyc.status'],
    },
  },
  ```

  **Also renamed for consistency:**

  - `doctor.checkOwns()` → `doctor.checkAbortOn()`
  - `CheckOwnsResult` / `CheckOwnsFinding` types → `CheckAbortOnResult` /
    `CheckAbortOnFinding`
  - `DoctorConstraintOwnsConflict` interface → `DoctorConstraintAbortOnConflict`
  - The `source: "owns"` discriminant on doctor findings → `source: "abortOn"`
  - `system.inspect().constraints[].owns` → `system.inspect().constraints[].abortOn`

  **Migration:** mechanical replacement. The semantics, audit event, runtime
  gate, and snapshot model are all unchanged. Scope the rename to constraint
  config blocks — `owns` as an English word in unrelated prose is fine.

- [`cb05d88`](https://github.com/directive-run/directive/commit/cb05d88f5c01e30bc4bf7e69903a0f8f3be26664) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Follow-ons to the v1.22.0 `owns:` → `abortOn:` rename: verb-consistent
  abort lifecycle, defensive `bind:` validator, SIEM event for
  async-disabled bindings, new `clobberAlertPlugin`.

  **Verb-consistent abort lifecycle.** Three surfaces, one verb:

  - `abortOn:` — declarative on the constraint
  - `ctx.signal` — `AbortSignal` on the resolver context (Web Platform)
  - `resolversManager.abort()` / `resolversManager.abortAll()` — renamed
    from `cancel()` / `cancelAll()` so the imperative method pairs with
    `AbortController.abort()`

  `ResolversManager` is `@internal`, so the rename is not a public-API
  break — only adapter authors hitting the internal manager will see the
  new names.

  **`validateBindKeys` defensive parity for the `bind:` v2 reservation.**
  A new module-registration validator (mirroring `validateAbortOnKeys`)
  rejects `__proto__`, `constructor`, `prototype`, and `$`-prefixed entries
  on the `bind:` field. `bind:` has no runtime semantics yet — the
  validator ships now so the reserved-key bypass surface stays closed
  before any v2 runtime wires the field.

  **SIEM-facing observation event for async-disabled bindings.** The
  engine now emits a new `constraint.binding.disabled` observation event
  (and `onConstraintBindingDisabled(id, reason)` plugin hook) when it
  silently disables a constraint's `abortOn:` because the constraint is
  async:

  - `reason: "async-declared"` — the constraint def has `async: true`
  - `reason: "async-promoted"` — `when()` returned a Promise at runtime
    (the author probably didn't realize they opted out of clobber
    protection)

  The dev-mode `console.warn` is unchanged — this is the machine-facing
  pair so production plugins can detect a constraint silently losing its
  clobber protection.

  **New `clobberAlertPlugin`** (under `@directive-run/core/plugins`).
  Default high-severity alerting for `resolver.write.rejected` events
  landing on facts that carry irreversible meta tags. Replace the default
  `console.error` with a PagerDuty / Slack / Sentry call:

  ```ts
  createSystem({
    module: m,
    plugins: [
      clobberAlertPlugin({
        irreversibleTags: ["money", "pii", "irreversible"], // default
        // Or list resolver IDs when irreversibility lives on the resolver
        // rather than on a fact tag:
        irreversibleResolvers: ["stripeCharge"],
        onAlert: (e) =>
          pagerduty.trigger({
            severity: "critical",
            summary: `Clobber on ${e.fact} (${e.tags.join(", ")})`,
            details: e,
          }),
      }),
    ],
  });
  ```

  Reads `system.meta.fact(name)?.tags` to filter; either filter (tag or
  resolver) firing triggers the alert. Cooldown keys by `(fact, resolver)`
  pair so two different resolvers racing on the same fact both alert (a
  real incident) while a single resolver retrying the same fact (noise)
  is suppressed. A throwing `onAlert` callback is caught and surfaced via
  `console.error` so it never breaks the resolver dispatch path.

  **Future v2 `AbortDetector` interface naming.** The RFC's
  "Single-process scope" section previously called the planned
  multi-process interface `ClobberDetector`. Renamed to `AbortDetector`
  in the RFC text before v2 ships, so the v2 interface name is
  verb-consistent with `abortOn:` from day one. No runtime change — the
  interface doesn't exist yet.

### Patch Changes

- [`b7ce8a9`](https://github.com/directive-run/directive/commit/b7ce8a99f97d73e98348610bfb1685ec1c765026) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Stop `constraint.binding.disabled` from flooding observers on hot
  async constraints, and preserve `clobberAlertPlugin` telemetry past
  the per-resolver rate-limit cap with a new `onSummary` callback.

  **`constraint.binding.disabled` is now deduped per (constraint, reason).**
  The event (and its companion dev-mode `console.warn`) fires at most
  once per (constraint id, reason) pair across the lifetime of the
  registered constraint. A hot async-disabled constraint that dispatches
  thousands of times per second produces exactly one event per reason,
  so SIEM and log streams cannot be flooded by the binding-disabled
  signal. The bit clears on `unregister()` so re-registering a
  constraint resets the once-per-lifetime contract.

  **New `onSummary` callback on `clobberAlertPlugin`.** When the engine's
  per-resolver clobber rate-limit folds the 11th+ per-write event into a
  single `kind: "summary"` event, `onSummary` now surfaces it — but only
  when the resolver is in `irreversibleResolvers` OR has previously
  fired `onAlert` in this session. That preserves SIEM telemetry on
  resolvers that have proven they touch irreversible state, without
  flooding on noise resolvers whose summary events are expected.

  ```ts
  clobberAlertPlugin({
    irreversibleResolvers: ["chargeCard"],
    onAlert: (e) => pagerduty.trigger({ ... }),
    // NEW: also page when N>10 clobbers fold into one summary.
    onSummary: (e) => pagerduty.trigger({
      severity: "critical",
      summary: `${e.resolver} suppressed ${e.dropped} clobbers past the cap`,
      details: e,
    }),
  });
  ```

  `ClobberSummaryEvent` carries `resolver`, `requirementId`, `dropped`,
  `matchedBy: "resolver-listed" | "prior-irreversible-alert"`, and
  `timestamp`. A throwing `onSummary` callback is caught and surfaced
  via `console.error` so it never breaks the resolver dispatch path —
  parity with the existing `onAlert` error isolation.

  Tests: 5360 → 5365 across the monorepo (+5: dedupe across many
  dispatches, three `onSummary` paths, one `onSummary`-throws path).

- [`d39a9c6`](https://github.com/directive-run/directive/commit/d39a9c61ffcb2e89ee369042e3030cbd4d1096be) Thanks [@jasoncomes](https://github.com/jasoncomes)! - `clobberAlertPlugin` refinements: optional `irreversibleResolvers`
  filter, `matchedBy` discriminator on the event payload, cooldown keys
  by (fact, resolver), error-isolated `onAlert`, bounded cooldown map.

  - **`irreversibleResolvers` option** — when irreversibility is modeled on
    the resolver (e.g. `stripeCharge`) rather than as a fact-meta tag, list
    the resolver ID in `irreversibleResolvers`. The plugin OR's the two
    filters. The JSDoc on `irreversibleTags` now explains _why_ tagging the
    fact is the default modeling choice (the audit event names the fact,
    not the side effect).
  - **`matchedBy: "tag" | "resolver" | "both"`** added to `ClobberAlertEvent`
    so consumers can route alerts based on which filter triggered them.
    `tags` may now be empty when only the resolver filter matched.
  - **Cooldown keys by `(fact, resolver)`** — two different resolvers
    racing on the same fact within the cooldown window now both alert
    (a real incident) while a single resolver retrying the same fact
    (noise) is suppressed.
  - **`onAlert` error isolation** — a throwing `onAlert` callback (PagerDuty
    503, Slack rate limit, etc.) is caught and surfaced via `console.error`
    so it never breaks the resolver dispatch path. The cooldown slot is
    stamped only after the callback succeeds, so a transient outage does
    not silence the next genuine alert.
  - **Bounded cooldown map** — entries cap at 1000 with FIFO eviction so a
    long-running system with high resolver churn cannot grow memory
    unboundedly.

  Plus a clearer dev-mode warning for declared-async constraints
  (`async: true`) explaining the workarounds. Symmetric with the existing
  runtime-promoted-async advice.

  Adds 6 new tests covering the new filter, error isolation, `matchedBy`
  discriminator, retry-after-throw, and the FIFO cap.

## 1.21.0

### Minor Changes

- [`dab3537`](https://github.com/directive-run/directive/commit/dab35376019c715066d5127b4ffce7d10729b9f4) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Two follow-on hardenings.

  ## core: per-source teardown timeout is now configurable per source

  `SourcesManager.cleanupAllAsync` and `evictAll` previously applied a single 5-second cap to every source. Long-tail transports that legitimately need more time to drain (a Supabase channel flushing a backlog before close, an OpenTelemetry batch span exporter draining its queue, a Cloudflare DO storage flush awaiting a D1 commit) hit the cap and reported a hang even when the underlying work was healthy.

  `SourceDef` now accepts an optional `evictTimeoutMs?: number` override. Sources keep the 5s default unless they declare a different ceiling — adjacent sources are unaffected. Pass `Infinity` to disable the cap for that source only (the manager skips the timer wiring entirely so Node doesn't emit a `TimeoutOverflowWarning`).

  ```ts
  sources: {
    supabase: sourceFromSupabaseChannel({
      // Default 5s would clip the backlog drain. Give the channel
      // up to 15s to acknowledge the unsubscribe.
      evictTimeoutMs: 15_000,
      // ...rest of the source config
    }),
  }
  ```

  The package-wide default is exported as `DEFAULT_PER_SOURCE_TIMEOUT_MS` for consumers who want to derive their own ceiling.

  ## ai: `FactPIIErrorMode` joins its sibling in the barrel

  The `errorMode` option on `createFactPIIGuardrail` accepts a `FactPIIErrorMode` union. The type was internal-only — the sister type `FactPIIGuardrailMode` was already exported. Consumers writing the option's type annotation had to deep-import from `@directive-run/ai/guardrails/fact-pii.js`. `FactPIIErrorMode` is now re-exported from both `@directive-run/ai` and `@directive-run/ai/guardrails`.

- [`0c2d306`](https://github.com/directive-run/directive/commit/0c2d30637d854098286980309a00f2152c9997d4) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Pair every `source.publish` with a new `source.drop` observation event so plugin observers see both halves of the publish path without polling `inspect().sources[i].dropCount`.

  - New `Plugin.onSourceDrop(id, moduleId, eventName, reason)` hook fires whenever the engine OR the manager rejects a publish.
  - New `system.observe()` `source.drop` ObservationEvent variant carries the same payload.
  - New `SourceDropReason` type (exported from the public surface) is the shared union the inspect row, the plugin hook, and the observation event all reference, so the three surfaces cannot drift.
  - `reason` mirrors `SourceInspectionRow.lastDropReason`:
    - `"post-destroy"` / `"post-stop"` — leaked transport firing after teardown
    - `"blocked-event-name"` / `"invalid-event-name"` — engine guard probe
    - `"coalesced"` — manager debounced a same-event publish within one microtask

  The existing `onSourcePublish` semantics are unchanged — accepted publishes still fire there, drops fire only on `onSourceDrop`.

### Patch Changes

- [`3b4d36b`](https://github.com/directive-run/directive/commit/3b4d36b032289eccd426d65a9e2f0439521fcab8) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Two follow-on defensive fixes.

  ## core: batch-resolver cancellation handles requirements that span multiple in-flight batches

  The reverse index from requirement id → owning batch was a `Map<string, string>` — when two batch resolver definitions ended up processing the same requirement instance concurrently (rare, but legal in the type system), the second registration silently overwrote the first. Cancelling the requirement aborted the most recently registered batch only; the other ran to completion despite the explicit cancel.

  The index is now `Map<string, Set<string>>`. A requirement that participates in N batches at once tracks all N owners; cancelling iterates the snapshot and aborts every batch. The unwind path mirrors the change so the `Set` collapses cleanly per batch and the requirement is removed from the index only when the last owner releases it. All-or-nothing batch semantics are preserved within each batch.

  ## ai: self-healing fallback respects the orchestrator's token budget

  `applySelfHealingFallback` calls the user-supplied `runner` (and any `fallbackRunners`) directly. With `budgetEstimateTokens` configured, the primary path reserved tokens against `maxTokenBudget` via `runAgentWithGuardrails`'s pre-flight check — but every fallback call entered the runner without that reservation. A primary failure CAUSED by budget pressure would then drive the fallback into the same overshoot the pre-flight existed to prevent.

  The new `withFallbackBudgetReservation` wrapper reserves tokens against the running `inFlightReservation`, runs the fallback work, and releases the reservation in `finally`. When `budgetEstimateTokens` is undefined (default) the reservation is 0 and the wrapper is a no-op — strict back-compat for consumers that haven't adopted the new option.

- [`0444f55`](https://github.com/directive-run/directive/commit/0444f557f068d6d22fd921fe0eac21c99cca766c) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Convergence release closing HIGH + MAJOR issues from the prior fix batch.

  ## sandbox — post-acquisition signal wiring + sanitizeStack export + expanded coverage

  **Post-acquisition AbortSignal wiring.** The previous release plumbed `signal` only through the `acquireSlot` queue wait. After the slot acquired, the signal was dropped — a client that disconnected mid-execution still tied up the slot for the full `timeoutMs` (up to 10 s). Now the signal also fires `worker.terminate()` on the running worker so the slot frees immediately. The docstring's "released immediately on disconnect" contract is now accurate end-to-end.

  **`sanitizeStack` is now a public export.** Consumers building custom error-routing (Sentry integrations, audit-log middleware) previously couldn't strip host filesystem paths from `SandboxResult.errors[]` before logging. The function is now exported from `@directive-run/sandbox` directly:

  ```ts
  import { sanitizeStack } from "@directive-run/sandbox";
  logger.error(sanitizeStack(result.errors.join("\n")));
  ```

  **Extended path coverage.** The sanitizer now strips `/app/` (Heroku/Render/Docker), `/srv/` (Linux deploy), `/workspace/` (Codespaces/GitHub Actions), `/data/` (volume mounts), `/etc/` (configs), and `/root/` (root home) on top of the POSIX + Windows + UNC patterns. 7 new regression tests.

  **`@example` block** added to `setMaxConcurrentWorkers`.

  ## core — `SourceDropReason` adoption completion

  Two inline copies of the drop-reason union survived the previous round:

  - `SystemInspection.sources[i].lastDropReason` (`types/system.ts`)
  - `SourceDispatchResult.reason` (`core/sources.ts`)

  Both now reference `SourceDropReason`. The four surfaces that report drops (inspect row, plugin hook, plugin manager emit, observation event) are finally unified — a new reason added to the shared type now propagates everywhere at compile time.

  ## lit — deprecated aliases as function wrappers

  `export const createModule = createModuleController` and `export const useHistory = getHistory` swallowed the `@deprecated` JSDoc strikethrough in older VS Code, Vim+coc, and JetBrains < 2024.1. Both aliases are now thin function wrappers so the deprecation marker renders in every TS-aware editor.

  ## mcp — full JSDoc on `setMaxConcurrentLintWorkers`

  The MCP cap setter's JSDoc was a 3-line summary; the sandbox sister had the full WHY (per-worker heap cost, multi-client burst scenario, `Infinity` to disable). Brought them to parity with an `@example` block.

## 1.20.2

### Patch Changes

- [#76](https://github.com/directive-run/directive/pull/76) [`8577c06`](https://github.com/directive-run/directive/commit/8577c06131385983321d2297cff1751e53baec3b) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Hardening batch closing audit findings on top of the v1.20.x release.

  `@directive-run/core` (patch):

  - **`system.notify.guardrailBlocked` plugin-name validation.** The R18
    Tier 2-A RFC 0010 surface accepted any `plugin` string. A third-party
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

  - **Dev-mode `console.warn` on `destroyAsync` rejection.** The R18
    Tier 2-B fire-and-forget `.catch(() => {})` silently swallowed every
    unmount-time unsubscribe error. Operators had zero signal when a
    Supabase channel `removeChannel()` rejected. The catch now logs in
    development (`isDevelopment === true`); production behavior is
    unchanged (the manager's `phase: "runtime"` observability sink
    still receives the per-source error).

  Closes the critical findings 1, 2, 5 and Major findings 1, 3, 4 (Sec
  lens) + 3, 5, 8 (Arch lens). Bigger Tier 2 items deferred to RFCs:
  Supabase channel-name reuse race, `attachGuardrailsToOtel` helper,
  timeline `guardrail.blocked` renderer, knowledge-bundle docs sync.

## 1.20.1

## 1.20.0

### Minor Changes

- [#73](https://github.com/directive-run/directive/pull/73) [`633e9a2`](https://github.com/directive-run/directive/commit/633e9a2bc19ee4450215b2ddc61d22590fd1d9d8) Thanks [@jasoncomes](https://github.com/jasoncomes)! - RFC 0010 — `guardrail.blocked` ObservationEvent + `system.notify` surface.

  `@directive-run/core` (minor — additive public API):

  - New `ObservationEvent` variant `"guardrail.blocked"` with `plugin`,
    `key`, `kind` (`"redact" | "alert" | "detect"`), `count`, optional
    `category`.
  - New `Plugin.onGuardrailBlocked` hook.
  - New `PluginManager.emitGuardrailBlocked` broadcast.
  - New `System.notify.guardrailBlocked(...)` surface — plugin authoring
    API that fans out to every plugin's `onGuardrailBlocked` hook
    (including the synthetic plugin that backs `system.observe()`).
  - Synthetic observe plugin maps the hook to the typed event.

  `@directive-run/ai` (patch — feature add):

  - `createFactPIIGuardrail` calls `system.notify.guardrailBlocked` on
    every detection, in addition to the existing `onBlocked` callback.
    The `kind` field reports `"redact"` (rewrote via follow-up write),
    `"alert"` (configured mode), or `"detect"` (read-only structured
    type like `Error` — the walker matched but cannot construct a new
    instance with guaranteed `stack` parity).

  Backend wiring (`attachSourcesToOtel`, `@directive-run/timeline`,
  audit-ledger) is consumer-driven via `system.observe()` and is
  deferred to follow-up patches.

  Closes the work.

### Patch Changes

- [#71](https://github.com/directive-run/directive/pull/71) [`f0b8d77`](https://github.com/directive-run/directive/commit/f0b8d77c0bb415c0a6fe49c5f315c3be60bf6dd5) Thanks [@jasoncomes](https://github.com/jasoncomes)! - `system.evict()` reentry gate (RFC 0009 follow-up):

  The engine now sets `state.isEvicting` BEFORE awaiting any async eviction
  work. Concurrent or repeat `system.evict()` calls observe the flag and
  become no-ops past the first. Without the gate, Cloudflare DO hibernation
  paths that signal eviction twice would re-run every source's `onEvict`
  handler — sources with non-idempotent eviction (e.g. one that posts a
  "going away" message to a broker) would double-fire.

  The gate is set-once / never-cleared (eviction is terminal); a subsequent
  `system.evict()` after the first completes is a no-op, matching the
  contract of `system.destroyAsync()`.

  `coalesce: "all"` is left as-is — the JSDoc already documents that `"all"`
  is a no-op equivalent to `"none"` ("names the intent for readers"), so
  the previous R18 finding of "type-system lie" is closed by the existing
  docs. The RFC index's open follow-up entry for `coalesce: "all"` is
  withdrawn.

## 1.19.7

## 1.19.6

## 1.19.5

## 1.19.4

## 1.19.3

## 1.19.2

### Patch Changes

- [#59](https://github.com/directive-run/directive/pull/59) [`f387316`](https://github.com/directive-run/directive/commit/f387316e5ab146b8ddd1a5eeee5d0fb8cb2ce57f) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Hardening batch — walker Proxy / cycle / NaN defenses + emitInit cascading registration + MCP recipe enforcement

  A follow-up audit against v1.19.1 surfaced three new Proxy-based attack chains in the walker that the prior array-snapshot fix introduced (each patch round opens a slightly different bypass; this round trades narrower fixes for an architectural rewrite that's queued separately). One asymmetric snapshot bug in `emitInit`, one NaN clamp gap, and a documented-only multi-tenant pattern with a prose/code contradiction.

  ### Walker hardening

  **Proxy iterator DoS — array length cap**. A `Proxy` whose target is array-shaped (so `Array.isArray` returns `true`) but whose `Symbol.iterator` yields an arbitrary count blocked the event loop / OOM-ed the worker during `[...value]` spread. The throw from V8's allocation failure was swallowed by `safeCall` at the plugin boundary so the raw PII committed to the store unredacted. Walker now caps any single array snapshot at `MAX_ARRAY_SCAN = 10_000` elements (via `Array.prototype.slice.call`), emits a `console.warn` so consumers see the truncation, and leaves elements past the cap as-is in the redacted output.

  **Proxy throw bypass — try/catch wraps structural walk**. A `Proxy` whose `Symbol.iterator` returned `undefined` (or whose `ownKeys` trap threw) used to crash the walker; the throw was swallowed by `safeCall` and the raw PII committed. The walker now wraps the structural walk in `try/catch` — a hostile shape becomes "no match" rather than a silent commit, with a `console.warn` so the gap is visible.

  **Cycle guard switched from permanent WeakSet to in-progress tracking**. The R14 cycle guard added every visited object to a permanent WeakSet — a non-cyclic payload that re-used the same object reference at multiple slots (`{ primary: user, secondary: user }`) redacted the first occurrence but skipped every subsequent one. Real-world hits: Supabase `{old: row, new: row}` UPDATE with no changes; MCP resource notifications that include the same contact card under `primary` AND `recipients[]`; webhook batches with deduped IDs. Switched to per-walk in-progress: add on entry, remove on exit (`try / finally`). Catches true ancestor cycles, permits shared leaves.

  **`walkDepth: NaN` clamp**. `Math.floor(NaN)` returned NaN, `Math.max/min` short-circuited to NaN, `NaN <= 0` was `false` — the bound never triggered, and on a deeply-nested non-cyclic shape the walker exhausted the stack with `safeCall` swallowing the throw. Clamp now guards with `Number.isFinite(walkDepth)` and falls back to default `1`.

  **Object branch `Object.entries` try/catch**. Wrapped the `Object.entries(value)` call in `try/catch` so a `Proxy` whose `ownKeys` trap throws is treated as "no match" rather than crashing the walker.

  ### Plugin manager

  **`emitInit` loop-until-quiet**. The R14 broadcast snapshot fix patched only sync `broadcast`; async `emitInit` still iterated the live array, so a plugin whose `onInit` called `manager.unregister(otherName)` between awaits could silently skip the next un-init'd plugin — typically `createFactPIIGuardrail` or `audit-ledger`. The previous snapshot-only fix attempt broke the audit-ledger's cascading-registration pattern (`onInit` calls `system.observe(...)` which registers an observer plugin mid-init, whose own `onInit` must fire to bridge engine events to the ledger). Final shape: track init'd plugins via a `WeakSet`, loop the live array until no plugin remains uninit'd, cap at 100 passes to bound an adversarial register-loop. Handles both index-shift and cascading-registration without regressing either.

  ### Documentation

  **`walkDepth` JSDoc rewrite**. Default `walkDepth: 1` did NOT scan the documented dominant Supabase realtime shape (`{ new: [{ email }] }`) because the chain is object → array → object → string (4 levels). JSDoc now lists the canonical real-world shapes with the `walkDepth` they need (flat object: 1, nested object: 2, Supabase row: 4, MCP resource list: 4). Plus documents the hard caps (`MAX_ARRAY_SCAN = 10_000`, cycle guard, finite-only `walkDepth`).

  **MCP factory recipe contradiction fixed**. Previous prose said "if you create the adapter outside the factory, pass it in per call too" while the code example wrapped both adapter AND module construction inside the factory. The "pass it in per call" path re-introduced the multi-tenant cross-contamination the prior round was supposed to close: the adapter's `events.onConnect` is bound at adapter-construction time to whichever factory's `publishRef` was in scope first. Recipe now says explicitly: BOTH adapter and module MUST be constructed inside the same factory; sharing the adapter across factory calls is unsafe.

## 1.19.1

### Patch Changes

- [#57](https://github.com/directive-run/directive/pull/57) [`ec5be62`](https://github.com/directive-run/directive/commit/ec5be62a5744ae7b38972b9a74498173dc7bfe4c) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Follow-on — MCP holder factory + plugin broadcast snapshot + createFactPIIGuardrail main barrel

  Three small follow-on fixes for issues surfaced during the prior round that Tier 1 did not cover:

  **MCP holder pattern — multi-tenant safe factory**. The MCP source recipe in `ai-sources.md` declared `let publishRef: SourcePublish | null = null` at module scope. Importing the module twice (one Directive system per tenant DO; SSR with one module instance per worker; Vitest with hot-reload boundaries) made the LAST `attach` overwrite the holder — first tenant's adapter callbacks routed into the second tenant's facts. Recipe now wraps adapter + module construction in a `makeOrchestrator()` factory so each call yields an isolated closure pair. Multi-tenant + SSR + hot-reload safe.

  **`broadcast` snapshots `plugins` before iteration**. A plugin hook callback that called `manager.unregister(...)` (or whose `system.observe()` unsubscribe spliced the array) used to shift indices mid-iteration, silently skipping the NEXT plugin — typically the audit-ledger or `createFactPIIGuardrail`. The broadcaster now iterates a snapshot taken at call time, so reentrant `unregister` no longer corrupts the broadcast.

  **`createFactPIIGuardrail` re-exported from `@directive-run/ai` main barrel**. The Tier 0 Mandatory Companion to `liveContext` was the only guardrail not on the main barrel. Other guardrails (`createPIIGuardrail`, etc.) ship as `@deprecated` re-exports for back-compat; `createFactPIIGuardrail` now ships the same way. Consumers who follow the "main-barrel" idiom every other guardrail supports will find it.

- [#57](https://github.com/directive-run/directive/pull/57) [`018010e`](https://github.com/directive-run/directive/commit/018010e0ef64a839bd8521ba81696aa33823e68c) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Walker DoS / PII bypass + onContextUpdate ordering + mode deprecation restore + docs

  The R14 multi-lens audit against the v1.19.0 source-primitive surface
  returned ~30 Critical findings. This patch closes the four highest-
  impact Critical clusters; the remaining items are tracked for a
  follow-up minor.

  ### Critical fixes

  **Walker DoS + PII bypass.** The previous array recursion fix passed `depth` raw on the array
  branch and did NOT snapshot the array before iterating. Three exploit
  chains landed simultaneously: (a) a deeply-nested
  `[[[[...]]]]` payload bypassed the documented `walkDepth ≤ 5` bound
  and overflowed the call stack, with the `safeCall` plugin wrapper
  swallowing the throw — leaving the raw PII committed in the fact
  store. (b) Cyclic arrays (`const a = []; a.push(a)`) recursed forever
  into the same overflow. (c) A `Proxy` whose `.get(0)` returned PII on
  the live read but benign content on the `[...value]` spread leaked
  PII into the redacted output at the un-walked indices (TOCTOU).
  Real-world attack surface: any source where the attacker controls
  payload shape — Supabase RPC, MCP resource list, webhook bodies.

  The fix in `packages/ai/src/guardrails/fact-pii.ts`: (1) decrement
  `depth` on the array branch (matches the object branch), (2) snapshot
  the array via `[...value]` BEFORE the loop and iterate the snapshot,
  (3) track visited references via `WeakSet` and bail on revisit.
  Closes the stack-overflow + cycle + Proxy chains with one ~10-line
  fix. Two new regression tests cover the new bound and the cycle
  guard; the existing array tests still pass.

  **`liveContext.onContextUpdate` call order matched to JSDoc**
  . The JSDoc declared `onContextUpdate` "fires AFTER the
  `interruptWhen` predicate runs but BEFORE the chunk emits" — the
  impl called `onContextUpdate` FIRST. The instrumentation hook
  couldn't observe interruption decisions, defeating the documented
  use case. Swap the order, AND wrap both callbacks in try/catch so a
  throw inside `interruptWhen` or `onContextUpdate` no longer
  propagates back through `notifyKey` → `flush` → the source's
  publish handler (which used to kill the publisher entirely and
  skip every downstream listener in the notify cycle).

  **`LiveContextOptions.mode` restored as `@deprecated` for source-compat**
  . v1.18.0 shipped to npm with `mode: "inject-system-message"
| "restart"` on the public `LiveContextOptions` interface. v1.19.0
  removed it. The Tier 2 changeset asserted "v1.18.0 has not yet
  shipped" — `npm view @directive-run/ai time` says otherwise (1.18.0
  published 2026-06-08 05:42 UTC, 1.19.0 published 2026-06-09 14:21
  UTC — 32hr live with the field). Removing an exported field of an
  exported type is a breaking change requiring a major bump; shipping
  it as minor was a semver violation. This patch restores the field
  as `@deprecated` with a one-shot runtime warning when consumers set
  it (no behavior change — abort-and-emit is still the only path).
  Field will be removed properly in v2.0 with a deprecation cycle.

  ### Documentation fixes

  **Source primitive doc cluster**. The `onEvict` recipe in
  `packages/knowledge/core/sources.md` referenced a `ch` variable
  defined in a sibling closure — a copy-paste consumer would hit
  `ReferenceError`. Rewrote using the holder + closure bridge pattern
  (`let channel = null` shared between `attach` and `onEvict`).
  `packages/knowledge/ai/ai-sources.md` still documented the removed
  `mode: "restart"` field — replaced with the actual shipped behavior
  description. The adapter table referenced a non-existent
  `sourceFromWebSocket()` adapter as the canonical WebSocket bridge —
  clarified that the Cloudflare DO adapter `sourceFromWebSocketMessage()`
  is the shipped path; the generic helper is queued for a follow-up
  RFC. RFC 0005 self-contradicted on `liveContext.guardrails` (drafted
  field vs. shipped `createFactPIIGuardrail`) and listed an "Open
  question" about a removed `mode: "restart"` semantic — both
  rewritten to match the shipped state.

## 1.19.0

### Minor Changes

- [#55](https://github.com/directive-run/directive/pull/55) [`5c7a2d6`](https://github.com/directive-run/directive/commit/5c7a2d60f71f527e9afd85a67afa36f61fc0bdfc) Thanks [@jasoncomes](https://github.com/jasoncomes)! - 5 remaining Critical fixes to documented surfaces of the source primitive

  This patch closes the 5 R13 CRITs that affect documented but unreachable
  or misleading public APIs of v1.18.0. With Tier 1 (already merged) +
  this Tier 2, all 10 R13 ship-blocking CRITs are resolved.

  ### Critical fixes

  **`System.stopAsync` / `destroyAsync` / `evict` wired through
  `createSystem` wrappers**. Engine implemented these per RFC
  0009 but neither the single-module wrapper at `system.ts:1178+` nor the
  namespaced wrapper at `system.ts:527+` assigned them, and the
  `SingleModuleSystem` / `NamespacedSystem` / system-config types omitted
  the declarations. Calling `createSystem({...}).stopAsync()` failed at
  TypeScript (`Property 'stopAsync' does not exist`) AND at runtime
  (undefined method). The entire RFC 0009 DO-eviction recipe documented
  in `core/sources.md` was unreachable from the public API. All three
  methods now delegate to the engine; both wrappers participate in the
  `tickInterval` cleanup; added a 6-case regression test
  (`system-async-lifecycle.test.ts`) that exercises the public boundary
  including an async source unsubscribe await.

  **Cloudflare DO adapters accept `onEvict`**. `sourceFromDOAlarm`
  and `sourceFromWebSocketMessage` are the literal target runtime for RFC
  0009, yet neither adapter accepted or forwarded an `onEvict` option.
  With this change both adapters expose `onEvict?: () => void | Promise<void>`
  on their options interface. Defaults: `DOAlarm` clears the pending
  alarm via `storage.deleteAlarm()`; `WebSocketMessage` closes the socket
  with code 1001 `"going-away"`. Consumers can override to skip the
  default (e.g. when the runtime hibernates WebSockets natively) or to
  add pre-hibernation work (flush audit log, signal broker). 4 new
  regression tests covering default + custom `onEvict` for both adapters.

  **`createFactPIIGuardrail` walker recurses into arrays**. The
  walker previously short-circuited on `Array.isArray(value)`, so the
  dominant real-world Supabase realtime shape
  (`payload.new = [{ email, ... }]`) and MCP resource-list notifications
  silently bypassed the Tier 0 guard. The walker now inspects array
  elements at the same depth budget, rebuilding the array if any element
  matched. Maps and Sets remain out of scope by design (consumers must
  wire a `customDetector` for those). 2 new regression tests covering
  both "array of PII objects" and "array of PII strings" shapes.

  **RFC 0005 `mode` field removed**. The field
  `liveContext.mode: "inject-system-message" | "restart"` shipped on the
  public API but was never read by the impl. The name
  `"inject-system-message"` falsely implied mid-stream injection; the
  actual behavior is abort-and-emit. Since v1.18.0 has not yet shipped,
  the field is removed cleanly (no deprecation tail to maintain). The
  auto-re-prompt semantics will ship in a follow-up RFC + field together
  once their design is settled. RFC 0005 + `ai-sources.md` updated.

  ### Documentation fixes

  **MCP source recipe rewritten against the real adapter API**.
  The previous recipe in `ai-sources.md` called `adapter.onConnect(cb) →
unsubscribe` — a method that doesn't exist on `MCPAdapter`. The actual
  adapter exposes `MCPAdapterConfig.events` as a single callback bag at
  construction time. The rewritten recipe documents the canonical
  "holder + closure" bridge pattern: a `publishRef` variable that the
  source's `attach` populates, with the adapter's `events.onConnect` /
  `onDisconnect` forwarding through it. This is the general pattern for
  bridging any single-callback-bag third-party SDK into a Directive
  source. Recipe also adds the missing `derivations` schema declaration.

## 1.18.0

### Minor Changes

- [#52](https://github.com/directive-run/directive/pull/52) [`2109c31`](https://github.com/directive-run/directive/commit/2109c31b407dda9dbac5c587af745cb67f8b898e) Thanks [@jasoncomes](https://github.com/jasoncomes)! - `*Definition` aliases for the `*Def` cohort (RFC 0006 — 1.x forward-compat landing)

  `@directive-run/core` now exports `*Definition` names alongside every
  `*Def` type so consumers can migrate from the abbreviated form today
  without breaking change. The `*Def` types stay canonical through 1.x;
  **2.0** swaps which name is canonical and which is the deprecated
  alias.

  Rationale (per RFC 0006): `*Def` is an abbreviation. The workspace's
  own `anti-patterns.md` entry #5 forbids abbreviating `context` to
  `ctx`; the same logic applies to type names. Minifiers handle the
  bytes; source-code readability does not.

  ### What ships

  The aliases live in `packages/core/src/core/types/index.ts` via the
  `export type { X as Y }` re-export-rename pattern, which preserves all
  generic forwarding + TS inference rules (mapped types, conditional
  distribution, tagged-union discrimination, barrel re-exports). Each
  alias resolves to the SAME type symbol as its canonical name — just
  under a different label.

  Aliased cohorts:

  - `ModuleDef` → `ModuleDefinition`
  - `ConstraintDef` / `ConstraintsDef` → `ConstraintDefinition` / `ConstraintsDefinition`
  - `TypedConstraintDef` / `TypedConstraintsDef` → `TypedConstraintDefinition` / `TypedConstraintsDefinition`
  - `CrossModuleConstraintDef` / `CrossModuleConstraintsDef` → `CrossModuleConstraintDefinition` / `CrossModuleConstraintsDefinition`
  - `DynamicConstraintDef` → `DynamicConstraintDefinition`
  - `ResolverDef` / `ResolversDef` → `ResolverDefinition` / `ResolversDefinition`
  - `TypedResolverDef` / `TypedResolversDef` → `TypedResolverDefinition` / `TypedResolversDefinition`
  - `SchemaTypedResolversDef` → `SchemaTypedResolversDefinition`
  - `DynamicResolverDef` → `DynamicResolverDefinition`
  - `DerivationDef` / `DerivationsDef` / `DerivationDefWithMeta` → `DerivationDefinition` / `DerivationsDefinition` / `DerivationDefinitionWithMeta`
  - `TypedDerivationsDef` / `CrossModuleDerivationsDef` → `TypedDerivationsDefinition` / `CrossModuleDerivationsDefinition`
  - `EffectDef` / `EffectsDef` → `EffectDefinition` / `EffectsDefinition`
  - `CrossModuleEffectDef` / `CrossModuleEffectsDef` → `CrossModuleEffectDefinition` / `CrossModuleEffectsDefinition`
  - `EventsDef` / `TypedEventsDef` → `EventsDefinition` / `TypedEventsDefinition`
  - `SourceDef` / `SourcesDef` → `SourceDefinition` / `SourcesDefinition`
  - `SourcePublish` → `SourcePublishFn`
  - `SourceUnsubscribe` → `SourceUnsubscribeFn`

  ### Explicit "no rename" decisions

  - `EffectCleanup` — kept as-is (symmetric `EffectCleanupFn` rename
    deferred to a separate sweep tracked in a follow-up issue;
    asymmetry with `SourceUnsubscribeFn` documented).
  - `MetaAccessor`, `EventsAccessor`, `DeriveAccessor` — `Meta` here is
    the term-of-art for the metadata-accessor pattern, not an
    abbreviation.
  - `SchemaType`, `ModuleHooks`, `SystemConfig`, `SystemInspection`,
    `Snapshot` — already spelled out.

  ### Migration

  ```ts
  // 1.x — both work, pick whichever reads better
  import type { ModuleDef, SourceDef } from "@directive-run/core"; // canonical
  import type { ModuleDefinition, SourceDefinition } from "@directive-run/core"; // forward-compat
  ```

  ### Verification

  `packages/core/src/core/__tests__/rename-aliases.test-d.ts` smoke-tests
  the 5 TS-inference edge cases per RFC 0006 (direct structural
  identity, generic-constraint position, mapped-key position,
  conditional distribution, tagged-union literal discriminant, barrel
  re-export). If any alias breaks identity, `tsc --noEmit` rejects.

  `packages/knowledge/core/anti-patterns.md` adds entry #21
  ("Abbreviating Type Names") so AI-generated code paths preferentially
  emit the spelled-out names.

  ### 2.0 plan

  Canonical declarations rename to `*Definition`; the `*Def` names
  become the deprecated `@deprecated` aliases (same `export type { X as
Y }` shape, reversed direction). Touches ~21 packages across the
  workspace; lands on its own dedicated 2.0 branch.

- [#52](https://github.com/directive-run/directive/pull/52) [`ac879b5`](https://github.com/directive-run/directive/commit/ac879b5bbab111b27075da088826410064961b04) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Source primitive — RFC 0007 backpressure + RFC 0008 Observer protocol + RFC 0009 async-stop + DO eviction

  Three additive RFCs land together on the source primitive. All changes
  preserve existing source declarations bit-for-bit; consumers opt in
  per source / per call.

  ## RFC 0007 — `SourceDef.coalesce` backpressure

  Additive `SourceDef.coalesce: "none" | "lastWriteWins" | "all"`
  (default `"none"`). When set to `"lastWriteWins"`, the manager
  queues at most ONE publish per event name per microtask. Subsequent
  publishes with the same event name within the same microtask cycle
  overwrite the pending payload and bump `dropCount` /
  `lastDropReason: "coalesced"`. Per-event-name keying means a noisy
  `priceTick` storm coalesces while a one-shot `connected` event still
  dispatches in the same flush.

  `"all"` is a no-op equivalent to `"none"` — it names the intent (no
  coalesce, every publish counts) for readers. Choose `"lastWriteWins"`
  for high-frequency sources (cursor movement, sensor telemetry,
  channel storms); leave `coalesce` unset for low-frequency lifecycle
  sources (MCP connect, DO alarm). `SystemInspection.sources[i]` now
  exposes `lastDropReason: "coalesced"` so operators can verify the
  debouncing is firing on the right sources.

  ## RFC 0008 — Source publish Observer-protocol posture

  `SourcePublish` is now an `interface` (was a bare callable type) so
  additive minors can attach optional methods (e.g. `error`,
  `complete`) without a major bump. The call signature is unchanged:
  existing `publish('EVENT', payload)` call sites keep working.

  `attach` gains an optional second argument: `reportError`. Authors
  route runtime errors from the underlying stream (WebSocket disconnect,
  Supabase channel goes stale, polling fetch throws) through this
  callback instead of inventing magic event names like `STREAM_ERROR`.
  The error fires `phase: "runtime"` — distinct from `"attach"` and
  `"cleanup"` — so the audit ledger / logging plugin / `inspect()` can
  attribute mid-flight failures correctly.

  ```ts
  sources: {
    ws: {
      attach: (publish, reportError) => {
        const sock = new WebSocket(url);
        sock.addEventListener('error', () => reportError(new Error('WS')));
        sock.addEventListener('message', (e) => publish('MSG', JSON.parse(e.data)));
        return () => sock.close();
      },
    },
  }
  ```

  The new `phase: "runtime"` variant lands additively on:

  - `ObservationEvent.source.error.phase`
  - `Plugin.onSourceError` signature
  - `SystemInspection.sources[i].lastError.phase`
  - `AuditEntry` `source.error` arm

  ## RFC 0009 — Async-aware `system.stop()` + DO eviction hook

  `SourceUnsubscribe` widens from `() => void` to
  `() => void | Promise<void>`. Existing sync unsubscribes continue to
  satisfy the type.

  `System` gains three parallel async methods (sync variants kept,
  **not** deprecated yet — that cut waits for 2.0 per RFC 0009):

  - `stopAsync(): Promise<void>` — awaits each source's unsubscribe in
    reverse-registration order. Use when sources have async unsubscribes
    (Supabase `channel.unsubscribe()`, Cloudflare DO storage flushes)
    and the caller needs teardown to actually complete before continuing.
  - `destroyAsync(): Promise<void>` — `stopAsync` + `destroy`.
  - `evict(deadline?: number): Promise<void>` — fires every source's
    `onEvict()` in registration order, then `destroyAsync`. Cloudflare
    DO consumers call this from `alarm()` / `webSocketClose()` BEFORE
    letting the runtime evict so external brokers don't accumulate ghost
    subscriptions. Optional `deadline` races the eviction against a
    wall-clock cutoff — a partial teardown beats a hang while the
    runtime is impatient.

  `SourceDef.onEvict?: () => void | Promise<void>` — new optional hook
  on every source. Distinct from `unsubscribe()`: eviction can fire
  without a `system.stop()` having been called. Sources whose
  underlying transport is short-lived (browser WebSocket, in-process
  EventEmitter) don't need it.

  The `SourcesManager` interface gains `cleanupAllAsync` (matches the
  sync `cleanupAll` step-for-step but awaits Promise returns) and
  `evictAll` (fires every source's `onEvict` in registration order,
  isolates failures as `phase: "runtime"` errors).

  Sync `cleanupAll` is retained for back-compat (Promise returns from
  unsubscribes are fire-and-forget). Consumers who need awaitable
  teardown wire `system.stopAsync()`.

  Eight regression tests cover the new behaviors: coalesce
  last-write-wins (per microtask + per event name + `"all"` /
  unset behave like `"none"`), `reportError` routes phase `"runtime"`
  errors through the same sinks (after-detach no-op verified),
  `cleanupAllAsync` awaits Promise-returning unsubscribes while sync
  `cleanupAll` fire-and-forgets them, `evictAll` fires `onEvict` in
  registration order with failure isolation, sources without `onEvict`
  silently no-op through `evictAll`.

  Core test suite: 2109 → 2117 passing.

- [#52](https://github.com/directive-run/directive/pull/52) [`18c9a46`](https://github.com/directive-run/directive/commit/18c9a4651cdffc607ad4e570af1d4415470bd5a9) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Source primitive — R5 hardening: lifecycle parity, audit-ledger coverage, per-source telemetry, internals export

  Closes the gaps surfaced by a maximum-scope review of `@directive-run/core`'s
  `source` primitive across security, lifecycle, observability, privacy, and
  portability lenses. All changes are additive (no breaking changes for
  existing source declarations).

  What changed:

  - **Dispatch guard parity with `system.dispatch`.** The engine's source
    dispatcher now drops publishes that arrive after `system.stop()` (between
    stop and the next start), drops publishes whose event names walk the
    prototype chain (`__proto__`, `constructor`, `prototype`) — mirroring the
    BLOCKED_PROPS check `system.dispatch` already enforces — and drops empty
    / non-string event names so logging and audit sinks aren't forced to
    render placeholder rows.

  - **Per-record `detached` flag on the publish closure.** Closes the
    re-registration race window: an OLD source's external transport firing an
    in-flight callback AFTER the R3 registry swap now hits a `detached`
    guard and no-ops, instead of dispatching with stale attribution. R3
    closed the registry leak; this closes the in-flight publish leak.

  - **`registerModule` emits `onDefinitionRegister("source", ...)`.** Runtime
    source registration is now visible to plugins — including the
    audit-ledger — closing the privilege-change blind spot that left
    hot-reload and dynamic-module source attach unrecorded.

  - **Audit-ledger captures `source.attach` / `source.detach` / `source.error`.**
    Three new `AuditEntryKind` variants land in the ledger automatically.
    `source.publish` is intentionally NOT captured — high-volume sources
    would blow up the ledger, and the resulting `fact.change` entries
    already encode the outcome and remain queryable.

  - **Per-source telemetry on `system.inspect().sources`.** Each row now
    carries `attached`, `attachedAt`, `detachedAt`, `publishCount`,
    `lastPublishAt`, `errorCount`, and `lastError`, so operators can answer
    "is this source publishing?" "when did it last fire?" "is it errored?"
    without registering a custom plugin. Counters reset at every `system.start()`.

  - **Logging plugin wires `onSourceAttach` / `onSourcePublish` /
    `onSourceDetach` / `onSourceError`.** The default observability surface
    now logs the full source lifecycle (attach/detach/error at the
    configured level, publish at `debug` so high-rate sources don't dominate
    the log at typical "info"-level config).

  - **`createSourcesManager` re-exported from `@directive-run/core/internals`.**
    Closes the parity gap with every other manager factory and unblocks
    sandbox / sibling-package consumers that want to drive sources at the
    lower level.

  - **Promise-shaped unsubscribe returns get a targeted diagnostic.** Authors
    who write `attach: async (publish) => () => undefined` now see a
    Promise-specific error message ("attach() must be synchronous — rewrite
    as `attach: (publish) => { ... return () => unsubscribe(); }`") instead
    of the generic "did not return an unsubscribe function" diagnostic.

  - **Anti-patterns + sources.md cross-references corrected.** The dead
    `effects.md` link in sources.md's "Related" section is replaced with
    `core-patterns.md` + `naming.md` + the now-canonical `anti-patterns.md #20`
    entry. The stale "19 most common mistakes" intro line in
    `anti-patterns.md` is updated to reflect the 20th entry on hand-rolled
    subscriptions.

  Five new regression tests cover the changes (BLOCKED_PROPS on event names,
  post-stop dispatch guard, re-registration race detached flag, Promise
  unsubscribe diagnostic, per-source publish counter).

- [#52](https://github.com/directive-run/directive/pull/52) [`099490d`](https://github.com/directive-run/directive/commit/099490dc9cb20d85369a69933ab26ef561822585) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Source primitive — R6 hardening: dispatch ordering, drop telemetry, error truncation, AuditEntry coverage, timeline render

  Closes a second round of cross-cutting findings against the source primitive
  covering security, observability, privacy, and DX. All changes are additive
  on top of R5.

  **Engine — `emitDefinitionRegister("source", ...)` no longer leaks the live `def.attach` callback.**
  The privilege-change emission now hands plugins an opaque descriptor
  (`{ moduleId, meta }`) instead of the raw `SourceDef`. A malicious or buggy
  plugin receiving the live def could call `def.attach(...)` to install a
  parallel subscription bypassing the manager — the manager wouldn't track it,
  wouldn't tear it down at stop, and wouldn't surface it via `inspect()`. The
  descriptor exposes nothing callable; plugins that need to react beyond the
  attach/publish/detach hooks can subscribe to `system.observe()`.

  **Engine — emission order is now `register → attach`, matching constraints / resolvers / derivations / effects.**
  Previously `sourcesManager.registerDefinitions` ran before
  `emitDefinitionRegister("source", ...)`, so observers saw `source.attach`
  before `definition.register`. Audit replays and devtools timelines now read
  the source lifecycle in the same order as every other primitive.

  **Manager — counter bump + `onPublish` fire ONLY for engine-accepted publishes.**
  Pre-R6, `perSourcePublish` bumped `publishCount` + fired the `onPublish`
  plugin hook BEFORE invoking the engine's dispatch lambda. When the lambda
  silently rejected the publish (post-stop, BLOCKED_PROPS event name, empty /
  non-string name), telemetry and observers saw "publish happened" for events
  the engine swallowed. The dispatch lambda now returns a typed
  `SourceDispatchResult` so the manager can split accepted / rejected: accepted
  publishes bump `publishCount` + fire `onPublish`; rejected publishes bump
  `dropCount` + record `lastDropReason` instead.

  **`SystemInspection.sources[i]` gains `dropCount` / `lastDropReason` / `lastDropAt`.**
  Operators can now diagnose "publishes happening, nothing changing" without a
  custom plugin. The four drop reasons (`"post-destroy"`, `"post-stop"`,
  `"blocked-event-name"`, `"invalid-event-name"`) attribute each rejection to a
  specific guard. Closes the silent-block telemetry gap that let an attacker
  probe BLOCKED_PROPS / the `isRunning` guard invisibly.

  **Manager — error messages truncated at 256 characters.**
  A source whose `attach()` throws with a payload-embedded message
  (`throw new Error(\`bad row: ${JSON.stringify(piiRow)}\`)`) previously
landed the full payload in (a) `inspect().sources[i].lastError.message`,
(b) the audit ledger's `source.error`entry, and (c) the logging plugin's
error-level emission. R6 caps the message at a fixed length with a`[N chars truncated]`marker so the leak surface is bounded. Source authors
who need the full message in development can opt into a custom logging
plugin that captures the raw`Error` object.

  **Audit-ledger — `AuditEntry` discriminated union now includes `source.attach` / `source.detach` / `source.error`.**
  The R5 `AuditEntryKind` listed these, but the `AuditEntry` union didn't
  have matching arms — the `as AuditEntry` cast at `index.ts` masked the
  type hole. Consumers can now `entry.kind === "source.*"` narrow on
  `sourceId` / `moduleId` / `phase` / `error` without `as` escape hatches.

  **Manager — late-bind unsubscribe via direct assignment.**
  The R5 `Object.assign(attachedRecord, { unsubscribe })` was bypassing the
  `readonly unsubscribe` declaration on `AttachedSource`. Drop the `readonly`
  modifier to make the late-bind honest and remove the type-system lie.

  **Hot-path allocation — `emptyCounters()` is no longer allocated per publish.**
  `perSourcePublish` now relies on the counters entry being seeded at the top
  of `attachOne` (so publish-during-attach is also counted). At 1M publishes
  per tick the eliminated allocation removes ~1M small-object GC pressure.

  **Timeline — source.\* events now render with detail + color.**
  `@directive-run/timeline`'s `formatEventDetail` switch now has cases for
  `source.attach`, `source.publish`, `source.detach`, `source.error`. Pre-R6,
  the timeline showed bare `source.publish` with no module / id / event name.
  Also added `KIND_COLORS` entries (magenta for attach/detach, cyan for
  publish, red for error).

  **Docs — `system-api.md` documents `inspection.sources` + `attachedSourceCount`.**
  The R5 telemetry fields were the SystemInspection JSDoc but absent from the
  canonical knowledge doc. R6 lands the full schema reference.

  **Bundle gate — `packages/core/dist/index.js` added to `size-budgets.json` at 18 KB gz.**
  Current 14.7 KB gz leaves ~22% headroom. The largest package in the
  workspace was previously ungated; any future feature now lands measured.

  Three new regression tests cover the changes: drop telemetry on
  `inspect().sources`, `onPublish` only fires for accepted publishes, and
  `lastError.message` truncation at 256 chars. Sources test file goes from
  39 → 42; full core suite 2105 → 2108 passing.

- [#52](https://github.com/directive-run/directive/pull/52) [`38d950a`](https://github.com/directive-run/directive/commit/38d950af9f02d2281f3b7b08285a3685e8afb2c0) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Add `source` primitive — typed external event sources, the inbound dual of effects.

  A `source` declares an external event subscription (Supabase realtime channel, WebSocket message stream, polling timer, browser event listener) as a first-class module field. The engine owns the lifecycle:

  - `attach(publish)` runs once at `system.start()`. The synchronous callback receives a typed `publish` that dispatches into the same event queue as `system.events.X(payload)`.
  - The returned `Unsubscribe` runs at `system.stop()`, in reverse-registration order across all modules.
  - The full **start → stop → start → stop** lifecycle is supported — each `attachAll` re-arms the manager and a fresh attach runs.
  - Sources brought by `system.registerModule(...)` AFTER `start()` attach **immediately** using the captured publisher.
  - Source attach + unsubscribe failures are isolated per source (logged via `console.error` AND forwarded to the new `onSourceError` plugin hook) — one bad source never blocks others.
  - The publish callback **guards against post-destroy dispatch** — a source author who retains the callback past `destroy()` cannot dispatch into the torn-down store.

  This formalises the "hook-as-bridge" pattern used in 7+ call sites across downstream consumers (a production app's per-realtime-stream `useEffect` hooks, an event-claims realtime adapter, etc.) where a `useEffect` owned the realtime channel and manually dispatched events on each message. With `sources` declared on the module, the lifecycle is engine-owned and the React hook collapses to `useFact` reads.

  Usage:

  ```typescript
  import { createModule, t, type SourcePublish } from "@directive-run/core";

  const counter = createModule("counter", {
    schema: {
      facts: { count: t.number() },
      events: { TICK: { delta: t.number() } },
    },
    init: (f) => {
      f.count = 0;
    },
    events: {
      TICK: (f, payload) => {
        f.count = f.count + payload.delta;
      },
    },
    sources: {
      heartbeat: {
        attach: (publish) => {
          const id = setInterval(() => publish("TICK", { delta: 1 }), 1000);
          return () => clearInterval(id);
        },
      },
    },
  });
  ```

  **Observability.** Source lifecycle is fully observable via `system.observe()`:

  ```typescript
  system.observe((event) => {
    switch (event.type) {
      case "source.attach":
        /* { id, moduleId } */ break;
      case "source.publish":
        /* { id, moduleId, eventName } */ break;
      case "source.detach":
        /* { id, moduleId } */ break;
      case "source.error":
        /* { id, moduleId, phase, error } */ break;
    }
  });
  ```

  Or via the plugin API (`onSourceAttach`, `onSourcePublish`, `onSourceDetach`, `onSourceError`).

  `system.inspect().sources` lists declared sources with their owning `moduleId`, and `system.inspect().attachedSourceCount` reports the live count.

  New exports:

  - `SourceDef`, `SourcesDef`, `SourcePublish`, `SourceUnsubscribe` (types).
  - `ModuleConfig.sources?` and `ModuleConfigWithDeps.sources?` (cross-module dependency variant accepts sources too; sources don't access facts so they're not affected by the `facts.self.*` / `facts.{dep}.*` split).
  - `system.registerModule({ sources })` — dynamic sources attach immediately when the system is already running.
  - `system.inspect().sources` + `system.inspect().attachedSourceCount`.
  - Four new `ObservationEvent` variants: `source.attach`, `source.publish`, `source.detach`, `source.error`.
  - Four new Plugin hooks: `onSourceAttach`, `onSourcePublish`, `onSourceDetach`, `onSourceError`.

  Documentation:

  - New knowledge file `packages/knowledge/core/sources.md` with decision tree, recipes (Supabase, browser events), lifecycle table, observation snippet, common patterns + anti-patterns.
  - `packages/knowledge/core/anti-patterns.md` gains a "hand-rolled subscription instead of `source`" entry.
  - `packages/knowledge/sitemap.md` indexes sources under Core API.
  - `packages/knowledge/api-skeleton.md` lists the four new exported types.

  Non-breaking: modules without a `sources` field continue to work identically.

### Patch Changes

- [#52](https://github.com/directive-run/directive/pull/52) [`08d84df`](https://github.com/directive-run/directive/commit/08d84dfe4ac558d2dd9013407e6b12a60ec6cfac) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Source primitive RFCs — R11 close-out: public alias exports + interrupt() semantic + evict(deadline) detached-work + liveContext setup hoist + self-loop guard + docs drift

  A follow-up audit on the 5 RFC implementations (0005-0009) surfaced one
  Critical and several Major issues. All shipped without prior review
  in the original implementation pass; this patch closes them.

  ### Critical fixes

  **Public alias exports** (RFC 0006): the 22+ `*Definition` aliases
  landed in `packages/core/src/core/types/index.ts` but the curated
  public barrel at `packages/core/src/index.ts` didn't re-export them.
  `import type { ModuleDefinition } from "@directive-run/core"` — the
  exact form anti-patterns.md #21 instructs consumers to write —
  failed at the package boundary. Every alias is now re-exported from
  the public barrel.

  **`interrupt()` semantic** (RFC 0005): the headline feature of
  liveContext — `interrupt()` cancels the LLM run but keeps the
  subscription alive — was broken. `abortController.abort()` triggered
  the IIFE catch path → reject → `resultPromise.finally(() =>
tearDownLiveContext())` ran → subscription died. The distinction
  between `abort` and `interrupt` collapsed.

  Fix: a private `interruptInitiated` flag is set BEFORE
  `abortController.abort()` in `interrupt()`. The `finally` callback
  checks the flag and skips `tearDownLiveContext` when the abort came
  from `interrupt`. The caller is now correctly responsible for either
  re-prompting via a fresh `runStream` against the live subscription, or
  calling `abort()` to fully tear down.

  ### Major fixes

  **`evict(deadline≤0)` detached work** (RFC 0009): when `evict` is
  called with a synchronous deadline, the eviction IIFE used to be
  constructed, then the function returned early — leaving the IIFE
  running detached with no error path (unhandled-rejection risk if late
  teardown threw). The two paths now both attach a swallow-catch:
  synchronous-deadline kicks off detached work with a `.catch(() =>
{})`; deadline-raced path attaches the same swallow before
  `Promise.race`. Per-source errors still route through the manager's
  `phase: "runtime"` sink, so the catch doesn't lose signal.

  **liveContext setup hoist** (RFC 0005): the liveContext subscription
  used to wire up AFTER the resultPromise IIFE was constructed (and had
  already started running synchronously up to its first `await`). The
  race is theoretical today (the IIFE's sync prefix doesn't mutate
  facts), but a future IIFE prefix change could synchronously trigger
  fact mutations before the subscription wires up. The block now runs
  BEFORE the IIFE construction. The subscription callback closes over
  `closed`, `pushChunk`, `accumulatedOutput`, `abortController` — all
  declared above and reactive to mutations from inside the IIFE.

  **Self-loop dev-mode guard** (RFC 0005): nothing prevented a consumer
  from passing `liveContext.system === orchestrator.system` AND
  watching bridge-state keys (`agent`, `conversation`, `approvalState`).
  The orchestrator's own `setAgentState` / `setConversation` writes
  would trigger `interruptWhen`, self-looping the run. The
  orchestrator's `runStream` now warns in `debug: true` mode when the
  overlap is detected.

  **`mode: "restart"` dead code** (RFC 0005): the `mode` field was
  declared on `LiveContextOptions` but the implementation never read
  `liveCfg.mode` — both values produced identical behavior. The type
  union order is now `"inject-system-message" | "restart"` (the
  shipping default first), the JSDoc is honest that `"restart"` is
  forward-compat-only, and the `@example` block uses
  `"inject-system-message"`.

  **`SourceReportError` export** (RFC 0008): the callback type that
  authors need to type their reportError helpers wasn't re-exported.
  Now exported from `@directive-run/core/types/index.ts` and from the
  public barrel at `@directive-run/core`.

  **`reportError` parameter optional** (RFC 0008): the type signature
  of `SourceDef.attach` declared `reportError` as required, but the
  JSDoc said it was optional. Made the parameter optional in the type
  to match.

  **Coalesce strategy uniformity** (RFC 0007): the JSDoc on
  `SourceDef.coalesce` documented per-event-name coalescing but didn't
  call out that the STRATEGY (lastWriteWins vs none) is uniform per
  source. Added a "Limitation" subsection naming the constraint.

  ### Documentation drift fixes

  `packages/knowledge/ai/ai-sources.md` had multiple factual errors
  against the shipped types:

  - Documented a `liveContext.guardrails` field that doesn't exist
    (removed — security companion is `createFactPIIGuardrail` wired at
    `createSystem` time, documented in the Status section).
  - Listed `mode` default as `"restart"` (flipped to
    `"inject-system-message"`).
  - Missing `changedKeys` field on `interrupted` chunk shape (added).
  - Missing required `keys` field in the signature example (added).
  - Never mentioned `result.interrupt(reason?)` method (added with
    contrast vs `abort()`).
  - "Status" section still in RFC-design-speak after ship (flipped to
    "shipped").

  `packages/knowledge/core/sources.md` gained three new sections per
  RFC 0007/0008/0009 acceptance criteria:

  - "Error handling — runtime errors via reportError" (RFC 0008).
  - "Backpressure — coalesce: lastWriteWins" (RFC 0007).
  - "Async-aware teardown — system.stopAsync() + DO onEvict" (RFC 0009).

  Stale line references in `docs/rfcs/0005-live-context-agent.md`
  (`agent-orchestrator.ts:1309, 1474`) replaced with symbolic
  references.

  Gates: core typecheck + 2117 tests passing; ai typecheck + 1511 tests
  passing; sources typecheck clean; core dist 14,678 B gz (under
  18,000 B budget).

- [#52](https://github.com/directive-run/directive/pull/52) [`f9a2181`](https://github.com/directive-run/directive/commit/f9a2181838c89585dc44b2b961df6d290b4b6dc2) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Source primitive — R7: error-message truncation applies at the manager
  boundary so audit-ledger and logging plugin observe a bounded message too

  R6's `lastError.message` truncation closed the inspect-output leak surface,
  but the `onError` plugin callback continued to receive the raw `Error`
  object. The audit-ledger's `source.error` entry read `event.error.message`
  directly, and the logging plugin's `error`-level emission logged the raw
  error — both still wrote the full payload into their respective sinks.

  R7 truncates at the `reportError` boundary inside the source manager: any
  `Error` whose `message` exceeds `SOURCE_ERROR_MESSAGE_MAX` (256 chars) is
  replaced with a sanitized `Error` instance carrying the truncated message
  before the `onError` callback fires. The privacy invariant is now "one
  bounded message ceiling across all three sinks" — `inspect()`, the audit
  ledger, and the logging plugin. Short errors pass through unchanged so the
  sanitization has zero allocation overhead in the common case.

  `SourceInspectionRow`, `SourceLastError`, and `SourceDispatchResult` are
  also now re-exported from `@directive-run/core/internals` so consumers
  writing helpers over `inspect().sources[i]` can name the types directly
  (previously possible only via `SystemInspection["sources"][number]`).

  Docs:

  - `system-api.md`'s "23 event types" reference now lists the four
    `source.*` variants (previously stale at "18 event types").
  - The 256-char interim ceiling documented here is the floor that
    `createFactPIIGuardrail` will eventually lift.

## 1.17.2

## 1.17.1

## 1.17.0

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

  Caught when a downstream consumer's `apps/web` tried to consume `@directive-run/core/testing.flushAsync` – the JS dist built fine but the DTS build failed for the union exports, masking the entire testing surface from typed downstream usage.

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
