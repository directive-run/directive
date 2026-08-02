---
"@directive-run/ai": minor
---

Real per-delta token streaming from `run`, `runStream` and `runAgentStream`.

`runStream` previously promised token granularity and delivered a single chunk
holding the entire response, synthesized once the message completed. It now
emits one `token` chunk per completed message **by default** — unchanged — and
one chunk per provider delta when you ask:

```ts
// per-delta chunks, no callback
const { stream, result } = orchestrator.runStream(agent, prompt, { deltas: true });

// per-delta chunks plus a callback of your own
const { stream } = orchestrator.runStream(agent, prompt, {
  onToken: (token) => process.stdout.write(token),
});
```

`onToken` is also accepted by `run()`, so you can have deltas and one awaited
`RunResult` without switching APIs.

Streaming is a field on the options object every runner already receives, not a
separate runner. That is deliberate: a second runner slot would bypass the
wrappers you had composed, so a `withBudget`-wrapped runner would stop enforcing
its budget the moment you streamed. As an option it survives `withRetry`,
`withBudget`, `withFallback`, `withModelSelection` and `withStructuredOutput`
untouched, and tool-call guardrails keep gating calls while deltas flow.

**`backpressure: "block"` now works.** It never did before. The SSE parser called
`onToken` without awaiting it, and `createStreamingRunner`'s own async callback
had its promise dropped, so against every shipped adapter `"block"` silently
behaved as `"buffer"` — which is the opposite of what you pick it for. Returning
a promise from `onToken` now genuinely stops the reader pulling from the
provider until it settles. If you chose `"block"` because losing output was
unacceptable, you were getting `"buffer"`; you are now getting what you asked
for, including the pause in generation that comes with it.

Behavior changes worth knowing:

- **`stream_restart` is a new chunk type.** If you exhaustively `switch` over
  the chunk union, add a branch. It fires whenever the runner is re-invoked and
  replays the response from the start — an agent retry, a structured-output
  schema retry, or a multi-agent reroute — and carries `discardBefore`, the
  number of `token` chunks from the abandoned attempt you should throw away.
  Emitted only when per-delta streaming was requested.
- **`tokenCount` on `token` chunks is deprecated** in favor of `deltaCount`.
  Neither is a token count: a provider delta is not a token (Anthropic sends
  several per delta, Gemini sends sentences). `result.tokenUsage` and
  `result.totalTokens` remain authoritative. `tokenCount` still carries its
  historical value and is not going away in this release.
- **`done.droppedTokens` reports a real figure.** It was a hardcoded `0`, so a
  truncated stream declared itself complete. Consumers with a drop check that
  had never fired may start seeing non-zero values — that is loss that was
  already happening.
- **Buffer eviction changed ends.** An overflowing orchestrator stream now drops
  the newest droppable chunk rather than the oldest, so the beginning of a
  message survives and the tail is what is lost. Terminal and control chunks —
  `done`, `error`, `stream_restart`, approval requests — are never dropped.
- Accumulated partial output is truncated on code-point boundaries, so a lone
  surrogate can no longer break JSON serialization to plugins or devtools.

A runner that cannot stream ignores the request and returns its ordinary
buffered result, and the whole-message chunk is still emitted — so nothing
breaks. If deltas were requested and none arrived alongside non-empty output,
the orchestrator says so once instead of leaving it silent.
