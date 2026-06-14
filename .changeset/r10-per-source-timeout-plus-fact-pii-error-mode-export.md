---
"@directive-run/core": minor
"@directive-run/ai": patch
---

Two follow-on hardenings.

## core: per-source teardown timeout is now configurable per source

`SourcesManager.cleanupAllAsync` and `evictAll` previously applied a single 5-second cap to every source. Long-tail transports that legitimately need more time to drain (a Supabase channel flushing a backlog before close, an OpenTelemetry batch span exporter draining its queue, a Cloudflare DO storage flush awaiting a D1 commit) hit the cap and reported a hang even when the underlying work was healthy.

`SourceDef` now accepts an optional `evictTimeoutMs?: number` override. Sources keep the 5s default unless they declare a different ceiling — adjacent sources are unaffected. Pass `Infinity` to disable the cap for that source only (the manager skips the timer wiring entirely so Node doesn't emit a `TimeoutOverflowWarning`).

```ts
sources: {
  supabase: sourceFromSupabaseChannel({
    // Default 5s would clip the backlog drain. Give the channel
    // up to 15s to acknowledge the unsubscribe.
    evictTimeoutMs: 15_000,
    // ...rest of the source config
  }),
}
```

The package-wide default is exported as `DEFAULT_PER_SOURCE_TIMEOUT_MS` for consumers who want to derive their own ceiling.

## ai: `FactPIIErrorMode` joins its sibling in the barrel

The `errorMode` option on `createFactPIIGuardrail` accepts a `FactPIIErrorMode` union. The type was internal-only — the sister type `FactPIIGuardrailMode` was already exported. Consumers writing the option's type annotation had to deep-import from `@directive-run/ai/guardrails/fact-pii.js`. `FactPIIErrorMode` is now re-exported from both `@directive-run/ai` and `@directive-run/ai/guardrails`.
