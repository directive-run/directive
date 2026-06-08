---
"@directive-run/core": patch
"@directive-run/ai": patch
---

Source primitive RFCs — R11 close-out: public alias exports + interrupt() semantic + evict(deadline) detached-work + liveContext setup hoist + self-loop guard + docs drift

R11 audit on the 5 RFC implementations (0005-0009) surfaced one
Critical and several Major issues. All shipped without prior review
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
