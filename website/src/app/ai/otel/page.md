---
title: OpenTelemetry
description: Instrument AI agent execution with OpenTelemetry spans, traces, and GenAI semantic conventions.
---

Auto-instrument agent lifecycle events as OpenTelemetry spans with parent-child relationships and GenAI semantic conventions. {% .lead %}

The OTEL plugin subscribes to the debug timeline and creates spans for agent runs, patterns, guardrails, and resolvers. Use the built-in in-memory tracer or plug in your own.

---

## Setup

Create an orchestrator with `debug: true` to enable the timeline, then attach the OTEL plugin:

```typescript
import { createAgentOrchestrator, createMultiAgentOrchestrator } from '@directive-run/ai';

// Single-agent
const single = createAgentOrchestrator({ runner, debug: true });
const unsub = otel.attach(single.timeline!);

// Multi-agent
const multi = createMultiAgentOrchestrator({ runner, agents, debug: true });
const unsub = otel.attach(multi.timeline!);
```

## Quick Start

```typescript
import { createOtelPlugin } from '@directive-run/ai';

const otel = createOtelPlugin({
  serviceName: 'my-ai-app',
});

// Attach to an orchestrator's timeline
const detach = otel.attach(orchestrator.timeline!);

// Run agents – spans are created automatically
await orchestrator.runAgent('researcher', 'What is WASM?');

// Inspect recorded spans
const spans = otel.getSpans();
for (const span of spans) {
  console.log(span.name, span.durationMs, span.status);
}

// Cleanup
detach();
```

---

## Configuration

```typescript
const otel = createOtelPlugin({
  serviceName: 'my-ai-app',

  // Optional: provide your own OTEL tracer (e.g. from @opentelemetry/sdk-trace-node)
  tracer: myExternalTracer,

  // Prefix for span names (default: serviceName)
  spanPrefix: 'ai',

  // Callback when spans end – send to your collector
  onSpanEnd: (spanData) => {
    myExporter.export([spanData]);
  },

  // Which event types to instrument (default: all)
  instrumentEvents: ['agent_start', 'agent_complete', 'pattern_start'],

  // Auto-cleanup stale spans after this duration (ms)
  spanTtlMs: 60000,
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `serviceName` | `string` | *required* | Service name for spans |
| `tracer` | `OtelTracer` | built-in | External OTEL tracer |
| `spanPrefix` | `string` | `"directive.ai"` | Prefix for span names |
| `onSpanEnd` | `(span: SpanData) => void` | &ndash; | Callback when span ends |
| `instrumentEvents` | `string[]` | all types | Event types to instrument |
| `spanTtlMs` | `number` | &ndash; | Auto-cleanup stale spans (ms) |

---

## SpanData

Each completed span produces a `SpanData` object:

```typescript
interface SpanData {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  attributes: Record<string, string | number | boolean>;
  events: Array<{ name: string; timestamp: number; attributes?: Record<string, unknown> }>;
  status: { code: OtelStatusCode; message?: string };
  startTime: number;
  endTime: number;
  durationMs: number;
}
```

### Status Codes

```typescript
const OtelStatusCode = {
  UNSET: 0,
  OK: 1,
  ERROR: 2,
} as const;
```

---

## Span Hierarchy

The plugin creates parent-child relationships:

```
Pattern span (parallel, sequential, etc.)
  └─ Agent span (researcher)
       ├─ Guardrail span (input check)
       ├─ Resolver span (LLM call)
       └─ Guardrail span (output check)
  └─ Agent span (writer)
       └─ ...
```

Pattern spans are parents of the agent spans within them. Agent spans are parents of their guardrail and resolver spans.

---

## GenAI Semantic Conventions

Agent spans include standard GenAI attributes:

| Attribute | Value |
|-----------|-------|
| `gen_ai.system` | Agent model/system |
| `gen_ai.request.model` | Agent model name |
| `gen_ai.usage.input_tokens` | Input token count |
| `gen_ai.usage.output_tokens` | Output token count |
| `gen_ai.usage.total_tokens` | Total tokens |

---

## OtelPlugin API

```typescript
interface OtelPlugin {
  // Subscribe to timeline events – returns detach function
  attach(timeline: DebugTimeline): () => void;

  // Get all completed spans
  getSpans(): SpanData[];

  // Clear recorded spans
  clearSpans(): void;

  // Access the tracer
  getTracer(): OtelTracer;

  // Number of currently active (open) spans
  getActiveSpanCount(): number;
}
```

---

## External Tracer

Provide your own OTEL tracer for integration with existing observability infrastructure:

```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('my-ai-app', '1.0.0');

const otel = createOtelPlugin({
  serviceName: 'my-ai-app',
  tracer: {
    startSpan: (name, options) => tracer.startSpan(name, options),
  },
});
```

When using an external tracer, `getSpans()` still collects shadow span data for inspection, but the actual spans flow through your OTEL pipeline.

---

## Observability & Metrics

For broader observability beyond OTEL spans, Directive re-exports `createObservability` and `createAgentMetrics` from `@directive-run/core/plugins`:

```typescript
import { createObservability, createAgentMetrics } from '@directive-run/ai';

// Full observability suite – metrics, tracing, alerts
const obs = createObservability({
  serviceName: 'my-ai-app',
  metrics: true,
  tracing: true,
  alerts: [{ name: 'high-error-rate', condition: (m) => m.errorRate > 0.1 }],
});

// Agent-specific metrics collection
const metrics = createAgentMetrics();
```

These integrate with the core Directive plugin system and can be combined with the OTEL plugin for comprehensive production monitoring.

---

## Next Steps

- [Debug Timeline](/ai/debug-timeline) &ndash; Event types the plugin instruments
- [Evals](/ai/evals) &ndash; Quality measurement
- [DevTools](/ai/devtools) &ndash; Visual debugging
