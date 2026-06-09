---
"@directive-run/core": patch
"@directive-run/ai": patch
---

R14 follow-on — MCP holder factory + plugin broadcast snapshot + createFactPIIGuardrail main barrel

Three small follow-on fixes for issues surfaced during R14 that R14 Tier 1 didn't cover:

**MCP holder pattern — multi-tenant safe factory** (R14-C2). The MCP source recipe in `ai-sources.md` declared `let publishRef: SourcePublish | null = null` at module scope. Importing the module twice (one Directive system per tenant DO; SSR with one module instance per worker; Vitest with hot-reload boundaries) made the LAST `attach` overwrite the holder — first tenant's adapter callbacks routed into the second tenant's facts. Recipe now wraps adapter + module construction in a `makeOrchestrator()` factory so each call yields an isolated closure pair. Multi-tenant + SSR + hot-reload safe.

**`broadcast` snapshots `plugins` before iteration**. A plugin hook callback that called `manager.unregister(...)` (or whose `system.observe()` unsubscribe spliced the array) used to shift indices mid-iteration, silently skipping the NEXT plugin — typically the audit-ledger or `createFactPIIGuardrail`. The broadcaster now iterates a snapshot taken at call time, so reentrant `unregister` no longer corrupts the broadcast.

**`createFactPIIGuardrail` re-exported from `@directive-run/ai` main barrel** (R14-MAJ from AI Integration lens). The Tier 0 Mandatory Companion to `liveContext` was the only guardrail not on the main barrel. Other guardrails (`createPIIGuardrail`, etc.) ship as `@deprecated` re-exports for back-compat; `createFactPIIGuardrail` now ships the same way. Consumers who follow the "main-barrel" idiom every other guardrail supports will find it.
