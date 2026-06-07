---
"@directive-run/ai": minor
---

`runStream({ liveContext })` — Reactive Agents (RFC 0005)

Additive `liveContext` option on `orchestrator.runStream()` that turns
sources into a feedback loop for the in-flight LLM run. The agent's
view of the world stays in sync with reality: a source publishes a
fact update, the orchestrator emits a `context_updated` chunk, and
when `interruptWhen` returns `true` the LLM run is aborted and an
`interrupted` chunk lands on the stream.

The implementation is **231 LOC** in `agent-orchestrator.ts` —
comfortably under the RFC 0005 300-LOC scope guard. The bridge re-uses
the same `system.facts.$store.subscribe(keys, cb)` mechanism the
breakpoint + approval waiters already wire (no new primitives needed
on the core side).

### Additive surfaces

**`OrchestratorStreamChunk` union** — two new variants:

- `{ type: "context_updated"; changedKeys: readonly string[] }` —
  emitted on watched-fact changes. Always emitted when `notifyOn:
  "all-changes"`; emitted only for changes that trigger an interrupt
  when `notifyOn: "interrupt-only"` (default).
- `{ type: "interrupted"; reason: string; partialOutput: string; changedKeys: readonly string[] }` —
  emitted when `interruptWhen` returns `true` OR when the consumer
  calls `result.interrupt(reason?)`. Carries the partial LLM output
  accumulated up to the abort point so a consumer can stitch a
  retry prompt.

**`OrchestratorStreamResult`** — new `interrupt(reason?: string): void`
method. Distinct from `abort()`: `abort` tears down the AsyncIterable
AND detaches `liveContext`; `interrupt` cancels the LLM run but leaves
fact subscriptions alive so the next caller-driven prompt continues
against fresh facts.

**`runStream` options** — accepts `liveContext: LiveContextOptions<F>`:

```ts
const result = orchestrator.runStream(agent, input, {
  liveContext: {
    system: marketSystem,
    keys: ["lastPrice", "lastVolume"],
    interruptWhen: (facts, changedKeys) =>
      Math.abs(facts.lastPrice - facts.openPrice) > 5,
    mode: "restart",        // reserved for follow-up minor; today's
                            // landing ships "inject-system-message"
                            // behavior (consumer re-prompts)
    notifyOn: "interrupt-only", // default; "all-changes" is the noisier variant
    onContextUpdate: (keys) => Sentry.addBreadcrumb(`liveContext: ${keys.join(",")}`),
  },
});

for await (const chunk of result.stream) {
  if (chunk.type === "token") process.stdout.write(chunk.data);
  if (chunk.type === "interrupted") {
    console.log(`Agent interrupted: ${chunk.reason}; partial: ${chunk.partialOutput}`);
    // Optionally call orchestrator.runStream again with fresh context.
  }
}
```

### Security companion

`createFactPIIGuardrail` (shipped in the prior phase) is the
**mandatory** companion when `liveContext` watches facts that may
carry PII. Without it, `liveContext` expands the source → fact →
prompt PII bypass surface into mid-stream context updates the agent
reads while generating. The new `ai-sources.md` recipe documents this
gating.

### Multi-agent orchestrator

`OrchestratorStreamResult` shapes constructed inside
`multi-agent-orchestrator.ts` gain `interrupt()` stubs that map to
`abort()` — multi-agent delegate / task streams don't carry
`liveContext` bindings of their own, so the distinction collapses
there.

### Tests

5 new regression tests covering the chunk variant shapes (type
narrowing + payload fields), the `interruptWhen` default
(`() => true` — any watched-key change interrupts), the false-path
("interrupt only when threshold crossed") behavior, and end-to-end
AsyncIterable drainage of `context_updated` → `interrupted` →
`done`. AI suite: 1506 → 1511 passing.

### Status

Ships the additive surface + the `liveContext` event loop. The
`mode: "restart"` variant ships the chunk-emission contract today
(consumer re-prompts via a fresh `runStream` call — matches the
documented `"inject-system-message"` mode); automatic re-invocation
on `"restart"` is reserved for a follow-up minor once the
multi-step prompt-merging strategy is locked in.
