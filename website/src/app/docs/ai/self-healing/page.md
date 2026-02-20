---
title: Self-Healing Networks
description: Automatic agent rerouting when circuit breakers open or health scores drop — Directive-native self-healing for AI agent networks.
---

Automatic agent rerouting when health degrades — Directive-native self-healing. {% .lead %}

When an agent becomes unhealthy (circuit breaker opens, health score drops), the system reactively reroutes work to a healthy equivalent. Zero overhead when not configured.

---

## Quick Start

### Single-Agent Fallback

When the primary circuit breaker opens, fall back to alternate runners:

```typescript
import { createAgentOrchestrator } from '@directive-run/ai';

const orchestrator = createAgentOrchestrator({
  runner: primaryRunner,
  circuitBreaker: { failureThreshold: 3, resetTimeoutMs: 30000 },
  selfHealing: {
    fallbackRunners: [backupRunner, emergencyRunner],
    onReroute: (event) => console.log(`Rerouted to ${event.reroutedTo}`),
  },
});
```

Fallback runners are tried in order. When the primary circuit recovers (half-open → closed), it automatically resumes as the primary.

### Multi-Agent Rerouting

When an agent's circuit breaker opens, reroute to an equivalent agent:

```typescript
import { createMultiAgentOrchestrator } from '@directive-run/ai';

const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: {
    'gpt-writer': { agent: gptWriter, capabilities: ['writing'] },
    'claude-writer': { agent: claudeWriter, capabilities: ['writing'] },
    'researcher': { agent: researcher, capabilities: ['research'] },
  },
  selfHealing: {
    circuitBreakerDefaults: { failureThreshold: 3, resetTimeoutMs: 30000 },
    useCapabilities: true,
    selectionStrategy: 'healthiest',
    onReroute: (event) => console.log(`${event.originalAgent} → ${event.reroutedTo}`),
  },
});
```

When `gpt-writer` fails, the system automatically reroutes to `claude-writer` (same `writing` capability).

---

## Health Monitor

The health monitor tracks per-agent metrics in a rolling time window:

```typescript
import { createHealthMonitor } from '@directive-run/ai';

const monitor = createHealthMonitor({
  windowMs: 60000,        // 60-second rolling window
  maxNormalLatencyMs: 5000, // latency normalization ceiling
  maxEventsPerAgent: 1000,  // max events per agent before FIFO eviction
});

monitor.recordSuccess('agent-a', 120);
monitor.recordFailure('agent-a', 5000, new Error('timeout'));

const score = monitor.getHealthScore('agent-a'); // 0-100
const metrics = monitor.getMetrics('agent-a');
// { agentId, circuitState, successRate, avgLatencyMs, healthScore, lastErrors, ... }
```

### Health Score Formula

The score is a weighted combination (all configurable):

| Factor | Default Weight | How it's computed |
| --- | --- | --- |
| Success rate | 0.5 | `successes / totalEvents` |
| Latency | 0.3 | `1 - (avgLatency / maxNormalLatencyMs)` |
| Circuit state | 0.2 | CLOSED=1, HALF_OPEN=0.5, OPEN=0 |

No data = score 50 (neutral). Score range: 0-100.

---

## Equivalency Resolution

The system finds equivalent agents through two mechanisms:

### Capability Matching (default)

Agents with overlapping `capabilities` arrays are considered equivalent:

```typescript
agents: {
  'fast-writer': { agent: fastWriter, capabilities: ['writing', 'summarization'] },
  'deep-writer': { agent: deepWriter, capabilities: ['writing', 'analysis'] },
  'researcher':  { agent: researcher, capabilities: ['research'] },
},
selfHealing: { useCapabilities: true },
```

When `fast-writer` fails, `deep-writer` is a candidate (shared `writing` capability). `researcher` is not (no overlap).

### Explicit Groups

For fine-grained control, define equivalency groups:

```typescript
selfHealing: {
  equivalencyGroups: {
    writers: ['fast-writer', 'deep-writer', 'backup-writer'],
    researchers: ['researcher', 'backup-researcher'],
  },
},
```

Explicit groups are checked first, then capability matching. Unhealthy agents are filtered out, and the healthiest equivalent is selected.

---

## Selection Strategy

| Strategy | Behavior |
| --- | --- |
| `healthiest` (default) | Pick the equivalent with the highest health score |
| `round-robin` | Rotate through equivalents evenly |

```typescript
selfHealing: {
  selectionStrategy: 'round-robin',
},
```

---

## Degradation Policies

When all equivalents are exhausted:

| Policy | Behavior |
| --- | --- |
| `reject` (default) | Throw the original error |
| `fallback-response` | Return a static response |

```typescript
selfHealing: {
  degradation: 'fallback-response',
  fallbackResponse: { output: 'Service temporarily unavailable.' },
},
```

---

## Single-Agent Configuration

```typescript
interface SelfHealingConfig {
  fallbackRunners?: AgentRunner[];   // tried in order
  fallbackAgent?: AgentLike;         // alternate agent definition
  circuitBreaker?: CircuitBreakerConfig;
  healthThreshold?: number;          // default 30
  degradation?: 'reject' | 'fallback-response';
  fallbackResponse?: unknown;
  onReroute?: (event: RerouteEvent) => void;
}
```

{% callout title="Circuit breaker required" %}
`selfHealing` requires a `circuitBreaker` to detect failures. If you configure `selfHealing` without `circuitBreaker`, a dev-mode warning is emitted.
{% /callout %}

---

## Multi-Agent Configuration

```typescript
interface MultiAgentSelfHealingConfig {
  circuitBreakerDefaults?: CircuitBreakerConfig;
  healthThreshold?: number;                        // default 30
  equivalencyGroups?: Record<string, string[]>;
  useCapabilities?: boolean;                       // default true
  selectionStrategy?: 'healthiest' | 'round-robin';
  degradation?: 'reject' | 'fallback-response';
  fallbackResponse?: unknown;
  onReroute?: (event: RerouteEvent) => void;
  healthMonitor?: HealthMonitorConfig;
}
```

---

## Lifecycle Hooks

```typescript
selfHealing: {
  onReroute: (event) => {
    // event.originalAgent — the unhealthy agent
    // event.reroutedTo — the replacement
    // event.reason — why rerouting happened
    console.log(`Rerouted ${event.originalAgent} → ${event.reroutedTo}: ${event.reason}`);
  },
},
```

---

## Circular Reroute Guard

A rerouted agent cannot itself reroute — maximum 1 hop. This prevents infinite reroute loops when multiple agents in an equivalency group are failing simultaneously.

---

## Zero-Overhead Guarantee

All self-healing setup is gated behind configuration checks. When `selfHealing` is not provided:

- No `HealthMonitor` created
- No extra facts in the Directive system
- No extra constraints or resolvers
- The existing `circuitBreaker` option works exactly as before
