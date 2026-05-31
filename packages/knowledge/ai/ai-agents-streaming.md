# AI agents + streaming

> Covers `@directive-run/ai` — `AgentLike`, `RunResult`, `StreamChunk`, backpressure, `createStreamingRunner`, `createSSETransport`.

Defines the `AgentLike` shape, the `RunResult` returned by every runner, the `StreamChunk` discriminated union, backpressure strategies, the streaming runner wrapper, and the SSE transport for piping tokens to a browser.

## Decision tree

```
Need the complete result?
├── Yes                          → orchestrator.run(agent, prompt) → Promise<RunResult>
└── No, need incremental output
    ├── Async-iterator stream    → orchestrator.runStream(agent, prompt) → { stream, result, abort }
    ├── Wrap a base runner       → createStreamingRunner(baseRunner, opts) → StreamRunner
    └── Server-Sent Events to HTTP → createSSETransport(config) → { toResponse, toStream }

Backpressure concern?
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
  // Note: NO `total` field — sum `inputTokens + outputTokens` when needed, or use `result.totalTokens`.
}
```

## `StreamChunk` discriminated union

```typescript
type StreamChunk =
  | { type: "token"; data: string; tokenCount: number }                                   // a text token from the model
  | { type: "tool_start"; tool: string; toolCallId: string; arguments: string }            // tool started executing
  | { type: "tool_end"; tool: string; toolCallId: string; result: string }                 // tool finished
  | { type: "message"; message: Message }                                                  // a complete message added to history
  | { type: "guardrail_triggered"; guardrailName: string; reason: string; stopped: boolean } // a guardrail fired during streaming
  | { type: "progress"; phase: "starting" | "generating" | "tool_calling" | "finishing" }   // coarse progress
  | { type: "done"; totalTokens: number; duration: number; droppedTokens: number }          // stream complete
  | { type: "error"; error: Error };                                                       // stream aborted with an error
```

## Consuming `runStream`

`orchestrator.runStream(agent, input, options?)` returns **`OrchestratorStreamResult<T>`** — a `{ stream, result, abort }` triple, NOT an `AsyncIterable` directly. Destructure it before iterating.

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

## Backpressure strategies

Configure how the stream behaves when the consumer can't keep up. Pass via `runStream`'s `options` (orchestrator-side) or via the `StreamRunOptions` if you're calling a `StreamRunner` directly.

```typescript
const { stream, result } = orchestrator.runStream(agent, "Generate a long report", {
  signal: abortController.signal,
  backpressure: "buffer",   // default — buffer all tokens
  // backpressure: "block"   // pause generation until consumer catches up
  // backpressure: "drop"    // drop unprocessed tokens; `done.droppedTokens` reports the count
  bufferSize: 1000,
  stopOnGuardrail: true,
  guardrailCheckInterval: 100,
});
```

| Strategy | Behavior | Use when |
|---|---|---|
| `"buffer"` | Buffers all tokens in memory | Consumer is slightly slow; memory is available |
| `"block"` | Pauses model generation | Consumer must process every token |
| `"drop"` | Drops unprocessed tokens | Real-time display; some loss acceptable |

## `createStreamingRunner(baseRunner, options?)`

Wrap a base streaming runner (a `StreamingCallbackRunner` — the callback-based adapter interface) into a `StreamRunner` that produces the async-iterator chunks shown above. The factory is `createStreamingRunner`, NOT `createStreamingCallbackRunner` (the "callback" form is the INPUT to this wrapper, not a separate factory).

```typescript
import { createStreamingRunner, type StreamingCallbackRunner } from "@directive-run/ai";

// The base runner is callback-driven. You supply this from your provider adapter.
const callbackBased: StreamingCallbackRunner = (agent, input, { onToken, onToolStart, onToolEnd, onComplete, signal }) => {
  // … call your provider's streaming API; invoke the callbacks as tokens arrive
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
  const { stream } = orchestrator.runStream(agent, prompt);

  return sse.toResponse(stream, agent.name, prompt);
}

// Express / Koa — write to res via the ReadableStream
app.post("/api/chat", async (req, res) => {
  const { stream } = orchestrator.runStream(agent, req.body.prompt);
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

### Importing `createStreamingCallbackRunner`

```typescript
// WRONG — no factory by that name
import { createStreamingCallbackRunner } from "@directive-run/ai";

// CORRECT — wrap a callback-based runner with createStreamingRunner
import { createStreamingRunner } from "@directive-run/ai";
const wrapped = createStreamingRunner(callbackBasedRunner, { streamingGuardrails: [] });
```

### Importing `createSSEResponse`

```typescript
// WRONG — no factory by that name
import { createSSEResponse } from "@directive-run/ai";
const sse = createSSEResponse(stream);

// CORRECT — createSSETransport returns { toResponse, toStream }
import { createSSETransport } from "@directive-run/ai";
const sse = createSSETransport({ heartbeatIntervalMs: 15_000 });
return sse.toResponse(stream, agentId, prompt);
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
| `RunResult<T>` | `@directive-run/ai` | `{ output, messages, toolCalls, totalTokens, tokenUsage?, isCached? }` |
| `StreamChunk` | `@directive-run/ai` | 8-way discriminated union for streaming output |
| `orchestrator.runStream(agent, input, opts?)` | instance method | Returns `{ stream, result, abort }` |
| `createStreamingRunner(baseRunner, opts?)` | `@directive-run/ai` | Wrap a `StreamingCallbackRunner` into a `StreamRunner` |
| `createSSETransport(config?)` | `@directive-run/ai` | `{ toResponse, toStream }` for piping a stream to SSE |
