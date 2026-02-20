/**
 * Shared types for DevTools UI — mirrors the devtools-server protocol.
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
  | "race_cancelled";

export interface DebugEvent {
  id: number;
  type: DebugEventType;
  timestamp: number;
  agentId?: string;
  snapshotId: number | null;
  [key: string]: unknown;
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
