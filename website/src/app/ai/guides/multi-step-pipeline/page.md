---
title: Multi-Step Pipeline
description: Build sequential agent pipelines where multiple agents work in series with handoffs.
---

Build pipelines where multiple agents work in sequence – research, write, review. {% .lead %}

---

## The Problem

You need a content pipeline: a researcher gathers information, a writer drafts the article, and a reviewer checks quality. Each step depends on the previous one's output. Running them all as one prompt loses control over quality and cost at each stage.

## The Solution

Use `createMultiAgentOrchestrator` with `runAgent()` for explicit sequencing or `handoff()` for agent-to-agent delegation:

```typescript
import { createMultiAgentOrchestrator } from '@directive-run/ai';

const orchestrator = createMultiAgentOrchestrator({
  runner, // See Running Agents (/ai/running-agents) for setup
  agents: {
    researcher: {
      agent: { name: 'researcher', instructions: 'Research the given topic thoroughly. Return key findings as bullet points.' },
    },
    writer: {
      agent: { name: 'writer', instructions: 'Write a blog post based on the research provided.' },
    },
    reviewer: {
      agent: { name: 'reviewer', instructions: 'Review the draft for accuracy, clarity, and tone. Return feedback.' },
    },
  },
});

// Sequential execution
const research = await orchestrator.runAgent('researcher', 'AI in healthcare');
const draft = await orchestrator.runAgent('writer', `Write based on: ${research.output}`);
const review = await orchestrator.runAgent('reviewer', `Review: ${draft.output}`);
```

{% callout title="Security Note" %}
Agent output is interpolated directly into downstream prompts. In adversarial environments, consider sanitizing inter-agent messages or using structured data handoffs to reduce prompt injection risk. See [Prompt Injection](/ai/security/prompt-injection) for details.
{% /callout %}

## How It Works

- **`agents` registry** defines each agent's name and instructions. Agents share the same runner but have independent system prompts.
- **`runAgent(name, input)`** runs a specific agent and returns its result. You control the sequence in your code.
- **`handoff()`** lets one agent delegate to another mid-conversation. The receiving agent gets the conversation context.
- **Per-agent guardrails** can be applied to enforce different rules at each stage.

## Full Example

A content pipeline with per-agent guardrails and error handling:

```typescript
import {
  createMultiAgentOrchestrator,
  createLengthGuardrail,
} from '@directive-run/ai';

const orchestrator = createMultiAgentOrchestrator({
  runner, // See Running Agents (/ai/running-agents) for setup
  agents: {
    researcher: {
      agent: { name: 'researcher', instructions: 'Research the topic. Return structured findings with sources.' },
      guardrails: {
        output: [
          createLengthGuardrail({ maxTokens: 2000 }),
        ],
      },
    },
    writer: {
      agent: { name: 'writer', instructions: 'Write a 500-word blog post based on the research.' },
      guardrails: {
        output: [
          createLengthGuardrail({ maxTokens: 1500 }),
        ],
      },
    },
    editor: {
      agent: { name: 'editor', instructions: 'Edit for clarity, grammar, and tone. Return the final version.' },
    },
  },
  guardrails: {
    input: [
      // Global input guardrails apply to all agents
    ],
  },
  maxTokenBudget: 50000,
});

async function runContentPipeline(topic: string) {
  // Step 1: Research
  const research = await orchestrator.runAgent('researcher', topic);

  // Step 2: Write
  const draft = await orchestrator.runAgent(
    'writer',
    `Topic: ${topic}\n\nResearch:\n${research.output}`
  );

  // Step 3: Edit
  const final = await orchestrator.runAgent(
    'editor',
    `Please edit this draft:\n\n${draft.output}`
  );

  return {
    research: research.output,
    draft: draft.output,
    final: final.output,
  };
}

const result = await runContentPipeline('The future of quantum computing');
```

## Related

- [Multi-Agent Orchestrator](/ai/multi-agent) – full multi-agent reference
- [Execution Patterns](/ai/patterns) – DAG, reflect, and other execution patterns
- [DAG Pipeline guide](/ai/guides/dag-pipeline) – parallel and conditional agent workflows
