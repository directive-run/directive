# @directive-run/architect

**Let an LLM observe, reason about, and modify your Directive system at runtime — with safety guardrails, audit trails, and kill switches.**

The AI Architect gives an LLM architectural control over a [Directive](https://directive.run) constraint-driven runtime system. Declare what the AI can do, set a budget, and let it create constraints, resolvers, effects, and derivations to keep your system healthy.

## Install

```bash
npm install @directive-run/architect @directive-run/core @directive-run/ai
```

## Quick Start

```typescript
import { createModule, createSystem } from "@directive-run/core";
import { createAIArchitect } from "@directive-run/architect";

// 1. Build a Directive system
const mod = createModule("app", {
  schema: { errorCount: 0, status: "ok" },
  constraints: {
    tooManyErrors: {
      when: (facts) => facts.errorCount > 5,
      require: { type: "RESET_ERRORS" },
    },
  },
});
const system = createSystem({ module: mod });

// 2. Create an AI Architect
const architect = createAIArchitect({
  system,
  runner,                              // Your AgentRunner (OpenAI, Anthropic, etc.)
  budget: { tokens: 50_000, dollars: 5 },
  context: {
    description: "An error-tracking system",
    goals: ["Keep error count under control"],
  },
});

// 3. Ask it to analyze
const analysis = await architect.analyze("Why is errorCount climbing?");
console.log(analysis.actions); // Actions the AI proposed

// 4. Approve or reject
await architect.approve(analysis.actions[0].id);

// 5. Kill switch — remove ALL AI definitions instantly
architect.kill();
```

## Features

| Feature | Description |
|---------|-------------|
| **Safety Guardrails** | Sandboxed code execution, blocked patterns, execution timeouts |
| **Approval Flow** | Per-type approval levels: `always`, `first-time`, `never` |
| **Audit Trail** | Hash-chained append-only log of every AI action |
| **Kill Switch** | Synchronous removal of all AI-created definitions |
| **Rollback** | Undo any AI action, preview before rolling back, batch rollback |
| **Health Triggers** | Auto-analyze when system health score declines below threshold |
| **Outcome Tracking** | Track success/failure of applied actions, detect patterns |
| **Custom Tools** | Register your own tools the AI can call at runtime |
| **Constraint Templates** | Built-in pattern library (rate-limit, circuit-breaker, retry, etc.) |
| **What-If Analysis** | Simulate actions before applying — with multi-round cascade |
| **Adaptive Context** | Enrich LLM prompts with health trends and outcome history |
| **Discovery Mode** | Observe the system for patterns and get AI recommendations |
| **Replay** | Record system events, replay with architect to compare |
| **Federation** | Export/import anonymized patterns across systems |
| **Policies** | Meta-constraints on the architect itself (rate limits, protected keys) |
| **Fallback** | Graceful degradation when LLM is unavailable |
| **Persistence** | Pluggable audit and checkpoint stores |
| **Metrics** | Pluggable observability provider with span tracking |
| **Pause/Resume** | Pause automatic triggers, queue them, resume on demand |
| **Learning Mode** | Track human approve/reject decisions, feed patterns back to LLM |
| **Intent Stories** | Define behavior as user stories, resolve to config via LLM |
| **Multi-System** | Orchestrate multiple Directive systems through a single architect |

## Core Concepts

### System
A live Directive system (`createSystem()`) that the architect manages. The architect observes its facts, constraints, resolvers, and derivations.

### Runner
An `AgentRunner` from `@directive-run/ai` that handles LLM communication. Bring your own model:

```typescript
// OpenAI
import { createAgent, openai } from "@directive-run/ai";
const runner = createAgent({ provider: openai({ model: "gpt-4o" }) });

// Anthropic
import { createAgent, anthropic } from "@directive-run/ai";
const runner = createAgent({ provider: anthropic({ model: "claude-sonnet-4-20250514" }) });
```

### Budget
**Required.** Token and dollar limits to prevent bill shock. The architect tracks usage and stops when limits are reached.

### Safety
Configurable guardrails: sandbox for AI-generated code, approval requirements per definition type, blocked code patterns, execution timeouts, and auto-rejection of stale approvals.

## Configuration

```typescript
const architect = createAIArchitect({
  // Required
  system,                                      // Live Directive system
  runner,                                      // LLM runner
  budget: { tokens: 50_000, dollars: 5 },      // Hard spending limits

  // Autonomy preset (applied first, explicit options override)
  preset: "advisor",                           // "observer" | "advisor" | "operator" | "autonomous"

  // What the AI can do
  capabilities: {
    constraints: true,                         // Can create/remove constraints (default: true)
    resolvers: true,                           // Can create/remove resolvers (default: true)
    effects: false,                            // Can create/remove effects (default: false)
    derivations: false,                        // Can create/remove derivations (default: false)
    facts: "read-only",                        // "read-only" | "read-write" (default: "read-only")
  },

  // When the AI analyzes
  triggers: {
    onError: true,                             // Trigger on system errors
    onUnmetRequirement: true,                  // Trigger on unresolved requirements
    onFactChange: ["status", "errorCount"],    // Trigger on specific fact changes
    onSchedule: "5m",                          // Periodic analysis interval
    onDemand: true,                            // Allow manual .analyze() calls (default: true)
    minInterval: 60_000,                       // Min ms between analyses (default: 60000)
    onHealthDecline: {                         // Trigger on health score drops
      threshold: 50,                           // Score threshold (0-100)
      pollInterval: "30s",                     // How often to check
      minDrop: 10,                             // Minimum drop to trigger
    },
  },

  // System context for the AI
  context: {
    description: "An e-commerce order system",
    goals: ["Keep orders processing", "Minimize error rate"],
    notes: ["Peak traffic 6-9pm EST"],
  },

  // Safety configuration
  safety: {
    maxDefinitions: 50,                        // Max total AI definitions (default: 50)
    approval: {
      constraints: "first-time",               // "always" | "first-time" | "never"
      resolvers: "always",
    },
    sandbox: true,                             // Sandbox AI code (default: true)
    rollback: true,                            // Enable rollback (default: true)
    auditLog: true,                            // Enable audit trail (default: true)
    blockedPatterns: ["eval("],                 // Additional blocked code patterns
    allowedGlobals: ["Math", "Date", "JSON"],  // Globals available in sandbox
    executionTimeout: 5_000,                   // AI code timeout in ms (default: 5000)
    approvalTimeout: 300_000,                  // Auto-reject pending after ms (default: 300000)
  },

  // Policies — meta-constraints on the architect
  policies: [
    maxConstraintsPerHour(10),
    protectFactKeys(["userId", "sessionId"]),
    requireApprovalAboveRisk("medium"),
  ],

  // Optional features
  model: "gpt-4",                              // Model override for runner
  outcomeTracking: { measurementDelay: 10_000 }, // Track action outcomes
  customTools: [/* CustomToolDef[] */],         // Additional tools for the AI
  templates: [/* ConstraintTemplate[] */],      // Custom constraint templates
  adaptiveContext: { maxTrendPoints: 20 },     // Adaptive LLM context
  persistence: {                               // Pluggable stores
    auditStore: createInMemoryAuditStore(),
    checkpointStore: createInMemoryCheckpointStore(),
  },
  fallback: {                                  // LLM fallback strategies
    strategies: [cachedResponseStrategy(), heuristicStrategy()],
    maxConsecutiveFailures: 3,
  },
  metrics: createNoopMetrics(),                // Observability provider
  learning: { maxEntries: 500 },               // Track human feedback
  stories: [                                   // Intent-based configuration
    "Keep error count under 10",
    { when: "errors spike", iWant: "add a rate limiter", soThat: "the system stays healthy" },
  ],
  silent: false,                               // Suppress BSL license notice
});
```

## Events

Subscribe to architect lifecycle events:

```typescript
architect.on((event) => console.log(event.type, event));

// Or type-safe per-event:
architect.on("analysis-complete", (event) => {
  console.log(`Analysis took ${event.analysis.durationMs}ms`);
});
```

| Event | Description | Key Fields |
|-------|-------------|------------|
| `observing` | AI is observing system state | — |
| `reasoning` | AI is reasoning about observations | — |
| `generating` | AI is generating code | — |
| `validating` | AI is validating generated code | — |
| `analysis-start` | Analysis cycle started | — |
| `analysis-complete` | Analysis cycle finished | `analysis` |
| `action` | AI proposed an action | `action` |
| `approval-required` | Action needs human approval | `action` |
| `approval-response` | Approval was granted or rejected | `action` |
| `applied` | Action was applied to the system | `action` |
| `rollback` | Action was rolled back | `action` |
| `error` | An error occurred | `error`, `action?` |
| `budget-warning` | Budget usage above 80% | `budgetUsed`, `budgetPercent` |
| `budget-exceeded` | Budget limit reached | `budgetUsed`, `budgetPercent` |
| `killed` | Kill switch activated | `killResult` |
| `plan-step` | Multi-step reasoning progress | `stepIndex`, `totalSteps` |
| `reasoning-chunk` | Streaming reasoning text | `chunk`, `accumulated` |
| `policy-warning` | Non-blocking policy violation | `policy`, `action` |
| `approval-timeout` | Pending approval timed out | `action` |
| `fallback-activated` | LLM fallback strategy used | `strategy`, `error` |
| `health-check` | Health score polled | `score`, `previousScore`, `triggered` |
| `feedback-recorded` | Approve/reject recorded (learning mode) | `actionId`, `tool`, `approved` |
| `stories-resolved` | User stories resolved into config | `config`, `rawResponse` |
| `paused` | Architect paused | `queuedTriggers` |
| `resumed` | Architect resumed | `queuedTriggers` |

## Multi-System Orchestration

Manage multiple Directive systems through a single architect:

```typescript
import { createMultiSystemArchitect } from "@directive-run/architect";

const multi = createMultiSystemArchitect({
  systems: { api: apiSystem, worker: workerSystem },
  runner,
  budget: { tokens: 100_000, dollars: 10 },
});

// Facts are namespaced: "api::errorRate", "worker::queueDepth"
const analysis = await multi.analyze("Why is the API slow?");

// Per-system and aggregate health
const apiHealth = multi.getSystemHealth("api");
const overall = multi.getAggregateHealth();

multi.destroy();
```

## Pause/Resume

```typescript
architect.pause();  // Automatic triggers queue instead of executing
// Manual analysis still works while paused:
const analysis = await architect.analyze("Check status");
architect.resume(); // Drains queued triggers
```

## Testing

```typescript
import {
  mockRunner,
  createTestArchitect,
  createTestSystem,
  assertAnalysisActions,
  assertApproved,
} from "@directive-run/architect/testing";

const system = createTestSystem({ status: "ok", errorCount: 0 });
const { architect } = createTestArchitect({ system });

const analysis = await architect.analyze("Check the system");
assertAnalysisActions(analysis, 1);
assertApproved(analysis.actions[0]);
```

## Examples

See [`examples/`](./examples/) for runnable examples:

- **[basic-observe.ts](./examples/basic-observe.ts)** — Minimal setup, run one analysis
- **[auto-healing.ts](./examples/auto-healing.ts)** — Health triggers + outcome tracking + templates
- **[discovery-whatif.ts](./examples/discovery-whatif.ts)** — Discovery → what-if simulation → apply

## API Reference

See [`docs/API.md`](./docs/API.md) for the complete API reference.

## License

[BUSL-1.1](https://spdx.org/licenses/BUSL-1.1.html) — Business Source License 1.1
