# AI agents + streaming

> Covers `@directive-run/ai` — `AgentLike`, `RunResult`, `StreamChunk`, per-delta streaming, backpressure, `createStreamingRunner`, `createSSETransport`.

Defines the `AgentLike` shape, the `RunResult` returned by every runner, the `StreamChunk` discriminated union, how to ask for per-delta token chunks, backpressure strategies, the streaming runner wrapper, and the SSE transport for piping tokens to a browser.

## Decision tree

```
Need the complete result?
├── Yes                          → orchestrator.run(agent, prompt) → Promise<RunResult>
└── No, need incremental output
    ├── Async-iterator stream    → orchestrator.runStream(agent, prompt) → { stream, result, abort }
    ├── Wrap a base runner       → createStreamingRunner(baseRunner, opts) → StreamRunner
    └── Server-Sent Events to HTTP → createSSETransport(config) → { toResponse, toStream }

How granular should the token chunks be?
├── One chunk per assistant message → the default; pass nothing
├── One chunk per provider delta    → runStream(agent, prompt, { deltas: true })
└── Per delta AND a callback of mine → runStream(agent, prompt, { onToken })

Backpressure concern? → these belong to createStreamingRunner's StreamRunner,
                        NOT to orchestrator.runStream
├── Consumer is slow             → backpressure: "buffer" (default)
├── Need every token             → backpressure: "block"
└── Real-time, can drop          → backpressure: "drop"
```

## `AgentLike`

```typescript
interface AgentLike {
  name: string;            // required — unique identifier
  instructions?: string;   // system prompt
  model?: string;          // adapter-specific model id
  tools?: unknown[];       // tools the agent can call
}

const agent: AgentLike = {
  name: "analyst",
  instructions: "You analyze data and provide insights.",
  model: "claude-sonnet-4-5",
  tools: [searchTool, calculatorTool],
};
```

## `RunResult<T>`

Every runner — wrapped, mocked, real — resolves to this shape.

```typescript
interface RunResult<T = unknown> {
  output: T;                 // the agent's final output
  messages: Message[];       // full message history from this run
  toolCalls: ToolCall[];     // tool calls executed during this run
  totalTokens: number;       // cumulative tokens
  tokenUsage?: TokenUsage;   // optional input/output breakdown when the provider supplies it
  isCached?: boolean;        // true when served from a semantic cache hit
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  // Populated by adapters with prompt caching active (e.g. Anthropic
  // `promptCaching: "automatic"`); omitted otherwise.
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  // Note: NO `total` field — sum `inputTokens + outputTokens` (+ cache tokens when present) when needed, or use `result.totalTokens`.
}
```

## `StreamChunk` discriminated union

```typescript
type StreamChunk =
  | { type: "token"; data: string; deltaCount: number; generation: number; tokenCount: number } // text; see "Chunk counts are not token counts"
  | { type: "stream_restart"; reason: "retry" | "schema-retry" | "reroute"; generation: number } // the runner was re-invoked; discard what you rendered
  | { type: "tool_start"; tool: string; toolCallId: string; arguments: string }              // tool started executing
  | { type: "tool_end"; tool: string; toolCallId: string; result: string }                   // tool finished
  | { type: "message"; message: Message }                                                    // a complete message added to history
  | { type: "guardrail_triggered"; guardrailName: string; reason: string; partialOutput: string; stopped: boolean } // a guardrail fired during streaming
  | { type: "progress"; phase: "starting" | "generating" | "tool_calling" | "finishing" }     // coarse progress
  | { type: "done"; totalTokens: number; duration: number; droppedTokens: number }            // stream complete
  | { type: "error"; error: Error; droppedTokens?: number };                                  // stream aborted with an error
```

`orchestrator.runStream` yields a slightly wider union — `OrchestratorStreamChunk`, which adds `approval_required`, `approval_resolved`, `interrupted`, and `context_updated`. A `default` branch in your switch keeps it exhaustive as chunk types are added.

## Consuming `runStream`

`orchestrator.runStream(agent, input, options?)` returns **`OrchestratorStreamResult<T>`** — a `{ stream, result, abort, interrupt, getStats }` object, NOT an `AsyncIterable` directly. Destructure it before iterating.

```typescript
const { stream, result, abort } = orchestrator.runStream(agent, "Write a report");

for await (const chunk of stream) {
  switch (chunk.type) {
    case "token":
      process.stdout.write(chunk.data);
      break;
    case "tool_start":
      console.log(`\ntool: ${chunk.tool}`);
      break;
    case "tool_end":
      console.log(`result: ${chunk.result.slice(0, 100)}`);
      break;
    case "guardrail_triggered":
      console.warn(`guardrail ${chunk.guardrailName}: ${chunk.reason}`);
      if (chunk.stopped) {
        console.error("stream stopped by guardrail");
      }
      break;
    case "done":
      console.log(`\ntokens: ${chunk.totalTokens}, ${chunk.duration}ms`);
      break;
    case "error":
      console.error("stream error:", chunk.error);
      break;
  }
}

const final = await result; // RunResult<T>

// Cancel mid-stream
abort();
```

> **`chunk.data` is untrusted text.** It is the model's output byte for byte, and a terminal interprets what you write to it: escape sequences can clear the screen, move the cursor, or rewrite lines already printed, and a single sequence can arrive split across two deltas (`ESC` in one, `[2J[1;1H` in the next), which defeats sanitizing each chunk on its own. Sanitize the accumulated text rather than the chunk, or write to a widget that does not interpret control codes.


## Teardown: `abort()` and `destroy()`

`abort()` cancels one stream. `orchestrator.destroy()` tears down the whole orchestrator, and any stream still open at that moment is aborted and closed with it — the provider request stops, and a consumer sitting in `for await` sees the loop end rather than waiting forever.

```typescript
const { stream } = orchestrator.runStream(agent, "Write a report", { deltas: true });

const rendering = (async () => {
  for await (const chunk of stream) {
    if (chunk.type === "token") process.stdout.write(chunk.data);
  }
  console.log("\nstream ended");
})();

// Shutting down: the loop above ends, it does not hang.
orchestrator.destroy();
await rendering;
```

A stream that finished on its own costs nothing here — `destroy()` only reaches streams that are genuinely still open.

`result` settles too. A runner is handed an `AbortSignal`, but nothing obliges it to honor one, so closing the stream alone would leave `result` pending forever and hang a shutdown waiting on it. `abort()`, `destroy()` and `interrupt()` all reject it with the abort signal's own reason when the run is still in flight; a run that already finished keeps the result it produced.

`interrupt()` ends the stream like `abort()` does — it stops counting toward `getActiveStreamCount()` — and differs in one thing only: the `liveContext` subscription stays attached, so the next prompt continues against fresh facts. `destroy()` detaches it.

## Diagnosing a stalled stream

A consumer that stopped pulling and a provider that stopped sending look identical from outside. `getStats()` tells them apart — the first shows a filling buffer, the second shows no first token:

```typescript
const { stream, result, getStats } = orchestrator.runStream(agent, prompt, { deltas: true });

setInterval(() => {
  const stats = getStats();
  // { bufferedChunks, droppedChunks, timeToFirstTokenMs?, deltaCount, generation, restarts, closed }
  if (stats.timeToFirstTokenMs === undefined) {
    console.warn("nothing from the provider yet");
  } else if (stats.bufferedChunks > 100) {
    console.warn("the consumer is falling behind");
  }
}, 1000);

console.log(orchestrator.getActiveStreamCount());  // streams still open
```

`restarts` rising steadily means the runner is being re-invoked and spend is a multiple of the call count. It is counted whether or not deltas were requested; `generation` only moves when they were, since without deltas there is nothing part-rendered to discard. `token` chunks carry the matching `generation`, so a `stream_restart` lost to buffer pressure is still detectable: key rendered output by `chunk.generation` and a new generation replaces the previous one rather than appending to it.

## What a streamed run leaves behind

Chunks are consumed once and then gone, so do not treat them as the record of what happened. A streamed run writes the same durable state a buffered one does:

| Where | What |
|---|---|
| `orchestrator.facts.toolCalls` | Every tool call the run made, capped at the most recent 200 |
| `orchestrator.timeline` (`debug: true`) | `agent_start` and `agent_complete`, with the same fields `run()` records |

Reading either one cannot tell you whether the run streamed.

## Chunk granularity: `deltas` and `onToken`

**`runStream` emits one `token` chunk per completed message by default; pass `deltas: true`, or an `onToken` callback, to get one chunk per provider delta.**

```typescript
// Default — one chunk holding the whole assistant message.
const { stream } = orchestrator.runStream(agent, "Write a report");

// Per-delta chunks, no callback needed.
const { stream } = orchestrator.runStream(agent, "Write a report", {
  deltas: true,
});

// Per-delta chunks AND a callback of your own. Implies `deltas: true`.
const { stream } = orchestrator.runStream(agent, "Write a report", {
  onToken: (token) => metrics.record(token.length),
});
```

`onToken` is **awaited**, so returning a promise applies real backpressure — the adapter will not read the next chunk off the wire until it settles.

```typescript
const { stream } = orchestrator.runStream(agent, prompt, {
  onToken: async (token) => {
    await socket.send(token); // the provider stream pauses until this resolves
  },
});
```

Both forms are available on the multi-agent orchestrator too, as
`orchestrator.runAgentStream(agentId, input, { deltas: true })` (and its alias
`runStream`).

### Streaming is an option, not a runner

`onToken` is a field on `RunOptions` — the same options object every runner already receives. It therefore survives composition untouched: `withRetry`, `withBudget`, `withFallback`, `withModelSelection` and `withStructuredOutput` all forward `options` verbatim, so a budgeted, retrying, fallback-wrapped runner streams with no wrapper changes and no wrapper able to silently drop the capability.

```typescript
const runner = withBudget(withRetry(createAnthropicRunner({ apiKey })), {
  maxCostUSD: 5,
});

// The budget still applies while streaming — same runner, one extra option.
const { stream, result } = orchestrator.runStream(agent, prompt, { deltas: true });
```

`run()` accepts `onToken` too, so a caller who wants deltas *and* one awaited `RunResult` does not have to reach for `runStream`. There is no `deltas` flag on `run()` — it has no stream to put chunks on, so the callback is the only way to observe them.

```typescript
const result = await orchestrator.run(agent, prompt, {
  onToken: (token) => process.stdout.write(token),
});
```

### It is a request, not a guarantee

A runner that cannot stream ignores `onToken` and returns its ordinary buffered result — no error, no negotiation. When that happens the whole-message `token` chunk is still emitted, so the stream stays usable. If deltas were requested and none arrived alongside non-empty output, the orchestrator warns once per process rather than leaving it silent. Base runners are where to look: wrappers forward the option untouched.

## `stream_restart`: the runner was re-invoked

Several things re-invoke the runner mid-stream, and each replays the whole response from the beginning:

| `reason` | Fires when |
|---|---|
| `"retry"` | An agent-level retry (`agentRetry`), or a `withRetry`-wrapped runner retrying |
| `"schema-retry"` | `withStructuredOutput` re-asks because the output failed schema validation |
| `"reroute"` | `withFallback` moves to the next provider, or the multi-agent self-healing reroute sends the work to an equivalent agent |

**Discard everything you have rendered for the current generation** — since the stream started, or since the previous `stream_restart`, whichever is later. The next `token` chunk restarts `deltaCount` at `1`.

`generation` is an opaque marker: `2` for the first restart, `3` for the second. It is not a count of chunks. Nothing counts chunks here on purpose — chunks can be dropped under backpressure, so a count of emitted chunks would not agree with what a consumer received.

`stream_restart` is emitted **only when per-delta streaming was requested**. Without it a generation arrives as a single whole-message chunk and there is nothing part-rendered to discard.

```typescript
let rendered: string[] = [];

for await (const chunk of stream) {
  switch (chunk.type) {
    case "token":
      rendered.push(chunk.data);
      ui.append(chunk.data);
      break;
    case "stream_restart":
      // Everything from the abandoned attempt is about to arrive again.
      rendered = [];
      ui.replace("");
      console.warn(`restarting: ${chunk.reason}`);
      break;
    case "done":
      break;
  }
}
```

## A stream that ends early is an error

The shipped adapters require the provider's end-of-response marker — `[DONE]` or a `finish_reason` for OpenAI-compatible endpoints, `message_stop` for Anthropic, `done: true` for Ollama, a `finishReason` for Gemini. A body cut off mid-response arrives as a clean end of stream, so without that requirement a half-answer resolves successfully and reads exactly like a short one. When the marker never arrives the run rejects:

```
[Directive] Anthropic stream ended without a completion marker after 412 characters – the response is incomplete.
```

The marker also ends the read. `[DONE]` ends the body — nothing after it is parsed, delivered or accumulated, and the reader stops pulling. Text arriving after an end-of-response event is discarded whatever the provider, which is what a gateway joining two upstream generations onto one body produces. Token counts are still read past the marker, because OpenAI sends its usage frame after the `finish_reason` that ends the response.

A runner you built yourself with `createRunner` is unaffected unless you opt in, since a `parseEvent` written before the flag existed cannot report a marker:

```typescript
const runner = createRunner({
  buildRequest,
  parseResponse,
  streaming: {
    adapterName: "MyGateway",
    parseEvent: (event) => ({
      text: event.delta?.text,
      terminal: event.type === "response.completed",
    }),
    requireTerminalEvent: true,
  },
});
```

## When the provider reports no usage

Not every OpenAI-compatible endpoint honors `stream_options.include_usage` — vLLM, LiteLLM and older gateways commonly strip it. The response then carries no token counts at all, which is not the same as carrying zeros:

```typescript
const result = await runner(agent, prompt, { onToken: render });
result.tokenUsage;     // { inputTokens: 0, outputTokens: 0 }
result.usageReported;  // false — the zeros are absence, not a free call
```

A `usage` object whose counts are `null` says exactly the same thing as no `usage` object at all, and so does one whose counts are `0` — no call that reached a model consumed zero input tokens. `usageReported` requires a count above zero, not a present container. A genuinely empty completion still reports, because the input count beside it is not zero.

`withBudget` charges such a call from the text that arrived rather than recording `$0`, so rolling windows still accrue and ceilings still trip. The orchestrators' own `maxTokenBudget` accrues the same measurement, so `facts.agent.tokenUsage` rises for an unreported call rather than sitting at zero. Ask how much of the recorded spend is estimated:

```typescript
if (runner.getUnpricedCallCount() > 0) {
  console.warn("Provider is not reporting token usage — recorded spend is an estimate.");
}
```

## What a call is charged, and when

Everything charged after a call is measured from what the provider delivered, never from a figure something told the budget:

- **A completed call** is priced from its reported counts, or from the text it produced when there are none.
- **A call that throws** is priced from whatever reached `onToken` before it failed. A gateway that strips the completion marker generated, delivered and billed the whole response, and the throw comes afterwards.
- **A call that delivered nothing** costs nothing. A DNS failure or a refused connection is recorded as unpriceable, not as spend.
- **Extra requests a wrapper made** — a `withRetry` attempt, a `withFallback` reroute — are charged as their bytes arrive, so a budget composed around a retrying stack charges for the responses that stack received rather than for one.

The pre-call check is the only estimate that predicts anything, and it has nothing to measure yet: it scales output from input by `estimatedOutputMultiplier`. Tune that when your workload is shaped unlike the default — `0.3` for summarization, `3.0` for generation from a short prompt.

To stop enforcing a hard budget against estimates indefinitely, cap them:

```typescript
const runner = withBudget(baseRunner, {
  budgets: [{ window: "hour", maxCost: 5, pricing }],
  maxUnpricedCalls: 25,  // then throw UnpricedCallLimitError
});
```

The count is kept over a rolling window — the widest budget window configured, or an hour when there is none — so an outage that ends stops refusing calls once its failures age out. A nested budget's own refusal is neither charged nor counted: nothing was dispatched.

## Chunk counts are not token counts

`token` chunks carry `deltaCount` — the ordinal of the chunk within the current generation. `tokenCount` is **deprecated** and kept only because it is public API.

Neither field is a token count. On the per-delta path `deltaCount` counts provider deltas, and a delta is not a token: Anthropic emits multi-token deltas and Gemini emits sentence-sized ones. On the whole-message path it counts messages. For an authoritative count, read `result.tokenUsage` (or `result.totalTokens`) off the awaited `RunResult`.

```typescript
// WRONG — deltaCount/tokenCount are chunk ordinals, not tokens
const tokens = chunks.filter((c) => c.type === "token").at(-1)?.deltaCount;

// CORRECT — the result is authoritative
const final = await result;
console.log(final.totalTokens, final.tokenUsage);
```

## Backpressure strategies

Backpressure is configured on a **`StreamRunner` built by `createStreamingRunner`**, through `StreamRunOptions`. `orchestrator.runStream` does **not** accept `backpressure` or `bufferSize` — passing them there does nothing.

```typescript
import { createStreamingRunner } from "@directive-run/ai";

const streamRunner = createStreamingRunner(callbackBasedRunner);

const { stream, result } = streamRunner(agent, "Generate a long report", {
  signal: abortController.signal,
  backpressure: "block",    // default is "buffer"
  bufferSize: 1000,
  stopOnGuardrail: true,
  guardrailCheckInterval: 100,
});
```

| Strategy | Behavior | Use when |
|---|---|---|
| `"buffer"` | Buffers all chunks in memory | Consumer is slightly slow; memory is available |
| `"block"` | Pauses model generation — the adapter stops reading the provider stream until the consumer catches up | Consumer must process every token |
| `"drop"` | Drops chunks that do not fit; `done.droppedTokens` reports the count | Real-time display; some loss acceptable |

`"block"` genuinely stops the reader pulling. It relies on `onToken` being awaited all the way down, which the shipped adapters do.

`orchestrator.runStream` has its own fixed-size buffer instead of a strategy. On overflow it drops the **newest** droppable chunk — so the beginning of a message survives and the tail is what is lost. Droppable means content and notifications: `token`, `message`, `progress`, `tool_start`, `tool_end`, `context_updated`. A control chunk (`stream_restart`, `approval_required`, `interrupted`, `done`, `error`) is never refused: it makes room by evicting the newest droppable chunk, or the oldest chunk of any kind when nothing droppable is buffered. The cap applies to every type, so a consumer that stops reading cannot make the buffer grow without limit whatever the run emits. Every drop is counted and reported, on `done` and on `error` alike:

```typescript
case "done":
  if (chunk.droppedTokens > 0) {
    console.warn(`${chunk.droppedTokens} chunks dropped — consumer fell behind`);
  }
  break;
```

## `createStreamingRunner(baseRunner, options?)`

Wrap a base streaming runner (a `StreamingCallbackRunner` — the callback-based adapter interface) into a `StreamRunner` that produces the async-iterator chunks shown above. The factory is `createStreamingRunner`, NOT `createStreamingCallbackRunner` (the "callback" form is the INPUT to this wrapper, not a separate factory).

```typescript
import { createStreamingRunner, type StreamingCallbackRunner } from "@directive-run/ai";

// The base runner is callback-driven. You supply this from your provider adapter.
const callbackBased: StreamingCallbackRunner = (agent, input, { onToken, onToolStart, onToolEnd, onComplete, signal }) => {
  // … call your provider's streaming API; invoke the callbacks as tokens arrive.
  // Await onToken — that is what makes backpressure: "block" work.
};

const streamRunner = createStreamingRunner(callbackBased, {
  streamingGuardrails: [],
});

// Use it directly — returns the same { stream, result, abort } shape
const { stream, result, abort } = streamRunner(agent, "prompt", { backpressure: "buffer" });
```

## `createSSETransport(config?)`

Pipes a token stream to Server-Sent Events for browser consumption. `createSSEResponse` does NOT exist — the real factory is `createSSETransport`, and it returns `{ toResponse, toStream }`.

```typescript
import { createSSETransport } from "@directive-run/ai";

const sse = createSSETransport({
  maxResponseChars: 50_000,
  truncationMessage: "\n\n*[Response truncated]*",
  heartbeatIntervalMs: 15_000,
  headers: { "X-AI-Service": "directive" },
  errorMessages: { rate_limit: "Service busy — please retry shortly." },
});

// Modern web frameworks (Hono, Next.js, Bun, Deno) — return a Response directly
export async function POST(req: Request) {
  const { prompt } = await req.json();
  const { stream } = orchestrator.runStream(agent, prompt, { deltas: true });

  return sse.toResponse(stream, agent.name, prompt);
}

// Express / Koa — write to res via the ReadableStream
app.post("/api/chat", async (req, res) => {
  const { stream } = orchestrator.runStream(agent, req.body.prompt, { deltas: true });
  const readable = sse.toStream(stream, agent.name, req.body.prompt);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  for await (const chunk of readable) {
    res.write(chunk);
  }
  res.end();
});
```

Client-side consumption is plain SSE:

```typescript
const eventSource = new EventSource("/api/chat");

eventSource.addEventListener("text", (event) => {
  const data = JSON.parse(event.data) as { type: "text"; text: string };
  appendToDisplay(data.text);
});

eventSource.addEventListener("done", () => eventSource.close());
```

## Anti-patterns

### Iterating `runStream` directly

```typescript
// WRONG — runStream returns { stream, result, abort }, not the iterator itself
const stream = orchestrator.runStream(agent, prompt);
for await (const chunk of stream) { /* won't iterate the right thing */ }

// CORRECT — destructure
const { stream, result, abort } = orchestrator.runStream(agent, prompt);
for await (const chunk of stream) { /* … */ }
const final = await result;
```

### Passing a no-op `onToken` just to turn deltas on

```typescript
// WRONG — a callback whose only job is to signal intent
const { stream } = orchestrator.runStream(agent, prompt, { onToken: () => {} });

// CORRECT — say what you mean
const { stream } = orchestrator.runStream(agent, prompt, { deltas: true });
```

### Passing `backpressure` to `runStream`

```typescript
// WRONG — runStream has no such option; this is silently ignored
const { stream } = orchestrator.runStream(agent, prompt, {
  backpressure: "block",
  bufferSize: 100,
});

// CORRECT — those belong to a StreamRunner from createStreamingRunner
const streamRunner = createStreamingRunner(callbackBasedRunner);
const { stream } = streamRunner(agent, prompt, { backpressure: "block", bufferSize: 100 });
```

### Ignoring `stream_restart`

```typescript
// WRONG — the abandoned attempt's tokens stay on screen, then the whole
// response arrives again after them
for await (const chunk of stream) {
  if (chunk.type === "token") ui.append(chunk.data);
}

// CORRECT — clear the generation the restart says is void
for await (const chunk of stream) {
  if (chunk.type === "token") ui.append(chunk.data);
  if (chunk.type === "stream_restart") ui.clear();
}
```

### Reading `tokenUsage.total`

```typescript
// WRONG — TokenUsage has no `total` field
console.log(result.tokenUsage?.total);

// CORRECT — sum, or use the top-level totalTokens
console.log(result.totalTokens);
console.log((result.tokenUsage?.inputTokens ?? 0) + (result.tokenUsage?.outputTokens ?? 0));
```

### Not checking `chunk.type` before accessing fields

```typescript
// WRONG — not every chunk has .data; this is undefined for tool_start/done/etc.
for await (const chunk of stream) {
  console.log(chunk.data);
}

// CORRECT — switch / narrow on chunk.type
for await (const chunk of stream) {
  if (chunk.type === "token") {
    process.stdout.write(chunk.data);
  }
}
```

### Ignoring `guardrail_triggered.stopped`

```typescript
// WRONG — continuing after a stopping guardrail
case "guardrail_triggered":
  console.log("guardrail fired, continuing…");
  break;

// CORRECT — `stopped: true` means the stream was terminated by the guardrail
case "guardrail_triggered":
  if (chunk.stopped) {
    console.error(`stopped by ${chunk.guardrailName}: ${chunk.reason}`);
    abort();
    return;
  }
  break;
```

## Quick reference

| Type / API | Path | Purpose |
|---|---|---|
| `AgentLike` | `@directive-run/ai` | `{ name, instructions?, model?, tools? }` — what runners receive |
| `RunResult<T>` | `@directive-run/ai` | `{ output, messages, toolCalls, totalTokens, tokenUsage?, usageReported?, isCached? }` |
| `StreamChunk` | `@directive-run/ai` | 9-way discriminated union for streaming output |
| `StreamRestartChunk` | `@directive-run/ai` | `{ reason, generation }` — the runner was re-invoked; discard the current generation and re-render |
| `RunOptions.onStreamRestart` | `@directive-run/ai` | The same boundary as a callback, for `run({ onToken })`; wrappers call it when they re-invoke |
| `StreamConsumerError` | `@directive-run/ai` | Thrown when your `onToken` throws; retry and fallback stop rather than re-spending |
| `orchestrator.runStream(agent, input, opts?)` | instance method | Returns `{ stream, result, abort }`; `opts` is `{ signal?, deltas?, onToken?, liveContext? }` |
| `orchestrator.runAgentStream(agentId, input, opts?)` | multi-agent instance method | Same triple; `opts` is `{ signal?, deltas?, onToken? }` |
| `orchestrator.runParallelStream(ids, inputs, merge, opts?)` | multi-agent instance method | Multiplexed stream; `opts` takes `deltas?` for per-delta chunks tagged by agent |
| `RunOptions.onToken` | `@directive-run/ai` | Per-delta callback on any runner; awaited, so it applies backpressure |
| `createStreamingRunner(baseRunner, opts?)` | `@directive-run/ai` | Wrap a `StreamingCallbackRunner` into a `StreamRunner` |
| `StreamRunOptions` | `@directive-run/ai` | `backpressure` / `bufferSize` / guardrail options for a `StreamRunner` |
| `createSSETransport(config?)` | `@directive-run/ai` | `{ toResponse, toStream }` for piping a stream to SSE |

## See also

- [`ai-adapters.md`](./ai-adapters.md) — provider runners that produce the streams this file consumes
- [`ai-orchestrator.md`](./ai-orchestrator.md) — `orchestrator.runStream(agent, input)` returns the `{ stream, result, abort }` triple this file documents
