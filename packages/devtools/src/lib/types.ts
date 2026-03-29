/**
 * Shared types for DevTools UI.
 *
 * Canonical debug/breakpoint/DAG types are imported from `@directive-run/ai`.
 * DevTools-specific protocol types (ServerMessage, ClientMessage, etc.) are
 * defined locally.
 */

import type {
  BreakpointRequest as AiBreakpointRequest,
  BreakpointState as AiBreakpointState,
  DagNodeStatus as AiDagNodeStatus,
  DebugEventBase,
  DebugEventType as AiDebugEventType,
} from "@directive-run/ai";

// ============================================================================
// Re-exports from @directive-run/ai (single source of truth)
// ============================================================================

export type DebugEventType = AiDebugEventType;
export type DagNodeStatus = AiDagNodeStatus;
export type BreakpointRequest = AiBreakpointRequest;
export type BreakpointState = AiBreakpointState;

/** Error event types (for quick filtering) */
export const ERROR_EVENT_TYPES: ReadonlySet<DebugEventType> =
  new Set<DebugEventType>(["agent_error", "resolver_error"]);

/**
 * Runtime set of all valid DebugEventType values (for validation at import
 * boundaries). Kept in sync with the `DebugEventType` union from
 * `@directive-run/ai`.
 */
export const VALID_EVENT_TYPES: ReadonlySet<string> = new Set<DebugEventType>([
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
  "checkpoint_save",
  "checkpoint_restore",
  "task_start",
  "task_complete",
  "task_error",
  "task_progress",
  "goal_step",
]);

// ============================================================================
// Loose DebugEvent (WebSocket envelope)
// ============================================================================

/**
 * Loose debug event used by the DevTools UI.
 *
 * Extends the canonical `DebugEventBase` from `@directive-run/ai` with an
 * index signature so WebSocket-received events can carry extra properties
 * without requiring every field to be known at compile time.
 */
export interface DebugEvent extends DebugEventBase {
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
  agents: Record<
    string,
    {
      status: string;
      lastInput?: string;
      lastOutput?: unknown;
      totalTokens: number;
      runCount: number;
    }
  >;
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
export const VALID_SERVER_MESSAGE_TYPES: ReadonlySet<string> = new Set(
  SERVER_MESSAGE_TYPES,
);

export type ServerMessage =
  | { type: "welcome"; version: number; sessionId: string; timestamp: number }
  | { type: "pong"; timestamp: number }
  | { type: "event"; event: DebugEvent }
  | { type: "event_batch"; events: DebugEvent[] }
  | { type: "snapshot"; data: DevToolsSnapshot }
  | { type: "breakpoints"; state: BreakpointState }
  // Scratchpad & derived state
  | { type: "scratchpad_state"; data: Record<string, unknown> }
  | { type: "scratchpad_update"; key: string; value: unknown }
  | { type: "derived_state"; data: Record<string, unknown> }
  | { type: "derived_update"; id: string; value: unknown }
  // Fork
  | { type: "fork_complete"; eventId: number; newEventCount: number }
  // Token streaming
  | {
      type: "token_stream";
      agentId: string;
      tokens: string;
      tokenCount: number;
    }
  | { type: "stream_done"; agentId: string; totalTokens: number }
  | { type: "error"; code: string; message: string };

export type ClientMessage =
  | { type: "authenticate"; token: string }
  | { type: "request_snapshot" }
  | { type: "request_events"; since?: number }
  | { type: "request_breakpoints" }
  | {
      type: "resume_breakpoint";
      breakpointId: string;
      modifications?: { input?: string; skip?: boolean };
    }
  | { type: "cancel_breakpoint"; breakpointId: string; reason?: string }
  | { type: "export_session" }
  | { type: "import_session"; data: string }
  // Scratchpad & derived state requests
  | { type: "request_scratchpad" }
  | { type: "request_derived" }
  // Fork
  | { type: "fork_from_snapshot"; eventId: number }
  | { type: "ping" };

// ============================================================================
// Connection State
// ============================================================================

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";
