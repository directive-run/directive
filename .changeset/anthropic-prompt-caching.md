---
"@directive-run/ai": minor
---

Add opt-in Anthropic prompt caching to `createAnthropicRunner`. Pass `promptCaching: "automatic"` to place a `cache_control` breakpoint on the agent's instructions so Anthropic caches the stable system prefix &ndash; repeat calls that share it read from cache instead of reprocessing it, while the variable message suffix stays uncached. The runner also surfaces the cache-token breakdown on `tokenUsage` via two new optional fields, `cacheReadTokens` and `cacheCreationTokens` (present only when caching is active); `inputTokens` remains the uncached remainder and `totalTokens` now includes the cache tokens.

Non-breaking and off by default. Cache-field emission is gated on the option, not on the response body (the live API returns `cache_*_input_tokens: 0` on every response): with caching off the runner sends the bare-string system prompt and omits both cache fields, so `tokenUsage` is byte-identical to before; with caching on both fields are always present, so a cache miss correctly reports `cacheReadTokens: 0`. Note that Anthropic silently ignores `cache_control` below a per-model minimum prefix (~1024&ndash;4096 tokens), so short instructions may not cache &ndash; a persistent `cacheReadTokens: 0` is the signal. Currently applies to the non-streaming runner; streaming is a follow-up.
