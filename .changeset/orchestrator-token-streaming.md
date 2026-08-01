---
"@directive-run/ai": minor
---

**Orchestrators can now emit real per-token deltas via a new `streamingRunner` option.**

`runStream` and `runAgentStream` previously could not stream tokens, and not by choice: `OrchestratorOptions.runner` is typed `AgentRunner`, whose `RunOptions` has no `onToken`. That hook lives only on `StreamingCallbackRunner`, a separate type neither orchestrator referenced. Every `{ type: "token" }` chunk was therefore synthesized from a whole assistant message — one chunk per message, containing the entire message — despite the chunk type promising token granularity. Reaching real deltas meant calling a provider adapter directly and giving up guardrails, retry, breakpoints, and the facts bridge.

Both orchestrators now accept an optional `streamingRunner`:

```typescript
const orchestrator = createAgentOrchestrator({
  runner: createAnthropicRunner({ apiKey }),
  streamingRunner: createAnthropicStreamingRunner({ apiKey }),
});

const { stream } = orchestrator.runStream(agent, "Write a haiku");
for await (const chunk of stream) {
  if (chunk.type === "token") {
    process.stdout.write(chunk.data);
  }
}
```

Token chunks now arrive one per provider delta. The run still passes through `executeAgentWithRetry`, so input and output guardrails, retry, breakpoints, memory, and the facts bridge all continue to apply. Behavior is unchanged when `streamingRunner` is omitted.

The bridge is also exported on its own as `streamingRunnerToAgentRunner`, for handing a callback-based runner to anything that expects an `AgentRunner`.

**One combination is refused rather than silently degraded.** A callback runner's hooks are synchronous and return void, so the bridge cannot drive `RunOptions.onToolCall` — the hook that runs tool-call guardrails and blocks for approval. Configuring `streamingRunner` alongside `guardrails.toolCall` or manual approval would leave both looking configured while passing every tool call, so the orchestrators now throw at construction and name the tradeoff. Tool calls still surface on the stream as `tool_start` / `tool_end`, as observations rather than gates.

Also corrects `packages/knowledge/ai/ai-agents-streaming.md`, which documented `backpressure` and `bufferSize` as `runStream` options. `runStream` accepts only `{ signal, liveContext }`; those options were silently ignored.
