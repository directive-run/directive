---
"@directive-run/timeline": patch
---

Surface "0 dispatched / N skipped" replay no-ops as a dev-mode warning, plus README cleanup.

`replayTimeline(...)` returns `{ dispatched: 0, skipped: N, truncated: 0 }` when recorded frames don't match `isDispatchable()` — which today recognises only mutator-shape `pendingMutation` fact-change frames. Anyone replaying a non-mutator timeline saw the function return without dispatching anything and assumed it had silently no-op'd.

When the call dispatched zero of >0 candidate frames and we're not in production, the package now emits one structured `console.warn` pointing at the `isDispatchable` source so the reader can see exactly which event shape is currently supported. Production builds stay silent so deployed replay loops don't spam logs.

The behaviour itself is unchanged — the function returns the same `ReplayResult` shape.

**README**: replaced four references to an undefined `flushAsync()` with `system.settle()` (the correct reconcile-wait primitive Directive ships).
