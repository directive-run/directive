---
"@directive-run/core": minor
"@directive-run/ai": minor
"@directive-run/sources": minor
---

R13 audit — 5 remaining Critical fixes to documented surfaces of the source primitive

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
