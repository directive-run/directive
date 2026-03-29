---
"@directive-run/core": patch
"@directive-run/devtools": patch
"@directive-run/react": patch
"@directive-run/vue": patch
"@directive-run/svelte": patch
"@directive-run/solid": patch
---

Monorepo audit fixes: performance, types, adapters, community infra

- core: Add `getInflightCount()` to ResolversManager – zero-allocation hot path for `isSettled` and `settle()`
- devtools: Unify protocol types with `@directive-run/ai` – 7 new event types (checkpoint, task, goal), shared DebugEventType/BreakpointState
- devtools: Interactive JsonTree data explorer, refetch/invalidate/reset action buttons, detectKind fix for subscriptions/infinite queries
- adapters: Cache `require("@directive-run/query")` in module-level lazy helper, add as optional peerDependency
- adapters: `useQuerySystem` accepts config objects directly (no factory wrapper)
