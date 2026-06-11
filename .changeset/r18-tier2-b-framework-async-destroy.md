---
"@directive-run/react": patch
"@directive-run/vue": patch
"@directive-run/svelte": patch
"@directive-run/solid": patch
"@directive-run/lit": patch
---

R18 Tier 2-B — framework adapter async-destroy migration.

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
