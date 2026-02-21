/**
 * Shared types for DevTools UI — mirrors the devtools-server protocol.
 *
 * IMPORTANT: These types must stay in sync with `packages/ai/src/devtools-server.ts`.
 * Any protocol changes there must be reflected here.
 */

// ============================================================================
// Debug Event Types (subset of @directive-run/ai types)
// ============================================================================

/** H16: Single source of truth — union and runtime set derived from one array */
const DEBUG_EVENT_TYPES = [
  "agent_start",
  "agent_complete",
  "agent_error",
  "agent_retry",
  "guardrail_check",
  "constraint_evaluate",
  "resolver_start",
  "resolver_complete",
  "resolver_error",
  "approval_request",
  "approval_response",
  "handoff_start",
  "handoff_complete",
  "pattern_start",
  "pattern_complete",
  "dag_node_update",
  "breakpoint_hit",
  "breakpoint_resumed",
  "derivation_update",
  "scratchpad_update",
  "reflection_iteration",
  "race_start",
  "race_winner",
  "race_cancelled",
  "reroute",
  "debate_round",
] as const;

export type DebugEventType = (typeof DEBUG_EVENT_TYPES)[number];

/** Error event types (for quick filtering) */
export const ERROR_EVENT_TYPES: ReadonlySet<DebugEventType> = new Set<DebugEventType>([
  "agent_error",
  "resolver_error",
]);

/** Runtime set of all valid DebugEventType values (for validation at import boundaries) */
export const VALID_EVENT_TYPES: ReadonlySet<string> = new Set(DEBUG_EVENT_TYPES);

export interface DebugEvent {
  id: number;
  type: DebugEventType;
  timestamp: number;
  agentId?: string;
  snapshotId: number | null;
  [key: string]: unknown;
}

// ============================================================================
// Typed Event Subtypes (for type-safe property access)
// ============================================================================

export interface AgentStartEvent extends DebugEvent {
  type: "agent_start";
  agentId: string;
  /** Truncated input (only when verboseTimeline is enabled) */
  input?: string;
}

export interface AgentCompleteEvent extends DebugEvent {
  type: "agent_complete";
  agentId: string;
  durationMs?: number;
  totalTokens?: number;
  /** Truncated output (only when verboseTimeline is enabled) */
  output?: string;
}

export interface AgentErrorEvent extends DebugEvent {
  type: "agent_error";
  agentId: string;
  errorMessage?: string;
}

export interface DagNodeUpdateEvent extends DebugEvent {
  type: "dag_node_update";
  nodeId: string;
  status: DagNodeStatus;
  deps?: string[];
}

export interface RerouteEvent extends DebugEvent {
  type: "reroute";
  from: string;
  to: string;
  reason?: string;
}

// Type guards
export function isAgentStart(e: DebugEvent): e is AgentStartEvent {
  return e.type === "agent_start";
}

export function isAgentComplete(e: DebugEvent): e is AgentCompleteEvent {
  return e.type === "agent_complete";
}

export function isAgentError(e: DebugEvent): e is AgentErrorEvent {
  return e.type === "agent_error";
}

export function isDagNodeUpdate(e: DebugEvent): e is DagNodeUpdateEvent {
  return e.type === "dag_node_update";
}

export function isReroute(e: DebugEvent): e is RerouteEvent {
  return e.type === "reroute";
}


// ============================================================================
// Health Types
// ============================================================================

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface AgentHealthMetrics {
  agentId: string;
  circuitState: CircuitState;
  successRate: number;
  avgLatencyMs: number;
  recentFailures: number;
  recentSuccesses: number;
  healthScore: number;
  lastErrors: string[];
}

// ============================================================================
// Breakpoint Types
// ============================================================================

export interface BreakpointRequest {
  id: string;
  type: string;
  agentId: string;
  input: string;
  label?: string;
  requestedAt: number;
}

export interface BreakpointState {
  pending: BreakpointRequest[];
  resolved: string[];
  cancelled: string[];
}

// ============================================================================
// DAG Types
// ============================================================================

export type DagNodeStatus = "pending" | "ready" | "running" | "completed" | "error" | "skipped";

// ============================================================================
// Scratchpad & Derived State Types
// ============================================================================

/** Scratchpad key-value state */
export interface ScratchpadState {
  data: Record<string, unknown>;
}

/** Individual scratchpad update */
export interface ScratchpadUpdate {
  key: string;
  value: unknown;
}

/** Derived values state */
export interface DerivedState {
  data: Record<string, unknown>;
}

/** Individual derived value update */
export interface DerivedUpdate {
  id: string;
  value: unknown;
}

// ============================================================================
// Token Streaming Types
// ============================================================================

/** Batched token stream for a specific agent */
export interface TokenStreamData {
  agentId: string;
  tokens: string;
  tokenCount: number;
}

/** Stream completion signal */
export interface StreamDoneData {
  agentId: string;
  totalTokens: number;
}

// ============================================================================
// Server Protocol
// ============================================================================

export interface DevToolsSnapshot {
  timestamp: number;
  agents: Record<string, {
    status: string;
    lastInput?: string;
    lastOutput?: unknown;
    totalTokens: number;
    runCount: number;
  }>;
  coordinator?: { globalTokens: number; status: string };
  derived?: Record<string, unknown>;
  eventCount: number;
}

/** Single source of truth for server message type discriminators */
const SERVER_MESSAGE_TYPES = [
  "welcome",
  "pong",
  "event",
  "event_batch",
  "snapshot",
  "health",
  "breakpoints",
  "scratchpad_state",
  "scratchpad_update",
  "derived_state",
  "derived_update",
  "fork_complete",
  "token_stream",
  "stream_done",
  "error",
] as const;

export type ServerMessageType = (typeof SERVER_MESSAGE_TYPES)[number];

/** Runtime set of all valid ServerMessage type discriminators */
export const VALID_SERVER_MESSAGE_TYPES: ReadonlySet<string> = new Set(SERVER_MESSAGE_TYPES);

export type ServerMessage =
  | { type: "welcome"; version: number; sessionId: string; timestamp: number }
  | { type: "pong"; timestamp: number }
  | { type: "event"; event: DebugEvent }
  | { type: "event_batch"; events: DebugEvent[] }
  | { type: "snapshot"; data: DevToolsSnapshot }
  | { type: "health"; metrics: Record<string, AgentHealthMetrics> }
  | { type: "breakpoints"; state: BreakpointState }
  // Phase 2: Scratchpad & derived state
  | { type: "scratchpad_state"; data: Record<string, unknown> }
  | { type: "scratchpad_update"; key: string; value: unknown }
  | { type: "derived_state"; data: Record<string, unknown> }
  | { type: "derived_update"; id: string; value: unknown }
  // Phase 2: Fork
  | { type: "fork_complete"; eventId: number; newEventCount: number }
  // Phase 2: Token streaming
  | { type: "token_stream"; agentId: string; tokens: string; tokenCount: number }
  | { type: "stream_done"; agentId: string; totalTokens: number }
  | { type: "error"; code: string; message: string };

export type ClientMessage =
  | { type: "request_snapshot" }
  | { type: "request_health" }
  | { type: "request_events"; since?: number }
  | { type: "request_breakpoints" }
  | { type: "resume_breakpoint"; breakpointId: string; modifications?: { input?: string; skip?: boolean } }
  | { type: "cancel_breakpoint"; breakpointId: string; reason?: string }
  | { type: "export_session" }
  | { type: "import_session"; data: string }
  // Phase 2: Scratchpad & derived state requests
  | { type: "request_scratchpad" }
  | { type: "request_derived" }
  // Phase 2: Fork
  | { type: "fork_from_snapshot"; eventId: number }
  | { type: "ping" };

// ============================================================================
// Connection State
// ============================================================================

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
