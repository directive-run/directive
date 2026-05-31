---
"@directive-run/knowledge": patch
---

Rewrite `core/react-adapter.md` and `ai/ai-orchestrator.md` against the
actual v1.14 exports. Both files were teaching hallucinated APIs that
caused every LLM scaffolding code from these knowledge files to fail
at import time or runtime.

The React adapter file had been teaching `useEvent` (singular),
`useSystem` as a top-level import, `DirectiveProvider` as a top-level
import, and `useDirectiveContext` — none of which exist as top-level
exports. The rewrite leads with the canonical `createDirectiveContext`
pattern (the actual sanctioned way to share a system across a
component tree) and shows the typed standalone hooks (`useFact`,
`useDerived`, `useEvents`, `useDispatch`, `useSelector`, `useDirective`)
in full runnable example files. The hallucinations are now called out
inline with a "use instead" table.

The AI orchestrator file had been teaching five hook names
(`onStart`, `onBeforeRun`, `onAfterRun`, `onError`, `onBudgetWarning`
inside `hooks`) that don't exist on `OrchestratorLifecycleHooks`,
along with a sync `checkpoint()` that's actually async, a
`createAgentOrchestrator({ checkpoint })` restore option that doesn't
exist (real flow: `orch.restore(cp)` on an existing instance), and
state fields (`runCount`, `lastError`, `tokenUsage.total`) that don't
match `AgentState`. The rewrite shows the real hook names
(`onAgentStart` / `onAgentComplete` / `onAgentError` / `onAgentRetry`
/ `onGuardrailCheck`), the correct top-level placement of
`onBudgetWarning`, async checkpoint flow, the `{ stream, result,
abort }` shape returned by `runStream`, and the actual nested-under-
`agent` state read path.

Both files now use full runnable file examples (imports + exports +
runnable) instead of fragments, so LLMs aren't forced to fill in
missing imports with guessed paths.

No code changes; no API changes; this is a content fix to the
published knowledge package.
