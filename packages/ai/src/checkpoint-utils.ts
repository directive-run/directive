import type {
  CheckpointDiff,
  CheckpointProgress,
  GoalCheckpointState,
  PatternCheckpointState,
} from "./types.js";

// ============================================================================
// Checkpoint Utility Functions
// ============================================================================

/**
 * Get the current step/round/iteration count from a pattern checkpoint state.
 *
 * Maps each pattern type to its natural progress counter: `step` for sequential
 * and goal, `round` for supervisor and debate, `iteration` for reflect, and
 * `completedCount` for DAG.
 *
 * @param state - The pattern checkpoint state to inspect.
 * @returns The current progress count for the pattern.
 */
export function getPatternStep(state: PatternCheckpointState): number {
  switch (state.type) {
    case "sequential":
      return state.step;
    case "supervisor":
      return state.round;
    case "reflect":
      return state.iteration;
    case "debate":
      return state.round;
    case "dag":
      return state.completedCount;
    case "goal":
      return state.step;
  }
}

/**
 * Compute progress metrics from a pattern checkpoint state.
 *
 * Returns percentage complete, steps completed/remaining, tokens consumed,
 * and estimated tokens remaining (when computable). Each pattern type
 * calculates these metrics from its own state structure.
 *
 * @param state - The pattern checkpoint state to analyze.
 * @returns A {@link CheckpointProgress} object with completion metrics.
 */
export function getCheckpointProgress(
  state: PatternCheckpointState,
): CheckpointProgress {
  const stepsCompleted = getPatternStep(state);
  const stepsTotal = state.stepsTotal ?? null;

  switch (state.type) {
    case "sequential": {
      const tokensConsumed = state.results.reduce(
        (sum, r) => sum + r.totalTokens,
        0,
      );
      const avgTokens =
        state.results.length > 0 ? tokensConsumed / state.results.length : 0;
      const remaining = stepsTotal != null ? stepsTotal - stepsCompleted : null;

      return {
        percentage:
          stepsTotal != null && stepsTotal > 0
            ? Math.round((stepsCompleted / stepsTotal) * 100)
            : 0,
        stepsCompleted,
        stepsTotal,
        tokensConsumed,
        estimatedTokensRemaining:
          avgTokens > 0 && remaining != null
            ? Math.round(avgTokens * remaining)
            : null,
        estimatedStepsRemaining: remaining,
      };
    }

    case "supervisor": {
      const tokensConsumed = state.workerResults.reduce(
        (sum, r) => sum + r.totalTokens,
        0,
      );
      const remaining = stepsTotal != null ? stepsTotal - stepsCompleted : null;

      return {
        percentage:
          stepsTotal != null && stepsTotal > 0
            ? Math.round((stepsCompleted / stepsTotal) * 100)
            : 0,
        stepsCompleted,
        stepsTotal,
        tokensConsumed,
        estimatedTokensRemaining: null,
        estimatedStepsRemaining: remaining,
      };
    }

    case "reflect": {
      const tokensConsumed = state.history.reduce(
        (sum, h) => sum + h.producerTokens + h.evaluatorTokens,
        0,
      );
      const remaining = stepsTotal != null ? stepsTotal - stepsCompleted : null;

      return {
        percentage:
          stepsTotal != null && stepsTotal > 0
            ? Math.round((stepsCompleted / stepsTotal) * 100)
            : 0,
        stepsCompleted,
        stepsTotal,
        tokensConsumed,
        estimatedTokensRemaining: null,
        estimatedStepsRemaining: remaining,
      };
    }

    case "debate": {
      const tokensConsumed = state.tokensConsumed;
      const remaining = stepsTotal != null ? stepsTotal - stepsCompleted : null;

      return {
        percentage:
          stepsTotal != null && stepsTotal > 0
            ? Math.round((stepsCompleted / stepsTotal) * 100)
            : 0,
        stepsCompleted,
        stepsTotal,
        tokensConsumed,
        estimatedTokensRemaining: null,
        estimatedStepsRemaining: remaining,
      };
    }

    case "dag": {
      const total = stepsTotal ?? Object.keys(state.statuses).length;
      const completed = state.completedCount;
      const tokensConsumed = Object.values(state.nodeResults).reduce(
        (sum, r) => sum + r.totalTokens,
        0,
      );
      const avgTokens = completed > 0 ? tokensConsumed / completed : 0;
      const remaining = total - completed;

      return {
        percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
        stepsCompleted: completed,
        stepsTotal: total,
        tokensConsumed,
        estimatedTokensRemaining:
          remaining > 0 ? Math.round(avgTokens * remaining) : 0,
        estimatedStepsRemaining: remaining,
      };
    }

    case "goal": {
      const tokensConsumed = Object.values(state.nodeOutputs).reduce(
        (sum, r) => sum + r.totalTokens,
        0,
      );
      const satisfaction = state.lastSatisfaction;

      return {
        percentage: Math.round(satisfaction * 100),
        stepsCompleted,
        stepsTotal: stepsTotal ?? null,
        tokensConsumed,
        estimatedTokensRemaining: null,
        estimatedStepsRemaining:
          state.stepMetrics.length > 0 ? estimateGoalSteps(state) : null,
      };
    }
  }
}

function estimateGoalSteps(state: GoalCheckpointState): number | null {
  const metrics = state.stepMetrics;
  if (metrics.length < 2) {
    return null;
  }

  const remaining = 1.0 - state.lastSatisfaction;
  if (remaining <= 0) {
    return 0;
  }

  // Average satisfaction delta
  const totalDelta = metrics.reduce(
    (sum, m) => sum + Math.max(0, m.satisfactionDelta),
    0,
  );
  const avgDelta = totalDelta / metrics.length;
  if (avgDelta <= 0) {
    return null;
  }

  return Math.ceil(remaining / avgDelta);
}

/**
 * Compute the diff between two checkpoint states of the same pattern type.
 *
 * Returns the delta in steps, tokens, and time between checkpoints.
 * Useful for understanding how much progress occurred between saves.
 *
 * @param a - The earlier checkpoint state.
 * @param b - The later checkpoint state.
 * @returns A {@link CheckpointDiff} with step, token, and time deltas.
 * @throws If the two checkpoints have different pattern types.
 */
export function diffCheckpoints(
  a: PatternCheckpointState,
  b: PatternCheckpointState,
): CheckpointDiff {
  if (a.type !== b.type) {
    throw new Error(
      `[Directive Checkpoint] Cannot diff different pattern types: ${a.type} vs ${b.type}`,
    );
  }

  const getTokens = (s: PatternCheckpointState): number => {
    switch (s.type) {
      case "sequential":
        return s.results.reduce((sum, r) => sum + r.totalTokens, 0);
      case "supervisor":
        return s.workerResults.reduce((sum, r) => sum + r.totalTokens, 0);
      case "reflect":
        return s.history.reduce(
          (sum, h) => sum + h.producerTokens + h.evaluatorTokens,
          0,
        );
      case "debate":
        return s.tokensConsumed;
      case "dag":
        return Object.values(s.nodeResults).reduce(
          (sum, r) => sum + r.totalTokens,
          0,
        );
      case "goal":
        return Object.values(s.nodeOutputs).reduce(
          (sum, r) => sum + r.totalTokens,
          0,
        );
    }
  };

  const diff: CheckpointDiff = {
    patternType: a.type,
    stepDelta: getPatternStep(b) - getPatternStep(a),
    tokensDelta: getTokens(b) - getTokens(a),
  };

  // Add facts diff for goal pattern
  if (a.type === "goal" && b.type === "goal") {
    const aKeys = new Set(Object.keys(a.facts));
    const bKeys = new Set(Object.keys(b.facts));
    const added: string[] = [];
    const removed: string[] = [];
    const changed: Array<{ key: string; before: unknown; after: unknown }> = [];

    for (const key of bKeys) {
      if (!aKeys.has(key)) {
        added.push(key);
      } else if (
        JSON.stringify(a.facts[key]) !== JSON.stringify(b.facts[key])
      ) {
        changed.push({ key, before: a.facts[key], after: b.facts[key] });
      }
    }
    for (const key of aKeys) {
      if (!bKeys.has(key)) {
        removed.push(key);
      }
    }

    diff.facts = { added, removed, changed };
  }

  // Add nodes completed for DAG/goal
  if (a.type === "dag" && b.type === "dag") {
    const aCompleted = new Set(
      Object.entries(a.statuses)
        .filter(([, s]) => s === "completed")
        .map(([id]) => id),
    );
    diff.nodesCompleted = Object.entries(b.statuses)
      .filter(([id, s]) => s === "completed" && !aCompleted.has(id))
      .map(([id]) => id);
  }

  if (a.type === "goal" && b.type === "goal") {
    const aCompleted = new Set(a.completedNodes);
    diff.nodesCompleted = b.completedNodes.filter((id) => !aCompleted.has(id));
  }

  return diff;
}
