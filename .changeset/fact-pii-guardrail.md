---
"@directive-run/ai": minor
---

`createFactPIIGuardrail` — fact-store boundary PII guardrail

Closes the source → fact → agent-prompt PII bypass surfaced by the R5
red-team / privacy / AI-integration reviewers: `createPIIGuardrail` and
`createEnhancedPIIGuardrail` only inspect the `data.input` argument
passed to `runStream(agent, input, ...)`. When a source publishes PII
into a fact and the agent's prompt template embeds that fact
(`"Hello ${facts.email}..."`), the PII reaches the LLM call without
hitting the input guardrail chain.

`createFactPIIGuardrail` is a Directive plugin (wired at
`createSystem({ plugins: [...] })`) that scans every write to a
`pii`-tagged fact, auto-discovered via `meta.byTag("pii")` at `onInit`.
Two modes:

- `"redact"` (default, safe shipping posture): rewrites the fact value
  via a follow-up store write so the next read returns the redacted
  form. The raw value briefly exists for one microtask while the
  redaction lands; downstream subscribers that snapshot at that instant
  see it; the LLM call after the next settle does not.
- `"alert"`: fires the `onBlocked` callback but does NOT mutate the
  fact. Use for monitoring-only deployments where the source's
  transport is already trusted and you want to page on every match
  without modifying state.

The built-in regex covers SSN, credit-card, and email. Pass a
synchronous `customDetector` for domain-specific patterns (internal
account numbers, partner IDs). The full async detector at
`@directive-run/ai/guardrails/pii-enhanced` is unsuitable for this hook
because `onFactSet` is synchronous and a deferred detection would let
the raw PII reach observers + breakpoints + audit-ledger before the
redaction completed.

Wires as the Tier 0 prerequisite for the upcoming
`runStream({ liveContext })` recipe, which would otherwise expand the
fact-injection bypass surface into the mid-stream context updates the
agent reads while generating.

Hard rejection at the write boundary requires a pre-commit transform
hook on the source primitive itself (Directive plugin hooks are
wrapped by the plugin manager's `safeCall` and a thrown error is
swallowed). Tracked as a future RFC. Today's `"redact"` mode is the
safe-shipping posture.

Docs:
- New `packages/knowledge/ai/ai-sources.md` — AI × Sources patterns,
  three-tier lifetime ladder, `runStream({ liveContext })` recipe
  (RFC 0005 cross-ref), MCP lifecycle as a source, sources × security,
  anti-patterns (no token streaming via source, no polling from a
  constraint), `@directive-run/sources/*` adapter subpath inventory.
- `packages/knowledge/ai/ai-security.md` — new "Sources × PII" section
  with the threat chain + the redact recipe, and a row in the quick
  reference table.
- `packages/knowledge/core/sources.md` — "Related" links to the new
  `ai-sources.md` + `ai-security.md` anchor.

Eight regression tests cover redact mode (string + object payloads),
alert mode, `includeKeys` / `excludeKeys` escape hatches, and the
custom detector composition path.
