---
"@directive-run/ai": patch
"@directive-run/core": patch
---

R14 audit Tier 1 — walker DoS / PII bypass + onContextUpdate ordering + mode deprecation restore + docs

The R14 multi-lens audit against the v1.19.0 source-primitive surface
returned ~30 Critical findings. This patch closes the four highest-
impact Critical clusters; the remaining items are tracked for a
follow-up minor.

### Critical fixes

**Walker DoS + PII bypass** (R14-C1, closes 5+ reviewer findings —
Security, Architecture, Red Team x3, Privacy, Distrib Systems, Domain
Expert). R13-C6's array recursion fix passed `depth` raw on the array
branch and did NOT snapshot the array before iterating. Three exploit
chains landed simultaneously: (a) a deeply-nested
`[[[[...]]]]` payload bypassed the documented `walkDepth ≤ 5` bound
and overflowed the call stack, with the `safeCall` plugin wrapper
swallowing the throw — leaving the raw PII committed in the fact
store. (b) Cyclic arrays (`const a = []; a.push(a)`) recursed forever
into the same overflow. (c) A `Proxy` whose `.get(0)` returned PII on
the live read but benign content on the `[...value]` spread leaked
PII into the redacted output at the un-walked indices (TOCTOU).
Real-world attack surface: any source where the attacker controls
payload shape — Supabase RPC, MCP resource list, webhook bodies.

The fix in `packages/ai/src/guardrails/fact-pii.ts`: (1) decrement
`depth` on the array branch (matches the object branch), (2) snapshot
the array via `[...value]` BEFORE the loop and iterate the snapshot,
(3) track visited references via `WeakSet` and bail on revisit.
Closes the stack-overflow + cycle + Proxy chains with one ~10-line
fix. Two new regression tests cover the new bound and the cycle
guard; the existing R13-C6 array tests still pass.

**`liveContext.onContextUpdate` call order matched to JSDoc**
(R14-C4). The JSDoc declared `onContextUpdate` "fires AFTER the
`interruptWhen` predicate runs but BEFORE the chunk emits" — the
impl called `onContextUpdate` FIRST. The instrumentation hook
couldn't observe interruption decisions, defeating the documented
use case. Swap the order, AND wrap both callbacks in try/catch so a
throw inside `interruptWhen` or `onContextUpdate` no longer
propagates back through `notifyKey` → `flush` → the source's
publish handler (which used to kill the publisher entirely and
skip every downstream listener in the notify cycle).

**`LiveContextOptions.mode` restored as `@deprecated` for source-compat**
(R14-C5). v1.18.0 shipped to npm with `mode: "inject-system-message"
| "restart"` on the public `LiveContextOptions` interface. v1.19.0
removed it. The Tier 2 changeset asserted "v1.18.0 has not yet
shipped" — `npm view @directive-run/ai time` says otherwise (1.18.0
published 2026-06-08 05:42 UTC, 1.19.0 published 2026-06-09 14:21
UTC — 32hr live with the field). Removing an exported field of an
exported type is a breaking change requiring a major bump; shipping
it as minor was a semver violation. This patch restores the field
as `@deprecated` with a one-shot runtime warning when consumers set
it (no behavior change — abort-and-emit is still the only path).
Field will be removed properly in v2.0 with a deprecation cycle.

### Documentation fixes

**Source primitive doc cluster** (R14-C3). The `onEvict` recipe in
`packages/knowledge/core/sources.md` referenced a `ch` variable
defined in a sibling closure — a copy-paste consumer would hit
`ReferenceError`. Rewrote using the holder + closure bridge pattern
(`let channel = null` shared between `attach` and `onEvict`).
`packages/knowledge/ai/ai-sources.md` still documented the removed
`mode: "restart"` field — replaced with the actual shipped behavior
description. The adapter table referenced a non-existent
`sourceFromWebSocket()` adapter as the canonical WebSocket bridge —
clarified that the Cloudflare DO adapter `sourceFromWebSocketMessage()`
is the shipped path; the generic helper is queued for a follow-up
RFC. RFC 0005 self-contradicted on `liveContext.guardrails` (drafted
field vs. shipped `createFactPIIGuardrail`) and listed an "Open
question" about a removed `mode: "restart"` semantic — both
rewritten to match the shipped state.
