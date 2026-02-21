---
title: Goal Engine
description: Desired-state convergence engine that automatically coordinates agents based on dependency graphs and goal conditions.
---

Declare what you want to be true, and the goal engine figures out which agents to run and in what order. {% .lead %}

The goal engine infers a dependency graph from agent declarations (`produces` / `requires`), then runs agents in topological order until a goal condition is met.

---

## Quick Start

The goal engine needs an `AgentRunner` &ndash; a function that takes an agent definition, an input string, and options, and returns a result with `output` and `totalTokens`. See [Running Agents](/docs/ai/running-agents) for how to create one.

```typescript
import { createGoalEngine } from '@directive-run/ai';
import type { GoalAgentDeclaration, GoalDefinition } from '@directive-run/ai';

// runner: (agent, input, options?) => Promise<RunResult>
// See "Running Agents" for setup with OpenAI, Anthropic, or Ollama.

const agents: Record<string, GoalAgentDeclaration> = {
  fetcher: {
    agent: {
      name: 'fetcher',
      instructions: 'Fetch raw data from the API',
    },
    produces: ['rawData'],
    requires: [],
    extractOutput: (result) => ({ rawData: result.output }),
  },
  analyzer: {
    agent: {
      name: 'analyzer',
      instructions: 'Analyze the raw data',
    },
    produces: ['analysis'],
    requires: ['rawData'],
    buildInput: (facts) => `Analyze this data: ${facts.rawData}`,
    extractOutput: (result) => ({ analysis: result.output }),
  },
  reporter: {
    agent: {
      name: 'reporter',
      instructions: 'Write a report from the analysis',
    },
    produces: ['report'],
    requires: ['analysis'],
    buildInput: (facts) => `Write a report based on: ${facts.analysis}`,
    extractOutput: (result) => ({ report: result.output }),
  },
};

const goals: Record<string, GoalDefinition> = {
  generateReport: {
    when: (facts) => facts.report !== undefined,
    description: 'Generate a complete analysis report',
  },
};

const engine = createGoalEngine({
  agents,
  goals,
  runner,
});

const result = await engine.converge('generateReport', {});
console.log(result.converged);       // true
console.log(result.facts.report);    // The generated report
console.log(result.executionOrder);  // ['fetcher', 'analyzer', 'reporter']
console.log(result.totalTokens);     // Total tokens used
console.log(result.durationMs);      // Total time
```

{% callout title="Construction-time validation" type="warning" %}
`createGoalEngine()` validates the configuration immediately and throws if there are errors (cycles, duplicate producers, etc.). Use a try/catch around construction, or call `engine.validate()` separately for non-throwing validation.
{% /callout %}

---

## The Terraform Analogy

If you've used Terraform, the goal engine will feel familiar:

| Terraform | Directive Goal Engine |
|-----------|----------------------|
| `.tf` resource declarations | `GoalAgentDeclaration` with `produces` / `requires` |
| `terraform plan` | `engine.plan(goalId, existingFacts)` |
| `terraform apply` | `engine.converge(goalId, initialFacts)` |
| `terraform validate` | `engine.validate()` |
| Dependency graph (resources) | Dependency graph (agents via fact keys) |
| Desired state (infrastructure) | Desired state (goal condition `when: (facts) => ...`) |
| Provider plugins | `AgentRunner` function |

**In Terraform** you declare "I want a VPC, a subnet inside it, and an EC2 instance in that subnet." Terraform builds a dependency graph and creates resources in the right order.

**In Directive** you declare "Agent A produces `rawData`, Agent B requires `rawData` and produces `analysis`, Agent C requires `analysis` and produces `report`." The goal engine builds a dependency graph and runs agents in the right order until the goal condition is met.

### Plan/Converge Lifecycle

```
┌──────────────────────────────────────────────┐
│  1. DECLARE                                   │
│     Agents: produces/requires                 │
│     Goals: when(facts) => boolean             │
├──────────────────────────────────────────────┤
│  2. VALIDATE                                  │
│     engine.validate()                         │
│     → cycle detection, missing deps, warnings │
├──────────────────────────────────────────────┤
│  3. PLAN (optional dry-run)                   │
│     engine.plan(goalId, knownFacts)           │
│     → steps, feasibility, external deps       │
├──────────────────────────────────────────────┤
│  4. CONVERGE                                  │
│     engine.converge(goalId, initialFacts)     │
│                                               │
│     ┌─── Step Loop ──────────────────────┐    │
│     │  a. Find ready agents (deps met)   │    │
│     │  b. Run them (topological order)   │    │
│     │  c. Extract output facts           │    │
│     │  d. Check goal condition           │    │
│     │  e. If met → return success        │    │
│     │  f. If not → next step             │    │
│     └────────────────────────────────────┘    │
│                                               │
│     Safety limits: maxSteps, timeoutMs        │
├──────────────────────────────────────────────┤
│  5. RESULT                                    │
│     converged, facts, executionOrder,         │
│     totalTokens, durationMs, agentResults     │
└──────────────────────────────────────────────┘
```

The key insight: you never tell the engine **how** to reach the goal. You declare what each agent can do and what the end-state looks like. The engine figures out the rest.

---

## Agent Declarations

Each agent declares what facts it produces and requires:

```typescript
interface GoalAgentDeclaration {
  agent: AgentLike;
  produces: string[];      // Fact keys this agent writes
  requires: string[];      // Fact keys this agent needs

  // Build input from current facts (default: JSON.stringify of required facts)
  buildInput?: (facts: Record<string, unknown>) => string;

  // Extract output facts from agent result
  extractOutput?: (result: RunResult<unknown>, facts: Record<string, unknown>) =>
    Record<string, unknown>;

  timeout?: number;        // Per-agent timeout (ms)
  maxRetries?: number;     // Retry count on failure (default: 0)
  allowRerun?: boolean;    // Allow re-running if dependencies change (default: false)
  description?: string;    // Human-readable description
}
```

The engine infers the execution order from `produces` and `requires`. If agent A produces `rawData` and agent B requires `rawData`, B runs after A.

### Default Behaviors

**`buildInput`** &ndash; If omitted, the engine passes `JSON.stringify` of the required facts as the agent input (e.g. `{"rawData": "..."}` for an agent that requires `rawData`).

**`extractOutput`** &ndash; If omitted, the engine attempts to parse the agent output as JSON and extracts keys matching the agent's `produces` list. If JSON parsing fails and the agent produces exactly one fact, the raw output string is used as the value.

**`allowRerun`** &ndash; By default, agents run once and are marked completed. Set `allowRerun: true` to let an agent re-execute when its input facts change (determined by `JSON.stringify` comparison of required fact values). This is useful for iterative refinement, where a later agent's output feeds back into an earlier agent.

**`maxRetries`** &ndash; On failure, the engine retries the agent with exponential backoff (1s, 2s, 4s... capped at 10s). After exhausting retries, the agent is marked as failed for that step.

---

## Goal Definitions

```typescript
interface GoalDefinition {
  when: (facts: Record<string, unknown>) => boolean;  // Terminal condition
  description?: string;
  maxSteps?: number;     // Safety limit (default: 50)
  timeoutMs?: number;    // Overall timeout (default: 300000 – 5 minutes)
}
```

The engine loops until `when` returns `true` or the safety limits are hit. When `maxSteps` or `timeoutMs` is exceeded, the result has `converged: false` with an `error` string explaining why.

---

## Dependency Graph

The engine builds a dependency graph from agent declarations:

```typescript
import { buildDependencyGraph } from '@directive-run/ai';

const graph = buildDependencyGraph(agents);

console.log(graph.order);      // Topological sort: ['fetcher', 'analyzer', 'reporter']
console.log(graph.roots);      // Agents with no dependencies: ['fetcher']
console.log(graph.leaves);     // Agents nothing depends on: ['reporter']
console.log(graph.edges);      // Dependency edges
console.log(graph.producers);  // Map<factKey, agentId>
```

You can also call `engine.getDependencyGraph()` on an engine instance to get the same result.

### DependencyGraph

```typescript
interface DependencyGraph {
  order: string[];                    // Topological order
  edges: DependencyEdge[];            // Dependency edges
  roots: string[];                    // No incoming edges
  leaves: string[];                   // No outgoing edges
  producers: Map<string, string>;     // factKey → agentId
}

interface DependencyEdge {
  from: string;     // Producer agent ID
  to: string;       // Consumer agent ID
  factKey: string;  // The fact key linking them
}
```

Cycle detection is built in. If agents form a circular dependency, `buildDependencyGraph` throws with a descriptive error.

---

## Convergence

```typescript
const result = await engine.converge('generateReport', initialFacts, signal?);
```

### ConvergenceResult

```typescript
interface ConvergenceResult {
  converged: boolean;                                // Did the goal condition pass?
  facts: Record<string, unknown>;                    // Final fact state
  executionOrder: string[];                          // Agents run, in order
  totalTokens: number;                               // Total tokens consumed
  durationMs: number;                                // Total wall-clock time
  steps: number;                                     // Convergence iterations
  agentResults: Record<string, RunResult<unknown>>;  // Per-agent results
  error?: string;                                    // Error if convergence failed
}
```

Pass an `AbortSignal` as the third argument for external cancellation.

---

## Validation

Check for configuration errors before running:

```typescript
const validation = engine.validate();

if (!validation.valid) {
  console.error('Errors:', validation.errors);
  // e.g. "Agent 'analyzer' requires 'rawData' but no agent produces it"
}

console.log('Warnings:', validation.warnings);
// e.g. "Agent 'fetcher' has no agents depending on it"
```

### GoalValidationResult

```typescript
interface GoalValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
```

---

## Execution Planning

Dry-run the engine to see what would happen without actually running agents. The second argument is an array of **fact keys** you already have (not the facts themselves):

```typescript
const plan = engine.plan('generateReport', ['rawData']);

console.log(plan.feasible);           // Can the goal be reached?
console.log(plan.steps);              // Planned execution steps
console.log(plan.unreachableAgents);  // Agents that can't run
console.log(plan.externalDeps);       // Facts needed but not produced by any agent
```

### ExecutionPlan

```typescript
interface ExecutionPlan {
  steps: PlanStep[];
  unreachableAgents: string[];
  externalDeps: string[];
  feasible: boolean;
}

interface PlanStep {
  step: number;              // Step number (1-based)
  agents: string[];          // Agent IDs that would run in parallel
  availableFacts: string[];  // Fact keys available at step start
  producedFacts: string[];   // Fact keys produced after step completes
}
```

Note that `steps[n].agents` may contain multiple agents &ndash; all agents within a step run in parallel (via `Promise.allSettled`).

---

## Convergence Behavior

### Parallel Execution

Within each convergence step, all agents whose `requires` are satisfied run in parallel using `Promise.allSettled`. This means agents at the same topological level execute concurrently:

```
Step 1: fetcher (no deps)         ← runs alone
Step 2: analyzer + summarizer     ← run in parallel (both require rawData)
Step 3: reporter (requires both)  ← runs alone
```

### Failure Handling

When an agent fails (after exhausting `maxRetries`), it does not crash the entire convergence. Instead:

1. The engine records the failure and continues processing other agents in the step
2. The failed agent's `produces` facts remain unset
3. On the next step, the engine re-evaluates which agents are ready
4. After **3 consecutive failures**, the agent is permanently excluded from the run to prevent retry storms

If no agents are ready and the goal is not met, convergence fails with an `error` describing which facts are missing and why.

### Fact Safety

All fact mutations are guarded against prototype pollution. Keys like `__proto__`, `constructor`, `prototype`, `toString`, `valueOf`, and `hasOwnProperty` are silently rejected.

---

## Configuration

```typescript
const engine = createGoalEngine({
  agents,                    // Agent declarations
  goals,                     // Goal definitions
  runner,                    // AgentRunner function
  runOptions: {},            // Default run options (e.g. onMessage, onToken)
  timeline: myTimeline,      // Optional debug timeline

  // Lifecycle callbacks (positional arguments)
  onAgentStart: (agentId, input) => {
    console.log(`Starting ${agentId} with: ${input}`);
  },
  onAgentComplete: (agentId, result) => {
    console.log(`${agentId} done: ${result.totalTokens} tokens`);
  },
  onAgentError: (agentId, error) => {
    console.error(`${agentId} failed:`, error);
  },
  onStep: (step, facts, readyAgents) => {
    console.log(`Step ${step}: ready agents: ${readyAgents}`);
  },
});
```

| Option | Type | Description |
|--------|------|-------------|
| `agents` | `Record<string, GoalAgentDeclaration>` | Agent declarations |
| `goals` | `Record<string, GoalDefinition>` | Goal definitions |
| `runner` | `AgentRunner` | LLM execution function |
| `runOptions` | `RunOptions` | Default options for agent runs |
| `timeline` | `DebugTimeline` | Debug timeline for event recording |
| `onAgentStart` | `(agentId, input) => void` | Agent started callback |
| `onAgentComplete` | `(agentId, result) => void` | Agent completed callback |
| `onAgentError` | `(agentId, error) => void` | Agent error callback |
| `onStep` | `(step, facts, readyAgents) => void` | Convergence step callback |

---

## When to Use the Goal Engine

| Scenario | Use Goal Engine? | Alternative |
|----------|------------------|-------------|
| Fixed pipeline (A &rarr; B &rarr; C) | Yes &ndash; declares deps, handles failures | `sequential()` pattern for simpler cases |
| Dynamic agent selection | No &ndash; graph is static at construction | `supervisor()` pattern or capability routing |
| Parallel fan-out/fan-in | Yes &ndash; agents at same depth level run in parallel | `parallel()` pattern if you know agents upfront |
| Iterative refinement | Yes &ndash; use `allowRerun: true` | `reflect()` pattern for single-agent loops |
| One-shot agent call | No &ndash; overkill | `runAgent()` directly |
| Complex branching DAG | Yes &ndash; the engine handles topological ordering | `dag()` pattern for explicit node control |

The goal engine is best when you have **multiple agents that depend on each other's output** and you want the runtime to figure out execution order. For simpler cases, [Execution Patterns](/docs/ai/patterns) give you more direct control.

---

## Next Steps

- [Multi-Agent Orchestrator](/docs/ai/multi-agent) &ndash; Imperative multi-agent coordination
- [Execution Patterns](/docs/ai/patterns) &ndash; Parallel, sequential, and more
- [Cross-Agent State](/docs/ai/cross-agent-state) &ndash; Shared state and derivations
