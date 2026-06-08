# @directive-run/sources

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
