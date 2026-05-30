---
"@directive-run/vite-plugin-api-proxy": minor
"@directive-run/query": patch
"@directive-run/timeline": patch
---

Subscription cleanup, atomic tag invalidation, CORS preflight, louder matcher registration.

- `@directive-run/vite-plugin-api-proxy`: new `cors?: boolean | CorsOptions`
  per-route option that wires up an opt-in OPTIONS preflight responder. Without
  this, any cross-origin browser caller using a non-CORS-safelisted header
  (e.g. `x-api-key`) failed preflight before it could even reach the proxy.
- `@directive-run/query`: subscriptions whose `key()` returns `null` now
  reset both the in-memory prev-key bookkeeping and the resource state back
  to idle, so a future re-key to the same value establishes a fresh
  subscription (instead of the early-return skipping setup). Tag
  invalidation in `withQueries` now runs the "clear invalidated tags +
  fire each matching query trigger" sequence inside `$store.batch(...)`
  so a subscriber listening on both sides cannot observe a half-applied
  state.
- `@directive-run/timeline`: matcher auto-registration emits a clear
  `console.warn` when `globalThis.__vitest_expect` isn't available
  instead of failing silently. The explicit `registerMatchers(expect)`
  path suppresses the duplicate warning. A new `isAutoRegistered()`
  helper lets tests assert the side-effect path took effect.
