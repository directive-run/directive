// ============================================================================
// Multi-Agent Orchestrator Utilities
// ============================================================================
//
// Extracted from multi-agent-orchestrator.ts — pure utility functions and
// classes that are independent of the orchestrator instance.
// ============================================================================

import type {
  CheckpointDiff,
  CheckpointProgress,
  DagNode,
  GoalCheckpointState,
  PatternCheckpointState,
} from "./types.js";
import type { CheckpointStore } from "./checkpoint.js";
import type {
  MultiAgentOrchestrator,
  MultiAgentOrchestratorOptions,
} from "./orchestrator-types.js";

// ============================================================================
// Shallow Equality
// ============================================================================

/** Shallow structural equality for change detection (plain objects, arrays, and primitives) */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }

  if (typeof a !== typeof b || a === null || b === null) {
    return false;
  }

  if (typeof a !== "object") {
    return false;
  }

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== (b as unknown[]).length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== (b as unknown[])[i]) {
        return false;
      }
    }

    return true;
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if (aObj[key] !== bObj[key]) {
      return false;
    }
  }

  return true;
}

// ============================================================================
// Async Semaphore
// ============================================================================

/**
 * Async semaphore for controlling concurrent access.
 * Uses a queue-based approach instead of polling for efficiency.
 *
 * @example
 * ```typescript
 * import { Semaphore } from '@directive-run/ai';
 *
 * const sem = new Semaphore(3); // Allow 3 concurrent operations
 *
 * async function doWork() {
 *   const release = await sem.acquire();
 *   try {
 *     await performWork();
 *   } finally {
 *     release();
 *   }
 * }
 * ```
 */
export class Semaphore {
  private count: number;
  private readonly maxPermits: number;
  private readonly queue: Array<{
    resolve: (release: () => void) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(max: number) {
    if (max < 1 || !Number.isFinite(max)) {
      throw new Error(
        `[Directive Semaphore] Invalid max permits: ${max}. Must be a finite number >= 1.`,
      );
    }
    this.maxPermits = max;
    this.count = max;
  }

  /** Create a one-shot release function that guards against double-release */
  private createReleaseFn(): () => void {
    let released = false;

    return () => {
      if (released) {
        return;
      }
      released = true;
      this.release();
    };
  }

  /** Acquire a permit, optionally with abort signal support */
  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      throw new Error("[Directive Semaphore] Aborted before acquiring permit");
    }
    if (this.count > 0) {
      this.count--;

      return this.createReleaseFn();
    }

    return new Promise<() => void>((resolve, reject) => {
      let onAbort: (() => void) | undefined;

      const entry = {
        resolve: (releaseFn: () => void) => {
          if (onAbort && signal) {
            signal.removeEventListener("abort", onAbort);
          }
          resolve(releaseFn);
        },
        reject,
      };
      this.queue.push(entry);

      if (signal) {
        onAbort = () => {
          const idx = this.queue.indexOf(entry);
          if (idx >= 0) {
            this.queue.splice(idx, 1);
            reject(
              new Error(
                "[Directive Semaphore] Aborted while waiting for permit",
              ),
            );
          }
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  /** Non-blocking acquire — returns null if no permits available */
  tryAcquire(): (() => void) | null {
    if (this.count > 0) {
      this.count--;

      return this.createReleaseFn();
    }

    return null;
  }

  private release(): void {
    this.count++;
    const next = this.queue.shift();
    if (next) {
      this.count--;
      next.resolve(this.createReleaseFn());
    }
  }

  /** Get current available permits */
  get available(): number {
    return this.count;
  }

  /** Get number of waiters in queue */
  get waiting(): number {
    return this.queue.length;
  }

  /** Get maximum permits */
  get max(): number {
    return this.maxPermits;
  }

  /** Reject all pending waiters with an error and reset permits */
  drain(): void {
    const err = new Error(
      "[Directive Semaphore] Semaphore drained - all pending acquisitions rejected",
    );
    const pending = this.queue.splice(0, this.queue.length);
    for (const waiter of pending) {
      waiter.reject(err);
    }
    this.count = this.maxPermits;
  }
}

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

/**
 * Fork an orchestrator from a checkpoint — creates a new independent orchestrator
 * restored to the checkpoint's state, ready to diverge from that point.
 *
 * @param options - The original orchestrator options used to create the orchestrator
 * @param checkpointStore - The checkpoint store containing the checkpoint
 * @param checkpointId - The ID of the checkpoint to fork from
 * @returns A new independent MultiAgentOrchestrator restored to checkpoint state
 *
 * @example
 * ```typescript
 * const forked = await forkFromCheckpoint(orchestratorOptions, store, "ckpt_abc123");
 * const result = await forked.replay("ckpt_abc123", pattern, { input: "new input" });
 * ```
 */
export async function forkFromCheckpoint(
  options: MultiAgentOrchestratorOptions,
  checkpointStore: CheckpointStore,
  checkpointId: string,
): Promise<MultiAgentOrchestrator> {
  // Lazy import to avoid circular dependency — createMultiAgentOrchestrator
  // is defined in multi-agent-orchestrator.ts which imports from this file.
  const { createMultiAgentOrchestrator } = await import(
    "./multi-agent-orchestrator.js"
  );

  const checkpoint = await checkpointStore.load(checkpointId);
  if (!checkpoint) {
    throw new Error(
      `[Directive MultiAgent] Checkpoint not found: ${checkpointId}`,
    );
  }

  // Deep-clone the checkpoint so the forked orchestrator is fully independent
  const cloned = structuredClone(checkpoint);

  const forked = createMultiAgentOrchestrator({
    ...options,
    checkpointStore,
  });

  forked.restore(cloned);

  return forked;
}

// ============================================================================
// DAG Validation
// ============================================================================

/**
 * Validate that a DAG pattern has no cycles using Kahn's algorithm.
 *
 * Also validates that all dependency references point to existing nodes
 * and that at least one root node (no dependencies) exists.
 *
 * @param patternId - The pattern ID (for error messages).
 * @param nodes - The DAG node definitions.
 * @throws If a cycle is detected, a dependency is missing, or no root nodes exist.
 * @internal
 */
export function validateDagAcyclic(
  patternId: string,
  nodes: Record<string, DagNode>,
): void {
  const nodeIds = Object.keys(nodes);

  // Validate deps reference valid node IDs
  for (const [nodeId, node] of Object.entries(nodes)) {
    for (const depId of node.deps ?? []) {
      if (!nodes[depId]) {
        throw new Error(
          `[Directive MultiAgent] DAG pattern "${patternId}": node "${nodeId}" depends on unknown node "${depId}"`,
        );
      }
    }
  }

  // Ensure at least one root node
  const hasRoot = nodeIds.some((id) => {
    const deps = nodes[id]?.deps;

    return !deps || deps.length === 0;
  });
  if (!hasRoot) {
    throw new Error(
      `[Directive MultiAgent] DAG pattern "${patternId}": no root nodes (every node has dependencies)`,
    );
  }

  // Kahn's algorithm for cycle detection
  const inDegree: Record<string, number> = Object.create(null);
  const adjacency: Record<string, string[]> = Object.create(null);
  for (const id of nodeIds) {
    adjacency[id] = [];
  }
  for (const [nodeId, node] of Object.entries(nodes)) {
    inDegree[nodeId] = (node.deps ?? []).length;
    for (const depId of node.deps ?? []) {
      adjacency[depId]!.push(nodeId);
    }
  }

  const queue: string[] = [];
  for (const id of nodeIds) {
    if (inDegree[id] === 0) {
      queue.push(id);
    }
  }

  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    visited++;
    for (const dependent of adjacency[current] ?? []) {
      inDegree[dependent]!--;
      if (inDegree[dependent] === 0) {
        queue.push(dependent);
      }
    }
  }

  if (visited !== nodeIds.length) {
    throw new Error(
      `[Directive MultiAgent] DAG pattern "${patternId}": cycle detected. Visited ${visited}/${nodeIds.length} nodes.`,
    );
  }
}
