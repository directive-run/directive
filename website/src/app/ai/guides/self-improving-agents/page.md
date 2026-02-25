---
title: Self-Improving Agents
description: Build agents that iteratively improve their output using automated evaluation with the reflect pattern.
---

Build agents that iteratively improve their output using automated evaluation. {% .lead %}

---

## The Problem

Agent output quality is inconsistent. Sometimes the draft is great, sometimes it's mediocre. You need automated quality review with iterative improvement — not just one shot, but a feedback loop where the agent revises until the output meets your standards.

## The Solution

Use the `reflect()` pattern to pair a producer agent with an evaluator agent. The evaluator judges output and provides feedback for improvement:

```typescript
import { reflect } from '@directive-run/ai';

const editorialReview = reflect('writer', 'reviewer', {
  maxIterations: 3,
  onExhausted: 'accept-best',
  threshold: 0.8,
  onIteration: (record) => {
    console.log(`Iteration ${record.iteration}: score=${record.evaluation.score}`);
  },
});

// Run with: orchestrator.runPattern('editorialReview', input) — see Full Example below
```

## How It Works

```
                      iteration N/3
                    ┌───────────────┐
                    ▼               │
              ┌──────────┐   ┌─────┴─────┐
              │ Producer │──►│ Evaluator  │
              └──────────┘   └─────┬─────┘
                                   │ pass
                                   ▼
                              ┌──────────┐
                              │  Accept  │
                              └──────────┘
```

- **`reflect(agent, evaluator, options)`** creates a pattern where the `agent` produces output and the `evaluator` judges it.
- **The evaluator returns a `ReflectionEvaluation`** with `passed` (boolean), optional `feedback` (string), and optional `score` (number 0-1).
- **If the evaluator rejects**, the agent runs again with the feedback incorporated. This repeats up to `maxIterations`.
- **`threshold`** sets the minimum score to pass. If the evaluator gives a score above the threshold, the output is accepted.
- **`onExhausted`** controls what happens when max iterations are reached:
  - `"accept-last"` — return the final iteration's output
  - `"accept-best"` — return the iteration with the highest score
  - `"throw"` — throw an error

## Full Example

A blog post writer with an editorial reviewer that provides structured feedback:

```typescript
import { createMultiAgentOrchestrator, reflect } from '@directive-run/ai';

const orchestrator = createMultiAgentOrchestrator({
  runner, // See Running Agents (/ai/running-agents) for setup
  agents: {
    writer: {
      agent: { name: 'writer', instructions: `Write engaging blog posts. When given feedback, revise your draft to address each point.` },
    },
    reviewer: {
      agent: {
        name: 'reviewer',
        instructions: `Review blog posts. Return a JSON evaluation:
{
  "passed": true/false,
  "score": 0.0-1.0,
  "feedback": "specific suggestions for improvement"
}

Score criteria:
- 0.9+: Publish-ready
- 0.7-0.9: Good but needs minor fixes
- Below 0.7: Needs significant revision`,
      },
    },
  },
  patterns: {
    editorialReview: reflect('writer', 'reviewer', {
      maxIterations: 3,
      threshold: 0.85,
      onExhausted: 'accept-best',
      parseEvaluation: (output) => {
        const text = typeof output === 'string' ? output : String(output);
        try {
          const json = JSON.parse(text);

          return {
            passed: json.passed ?? false,
            score: json.score ?? 0,
            feedback: json.feedback ?? 'No feedback provided',
          };
        } catch {
          return {
            passed: false,
            score: 0,
            feedback: `Could not parse evaluation: ${text.slice(0, 200)}`,
          };
        }
      },
      buildRetryInput: (input, feedback, iteration) => {
        return [
          `REVISION ${iteration}`,
          `Original request: ${input}`,
          `Reviewer feedback: ${feedback}`,
          `Please revise your draft to address the feedback above.`,
        ].join('\n\n');
      },
      onIteration: (record) => {
        console.log(
          `Iteration ${record.iteration}: ` +
          `score=${record.evaluation.score}, ` +
          `passed=${record.evaluation.passed}`
        );
        if (record.evaluation.feedback) {
          console.log(`Feedback: ${record.evaluation.feedback}`);
        }
      },
    }),
  },
});

// Run the reflect pattern
const result = await orchestrator.runPattern(
  'editorialReview',
  'Write a 500-word post about the benefits of TypeScript in large codebases'
);

console.log(`Final output after ${result.iterations} iterations:`);
console.log(`Best score: ${result.bestScore}`);
console.log(result.output);
```

## Related

- [Execution Patterns](/ai/patterns) — reflect, DAG, and other patterns reference
- [Multi-Agent Orchestrator](/ai/multi-agent) — orchestrator configuration
- [DAG Pipeline guide](/ai/guides/dag-pipeline) — parallel and conditional workflows
- [Validate Structured Output guide](/ai/guides/validate-structured-output) — enforce JSON schemas on output
