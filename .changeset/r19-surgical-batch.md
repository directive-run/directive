---
"@directive-run/core": patch
"@directive-run/ai": patch
"@directive-run/lit": patch
"@directive-run/react": patch
"@directive-run/vue": patch
"@directive-run/svelte": patch
"@directive-run/solid": patch
---

R19 surgical hardening batch — closes audit findings on top of the v1.20.x release.

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
  to `destroyAsync().catch(...)`. The R18 Tier 2-B migration covered
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

Closes R19 Critical findings 1, 2, 5 and Major findings 1, 3, 4 (Sec
lens) + 3, 5, 8 (Arch lens). Bigger Tier 2 items deferred to RFCs:
Supabase channel-name reuse race, `attachGuardrailsToOtel` helper,
timeline `guardrail.blocked` renderer, knowledge-bundle docs sync.
