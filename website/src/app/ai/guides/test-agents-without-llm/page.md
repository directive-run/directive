---
title: Test Without LLM Calls
description: Test AI agents deterministically without hitting real LLMs using mock runners and test orchestrators.
---

Test agents deterministically without hitting real LLMs. {% .lead %}

---

## The Problem

Your agent tests are slow (each call takes 1-3 seconds), expensive (every test run costs money), and non-deterministic (the same input returns different outputs). CI pipelines become unreliable and expensive.

## The Solution

Use `createMockAgentRunner` for deterministic responses and `createTestOrchestrator` for full orchestrator testing:

```typescript
import { createMockAgentRunner } from '@directive-run/ai';

// Mock runner with canned responses
const mock = createMockAgentRunner({
  defaultResponse: {
    output: 'Default mock response',
  },
  responses: {
    researcher: {
      output: 'Key findings: AI adoption is growing 40% year-over-year.',
    },
    writer: {
      output: 'Draft: The Rise of AI in Enterprise...',
    },
  },
  recordCalls: true,
});

// Use mock.run as your runner
const result = await mock.run(
  { name: 'researcher', instructions: '...' },
  'Research AI trends'
);
// result.output === 'Key findings: AI adoption is growing 40% year-over-year.'

// Inspect what was called
const calls = mock.getCalls();
const researchCalls = mock.getCallsFor('researcher');
```

## How It Works

- **`createMockAgentRunner`** returns a mock with a `run` method matching the `AgentRunner` signature. Drop it into any orchestrator.
- **`responses`** maps agent names to canned outputs. Unmatched agents get `defaultResponse`.
- **`recordCalls: true`** logs every call for assertions. Use `getCalls()` for all calls, `getCallsFor(name)` for a specific agent.
- **`setResponse(name, config)`** lets you change responses between test cases without recreating the mock.
- **`createTestOrchestrator`** wraps a full orchestrator with a mock runner, giving you both orchestrator features and mock control.

## Full Example

Testing a multi-step pipeline with assertions on each stage:

```typescript
import { describe, it, expect } from 'vitest';
import {
  createMockAgentRunner,
  createTestOrchestrator,
} from '@directive-run/ai';

describe('content pipeline', () => {
  it('runs research -> write -> review in sequence', async () => {
    const mock = createMockAgentRunner({
      responses: {
        researcher: {
          output: 'Finding: TypeScript adoption is at 78% in enterprise.',
        },
        writer: {
          output: '# TypeScript in the Enterprise\n\nTypeScript has reached...',
        },
        reviewer: {
          output: 'APPROVED: Article is accurate and well-structured.',
        },
      },
      recordCalls: true,
    });

    const orchestrator = createTestOrchestrator({
      runner: mock.run,
      agents: {
        researcher: { name: 'researcher', instructions: 'Research topics.' },
        writer: { name: 'writer', instructions: 'Write articles.' },
        reviewer: { name: 'reviewer', instructions: 'Review content.' },
      },
    });

    // Run the pipeline
    const research = await orchestrator.runAgent('researcher', 'TypeScript trends');
    expect(research.output).toContain('TypeScript adoption');

    const draft = await orchestrator.runAgent('writer', research.output);
    expect(draft.output).toContain('TypeScript in the Enterprise');

    const review = await orchestrator.runAgent('reviewer', draft.output);
    expect(review.output).toContain('APPROVED');

    // Verify call order and count
    const calls = mock.getCalls();
    expect(calls).toHaveLength(3);
    expect(calls[0].agentName).toBe('researcher');
    expect(calls[1].agentName).toBe('writer');
    expect(calls[2].agentName).toBe('reviewer');
  });

  it('handles agent failure gracefully', async () => {
    const mock = createMockAgentRunner({
      responses: {
        researcher: {
          error: new Error('Rate limit exceeded'),
        },
      },
    });

    // First call throws the configured error
    await expect(
      mock.run({ name: 'researcher', instructions: '...' }, 'Any topic')
    ).rejects.toThrow('Rate limit exceeded');

    // Change response mid-test to simulate recovery
    mock.setResponse('researcher', {
      output: 'Fallback research results.',
    });

    // Second call succeeds with the updated response
    const result = await mock.run(
      { name: 'researcher', instructions: '...' },
      'Any topic'
    );
    expect(result.output).toBe('Fallback research results.');
  });
});
```

## Related

- [Testing reference](/ai/testing) — full testing utilities API
- [Multi-Step Pipeline guide](/ai/guides/multi-step-pipeline) — the pipeline being tested above
- [Evals reference](/ai/evals) — automated evaluation of agent quality
