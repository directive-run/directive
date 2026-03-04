---
name: building-ai-agents
description: "Configure AI provider runners (Anthropic, OpenAI, Ollama), stream tokens and structured output, and wire cross-agent communication. Use when setting up LLM provider connections, implementing token streaming, choosing between providers, or building agents that communicate results to each other."
---

# Building AI Agents

# When Claude Should Use This Skill

## Auto-Invoke Triggers
- User asks which LLM provider to use or how to set one up
- User wants to stream tokens or handle streaming responses
- User mentions `createAnthropicRunner`, `createOpenAIRunner`, `createOllamaRunner`
- User asks how agents share data or pass results between each other
- User needs to switch providers or implement a provider abstraction

## Exclusions
- Do NOT invoke for orchestrator structure (constraints/resolvers) — use `building-ai-orchestrators`
- Do NOT invoke for rate limits, budgets, or guardrails — use `hardening-ai-systems`
- Do NOT invoke for testing runners — use `testing-ai-systems`

---

# Quick Reference

## Decision Tree: Which Runner?

```
Choosing a provider?
├── Production, best quality → createAnthropicRunner (claude-opus-4-6)
├── Production, cost-efficient → createAnthropicRunner (claude-haiku-4-5)
├── OpenAI ecosystem / GPT models → createOpenAIRunner
├── Local / private / no API key → createOllamaRunner
└── Custom provider → implement AgentRunner interface
```

## Decision Tree: Streaming vs Non-Streaming?

```
Need the response immediately as it arrives?
├── Yes, show tokens as they generate → runStream() + "token" events
├── Yes, but structured JSON → runStream() + "structured" events
└── No, wait for full response → run()
```

---

## Provider Runners

### Anthropic

```typescript
import { createAnthropicRunner } from "@directive-run/ai/anthropic";

const runner = createAnthropicRunner({
  model: "claude-opus-4-6",           // or "claude-haiku-4-5", "claude-sonnet-4-6"
  apiKey: process.env.ANTHROPIC_API_KEY,
  maxTokens: 4096,                    // optional, default: 1024
  temperature: 0.7,                   // optional, default: 1.0
  systemPrompt: "You are helpful.",   // optional default system prompt
});
```

### OpenAI

```typescript
import { createOpenAIRunner } from "@directive-run/ai/openai";

const runner = createOpenAIRunner({
  model: "gpt-4o",                    // or "gpt-4o-mini", "gpt-3.5-turbo"
  apiKey: process.env.OPENAI_API_KEY,
  maxTokens: 4096,
  temperature: 0.7,
  organization: "org-...",            // optional
});
```

### Ollama (Local)

```typescript
import { createOllamaRunner } from "@directive-run/ai/ollama";

const runner = createOllamaRunner({
  model: "llama3.2",                  // any Ollama-installed model
  baseUrl: "http://localhost:11434",  // default Ollama endpoint
  temperature: 0.8,
});
```

---

## Running LLM Calls Inside Resolvers

```typescript
resolvers: {
  generate: {
    requirement: "GENERATE",
    resolve: async (req, context) => {
      // Basic call — returns full response when complete
      const result = await context.runner.run({
        prompt: "Explain quantum entanglement simply.",
        system: "You are a science communicator.",
        maxTokens: 500,
      });

      context.facts.output = result.text;
      context.facts.tokenUsage = result.usage.totalTokens;
    },
  },
},
```

## Runner Result Shape

```typescript
interface RunnerResult {
  text: string;           // Generated text
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  model: string;          // Model used
  stopReason: "end_turn" | "max_tokens" | "stop_sequence";
  raw: unknown;           // Raw provider response
}
```

---

## Streaming

### Token Streaming

```typescript
// orchestrator.runStream() returns AsyncIterable<OrchestratorEvent>
const stream = orchestrator.runStream({ input: "Write a story about..." });

for await (const event of stream) {
  if (event.type === "token") {
    // Arrives as the LLM generates — display immediately
    process.stdout.write(event.text);
  }

  if (event.type === "done") {
    console.log("\nFinal facts:", event.facts);
  }

  if (event.type === "error") {
    console.error("Stream error:", event.error.message);
    break;
  }
}
```

### All Stream Event Types

```typescript
type OrchestratorEvent =
  | { type: "token"; text: string; agentId?: string }
  | { type: "requirement_met"; requirementType: string; agentId?: string }
  | { type: "requirement_queued"; requirementType: string }
  | { type: "agent_started"; agentId: string }
  | { type: "agent_done"; agentId: string }
  | { type: "done"; facts: Record<string, unknown> }
  | { type: "error"; error: Error };
```

### Structured Output Streaming

```typescript
import { z } from "zod";

// When you need typed JSON output, not raw text
const result = await context.runner.runStructured({
  prompt: "Extract product info from this description: ...",
  schema: z.object({
    name: z.string(),
    price: z.number(),
    inStock: z.boolean(),
  }),
});

// result.data is typed to the schema
context.facts.productName = result.data.name;
context.facts.price = result.data.price;
```

### Emitting Custom Stream Events from Resolvers

```typescript
resolve: async (req, context) => {
  // Emit custom events consumers can observe
  context.emit({ type: "token", text: "Starting analysis..." });

  const result = await context.runner.run({ prompt: req.input });

  context.emit({ type: "token", text: result.text });
  context.facts.output = result.text;
},
```

---

## Cross-Agent Communication

### Via Coordinator Facts (Recommended)

In `createMultiAgentOrchestrator`, agents share coordinator facts. The coordinator acts as the message bus.

```typescript
// researcher agent writes to coordinator facts
resolve: async (req, context) => {
  const result = await context.runner.run({ prompt: "Research AI trends..." });
  // Writing to shared coordinator facts signals the next agent
  context.facts.researchComplete = true;
  context.facts.researchNotes = result.text;
},

// writer agent reads coordinator facts set by researcher
constraints: {
  startWriting: {
    // Only activates after researcher signals completion
    when: (facts) => facts.researchComplete && !!facts.researchNotes,
    require: { type: "WRITE_ARTICLE" },
  },
},
```

### Via Requirement Payload

```typescript
// Pass structured data in the requirement itself
constraints: {
  routeToSpecialist: {
    when: (facts) => facts.analysisType === "legal",
    require: (facts) => ({
      type: "SPECIALIST_REVIEW",
      category: facts.analysisType,
      priority: facts.urgency,
      content: facts.draftOutput,
    }),
  },
},

resolvers: {
  specialistReview: {
    requirement: "SPECIALIST_REVIEW",
    resolve: async (req, context) => {
      // req contains { category, priority, content } from above
      const result = await context.runner.run({
        prompt: `Review this ${req.category} content: ${req.content}`,
      });
      context.facts.reviewedOutput = result.text;
    },
  },
},
```

---

## Custom Provider — Implement AgentRunner Interface

```typescript
import type { AgentRunner, RunOptions, RunnerResult } from "@directive-run/ai";

class MyCustomRunner implements AgentRunner {
  async run(options: RunOptions): Promise<RunnerResult> {
    // Call your provider
    const response = await myProviderClient.generate({
      prompt: options.prompt,
      system: options.system,
    });

    return {
      text: response.text,
      usage: {
        inputTokens: response.usage.input,
        outputTokens: response.usage.output,
        totalTokens: response.usage.total,
      },
      model: "my-custom-model",
      stopReason: "end_turn",
      raw: response,
    };
  }

  // Optional: implement for streaming support
  async *runStream(options: RunOptions): AsyncIterable<string> {
    for await (const chunk of myProviderClient.stream(options)) {
      yield chunk.text;
    }
  }
}
```

---

## Multi-Turn Conversations

```typescript
// Maintain conversation history in facts
factsSchema: {
  messages: t.array(t.object<{ role: "user" | "assistant"; content: string }>()),
  latestInput: t.string(),
  latestOutput: t.string().optional(),
},

init: (facts) => {
  facts.messages = [];
},

resolve: async (req, context) => {
  // Add user message to history
  context.facts.messages.push({
    role: "user",
    content: context.facts.latestInput,
  });

  const result = await context.runner.run({
    messages: context.facts.messages,  // Pass full history
    system: "You are a helpful assistant.",
  });

  // Add assistant reply to history
  context.facts.messages.push({
    role: "assistant",
    content: result.text,
  });

  context.facts.latestOutput = result.text;
},
```

---

# Critical Anti-Patterns

## Not handling stream errors

```typescript
// WRONG — if stream throws, it crashes uncaught
for await (const event of orchestrator.runStream(input)) {
  if (event.type === "token") {
    process.stdout.write(event.text);
  }
}

// CORRECT — always handle error events
for await (const event of orchestrator.runStream(input)) {
  if (event.type === "token") {
    process.stdout.write(event.text);
  }

  if (event.type === "error") {
    console.error("Stream failed:", event.error.message);
    break;
  }
}
```

## Blocking on stream consumption inside a resolver

```typescript
// WRONG — consuming a stream inside a resolver blocks the engine
resolve: async (req, context) => {
  const stream = orchestrator.runStream(req.input);
  for await (const event of stream) { /* deadlock risk */ }
},

// CORRECT — use context.runner.run() inside resolvers
resolve: async (req, context) => {
  const result = await context.runner.run({ prompt: req.input });
  context.facts.output = result.text;
},
```

## Using ctx instead of context

```typescript
// WRONG
resolve: async (req, ctx) => { ctx.facts.output = "..."; }

// CORRECT
resolve: async (req, context) => { context.facts.output = "..."; }
```

## Hardcoding API keys

```typescript
// WRONG
const runner = createAnthropicRunner({ apiKey: "sk-ant-..." });

// CORRECT
const runner = createAnthropicRunner({ apiKey: process.env.ANTHROPIC_API_KEY });
```

## Ignoring token usage

```typescript
// WRONG — fire and forget, no budget awareness
const result = await context.runner.run({ prompt });
context.facts.output = result.text;

// CORRECT — track usage for budget management
const result = await context.runner.run({ prompt });
context.facts.output = result.text;
context.facts.tokensUsed = (context.facts.tokensUsed ?? 0) + result.usage.totalTokens;
```

---

# Reference Files

- `knowledge/ai-agents-streaming.md` — Streaming events, AsyncIterable patterns, token buffering
- `knowledge/ai-adapters.md` — Provider adapter interface, all runner options, custom runner guide
- `knowledge/ai-communication.md` — Cross-agent communication, coordinator facts, requirement payloads
