# RFC 0005 – `runStream({ liveContext })` – Reactive Agents

- **Status:** Accepted – shipped 2026-06-07 in `feat/source-primitive` (PR #52, merge `ab97b028`); pending v1.18.0 release
- **Author:** Jason Comes
- **Related:** the `source` primitive in `@directive-run/core`; the
  Tier 0 prereq `createFactPIIGuardrail` (shipped).

## Summary

`@directive-run/ai`'s `runStream(agent, input, options)` today produces a
one-shot stream: input goes in, tokens come out, the model never sees
the world change. Sources publish into facts; facts power agent prompts
through template interpolation; but mid-generation, the agent has no
hook back into the live fact store.

This RFC adds an additive `liveContext` option to `runStream` that turns
sources into a feedback loop for the in-flight LLM. The pattern:

> The agent is mid-generation. A source publishes a fact update. The
> orchestrator emits a `context_updated` chunk; if an `interruptWhen`
> predicate matches, it aborts the current stream, emits an `interrupted`
> chunk with the partial output, and (in `restart` mode) re-invokes the
> runner with the fresh facts merged into the system message.

No other agent framework has this. Demo: a coding agent summarizing a
PR mid-commit-landing; the agent resets and finishes with the new diff.

## Motivation

Feedback loops between the world and an in-flight LLM are the missing
half of every "streaming agent" pattern in `@directive-run/ai` today.
The rest of the runtime is already reactive – sources publish, facts
propagate, subscribers wake – but the agent's generation loop is a
one-way trip. Closing that gap unlocks a whole class of demos where
the model reacts to reality as it changes, not just to the state it
was prompted with. Scope target: ~500-550 LOC implementation + tests,
~600 LOC docs + example, with a 300-LOC scope guard on the
orchestrator changes so the primitive stays additive.

Every primitive needed already exists:

- `system.facts.$store.subscribe(keys, listener)` is the bridge
  (already used internally for the breakpoint-waiter and approval-waiter pathways
  and approvals).
- `runStream` already exposes `abort()`.
- The source primitive publishes into facts.

`liveContext` stitches the three into a single declarative API.

## Proposed API

```ts
const result = orchestrator.runStream(agent, input, {
  signal,                              // existing AbortSignal
  liveContext: {
    system,                            // the Directive system whose facts feed the agent
    keys: ["pr.headSha", "pr.state"],  // facts to watch
    interruptWhen: (facts, changedKeys) => boolean,
    notifyOn: "all-changes" | "interrupt-only", // default: "interrupt-only"
    onContextUpdate?: (changedKeys) => void,
  },
});
```

> **Design update (pre-release):** the original RFC drafted a `mode: "restart" |
> "inject-system-message"` field for choosing how the orchestrator
> continues after an interrupt. The 1.18 landing ships a single
> behavior – abort the LLM run, emit an `interrupted` chunk, hand
> control back to the caller (who re-prompts via a fresh `runStream`
> or fully tears down via `result.abort()`). The `mode` field was
> removed before release because the impl never read it; the
> auto-re-prompt semantics will ship in a follow-up RFC + field
> together once their design is settled.
>
> Likewise, the original draft proposed an inline `guardrails` array
> on `liveContext` itself; the shipped Tier 0 security companion is
> `createFactPIIGuardrail`, wired at `createSystem` time (see the
> "Security – Tier 0 prereq" section below).

Two additive chunk variants land on the `OrchestratorStreamChunk`
discriminated union:

```ts
| { type: "context_updated"; changedKeys: string[] }
| { type: "interrupted"; reason: string; partialOutput: string; changedKeys: string[] }
```

A new `interrupt(reason?: string): void` method joins `abort()` on the
`OrchestratorStreamResult`. `abort` tears the AsyncIterable down AND
detaches liveContext. `interrupt` cancels the in-flight generation but
keeps liveContext attached so the next caller-driven prompt continues
with up-to-date facts.

## Security – Tier 0 prereq

`createFactPIIGuardrail` (shipped) is the **mandatory** companion. Without
it, `liveContext` expands the source → fact → prompt PII bypass surface
into the mid-stream context updates the agent reads while generating.

**Design update (pre-release):** the original RFC drafted a
`liveContext.guardrails` inline array as the per-`runStream` extension
point. The shipped design moves PII screening to
`createFactPIIGuardrail` wired at `createSystem` time – the plugin
runs on every fact write (including the source publishes liveContext
watches), so by the time the orchestrator emits a `context_updated`
chunk the fact has already been redacted in-store. No `runStream`-time
guardrail array ships.

## Scope guard

If the implementation exceeds **300 lines of orchestrator code** OR
requires breaking-type changes to `OrchestratorStreamChunk` beyond the
two additive variants AND the additive `interrupt` method, **STOP and
defer to a follow-up minor**. The example file
(`examples/ai-live-context/`) still ships, demonstrating the gap and
the recipe pattern with today's existing primitives.

## Demo (the launch video)

A live market dashboard:

- One source publishing a `priceTick` fact every 500ms from a mock feed.
- One agent streaming `"Given current price $X, my recommendation is..."`.
- Side-by-side: live ticker on the left, agent stream on the right.
- Recordable moment: mid-sentence, the price ticks, the next streamed
  token is the new price, the recommendation pivots.
- 6-second GIF. Tweet copy writes itself.

The alternative "PR mid-commit" demo is the long-form blog post, not
the launch artifact.

## Open questions

1. **Automatic re-prompt semantics (deferred to follow-up RFC).** The
   1.x landing ships abort-and-emit only; the caller drives re-prompt
   via a fresh `runStream` call. A future RFC will add automatic
   re-invocation with a merge strategy – open sub-questions: (a)
   re-render the entire system message from scratch, or (b) append a
   "context updated:" delta. The original `mode` field was removed
   from `LiveContextOptions` before release because the impl never
   read it; the new field ships alongside the impl in the follow-up.
2. **Buffer policy during interrupt.** Partial output emitted before
   interrupt – does the caller's `for await (chunk of stream)` loop get
   it as a `token` chunk first then `interrupted`, or only `interrupted`
   with `partialOutput`? Recommendation: both – emit tokens up to the
   abort point, then `interrupted`.
3. **interruptWhen frequency.** Called on every fact-change observer
   batch or only on watched-key matches? Recommendation: only on
   watched-key matches (cheaper, more predictable).

## Acceptance criteria

- `runStream({ liveContext })` option lands additively (no breaking
  changes for callers that don't pass it).
- 2 new `OrchestratorStreamChunk` variants + `interrupt(reason?)`
  method land additively on `OrchestratorStreamResult`.
- `examples/ai-live-context/` ships with a runnable Vite scaffold
  matching the existing examples convention.
- `packages/knowledge/ai/ai-sources.md`'s `liveContext` section moves
  from "RFC 0005 design" to "shipped recipe."
- Implementation stays under the 300-LOC scope guard OR explicitly
  invokes the defer-to-follow-up exit.
- `createFactPIIGuardrail` is referenced in the changeset + the
  example as a required companion when the watched facts carry PII.
