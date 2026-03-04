---
name: testing-ai-systems
description: "Test AI orchestrators without real LLM API calls using createMockRunner, write quality evaluations for agent output, add debug observability with tracing and metrics, integrate MCP tool servers, and wire RAG pipelines. Use when writing unit tests for agents, setting up CI evaluation suites, debugging orchestrator behavior, or connecting external tool sources."
---

# Testing AI Systems

## Prerequisites

This skill applies when the project uses `@directive-run/ai`. If not found in `package.json`, suggest installing it: `npm install @directive-run/ai`.

## When Claude Should Use This Skill

## Auto-Invoke Triggers
- User asks how to test agents or orchestrators without calling real APIs
- User mentions `createMockRunner` or wants to mock LLM responses
- User wants to run evaluation suites or measure output quality
- User asks about tracing, logging, or debugging orchestrator execution
- User mentions MCP (Model Context Protocol) or tool servers
- User wants to add RAG (retrieval-augmented generation) to an agent

## Exclusions
- Do NOT invoke for production guardrails or security — use `hardening-ai-systems`
- Do NOT invoke for orchestrator setup — use `building-ai-orchestrators`
- Do NOT invoke for provider runner config — use `building-ai-agents`

---

## Quick Reference

## Decision Tree: Testing Approach

```
What are you testing?
├── Single resolver behavior → createMockRunner + unit test
├── Full orchestrator flow → createTestOrchestrator
├── Multi-agent pipeline → createTestMultiAgentOrchestrator
├── Output quality (LLM-as-judge) → createEvaluation + assertOutputQuality
├── Regression suite in CI → evaluation suite with recorded fixtures
└── Live debug of production → enableTracing + observability plugins
```

---

## createMockRunner — Test Without API Calls

```typescript
import { createMockRunner } from "@directive-run/ai/testing";

// Static responses — returned in sequence
const mockRunner = createMockRunner({
  responses: [
    { text: "First response.", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
    { text: "Second response.", usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } },
  ],
});

// Dynamic — choose response based on prompt
const dynamicRunner = createMockRunner({
  handler: async (options) => {
    if (options.prompt.includes("capital")) {
      return { text: "Paris", usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } };
    }

    return { text: "I don't know.", usage: { inputTokens: 5, outputTokens: 4, totalTokens: 9 } };
  },
});

// Simulate failures for error-path tests
const failingRunner = createMockRunner({
  handler: async () => {
    throw new Error("rate_limit: Too many requests");
  },
});
```

## Unit Testing a Resolver

```typescript
import { createAgentOrchestrator } from "@directive-run/ai";
import { createMockRunner } from "@directive-run/ai/testing";
import { t } from "@directive-run/core";
import { describe, it, expect } from "vitest";

// Build orchestrator with injected runner — enables swapping real/mock
function buildOrchestrator(runner: AgentRunner) {
  return createAgentOrchestrator({
    runner,
    factsSchema: {
      input: t.string(),
      output: t.string().optional(),
      status: t.string<"idle" | "done" | "error">(),
      errorMessage: t.string().optional(),
    },
    init: (facts) => {
      facts.status = "idle";
    },
    constraints: {
      process: {
        when: (facts) => facts.status === "idle" && !!facts.input,
        require: { type: "PROCESS" },
      },
    },
    resolvers: {
      process: {
        requirement: "PROCESS",
        resolve: async (req, context) => {
          try {
            const result = await context.runner.run({ prompt: context.facts.input });
            context.facts.output = result.text;
            context.facts.status = "done";
          } catch (error) {
            context.facts.status = "error";
            context.facts.errorMessage = (error as Error).message;
          }
        },
      },
    },
  });
}

describe("process resolver", () => {
  it("sets output on success", async () => {
    const orchestrator = buildOrchestrator(
      createMockRunner({ responses: [{ text: "Result.", usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } }] })
    );
    const result = await orchestrator.run({ input: "test input" });

    expect(result.facts.status).toBe("done");
    expect(result.facts.output).toBe("Result.");
  });

  it("captures errors in facts", async () => {
    const orchestrator = buildOrchestrator(
      createMockRunner({ handler: async () => { throw new Error("Provider down"); } })
    );
    const result = await orchestrator.run({ input: "test" });

    expect(result.facts.status).toBe("error");
    expect(result.facts.errorMessage).toContain("Provider down");
  });
});
```

## Testing Multi-Agent Orchestrators

```typescript
import { createTestMultiAgentOrchestrator, assertMultiAgentState } from "@directive-run/ai/testing";

describe("research-write pipeline", () => {
  it("passes research to writer via coordinator facts", async () => {
    const testOrchestrator = createTestMultiAgentOrchestrator({
      agentRunners: {
        researcher: createMockRunner({
          responses: [{ text: "Finding: qubits enable quantum advantage.", usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 } }],
        }),
        writer: createMockRunner({
          responses: [{ text: "Qubits are the foundation of quantum computing.", usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 } }],
        }),
      },
    });

    const result = await testOrchestrator.run({ topic: "quantum computing" });

    assertMultiAgentState(result, {
      "researcher.researchComplete": true,
      "coordinator.phase": "done",
    });
    expect(result.facts.finalOutput).toContain("qubit");
  });
});
```

---

## Evaluation Framework

```typescript
import { createEvaluation, assertOutputQuality } from "@directive-run/ai/testing";

const summaryEval = createEvaluation({
  name: "summarization-quality",
  cases: [
    {
      id: "basic-summary",
      input: { text: "A very long article about climate change..." },
      expected: {
        contains: ["climate", "temperature"],
        maxWords: 50,
        notContains: ["Lorem ipsum"],
      },
    },
  ],
});

describe("summarization evals", () => {
  it("meets quality criteria", async () => {
    for (const evalCase of summaryEval.cases) {
      const result = await orchestrator.run(evalCase.input);
      assertOutputQuality(result.facts.output, evalCase.expected);
    }
  });
});
```

### LLM-as-Judge

```typescript
import { createLLMJudge } from "@directive-run/ai/testing";

const judge = createLLMJudge({
  runner: createAnthropicRunner({ model: "claude-haiku-4-5", apiKey: process.env.ANTHROPIC_API_KEY }),
  criteria: ["Is the response factually accurate?", "Is the response concise?"],
  scoringScale: { min: 1, max: 5 },
  passingScore: 3.5,
});

it("produces quality output", async () => {
  const result = await orchestrator.run({ input: "Explain photosynthesis." });
  const judgment = await judge.evaluate(result.facts.output);

  expect(judgment.passed).toBe(true);
});
```

---

## Debug Observability

```typescript
import { createTracingPlugin, createLoggingPlugin, createMetricsPlugin } from "@directive-run/ai/plugins";
import { createInspector } from "@directive-run/ai/testing";

// Tracing — spans around every LLM call and resolver
const tracer = createTracingPlugin({
  exportTo: "console",  // "console" | "opentelemetry" | "custom"
  onSpanEnd: (span) => console.log(`[${span.name}] ${span.duration}ms — ${span.status}`),
});

// Structured logging for LLM calls, guardrail violations, budget warnings
const logger = createLoggingPlugin({
  level: "info",
  format: "json",
  include: ["runner_calls", "guardrail_violations", "budget_warnings"],
});

// Metrics — auto-collects: ai.tokens.*, ai.latency.runner, ai.guardrail.violations
const metrics = createMetricsPlugin({
  onMetric: (metric) => myMetricsClient.gauge(metric.name, metric.value, metric.tags),
});

// Inspector — assert on calls and events in tests
const inspector = createInspector();

const orchestrator = createAgentOrchestrator({
  runner: createMockRunner({ responses: [/* ... */] }),
  plugins: [inspector],
});

await orchestrator.run({ input: "test" });

const calls = inspector.getRunnerCalls();
expect(calls).toHaveLength(1);
expect(calls[0].prompt).toContain("test");

const events = inspector.getEvents();
expect(events.some((e) => e.type === "requirement_met")).toBe(true);
```

---

## MCP Integration

```typescript
import { createMCPToolProvider } from "@directive-run/ai/mcp";
import { createMockMCPProvider } from "@directive-run/ai/testing";

// Production: connect to real MCP tool server
const mcpProvider = createMCPToolProvider({
  transport: "stdio",  // "stdio" | "sse" | "http"
  command: "npx",
  args: ["@my-org/mcp-tools"],
});

// Testing: mock the tool provider
const mockMCP = createMockMCPProvider({
  tools: {
    web_search: async (_params) => ({
      results: ["Mocked result 1", "Mocked result 2"],
    }),
  },
});

// Tools available in resolvers via context.tools.getAll()
resolvers: {
  search: {
    requirement: "SEARCH",
    resolve: async (req, context) => {
      const result = await context.runner.run({
        prompt: context.facts.query,
        tools: context.tools.getAll(),
      });
      context.facts.result = result.text;
    },
  },
},
```

---

## RAG Pipeline Integration

```typescript
import { createRAGProvider } from "@directive-run/ai/rag";
import { createMockRAGProvider } from "@directive-run/ai/testing";

// Production: your retrieval logic
const ragProvider = createRAGProvider({
  retrieve: async (query, options) => {
    const chunks = await vectorDB.similaritySearch(query, {
      limit: options.topK ?? 5,
      minScore: options.minScore ?? 0.7,
    });

    return chunks.map((chunk) => ({
      content: chunk.text,
      metadata: chunk.metadata,
      score: chunk.score,
    }));
  },
});

// Testing: mock retrieval results
const mockRAG = createMockRAGProvider({
  results: [
    { content: "Paris is the capital of France.", score: 0.95, metadata: {} },
  ],
});

// Use in resolver
resolvers: {
  answer: {
    requirement: "ANSWER",
    resolve: async (req, context) => {
      const sources = await context.rag.retrieve(context.facts.question, { topK: 3 });
      const contextText = sources.map((s) => s.content).join("\n\n");

      const result = await context.runner.run({
        prompt: `Sources:\n${contextText}\n\nQuestion: ${context.facts.question}`,
      });

      context.facts.answer = result.text;
      context.facts.sourceCount = sources.length;
    },
  },
},
```

---

## Critical Anti-Patterns

## Using real API keys in CI tests

```typescript
// WRONG — slow, expensive, flaky, exposes keys in logs
const orchestrator = createAgentOrchestrator({
  runner: createAnthropicRunner({ apiKey: process.env.ANTHROPIC_API_KEY, model: "claude-opus-4-6" }),
});

// CORRECT — always inject mock runners in tests
const orchestrator = buildOrchestrator(
  createMockRunner({ responses: [{ text: "ok", usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 } }] })
);
```

## Testing implementation instead of behavior

```typescript
// WRONG — brittle, breaks if impl changes
const spy = vi.spyOn(runner, "run");
expect(spy).toHaveBeenCalledOnce();

// CORRECT — test observable facts
expect(result.facts.status).toBe("done");
expect(result.facts.output).toBeTruthy();
```

### Resolver parameter naming
Always use `(req, context)` — never `(req, ctx)` or `(request, context)`.

---

## Reference Files

- `ai-testing-evals.md` — Full testing API, createMockRunner options, evaluation suite patterns
- `ai-debug-observability.md` — Tracing plugins, logging config, metrics collection, inspector API
- `ai-mcp-rag.md` — MCP transport options, tool provider interface, RAG retrieval config
