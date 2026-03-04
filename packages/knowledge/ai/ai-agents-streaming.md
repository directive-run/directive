# AI Agents and Streaming

Defines the AgentLike interface (what runners receive), RunResult (what runners return), StreamChunk union types, backpressure strategies, and SSE transport.

## Decision Tree: "How do I get output from an agent?"

```
Need the complete result?
├── Yes → orchestrator.run(agent, prompt) → RunResult
└── No, need incremental output
    ├── AsyncIterable → orchestrator.runStream(agent, prompt)
    ├── Callback-based → StreamingCallbackRunner
    └── Server-Sent Events → createSSEResponse()
        │
        Backpressure concern?
        ├── Consumer is slow → strategy: "block"
        ├── Can drop tokens  → strategy: "drop"
        └── Default          → strategy: "buffer"
```

## AgentLike – What the Runner Receives

```typescript
interface AgentLike {
  // Required – unique identifier
  name: string;

  // System prompt / instructions
  instructions?: string;

  // Model identifier (adapter-specific)
  model?: string;

  // Tools the agent can use
  tools?: unknown[];
}

// Usage
const agent: AgentLike = {
  name: "analyst",
  instructions: "You analyze data and provide insights.",
  model: "claude-sonnet-4-5",
  tools: [searchTool, calculatorTool],
};
```

## RunResult – What the Runner Returns

```typescript
interface RunResult<T = unknown> {
  // The agent's final output
  output: T;

  // Full message history from this run
  messages: Message[];

  // Tool calls made during this run
  toolCalls: ToolCall[];

  // Total tokens consumed (input + output)
  totalTokens: number;

  // Detailed token breakdown
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

// Usage
const result = await orchestrator.run(agent, "Analyze sales data");
console.log(result.output);
console.log(`Tokens used: ${result.totalTokens}`);
console.log(`Tool calls: ${result.toolCalls.length}`);
```

## StreamChunk Union Types

Each chunk from `runStream` is one of these discriminated union types:

```typescript
type StreamChunk =
  // Text token from the model
  | { type: "token"; data: string; tokenCount: number }

  // Tool execution started
  | { type: "tool_start"; tool: string; toolCallId: string; arguments: string }

  // Tool execution completed
  | { type: "tool_end"; tool: string; toolCallId: string; result: string }

  // Complete message added to history
  | { type: "message"; message: Message }

  // Guardrail was triggered during streaming
  | { type: "guardrail_triggered"; guardrailName: string; reason: string; stopped: boolean }

  // Progress indicator
  | { type: "progress"; phase: "starting" | "generating" | "tool_calling" | "finishing" }

  // Stream completed
  | { type: "done"; totalTokens: number; duration: number; droppedTokens: number }

  // Error during streaming
  | { type: "error"; error: Error };
```

## Consuming a Stream

```typescript
const stream = orchestrator.runStream(agent, "Write a report");

for await (const chunk of stream) {
  switch (chunk.type) {
    case "token":
      process.stdout.write(chunk.data);
      break;
    case "tool_start":
      console.log(`\nCalling tool: ${chunk.tool}`);
      break;
    case "tool_end":
      console.log(`Tool result: ${chunk.result.slice(0, 100)}`);
      break;
    case "guardrail_triggered":
      console.warn(`Guardrail ${chunk.guardrailName}: ${chunk.reason}`);
      if (chunk.stopped) {
        console.error("Stream stopped by guardrail");
      }
      break;
    case "done":
      console.log(`\nTokens: ${chunk.totalTokens}, Duration: ${chunk.duration}ms`);
      break;
    case "error":
      console.error("Stream error:", chunk.error);
      break;
  }
}
```

## Backpressure Strategies

Control behavior when the consumer cannot keep up with token production:

```typescript
const stream = orchestrator.runStream(agent, "Generate long report", {
  backpressure: "buffer",  // default – buffer all tokens in memory
});

const stream = orchestrator.runStream(agent, "Generate long report", {
  backpressure: "block",   // pause generation until consumer catches up
});

const stream = orchestrator.runStream(agent, "Generate long report", {
  backpressure: "drop",    // drop tokens consumer cannot process in time
});
```

| Strategy | Behavior | Use When |
|---|---|---|
| `"buffer"` | Buffers all tokens in memory | Consumer is slightly slow, memory is available |
| `"block"` | Pauses model generation | Consumer must process every token |
| `"drop"` | Drops unprocessed tokens | Real-time display, some loss acceptable |

When using `"drop"`, the `done` chunk reports `droppedTokens` count.

## StreamingCallbackRunner

For callback-based streaming (instead of AsyncIterable):

```typescript
import { createStreamingCallbackRunner } from "@directive-run/ai";

const callbackRunner = createStreamingCallbackRunner(runner, {
  onToken: (token) => process.stdout.write(token),
  onToolStart: (tool, id) => console.log(`Tool: ${tool}`),
  onToolEnd: (tool, id, result) => console.log(`Result: ${result}`),
  onComplete: (result) => console.log("Done:", result.totalTokens),
  onError: (error) => console.error(error),
});

// Use in orchestrator
const orchestrator = createAgentOrchestrator({
  runner: callbackRunner,
});
```

## SSE Transport (Server-Sent Events)

Pipe agent streaming to HTTP responses for web servers:

```typescript
import { createSSEResponse } from "@directive-run/ai";

// Express / Node HTTP handler
app.post("/api/chat", async (req, res) => {
  const stream = orchestrator.runStream(agent, req.body.prompt);

  // Creates a ReadableStream of SSE-formatted events
  const sseResponse = createSSEResponse(stream);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  for await (const event of sseResponse) {
    res.write(event);
  }

  res.end();
});
```

Client-side consumption:

```typescript
const eventSource = new EventSource("/api/chat");

eventSource.onmessage = (event) => {
  const chunk = JSON.parse(event.data);
  if (chunk.type === "token") {
    appendToDisplay(chunk.data);
  }
};
```

## Common Mistakes

### Not checking chunk.type before accessing fields

```typescript
// WRONG – not all chunks have .data
for await (const chunk of stream) {
  console.log(chunk.data); // undefined for non-token chunks
}

// CORRECT – switch on chunk.type
for await (const chunk of stream) {
  if (chunk.type === "token") {
    console.log(chunk.data);
  }
}
```

### Ignoring the stopped flag on guardrail chunks

```typescript
// WRONG – continuing after a stopping guardrail
case "guardrail_triggered":
  console.log("Guardrail triggered, continuing...");
  break;

// CORRECT – check if the stream was stopped
case "guardrail_triggered":
  if (chunk.stopped) {
    console.error(`Stopped by ${chunk.guardrailName}: ${chunk.reason}`);
    // Handle stream termination
  }
  break;
```

## Quick Reference

| Type | Interface | Purpose |
|---|---|---|
| `AgentLike` | `{ name, instructions?, model?, tools? }` | Agent definition |
| `RunResult` | `{ output, messages, toolCalls, totalTokens }` | Complete run result |
| `StreamChunk` | Discriminated union (8 types) | Incremental output |
| `StreamingCallbackRunner` | Callback-based adapter | Alternative to AsyncIterable |
| `createSSEResponse` | SSE formatter | Web server streaming |
