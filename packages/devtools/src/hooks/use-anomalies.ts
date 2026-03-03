import { useMemo } from "react";
import type { DebugEvent } from "../lib/types";

export interface Anomaly {
  eventId: number;
  type: string;
  severity: "critical" | "warning" | "info";
  message: string;
  timestamp: number;
}

interface AnomalyResult {
  anomalies: Anomaly[];
  severityCounts: { critical: number; warning: number; info: number };
}

function computeMeansByAgent(
  events: DebugEvent[],
  field: string,
): Map<string, number> {
  const sums = new Map<string, number>();
  const counts = new Map<string, number>();

  for (const e of events) {
    if (e.type !== "agent_complete" || !e.agentId) {
      continue;
    }
    const value = e[field];
    if (typeof value !== "number") {
      continue;
    }
    const agent = e.agentId;
    sums.set(agent, (sums.get(agent) ?? 0) + value);
    counts.set(agent, (counts.get(agent) ?? 0) + 1);
  }

  const means = new Map<string, number>();
  for (const [agent, sum] of sums) {
    const count = counts.get(agent)!;
    means.set(agent, sum / count);
  }

  return means;
}

/** Configurable thresholds for anomaly detection */
export interface AnomalyThresholds {
  /** Multiplier above mean duration to flag as warning (default: 2) */
  durationMultiplier: number;
  /** Multiplier above mean tokens to flag as warning (default: 2) */
  tokenMultiplier: number;
}

const DEFAULT_THRESHOLDS: AnomalyThresholds = {
  durationMultiplier: 2,
  tokenMultiplier: 2,
};

function detectAnomalies(
  events: DebugEvent[],
  thresholds: AnomalyThresholds = DEFAULT_THRESHOLDS,
): Anomaly[] {
  const anomalies: Anomaly[] = [];

  const durationMeans = computeMeansByAgent(events, "durationMs");
  const tokenMeans = computeMeansByAgent(events, "totalTokens");

  for (const e of events) {
    // Critical: agent_error events
    if (e.type === "agent_error") {
      const errorMsg =
        typeof e.errorMessage === "string" ? e.errorMessage : "Unknown error";
      anomalies.push({
        eventId: e.id,
        type: "agent_error",
        severity: "critical",
        message: `Agent "${e.agentId ?? "unknown"}" error: ${errorMsg}`,
        timestamp: e.timestamp,
      });
    }

    // Critical: resolver_error events
    if (e.type === "resolver_error") {
      anomalies.push({
        eventId: e.id,
        type: "resolver_error",
        severity: "critical",
        message: `Resolver error for agent "${e.agentId ?? "unknown"}"`,
        timestamp: e.timestamp,
      });
    }

    // Critical: guardrail rejections
    if (e.type === "guardrail_check") {
      const status = e.status ?? e.result;
      if (status === "REJECTED") {
        anomalies.push({
          eventId: e.id,
          type: "guardrail_rejection",
          severity: "critical",
          message: `Guardrail rejected for agent "${e.agentId ?? "unknown"}"`,
          timestamp: e.timestamp,
        });
      }
    }

    // Warning: agent retries
    if (e.type === "agent_retry") {
      anomalies.push({
        eventId: e.id,
        type: "agent_retry",
        severity: "warning",
        message: `Agent "${e.agentId ?? "unknown"}" retrying`,
        timestamp: e.timestamp,
      });
    }

    // Warning: duration and token outliers for agent_complete
    if (e.type === "agent_complete" && e.agentId) {
      const durationMs = e.durationMs;
      if (typeof durationMs === "number") {
        const mean = durationMeans.get(e.agentId);
        if (
          mean !== undefined &&
          durationMs > thresholds.durationMultiplier * mean
        ) {
          anomalies.push({
            eventId: e.id,
            type: "duration_outlier",
            severity: "warning",
            message: `Agent "${e.agentId}" took ${durationMs}ms (mean: ${Math.round(mean)}ms)`,
            timestamp: e.timestamp,
          });
        }
      }

      const totalTokens = e.totalTokens;
      if (typeof totalTokens === "number") {
        const mean = tokenMeans.get(e.agentId);
        if (
          mean !== undefined &&
          totalTokens > thresholds.tokenMultiplier * mean
        ) {
          anomalies.push({
            eventId: e.id,
            type: "token_spike",
            severity: "warning",
            message: `Agent "${e.agentId}" used ${totalTokens} tokens (mean: ${Math.round(mean)})`,
            timestamp: e.timestamp,
          });
        }
      }
    }

    // Info: reroute events
    if (e.type === "reroute") {
      const from = typeof e.from === "string" ? e.from : "unknown";
      const to = typeof e.to === "string" ? e.to : "unknown";
      anomalies.push({
        eventId: e.id,
        type: "reroute",
        severity: "info",
        message: `Rerouted from "${from}" to "${to}"`,
        timestamp: e.timestamp,
      });
    }

    // Info: circuit breaker state changes
    if (e.type === "breakpoint_hit") {
      anomalies.push({
        eventId: e.id,
        type: "circuit_breaker",
        severity: "info",
        message: `Circuit breaker triggered for agent "${e.agentId ?? "unknown"}"`,
        timestamp: e.timestamp,
      });
    }
  }

  return anomalies;
}

function countSeverities(anomalies: Anomaly[]): {
  critical: number;
  warning: number;
  info: number;
} {
  const counts = { critical: 0, warning: 0, info: 0 };

  for (const a of anomalies) {
    counts[a.severity]++;
  }

  return counts;
}

export function useAnomalies(
  events: DebugEvent[],
  thresholds?: AnomalyThresholds,
): AnomalyResult {
  return useMemo(() => {
    const anomalies = detectAnomalies(events, thresholds);
    const severityCounts = countSeverities(anomalies);

    return { anomalies, severityCounts };
  }, [events, thresholds]);
}
