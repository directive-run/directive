---
title: DevTools
description: Real-time visual debugging with 8 specialized views connected via WebSocket.
---

A standalone DevTools UI with 8 views for debugging agent orchestration in real time. {% .lead %}

The DevTools package (`@directive-run/devtools`) connects to a WebSocket server that bridges your orchestrator's timeline, health, breakpoints, and state into a visual debugging interface.

{% devtools-demo /%}

---

## Setup

### Server

```typescript
import { connectDevTools } from '@directive-run/ai';

const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: { /* ... */ },
  debug: true,
});

// One-liner — creates WebSocket server and wires everything up
const server = await connectDevTools(orchestrator, { port: 4040 });

console.log(`DevTools server on ws://localhost:${9229}`);
```

Or wire up manually for full control:

```typescript
import { createDevToolsServer, createWsTransport } from '@directive-run/ai';

const transport = await createWsTransport({ port: 4040 });

const server = createDevToolsServer({
  transport,
  timeline: orchestrator.timeline!,
  healthMonitor: orchestrator.healthMonitor,
  getSnapshot: () => buildSnapshot(orchestrator),
  getBreakpointState: () => orchestrator.getPendingBreakpoints(),
  onResumeBreakpoint: (id, mods) => orchestrator.resumeBreakpoint(id, mods),
  onCancelBreakpoint: (id, reason) => orchestrator.cancelBreakpoint(id, reason),
  getScratchpadState: () => orchestrator.scratchpad?.getAll() ?? {},
  getDerivedState: () => orchestrator.derived ?? {},
  maxClients: 50,
  batchSize: 1,
  batchIntervalMs: 50,
});
```

### Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `4040` | WebSocket server port |
| `maxClients` | `number` | `50` | Maximum concurrent DevTools clients |
| `batchSize` | `number` | `1` | Events per batch message |
| `batchIntervalMs` | `number` | `50` | Batch flush interval (ms) |

---

## Views

The DevTools UI has 8 specialized views, accessible as tabs.

### 1. Timeline

Horizontal lanes per agent with bar-per-event rendering.

**Features:**
- Agent filter chips &ndash; show/hide specific agents
- Event type filter chips &ndash; filter by event type
- Search across event details
- Zoom (1x&ndash;20x) with Ctrl+Scroll
- Pan with click-and-drag
- Canvas minimap for navigation
- Replay cursor for stepping through events
- Anomaly highlighting (errors, warnings, info)
- Live token streaming panel

### 2. Flamechart

Hierarchical flame graph visualization. Pairs start/end events into nested bars: Patterns &rarr; Agents &rarr; Resolvers.

- Hover for tooltips with duration and token usage
- Click to select and view detail panel

### 3. DAG

Directed acyclic graph using React Flow.

- Topological layout with animated edges during execution
- Click nodes for detail panel (status, tokens, run count)
- Cycle detection with visual indication

### 4. Health

Agent health monitoring cards.

- Circuit state indicator (closed/open/half-open)
- Success rate percentage
- Average latency
- Health score (color-coded: green &ge; 70, amber &ge; 40, red < 40)
- Summary stats across all agents
- Token usage chart
- Reroute event log

### 5. Cost

Token usage and estimated cost breakdown.

- Total tokens and estimated cost ($0.01/1K tokens)
- Stacked bar chart per agent
- Cost breakdown table: Agent, Runs, Total Tokens, Avg Tokens, Duration, % of Total

### 6. Breakpoints

Interactive breakpoint management.

- Pending breakpoints list
- Per-breakpoint cards with input modification and skip toggle
- "Resume All" button
- Resolved/cancelled history

### 7. State

Two sub-tabs: **Scratchpad** and **Derived**.

- Key-value display with syntax highlighting
- Live updates as values change

### 8. Compare

Side-by-side comparison of saved session runs.

- Run selectors (dropdown)
- Summary stats comparison
- Event type breakdown
- Mini timeline bars
- Diff summary

---

## Replay Mode

Step through recorded events with playback controls.

**Controls:**
- Play/Pause (Space)
- Step forward/backward (Arrow keys)
- Jump to start/end (Home/End)
- Exit replay (Escape)
- Speed: 1x, 2x, 5x, 10x

---

## Anomaly Detection

The DevTools automatically detects anomalies in agent execution:

| Severity | Examples |
|----------|---------|
| **Critical** | Agent errors, guardrail rejections |
| **Warning** | Retries, duration outliers (>2x mean), token spikes (>2x mean) |
| **Info** | Reroutes, circuit breaker state changes |

Anomalies are highlighted in the timeline view and can be filtered.

---

## Session Management

- **Export** &ndash; Save a session to JSON for sharing or archival
- **Import** &ndash; Load a saved session for replay
- **Compare** &ndash; Save multiple runs and compare them side-by-side
- **Fork** &ndash; Truncate timeline to a past point and replay from there

---

## WebSocket Protocol

### Server &rarr; Client

| Message | Description |
|---------|-------------|
| `welcome` | Connection established |
| `event` / `event_batch` | Timeline events |
| `snapshot` | Full orchestrator state snapshot |
| `health` | Agent health data |
| `breakpoints` | Pending breakpoint state |
| `scratchpad_state` / `scratchpad_update` | Scratchpad data |
| `derived_state` / `derived_update` | Derived values |
| `token_stream` / `stream_done` | Live token streaming |
| `fork_complete` | Fork operation completed |
| `error` | Server error |
| `pong` | Keepalive response |

### Client &rarr; Server

| Message | Description |
|---------|-------------|
| `request_snapshot` | Request current state |
| `request_health` | Request health data |
| `request_events` | Request event history |
| `request_breakpoints` | Request breakpoint state |
| `request_scratchpad` | Request scratchpad state |
| `request_derived` | Request derived values |
| `resume_breakpoint` | Resume a paused breakpoint |
| `cancel_breakpoint` | Cancel a paused breakpoint |
| `fork_from_snapshot` | Fork timeline at a snapshot |
| `export_session` / `import_session` | Session persistence |
| `ping` | Keepalive ping |

---

## Connection Details

- **Auto-reconnect:** Exponential backoff up to 30s, max 20 attempts
- **Keepalive:** Ping every 30 seconds
- **Event buffer:** Max 5,000 events in memory, `requestAnimationFrame` flushing
- **Token streaming:** Buffers up to 10KB per agent, 50 concurrent agents max

---

## DevToolsServer API

```typescript
interface DevToolsServer {
  clientCount: number;
  broadcast(message: DevToolsServerMessage): void;
  pushHealth(): void;
  pushBreakpoints(): void;
  pushScratchpadUpdate(key: string, value: unknown): void;
  pushDerivedUpdate(id: string, value: unknown): void;
  pushTokenStream(agentId: string, tokens: string, tokenCount: number): void;
  pushStreamDone(agentId: string, totalTokens: number): void;
  close(): void;
}
```

---

## Next Steps

- [Debug Timeline](/docs/ai/debug-timeline) &ndash; Timeline event types and querying
- [Breakpoints & Checkpoints](/docs/ai/breakpoints) &ndash; Pausing and restoring state
- [Cross-Agent State](/docs/ai/cross-agent-state) &ndash; Scratchpad and derivations
- [Self-Healing](/docs/ai/self-healing) &ndash; Health monitoring and rerouting
