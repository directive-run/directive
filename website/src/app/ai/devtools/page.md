---
title: DevTools
description: Visual debugger for AI agent orchestration — see what your agents did, why, and how long it took.
---

A visual debugger that shows you what your AI agents did, why decisions were made, how long things took, and what went wrong. {% .lead %}

{% callout type="note" title="Try it live" %}
DevTools is active on all example pages. Visit [Safety Shield](/docs/examples/guardrails) or [Checkpoint](/docs/examples/checkpoint) and click the Directive logo button (bottom-left) to inspect the system. For the full AI DevTools experience with streaming events, try the [AI Chat demo](/ai/examples/chat).
{% /callout %}

What you can see: agent execution timeline, cost breakdown, constraint evaluation, guardrail results, breakpoints, live token streaming, session replay, and state inspection across 13 specialized views.

{% devtools-demo /%}

---

## How It Works

When you enable `debug: true` on an orchestrator, it records every decision as a timestamped event in a debug timeline. The DevTools server streams these events over WebSocket to the DevTools UI, which visualizes them in real-time.

```
Your App → Orchestrator (debug: true) → Timeline (event log)
                                              ↓
                                        DevTools Server (WebSocket)
                                              ↓
                                    DevTools UI (browser)
```

---

## DevTools vs SSE Transport

These are two separate outputs from the same orchestrator. They serve different purposes and can be used independently.

**DevTools** is for you, the developer. It streams debug events (timeline, health, state) to the DevTools UI so you can inspect what happened inside the orchestrator.

**SSE Transport** (`createSSETransport`) is for your users. It streams agent text responses to your frontend — the typing effect you see in ChatGPT-style interfaces.

| | DevTools | SSE Transport |
|---|---------|---------------|
| **Purpose** | Debug & inspect | Stream responses to users |
| **Audience** | Developer | End user |
| **Protocol** | WebSocket (bidirectional) | HTTP SSE (one-way) |
| **Data** | Timeline events, health, state | Agent text tokens |
| **Function** | `connectDevTools()` | `createSSETransport()` |

You can use one, both, or neither.

---

## Quick Start

One line to connect DevTools to your orchestrator:

```typescript
import { connectDevTools } from '@directive-run/ai';

const orchestrator = createMultiAgentOrchestrator({
  runner,
  agents: { /* ... */ },
  debug: true,
});

const server = await connectDevTools(orchestrator, { port: 4040 });

console.log(`DevTools server on ws://localhost:${4040}`);
```

Open the DevTools UI and connect to `ws://localhost:4040`.

---

## Manual Setup

For full control over the server configuration:

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
| `host` | `string` | `"localhost"` | Host to bind to |
| `maxClients` | `number` | `50` | Maximum concurrent DevTools clients |
| `batchSize` | `number` | `1` | Events per batch message |
| `batchIntervalMs` | `number` | `50` | Batch flush interval (ms) |
| `authenticate` | `(token: string) => boolean \| Promise<boolean>` | — | Token validation callback (see [Authentication](#authentication)) |

---

## Remote Connections

By default, the DevTools server binds to `localhost` — only accessible from the same machine. To debug a remote orchestrator (staging, production, another machine on your network):

```typescript
const server = await connectDevTools(orchestrator, {
  port: 4040,
  host: "0.0.0.0", // Expose to all network interfaces
  authenticate: (token) => token === process.env.DEVTOOLS_TOKEN,
});
```

{% callout type="warning" title="Security" %}
Binding to `0.0.0.0` exposes the server to your entire network. Always use authentication when exposing DevTools beyond localhost. Use `wss://` (WebSocket over TLS) in production via a reverse proxy.
{% /callout %}

**When you need this:**
- Debugging a staging/production orchestrator from your local DevTools UI
- Team debugging — multiple developers inspecting the same orchestrator
- Cloud-hosted DevTools connecting to your running server

In the DevTools UI, enter the remote URL (e.g., `ws://staging.internal:4040`) and the auth token to connect.

---

## Authentication

Token-based authentication for remote DevTools connections. Browser WebSocket doesn't support custom headers, so authentication happens as the first message after connection.

### Server Side

```typescript
const server = await connectDevTools(orchestrator, {
  port: 4040,
  host: "0.0.0.0",
  authenticate: async (token) => {
    // Validate against your secret, database, or auth service
    return token === process.env.DEVTOOLS_TOKEN;
  },
});
```

When `authenticate` is configured:
1. New connections are held in a pending state
2. The server waits for an `authenticate` message with the token
3. If valid → sends `welcome`, proceeds normally
4. If invalid → sends `error` with code `AUTH_FAILED`, closes connection

When `authenticate` is **not** configured, connections work exactly as before — no auth required. This is fully backward compatible.

### Client Side

The DevTools UI has an optional "Auth Token" field in the sidebar. Enter your token before connecting to a remote server. The token is sent automatically as the first message after the WebSocket opens.

### Manual Setup

If using `createDevToolsServer` directly:

```typescript
const server = createDevToolsServer({
  transport,
  timeline: orchestrator.timeline!,
  authenticate: async (token) => {
    return token === process.env.DEVTOOLS_TOKEN;
  },
  // ... other config
});
```

---

## Custom Transports

The DevTools server is transport-agnostic. It works with any WebSocket library via the `DevToolsTransport` interface:

```typescript
interface DevToolsTransport {
  onConnection(handler: (
    client: DevToolsClient,
    onMessage: (handler: (data: string) => void) => void,
    onClose: (handler: () => void) => void,
  ) => void): void;
  close(): void;
}
```

The built-in `createWsTransport` uses the Node.js `ws` package, but you can implement this interface for Bun, Deno, or any other runtime.

**When you'd build a custom transport:** HTTP long-polling for environments without WebSocket support, SSE-based transport for one-way streaming, or a custom auth layer that validates tokens at the transport level.

```typescript
function createMyTransport(port: number): DevToolsTransport {
  // Your WebSocket/transport setup here
  return {
    onConnection(handler) { /* wire up new connections */ },
    close() { /* shut down */ },
  };
}

const server = createDevToolsServer({
  transport: createMyTransport(4040),
  timeline: orchestrator.timeline!,
});
```

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

**Task event types:**
- `task_start` &ndash; Task execution begins
- `task_complete` &ndash; Task execution completed
- `task_error` &ndash; Task execution failed
- `task_progress` &ndash; Task reports intermediate progress

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

Task nodes appear as violet dashed-border nodes with a gear icon, distinct from agent nodes. They show label, run count, and a progress bar during execution. Hover to see the task description.

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
| `welcome` | Connection established (sent after successful auth if configured) |
| `event` / `event_batch` | Timeline events |
| `snapshot` | Full orchestrator state snapshot |
| `health` | Agent health data |
| `breakpoints` | Pending breakpoint state |
| `scratchpad_state` / `scratchpad_update` | Scratchpad data |
| `derived_state` / `derived_update` | Derived values |
| `token_stream` / `stream_done` | Live token streaming |
| `fork_complete` | Fork operation completed |
| `error` | Server error (includes `AUTH_FAILED` for authentication failures) |
| `pong` | Keepalive response |

### Client &rarr; Server

| Message | Description |
|---------|-------------|
| `authenticate` | Send auth token (required when server has `authenticate` configured) |
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

The DevTools UI recognizes 29 event types grouped by category:

| Category | Event Types |
|----------|-------------|
| **Agent lifecycle** | `agent_start`, `agent_complete`, `agent_error`, `agent_retry` |
| **Constraints** | `constraint_evaluate`, `resolver_start`, `resolver_complete`, `resolver_error` |
| **Governance** | `guardrail_check`, `approval_request`, `approval_response`, `breakpoint_hit`, `breakpoint_resumed` |
| **Patterns** | `pattern_start`, `pattern_complete`, `race_start`, `race_winner`, `race_cancelled`, `debate_round`, `reflection_iteration` |
| **State** | `derivation_update`, `scratchpad_update` |
| **Checkpoints** | `checkpoint_save`, `checkpoint_restore` |
| **Tasks** | `task_start`, `task_complete`, `task_error`, `task_progress` |
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
