# AI Debug and Observability

Debug timeline with 25+ event types, breakpoints, checkpoints, and OpenTelemetry integration for AI orchestrators.

## Decision Tree: "How do I observe what's happening?"

```
What do you need?
├── Event stream of all AI activity → createDebugTimeline()
├── Pause execution at specific points → breakpoints config
├── Save/restore orchestrator state → checkpoint() / restore
├── Export traces to observability platform → createOTLPExporter()
│
Which events to watch?
├── Agent lifecycle → agent_start, agent_complete, agent_error, agent_retry
├── Guardrails → guardrail_check
├── Constraints/Resolvers → constraint_evaluate, resolver_start, resolver_complete
├── Approval workflow → approval_request, approval_response
├── Multi-agent patterns → pattern_start, pattern_complete, dag_node_update
├── Composition patterns → race_start, race_winner, race_cancelled,
│                          debate_round, reflection_iteration
├── Handoffs → handoff_start, handoff_complete, reroute
├── Tasks → task_start, task_complete, task_error, task_progress, goal_step
├── Checkpoints → checkpoint_save, checkpoint_restore
└── Breakpoints → breakpoint_hit, breakpoint_resumed
```

## Debug Timeline

Subscribe to a real-time event stream of all orchestrator activity:

```typescript
import { createDebugTimeline } from "@directive-run/ai";

const timeline = createDebugTimeline({
  maxEvents: 2000, // Ring buffer size (oldest evicted first)
});

// Subscribe to all events
const unsubscribe = timeline.subscribe((event) => {
  console.log(`[${event.timestamp}] ${event.type}`, event);
});

// Filter by event type
const agentEvents = timeline.subscribe(
  (event) => {
    console.log(`Agent: ${event.agentName} → ${event.type}`);
  },
  { filter: (event) => event.type.startsWith("agent_") },
);

// Query past events
const errors = timeline.query({ type: "agent_error" });
const recentAgentStarts = timeline.query({
  type: "agent_start",
  since: Date.now() - 60000,
});
```

## Event Types Reference

All 25+ event types emitted by the timeline:

```typescript
// Agent lifecycle
type AgentEvents =
  | { type: "agent_start"; agentName: string; prompt: string }
  | { type: "agent_complete"; agentName: string; output: string; tokens: number; duration: number }
  | { type: "agent_error"; agentName: string; error: Error }
  | { type: "agent_retry"; agentName: string; attempt: number; maxRetries: number; error: Error };

// Guardrails
type GuardrailEvents =
  | { type: "guardrail_check"; guardrailName: string; phase: "input" | "output"; passed: boolean; reason?: string };

// Constraints and resolvers
type ConstraintEvents =
  | { type: "constraint_evaluate"; constraintId: string; result: boolean }
  | { type: "resolver_start"; resolverType: string; requirementKey: string }
  | { type: "resolver_complete"; resolverType: string; duration: number };

// Approval workflow
type ApprovalEvents =
  | { type: "approval_request"; agentName: string; prompt: string }
  | { type: "approval_response"; agentName: string; approved: boolean; reason?: string };

// Multi-agent patterns
type PatternEvents =
  | { type: "pattern_start"; patternName: string; agents: string[] }
  | { type: "pattern_complete"; patternName: string; duration: number }
  | { type: "dag_node_update"; nodeId: string; status: "pending" | "running" | "complete" | "error" };

// Composition patterns
type CompositionEvents =
  | { type: "race_start"; agents: string[] }
  | { type: "race_winner"; agentName: string; duration: number }
  | { type: "race_cancelled"; agentName: string; reason: string }
  | { type: "debate_round"; round: number; agentName: string; position: string }
  | { type: "reflection_iteration"; iteration: number; agentName: string };

// Handoffs and routing
type HandoffEvents =
  | { type: "handoff_start"; from: string; to: string }
  | { type: "handoff_complete"; from: string; to: string; duration: number }
  | { type: "reroute"; from: string; to: string; reason: string };

// Checkpoints and breakpoints
type CheckpointEvents =
  | { type: "checkpoint_save"; checkpointId: string }
  | { type: "checkpoint_restore"; checkpointId: string }
  | { type: "breakpoint_hit"; breakpointId: string; agentName: string }
  | { type: "breakpoint_resumed"; breakpointId: string };

// Tasks
type TaskEvents =
  | { type: "task_start"; taskId: string; label?: string }
  | { type: "task_complete"; taskId: string; duration: number }
  | { type: "task_error"; taskId: string; error: Error }
  | { type: "task_progress"; taskId: string; percent: number; message?: string }
  | { type: "goal_step"; iteration: number; goalMet: boolean };
```

## Attaching Timeline to Orchestrator

```typescript
import { createAgentOrchestrator, createDebugTimeline } from "@directive-run/ai";

const timeline = createDebugTimeline({ maxEvents: 2000 });

const orchestrator = createAgentOrchestrator({
  runner,
  debug: {
    timeline,
    verbose: true, // Log all events to console
  },
});
```

## Breakpoints

Pause execution at specific points for human inspection:

```typescript
const orchestrator = createMultiAgentOrchestrator({
  agents: { researcher, writer, editor },
  runner,
  debug: {
    timeline,
    breakpoints: [
      {
        id: "before-write",
        // Pause before the writer agent runs
        when: (event) => {
          return event.type === "agent_start" && event.agentName === "writer";
        },
        onHit: async (event, resume) => {
          console.log("Paused before writer. Review researcher output.");
          console.log("Press enter to continue...");

          await waitForInput();
          resume();
        },
      },
      {
        id: "on-error",
        when: (event) => {
          return event.type === "agent_error";
        },
        onHit: async (event, resume) => {
          console.error("Agent error:", event.error);
          // Decide whether to continue or abort
          resume();
        },
      },
    ],
  },
});
```

## Checkpoints

Save and restore full orchestrator state for debugging or recovery:

```typescript
// Save checkpoint
const checkpoint = orchestrator.checkpoint();
const serialized = JSON.stringify(checkpoint);

// Store to disk, database, etc.
await fs.writeFile("checkpoint.json", serialized);

// Restore from checkpoint
const saved = JSON.parse(await fs.readFile("checkpoint.json", "utf-8"));
const restored = createMultiAgentOrchestrator({
  agents,
  runner,
  checkpoint: saved,
});
restored.start();
```

## OpenTelemetry Integration

Export traces to any OpenTelemetry-compatible backend:

```typescript
import { createOTLPExporter } from "@directive-run/ai";

const exporter = createOTLPExporter({
  endpoint: "http://localhost:4318/v1/traces",
  serviceName: "my-ai-app",
  // Uses GenAI semantic conventions
  // https://opentelemetry.io/docs/specs/semconv/gen-ai/
});

const orchestrator = createAgentOrchestrator({
  runner,
  debug: {
    timeline,
    exporter, // Automatically exports spans
  },
});
```

The exporter maps Directive events to GenAI semantic conventions:

| Directive Event | OTel Span | GenAI Attribute |
|---|---|---|
| `agent_start` → `agent_complete` | `gen_ai.chat` | `gen_ai.system`, `gen_ai.request.model` |
| `resolver_start` → `resolver_complete` | `gen_ai.tool` | `gen_ai.tool.name` |
| `guardrail_check` | `gen_ai.guardrail` | `gen_ai.guardrail.name`, `gen_ai.guardrail.passed` |
| `pattern_start` → `pattern_complete` | `gen_ai.orchestration` | `gen_ai.orchestration.pattern` |

## Quick Reference

| API | Purpose | Key Options |
|---|---|---|
| `createDebugTimeline()` | Event stream for all activity | `maxEvents` |
| `timeline.subscribe()` | Listen to events in real time | callback, filter |
| `timeline.query()` | Search past events | type, since |
| `orchestrator.checkpoint()` | Serialize full state | returns JSON-safe object |
| `createOTLPExporter()` | Export traces to OTel backend | `endpoint`, `serviceName` |
| breakpoints config | Pause at specific events | `when`, `onHit`, `resume` |
