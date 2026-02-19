/**
 * Health Monitor — tracks per-agent health metrics for self-healing networks.
 *
 * Pure computation module with zero Directive dependency.
 * Maintains a rolling window of success/failure events and computes a health
 * score from 0-100 based on configurable weights.
 *
 * @module
 */

import type { HealthMonitorConfig } from "./types.js";

// ============================================================================
// Types
// ============================================================================

/** Circuit state values */
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

/** Per-agent health metrics */
export interface AgentHealthMetrics {
  agentId: string;
  circuitState: CircuitState;
  successRate: number;
  avgLatencyMs: number;
  recentFailures: number;
  recentSuccesses: number;
  healthScore: number;
}

/** Internal event record */
interface HealthEvent {
  success: boolean;
  latencyMs: number;
  timestamp: number;
}

/** Health monitor instance */
export interface HealthMonitor {
  recordSuccess(agentId: string, latencyMs: number): void;
  recordFailure(agentId: string, latencyMs: number, error: Error): void;
  getMetrics(agentId: string): AgentHealthMetrics;
  getAllMetrics(): Record<string, AgentHealthMetrics>;
  getHealthScore(agentId: string): number;
  updateCircuitState(agentId: string, state: CircuitState): void;
}

// ============================================================================
// Implementation
// ============================================================================

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_NORMAL_LATENCY_MS = 5_000;
const DEFAULT_WEIGHTS = {
  successRate: 0.5,
  latency: 0.3,
  circuitState: 0.2,
};

/**
 * Create a health monitor that tracks per-agent metrics.
 *
 * @example
 * ```typescript
 * const monitor = createHealthMonitor({ windowMs: 30000 });
 *
 * monitor.recordSuccess("agent-a", 120);
 * monitor.recordFailure("agent-a", 5000, new Error("timeout"));
 *
 * const score = monitor.getHealthScore("agent-a");
 * console.log(score); // 0-100
 * ```
 */
export function createHealthMonitor(config: HealthMonitorConfig = {}): HealthMonitor {
  const windowMs = config.windowMs ?? DEFAULT_WINDOW_MS;
  const maxNormalLatencyMs = config.maxNormalLatencyMs ?? DEFAULT_MAX_NORMAL_LATENCY_MS;
  const weights = {
    successRate: config.weights?.successRate ?? DEFAULT_WEIGHTS.successRate,
    latency: config.weights?.latency ?? DEFAULT_WEIGHTS.latency,
    circuitState: config.weights?.circuitState ?? DEFAULT_WEIGHTS.circuitState,
  };

  const events = new Map<string, HealthEvent[]>();
  const circuitStates = new Map<string, CircuitState>();

  function getAgentEvents(agentId: string): HealthEvent[] {
    let agentEvents = events.get(agentId);
    if (!agentEvents) {
      agentEvents = [];
      events.set(agentId, agentEvents);
    }

    return agentEvents;
  }

  function pruneOld(agentEvents: HealthEvent[], now: number): void {
    const cutoff = now - windowMs;
    while (agentEvents.length > 0 && agentEvents[0]!.timestamp < cutoff) {
      agentEvents.shift();
    }
  }

  function computeScore(agentId: string): number {
    const agentEvents = events.get(agentId);
    if (!agentEvents || agentEvents.length === 0) {
      return 50; // No data = neutral
    }

    const now = Date.now();
    pruneOld(agentEvents, now);

    if (agentEvents.length === 0) {
      return 50;
    }

    const successes = agentEvents.filter((e) => e.success).length;
    const successRate = successes / agentEvents.length;

    const avgLatency = agentEvents.reduce((s, e) => s + e.latencyMs, 0) / agentEvents.length;
    const normalizedLatency = Math.min(avgLatency / maxNormalLatencyMs, 1);

    const state = circuitStates.get(agentId) ?? "CLOSED";
    const circuitScore = state === "CLOSED" ? 1 : state === "HALF_OPEN" ? 0.5 : 0;

    const raw =
      successRate * weights.successRate +
      (1 - normalizedLatency) * weights.latency +
      circuitScore * weights.circuitState;

    return Math.round(raw * 100);
  }

  function buildMetrics(agentId: string): AgentHealthMetrics {
    const agentEvents = getAgentEvents(agentId);
    const now = Date.now();
    pruneOld(agentEvents, now);

    const successes = agentEvents.filter((e) => e.success).length;
    const failures = agentEvents.length - successes;
    const successRate = agentEvents.length > 0 ? successes / agentEvents.length : 0;
    const avgLatencyMs = agentEvents.length > 0
      ? agentEvents.reduce((s, e) => s + e.latencyMs, 0) / agentEvents.length
      : 0;

    return {
      agentId,
      circuitState: circuitStates.get(agentId) ?? "CLOSED",
      successRate,
      avgLatencyMs,
      recentFailures: failures,
      recentSuccesses: successes,
      healthScore: computeScore(agentId),
    };
  }

  return {
    recordSuccess(agentId: string, latencyMs: number): void {
      const agentEvents = getAgentEvents(agentId);
      agentEvents.push({ success: true, latencyMs, timestamp: Date.now() });
    },

    recordFailure(agentId: string, latencyMs: number, _error: Error): void {
      const agentEvents = getAgentEvents(agentId);
      agentEvents.push({ success: false, latencyMs, timestamp: Date.now() });
    },

    getMetrics(agentId: string): AgentHealthMetrics {
      return buildMetrics(agentId);
    },

    getAllMetrics(): Record<string, AgentHealthMetrics> {
      const result: Record<string, AgentHealthMetrics> = Object.create(null);
      for (const agentId of events.keys()) {
        result[agentId] = buildMetrics(agentId);
      }

      return result;
    },

    getHealthScore(agentId: string): number {
      return computeScore(agentId);
    },

    updateCircuitState(agentId: string, state: CircuitState): void {
      circuitStates.set(agentId, state);
    },
  };
}
