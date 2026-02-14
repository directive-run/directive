/**
 * Performance Plugin - Track constraint, resolver, and reconciliation metrics
 *
 * Uses existing plugin hooks to measure performance without modifying core runtime.
 */

import type { Plugin, ModuleSchema } from "../core/types.js";

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

/**
 * Create a performance monitoring plugin.
 *
 * Tracks constraint evaluation time, resolver latency, reconciliation cost,
 * and effect runs using existing plugin hooks.
 *
 * @example
 * ```typescript
 * const perf = performancePlugin({
 *   onSlowResolver: (id, ms) => console.warn(`Slow resolver ${id}: ${ms}ms`),
 * });
 *
 * const system = createSystem({
 *   module: myModule,
 *   plugins: [perf],
 * });
 *
 * // Later: get a performance snapshot
 * const snapshot = perf.getSnapshot();
 * console.log(snapshot.resolvers);
 * ```
 */
export function performancePlugin<M extends ModuleSchema = ModuleSchema>(
	options: PerformancePluginOptions = {},
): Plugin<M> & { getSnapshot(): PerformanceSnapshot; reset(): void } {
	const {
		onSlowConstraint,
		onSlowResolver,
		slowConstraintThresholdMs = 16,
		slowResolverThresholdMs = 1000,
	} = options;

	const constraints = new Map<string, ConstraintMetrics>();
	const resolvers = new Map<string, ResolverMetrics>();
	const effects = new Map<string, EffectMetrics>();
	const reconcile: ReconcileMetrics = { runs: 0, totalDurationMs: 0, avgDurationMs: 0, maxDurationMs: 0 };

	let startedAt = 0;
	let reconcileStartTime = 0;

	// Track constraint evaluation timing within a reconcile cycle.
	// Since constraints are evaluated sequentially, the time between consecutive
	// onConstraintEvaluate calls approximates each constraint's evaluation time.
	// The first constraint in each cycle cannot be timed (no baseline), so only
	// subsequent constraints get duration metrics.
	let lastConstraintEvalEndTime = 0;

	function getConstraintMetrics(id: string): ConstraintMetrics {
		let m = constraints.get(id);
		if (!m) {
			m = { evaluations: 0, totalDurationMs: 0, avgDurationMs: 0, maxDurationMs: 0, lastEvaluatedAt: 0 };
			constraints.set(id, m);
		}
		return m;
	}

	function getResolverMetrics(id: string): ResolverMetrics {
		let m = resolvers.get(id);
		if (!m) {
			m = { starts: 0, completions: 0, errors: 0, retries: 0, cancellations: 0, totalDurationMs: 0, avgDurationMs: 0, maxDurationMs: 0, lastCompletedAt: 0 };
			resolvers.set(id, m);
		}
		return m;
	}

	function getEffectMetrics(id: string): EffectMetrics {
		let m = effects.get(id);
		if (!m) {
			m = { runs: 0, errors: 0, lastRunAt: 0 };
			effects.set(id, m);
		}
		return m;
	}

	const plugin: Plugin<M> & { getSnapshot(): PerformanceSnapshot; reset(): void } = {
		name: "performance",

		onStart() {
			startedAt = Date.now();
		},

		onConstraintEvaluate(id, _active) {
			const now = performance.now();
			const m = getConstraintMetrics(id);
			m.evaluations++;
			m.lastEvaluatedAt = Date.now();

			// Constraints evaluate sequentially within a reconcile cycle.
			// Measure duration as time since the previous constraint finished evaluating
			// (or since reconcileStart for the first constraint in the cycle).
			// The first constraint per cycle has no baseline and is not timed.
			if (lastConstraintEvalEndTime > 0) {
				const duration = now - lastConstraintEvalEndTime;
				m.totalDurationMs += duration;
				const timedEvals = m.evaluations; // approximation — some evals may be untimed
				m.avgDurationMs = m.totalDurationMs / timedEvals;
				if (duration > m.maxDurationMs) m.maxDurationMs = duration;
				if (duration > slowConstraintThresholdMs) {
					onSlowConstraint?.(id, duration);
				}
			}
			lastConstraintEvalEndTime = now;
		},

		onResolverStart(resolver, _req) {
			const m = getResolverMetrics(resolver);
			m.starts++;
		},

		onResolverComplete(resolver, _req, duration) {
			const m = getResolverMetrics(resolver);
			m.completions++;
			m.totalDurationMs += duration;
			m.avgDurationMs = m.totalDurationMs / m.completions;
			if (duration > m.maxDurationMs) m.maxDurationMs = duration;
			m.lastCompletedAt = Date.now();
			if (duration > slowResolverThresholdMs) {
				onSlowResolver?.(resolver, duration);
			}
		},

		onResolverError(resolver, _req, _error) {
			getResolverMetrics(resolver).errors++;
		},

		onResolverRetry(resolver, _req, _attempt) {
			getResolverMetrics(resolver).retries++;
		},

		onResolverCancel(resolver, _req) {
			getResolverMetrics(resolver).cancellations++;
		},

		onEffectRun(id) {
			const m = getEffectMetrics(id);
			m.runs++;
			m.lastRunAt = Date.now();
		},

		onEffectError(id, _error) {
			getEffectMetrics(id).errors++;
		},

		onReconcileStart() {
			reconcileStartTime = performance.now();
			// Reset constraint timing baseline — first constraint in this cycle won't be timed
			lastConstraintEvalEndTime = 0;
		},

		onReconcileEnd() {
			const duration = performance.now() - reconcileStartTime;
			reconcile.runs++;
			reconcile.totalDurationMs += duration;
			reconcile.avgDurationMs = reconcile.totalDurationMs / reconcile.runs;
			if (duration > reconcile.maxDurationMs) reconcile.maxDurationMs = duration;
		},

		getSnapshot(): PerformanceSnapshot {
			const constraintsObj: Record<string, ConstraintMetrics> = {};
			for (const [id, m] of constraints) constraintsObj[id] = { ...m };

			const resolversObj: Record<string, ResolverMetrics> = {};
			for (const [id, m] of resolvers) resolversObj[id] = { ...m };

			const effectsObj: Record<string, EffectMetrics> = {};
			for (const [id, m] of effects) effectsObj[id] = { ...m };

			return {
				constraints: constraintsObj,
				resolvers: resolversObj,
				effects: effectsObj,
				reconcile: { ...reconcile },
				uptime: startedAt ? Date.now() - startedAt : 0,
			};
		},

		reset(): void {
			constraints.clear();
			resolvers.clear();
			effects.clear();
			reconcile.runs = 0;
			reconcile.totalDurationMs = 0;
			reconcile.avgDurationMs = 0;
			reconcile.maxDurationMs = 0;
			lastConstraintEvalEndTime = 0;
		},
	};

	return plugin;
}
