import type { CircuitState, DagNodeStatus, DebugEventType } from "./types";

/** Color for each event type — used in timeline bars and filters */
export const EVENT_COLORS: Record<DebugEventType, string> = {
  agent_start: "#3b82f6", // blue
  agent_complete: "#22c55e", // green
  agent_error: "#ef4444", // red
  agent_retry: "#f59e0b", // amber
  guardrail_check: "#eab308", // yellow
  constraint_evaluate: "#6366f1", // indigo
  resolver_start: "#8b5cf6", // violet
  resolver_complete: "#a78bfa", // violet-light
  resolver_error: "#dc2626", // red-dark
  approval_request: "#f97316", // orange
  approval_response: "#fb923c", // orange-light
  handoff_start: "#06b6d4", // cyan
  handoff_complete: "#22d3ee", // cyan-light
  pattern_start: "#14b8a6", // teal
  pattern_complete: "#2dd4bf", // teal-light
  dag_node_update: "#0ea5e9", // sky
  breakpoint_hit: "#f43f5e", // rose
  breakpoint_resumed: "#10b981", // emerald
  derivation_update: "#a855f7", // purple
  scratchpad_update: "#d946ef", // fuchsia
  reflection_iteration: "#818cf8", // indigo-light
  race_start: "#38bdf8", // sky-light
  race_winner: "#4ade80", // green-light
  race_cancelled: "#fbbf24", // amber-light
  reroute: "#f472b6", // pink-400
  debate_round: "#c084fc", // purple-400
  checkpoint_save: "#94a3b8", // slate-400
  checkpoint_restore: "#cbd5e1", // slate-300
  task_start: "#2563eb", // blue-600
  task_complete: "#16a34a", // green-600
  task_error: "#b91c1c", // red-700
  task_progress: "#0284c7", // sky-600
  goal_step: "#7c3aed", // violet-600
};

/** Color for event type categories */
export function getEventCategory(type: DebugEventType): string {
  if (type.startsWith("agent_") || type === "reroute") {
    return "Agent";
  }
  if (
    type.startsWith("guardrail") ||
    type.startsWith("constraint") ||
    type.startsWith("resolver")
  ) {
    return "Engine";
  }
  if (type.startsWith("approval") || type.startsWith("breakpoint")) {
    return "Control";
  }
  if (
    type.startsWith("handoff") ||
    type.startsWith("pattern") ||
    type.startsWith("dag") ||
    type.startsWith("race_")
  ) {
    return "Orchestration";
  }
  if (
    type.startsWith("derivation") ||
    type.startsWith("scratchpad") ||
    type.startsWith("reflection") ||
    type === "debate_round"
  ) {
    return "State";
  }
  if (type.startsWith("checkpoint")) {
    return "Checkpoint";
  }
  if (type.startsWith("task_") || type === "goal_step") {
    return "Task";
  }

  return "Other";
}

/** CSS class for circuit state */
export const CIRCUIT_STATE_COLORS: Record<
  CircuitState,
  { bg: string; text: string; label: string }
> = {
  CLOSED: {
    bg: "bg-emerald-500/20",
    text: "text-emerald-400",
    label: "Healthy",
  },
  HALF_OPEN: {
    bg: "bg-amber-500/20",
    text: "text-amber-400",
    label: "Recovering",
  },
  OPEN: { bg: "bg-red-500/20", text: "text-red-400", label: "Open" },
};

/** Color for DAG node status */
export const DAG_NODE_COLORS: Record<DagNodeStatus, string> = {
  pending: "#71717a", // zinc-500
  ready: "#3b82f6", // blue
  running: "#f59e0b", // amber (animated)
  completed: "#22c55e", // green
  error: "#ef4444", // red
  skipped: "#a1a1aa", // zinc-400
};

// ============================================================================
// Query View Colors
// ============================================================================

/** CSS classes for query status badges */
export const QUERY_STATUS_COLORS: Record<string, string> = {
  success: "bg-emerald-500/20 text-emerald-400",
  pending: "bg-amber-500/20 text-amber-400",
  error: "bg-red-500/20 text-red-400",
  disabled: "bg-zinc-500/20 text-zinc-400",
  fetching: "bg-blue-500/20 text-blue-400",
};

/** Hex colors for query swim-lane labels */
export const QUERY_LANE_COLORS = [
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#f59e0b", // amber
  "#ec4899", // pink
  "#10b981", // emerald
  "#f97316", // orange
  "#6366f1", // indigo
] as const;

/** Hex colors for query fetch span bars */
export const QUERY_SPAN_COLORS: Record<string, string> = {
  success: "#22c55e", // green
  error: "#ef4444", // red
  pending: "#3b82f6", // blue
};
