---
"@directive-run/ai": patch
"@directive-run/core": patch
---

R15 surgical hardening — walker Proxy / cycle / NaN defenses + emitInit cascading registration + MCP recipe enforcement

R15 audit against v1.19.1 surfaced three new Proxy-based attack chains in the walker that the R14 array-snapshot fix introduced (each patch round opens a slightly different bypass; this round trades narrower fixes for an architectural rewrite that's queued separately). One asymmetric snapshot bug in `emitInit`, one NaN clamp gap, and a documented-only multi-tenant pattern with a prose/code contradiction.

### Walker hardening

**Proxy iterator DoS — array length cap** (R15-CRIT-1). A `Proxy` whose target is array-shaped (so `Array.isArray` returns `true`) but whose `Symbol.iterator` yields an arbitrary count blocked the event loop / OOM-ed the worker during `[...value]` spread. The throw from V8's allocation failure was swallowed by `safeCall` at the plugin boundary so the raw PII committed to the store unredacted. Walker now caps any single array snapshot at `MAX_ARRAY_SCAN = 10_000` elements (via `Array.prototype.slice.call`), emits a `console.warn` so consumers see the truncation, and leaves elements past the cap as-is in the redacted output.

**Proxy throw bypass — try/catch wraps structural walk** (R15-CRIT-2). A `Proxy` whose `Symbol.iterator` returned `undefined` (or whose `ownKeys` trap threw) used to crash the walker; the throw was swallowed by `safeCall` and the raw PII committed. The walker now wraps the structural walk in `try/catch` — a hostile shape becomes "no match" rather than a silent commit, with a `console.warn` so the gap is visible.

**Cycle guard switched from permanent WeakSet to in-progress tracking** (R15-CRIT-3). The R14 cycle guard added every visited object to a permanent WeakSet — a non-cyclic payload that re-used the same object reference at multiple slots (`{ primary: user, secondary: user }`) redacted the first occurrence but skipped every subsequent one. Real-world hits: Supabase `{old: row, new: row}` UPDATE with no changes; MCP resource notifications that include the same contact card under `primary` AND `recipients[]`; webhook batches with deduped IDs. Switched to per-walk in-progress: add on entry, remove on exit (`try / finally`). Catches true ancestor cycles, permits shared leaves.

**`walkDepth: NaN` clamp** (R15-MAJ-4). `Math.floor(NaN)` returned NaN, `Math.max/min` short-circuited to NaN, `NaN <= 0` was `false` — the bound never triggered, and on a deeply-nested non-cyclic shape the walker exhausted the stack with `safeCall` swallowing the throw. Clamp now guards with `Number.isFinite(walkDepth)` and falls back to default `1`.

**Object branch `Object.entries` try/catch**. Wrapped the `Object.entries(value)` call in `try/catch` so a `Proxy` whose `ownKeys` trap throws is treated as "no match" rather than crashing the walker.

### Plugin manager

**`emitInit` loop-until-quiet** (R15-C1). The R14 broadcast snapshot fix patched only sync `broadcast`; async `emitInit` still iterated the live array, so a plugin whose `onInit` called `manager.unregister(otherName)` between awaits could silently skip the next un-init'd plugin — typically `createFactPIIGuardrail` or `audit-ledger`. The previous snapshot-only fix attempt broke the audit-ledger's cascading-registration pattern (`onInit` calls `system.observe(...)` which registers an observer plugin mid-init, whose own `onInit` must fire to bridge engine events to the ledger). Final shape: track init'd plugins via a `WeakSet`, loop the live array until no plugin remains uninit'd, cap at 100 passes to bound an adversarial register-loop. Handles both index-shift and cascading-registration without regressing either.

### Documentation

**`walkDepth` JSDoc rewrite** (R15-M3). Default `walkDepth: 1` did NOT scan the documented dominant Supabase realtime shape (`{ new: [{ email }] }`) because the chain is object → array → object → string (4 levels). JSDoc now lists the canonical real-world shapes with the `walkDepth` they need (flat object: 1, nested object: 2, Supabase row: 4, MCP resource list: 4). Plus documents the hard caps (`MAX_ARRAY_SCAN = 10_000`, cycle guard, finite-only `walkDepth`).

**MCP factory recipe contradiction fixed** (R15-C2). Previous prose said "if you create the adapter outside the factory, pass it in per call too" while the code example wrapped both adapter AND module construction inside the factory. The "pass it in per call" path re-introduced the multi-tenant cross-contamination R14-C2 was supposed to close: the adapter's `events.onConnect` is bound at adapter-construction time to whichever factory's `publishRef` was in scope first. Recipe now says explicitly: BOTH adapter and module MUST be constructed inside the same factory; sharing the adapter across factory calls is unsafe.
