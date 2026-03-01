---
title: DevTools
description: Real-time visual debugging for AI agent orchestration via WebSocket or SSE transport.
---

A transport-agnostic debugging interface for agent orchestration with 13 specialized views (6 system + 7 AI). {% .lead %}

{% callout type="note" title="Try it live" %}
DevTools is active on all example pages. Visit [Safety Shield](/docs/examples/guardrails) or [Checkpoint](/docs/examples/checkpoint) and click the Directive logo button (bottom-left) to inspect the system. For the full AI DevTools experience with streaming events, try the [AI Chat demo](/ai/examples/chat).
{% /callout %}

The DevTools server (`@directive-run/ai`) bridges your orchestrator's timeline, health, breakpoints, and state into a visual debugging interface via WebSocket, SSE, or any custom transport.

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

// One-liner – creates WebSocket server and wires everything up
const server = await connectDevTools(orchestrator, { port: 4040 });

console.log(`DevTools server on ws://localhost:${4040}`);
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

The DevTools UI has 13 specialized views (6 system + 7 AI), accessible as tabs. A time format selector (ms / elapsed / clock) applies across all views.

### System Tabs

Six tabs for inspecting core Directive system state:

| Tab | Description |
|-----|-------------|
| **Facts** | Live key-value table of all facts with filter, copy, inline editing, and breakpoint icons |
| **Derivations** | Live key-value table of all derivations with filter and copy |
| **Pipeline** | Constraint evaluation status, requirement lifecycle, and inflight resolvers |
| **System Graph** | Interactive React Flow diagram of facts → derivations → constraints → resolvers |
| **Time Travel** | Snapshot browser with diff view, undo/redo, and export/import |
| **Breakpoints** | Fact mutation breakpoints, trace event breakpoints, and pause/resume controls |

### AI Tabs

### 1. Timeline

Horizontal lanes per agent with bar-per-event rendering and row packing to prevent overlap.

**Filtering:**
- Agent filter chips &ndash; show/hide specific agents
- Event type filter chips &ndash; filter by event type
- Regex search across all event properties (150ms debounce, ReDoS-safe)
- Error-only quick filter &ndash; show only error events
- AND/OR filter mode toggle &ndash; combine filters with intersection or union

**Navigation:**
- Zoom (1x&ndash;20x) with Ctrl+Scroll
- Pan with click-and-drag (grab cursor when zoomed)
- Canvas minimap for navigation (high-DPI, click-to-pan)
- Time axis labels with configurable format

**Live features:**
- Replay cursor line (red vertical) for stepping through events
- Error highlighting with red rings on error events
- Live token streaming panel &ndash; per-agent token preview (up to 500 chars) with count
- Pause/resume button with pending event count badge

### 2. Cost & Budget

Combined cost analysis and budget tracking in a single tabbed view.

**Cost section:**
- Total tokens, input/output breakdown, and estimated cost
- Stacked bar chart per agent with hover tooltips
- Cost breakdown table: Agent, Runs, Input, Output, Total, Cost, %
- Per-model pricing editor (local only) with reset to defaults

**Budget section:**
- Hourly and daily budget bars with color alerts (90% → red, 70% → amber)
- Remaining budget percentage
- Recent spend list with agent filter and sort (time, cost, tokens)
- Totals footer with aggregate cost

### 3. State

Two sub-tabs with key count badges: **Scratchpad** and **Derived**.

- Key-value display with syntax highlighting and search/filter
- Live updates as values change
- Refresh button with 600ms debounce feedback
- "Edit & Fork" button &ndash; modify state values and fork the timeline from that point

### 4. Guardrails

Guardrail check results with pass/fail status.

- Guardrail event list with type (input/output), name, and result
- Pass rate statistics
- Color-coded results (green for pass, red for fail)

### 5. Agent Graph

Interactive directed acyclic graph using React Flow showing agent execution flow.

- Agent nodes with status colors and icons
- Execution edges with animated connections
- Node selection for detail inspection
- Freehand drawing annotations

### 6. Goal

Goal and target progress tracking.

- Progress indicators for configured goals
- Completion status per objective

### 7. Memory

Agent memory and context inspection.

- Memory usage per agent
- Context window utilization

---

## Event Detail Panel

Clicking any event in the Timeline opens a detail panel showing event properties.

**Features:**
- **Property rendering** &ndash; Syntax-highlighted values (booleans, numbers, strings, objects) with depth-limiting
- **String expansion** &ndash; "Show more/less" toggle for truncated content (>200 chars)
- **Copy to clipboard** &ndash; Copy event ID or full event JSON
- **Token counts** &ndash; Displays `inputTokens`, `outputTokens`, and `totalTokens` when available

---

## Replay Mode

Step through recorded events with playback controls. Uses frame-skipping to maintain real-time accuracy at faster speeds.

**Controls:**
- Play/Pause (Space)
- Step forward/backward (Arrow keys)
- Seek to any position (cursor slider)
- Jump to start/end (Home/End)
- Exit replay (Escape)
- Speed: 1x, 2x, 5x, 10x
- Replay from event &ndash; right-click or use "Replay from here" in the detail panel

---

## Error Highlighting

The DevTools highlights error events in the Timeline view with red rings and distinct coloring. Error events include `agent_error`, `resolver_error`, and failed guardrail checks. Use the error-only quick filter to isolate these events.

---

## Session Management

- **Export JSON** &ndash; Save a session to JSON with version and timestamp metadata
- **Export HTML** &ndash; Generate a standalone HTML trace viewer (no dependencies, no WebSocket &ndash; share with anyone)
- **Import** &ndash; Load a saved session for replay (validates event types and structure, 50MB limit)
- **Fork** &ndash; Truncate timeline to a past point, optionally edit state, and replay from there

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

## Supported Event Types

The DevTools UI recognizes 25 event types grouped by category:

| Category | Event Types |
|----------|-------------|
| **Agent lifecycle** | `agent_start`, `agent_complete`, `agent_error`, `agent_retry` |
| **Constraints** | `constraint_evaluate`, `resolver_start`, `resolver_complete`, `resolver_error` |
| **Governance** | `guardrail_check`, `approval_request`, `approval_response`, `breakpoint_hit`, `breakpoint_resumed` |
| **Patterns** | `pattern_start`, `pattern_complete`, `race_start`, `race_winner`, `race_cancelled`, `debate_round`, `reflection_iteration` |
| **State** | `derivation_update`, `scratchpad_update` |
| **Checkpoints** | `checkpoint_save`, `checkpoint_restore` |
| **Infrastructure** | `handoff_start`, `handoff_complete`, `reroute`, `dag_node_update` |

---

## Connection Details

- **Auto-reconnect:** Exponential backoff up to 30s, max 20 attempts
- **Keepalive:** Ping every 30 seconds
- **Event buffer:** Max 5,000 events in memory, `requestAnimationFrame` flushing
- **Token streaming:** Buffers up to 10KB per agent, 50 concurrent agents max, 5-minute inactivity timeout
- **Prototype pollution defense:** `__proto__`, `constructor`, `prototype` blocked on all inbound messages
- **Input validation:** All server messages validated against typed discriminator union before processing

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

## Related

- **[DevTools Plugin](/docs/plugins/devtools)** — Console API and floating panel for debugging any Directive system's facts, derivations, and events.
- **[AI Chat Demo](/ai/examples/chat)** — Try the visual debugger in your browser.

---

## Next Steps

- [Debug Timeline](/ai/debug-timeline) &ndash; Timeline event types and querying
- [Breakpoints & Checkpoints](/ai/breakpoints) &ndash; Pausing and restoring state
- [Cross-Agent State](/ai/cross-agent-state) &ndash; Scratchpad and derivations
- [Self-Healing](/ai/self-healing) &ndash; Health monitoring and rerouting
- [AI Chat Demo](/ai/examples/chat) &ndash; Interactive visual debugger
