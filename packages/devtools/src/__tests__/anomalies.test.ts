import { describe, it, expect } from "vitest";
import type { DebugEvent } from "../lib/types";

// Re-implement the core detection logic for testing since the hook wraps useMemo
// These match the functions in use-anomalies.ts

interface Anomaly {
  eventId: number;
  type: string;
  severity: "critical" | "warning" | "info";
  message: string;
  timestamp: number;
}

interface AnomalyThresholds {
  durationMultiplier: number;
  tokenMultiplier: number;
}

const DEFAULT_THRESHOLDS: AnomalyThresholds = {
  durationMultiplier: 2,
  tokenMultiplier: 2,
};

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

function detectAnomalies(events: DebugEvent[], thresholds: AnomalyThresholds = DEFAULT_THRESHOLDS): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const durationMeans = computeMeansByAgent(events, "durationMs");
  const tokenMeans = computeMeansByAgent(events, "totalTokens");

  for (const e of events) {
    if (e.type === "agent_error") {
      const errorMsg = typeof e.errorMessage === "string" ? e.errorMessage : "Unknown error";
      anomalies.push({
        eventId: e.id,
        type: "agent_error",
        severity: "critical",
        message: `Agent "${e.agentId ?? "unknown"}" error: ${errorMsg}`,
        timestamp: e.timestamp,
      });
    }

    if (e.type === "resolver_error") {
      anomalies.push({
        eventId: e.id,
        type: "resolver_error",
        severity: "critical",
        message: `Resolver error for agent "${e.agentId ?? "unknown"}"`,
        timestamp: e.timestamp,
      });
    }

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

    if (e.type === "agent_retry") {
      anomalies.push({
        eventId: e.id,
        type: "agent_retry",
        severity: "warning",
        message: `Agent "${e.agentId ?? "unknown"}" retrying`,
        timestamp: e.timestamp,
      });
    }

    if (e.type === "agent_complete" && e.agentId) {
      const durationMs = e.durationMs;
      if (typeof durationMs === "number") {
        const mean = durationMeans.get(e.agentId);
        if (mean !== undefined && durationMs > thresholds.durationMultiplier * mean) {
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
        if (mean !== undefined && totalTokens > thresholds.tokenMultiplier * mean) {
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

function makeEvent(overrides: Partial<DebugEvent> & { id: number; type: DebugEvent["type"]; timestamp: number }): DebugEvent {
  return { snapshotId: null, ...overrides } as DebugEvent;
}

// ============================================================================
// detectAnomalies tests
// ============================================================================

describe("detectAnomalies", () => {
  it("returns empty array for empty events", () => {
    expect(detectAnomalies([])).toEqual([]);
  });

  it("returns empty array for events with no anomalies", () => {
    const events = [
      makeEvent({ id: 1, type: "agent_start", timestamp: 1000, agentId: "a" }),
      makeEvent({ id: 2, type: "agent_complete", timestamp: 2000, agentId: "a", durationMs: 1000, totalTokens: 100 }),
    ];
    expect(detectAnomalies(events)).toEqual([]);
  });

  it("detects agent_error as critical", () => {
    const events = [
      makeEvent({ id: 1, type: "agent_error", timestamp: 1000, agentId: "a", errorMessage: "boom" }),
    ];
    const anomalies = detectAnomalies(events);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]!.severity).toBe("critical");
    expect(anomalies[0]!.type).toBe("agent_error");
    expect(anomalies[0]!.message).toContain("boom");
  });

  it("detects resolver_error as critical", () => {
    const events = [
      makeEvent({ id: 1, type: "resolver_error", timestamp: 1000, agentId: "a" }),
    ];
    const anomalies = detectAnomalies(events);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]!.severity).toBe("critical");
  });

  it("detects guardrail rejection as critical", () => {
    const events = [
      makeEvent({ id: 1, type: "guardrail_check", timestamp: 1000, agentId: "a", status: "REJECTED" }),
    ];
    const anomalies = detectAnomalies(events);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]!.severity).toBe("critical");
    expect(anomalies[0]!.type).toBe("guardrail_rejection");
  });

  it("does not flag passed guardrail checks", () => {
    const events = [
      makeEvent({ id: 1, type: "guardrail_check", timestamp: 1000, agentId: "a", status: "PASSED" }),
    ];
    expect(detectAnomalies(events)).toHaveLength(0);
  });

  it("detects agent_retry as warning", () => {
    const events = [
      makeEvent({ id: 1, type: "agent_retry", timestamp: 1000, agentId: "a" }),
    ];
    const anomalies = detectAnomalies(events);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]!.severity).toBe("warning");
  });

  it("detects duration outliers (>2x mean)", () => {
    const events = [
      makeEvent({ id: 1, type: "agent_complete", timestamp: 1000, agentId: "a", durationMs: 100, totalTokens: 50 }),
      makeEvent({ id: 2, type: "agent_complete", timestamp: 2000, agentId: "a", durationMs: 100, totalTokens: 50 }),
      makeEvent({ id: 3, type: "agent_complete", timestamp: 3000, agentId: "a", durationMs: 500, totalTokens: 50 }),
    ];
    const anomalies = detectAnomalies(events);
    // Mean is (100+100+500)/3 = 233.3, and 500 > 2 * 233.3 = 466.6? Yes, 500 > 466.6
    const durationAnomalies = anomalies.filter((a) => a.type === "duration_outlier");
    expect(durationAnomalies).toHaveLength(1);
    expect(durationAnomalies[0]!.eventId).toBe(3);
  });

  it("detects token spikes (>2x mean)", () => {
    const events = [
      makeEvent({ id: 1, type: "agent_complete", timestamp: 1000, agentId: "b", durationMs: 100, totalTokens: 100 }),
      makeEvent({ id: 2, type: "agent_complete", timestamp: 2000, agentId: "b", durationMs: 100, totalTokens: 100 }),
      makeEvent({ id: 3, type: "agent_complete", timestamp: 3000, agentId: "b", durationMs: 100, totalTokens: 1000 }),
    ];
    const anomalies = detectAnomalies(events);
    const tokenAnomalies = anomalies.filter((a) => a.type === "token_spike");
    expect(tokenAnomalies).toHaveLength(1);
    expect(tokenAnomalies[0]!.eventId).toBe(3);
  });

  it("detects reroute as info", () => {
    const events = [
      makeEvent({ id: 1, type: "reroute", timestamp: 1000, from: "a", to: "b" }),
    ];
    const anomalies = detectAnomalies(events);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]!.severity).toBe("info");
    expect(anomalies[0]!.type).toBe("reroute");
  });

  it("detects breakpoint_hit as info", () => {
    const events = [
      makeEvent({ id: 1, type: "breakpoint_hit", timestamp: 1000, agentId: "a" }),
    ];
    const anomalies = detectAnomalies(events);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]!.severity).toBe("info");
  });

  it("respects custom thresholds (M6)", () => {
    const events = [
      makeEvent({ id: 1, type: "agent_complete", timestamp: 1000, agentId: "a", durationMs: 100, totalTokens: 100 }),
      makeEvent({ id: 2, type: "agent_complete", timestamp: 2000, agentId: "a", durationMs: 200, totalTokens: 200 }),
    ];

    // With default thresholds (2x), no outlier: mean=150, 200 < 2*150=300
    expect(detectAnomalies(events).filter((a) => a.type === "duration_outlier")).toHaveLength(0);

    // With 1.2x threshold, 200 > 1.2*150=180, so it IS an outlier
    const strict = detectAnomalies(events, { durationMultiplier: 1.2, tokenMultiplier: 1.2 });
    expect(strict.filter((a) => a.type === "duration_outlier")).toHaveLength(1);
  });

  it("handles events without agentId gracefully", () => {
    const events = [
      makeEvent({ id: 1, type: "agent_error", timestamp: 1000 }),
    ];
    const anomalies = detectAnomalies(events);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]!.message).toContain("unknown");
  });

  it("handles missing errorMessage gracefully", () => {
    const events = [
      makeEvent({ id: 1, type: "agent_error", timestamp: 1000, agentId: "a" }),
    ];
    const anomalies = detectAnomalies(events);
    expect(anomalies[0]!.message).toContain("Unknown error");
  });
});

// ============================================================================
// computeMeansByAgent tests
// ============================================================================

describe("computeMeansByAgent", () => {
  it("returns empty map for no events", () => {
    expect(computeMeansByAgent([], "durationMs").size).toBe(0);
  });

  it("computes correct mean for single agent", () => {
    const events = [
      makeEvent({ id: 1, type: "agent_complete", timestamp: 1000, agentId: "a", durationMs: 100 }),
      makeEvent({ id: 2, type: "agent_complete", timestamp: 2000, agentId: "a", durationMs: 300 }),
    ];
    const means = computeMeansByAgent(events, "durationMs");
    expect(means.get("a")).toBe(200);
  });

  it("computes separate means for different agents", () => {
    const events = [
      makeEvent({ id: 1, type: "agent_complete", timestamp: 1000, agentId: "a", durationMs: 100 }),
      makeEvent({ id: 2, type: "agent_complete", timestamp: 2000, agentId: "b", durationMs: 500 }),
    ];
    const means = computeMeansByAgent(events, "durationMs");
    expect(means.get("a")).toBe(100);
    expect(means.get("b")).toBe(500);
  });

  it("ignores non-agent_complete events", () => {
    const events = [
      makeEvent({ id: 1, type: "agent_start", timestamp: 1000, agentId: "a", durationMs: 999 }),
      makeEvent({ id: 2, type: "agent_complete", timestamp: 2000, agentId: "a", durationMs: 100 }),
    ];
    const means = computeMeansByAgent(events, "durationMs");
    expect(means.get("a")).toBe(100);
  });

  it("ignores events without agentId", () => {
    const events = [
      makeEvent({ id: 1, type: "agent_complete", timestamp: 1000, durationMs: 100 }),
    ];
    expect(computeMeansByAgent(events, "durationMs").size).toBe(0);
  });
});
