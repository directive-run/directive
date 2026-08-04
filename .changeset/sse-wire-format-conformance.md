---
"@directive-run/ai": minor
---

**The streaming adapters now parse the event-stream format the way the format is defined, rather than the way one provider happens to write it.**

Every streamed call in the package went through a parser that matched `"data: "` as a literal prefix, split lines on `\n` alone, and treated each `data:` line as a complete JSON document. All three are narrower than the format allows, and each one turns a perfectly healthy response into a wrong answer:

- **The space after `data:` is optional.** A server that writes `data:{…}` — TGI, several vLLM builds, Workers AI, and anything using `fmt.Fprintf(w, "data:%s\n\n")` — produced zero parsed events, so the call failed with "ended without a completion marker after 0 characters" and no usage attached. That reads as a truncation, so it was retried, and the failed attempts were billed. These are exactly the endpoints the `baseURL` option exists to reach.
- **Lines end at CR, LF, or CRLF.** A CR-only body buffered as one ever-growing line whose JSON never parsed, and the resulting `SyntaxError` is swallowed as a malformed event — so a healthy stream reported itself truncated.
- **An event's `data` lines are one payload, joined with newlines, dispatched on the blank line that closes the event.** A server is free to break a payload at any newline, and one that split Anthropic's opening `message_start` across two `data:` lines lost it silently: the run **succeeded with `inputTokens: 0`**, under-billing with no error anywhere.

Comments (`: keep-alive`), `event:`, `id:` and `retry:` fields, and `data:` heartbeats with an empty payload are all now recognized for what they are.

**Two silence clocks instead of one, and neither one measures the wrong thing.**

The stream deadline was restarted from inside each adapter's event parser, so it only moved for lines that produced a JSON payload. That got both directions wrong at once: the format's own keep-alive mechanism — a `:` comment, which is what nginx and Cloudflare send to hold a connection open — never touched it, while Anthropic's `ping` events always did. Measured, comment keep-alives every 100ms against a 500ms deadline threw `TimeoutError` at 513ms, and pings every 100ms against the same deadline ran past 3000ms and kept going.

A ping means the connection is up. It does not mean the model is producing. So there are now two clocks:

```typescript
const runner = createAnthropicStreamingRunner({
  apiKey,
  timeoutMs: 120_000,          // total silence — nothing at all on the wire
  contentTimeoutMs: 600_000,   // alive, but producing nothing. Keep-alives do not restart this.
});
```

`timeoutMs` keeps its meaning and is now restarted by any sign of life, keep-alives included. `contentTimeoutMs` is new, defaults to ten minutes, and is the ceiling on a connection that keeps saying hello and nothing else. Either running out fails with an error named `"TimeoutError"`, and the message says which. **If you have a model that legitimately thinks for more than ten minutes before emitting anything, raise `contentTimeoutMs`.**

The clocks also stop while a consumer callback holds a token. `onToken` is awaited — that is what makes backpressure real — and the deadline used to run during it, so a consumer doing 600ms of work per delta under a 400ms deadline tripped a `TimeoutError` that blamed the provider for the consumer's own time. The two shipped features cancelled each other out.

**The deadline now enforces itself.** `reader.read()` is raced against the abort signal instead of relying on the fetch implementation to error the body. Every adapter accepts an injected `fetch`, and a wrapper that tees the body for logging, replays it from a recording, or hands back a fresh `Response` need not propagate the signal at all — which silently disarmed every stream deadline in the package.

**And every streaming runner has one.** `createOpenAIStreamingRunner`, `createGeminiStreamingRunner` and `createOllamaStreamingRunner` gain `timeoutMs` and `contentTimeoutMs`, and so does the streaming path of `createRunner` — which is the path the shipped adapters and the harness actually take, and which had no deadline at all. Both default as above, so a stalled call that used to hang indefinitely now fails after two minutes of silence.

**Truncation is no longer indistinguishable from completion.** `stop_reason: "max_tokens"`, `finish_reason: "length"`, `finishReason: "MAX_TOKENS"` and `done_reason: "length"` all resolved as clean successes, so a response cut off mid-sentence was parsed, validated and acted on as though the model had finished saying it. `RunResult` now carries `stopReason` — `"stop" | "length" | "tool_use" | "content_filter" | "other"` — and `rawStopReason` with the provider's own spelling, on the buffered and streamed paths of all four adapters.

**Money, in four places:**

- `createAnthropicStreamingRunner` dropped the prompt-cache token counts its own parser had already read. Against the same body, `createRunner`'s streaming path reported `total=9319` and this one reported `total=19` — a 490x under-report on a fully cached prompt, which any token-window budget reads as a free call. Both paths now call one function, the standalone runner accepts `promptCaching: "automatic"` like the buffered one, and a cache count above zero is never dropped even when caching was not requested.
- A failed call's usage was lost the moment anything wrapped the error. It travels on the error as an own property, and the reader checked only the outermost one — so `withRetry`, which puts the original on `cause`, was enough to lose it. A budget over a retrying stack recorded **$0.00** for a call the provider billed in full on the prompt; measured through the documented `runner` extension point, that was $0.3836 of real spend against a $0.20 ceiling reported as $0.1384, with no overrun event, because the fraction was computed from a ledger that was wrong. The reader now walks `cause` and `lastError` eight links deep. **A custom runner that wraps its errors must keep the original reachable via `cause`, or the ledger under-bills.**
- Gemini returned the reasoning summary as the answer. A thinking model sends its summary as an ordinary text part flagged `thought: true` ahead of the real one, and the adapter read `parts[0].text` — so against `gemini-2.5-flash` and `-pro` it returned "Let me think..." and discarded the answer, with a clean terminal marker and no error. Thought parts are now skipped, every remaining part is concatenated, and `thoughtsTokenCount` is added to `outputTokens`, which is how the provider bills it.
- Anthropic tool use produced an empty success: `input_json_delta` fragments were dropped and `toolCalls` was hard-coded to `[]`, so a tool-calling stream returned `output: ""` with 30 tokens billed. Tool calls are assembled from their fragments and returned. **A streamed Anthropic call that makes a tool call now returns it, where it previously returned none** — code downstream of a streaming runner will start seeing `toolCalls` it never saw before.

**`Retry-After` reaches the code that waits.** The thrown HTTP error carried only prose, and `withRetry` scanned the message for a header that had never been put in it — so against a 429 that said "come back in 20 seconds" it backed off 500ms, then 1s, then gave up. Streaming HTTP failures now throw a `ProviderHTTPError` carrying `status`, `statusText`, `retryAfter` (seconds), `retryAfterMs`, and the rate-limit and request-id response headers. `withRetry` honours the server's interval wherever one was sent, per RFC 9110 §10.2.3, rather than only on a 429.

**Smaller things:** SSE requests send `Accept: text/event-stream`, and a 200 that answers with a JSON content type says so instead of failing as a truncated stream; `stream_options: { include_usage: true }` can be turned off with `includeUsage: false`, for Azure deployments below api-version 2024-06-01 that answer 400 to it rather than ignoring it; Ollama's `{"error": …}` at HTTP 200 surfaces as that error rather than as a missing completion marker; Gemini's `promptFeedback.blockReason` surfaces as a refusal rather than as a truncation; and the `AbortSignal` combination helper detaches its listeners on runtimes without `AbortSignal.any`, where it previously left one on the caller's signal for every call made with it.
