---
"@directive-run/ai": patch
---

**A stalled Anthropic stream is no longer able to hang forever.**

`createAnthropicStreamingRunner` passed the caller's `signal` to `fetch` and nothing else. A connection that stayed open and stopped sending was therefore bounded by exactly one thing: a caller remembering to cancel it. Nothing in the adapter would ever end that call – not a wall clock, not a token count, not the end of the process's patience. A run that reached that state occupied its slot until something outside the library intervened, and an interrupt written to let the turn in flight finish first had nothing to finish.

There is now a deadline, and it measures the gap between events rather than the length of the call:

```typescript
const runner = createAnthropicStreamingRunner({
  apiKey,
  // Abandon the call after this long with nothing on the wire.
  timeoutMs: 60_000,
});
```

The distinction is the whole design. A streamed response runs for as long as the model has something to say, so a wall-clock cap on the call as a whole – which is what `timeoutMs` means on `createAnthropicRunner`, and still does – either truncates a long answer or is set so high that it bounds nothing worth bounding. What goes wrong on a stream is not that it takes a long time, it is that it goes quiet and never ends. So the clock starts when the request goes out and is restarted by every sign of life: the response headers, each delta, and the keep-alive pings Anthropic sends while it works. A stream that talks for an hour is never touched. A stream that goes silent is abandoned a fixed interval later, whatever it had already delivered.

The default is two minutes of silence, which a healthy stream comes nowhere near – the opening frame follows the request almost immediately and pings arrive throughout – and which still bounds a stall to something a person waiting on the turn will sit through. Pass `Infinity` to run without one; a `timeoutMs` that no stream could ever trip is refused when the runner is built rather than on the first stalled call.

A stall fails with an error named `"TimeoutError"`, the same name `AbortSignal.timeout` gives the buffered path, so a caller can tell a provider that stopped talking from a run they cancelled themselves. The deadline composes with `callbacks.signal` rather than replacing it: cancellation keeps working, and aborting for either reason ends the call.
