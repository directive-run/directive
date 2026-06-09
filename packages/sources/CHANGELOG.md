# @directive-run/sources

## 0.3.0

### Minor Changes

- [#55](https://github.com/directive-run/directive/pull/55) [`5c7a2d6`](https://github.com/directive-run/directive/commit/5c7a2d60f71f527e9afd85a67afa36f61fc0bdfc) Thanks [@jasoncomes](https://github.com/jasoncomes)! - R13 audit — 5 remaining Critical fixes to documented surfaces of the source primitive

  This patch closes the 5 R13 CRITs that affect documented but unreachable
  or misleading public APIs of v1.18.0. With Tier 1 (already merged) +
  this Tier 2, all 10 R13 ship-blocking CRITs are resolved.

  ### Critical fixes

  **`System.stopAsync` / `destroyAsync` / `evict` wired through
  `createSystem` wrappers** (R13-C1). Engine implemented these per RFC
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

  **Cloudflare DO adapters accept `onEvict`** (R13-C5). `sourceFromDOAlarm`
  and `sourceFromWebSocketMessage` are the literal target runtime for RFC
  0009, yet neither adapter accepted or forwarded an `onEvict` option.
  With this change both adapters expose `onEvict?: () => void | Promise<void>`
  on their options interface. Defaults: `DOAlarm` clears the pending
  alarm via `storage.deleteAlarm()`; `WebSocketMessage` closes the socket
  with code 1001 `"going-away"`. Consumers can override to skip the
  default (e.g. when the runtime hibernates WebSockets natively) or to
  add pre-hibernation work (flush audit log, signal broker). 4 new
  regression tests covering default + custom `onEvict` for both adapters.

  **`createFactPIIGuardrail` walker recurses into arrays** (R13-C6). The
  walker previously short-circuited on `Array.isArray(value)`, so the
  dominant real-world Supabase realtime shape
  (`payload.new = [{ email, ... }]`) and MCP resource-list notifications
  silently bypassed the Tier 0 guard. The walker now inspects array
  elements at the same depth budget, rebuilding the array if any element
  matched. Maps and Sets remain out of scope by design (consumers must
  wire a `customDetector` for those). 2 new regression tests covering
  both "array of PII objects" and "array of PII strings" shapes.

  **RFC 0005 `mode` field removed** (R13-C7). The field
  `liveContext.mode: "inject-system-message" | "restart"` shipped on the
  public API but was never read by the impl. The name
  `"inject-system-message"` falsely implied mid-stream injection; the
  actual behavior is abort-and-emit. Since v1.18.0 has not yet shipped,
  the field is removed cleanly (no deprecation tail to maintain). The
  auto-re-prompt semantics will ship in a follow-up RFC + field together
  once their design is settled. RFC 0005 + `ai-sources.md` updated.

  ### Documentation fixes

  **MCP source recipe rewritten against the real adapter API** (R13-C8).
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

- [#55](https://github.com/directive-run/directive/pull/55) [`9ffd758`](https://github.com/directive-run/directive/commit/9ffd7584914b93ca840ae84372fe3e83c75f29e8) Thanks [@jasoncomes](https://github.com/jasoncomes)! - R13 audit — 5 Critical fixes to documented surfaces of the source primitive

  The post-merge R13 audit (full 13-lens panel against the merged
  `feat/source-primitive` work) found five Critical issues affecting
  consumer-facing documented APIs of v1.18.0. All five close in this patch.

  ### Critical fixes

  **`createFactPIIGuardrail` not exported from `@directive-run/ai/guardrails`
  subpath** (R13-C2). The Tier 0 Mandatory Companion to `liveContext` was
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
  validator** (R13-C3). The sandbox validator's `ALLOWED_DIRECTIVE_PACKAGES`
  set didn't include `sources`, so every playground snippet, MCP
  `run_in_sandbox` call, and docs live runner that imported the umbrella
  package or either subpath (`@directive-run/sources`,
  `@directive-run/sources/supabase`, `@directive-run/sources/cloudflare`)
  hard-failed with `is not allowed in the sandbox` despite the umbrella
  shipping as part of v1.18.0. Added `sources` to the allowlist and added
  two-segment-subpath coverage to the validator test grid.

  **`sourceFromSupabaseChannel` unsubscribe fires-and-forgets
  `removeChannel`** (R13-C4). The original R5-CR1 issue RFC 0009 was
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

  **Broken cross-ref anchor** (R13-C9): `packages/knowledge/core/sources.md`
  linked to `ai-security.md#sources-pii--closing-the-fact-injection-bypass`
  with a single hyphen between "sources" and "pii". The actual GFM anchor
  generated from the heading `## Sources × PII — closing the fact-injection
bypass` has a double hyphen (`×` strips to a kept space). The
  highest-traffic cross-ref in the source primitive doc was landing on a
  404 anchor. Corrected to `#sources--pii--closing-the-fact-injection-bypass`.

  **RFCs 0005–0009 status flipped from Draft → Accepted** (R13-C10): all
  five RFCs still carried `Status: Draft (2026-06-07)` even though
  `sources.md` and `ai-sources.md` already cite them as shipped. Readers
  following the link saw Draft headers and concluded the feature was
  design-only. Status now reads: `Accepted — shipped 2026-06-07 in
feat/source-primitive (PR #52, merge ab97b028); pending v1.18.0 release`.

## 0.2.0

### Minor Changes

- [#52](https://github.com/directive-run/directive/pull/52) [`c31d22d`](https://github.com/directive-run/directive/commit/c31d22d94671ee15cc943bc07946a96848ba64fc) Thanks [@jasoncomes](https://github.com/jasoncomes)! - `@directive-run/sources` — umbrella package with per-vendor subpath exports

  New package wrapping the most common external event streams as typed
  Directive `source` primitives. One install, optional peerDependencies
  per vendor.

  **Subpaths shipped in 0.1.0:**

  - `@directive-run/sources/supabase` — `sourceFromSupabaseChannel({ client, channel, events, redactRow? })`.
    Wraps Supabase realtime channels with declarative event bindings
    (`{ event, table, filter?, map }`). Optional `redactRow` runs at the
    payload boundary so PII can be stripped before the `map` callback
    sees it — defense in depth alongside `createFactPIIGuardrail`.
  - `@directive-run/sources/cloudflare` — `sourceFromDOAlarm({ storage, intervalMs, eventName, payload? })`
    and `sourceFromWebSocketMessage({ socket, decode, closeEvent?, errorEvent? })`.
    DO alarms replace the canonical `setInterval`-inside-`attach` recipe
    that dies on hibernation; the alarm survives eviction via DO storage.
    The WebSocket adapter wraps `addEventListener('message' | 'close' | 'error')`
    with typed Directive events.

  Vendor peerDependencies (`@supabase/supabase-js`, `@cloudflare/workers-types`)
  are optional and only need to be installed when the consumer imports
  the matching subpath.

  Future subpaths (`/websocket` for raw browser WebSocket, `/sentry` for
  production error streams, `/eventsource` for SSE) land additively as
  single subpath additions.

  Tests: 9 regression tests covering channel binding + redaction + cleanup
  on stop (Supabase) and alarm scheduling + tick / clear + WebSocket
  listener teardown (Cloudflare).

  Docs:

  - README in the package surfaces the install, subpath inventory, and
    three quick-start examples.
  - `packages/knowledge/ai/ai-sources.md` lists the subpath inventory
    under "Adapter packages".
