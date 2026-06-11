# @directive-run/ai

## 1.20.2

### Patch Changes

- [#76](https://github.com/directive-run/directive/pull/76) [`8577c06`](https://github.com/directive-run/directive/commit/8577c06131385983321d2297cff1751e53baec3b) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Surgical hardening batch — closes review findings on top of the v1.20.x release.

  `@directive-run/core` (patch):

  - **`system.notify.guardrailBlocked` plugin-name validation.** RFC 0010
    initially accepted any `plugin` string. A third-party plugin holding
    a `System` reference could forge `"guardrail.blocked"` events claiming
    `plugin: "fact-pii-guardrail"`, misleading compliance audit consumers.
    The method now drops + warns when called with a plugin name that
    doesn't match a currently-registered plugin.
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
    to `destroyAsync().catch(...)`. The prior async-teardown migration
    covered `SystemController` + `DirectiveQueryController` but missed the
    zero-config `ModuleController` — Lit users using the simplified
    controller were still dropping source-unsubscribe Promises on the
    floor.

  `@directive-run/react`, `@directive-run/vue`, `@directive-run/svelte`,
  `@directive-run/solid`, `@directive-run/lit` (patch):

  - **Dev-mode `console.warn` on `destroyAsync` rejection.** The previous
    fire-and-forget `.catch(() => {})` silently swallowed every unmount-time
    unsubscribe error. Operators had zero signal when a Supabase channel
    `removeChannel()` rejected. The catch now logs in development
    (`isDevelopment === true`); production behavior is unchanged (the
    manager's `phase: "runtime"` observability sink still receives the
    per-source error).

  Closes six critical and six major findings across security and
  architecture. Larger follow-up items deferred to RFCs: Supabase
  channel-name reuse race, `attachGuardrailsToOtel` helper, timeline
  `guardrail.blocked` renderer, knowledge-bundle docs sync.

## 1.20.1

## 1.20.0

### Patch Changes

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

  Closes the `guardrail.blocked` ObservationEvent variant work.

## 1.19.7

### Patch Changes

- [#69](https://github.com/directive-run/directive/pull/69) [`9529917`](https://github.com/directive-run/directive/commit/9529917dc23e7a9cd0f363894fca4bdf374f61a0) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Walker hardening — `createFactPIIGuardrail`:

  - **Proxy TOCTOU on pre-clone cap.** The v1.19.6 pre-clone array cap read `value.length` twice (once for the comparison, once during `value.slice`). A hostile `Proxy` whose `length` getter lied on the first read (returning a small number) and on the second read (returning 1e9) could bypass the cap and OOM `structuredClone`. The cap now materializes via a fixed-length `new Array(len)` loop that reads each index exactly once, so the Proxy's traps can't TOCTOU. `structuredClone` then operates on a plain Array of bounded length.
  - **`Error.cause` + `AggregateError.errors` blind spot.** v1.19.6 only scanned `Error.message`. PII inside `error.cause` (string or wrapped Error) or inside an `AggregateError`'s `errors` array was missed. The walker now recurses into both, decrementing `walkDepth` for the recursion so depth bounds still apply.
  - **Idempotency-gate restriction.** The `value === _prev` skip in `onFactSet` / `onFactsBatch` is now restricted to primitives. Object references that survived the engine's own dedup (or arrived via direct `facts.$store.set` writes) are re-inspected on every emission rather than skipped.
  - **Error redact-mode is now alert-only.** The Error path returns the input reference as `redacted` (Error instances are not deep-cloned with new identity). The follow-up `$store.set` is now skipped when `result.redacted === value`, preventing the writes-back-the-same-ref no-op + the gate-skip cascade on the next emit. The redaction action for Error values is therefore detection-only regardless of the configured `mode`; this is the correct semantic for read-only structured types.

  Closes four critical findings. The `guardrail.blocked` `ObservationEvent` variant is deferred to a follow-up RFC since it touches the `@directive-run/core` observation API.

## 1.19.6

### Patch Changes

- [#67](https://github.com/directive-run/directive/pull/67) [`d8d298c`](https://github.com/directive-run/directive/commit/d8d298c42d904bbdb2ddf485b6e4b6ce638d839b) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Walker hardening — `createFactPIIGuardrail`:

  - Top-level array cap (`MAX_ARRAY_SCAN = 10_000`) is now applied BEFORE `structuredClone` rather than after. Previously, a 1M-element array shipped as one realtime row would consume CPU inside `structuredClone` before the walker ever saw it. (Regression of the prior array-cap fix, introduced by the v1.19.3 walker rewrite.)
  - `Error.message` strings are now scanned for PII. `Error` instances preserve through `structuredClone`, but the walker's `Object.entries` path skipped them. The walker now extracts `Error.message` and runs the synchronous regex scanner; matches surface via `onBlocked` for log scrubbing wiring (the `Error` instance itself is read-only, so it cannot be redacted in place).
  - `Date`, `RegExp`, `TypedArray` (`Int8Array`, `Uint8Array`, ...), `DataView`, `ArrayBuffer`, and `Blob` are now short-circuited in the object branch. Previously, the walker would iterate their entries (mostly no-op, but TypedArrays expose numeric byte keys that could in theory trigger false matches). Pass a `customDetector` to inspect these structures.
  - `onFactSet` now skips the inspection step when the incoming `value === _prev`. The redact follow-up store write would otherwise re-enter the hook and trigger a wasted `structuredClone` + scan on the already-redacted token strings (a real CPU hit at 10k publishes/sec).

  Documentation tail: `docs/rfcs/README.md` updated to reflect the walker rewrite shipped in v1.19.3 + hardening as v1.19.6. `packages/knowledge/core/choosing-primitives.md` fixes "six primitives" → "seven primitives" (the `source` primitive count was off-by-one).

## 1.19.5

### Patch Changes

- [#65](https://github.com/directive-run/directive/pull/65) [`e7ccffd`](https://github.com/directive-run/directive/commit/e7ccffdb103aea56c8bce44418177bd2a7c0f19f) Thanks [@jasoncomes](https://github.com/jasoncomes)! - createFactPIIGuardrail walker: sanitization-first via `structuredClone`

  Replaces the manual structural walker with a `structuredClone`-at-entry pattern that strips Proxies, exotic getters, Symbol-iterator overrides, functions, and detects cycles BEFORE the walker runs on the safe clone. Closes the entire class of Proxy-based bypass attacks at once instead of one-by-one.

  ### Why the rewrite

  Three prior rounds patched the walker, each closing one Proxy attack and opening a slightly different one:

  - Round 1: array-shape payloads silently bypass the guard (added array branch).
  - Round 2: deeply nested arrays bypass the depth bound; Proxy whose `get` returns different values per read leaks PII via TOCTOU (added depth decrement + array snapshot).
  - Round 3: Proxy whose `Symbol.iterator` yields a billion items OOMs the worker; Proxy whose iterator returns `undefined` crashes the walker; cycle guard via permanent WeakSet false-skips shared-leaf references (added size cap + try/catch islands + in-progress cycle tracking).

  The escalating-patch pattern is the signal that the walker needs to operate on a value the consumer cannot inject hostile behavior into. `structuredClone` is the canonical primitive: the cloned value has no Proxies (unwrapped to underlying target), no exotic getters, no functions (clone throws on them), no Symbol-iterator overrides, no cycles (clone throws on cyclic input).

  ### Net effect on the walker

  | Before                                                      | After                                                                       |
  | ----------------------------------------------------------- | -------------------------------------------------------------------------- |
  | 2 functions (`inspect` + `inspectStructural`)               | 2 functions (`inspect` + `walkClone`)                                      |
  | `inProgress: WeakSet` threaded through every recursive call | none — clones can't be cyclic                                              |
  | `try/catch` around outer `inspect` body                     | one `try/catch` around `structuredClone` at entry                          |
  | `try/catch` around `[...value]` spread                      | none — clones are plain arrays                                             |
  | `try/catch` around `Object.entries(value)`                  | none — clones are plain objects                                            |
  | Per-trap Proxy defense                                      | One sanitization step strips all Proxies                                   |
  | New Proxy traps open new bypasses                           | New Proxy traps don't open bypasses (Proxy is stripped before walker runs) |

  The walker is shorter, simpler to explain in docs, and future-proof against new Proxy attack vectors.

  ### Behavior changes (consumer-visible)

  - **Non-cloneable inputs** (values containing functions, DOM nodes, WeakMaps, `Promise`, class instances with method refs, cyclic refs) now log a `console.warn` and skip inspection with "no match" — same posture as the previous per-Proxy-trap try/catches, just collapsed to one site. The raw value stays in the store; consumers wire a `customDetector` for these shapes.
  - **Map / Set** continue to be skipped by design. Both survive `structuredClone` but aren't walked (their string elements would need a different traversal shape). Consumers wire a `customDetector`.
  - **`Date` and other structured types** survive `structuredClone` and are correctly skipped by the walker (they aren't redact targets; they're left as-is in the redacted output).
  - **Proxy inputs** are stripped to their target shape — `new Proxy([leak@x.com], { get: ... })` becomes `[leak@x.com]` after clone, and the email correctly redacts. (This is a strict improvement: the prior round treated all Proxy inputs as "no match" out of caution; this round actually redacts them.)
  - **All prior-round regression tests pass unchanged** — the new walker is a strict drop-in.

  ### Compatibility

  `structuredClone` is native in every runtime Directive supports: Node 17+, Bun, Deno, Cloudflare workerd, browsers ≥ 2022.

  ### Tests

  3657 passing across core/ai/sources (+2 new regression tests covering non-cloneable input fallback and Map inside payload). Existing prior-round array / Proxy / cycle / NaN regression tests pass unchanged.

## 1.19.4

## 1.19.3

## 1.19.2

### Patch Changes

- [#59](https://github.com/directive-run/directive/pull/59) [`f387316`](https://github.com/directive-run/directive/commit/f387316e5ab146b8ddd1a5eeee5d0fb8cb2ce57f) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Walker Proxy / cycle / NaN surgical hardening + emitInit cascading registration + MCP recipe enforcement

  An adversarial review against v1.19.1 surfaced three new Proxy-based attack chains in the walker that the v1.19.1 array-snapshot fix introduced (each round of narrow patches opens a slightly different bypass; this round trades narrower fixes for an architectural rewrite that's queued separately). One asymmetric snapshot bug in `emitInit`, one NaN clamp gap, and a documented-only multi-tenant pattern with a prose/code contradiction.

  ### Walker hardening

  **Proxy iterator DoS — array length cap.** A `Proxy` whose target is array-shaped (so `Array.isArray` returns `true`) but whose `Symbol.iterator` yields an arbitrary count blocked the event loop / OOM-ed the worker during `[...value]` spread. The throw from V8's allocation failure was swallowed by `safeCall` at the plugin boundary so the raw PII committed to the store unredacted. Walker now caps any single array snapshot at `MAX_ARRAY_SCAN = 10_000` elements (via `Array.prototype.slice.call`), emits a `console.warn` so consumers see the truncation, and leaves elements past the cap as-is in the redacted output.

  **Proxy throw bypass — try/catch wraps structural walk.** A `Proxy` whose `Symbol.iterator` returned `undefined` (or whose `ownKeys` trap threw) used to crash the walker; the throw was swallowed by `safeCall` and the raw PII committed. The walker now wraps the structural walk in `try/catch` — a hostile shape becomes "no match" rather than a silent commit, with a `console.warn` so the gap is visible.

  **Cycle guard switched from permanent WeakSet to in-progress tracking.** The prior round's cycle guard added every visited object to a permanent WeakSet — a non-cyclic payload that re-used the same object reference at multiple slots (`{ primary: user, secondary: user }`) redacted the first occurrence but skipped every subsequent one. Real-world hits: Supabase `{old: row, new: row}` UPDATE with no changes; MCP resource notifications that include the same contact card under `primary` AND `recipients[]`; webhook batches with deduped IDs. Switched to per-walk in-progress: add on entry, remove on exit (`try / finally`). Catches true ancestor cycles, permits shared leaves.

  **`walkDepth: NaN` clamp.** `Math.floor(NaN)` returned NaN, `Math.max/min` short-circuited to NaN, `NaN <= 0` was `false` — the bound never triggered, and on a deeply-nested non-cyclic shape the walker exhausted the stack with `safeCall` swallowing the throw. Clamp now guards with `Number.isFinite(walkDepth)` and falls back to default `1`.

  **Object branch `Object.entries` try/catch.** Wrapped the `Object.entries(value)` call in `try/catch` so a `Proxy` whose `ownKeys` trap throws is treated as "no match" rather than crashing the walker.

  ### Plugin manager

  **`emitInit` loop-until-quiet.** The prior broadcast snapshot fix patched only sync `broadcast`; async `emitInit` still iterated the live array, so a plugin whose `onInit` called `manager.unregister(otherName)` between awaits could silently skip the next un-init'd plugin — typically `createFactPIIGuardrail` or `audit-ledger`. The previous snapshot-only fix attempt broke the audit-ledger's cascading-registration pattern (`onInit` calls `system.observe(...)` which registers an observer plugin mid-init, whose own `onInit` must fire to bridge engine events to the ledger). Final shape: track init'd plugins via a `WeakSet`, loop the live array until no plugin remains uninit'd, cap at 100 passes to bound an adversarial register-loop. Handles both index-shift and cascading-registration without regressing either.

  ### Documentation

  **`walkDepth` JSDoc rewrite.** Default `walkDepth: 1` did NOT scan the documented dominant Supabase realtime shape (`{ new: [{ email }] }`) because the chain is object → array → object → string (4 levels). JSDoc now lists the canonical real-world shapes with the `walkDepth` they need (flat object: 1, nested object: 2, Supabase row: 4, MCP resource list: 4). Plus documents the hard caps (`MAX_ARRAY_SCAN = 10_000`, cycle guard, finite-only `walkDepth`).

  **MCP factory recipe contradiction fixed.** Previous prose said "if you create the adapter outside the factory, pass it in per call too" while the code example wrapped both adapter AND module construction inside the factory. The "pass it in per call" path re-introduced the multi-tenant cross-contamination the prior round was supposed to close: the adapter's `events.onConnect` is bound at adapter-construction time to whichever factory's `publishRef` was in scope first. Recipe now says explicitly: BOTH adapter and module MUST be constructed inside the same factory; sharing the adapter across factory calls is unsafe.

## 1.19.1

### Patch Changes

- [#57](https://github.com/directive-run/directive/pull/57) [`ec5be62`](https://github.com/directive-run/directive/commit/ec5be62a5744ae7b38972b9a74498173dc7bfe4c) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Follow-on fixes — MCP holder factory + plugin broadcast snapshot + createFactPIIGuardrail main barrel

  Three small follow-on fixes the prior round's Tier 1 didn't cover:

  **MCP holder pattern — multi-tenant safe factory.** The MCP source recipe in `ai-sources.md` declared `let publishRef: SourcePublish | null = null` at module scope. Importing the module twice (one Directive system per tenant DO; SSR with one module instance per worker; Vitest with hot-reload boundaries) made the LAST `attach` overwrite the holder — first tenant's adapter callbacks routed into the second tenant's facts. Recipe now wraps adapter + module construction in a `makeOrchestrator()` factory so each call yields an isolated closure pair. Multi-tenant + SSR + hot-reload safe.

  **`broadcast` snapshots `plugins` before iteration.** A plugin hook callback that called `manager.unregister(...)` (or whose `system.observe()` unsubscribe spliced the array) used to shift indices mid-iteration, silently skipping the NEXT plugin — typically the audit-ledger or `createFactPIIGuardrail`. The broadcaster now iterates a snapshot taken at call time, so reentrant `unregister` no longer corrupts the broadcast.

  **`createFactPIIGuardrail` re-exported from `@directive-run/ai` main barrel.** The Tier 0 Mandatory Companion to `liveContext` was the only guardrail not on the main barrel. Other guardrails (`createPIIGuardrail`, etc.) ship as `@deprecated` re-exports for back-compat; `createFactPIIGuardrail` now ships the same way. Consumers who follow the "main-barrel" idiom every other guardrail supports will find it.

- [#57](https://github.com/directive-run/directive/pull/57) [`018010e`](https://github.com/directive-run/directive/commit/018010e0ef64a839bd8521ba81696aa33823e68c) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Adversarial review Tier 1 — walker DoS / PII bypass + onContextUpdate ordering + mode deprecation restore + docs

  An adversarial multi-lens review against the v1.19.0 source-primitive
  surface returned roughly 30 critical findings. This patch closes the
  four highest-impact clusters; the remaining items are tracked for a
  follow-up minor.

  ### Critical fixes

  **Walker DoS + PII bypass.** The previous array recursion fix passed
  `depth` raw on the array branch and did NOT snapshot the array before
  iterating. Three exploit chains landed simultaneously: (a) a deeply-nested
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

  **`liveContext.onContextUpdate` call order matched to JSDoc.**
  The JSDoc declared `onContextUpdate` "fires AFTER the
  `interruptWhen` predicate runs but BEFORE the chunk emits" — the
  impl called `onContextUpdate` FIRST. The instrumentation hook
  couldn't observe interruption decisions, defeating the documented
  use case. Swap the order, AND wrap both callbacks in try/catch so a
  throw inside `interruptWhen` or `onContextUpdate` no longer
  propagates back through `notifyKey` → `flush` → the source's
  publish handler (which used to kill the publisher entirely and
  skip every downstream listener in the notify cycle).

  **`LiveContextOptions.mode` restored as `@deprecated` for source-compat.**
  v1.18.0 shipped to npm with `mode: "inject-system-message"
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

  **Source primitive doc cluster.** The `onEvict` recipe in
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

- [#55](https://github.com/directive-run/directive/pull/55) [`5c7a2d6`](https://github.com/directive-run/directive/commit/5c7a2d60f71f527e9afd85a67afa36f61fc0bdfc) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Five remaining critical fixes to documented surfaces of the source primitive.

  This patch closes the five critical issues affecting documented but
  unreachable or misleading public APIs of v1.18.0. With Tier 1 (already
  merged) + this Tier 2, all ten ship-blocking critical issues are resolved.

  ### Critical fixes

  **`System.stopAsync` / `destroyAsync` / `evict` wired through
  `createSystem` wrappers.** Engine implemented these per RFC
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

### Patch Changes

- [#55](https://github.com/directive-run/directive/pull/55) [`9ffd758`](https://github.com/directive-run/directive/commit/9ffd7584914b93ca840ae84372fe3e83c75f29e8) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Five critical fixes to documented surfaces of the source primitive.

  A post-merge review of the merged `feat/source-primitive` work found
  five critical issues affecting consumer-facing documented APIs of
  v1.18.0. All five close in this patch.

  ### Critical fixes

  **`createFactPIIGuardrail` not exported from `@directive-run/ai/guardrails`
  subpath**. The Tier 0 Mandatory Companion to `liveContext` was
  declared in `guardrails/index.ts` but the actual tsup entry for the
  subpath (`src/guardrails-export.ts`) didn't re-export it. Every recipe in
  `packages/knowledge/ai/ai-sources.md` (Sources × Security section) failed
  at import time: `Module '@directive-run/ai/guardrails' has no exported
member 'createFactPIIGuardrail'`. Now exported (function + the four
  public types: `FactPIIGuardrailMode`, `FactPIIGuardrailOptions`,
  `FactPIICategory`, `FactPIIMatch`). The internal JSDoc example in
  `fact-pii.ts` also referenced the wrong import path (`@directive-run/ai`
  instead of `@directive-run/ai/guardrails`) — corrected.

  **`@directive-run/sources` rejected by `@directive-run/sandbox`
  validator**. The sandbox validator's `ALLOWED_DIRECTIVE_PACKAGES`
  set didn't include `sources`, so every playground snippet, MCP
  `run_in_sandbox` call, and docs live runner that imported the umbrella
  package or either subpath (`@directive-run/sources`,
  `@directive-run/sources/supabase`, `@directive-run/sources/cloudflare`)
  hard-failed with `is not allowed in the sandbox` despite the umbrella
  shipping as part of v1.18.0. Added `sources` to the allowlist and added
  two-segment-subpath coverage to the validator test grid.

  **`sourceFromSupabaseChannel` unsubscribe fires-and-forgets
  `removeChannel`**. The original issue RFC 0009 was
  designed to close: the adapter returned a sync unsubscribe that did
  `void client.removeChannel(chan)`, so `system.stopAsync()` resolved
  before the Supabase broker dropped the subscription. A subsequent
  `start → stopAsync → start` cycle double-subscribed because the broker
  still held the old channel when the new attach raced in. Per RFC 0009's
  `SourceUnsubscribe = () => void | Promise<void>` widening, the adapter
  now returns `async () => { await client.removeChannel(chan); }`. Engines
  using legacy sync `cleanupAll` still ignore the returned promise — same
  fire-and-forget behavior as before — but the broker drop is now
  observable to consumers using `stopAsync`.

  ### Documentation fixes

  **Broken cross-ref anchor**: `packages/knowledge/core/sources.md`
  linked to `ai-security.md#sources-pii--closing-the-fact-injection-bypass`
  with a single hyphen between "sources" and "pii". The actual GFM anchor
  generated from the heading `## Sources × PII — closing the fact-injection
bypass` has a double hyphen (`×` strips to a kept space). The
  highest-traffic cross-ref in the source primitive doc was landing on a
  404 anchor. Corrected to `#sources--pii--closing-the-fact-injection-bypass`.

  **RFCs 0005–0009 status flipped from Draft → Accepted**: all
  five RFCs still carried `Status: Draft (2026-06-07)` even though
  `sources.md` and `ai-sources.md` already cite them as shipped. Readers
  following the link saw Draft headers and concluded the feature was
  design-only. Status now reads: `Accepted — shipped 2026-06-07 in
feat/source-primitive (PR #52, merge ab97b028); pending v1.18.0 release`.

## 1.18.0

### Minor Changes

- [#52](https://github.com/directive-run/directive/pull/52) [`dbbeb4b`](https://github.com/directive-run/directive/commit/dbbeb4b1e0cad1d209c1fc511c1754e6c5a243e5) Thanks [@jasoncomes](https://github.com/jasoncomes)! - `createFactPIIGuardrail` — fact-store boundary PII guardrail

  Closes the source → fact → agent-prompt PII bypass: `createPIIGuardrail` and
  `createEnhancedPIIGuardrail` only inspect the `data.input` argument
  passed to `runStream(agent, input, ...)`. When a source publishes PII
  into a fact and the agent's prompt template embeds that fact
  (`"Hello ${facts.email}..."`), the PII reaches the LLM call without
  hitting the input guardrail chain.

  `createFactPIIGuardrail` is a Directive plugin (wired at
  `createSystem({ plugins: [...] })`) that scans every write to a
  `pii`-tagged fact, auto-discovered via `meta.byTag("pii")` at `onInit`.
  Two modes:

  - `"redact"` (default, safe shipping posture): rewrites the fact value
    via a follow-up store write so the next read returns the redacted
    form. The raw value briefly exists for one microtask while the
    redaction lands; downstream subscribers that snapshot at that instant
    see it; the LLM call after the next settle does not.
  - `"alert"`: fires the `onBlocked` callback but does NOT mutate the
    fact. Use for monitoring-only deployments where the source's
    transport is already trusted and you want to page on every match
    without modifying state.

  The built-in regex covers SSN, credit-card, and email. Pass a
  synchronous `customDetector` for domain-specific patterns (internal
  account numbers, partner IDs). The full async detector at
  `@directive-run/ai/guardrails/pii-enhanced` is unsuitable for this hook
  because `onFactSet` is synchronous and a deferred detection would let
  the raw PII reach observers + breakpoints + audit-ledger before the
  redaction completed.

  Wires as the Tier 0 prerequisite for the upcoming
  `runStream({ liveContext })` recipe, which would otherwise expand the
  fact-injection bypass surface into the mid-stream context updates the
  agent reads while generating.

  Hard rejection at the write boundary requires a pre-commit transform
  hook on the source primitive itself (Directive plugin hooks are
  wrapped by the plugin manager's `safeCall` and a thrown error is
  swallowed). Tracked as a future RFC. Today's `"redact"` mode is the
  safe-shipping posture.

  Docs:

  - New `packages/knowledge/ai/ai-sources.md` — AI × Sources patterns,
    three-tier lifetime ladder, `runStream({ liveContext })` recipe
    (RFC 0005 cross-ref), MCP lifecycle as a source, sources × security,
    anti-patterns (no token streaming via source, no polling from a
    constraint), `@directive-run/sources/*` adapter subpath inventory.
  - `packages/knowledge/ai/ai-security.md` — new "Sources × PII" section
    with the threat chain + the redact recipe, and a row in the quick
    reference table.
  - `packages/knowledge/core/sources.md` — "Related" links to the new
    `ai-sources.md` + `ai-security.md` anchor.

  Eight regression tests cover redact mode (string + object payloads),
  alert mode, `includeKeys` / `excludeKeys` escape hatches, and the
  custom detector composition path.

- [#52](https://github.com/directive-run/directive/pull/52) [`e0ecd16`](https://github.com/directive-run/directive/commit/e0ecd160c9c947e6c9976dfc08fdac959eb46431) Thanks [@jasoncomes](https://github.com/jasoncomes)! - `attachSourcesToOtel` — pipe core source.\* observation events into the
  same OTel tracer the AI plugin uses

  The R5 observability reviewer found `@directive-run/ai/otel.ts`
  subscribes only to the AI `DebugTimeline` event stream, so the four
  `ObservationEvent.source.*` variants (`source.attach`,
  `source.publish`, `source.detach`, `source.error`) shipped by the
  source primitive never reached the OTel exporter. SREs running with
  `createOtelPlugin` saw agent spans but could not answer "which source
  is publishing?" or "did source `mcp` error attach?" from their
  tracing backend.

  `attachSourcesToOtel(system, { tracer, serviceName })` closes the gap
  as a focused helper (not a second OTel plugin) so a single
  `OtelTracer` carries both AI and core source spans. Wire it once at
  `createSystem` time:

  ```ts
  import { trace } from "@opentelemetry/api";
  import { createOtelPlugin, attachSourcesToOtel } from "@directive-run/ai";

  const tracer = trace.getTracer("directive-app");
  const otel = createOtelPlugin({ serviceName: "my-app", tracer });

  const system = createSystem({ module });
  otel.attach(orchestrator.timeline);
  const unsub = attachSourcesToOtel(system, { tracer, serviceName: "my-app" });
  ```

  Spans emitted:

  - `directive.source.attached` — long-lived span per (sourceId,
    moduleId). Opened at attach; closed at detach with status `OK`.
  - `publish` span events on the active span (NOT new spans per
    publish — cardinality budget). At 10 sources × 100 publishes/sec
    the exporter sees 1000 events/sec on 10 long-lived spans, well
    within typical OTel collector budgets.
  - `directive.source.error` — short-duration error-status span with
    `directive.phase`, `error.message` (truncated by the manager at the
    R7 boundary).

  Optional `publishSampleRate` (default 1.0) sub-samples publish events
  for very high-throughput sources.

  Tests: 4 regression tests covering attach → detach span lifecycle,
  publish-as-event-on-active-span, error span shape, and unsubscribe
  behavior.

  The complementary `@directive-run/ai/devtools-server.ts` integration
  (extend `DevToolsServerMessage` with source.\* variants) is deferred to
  its own PR — documented in `docs/IDEAS.md`.

- [#52](https://github.com/directive-run/directive/pull/52) [`901836e`](https://github.com/directive-run/directive/commit/901836ec59fdb7444b24695ff385b327376382e5) Thanks [@jasoncomes](https://github.com/jasoncomes)! - `runStream({ liveContext })` — Reactive Agents (RFC 0005)

  Additive `liveContext` option on `orchestrator.runStream()` that turns
  sources into a feedback loop for the in-flight LLM run. The agent's
  view of the world stays in sync with reality: a source publishes a
  fact update, the orchestrator emits a `context_updated` chunk, and
  when `interruptWhen` returns `true` the LLM run is aborted and an
  `interrupted` chunk lands on the stream.

  The implementation is **231 LOC** in `agent-orchestrator.ts` —
  comfortably under the RFC 0005 300-LOC scope guard. The bridge re-uses
  the same `system.facts.$store.subscribe(keys, cb)` mechanism the
  breakpoint + approval waiters already wire (no new primitives needed
  on the core side).

  ### Additive surfaces

  **`OrchestratorStreamChunk` union** — two new variants:

  - `{ type: "context_updated"; changedKeys: readonly string[] }` —
    emitted on watched-fact changes. Always emitted when `notifyOn:
"all-changes"`; emitted only for changes that trigger an interrupt
    when `notifyOn: "interrupt-only"` (default).
  - `{ type: "interrupted"; reason: string; partialOutput: string; changedKeys: readonly string[] }` —
    emitted when `interruptWhen` returns `true` OR when the consumer
    calls `result.interrupt(reason?)`. Carries the partial LLM output
    accumulated up to the abort point so a consumer can stitch a
    retry prompt.

  **`OrchestratorStreamResult`** — new `interrupt(reason?: string): void`
  method. Distinct from `abort()`: `abort` tears down the AsyncIterable
  AND detaches `liveContext`; `interrupt` cancels the LLM run but leaves
  fact subscriptions alive so the next caller-driven prompt continues
  against fresh facts.

  **`runStream` options** — accepts `liveContext: LiveContextOptions<F>`:

  ```ts
  const result = orchestrator.runStream(agent, input, {
    liveContext: {
      system: marketSystem,
      keys: ["lastPrice", "lastVolume"],
      interruptWhen: (facts, changedKeys) =>
        Math.abs(facts.lastPrice - facts.openPrice) > 5,
      mode: "restart", // reserved for follow-up minor; today's
      // landing ships "inject-system-message"
      // behavior (consumer re-prompts)
      notifyOn: "interrupt-only", // default; "all-changes" is the noisier variant
      onContextUpdate: (keys) =>
        Sentry.addBreadcrumb(`liveContext: ${keys.join(",")}`),
    },
  });

  for await (const chunk of result.stream) {
    if (chunk.type === "token") process.stdout.write(chunk.data);
    if (chunk.type === "interrupted") {
      console.log(
        `Agent interrupted: ${chunk.reason}; partial: ${chunk.partialOutput}`
      );
      // Optionally call orchestrator.runStream again with fresh context.
    }
  }
  ```

  ### Security companion

  `createFactPIIGuardrail` (shipped in the prior phase) is the
  **mandatory** companion when `liveContext` watches facts that may
  carry PII. Without it, `liveContext` expands the source → fact →
  prompt PII bypass surface into mid-stream context updates the agent
  reads while generating. The new `ai-sources.md` recipe documents this
  gating.

  ### Multi-agent orchestrator

  `OrchestratorStreamResult` shapes constructed inside
  `multi-agent-orchestrator.ts` gain `interrupt()` stubs that map to
  `abort()` — multi-agent delegate / task streams don't carry
  `liveContext` bindings of their own, so the distinction collapses
  there.

  ### Tests

  5 new regression tests covering the chunk variant shapes (type
  narrowing + payload fields), the `interruptWhen` default
  (`() => true` — any watched-key change interrupts), the false-path
  ("interrupt only when threshold crossed") behavior, and end-to-end
  AsyncIterable drainage of `context_updated` → `interrupted` →
  `done`. AI suite: 1506 → 1511 passing.

  ### Status

  Ships the additive surface + the `liveContext` event loop. The
  `mode: "restart"` variant ships the chunk-emission contract today
  (consumer re-prompts via a fresh `runStream` call — matches the
  documented `"inject-system-message"` mode); automatic re-invocation
  on `"restart"` is reserved for a follow-up minor once the
  multi-step prompt-merging strategy is locked in.

### Patch Changes

- [#52](https://github.com/directive-run/directive/pull/52) [`08d84df`](https://github.com/directive-run/directive/commit/08d84dfe4ac558d2dd9013407e6b12a60ec6cfac) Thanks [@jasoncomes](https://github.com/jasoncomes)! - Source primitive RFCs — review close-out: public alias exports + interrupt() semantic + evict(deadline) detached-work + liveContext setup hoist + self-loop guard + docs drift

  A review of the five RFC implementations (0005-0009) surfaced one
  critical and several major issues. All shipped without prior review
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

- [#52](https://github.com/directive-run/directive/pull/52) [`dc30477`](https://github.com/directive-run/directive/commit/dc30477379def350bcf8998b9ce3883641e71bbd) Thanks [@jasoncomes](https://github.com/jasoncomes)! - `createFactPIIGuardrail` Luhn validation + `attachSourcesToOtel` span-leak fix + `walkDepth` option

  Three targeted fixes against the Tier 1 phases shipped immediately
  before this patch.

  **`createFactPIIGuardrail` — credit-card false positives.** The R9
  self-review found the inlined `\b(?:\d[ -]?){13,19}\b` regex would
  sweep up phone numbers, tracking IDs, and any 13-19 digit sequence
  formatted with separators as credit cards. The shipping path now
  mirrors `pii-enhanced.ts`'s detection: a broader 4-4-4-4 / 13-19
  unseparated regex paired with a synchronous Luhn checksum validator.
  Phone numbers, sequence IDs, and other long digit runs that don't pass
  Luhn are NOT redacted. The canonical Visa test number
  (`4111 1111 1111 1111`) continues to redact correctly.

  **`createFactPIIGuardrail` — `walkDepth` option for nested objects.**
  The previous one-level object walk silently passed deeper PII (e.g.
  `{ profile: { email } }`) through unredacted. The R9 review flagged
  this as a security limitation that wasn't documented. The plugin now
  accepts an optional `walkDepth: 1 | 2 | 3 | 4 | 5` (default `1`,
  clamped to `[1, 5]` to prevent pathological recursion on cyclic
  structures). Arrays, Maps, and Sets remain out of scope at any depth —
  consumers with those shapes should pass a `customDetector` that walks
  the consumer-specific structure.

  **`attachSourcesToOtel` — active spans no longer leak on unsubscribe.**
  The R9 review found the helper's returned unsubscribe just detached the
  `system.observe()` subscriber, leaving every active `directive.source.attached`
  span open forever in the collector. The helper now ends each active
  span with status `OK` and a `directive.detached: true` attribute when
  the consumer detaches the wiring. Collectors that retain unfinished
  spans no longer accumulate them across `attachSourcesToOtel` /
  unsubscribe cycles.

  Tests: +3 regression tests (Luhn rejection on non-card 16-digit
  sequences, `walkDepth: 1` default leaves nested PII alone, `walkDepth: 3`
  walks deeper). Fact-PII test file 8 → 11; `otel-sources.test.ts` test 4
  rewritten to assert the new no-leak contract; AI suite 1503 → 1506.

## 1.17.2

## 1.17.1

## 1.17.0

## 1.16.0

## 1.15.0

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

## 1.9.0

## 1.8.0

## 1.7.0

## 1.6.1

## 1.6.0

## 1.5.0

### Minor Changes

- [`e3b4cc6`](https://github.com/directive-run/directive/commit/e3b4cc661679e267039e2a64ee85d32f2fc00ddd) Thanks [@jasoncomes](https://github.com/jasoncomes)! - PII guardrails: split detection from redaction

  `detectPII` is now **detection-only**. The `redact` and `redactionStyle`
  options have been removed – `detectPII(text, options)` returns a
  `PIIDetectionResult` whose `redactedText` is always `undefined`. A new
  `detectAndRedactPII` helper covers the previous one-shot detect-and-redact
  shape.

  This is a small shape change on a utility export that hadn't reached a
  stable 1.x API contract; the migration is a one-line drop-in. Treating it
  as a `minor` reflects the practical migration cost rather than a wholesale
  v2 commitment.

  ### Migration

  Calls that relied on `detectPII(text, { redact: true, redactionStyle })`
  no longer compile. Pick the form that matches your usage:

  ```ts
  // Before
  const result = await detectPII(text, {
    redact: true,
    redactionStyle: "typed",
  });
  // result.redactedText -> the redacted string

  // After (one-shot, equivalent shape)
  import { detectAndRedactPII } from "@directive-run/ai";
  const result = await detectAndRedactPII(text, { style: "typed" });
  // result.redactedText -> the redacted string

  // After (separated – detect once, redact later)
  import { detectPII, redactPII } from "@directive-run/ai";
  const result = await detectPII(text);
  const redacted = result.detected
    ? redactPII(text, result.items, "typed")
    : text;
  ```

  `detectAndRedactPII` accepts every `detectPII` option plus an optional
  `style?: RedactionStyle`, and populates `redactedText` only when PII is
  actually detected (`undefined` otherwise).

  ### Also in this release

  - **`national_id` is now detectable** as a first-class `PIIType`.
  - **`redactPII` overlap handling fixed** – overlapping or adjacent matches
    no longer corrupt the redacted output.
  - **New PII type exports** for consumers building custom detectors and
    redaction flows (`PIIDetectionResult`, `DetectedPII`, `PIIType`,
    `PIIDetector`, `RedactionStyle`).

## 1.4.0

## 1.3.0

## 1.1.2

## 1.1.1

## 1.1.0

## 1.0.1

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

### Patch Changes

- Updated dependencies [[`a6a23b2`](https://github.com/directive-run/directive/commit/a6a23b2e52377a07bbbde52a89dcffcc3db2f826)]:
  - @directive-run/core@1.0.0

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

## 0.8.5

## 0.8.4

## 0.8.3

## 0.8.2

## 0.8.1

## 0.8.0

## 0.7.0

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

## 0.4.2

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
