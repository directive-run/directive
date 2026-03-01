---
title: Troubleshooting
description: Common issues and solutions when building with Directive AI.
---

Solutions to frequent issues when working with agents, orchestrators, and patterns. {% .lead %}

---

## Agent Runner Errors

### `AgentRunner` returns unexpected shape

The runner must return `{ output, totalTokens }`. If your LLM SDK returns a different shape, map it:

```typescript
const runner: AgentRunner = async (agent, input, options) => {
  const res = await openai.chat.completions.create({ /* ... */ });

  return {
    output: res.choices[0]?.message?.content ?? '',
    totalTokens: res.usage?.total_tokens ?? 0,
  };
};
```

### `Cannot read properties of undefined (reading 'output')`

This usually means the runner threw before returning. Wrap your LLM call in try-catch:

```typescript
const runner: AgentRunner = async (agent, input, options) => {
  try {
    const res = await llm.call(input, { signal: options?.signal });

    return { output: res.text, totalTokens: res.tokens };
  } catch (error) {
    throw new Error(`LLM call failed for ${agent.name}: ${error.message}`);
  }
};
```

---

## Guardrail Issues

### Guardrail blocks every request

Check the guardrail logic. Use `isGuardrailError()` to inspect what triggered:

```typescript
import { isGuardrailError } from '@directive-run/ai';

try {
  await orchestrator.run(agent, input);
} catch (error) {
  if (isGuardrailError(error)) {
    console.log('Blocked by:', error.guardrailName);
    console.log('Reason:', error.userMessage);
    console.log('Type:', error.guardrailType);  // 'input' | 'output' | 'toolCall'
  }
}
```

### Async guardrail times out

Named guardrails with `retry` will retry transient failures. If the external service is consistently slow, increase the timeout or add a fail-open fallback:

```typescript
const guard: NamedGuardrail<InputGuardrailData> = {
  name: 'slow-check',
  fn: async (data) => {
    try {
      return await Promise.race([
        externalService.check(data.input),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
      ]);
    } catch {
      return { passed: true };  // Fail open
    }
  },
};
```

---

## Pattern Issues

### `Unknown pattern`

```
[Directive MultiAgent] Unknown pattern "pipeline". Available patterns: research
```

The pattern name in `runPattern()` must match a key in the `patterns` config:

```typescript
const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: { /* ... */ },
  patterns: {
    pipeline: sequential(['researcher', 'writer']),  // Key is "pipeline"
  },
});

await orchestrator.runPattern('pipeline', input);  // Must match
```

### `Unknown agent` inside a pattern

Pattern agent IDs must match keys in the `agents` map. A typo like `'reasearcher'` vs `'researcher'` causes this error.

### Sequential pattern returns wrong output

The sequential pattern passes each agent's output as input to the next. If the final output looks like the first agent's result, check that your runner correctly returns the agent's response in `output`.

---

## Budget & Token Issues

### `Budget exceeded` error

When `maxTokenBudget` is reached, subsequent `runAgent()` calls throw. Solutions:

1. Increase `maxTokenBudget`
2. Use `budgetWarningThreshold` + `onBudgetWarning` to alert before hitting the limit
3. Check `orchestrator.totalTokens` before expensive operations

### Token count is always 0

Your runner must return `totalTokens`. If your LLM SDK doesn't provide usage data, estimate it:

```typescript
return {
  output: response.text,
  totalTokens: response.usage?.total_tokens ?? Math.ceil(response.text.length / 4),
};
```

---

## Streaming Issues

### SSE stream closes immediately

Check that:
1. Your streaming runner returns an async iterable with `onToken` callbacks
2. The `Content-Type` header is `text/event-stream`
3. No middleware is buffering the response (common with compression middleware)

### SSE client receives partial JSON

SSE frames can split across reads. Always buffer incomplete lines:

```typescript
let buffer = '';
// ... in the read loop:
buffer += decoder.decode(value, { stream: true });
const lines = buffer.split('\n');
buffer = lines.pop() ?? '';  // Keep the incomplete trailing line
```

See [SSE Transport &rarr; Client-side parsing](/ai/sse-transport#client-side-parsing) for the complete pattern.

---

## DevTools Issues

### DevTools not showing events

Ensure `debug: true` is set on the orchestrator:

```typescript
const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: { /* ... */ },
  debug: true,  // Required for timeline events
});
```

### Timeline shows no agent events

Agent events are recorded under `timeline.getEventsForAgent(agentId)`. The `agentId` is the key from the `agents` map, not the agent's `name` field.

---

## Memory Issues

### Memory context not applied

Ensure memory is configured on the orchestrator, not just the agent:

```typescript
const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: { chat: { agent: chatAgent } },
  memory: createMemory({
    strategy: 'sliding-window',
    maxMessages: 20,
  }),
});
```

### Memory grows unbounded

Use `manage()` to trim messages and generate summaries:

```typescript
const result = await memory.manage();
console.log(`Trimmed from ${result.messagesBefore} to ${result.messagesAfter} messages`);
```

---

## Checkpoint Issues

### Checkpoint not saving

Check that:
1. `checkpointStore` is configured on the orchestrator or passed in the pattern config
2. `everyN` matches your expected save frequency
3. The `when` predicate (if provided) returns `true` for the current state

### Resume fails with type error

Checkpoint state must match the pattern type. Use the `type` field to route:

```typescript
const state = JSON.parse(checkpoint.systemExport);

switch (state.type) {
  case 'sequential':
    await orchestrator.resumeSequential(state, pattern);
    break;
  // ... other pattern types
}
```

Or use `replay()` which auto-detects the pattern type.

---

## Still Stuck?

- Check the [Debug Timeline](/ai/debug-timeline) for a full event log
- Enable `debug: true` and inspect `orchestrator.timeline`
- Review [Guardrails &rarr; Error Handling](/ai/guardrails#error-handling) for structured error fields
- See the [Testing](/ai/testing) page for test utilities that mock runners without LLM calls
