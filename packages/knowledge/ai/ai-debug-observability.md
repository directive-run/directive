# AI debug + observability

Debug timeline with typed event recording, breakpoints, checkpoints, an OTel plugin for span emission, and an OTLP exporter for sending metrics/traces to any OTel-compatible backend.

## Decision tree

```
What do you need?
├── Event stream of all AI activity  → createDebugTimeline()
├── Pause execution at specific points → breakpoints (top-level option on orchestrator)
├── Save / restore orchestrator state → orchestrator.checkpoint() / restore()
├── Span emission to OTel             → createOtelPlugin({ serviceName })
├── Ship metrics + traces to backend  → createOTLPExporter({ endpoint })
└── DevTools panel + websocket export → createDevtoolsServer + createDevtoolsExport
```

## `createDebugTimeline(options?)`

Returns a `DebugTimeline` with typed event recording, multi-axis querying, snapshot-aware forking, and JSON import/export. Import from `@directive-run/ai/devtools` — the main `@directive-run/ai` barrel re-exports it with `@deprecated` notices for v2.

```typescript
import { createDebugTimeline, type DebugTimelineListener } from "@directive-run/ai/devtools";

const timeline = createDebugTimeline({
  maxEvents: 2000,                          // default 2000 — ring buffer, oldest evicted first
  getSnapshotId: () => system.history?.currentId ?? null, // for snapshot-aware querying
  goToSnapshot: (id) => system.history?.goTo(id),         // for forkFrom
});

// Subscribe — listener takes a single DebugEvent. There is NO options arg / filter shape.
const unsubscribe: () => void = timeline.subscribe((event) => {
  console.log(`[${event.timestamp}] ${event.type}`, event);
});

// Filter at the listener — the API has no built-in filter option
const unsubAgents = timeline.subscribe((event) => {
  if (event.type.startsWith("agent_")) {
    console.log(`agent: ${event.type}`);
  }
});

// Record an event manually
timeline.record({
  type: "agent_start",
  timestamp: Date.now(),
  agentId: "researcher",
  snapshotId: null,
  inputLength: 42,
});

// Length
console.log(timeline.length);
```

### Querying past events

The query surface is method-based — there is no `timeline.query({ type, since })`. Use the typed helpers:

```typescript
const all          = timeline.getEvents();                                // DebugEvent[]
const agentErrors  = timeline.getEventsByType("agent_error");              // typed-narrowed
const recentSpan   = timeline.getEventsInRange(Date.now() - 60_000, Date.now());
const researcher   = timeline.getEventsForAgent("researcher");
const atSnapshot   = timeline.getEventsAtSnapshot(7);
```

`getEventsByType<T>(type)` narrows the union — `agentErrors` above is typed as `Extract<DebugEvent, { type: "agent_error" }>[]`, so `err.error.message` autocompletes.

### Persistence + fork

```typescript
const json = timeline.export();        // string — full JSON dump
timeline.clear();
timeline.import(json);                  // re-hydrate

timeline.forkFrom(snapshotId);          // truncate post-snapshot events + call goToSnapshot
```

## Attaching the timeline to an orchestrator

`OrchestratorDebugConfig` has exactly one option: `verboseTimeline?: boolean`. There is NO `timeline:` / `breakpoints:` / `exporter:` field inside `debug:` — `breakpoints` and `onBreakpoint` are top-level options on the orchestrator, and the timeline is *read off* the orchestrator via `orchestrator.timeline` after construction.

```typescript
import { createAgentOrchestrator } from "@directive-run/ai";

const orchestrator = createAgentOrchestrator({
  runner,
  debug: { verboseTimeline: true },     // or just `debug: true`
  // Top-level — NOT inside debug
  breakpoints: [
    { id: "before-write", before: "agent_start" },
  ],
  onBreakpoint: (req) => {
    console.log("breakpoint hit", req.id);
    orchestrator.resumeBreakpoint(req.id);
  },
});

// Timeline is exposed on the orchestrator (null when debug: false)
const timeline = orchestrator.timeline;
timeline?.subscribe((event) => console.log(event));
```

## Breakpoints

Configure breakpoints as a top-level option on the orchestrator. Each entry pauses execution before/after a specific event type; `onBreakpoint` fires with a `BreakpointRequest` you resume via `orchestrator.resumeBreakpoint(id)` (with optional input modifications) or cancel via `orchestrator.cancelBreakpoint(id, reason?)`.

```typescript
import type { BreakpointConfig, BreakpointModifications } from "@directive-run/ai";

const orchestrator = createMultiAgentOrchestrator({
  agents: { researcher, writer, editor },
  runner,
  breakpoints: [
    { id: "before-write", before: "agent_start", filter: (e) => e.agentName === "writer" },
    { id: "on-error",     after:  "agent_error" },
  ],
  onBreakpoint: async (req) => {
    if (req.id === "on-error") {
      // Log + cancel
      console.error("breakpoint on error:", req.event);
      orchestrator.cancelBreakpoint(req.id, "aborting on error");

      return;
    }

    await waitForUserClick();
    orchestrator.resumeBreakpoint(req.id);
  },
  breakpointTimeoutMs: 5 * 60 * 1000,
});
```

There is NO `breakpoint.when(event)` / `breakpoint.onHit(event, resume)` shape — those don't exist. Filter on a typed `before:` / `after:` event-type key plus an optional `filter:` predicate; resume/cancel via the orchestrator's methods.

## Checkpoints

See `ai-orchestrator.md` and `ai-multi-agent.md` for the full checkpoint surface. Quick form:

```typescript
const cp = await orchestrator.checkpoint({ label: "before-risky-op" });  // async!
const serialized = JSON.stringify(cp);

// Restore on an EXISTING instance — there is no `checkpoint` constructor option
const fresh = createAgentOrchestrator({ runner /* same config */ });
fresh.restore(JSON.parse(serialized));
```

## OpenTelemetry plugin

`createOtelPlugin({ serviceName, … })` returns a Directive plugin you pass to `createSystem({ plugins: [otel] })` (or to the orchestrator via its `plugins:` option). It emits spans for agent runs, resolver execution, guardrails, and pattern boundaries — mapped to GenAI semantic conventions.

```typescript
import { createOtelPlugin, OtelStatusCode } from "@directive-run/ai";

const otel = createOtelPlugin({
  serviceName: "my-ai-app",
  serviceVersion: "1.0.0",
  // Optional: a custom OtelTracer. Defaults to an in-memory tracer suitable for the OTLP exporter.
  tracer: customTracer,
});

const orchestrator = createAgentOrchestrator({
  runner,
  plugins: [otel],
});
```

## OTLP exporter

`createOTLPExporter({ endpoint, … })` returns `{ exportMetrics, exportTraces }` — paired with an observability config that streams collected data to any OTel-compatible backend (Jaeger, Tempo, Grafana Cloud, Honeycomb, etc.).

```typescript
import { createOTLPExporter } from "@directive-run/ai";
// (re-exported from @directive-run/core/plugins)

const exporter = createOTLPExporter({
  endpoint: "http://localhost:4318",
  serviceName: "my-ai-app",
  serviceVersion: "1.0.0",
  headers: { Authorization: `Bearer ${process.env.OTEL_TOKEN}` },
  timeoutMs: 10_000,
  onError: (err, kind) => console.error(`[otlp] ${kind} export failed:`, err),
});

// Wire into the observability plugin (see core observability docs)
const obs = createObservabilityPlugin({
  metrics: { exporter: { export: exporter.exportMetrics } },
  tracing: { exporter: { export: exporter.exportTraces } },
});

const orchestrator = createAgentOrchestrator({
  runner,
  plugins: [obs, otel],
});
```

The exporter maps Directive events to GenAI semantic conventions. The exact mapping (gen_ai.chat, gen_ai.tool, gen_ai.guardrail, gen_ai.orchestration) lives in `@directive-run/core/plugins/otlp-exporter.ts` and tracks the OpenTelemetry GenAI spec.

## DevTools server (live websocket export)

For browser-based devtools panels, pair `createDebugTimeline` with `createDevtoolsServer` (also from `@directive-run/ai/devtools`) — same data the in-process listener gets, streamed over a WebSocket.

```typescript
import { createDebugTimeline, createDevtoolsServer } from "@directive-run/ai/devtools";

const timeline = createDebugTimeline({ maxEvents: 5000 });
const server = createDevtoolsServer({ timeline, port: 9229 });

server.start();
// Connect a devtools UI to ws://localhost:9229
```

## Anti-patterns

### `timeline.subscribe(listener, { filter })`

```typescript
// WRONG — subscribe takes only a listener
timeline.subscribe((e) => console.log(e), { filter: (e) => e.type === "agent_error" })

// CORRECT — filter inside the listener
timeline.subscribe((e) => {
  if (e.type === "agent_error") console.log(e);
});
```

### `timeline.query({ type, since })`

```typescript
// WRONG — there is no .query() method
timeline.query({ type: "agent_error", since: Date.now() - 60_000 })

// CORRECT — typed getters
timeline.getEventsByType("agent_error")
  .filter((e) => e.timestamp >= Date.now() - 60_000);

// Or use range directly
timeline.getEventsInRange(Date.now() - 60_000, Date.now());
```

### Nesting timeline / breakpoints inside `debug:`

```typescript
// WRONG — only verboseTimeline lives inside debug; breakpoints + timeline are top-level
createAgentOrchestrator({
  runner,
  debug: { timeline, verbose: true, breakpoints: [...] },
})

// CORRECT
createAgentOrchestrator({
  runner,
  debug: { verboseTimeline: true },           // OR just `debug: true`
  breakpoints: [...],                          // top-level
  onBreakpoint: (req) => orchestrator.resumeBreakpoint(req.id),
});
// timeline is read off `orchestrator.timeline` after construction
```

### `breakpoint.when(event)` / `breakpoint.onHit(event, resume)`

```typescript
// WRONG — these shapes don't exist
breakpoints: [
  { id: "x", when: (e) => e.type === "agent_start", onHit: (e, resume) => resume() },
]

// CORRECT — declarative before:/after: + typed filter, then orchestrator.resumeBreakpoint()
breakpoints: [
  { id: "x", before: "agent_start", filter: (e) => e.agentName === "writer" },
],
onBreakpoint: (req) => orchestrator.resumeBreakpoint(req.id),
```

### Restoring a checkpoint via the constructor

```typescript
// WRONG — there is no `checkpoint:` constructor option
createMultiAgentOrchestrator({ agents, patterns, runner, checkpoint: saved })

// CORRECT — orch.restore() on an existing instance
const orch = createMultiAgentOrchestrator({ agents, patterns, runner });
orch.restore(saved);
orch.start();
```

### Assuming `agent_complete.output` is `string`

```typescript
// WRONG — output is unknown, not string
timeline.subscribe((e) => {
  if (e.type === "agent_complete") console.log(e.output.length); // type error
});

// CORRECT — narrow before reading
timeline.subscribe((e) => {
  if (e.type === "agent_complete" && typeof e.output === "string") {
    console.log(e.output.length);
  }
});
```

## Quick reference

| API | Purpose |
|---|---|
| `createDebugTimeline(options?)` | Typed event recorder + queryable history |
| `timeline.subscribe(listener)` | Live event stream (no filter option) |
| `timeline.getEventsByType<T>(type)` | Typed-narrowed query |
| `timeline.getEventsInRange(start, end)` | Time-bounded query |
| `timeline.getEventsForAgent(agentId)` | Per-agent stream |
| `timeline.getEventsAtSnapshot(id)` | Snapshot-aware stream |
| `timeline.forkFrom(id)` | Truncate post-snapshot + reroute |
| `timeline.export()` / `import(json)` | JSON round-trip |
| `orchestrator.timeline` | Read the timeline back off the orchestrator (`null` when `debug: false`) |
| `breakpoints: [...]` + `onBreakpoint` | Top-level orchestrator options for pause points |
| `orchestrator.resumeBreakpoint(id, mods?)` / `cancelBreakpoint(id, reason?)` | Resolve a paused breakpoint |
| `createOtelPlugin(config)` | Plugin that emits spans for orchestrator activity |
| `createOTLPExporter(config)` | Returns `{ exportMetrics, exportTraces }` for OTel backends |
| `createDevtoolsServer({ timeline, port })` | WebSocket-bridged timeline for browser devtools |
