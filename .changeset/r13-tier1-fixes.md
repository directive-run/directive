---
"@directive-run/ai": patch
"@directive-run/sandbox": patch
"@directive-run/sources": patch
---

R13 audit — 5 Critical fixes to documented surfaces of the source primitive

The post-merge R13 audit (full 13-lens panel against the merged
`feat/source-primitive` work) found five Critical issues affecting
consumer-facing documented APIs of v1.18.0. All five close in this patch.

### Critical fixes

**`createFactPIIGuardrail` not exported from `@directive-run/ai/guardrails`
subpath** (R13-C2). The Tier 0 Mandatory Companion to `liveContext` was
declared in `guardrails/index.ts` but the actual tsup entry for the
subpath (`src/guardrails-export.ts`) didn't re-export it. Every recipe in
`packages/knowledge/ai/ai-sources.md` (Sources × Security section) failed
at import time: `Module '@directive-run/ai/guardrails' has no exported
member 'createFactPIIGuardrail'`. Now exported (function + the four
public types: `FactPIIGuardrailMode`, `FactPIIGuardrailOptions`,
`FactPIICategory`, `FactPIIMatch`). The internal JSDoc example in
`fact-pii.ts` also referenced the wrong import path (`@directive-run/ai`
instead of `@directive-run/ai/guardrails`) — corrected.

**`@directive-run/sources` rejected by `@directive-run/sandbox`
validator** (R13-C3). The sandbox validator's `ALLOWED_DIRECTIVE_PACKAGES`
set didn't include `sources`, so every playground snippet, MCP
`run_in_sandbox` call, and docs live runner that imported the umbrella
package or either subpath (`@directive-run/sources`,
`@directive-run/sources/supabase`, `@directive-run/sources/cloudflare`)
hard-failed with `is not allowed in the sandbox` despite the umbrella
shipping as part of v1.18.0. Added `sources` to the allowlist and added
two-segment-subpath coverage to the validator test grid.

**`sourceFromSupabaseChannel` unsubscribe fires-and-forgets
`removeChannel`** (R13-C4). The original R5-CR1 issue RFC 0009 was
designed to close: the adapter returned a sync unsubscribe that did
`void client.removeChannel(chan)`, so `system.stopAsync()` resolved
before the Supabase broker dropped the subscription. A subsequent
`start → stopAsync → start` cycle double-subscribed because the broker
still held the old channel when the new attach raced in. Per RFC 0009's
`SourceUnsubscribe = () => void | Promise<void>` widening, the adapter
now returns `async () => { await client.removeChannel(chan); }`. Engines
using legacy sync `cleanupAll` still ignore the returned promise — same
fire-and-forget behavior as before — but the broker drop is now
observable to consumers using `stopAsync`.

### Documentation fixes

**Broken cross-ref anchor** (R13-C9): `packages/knowledge/core/sources.md`
linked to `ai-security.md#sources-pii--closing-the-fact-injection-bypass`
with a single hyphen between "sources" and "pii". The actual GFM anchor
generated from the heading `## Sources × PII — closing the fact-injection
bypass` has a double hyphen (`×` strips to a kept space). The
highest-traffic cross-ref in the source primitive doc was landing on a
404 anchor. Corrected to `#sources--pii--closing-the-fact-injection-bypass`.

**RFCs 0005–0009 status flipped from Draft → Accepted** (R13-C10): all
five RFCs still carried `Status: Draft (2026-06-07)` even though
`sources.md` and `ai-sources.md` already cite them as shipped. Readers
following the link saw Draft headers and concluded the feature was
design-only. Status now reads: `Accepted — shipped 2026-06-07 in
feat/source-primitive (PR #52, merge ab97b028); pending v1.18.0 release`.
