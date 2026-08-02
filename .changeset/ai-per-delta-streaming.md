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
  replays the response from the start — an agent retry, a `withRetry` retry, a
  structured-output schema retry, a `withFallback` move to the next provider, or
  a multi-agent reroute. Discard everything you rendered for the current
  generation; `generation` on the chunk is an opaque marker for the one now
  starting. Emitted only when per-delta streaming was requested.
- **`RunOptions.onStreamRestart` carries the same boundary to any runner.** The
  wrappers that re-invoke the runner — `withRetry`, `withFallback`,
  `withStructuredOutput` — call it as they do, and every wrapper forwards it the
  way it already forwards `onToken`. Without it a caller streaming through a
  retrying runner rendered the first attempt and the second end to end, as one
  run-on response, and with `withFallback` the stream and the returned
  `RunResult` disagreed outright. `run(agent, input, { onToken, onStreamRestart })`
  gets the boundary too, so the documented shortcut of `run` over `runStream` is
  no longer a downgrade. If you wrote your own wrapper that re-invokes a runner,
  call `options.onStreamRestart` when you do.
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
  message survives and the tail is what is lost. A control chunk —
  `stream_restart`, `approval_required`, `interrupted` — is admitted ahead of any
  droppable chunk still buffered, and `done`/`error` always land. The cap applies
  to every type, though: a consumer that stops reading can no longer make the
  buffer grow without limit. `context_updated` counts as droppable, because it
  only names the facts that changed and the values are still readable from the
  system.
- **`error` chunks carry `droppedTokens`.** A run that dropped chunks and then
  failed reported nothing about the loss, because only `done` carried the figure.
- Accumulated partial output is truncated on code-point boundaries, so a lone
  surrogate can no longer break JSON serialization to plugins or devtools.

A runner that cannot stream ignores the request and returns its ordinary
buffered result, and the whole-message chunk is still emitted — so nothing
breaks. If deltas were requested and none arrived alongside non-empty output,
the orchestrator says so once instead of leaving it silent.

**Token accounting no longer reads "the provider said nothing" as "the call was
free."** `RunResult` gains `usageReported`. It is `false` when `tokenUsage` holds
zeros because the provider sent no usage at all — an OpenAI-compatible endpoint
that ignores `stream_options.include_usage` (vLLM, LiteLLM, OpenRouter, older
Azure) is the common case, and it is reported on the buffered path too. On a
streamed run against such an endpoint the old behavior was `totalTokens: 0` per
call forever: `withBudget` recorded `$0`, rolling windows never accrued, and
`maxTotalTokens` never tripped however many calls went out. `withBudget` now
charges its pre-call estimate for a call it cannot price, and
`runner.getUnpricedCallCount()` says how many of those there have been, so you
can tell an estimated figure from a measured one.

**A stream that ends early is an error.** The shipped adapters now require the
provider's end-of-response marker — `[DONE]` or a `finish_reason` for
OpenAI-compatible endpoints, `message_stop` for Anthropic, `done: true` for
Ollama, a `finishReason` for Gemini. A body truncated mid-response arrives as a
clean end of stream, so a partial answer used to resolve successfully and was
indistinguishable from a complete one. A runner you built with `createRunner` is
unaffected unless you opt in with `streaming.requireTerminalEvent` and report the
marker from `parseEvent` via `terminal: true`.

**`onToken` is interruptible, and a throw from it is yours.** The awaited
callback is now raced against the abort signal, so a callback that never settles
can no longer park the reader — `abort()` and `destroy()` settle the run and
cancel the stream instead of leaking the socket, the fetch and a `"running"`
agent state. A callback that throws is wrapped in a new `StreamConsumerError`
and treated as consumer-side: `withRetry`, `withFallback` and the orchestrators'
own retry stop rather than buying the same response again for a consumer that
just crashed on it. Provider failures retry exactly as before.

**`runStream` now uses the runner the orchestrator was configured with.** It
invoked the bare runner, so an orchestrator with an `outputSchema` or a
`circuitBreaker` silently had neither the moment you streamed — including the
schema retry the `deltas` documentation said you would see. Streamed runs are now
validated and gated exactly like buffered ones.

**Multi-agent paths that accepted streaming options now honor them.**
`runAgentStream` against a registered task hands the task's output to `onToken`
as well as to the stream, and `runParallelStream` takes `deltas` and forwards it,
so a multiplexed stream can carry per-delta chunks tagged by agent.

**A streamed run now leaves the same record behind as a buffered one.** Stream
chunks are consumed once and then gone, so anything only ever reported as a
chunk is unavailable to whoever reconstructs the run afterwards.

- `orchestrator.runStream` writes `agent_start` and `agent_complete` to the
  debug timeline, with the same fields `orchestrator.run` writes and at the same
  two points. It previously wrote nothing at all, so a streamed run was invisible
  on the timeline — including which agent ran and what it produced. The
  multi-agent orchestrator's streaming path already recorded both. Timelines only
  exist when `debug: true`, so this is additive where it appears at all.
- The single-agent streaming path caps the `toolCalls` fact at 200 entries, which
  is the cap the buffered path has always applied. It appended without bound
  before, so a long streamed session grew the fact forever and a consumer reading
  it could tell which path had produced it.

**`destroy()` no longer abandons streams that are still open.** It was
`system.destroy()` and nothing more: a stream in flight kept its consumers parked
on an iterator that would never resolve, and the provider request — and the spend
it was accruing — was left with nothing to cancel it. Both orchestrators now
abort and close every stream still open, so a consumer mid-`for await` observes
the stream ending. Streams remove themselves as they terminate, so the bookkeeping
does not grow across a long-lived orchestrator's lifetime, and `destroy()` with
nothing streaming does exactly what it did before.
