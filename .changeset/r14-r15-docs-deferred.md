---
"@directive-run/knowledge": patch
---

Knowledge docs deferred batch — RFC index + sources install line + Runtime Compat + polling recipe + attachSourcesToOtel recipe

Closes five docs-deferred items from R14 + R15 audit rounds, all explicit acceptance criteria from RFCs 0005 / 0009:

- `docs/rfcs/README.md` index listing every RFC's title / status / landing version, plus the open follow-up RFCs queue (live-context auto-reprompt, walker security rewrite via structuredClone, pre-emit transform hook, `source.evict` observation event, reconnect contract, `publish.complete()` channel).
- `@directive-run/sources` install lines in `ai-sources.md` covering the umbrella + the two vendor peerDeps (`@supabase/supabase-js`, `@cloudflare/workers-types`). Documents that both peerDeps are optional and pull in only when the corresponding subpath is imported.
- `## Runtime compatibility` section in `core/sources.md` per RFC 0009 acceptance criterion — matrix across Cloudflare DO / Workers / Bun / Deno / Browser / Node for the shipped adapters (`sourceFromSupabaseChannel`, `sourceFromDOAlarm`, `sourceFromWebSocketMessage`).
- `### Polling — when a transport is request/response only` recipe in `core/sources.md` with the full `setInterval` + `AbortController` + `reportError` + `coalesce: "lastWriteWins"` pattern (the pattern was previously inline-mentioned but had no recipe section).
- `## Observability — pipe source.* events to OpenTelemetry` recipe in `ai-sources.md` covering `attachSourcesToOtel(system, { tracer, serviceName })`, with a cross-ref from `core/sources.md` Observation section. Closes the gap between RFC 0005 / RFC 0009's mention of source-side observability and the actual `@directive-run/ai`-side helper.
