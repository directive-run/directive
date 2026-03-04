---
title: DAG Pipeline
description: Build parallel and conditional agent workflows with directed acyclic graph execution patterns.
---

Build workflows where agents run in parallel, depend on upstream results, and branch conditionally. {% .lead %}

---

## The Problem

Your pipeline isn't linear. A researcher and a fact-checker can run in parallel. A writer depends on both of their outputs. If the fact-checker fails, you want to skip the writer but still get the research. Sequential pipelines waste time; manual Promise orchestration is brittle.

## The Solution

Use the `dag()` pattern to define nodes with dependencies, conditional edges, and error strategies:

```typescript
import { dag } from '@directive-run/ai';

const contentPipeline = dag(
  {
    researcher: {
      handler: 'researcher',
    },
    factChecker: {
      handler: 'fact-checker',
    },
    writer: {
      handler: 'writer',
      deps: ['researcher', 'factChecker'],
      transform: (context) => {
        const research = context.outputs.researcher;
        const facts = context.outputs.factChecker;

        return `Research:\n${research}\n\nVerified facts:\n${facts}`;
      },
    },
    editor: {
      handler: 'editor',
      deps: ['writer'],
    },
  },
  // Merge function: combine all outputs into a final result
  (context) => ({
    research: context.outputs.researcher,
    facts: context.outputs.factChecker,
    draft: context.outputs.writer,
    final: context.outputs.editor,
  }),
  {
    onNodeError: 'skip-downstream',
    maxConcurrent: 3,
  },
);

// Run with: orchestrator.runPattern('contentPipeline', input) – see Full Example below
```

## How It Works

```
    ┌────────────┐   ┌──────────────┐
    │ researcher │   │ factChecker  │
    └──────┬─────┘   └──────┬───────┘
           └────────┬───────┘
                    ▼
             ┌────────────┐
             │   writer   │
             └──────┬─────┘
                    ▼
             ┌────────────┐
             │   editor   │
             └──────┬─────┘
                    ╎ conditional
                    ▼
             ┌────────────┐
             │    seo     │
             └────────────┘
```

- **Nodes** define agents and their dependencies. Nodes with no `deps` run immediately. Nodes with `deps` wait for all dependencies to complete.
- **`transform`** shapes the input for a node based on upstream outputs. The `context` object has `outputs`, `statuses`, `errors`, and the original `input`.
- **`deps`** creates edges in the DAG. `writer` waits for both `researcher` and `factChecker`.
- **`onNodeError`** controls failure behavior:
  - `"fail"` – abort the entire DAG on any node failure
  - `"skip-downstream"` – skip nodes that depend on the failed node, but run everything else
  - `"continue"` – run everything, passing `undefined` for failed upstream outputs
- **`maxConcurrent`** limits how many nodes run simultaneously.
- **`when`** adds conditional edges – a node only runs if the condition is true.

## Full Example

A content pipeline with conditional review and timeout handling:

```typescript
import { createMultiAgentOrchestrator, dag } from '@directive-run/ai';

const orchestrator = createMultiAgentOrchestrator({
  runner, // See Running Agents (/ai/running-agents) for setup
  agents: {
    researcher: {
      agent: { name: 'researcher', instructions: 'Research the topic. Return structured findings.' },
    },
    'fact-checker': {
      agent: { name: 'fact-checker', instructions: 'Verify claims. Return confirmed and unconfirmed facts.' },
    },
    writer: {
      agent: { name: 'writer', instructions: 'Write a blog post from research and verified facts.' },
    },
    editor: {
      agent: { name: 'editor', instructions: 'Edit for clarity and grammar. Return final version.' },
    },
    'seo-optimizer': {
      agent: { name: 'seo-optimizer', instructions: 'Optimize the final post for SEO. Add meta description and keywords.' },
    },
  },
  patterns: {
    contentPipeline: dag(
      {
        researcher: {
          handler: 'researcher',
          timeout: 30000,
        },
        factChecker: {
          handler: 'fact-checker',
          timeout: 20000,
        },
        writer: {
          handler: 'writer',
          deps: ['researcher', 'factChecker'],
          transform: (context) => {
            const research = context.outputs.researcher;
            const facts = context.outputs.factChecker;

            return `Research:\n${research}\n\nFacts:\n${facts}`;
          },
        },
        editor: {
          handler: 'editor',
          deps: ['writer'],
        },
        seo: {
          handler: 'seo-optimizer',
          deps: ['editor'],
          // Only run SEO if the input requested it
          when: (context) => context.input.includes('[SEO]'),
        },
      },
      (context) => ({
        research: context.outputs.researcher,
        facts: context.outputs.factChecker,
        draft: context.outputs.writer,
        final: context.outputs.editor ?? context.outputs.writer,
        seo: context.outputs.seo,
        statuses: context.statuses,
      }),
      {
        onNodeError: 'skip-downstream',
        maxConcurrent: 2,
        timeout: 120000,
      },
    ),
  },
});

// Run the pipeline
const result = await orchestrator.runPattern(
  'contentPipeline',
  '[SEO] Write about quantum computing breakthroughs in 2025'
);

console.log('Statuses:', result.statuses);
// { researcher: 'completed', factChecker: 'completed', writer: 'completed', editor: 'completed', seo: 'completed' }

// If fact-checker failed with skip-downstream:
// { researcher: 'completed', factChecker: 'failed', writer: 'skipped', editor: 'skipped', seo: 'skipped' }
```

## Adding Tasks to Your DAG

Tasks (imperative code) work as DAG nodes alongside agents. Register them in the `tasks` config:

```typescript
const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    fetcher: { agent: fetcherAgent },
    writer: { agent: writerAgent },
  },
  tasks: {
    transform: {
      run: async (input, signal, context) => {
        context.reportProgress(50, 'Transforming');
        const data = JSON.parse(input);
        return JSON.stringify({ ...data, transformed: true });
      },
      label: 'Transform',
    },
  },
  patterns: {
    pipeline: dag({
      fetch: { handler: 'fetcher' },
      process: { handler: 'transform', deps: ['fetch'] },
      write: { handler: 'writer', deps: ['process'] },
    }),
  },
});
```

Task nodes appear as hexagons in Mermaid diagrams and violet dashed-border nodes in DevTools, making them visually distinct from agent nodes.

## Related

- [Execution Patterns](/ai/patterns) – DAG, reflect, and other patterns reference
- [Multi-Agent Orchestrator](/ai/multi-agent) – orchestrator configuration
- [Multi-Step Pipeline guide](/ai/guides/multi-step-pipeline) – simpler sequential pipelines
