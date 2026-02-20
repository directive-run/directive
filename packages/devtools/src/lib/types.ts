/**
 * Shared types for DevTools UI — mirrors the devtools-server protocol.
 *
 * IMPORTANT: These types must stay in sync with `packages/ai/src/devtools-server.ts`.
 * Any protocol changes there must be reflected here.
 */

// ============================================================================
// Debug Event Types (subset of @directive-run/ai types)
// ============================================================================

export type DebugEventType =
  | "agent_start"
  | "agent_complete"
  | "agent_error"
  | "agent_retry"
  | "guardrail_check"
  | "constraint_evaluate"
  | "resolver_start"
  | "resolver_complete"
  | "resolver_error"
  | "approval_request"
  | "approval_response"
  | "handoff_start"
  | "handoff_complete"
  | "pattern_start"
  | "pattern_complete"
  | "dag_node_update"
  | "breakpoint_hit"
  | "breakpoint_resumed"
  | "derivation_update"
  | "scratchpad_update"
  | "reflection_iteration"
  | "race_start"
  | "race_winner"
  | "race_cancelled"
  | "reroute"
  | "debate_round";

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
}

export interface AgentCompleteEvent extends DebugEvent {
  type: "agent_complete";
  agentId: string;
  durationMs?: number;
  totalTokens?: number;
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

export type ServerMessage =
  | { type: "welcome"; version: number; sessionId: string; timestamp: number }
  | { type: "pong"; timestamp: number }
  | { type: "event"; event: DebugEvent }
  | { type: "event_batch"; events: DebugEvent[] }
  | { type: "snapshot"; data: DevToolsSnapshot }
  | { type: "health"; metrics: Record<string, AgentHealthMetrics> }
  | { type: "breakpoints"; state: BreakpointState }
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
  | { type: "ping" };

// ============================================================================
// Connection State
// ============================================================================

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
