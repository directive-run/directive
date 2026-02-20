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
export type HealthCircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

/** Per-agent health metrics */
export interface AgentHealthMetrics {
  agentId: string;
  circuitState: HealthCircuitState;
  successRate: number;
  avgLatencyMs: number;
  recentFailures: number;
  recentSuccesses: number;
  healthScore: number;
  /** Last N error messages (most recent last) */
  lastErrors: string[];
}

/** Internal event record */
interface HealthEvent {
  success: boolean;
  latencyMs: number;
  timestamp: number;
  errorMessage?: string;
}

/** Health monitor instance */
export interface HealthMonitor {
  recordSuccess(agentId: string, latencyMs: number): void;
  recordFailure(agentId: string, latencyMs: number, error?: Error): void;
  getMetrics(agentId: string): AgentHealthMetrics;
  getAllMetrics(): Record<string, AgentHealthMetrics>;
  /** Returns a 0-100 health score. Returns 50 (neutral) when no data is available for the agent. */
  getHealthScore(agentId: string): number;
  updateCircuitState(agentId: string, state: HealthCircuitState): void;
  /** Reset all metrics. Useful for testing. */
  reset(): void;
}

// ============================================================================
// Implementation
// ============================================================================

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_NORMAL_LATENCY_MS = 5_000;
const DEFAULT_MAX_EVENTS_PER_AGENT = 1_000;
const DEFAULT_MAX_STORED_ERRORS = 5;
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
  const maxEventsPerAgent = config.maxEventsPerAgent ?? DEFAULT_MAX_EVENTS_PER_AGENT;
  const weights = {
    successRate: config.weights?.successRate ?? DEFAULT_WEIGHTS.successRate,
    latency: config.weights?.latency ?? DEFAULT_WEIGHTS.latency,
    circuitState: config.weights?.circuitState ?? DEFAULT_WEIGHTS.circuitState,
  };

  // Validate config
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("[Directive HealthMonitor] windowMs must be a positive number");
  }
  if (!Number.isFinite(maxNormalLatencyMs) || maxNormalLatencyMs <= 0) {
    throw new Error("[Directive HealthMonitor] maxNormalLatencyMs must be a positive number");
  }
  if (!Number.isFinite(maxEventsPerAgent) || maxEventsPerAgent < 1) {
    throw new Error("[Directive HealthMonitor] maxEventsPerAgent must be >= 1");
  }

  // Validate weights sum approximately to 1.0
  const weightSum = weights.successRate + weights.latency + weights.circuitState;
  if (Math.abs(weightSum - 1.0) > 0.01) {
    throw new Error(`[Directive HealthMonitor] weights must sum to ~1.0 (tolerance: ±0.01, got ${weightSum.toFixed(4)})`);
  }

  const events = new Map<string, HealthEvent[]>();
  const circuitStates = new Map<string, HealthCircuitState>();

  function getAgentEvents(agentId: string): HealthEvent[] {
    let agentEvents = events.get(agentId);
    if (!agentEvents) {
      agentEvents = [];
      events.set(agentId, agentEvents);
    }

    return agentEvents;
  }

  function pruneAndCap(agentEvents: HealthEvent[], now: number): void {
    // Time-based pruning: find first event within the window
    const cutoff = now - windowMs;
    let firstValid = 0;
    while (firstValid < agentEvents.length && agentEvents[firstValid]!.timestamp < cutoff) {
      firstValid++;
    }

    // Cap-based pruning: ensure we don't exceed maxEventsPerAgent
    const excessFromCap = (agentEvents.length - firstValid) - maxEventsPerAgent;
    if (excessFromCap > 0) {
      firstValid += excessFromCap;
    }

    // Batch remove all expired/excess events in one operation
    if (firstValid > 0) {
      agentEvents.splice(0, firstValid);
    }
  }

  function computeScore(agentId: string): number {
    const agentEvents = events.get(agentId);
    if (!agentEvents || agentEvents.length === 0) {
      return 50; // No data = neutral
    }

    const now = Date.now();
    pruneAndCap(agentEvents, now);

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
    pruneAndCap(agentEvents, now);

    const successes = agentEvents.filter((e) => e.success).length;
    const failures = agentEvents.length - successes;
    const successRate = agentEvents.length > 0 ? successes / agentEvents.length : 0;
    const avgLatencyMs = agentEvents.length > 0
      ? agentEvents.reduce((s, e) => s + e.latencyMs, 0) / agentEvents.length
      : 0;

    // Collect last N error messages
    const lastErrors: string[] = [];
    for (let i = agentEvents.length - 1; i >= 0 && lastErrors.length < DEFAULT_MAX_STORED_ERRORS; i--) {
      if (agentEvents[i]!.errorMessage) {
        lastErrors.unshift(agentEvents[i]!.errorMessage!);
      }
    }

    return {
      agentId,
      circuitState: circuitStates.get(agentId) ?? "CLOSED",
      successRate,
      avgLatencyMs,
      recentFailures: failures,
      recentSuccesses: successes,
      healthScore: computeScore(agentId),
      lastErrors,
    };
  }

  return {
    recordSuccess(agentId: string, latencyMs: number): void {
      const agentEvents = getAgentEvents(agentId);
      agentEvents.push({ success: true, latencyMs, timestamp: Date.now() });
    },

    recordFailure(agentId: string, latencyMs: number, error?: Error): void {
      const agentEvents = getAgentEvents(agentId);
      agentEvents.push({
        success: false,
        latencyMs,
        timestamp: Date.now(),
        errorMessage: error?.message,
      });
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

    updateCircuitState(agentId: string, state: HealthCircuitState): void {
      circuitStates.set(agentId, state);
    },

    reset(): void {
      events.clear();
      circuitStates.clear();
    },
  };
}
