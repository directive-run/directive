---
title: Evals
description: Evaluate AI agent performance with built-in criteria, LLM-as-judge scoring, and dataset-driven testing.
---

Measure agent quality with a dataset-driven evaluation suite, 10 built-in criteria, and LLM-as-judge scoring. {% .lead %}

Run every agent against every test case, score outputs on multiple dimensions, and assert minimum quality thresholds in CI.

---

## Quick Start

```typescript
import {
  createEvalSuite,
  evalCost,
  evalLatency,
  evalMatch,
  evalAssert,
} from '@directive-run/ai';

const suite = createEvalSuite({
  criteria: {
    cost: evalCost({ maxTokensPerRun: 500 }),
    latency: evalLatency({ maxMs: 5000 }),
    accuracy: evalMatch({
      mode: 'contains',
      caseInsensitive: true,
    }),
  },

  agents: [
    {
      name: 'gpt4',
      instructions: 'Answer questions accurately',
      model: 'gpt-4',
    },
    {
      name: 'claude',
      instructions: 'Answer questions accurately',
      model: 'claude-3',
    },
  ],

  runner,

  dataset: [
    { input: 'What is 2+2?', expected: '4' },
    { input: 'Capital of France?', expected: 'Paris' },
    { input: 'Largest planet?', expected: 'Jupiter' },
  ],

  concurrency: 3,
});

const results = await suite.run();

// Assert minimum quality in CI
evalAssert(results, { minScore: 0.7, minPassRate: 0.8 });
```

---

## Configuration

```typescript
const suite = createEvalSuite({
  criteria,           // Scoring criteria (built-in or custom)
  agents,             // Agents to evaluate
  runner,             // AgentRunner function
  dataset,            // Test cases

  // Optional
  runOptions: {},     // Default run options
  concurrency: 5,     // Max concurrent evaluations
  timeline,           // Debug timeline
  signal,             // AbortSignal for cancellation

  // Callbacks
  onCaseComplete: ({ testCase, agentName, scores }) => {
    console.log(`${agentName} on "${testCase.input}": ${scores}`);
  },
  onAgentComplete: ({ agentName, summary }) => {
    console.log(`${agentName} overall: ${summary.overallScore}`);
  },
});
```

### Dataset

```typescript
interface EvalCase {
  id?: string;                          // Auto-generated if omitted
  input: string;                        // Agent input
  expected?: string;                    // Expected output (for match criteria)
  context?: Record<string, unknown>;    // Extra context for criteria
  tags?: string[];                      // For filtering
  metadata?: Record<string, unknown>;   // Arbitrary metadata
}
```

---

## Built-in Criteria

### `evalCost`

Pass if token usage is under a maximum:

```typescript
evalCost({ maxTokensPerRun: 500 })
```

### `evalLatency`

Pass if run duration is under a maximum:

```typescript
evalLatency({ maxMs: 5000 })
```

### `evalOutputLength`

Pass if output length is within bounds:

```typescript
evalOutputLength({ minLength: 10, maxLength: 1000 })
```

### `evalSafety`

Check for unsafe content patterns:

```typescript
evalSafety({
  blockedPatterns: [/password/i, /ssn/i],
  categories: ['pii', 'violence'],
})
```

Categories: `pii`, `violence`, `self_harm`, `illegal`.

### `evalStructure`

Validate JSON structure:

```typescript
evalStructure({
  type: 'object',
  requiredKeys: ['summary', 'confidence'],
})
```

### `evalMatch`

Match output against expected value:

```typescript
evalMatch({ mode: 'exact' })
evalMatch({ mode: 'contains', caseInsensitive: true })
evalMatch({ mode: 'regex' })
```

### `evalJudge`

LLM-as-judge scoring:

```typescript
evalJudge({
  runner,
  judge: {
    name: 'judge',
    instructions: 'Score outputs 0-1',
    model: 'gpt-4',
  },
  promptTemplate: 'Rate this response: {{output}}\nExpected: {{expected}}',
  signal,
})
```

### `evalFaithfulness`

Is the output faithful to the provided context?

```typescript
evalFaithfulness({ runner, judge, signal })
```

### `evalRelevance`

Is the output relevant to the input?

```typescript
evalRelevance({ runner, judge, signal })
```

### `evalCoherence`

Is the output internally coherent?

```typescript
evalCoherence({ runner, judge, signal })
```

---

## Custom Criteria

Write scoring functions that return a score (0&ndash;1) and pass/fail:

```typescript
const customCriterion = {
  name: 'tone-check',
  fn: async (context) => {
    const { result } = context;
    const output = String(result.output);
    const isPolite = output.includes('please') || output.includes('thank');

    return {
      score: isPolite ? 1.0 : 0.0,
      passed: isPolite,
      reason: isPolite ? 'Polite tone detected' : 'Missing polite language',
    };
  },
  threshold: 0.5,
  weight: 1.0,
};
```

### EvalContext

```typescript
interface EvalContext {
  agent: AgentLike;
  testCase: EvalCase;
  result: RunResult<unknown>;
  runDurationMs: number;
}
```

### EvalScore

```typescript
interface EvalScore {
  score: number;     // 0–1
  passed: boolean;
  reason?: string;
  durationMs?: number;
}
```

---

## Running Evaluations

```typescript
// Run all agents against all cases
const results = await suite.run();

// Run a single agent
const agentSummary = await suite.runAgent('gpt4');

// Introspection
suite.getAgents();    // Agent list
suite.getCriteria();  // Criteria definitions
suite.getDataset();   // Test cases
```

---

## Results

### EvalResults

```typescript
interface EvalResults {
  summary: Record<string, EvalAgentSummary>;  // Per-agent summaries
  details: EvalCaseResult[];                   // Per-case results
  durationMs: number;
  totalTokens: number;
  startedAt: number;
  completedAt: number;
}
```

### EvalAgentSummary

```typescript
interface EvalAgentSummary {
  agentName: string;
  criterionAverages: Record<string, number>;   // Average score per criterion
  criterionPassRates: Record<string, number>;  // Pass rate per criterion
  overallScore: number;                         // Weighted average across criteria
  passRate: number;                             // Fraction of cases that passed all criteria
  totalTokens: number;
  avgLatencyMs: number;
  totalCases: number;
  passedCases: number;
}
```

### EvalCaseResult

```typescript
interface EvalCaseResult {
  testCase: EvalCase;
  agentName: string;
  runResult: RunResult<unknown>;
  scores: Record<string, EvalScore>;
  overallScore: number;
  allPassed: boolean;
  runDurationMs: number;
}
```

---

## Assertions

Use `evalAssert` in CI to fail builds when quality drops:

```typescript
import { evalAssert } from '@directive-run/ai';

const results = await suite.run();

evalAssert(results, {
  minScore: 0.7,      // Minimum overall score across all agents
  minPassRate: 0.8,    // Minimum pass rate across all agents
  failOn: ['gpt4'],    // Only assert on specific agents
});
```

Throws with a detailed error message if assertions fail.

---

## Evaluating Orchestrator-Wrapped Agents

Run evals through an orchestrator to test guardrails, budget limits, and constraints alongside agent quality:

```typescript
import { createAgentOrchestrator } from '@directive-run/ai';

const orchestrator = createAgentOrchestrator({
  runner,
  guardrails: { input: [piiGuardrail] },
});

const suite = createEvalSuite({
  criteria: { safe: evalSafety() },
  agents: [researcher],
  runner: (agent, input, opts) => orchestrator.run(agent, input, { signal: opts?.signal }),
  dataset,
});
```

---

## Next Steps

- [Testing](/ai/testing) &ndash; Mock runners and test utilities
- [OpenTelemetry](/ai/otel) &ndash; Production observability
- [Debug Timeline](/ai/debug-timeline) &ndash; Event recording
