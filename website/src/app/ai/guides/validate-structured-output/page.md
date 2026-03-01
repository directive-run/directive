---
title: Validate Structured Output
description: Ensure AI agents return valid JSON matching your schema with automatic retries on parse failure.
---

Ensure agents return valid JSON matching your schema, with automatic retries on parse failure. {% .lead %}

---

## The Problem

You ask an agent to return a JSON object with specific fields. Instead, it wraps the JSON in markdown code fences, omits required fields, or returns free-text. Your downstream code crashes on `JSON.parse()`.

## The Solution

Use `withStructuredOutput` to enforce a schema. It extracts JSON from the output, validates it, and auto-retries on failure:

```typescript
import { withStructuredOutput } from '@directive-run/ai';
import { z } from 'zod';

const schema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
});

const structuredRunner = withStructuredOutput(runner, { // See Running Agents (/ai/running-agents) for setup
  schema,
  maxRetries: 2,
});

const result = await structuredRunner(agent, 'Analyze: "I love this product!"');
// result.output is guaranteed to match the schema
// { sentiment: 'positive', confidence: 0.95, summary: '...' }
```

## How It Works

- **`schema`** accepts any object with a `safeParse(value)` method — Zod schemas work out of the box.
- **The middleware extracts JSON** from the agent's output, handling markdown code fences and leading text automatically.
- **If parsing fails**, the middleware retries the agent call with an error message asking it to fix the output. Up to `maxRetries` attempts (default: 2).
- **After all retries fail**, a `StructuredOutputError` is thrown with the last raw output and validation errors.
- **`extractJson`** can be customized if your output format is non-standard.

## Full Example

A product review analyzer that returns structured data:

```typescript
import {
  createAgentOrchestrator,
  withStructuredOutput,
} from '@directive-run/ai';
import { z } from 'zod';

const reviewSchema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral', 'mixed']),
  confidence: z.number().min(0).max(1),
  topics: z.array(z.string()).min(1),
  actionItems: z.array(z.object({
    priority: z.enum(['high', 'medium', 'low']),
    description: z.string(),
  })),
});

const structuredRunner = withStructuredOutput(runner, { // See Running Agents (/ai/running-agents) for setup
  schema: reviewSchema,
  maxRetries: 3,
  schemaDescription: 'Product review analysis with sentiment, topics, and action items',
});

const orchestrator = createAgentOrchestrator({
  runner: structuredRunner,
  autoApproveToolCalls: true,
});

const agent = { name: 'analyzer', instructions: 'Analyze product reviews.' };

try {
  const result = await orchestrator.run(
    agent,
    'Analyze this review: "Great camera quality but the battery dies too fast. Would not recommend for travel."'
  );
  const analysis = result.output;
  // { sentiment: 'mixed', confidence: 0.85, topics: ['camera', 'battery'], actionItems: [...] }
} catch (error) {
  if (error.name === 'StructuredOutputError') {
    console.error('Agent could not produce valid output after retries');
    console.error('Last result:', error.lastResult);  // RunResult<unknown> | undefined
  }
}
```

## Related

- [Resilience & Routing](/ai/resilience-routing) — `withStructuredOutput` and other middleware
- [Handle Agent Errors guide](/ai/guides/handle-agent-errors) — catching `StructuredOutputError` and other error types
