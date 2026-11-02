/**
 * Copied from 1.35 (packages/core/src/plugins/performance.ts): its type declarations only,
 * unchanged. Types, no runtime code.
 */

/** Metrics for a single constraint */
export interface ConstraintMetrics {
  evaluations: number;
  totalDurationMs: number;
  avgDurationMs: number;
  maxDurationMs: number;
  lastEvaluatedAt: number;
}

/** Metrics for a single resolver */
export interface ResolverMetrics {
  starts: number;
  completions: number;
  errors: number;
  retries: number;
  cancellations: number;
  totalDurationMs: number;
  avgDurationMs: number;
  maxDurationMs: number;
  lastCompletedAt: number;
}

/** Metrics for the reconciliation loop */
export interface ReconcileMetrics {
  runs: number;
  totalDurationMs: number;
  avgDurationMs: number;
  maxDurationMs: number;
}

/** Metrics for effects */
export interface EffectMetrics {
  runs: number;
  errors: number;
  lastRunAt: number;
}

/** Full performance snapshot */
export interface PerformanceSnapshot {
  constraints: Record<string, ConstraintMetrics>;
  resolvers: Record<string, ResolverMetrics>;
  effects: Record<string, EffectMetrics>;
  reconcile: ReconcileMetrics;
  uptime: number;
}

/** Options for the performance plugin */
export interface PerformancePluginOptions {
  /** Callback when a slow constraint is detected (default threshold: 16ms) */
  onSlowConstraint?: (id: string, durationMs: number) => void;
  /** Callback when a slow resolver is detected (default threshold: 1000ms) */
  onSlowResolver?: (id: string, durationMs: number) => void;
  /** Threshold in ms for slow constraint warning (default: 16) */
  slowConstraintThresholdMs?: number;
  /** Threshold in ms for slow resolver warning (default: 1000) */
  slowResolverThresholdMs?: number;
}
