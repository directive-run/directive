/**
 * Multi-Agent Orchestration Patterns
 *
 * Provides patterns for coordinating multiple AI agents:
 * - Parallel execution with result merging
 * - Sequential pipelines
 * - Supervisor patterns with worker delegation
 * - Constraint-driven agent selection
 *
 * @example
 * ```typescript
 * import { createMultiAgentOrchestrator } from '@directive-run/ai';
 *
 * const orchestrator = createMultiAgentOrchestrator({
 *   agents: {
 *     researcher: { agent: researchAgent, maxConcurrent: 3 },
 *     writer: { agent: writerAgent, maxConcurrent: 1 },
 *     reviewer: { agent: reviewerAgent, maxConcurrent: 1 },
 *   },
 *   patterns: {
 *     parallelResearch: {
 *       type: 'parallel',
 *       handlers: ['researcher', 'researcher', 'researcher'],
 *       merge: (results) => combineResearch(results),
 *     },
 *   },
 * });
 * ```
 */

import type {
  ModuleSchema,
  Plugin,
  Requirement,
  System,
} from "@directive-run/core";
import { createModule, createSystem, t } from "@directive-run/core";
import {
  createCallbackPlugin,
  getBridgeFact,
  requirementGuard,
  setBridgeFact,
} from "@directive-run/core/adapter-utils";
import type { CircuitBreaker } from "@directive-run/core/plugins";
import type {
  OrchestratorStreamChunk,
  OrchestratorStreamResult,
} from "./agent-orchestrator.js";
import {
  type DebugTimeline,
  createDebugTimeline,
  createDebugTimelinePlugin,
} from "./debug-timeline.js";
import {
  executeAgentWithRetry,
  executeGuardrailWithRetry,
  normalizeGuardrail,
} from "./guardrail-utils.js";
import { type HealthMonitor, createHealthMonitor } from "./health-monitor.js";
import type { AgentMemory } from "./memory.js";
import {
  convertOrchestratorConstraints,
  getAgentState,
  getApprovalState,
  getBreakpointState,
  getConversation,
  getOrchestratorState,
  getToolCalls,
  setAgentState,
  setApprovalState,
  setBreakpointState,
  setConversation,
  setToolCalls,
} from "./orchestrator-bridge.js";
import { ReflectionExhaustedError } from "./reflection.js";
import type { ReflectionEvaluation } from "./reflection.js";
import type {
  AgentLike,
  AgentRetryConfig,
  AgentRunner,
  AgentSelectionStrategy,
  ApprovalRequest,
  CheckpointDiff,
  CheckpointProgress,
  CrossAgentDerivationFn,
  CrossAgentSnapshot,
  DagCheckpointState,
  DagExecutionContext,
  DagNode,
  DagPattern,
  DebateCheckpointState,
  GoalCheckpointState,
  GoalMetrics,
  GoalNode,
  GoalPattern,
  GoalResult,
  GoalStepMetrics,
  GuardrailFn,
  GuardrailsConfig,
  InputGuardrailData,
  MultiAgentLifecycleHooks,
  MultiAgentSelfHealingConfig,
  NamedGuardrail,
  OrchestratorConstraint,
  OrchestratorResolver,
  OrchestratorResolverContext,
  OrchestratorState,
  OutputGuardrailData,
  PatternCheckpointConfig,
  PatternCheckpointState,
  ReflectCheckpointState,
  RejectedRequest,
  RelaxationContext,
  RelaxationRecord,
  RelaxationTier,
  RerouteEvent,
  RunOptions,
  RunResult,
  Scratchpad,
  SequentialCheckpointState,
  SupervisorCheckpointState,
  ToolCallGuardrailData,
} from "./types.js";
import {
  APPROVAL_KEY,
  BREAKPOINT_KEY,
  GuardrailError,
  SCRATCHPAD_KEY,
  isGuardrailError,
  orchestratorBridgeSchema,
} from "./types.js";

import type {
  BreakpointConfig,
  BreakpointContext,
  BreakpointModifications,
  BreakpointRequest,
  MultiAgentBreakpointType,
} from "./breakpoints.js";
import {
  MAX_BREAKPOINT_HISTORY,
  createBreakpointId,
  createInitialBreakpointState,
  matchBreakpoint,
} from "./breakpoints.js";
import {
  type Checkpoint,
  type CheckpointStore,
  type MultiAgentCheckpointLocalState,
  createCheckpointId,
  validateCheckpoint,
} from "./checkpoint.js";
import {
  type MultiplexedStreamResult,
  mergeTaggedStreams,
} from "./streaming.js";
import {
  type SafeParseable,
  extractJsonFromOutput,
  withStructuredOutput,
} from "./structured-output.js";

// ============================================================================
/** Safe JSON.stringify that handles circular refs or throwing toJSON */
function safeStringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Shallow structural equality for change detection (plain objects, arrays, and primitives) */
function shallowEqual(a: unknown, b: unknown): boolean {
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

// Async Semaphore (for slot acquisition without polling)
// ============================================================================

// ============================================================================
// Checkpoint Utility Functions
// ============================================================================

/** Get the current step/round/iteration count from a pattern checkpoint state */
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

/** Compute progress from a pattern checkpoint state */
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

/** Compute the diff between two checkpoint states */
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
// Agent Registry Types
// ============================================================================

/** Configuration for a registered agent */
export interface AgentRegistration {
  /** The agent instance */
  agent: AgentLike;
  /** Maximum concurrent runs for this agent. @default 1 */
  maxConcurrent?: number;
  /** Timeout for agent runs (ms) */
  timeout?: number;
  /** Custom run options */
  runOptions?: Omit<RunOptions, "signal">;
  /** Description for constraint-based selection */
  description?: string;
  /** Capabilities this agent has */
  capabilities?: string[];
  /** Per-agent guardrails (applied in addition to orchestrator-level guardrails) */
  guardrails?: {
    input?: Array<
      GuardrailFn<InputGuardrailData> | NamedGuardrail<InputGuardrailData>
    >;
    output?: Array<
      GuardrailFn<OutputGuardrailData> | NamedGuardrail<OutputGuardrailData>
    >;
    toolCall?: Array<
      GuardrailFn<ToolCallGuardrailData> | NamedGuardrail<ToolCallGuardrailData>
    >;
  };
  /** Per-agent retry config (overrides orchestrator-level agentRetry) */
  retry?: AgentRetryConfig;
  /** Per-agent constraints */
  constraints?: Record<string, OrchestratorConstraint<Record<string, unknown>>>;
  /** Per-agent resolvers */
  resolvers?: Record<
    string,
    OrchestratorResolver<Record<string, unknown>, Requirement>
  >;
  /** Per-agent memory (overrides orchestrator-level memory) */
  memory?: AgentMemory;
  /** Per-agent circuit breaker (overrides orchestrator-level circuitBreaker) */
  circuitBreaker?: CircuitBreaker;
  /** Per-agent output schema for structured output */
  outputSchema?: SafeParseable<unknown>;
  /** Max retries for structured output validation. @default 2 */
  maxSchemaRetries?: number;
  /** Custom JSON extractor for structured output */
  extractJson?: (output: string) => unknown;
  /** Description of the schema for structured output prompting */
  schemaDescription?: string;
}

/** Agent registry configuration */
export interface AgentRegistry {
  [agentId: string]: AgentRegistration;
}

// ============================================================================
// Execution Pattern Types
// ============================================================================

/** Parallel execution pattern - run handlers concurrently and merge results */
export interface ParallelPattern<T = unknown> {
  type: "parallel";
  /** Handler IDs (agents or tasks) to run in parallel (can repeat for multiple instances) */
  handlers: string[];
  /** Function to merge results from all handlers */
  merge: (results: RunResult<unknown>[]) => T | Promise<T>;
  /** Minimum successful results required. @default handlers.length */
  minSuccess?: number;
  /** Overall timeout (ms) */
  timeout?: number;
}

/** Sequential execution pattern - pipeline of handlers */
export interface SequentialPattern<T = unknown> {
  type: "sequential";
  /** Handler IDs (agents or tasks) in execution order */
  handlers: string[];
  /** Transform output to next input. @default JSON.stringify */
  transform?: (output: unknown, handlerId: string, index: number) => string;
  /** Final result extractor */
  extract?: (output: unknown) => T;
  /** Continue on error. @default false */
  continueOnError?: boolean;
  /** Checkpoint configuration for mid-execution fault tolerance */
  checkpoint?: PatternCheckpointConfig;
}

/** Supervisor pattern - one agent directs others */
export interface SupervisorPattern<T = unknown> {
  type: "supervisor";
  /** Supervisor agent ID */
  supervisor: string;
  /** Worker agent IDs */
  workers: string[];
  /** Maximum delegation rounds. @default 5 */
  maxRounds?: number;
  /** Extract final result */
  extract?: (
    supervisorOutput: unknown,
    workerResults: RunResult<unknown>[],
  ) => T;
  /** Checkpoint configuration for mid-execution fault tolerance */
  checkpoint?: PatternCheckpointConfig;
}

/** Record of a single reflection iteration (for score history) */
export interface ReflectIterationRecord {
  iteration: number;
  passed: boolean;
  score?: number;
  feedback?: string;
  durationMs: number;
  producerTokens: number;
  evaluatorTokens: number;
}

/**
 * Reflect pattern - produce, evaluate, retry with feedback.
 * @see reflect — factory helper
 * @see ReflectIterationRecord — per-iteration history entries
 */
export interface ReflectPattern<T = unknown> {
  type: "reflect";
  /** Producer handler ID (agent or task) */
  handler: string;
  /** Evaluator agent ID (receives output as input) */
  evaluator: string;
  /** Maximum iterations. @default 2 */
  maxIterations?: number;
  /** Parse evaluator output into ReflectionEvaluation. @default JSON.parse */
  parseEvaluation?: (output: unknown) => ReflectionEvaluation;
  /** Build retry input from original input + feedback */
  buildRetryInput?: (
    input: string,
    feedback: string,
    iteration: number,
  ) => string;
  /** Extract result from raw producer output. Unlike race's extract (which receives RunResult), this receives the output directly since the producer is already selected. */
  extract?: (output: unknown) => T;
  /** Behavior when maxIterations exhausted. @default "accept-last" */
  onExhausted?: "accept-last" | "accept-best" | "throw";
  /** Callback fired after each iteration with score/feedback data. @see ReflectIterationRecord */
  onIteration?: (record: ReflectIterationRecord) => void;
  /** AbortSignal for external cancellation of the reflection loop */
  signal?: AbortSignal;
  /** Overall timeout (ms). Creates an internal AbortSignal. */
  timeout?: number;
  /** Score threshold for acceptance. Number or function of iteration. When set, evaluator score >= threshold is treated as passed. */
  threshold?: number | ((iteration: number) => number);
  /** Checkpoint configuration for mid-execution fault tolerance */
  checkpoint?: PatternCheckpointConfig;
}

/**
 * Race pattern - first successful agent wins, rest cancelled.
 * @see race — factory helper
 * @see RaceResult — return type
 */
export interface RacePattern<T = unknown> {
  type: "race";
  /** Handler IDs (agents or tasks) to race */
  handlers: string[];
  /** Extract result from winning RunResult (receives full RunResult for access to tokens/metadata). @default output field */
  extract?: (result: RunResult<unknown>) => T;
  /** Overall timeout (ms) */
  timeout?: number;
  /** Require N successful results before resolving. @default 1 */
  minSuccess?: number;
  /** AbortSignal for external cancellation */
  signal?: AbortSignal;
}

/** Return type from debate pattern execution */
export interface DebateResult<T = unknown> {
  winnerId: string;
  result: T;
  rounds: Array<{
    proposals: Array<{ agentId: string; output: unknown }>;
    judgement: { winnerId: string; feedback?: string; score?: number };
  }>;
}

/** Individual result entry returned when minSuccess > 1 */
export interface RaceSuccessEntry<T = unknown> {
  agentId: string;
  result: T;
}

/** Return type from race pattern execution */
export interface RaceResult<T = unknown> {
  winnerId: string;
  result: T;
  allResults?: Array<RaceSuccessEntry<T>>;
}

/**
 * Debate pattern - agents compete, evaluator judges across rounds.
 * @see debate — factory helper
 * @see runDebate — imperative API
 * @see DebateResult — return type
 */
export interface DebatePattern<T = unknown> {
  type: "debate";
  /** Handler IDs (agents or tasks) that will generate competing proposals */
  handlers: string[];
  /** Evaluator agent ID that judges proposals */
  evaluator: string;
  /** Maximum rounds of debate. @default 2 */
  maxRounds?: number;
  /** Extract final result from the winning proposal */
  extract?: (output: unknown) => T;
  /** Parse evaluator output. @default JSON.parse expecting `{ winnerId, feedback }` */
  parseJudgement?: (output: unknown) => {
    winnerId: string;
    feedback?: string;
    score?: number;
  };
  /** AbortSignal for external cancellation */
  signal?: AbortSignal;
  /** Overall timeout (ms). Creates an internal AbortSignal. */
  timeout?: number;
  /** Checkpoint configuration for mid-execution fault tolerance */
  checkpoint?: PatternCheckpointConfig;
}

/** Re-export types consumed by tests / external consumers */
export type { DagPattern, DagExecutionContext } from "./types.js";

/** Re-export goal types consumed by tests / external consumers */
export type {
  GoalPattern,
  GoalNode,
  GoalResult,
  GoalStepMetrics,
  GoalMetrics,
  AgentSelectionStrategy,
  RelaxationTier,
  RelaxationStrategy,
  RelaxationRecord,
  RelaxationContext,
} from "./types.js";

/** Union of all patterns */
export type ExecutionPattern<T = unknown> =
  | ParallelPattern<T>
  | SequentialPattern<T>
  | SupervisorPattern<T>
  | DagPattern<T>
  | ReflectPattern<T>
  | RacePattern<T>
  | DebatePattern<T>
  | GoalPattern<T>;

// ============================================================================
// Handoff Types
// ============================================================================

/** Handoff request between agents */
export interface HandoffRequest {
  id: string;
  fromAgent: string;
  toAgent: string;
  input: string;
  context?: Record<string, unknown>;
  requestedAt: number;
}

/** Handoff result */
export interface HandoffResult {
  request: HandoffRequest;
  result: RunResult<unknown>;
  completedAt: number;
}

// ============================================================================
// Multi-Agent Orchestrator Types
// ============================================================================

/** Run agent requirement */
export interface RunAgentRequirement extends Requirement {
  type: "RUN_AGENT";
  agent: string;
  input: string;
  context?: Record<string, unknown>;
}

/** Read-only context passed to task functions */
export interface TaskContext {
  /** The ID of this task */
  taskId: string;
  /** Conversation history from orchestrator memory (read-only deep copy) */
  memory: ReadonlyArray<{ role: string; content: string }>;
  /** Current scratchpad state (read-only deep copy) */
  scratchpad: Readonly<Record<string, unknown>>;
  /** Read the state of any registered agent or task (status, lastOutput, lastError, totalTokens) */
  readAgentState: (nodeId: string) =>
    | Readonly<{
        status: string;
        lastOutput?: string;
        lastError?: string;
        totalTokens: number;
      }>
    | undefined;
  /** Report intermediate progress (0-100) for DevTools timeline */
  reportProgress: (percent: number, message?: string) => void;
}

/** Configuration for a registered task (imperative code) */
export interface TaskRegistration {
  /** The function to execute. Receives input, abort signal, and context. */
  run: (
    input: string,
    signal: AbortSignal,
    context: TaskContext,
  ) => unknown | Promise<unknown>;
  /** Display label for DevTools graph. Defaults to task ID. */
  label?: string;
  /** Description for DevTools tooltip/detail panel. */
  description?: string;
  /** Timeout (ms) */
  timeout?: number;
  /** Max concurrent executions of this task. @default 1 */
  maxConcurrent?: number;
  /** Optional retry configuration for transient failures */
  retry?: {
    /** Max number of attempts (including the first try) */
    attempts: number;
    /** Backoff strategy between retries. @default 'fixed' */
    backoff?: "fixed" | "exponential";
    /** Base delay between retries (ms). @default 1000 */
    delayMs?: number;
  };
}

/** Multi-agent orchestrator options */
export interface MultiAgentOrchestratorOptions {
  /** Base run function */
  runner: AgentRunner;
  /** Registered agents */
  agents: AgentRegistry;
  /** Imperative code tasks, referenced by ID in patterns (same namespace as agents) */
  tasks?: Record<string, TaskRegistration>;
  /** Execution patterns */
  patterns?: Record<string, ExecutionPattern>;
  /** Handoff callbacks */
  onHandoff?: (request: HandoffRequest) => void;
  /** Handoff completion callbacks */
  onHandoffComplete?: (result: HandoffResult) => void;
  /** Maximum number of handoff results to retain. @default 1000 */
  maxHandoffHistory?: number;
  /** Debug mode — `true` for default debug, or config object for advanced options */
  debug?: boolean | import("./types.js").OrchestratorDebugConfig;
  /** Orchestrator-level guardrails (applied to all agents) */
  guardrails?: GuardrailsConfig;
  /** Lifecycle hooks */
  hooks?: MultiAgentLifecycleHooks;
  /** Shared memory across all agents */
  memory?: AgentMemory;
  /** Default retry config for all agents (per-agent overrides this) */
  agentRetry?: AgentRetryConfig;
  /** Maximum token budget across all agent runs */
  maxTokenBudget?: number;
  /** Fires when token usage reaches this percentage of maxTokenBudget (0-1). @default 0.8 */
  budgetWarningThreshold?: number;
  /** Callback when budget warning threshold is reached */
  onBudgetWarning?: (event: {
    currentTokens: number;
    maxBudget: number;
    percentage: number;
  }) => void;
  /** Plugins to attach to the underlying Directive System */
  plugins?: Plugin[];
  /** Callback for approval requests */
  onApprovalRequest?: (request: ApprovalRequest) => void;
  /** Auto-approve tool calls. @default true */
  autoApproveToolCalls?: boolean;
  /** Approval timeout in milliseconds. @default 300000 */
  approvalTimeoutMs?: number;
  /** Orchestrator-level constraints */
  constraints?: Record<string, OrchestratorConstraint<Record<string, unknown>>>;
  /** Orchestrator-level resolvers */
  resolvers?: Record<
    string,
    OrchestratorResolver<Record<string, unknown>, Requirement>
  >;
  /** Orchestrator-level circuit breaker */
  circuitBreaker?: CircuitBreaker;
  /** Self-healing configuration for automatic agent rerouting */
  selfHealing?: MultiAgentSelfHealingConfig;
  /** Checkpoint store for persistent state */
  checkpointStore?: CheckpointStore;
  /** Breakpoints for human-in-the-loop pause/inspect/modify */
  breakpoints?: BreakpointConfig<MultiAgentBreakpointType>[];
  /** Callback when a breakpoint fires */
  onBreakpoint?: (request: BreakpointRequest) => void;
  /** Timeout for breakpoint resolution (ms). @default 300000 */
  breakpointTimeoutMs?: number;
  /** Cross-agent derivation functions — compute values from combined agent states */
  derive?: Record<string, CrossAgentDerivationFn>;
  /** Shared scratchpad configuration */
  scratchpad?: { init: Record<string, unknown> };
}

/** Multi-agent state in facts */
export interface MultiAgentState {
  /** Namespace for each agent's state */
  __agents: Record<
    string,
    {
      status: "idle" | "running" | "completed" | "error";
      lastInput?: string;
      lastOutput?: unknown;
      lastError?: string;
      runCount: number;
      totalTokens: number;
    }
  >;
  /** Pending handoffs */
  __handoffs: HandoffRequest[];
  /** Completed handoffs */
  __handoffResults: HandoffResult[];
}

/** Per-call options for multi-agent runAgent/run */
export interface MultiAgentRunCallOptions extends RunOptions {
  /** Override structured output schema for this call. Set to `null` to opt out of per-agent schema. */
  outputSchema?: SafeParseable<unknown> | null;
  /** Override max schema retries for this call. */
  maxSchemaRetries?: number;
  /** Pattern ID that initiated this run (for lifecycle hooks). Set internally by pattern executors. */
  patternId?: string;
}

/** Multi-agent orchestrator instance */
export interface MultiAgentOrchestrator {
  /** The underlying Directive System */
  // biome-ignore lint/suspicious/noExplicitAny: System type varies per configuration
  system: System<any>;
  /** Combined facts from all agent modules + coordinator */
  facts: Record<string, unknown>;
  /** Run a single agent */
  runAgent<T>(
    agentId: string,
    input: string,
    options?: MultiAgentRunCallOptions,
  ): Promise<RunResult<T>>;
  /** Run an agent with streaming support */
  runAgentStream<T>(
    agentId: string,
    input: string,
    options?: { signal?: AbortSignal },
  ): OrchestratorStreamResult<T>;
  /**
   * Run an execution pattern by its registered pattern ID.
   *
   * Note: For race and debate patterns, `runPattern` returns only the extracted result value.
   * Use `runRace()` or `runDebate()` to access full results including `winnerId` and `allResults`.
   */
  runPattern<T>(patternId: string, input: string): Promise<T>;
  /** Run agents in parallel. Note: parallel does not support checkpoint/resume (single-step pattern). */
  runParallel<T>(
    agentIds: string[],
    inputs: string | string[],
    merge: (results: RunResult<unknown>[]) => T | Promise<T>,
    options?: { minSuccess?: number; timeout?: number },
  ): Promise<T>;
  /** Run agents sequentially */
  runSequential<T>(
    agentIds: string[],
    initialInput: string,
    options?: {
      transform?: (output: unknown, agentId: string, index: number) => string;
    },
  ): Promise<RunResult<T>[]>;
  /** Request a handoff between agents */
  handoff(
    fromAgent: string,
    toAgent: string,
    input: string,
    context?: Record<string, unknown>,
  ): Promise<RunResult<unknown>>;
  /** Approve a pending request */
  approve(requestId: string): void;
  /** Reject a pending request */
  reject(requestId: string, reason?: string): void;
  /** Pause all agents */
  pause(): void;
  /** Resume agents */
  resume(): void;
  /** Total tokens consumed across all agents */
  readonly totalTokens: number;
  /** Wait until all agents are idle */
  waitForIdle(timeoutMs?: number): Promise<void>;
  /** Alias for runAgent */
  run<T>(
    agentId: string,
    input: string,
    options?: MultiAgentRunCallOptions,
  ): Promise<RunResult<T>>;
  /** Alias for runAgentStream */
  runStream<T>(
    agentId: string,
    input: string,
    options?: { signal?: AbortSignal },
  ): OrchestratorStreamResult<T>;
  /** Register a new agent dynamically */
  registerAgent(agentId: string, registration: AgentRegistration): void;
  /** Unregister an agent (must be idle) */
  unregisterAgent(agentId: string): void;
  /** Get registered agent IDs */
  getAgentIds(): string[];
  /** Register a new task dynamically */
  registerTask(taskId: string, registration: TaskRegistration): void;
  /** Unregister a task */
  unregisterTask(taskId: string): void;
  /** Get registered task IDs */
  getTaskIds(): string[];
  /** Get task registry info (labels + descriptions) */
  getTaskRegistry(): Record<string, { label?: string; description?: string }>;
  /** Get task state */
  getTaskState(taskId: string):
    | {
        status: string;
        lastOutput?: unknown;
        lastError?: string;
        startTime?: number;
        durationMs?: number;
      }
    | undefined;
  /** Get all task states */
  getAllTaskStates(): Record<
    string,
    {
      status: string;
      lastOutput?: unknown;
      lastError?: string;
      startTime?: number;
      durationMs?: number;
    }
  >;
  /** Get all handler IDs (agents + tasks combined) */
  getNodeIds(): string[];
  /** Get agent state */
  getAgentState(
    agentId: string,
  ): MultiAgentState["__agents"][string] | undefined;
  /** Get all agent states */
  getAllAgentStates(): Record<string, MultiAgentState["__agents"][string]>;
  /** Get pending handoffs */
  getPendingHandoffs(): HandoffRequest[];
  /** Reset all agent states */
  reset(): void;
  /** Debug timeline (null when debug is false) */
  readonly timeline: DebugTimeline | null;
  /** Health monitor (null when selfHealing is not configured) */
  readonly healthMonitor: HealthMonitor | null;
  /** Create a checkpoint of the current state */
  checkpoint(options?: { label?: string }): Promise<Checkpoint>;
  /** Restore from a checkpoint */
  restore(
    checkpoint: Checkpoint,
    options?: { restoreTimeline?: boolean },
  ): void;
  /** Run multiple agents with multiplexed streaming */
  runParallelStream<T>(
    agentIds: string[],
    inputs: string | string[],
    merge: (results: RunResult<unknown>[]) => T | Promise<T>,
    options?: { minSuccess?: number; timeout?: number; signal?: AbortSignal },
  ): MultiplexedStreamResult<T>;
  /** Resume a paused breakpoint */
  resumeBreakpoint(id: string, modifications?: BreakpointModifications): void;
  /** Cancel a paused breakpoint */
  cancelBreakpoint(id: string, reason?: string): void;
  /** Get pending breakpoints */
  getPendingBreakpoints(): BreakpointRequest[];
  /** Race multiple agents — first successful result wins, rest cancelled. Note: race does not support checkpoint/resume (single-step pattern). */
  runRace<T>(
    agentIds: string[],
    input: string,
    options?: {
      extract?: (result: RunResult<unknown>) => T;
      timeout?: number;
      minSuccess?: number;
      signal?: AbortSignal;
    },
  ): Promise<RaceResult<T>>;
  /** Run a reflect pattern imperatively (no pre-registration needed) */
  runReflect<T>(
    producerId: string,
    evaluatorId: string,
    input: string,
    options?: {
      maxIterations?: number;
      parseEvaluation?: (output: unknown) => ReflectionEvaluation;
      buildRetryInput?: (
        input: string,
        feedback: string,
        iteration: number,
      ) => string;
      extract?: (output: unknown) => T;
      onExhausted?: "accept-last" | "accept-best" | "throw";
      onIteration?: (record: ReflectIterationRecord) => void;
      signal?: AbortSignal;
      timeout?: number;
      threshold?: number | ((iteration: number) => number);
    },
  ): Promise<{
    result: T;
    iterations: number;
    history: ReflectIterationRecord[];
    exhausted: boolean;
  }>;
  /** Run a debate imperatively (no pre-registration needed) */
  runDebate<T>(
    agentIds: string[],
    evaluatorId: string,
    input: string,
    options?: {
      maxRounds?: number;
      extract?: (output: unknown) => T;
      parseJudgement?: (output: unknown) => {
        winnerId: string;
        feedback?: string;
        score?: number;
      };
      signal?: AbortSignal;
      timeout?: number;
    },
  ): Promise<DebateResult<T>>;
  /** Run a goal pattern imperatively — declare desired state, let the runtime resolve */
  runGoal<T>(
    nodes: Record<string, GoalNode>,
    initialInput: string | Record<string, unknown>,
    when: (facts: Record<string, unknown>) => boolean,
    options?: {
      satisfaction?: (facts: Record<string, unknown>) => number;
      maxSteps?: number;
      extract?: (facts: Record<string, unknown>) => T;
      timeout?: number;
      signal?: AbortSignal;
      selectionStrategy?: AgentSelectionStrategy;
      relaxation?: RelaxationTier[];
      onStep?: GoalPattern["onStep"];
      onStall?: GoalPattern["onStall"];
      checkpoint?: PatternCheckpointConfig;
    },
  ): Promise<GoalResult<T>>;
  /** Resume a goal pattern from a saved checkpoint */
  resumeGoal<T>(
    checkpointState: GoalCheckpointState,
    pattern: GoalPattern<T>,
  ): Promise<GoalResult<T>>;
  /** Resume a sequential pattern from a saved checkpoint */
  resumeSequential<T>(
    checkpointState: SequentialCheckpointState,
    pattern: SequentialPattern<T>,
  ): Promise<T>;
  /** Resume a supervisor pattern from a saved checkpoint */
  resumeSupervisor<T>(
    checkpointState: SupervisorCheckpointState,
    pattern: SupervisorPattern<T>,
    options?: { input?: string },
  ): Promise<T>;
  /** Resume a reflect pattern from a saved checkpoint */
  resumeReflect<T>(
    checkpointState: ReflectCheckpointState,
    pattern: ReflectPattern<T>,
    options?: { input?: string },
  ): Promise<T>;
  /** Resume a debate pattern from a saved checkpoint */
  resumeDebate<T>(
    checkpointState: DebateCheckpointState,
    pattern: DebatePattern<T>,
  ): Promise<DebateResult<T>>;
  /** Resume a DAG pattern from a saved checkpoint */
  resumeDag<T>(
    checkpointState: DagCheckpointState,
    pattern: DagPattern<T>,
    options?: { input?: string },
  ): Promise<T>;
  /** Replay from a saved checkpoint (auto-detects pattern type) */
  replay<T>(
    checkpointId: string,
    pattern: ExecutionPattern,
    options?: { input?: string },
  ): Promise<T>;
  /**
   * Get reflection iteration history from last runReflectPattern call.
   */
  getLastReflectionHistory(): ReflectIterationRecord[] | null;
  /** Cross-agent derived values (frozen snapshot). Empty when derive not configured. */
  readonly derived: Record<string, unknown>;
  /** Subscribe to cross-agent derivation changes */
  onDerivedChange(callback: (id: string, value: unknown) => void): () => void;
  /** Shared scratchpad (null when not configured) */
  readonly scratchpad: Scratchpad | null;
  /** Dispose of the orchestrator, resetting all state */
  dispose(): void;
}

/** Built-in pause requirement type */
interface PauseBudgetExceededReq extends Requirement {
  type: "__PAUSE_BUDGET_EXCEEDED";
}

/** Built-in RUN_AGENT requirement guard */
const isRunAgentReq = requirementGuard<RunAgentRequirement>("RUN_AGENT");

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a multi-agent orchestrator backed by a Directive System.
 *
 * Each registered agent becomes a namespaced Directive module with reactive state,
 * constraint evaluation, guardrails, streaming, approval, memory, retry, budget,
 * hooks, and time-travel debugging — all features at parity with `createAgentOrchestrator`.
 *
 * @example
 * ```typescript
 * const orchestrator = createMultiAgentOrchestrator({
 *   runner,
 *   agents: {
 *     researcher: { agent: researchAgent, maxConcurrent: 3 },
 *     writer: { agent: writerAgent },
 *     reviewer: { agent: reviewerAgent },
 *   },
 *   guardrails: {
 *     input: [detectPII],
 *     output: [checkToxicity],
 *   },
 *   hooks: {
 *     onAgentStart: ({ agentId, input }) => console.log(`${agentId}: ${input}`),
 *   },
 *   maxTokenBudget: 50000,
 *   debug: true,
 * });
 *
 * // Run with full guardrails + approval + streaming
 * const result = await orchestrator.runAgent('researcher', 'What is AI?');
 *
 * // Stream agent output
 * const { stream } = orchestrator.runAgentStream('writer', 'Write about AI');
 * for await (const chunk of stream) {
 *   if (chunk.type === 'token') process.stdout.write(chunk.data);
 * }
 * ```
 *
 * @throws {Error} If a pattern references an agent that is not in the registry
 * @throws {Error} If autoApproveToolCalls is false but no onApprovalRequest callback is provided
 */
export function createMultiAgentOrchestrator(
  options: MultiAgentOrchestratorOptions,
): MultiAgentOrchestrator {
  const {
    runner,
    agents: inputAgents,
    patterns = {},
    onHandoff,
    onHandoffComplete,
    maxHandoffHistory = 1000,
    debug: rawDebug = false,
    guardrails = {},
    hooks = {},
    memory: sharedMemory,
    agentRetry: defaultAgentRetry,
    maxTokenBudget,
    plugins = [],
    onApprovalRequest,
    autoApproveToolCalls = true,
    approvalTimeoutMs = 300000,
    constraints: userConstraints = {},
    resolvers: userResolvers = {},
    circuitBreaker: orchestratorCircuitBreaker,
    budgetWarningThreshold = 0.8,
    onBudgetWarning,
    selfHealing,
    checkpointStore,
    breakpoints: breakpointConfigs = [],
    onBreakpoint,
    breakpointTimeoutMs = 300000,
    derive: userDerivations,
    scratchpad: scratchpadConfig,
    tasks: inputTasks = {},
  } = options;

  // Normalize debug config
  const debug = typeof rawDebug === "object" ? true : !!rawDebug;
  const MAX_VERBOSE_LENGTH = 5000;

  // Shallow copy so registerAgent/unregisterAgent don't mutate the caller's object
  const agents: AgentRegistry = { ...inputAgents };

  // Task registry (shallow copy for same reason as agents)
  const tasks: Record<string, TaskRegistration> = { ...inputTasks };

  // Task state tracking (parallel to agentStates)
  const taskStates: Record<
    string,
    {
      status: string;
      lastOutput?: unknown;
      lastError?: string;
      startTime?: number;
      durationMs?: number;
    }
  > = Object.create(null);
  for (const taskId of Object.keys(tasks)) {
    taskStates[taskId] = { status: "idle" };
  }

  // Task semaphores are created after validation (below)
  const taskSemaphores = new Map<string, Semaphore>();

  // Enforce approval workflow configuration
  if (!autoApproveToolCalls && !onApprovalRequest) {
    throw new Error(
      "[Directive MultiAgent] Invalid approval configuration: autoApproveToolCalls is false but no onApprovalRequest callback provided. " +
        "Tool calls would wait for approval indefinitely. Either:\n" +
        "  - Set autoApproveToolCalls: true to auto-approve all tool calls\n" +
        "  - Provide an onApprovalRequest callback to handle approvals programmatically",
    );
  }

  // Validate budget warning threshold
  if (budgetWarningThreshold < 0 || budgetWarningThreshold > 1) {
    throw new Error(
      `[Directive MultiAgent] budgetWarningThreshold must be between 0 and 1, got ${budgetWarningThreshold}`,
    );
  }

  // Validate reserved agent IDs
  const RESERVED_IDS = new Set([
    "__coord",
    "__proto__",
    "constructor",
    "prototype",
    "toString",
    "valueOf",
    "hasOwnProperty",
  ]);
  for (const agentId of Object.keys(agents)) {
    if (RESERVED_IDS.has(agentId)) {
      throw new Error(
        `[Directive MultiAgent] Agent ID "${agentId}" is reserved and cannot be used`,
      );
    }
  }
  for (const [taskId, taskReg] of Object.entries(tasks)) {
    if (!taskId || taskId.trim() !== taskId) {
      throw new Error(
        `[Directive MultiAgent] Task ID must be a non-empty trimmed string, got "${taskId}"`,
      );
    }
    if (RESERVED_IDS.has(taskId)) {
      throw new Error(
        `[Directive MultiAgent] Task ID "${taskId}" is reserved and cannot be used`,
      );
    }
    // Validate timeout and maxConcurrent
    if (
      taskReg.timeout !== undefined &&
      (!Number.isFinite(taskReg.timeout) || taskReg.timeout <= 0)
    ) {
      throw new Error(
        `[Directive MultiAgent] Task "${taskId}" timeout must be a finite number > 0`,
      );
    }
    if (
      taskReg.maxConcurrent !== undefined &&
      (!Number.isFinite(taskReg.maxConcurrent) ||
        taskReg.maxConcurrent < 1 ||
        !Number.isInteger(taskReg.maxConcurrent))
    ) {
      throw new Error(
        `[Directive MultiAgent] Task "${taskId}" maxConcurrent must be a finite integer >= 1`,
      );
    }
    // Validate retry configuration
    if (taskReg.retry) {
      const { attempts, delayMs } = taskReg.retry;
      if (!Number.isFinite(attempts) || attempts < 1) {
        throw new Error(
          `[Directive MultiAgent] Task "${taskId}" retry attempts must be a finite number >= 1`,
        );
      }
      if (delayMs !== undefined && (!Number.isFinite(delayMs) || delayMs < 0)) {
        throw new Error(
          `[Directive MultiAgent] Task "${taskId}" retry delayMs must be a finite number >= 0`,
        );
      }
    }
  }

  // Create task semaphores (after validation passes)
  for (const [taskId, reg] of Object.entries(tasks)) {
    taskSemaphores.set(taskId, new Semaphore(reg.maxConcurrent ?? 1));
  }

  // Validate no ID collisions between agents and tasks
  for (const taskId of Object.keys(tasks)) {
    if (agents[taskId]) {
      throw new Error(
        `[Directive MultiAgent] ID "${taskId}" is registered as both an agent and a task. IDs must be unique across both registries.`,
      );
    }
  }

  // Validate that all pattern handlers exist in the combined registry
  const registeredAgentIds = new Set([
    ...Object.keys(agents),
    ...Object.keys(tasks),
  ]);
  const missingAgents: Array<{ patternId: string; agentId: string }> = [];

  for (const [patternId, pattern] of Object.entries(patterns)) {
    const agentsToCheck: string[] = [];

    switch (pattern.type) {
      case "parallel":
        agentsToCheck.push(...pattern.handlers);
        break;
      case "sequential":
        agentsToCheck.push(...pattern.handlers);
        break;
      case "supervisor":
        agentsToCheck.push(pattern.supervisor, ...pattern.workers);
        break;
      case "dag":
        for (const node of Object.values(pattern.nodes)) {
          agentsToCheck.push(node.handler);
        }
        break;
      case "reflect":
        agentsToCheck.push(pattern.handler, pattern.evaluator);
        break;
      case "race":
        agentsToCheck.push(...pattern.handlers);
        break;
      case "debate":
        agentsToCheck.push(
          ...(pattern as DebatePattern).handlers,
          (pattern as DebatePattern).evaluator,
        );
        break;
    }

    for (const agentId of agentsToCheck) {
      if (!registeredAgentIds.has(agentId)) {
        missingAgents.push({ patternId, agentId });
      }
    }
  }

  if (missingAgents.length > 0) {
    const details = missingAgents
      .map(
        ({ patternId, agentId }) =>
          `  - Pattern "${patternId}" references unknown agent "${agentId}"`,
      )
      .join("\n");
    throw new Error(
      `[Directive MultiAgent] Pattern validation failed. The following agents are not registered:\n${details}\n\nRegistered agents: ${[...registeredAgentIds].join(", ") || "(none)"}`,
    );
  }

  // Validate DAG patterns for cycles
  for (const [patternId, pattern] of Object.entries(patterns)) {
    if (pattern.type === "dag") {
      validateDagAcyclic(patternId, pattern.nodes);
    }
  }

  // ---- Debug Timeline setup ----
  let timeline: DebugTimeline | null = null;
  let timelinePlugin: ReturnType<typeof createDebugTimelinePlugin> | null =
    null;
  if (debug) {
    timeline = createDebugTimeline({
      getSnapshotId: () => {
        try {
          return (system as any).debug?.currentIndex ?? null;
        } catch {
          return null;
        }
      },
      goToSnapshot: (snapshotId: number) => {
        try {
          (system as any).debug?.goTo?.(snapshotId);
        } catch {
          // System may not support goTo
        }
      },
    });
  }

  // ---- Health Monitor setup ----
  let healthMonitorInstance: HealthMonitor | null = null;
  let roundRobinCounters: Map<string, number> | null = null;
  if (selfHealing) {
    healthMonitorInstance = createHealthMonitor(selfHealing.healthMonitor);
    if (selfHealing.selectionStrategy === "round-robin") {
      roundRobinCounters = new Map();
    }
  }

  /** Safe hook caller — user-provided hooks must never crash the orchestrator */
  function fireHook<K extends keyof MultiAgentLifecycleHooks>(
    name: K,
    event: Parameters<NonNullable<MultiAgentLifecycleHooks[K]>>[0],
  ): void {
    try {
      (hooks[name] as ((e: typeof event) => void) | undefined)?.(event);
    } catch (hookError) {
      if (debug) {
        console.debug(`[Directive MultiAgent] hooks.${name} threw:`, hookError);
      }
    }
  }

  // ---- Coordinator Module ----
  // biome-ignore lint/suspicious/noExplicitAny: Dynamic schema construction
  const coordFacts: Record<string, any> = {
    __globalTokens: t.number(),
    __status: t.string(),
    __handoffs: t.array() as unknown as ReturnType<typeof t.array>,
    __handoffResults: t.array() as unknown as ReturnType<typeof t.array>,
    __budgetWarningFired: t.boolean(),
  };

  // Add scratchpad fact to coordinator schema if configured
  if (scratchpadConfig) {
    coordFacts[SCRATCHPAD_KEY] = t.object() as unknown;
  }

  // Add __derived bridge fact so constraints can read derivation values via facts.__derived
  if (userDerivations && Object.keys(userDerivations).length > 0) {
    coordFacts.__derived = t.object() as unknown;
  }

  const coordSchema = {
    facts: coordFacts,
    derivations: {},
    events: {},
    requirements: {},
  } satisfies ModuleSchema;

  // Convert orchestrator-level constraints
  // biome-ignore lint/suspicious/noExplicitAny: Constraint types complex
  const coordConstraints: Record<string, any> =
    convertOrchestratorConstraints(userConstraints);

  // Add built-in budget constraint — reads coordinator fact reactively
  if (maxTokenBudget) {
    coordConstraints.__budgetLimit = {
      priority: 100,
      // biome-ignore lint/suspicious/noExplicitAny: Facts type varies
      when: (facts: any) => {
        const tokens = getBridgeFact<number>(facts, "__globalTokens");

        return tokens > maxTokenBudget;
      },
      require: { type: "__PAUSE_BUDGET_EXCEEDED" } as PauseBudgetExceededReq,
    };
  }

  // biome-ignore lint/suspicious/noExplicitAny: Resolver types complex
  const coordResolvers: Record<string, any> = Object.create(null);

  // Convert user-provided orchestrator-level resolvers
  for (const [id, resolver] of Object.entries(userResolvers)) {
    coordResolvers[id] = {
      requirement: resolver.requirement,
      key: resolver.key,
      // biome-ignore lint/suspicious/noExplicitAny: Context type varies
      resolve: async (req: Requirement, context: any) => {
        const state = getOrchestratorState(context.facts);
        const combinedFacts = {
          ...context.facts,
          ...state,
        } as unknown as Record<string, unknown> & OrchestratorState;

        const resolverCtx: OrchestratorResolverContext<
          Record<string, unknown>
        > = {
          facts: combinedFacts,
          runAgent: async <T>(
            agent: AgentLike,
            input: string,
            opts?: RunOptions,
          ) => {
            return runner<T>(agent, input, opts);
          },
          signal: context.signal,
        };

        return resolver.resolve(req, resolverCtx);
      },
    };
  }

  // Built-in pause resolver
  coordResolvers.__pause = {
    requirement: requirementGuard<PauseBudgetExceededReq>(
      "__PAUSE_BUDGET_EXCEEDED",
    ),
    // biome-ignore lint/suspicious/noExplicitAny: Context type varies
    resolve: async () => {
      globalStatus = "paused";
      if (debug) {
        console.debug(
          "[Directive MultiAgent] Budget exceeded — all agents paused",
        );
      }
    },
  };

  // Built-in RUN_AGENT resolver
  coordResolvers.__runAgent = {
    requirement: isRunAgentReq,
    // biome-ignore lint/suspicious/noExplicitAny: Context type varies
    resolve: async (req: RunAgentRequirement) => {
      await runSingleAgent(req.agent, req.input);
    },
  };

  const coordinatorModule = createModule("__coord", {
    schema: coordSchema,
    init: (facts) => {
      setBridgeFact(facts, "__globalTokens", 0);
      setBridgeFact(facts, "__status", "idle");
      setBridgeFact(facts, "__handoffs", []);
      setBridgeFact(facts, "__handoffResults", []);
      setBridgeFact(facts, "__budgetWarningFired", false);
      if (scratchpadConfig) {
        setBridgeFact(facts, SCRATCHPAD_KEY, { ...scratchpadConfig.init });
      }
      // Derived values initialized via recomputeDerivations() after system creation
    },
    constraints: coordConstraints,
    resolvers: coordResolvers as any,
  });

  // ---- Per-Agent Modules (as a map for createSystem) ----
  // biome-ignore lint/suspicious/noExplicitAny: Module types vary
  const modulesMap: Record<string, any> = Object.create(null);
  modulesMap.__coord = coordinatorModule;

  for (const [agentId, registration] of Object.entries(agents)) {
    // biome-ignore lint/suspicious/noExplicitAny: Constraint types complex
    const perAgentConstraints: Record<string, any> = registration.constraints
      ? convertOrchestratorConstraints(registration.constraints)
      : {};

    // Convert per-agent resolvers
    // biome-ignore lint/suspicious/noExplicitAny: Resolver types complex
    const perAgentResolvers: Record<string, any> = Object.create(null);
    if (registration.resolvers) {
      for (const [id, resolver] of Object.entries(registration.resolvers)) {
        perAgentResolvers[id] = {
          requirement: resolver.requirement,
          key: resolver.key,
          // biome-ignore lint/suspicious/noExplicitAny: Context type varies
          resolve: async (req: Requirement, context: any) => {
            const state = getOrchestratorState(context.facts);
            const combinedFacts = {
              ...context.facts,
              ...state,
            } as unknown as Record<string, unknown> & OrchestratorState;

            const resolverContext: OrchestratorResolverContext<
              Record<string, unknown>
            > = {
              facts: combinedFacts,
              runAgent: async <T>(
                agent: AgentLike,
                input: string,
                opts?: RunOptions,
              ) => {
                return runner<T>(agent, input, opts);
              },
              signal: context.signal,
            };

            return resolver.resolve(req, resolverContext);
          },
        };
      }
    }

    modulesMap[agentId] = createModule(agentId, {
      schema: orchestratorBridgeSchema,
      init: (facts) => {
        setAgentState(facts, {
          status: "idle",
          currentAgent: registration.agent.name,
          input: null,
          output: null,
          error: null,
          tokenUsage: 0,
          turnCount: 0,
          startedAt: null,
          completedAt: null,
        });
        setApprovalState(facts, { pending: [], approved: [], rejected: [] });
        setConversation(facts, []);
        setToolCalls(facts, []);
        setBreakpointState(facts, createInitialBreakpointState());
      },
      constraints: perAgentConstraints,
      resolvers:
        Object.keys(perAgentResolvers).length > 0
          ? (perAgentResolvers as any)
          : undefined,
    });
  }

  // ---- Create System ----
  const callbackPlugin = createCallbackPlugin(
    "directive-multi-agent-callbacks",
    {},
  );

  // Build plugins array with optional timeline plugin
  const allPlugins = [...plugins, callbackPlugin];
  if (debug && timeline) {
    // Create timeline plugin after system is available (uses lazy getSnapshotId)
    timelinePlugin = createDebugTimelinePlugin(timeline, () => {
      try {
        return (system as any).debug?.currentIndex ?? null;
      } catch {
        return null;
      }
    });
    allPlugins.push(timelinePlugin);
  }

  const system = createSystem({
    modules: modulesMap,
    plugins: allPlugins,
    debug: debug ? { timeTravel: true } : undefined,
  } as any);

  system.start();

  // Maximum conversation messages to retain per agent (prevent unbounded growth)
  const MAX_CONVERSATION_MESSAGES = 500;
  const MAX_TOOL_CALLS = 200;

  // ---- Mutable State (tracked via System facts + local) ----
  let globalTokenCount = 0;
  let globalStatus: "idle" | "paused" = "idle";
  let disposed = false;
  // Tracks in-flight runAgent calls (incremented synchronously before any await)
  // so waitForIdle knows when runs have been dispatched but not yet started
  let pendingRuns = 0;
  // Reflection score history — updated after each runReflectPattern call
  let lastReflectionHistory: ReflectIterationRecord[] | null = null;

  function assertNotDisposed(): void {
    if (disposed) {
      throw new Error("[Directive MultiAgent] Orchestrator has been disposed");
    }
  }

  // Semaphores for concurrency control
  const semaphores = new Map<string, Semaphore>();
  for (const [agentId, reg] of Object.entries(agents)) {
    semaphores.set(agentId, new Semaphore(reg.maxConcurrent ?? 1));
  }

  // Agent states: lightweight local tracking for orchestrator API methods (getAgentState, etc.)
  // System facts (per-agent bridge schema) provide the rich state for constraints/resolvers/plugins.
  // Both are updated together — local state is the quick-access view, System facts drive reactivity.
  const agentStates: Record<string, MultiAgentState["__agents"][string]> =
    Object.create(null);
  for (const agentId of Object.keys(agents)) {
    agentStates[agentId] = {
      status: "idle",
      runCount: 0,
      totalTokens: 0,
    };
  }

  // Handoff tracking
  const MAX_HANDOFF_RESULTS = maxHandoffHistory;
  const pendingHandoffs: HandoffRequest[] = [];
  const handoffResults: HandoffResult[] = [];
  let handoffCounter = 0;

  function addHandoffResult(result: HandoffResult): void {
    handoffResults.push(result);
    while (handoffResults.length > MAX_HANDOFF_RESULTS) {
      handoffResults.shift();
    }
  }

  // Approval request reverse index: requestId → agentId for O(1) approve/reject lookup
  const approvalRequestIndex = new Map<string, string>();

  // Idle waiters — notified whenever any agent's status changes
  const idleWaiters = new Set<() => void>();
  function notifyIdleWaiters(): void {
    for (const waiter of idleWaiters) {
      waiter();
    }
  }

  // ---- Cross-Agent Derivations ----
  const derivedValues: Record<string, unknown> = Object.create(null);
  const derivedChangeCallbacks = new Set<
    (id: string, value: unknown) => void
  >();

  /** Build a CrossAgentSnapshot from current state */
  function buildCrossAgentSnapshot(): CrossAgentSnapshot {
    const agentsSnap: CrossAgentSnapshot["agents"] = Object.create(null);
    for (const [id, s] of Object.entries(agentStates)) {
      agentsSnap[id] = {
        status: s.status,
        lastInput: s.lastInput,
        lastOutput: s.lastOutput,
        lastError: s.lastError,
        runCount: s.runCount,
        totalTokens: s.totalTokens,
      };
    }

    const coordFacts = getAgentFacts("__coord");
    const snapshot: CrossAgentSnapshot = {
      agents: agentsSnap,
      coordinator: {
        globalTokens: globalTokenCount,
        status: globalStatus,
      },
    };

    // Include scratchpad in snapshot if configured
    if (scratchpadConfig && coordFacts) {
      snapshot.scratchpad =
        getBridgeFact<Record<string, unknown>>(coordFacts, SCRATCHPAD_KEY) ??
        {};
    }

    return snapshot;
  }

  /** Recompute all cross-agent derivations */
  function recomputeDerivations(): void {
    if (!userDerivations) {
      return;
    }

    const snapshot = buildCrossAgentSnapshot();

    // Collect changed derivations and errors during the batch (fact writes only)
    type ChangedEntry = { derivId: string; newValue: unknown };
    type ErrorEntry = { derivId: string; derivError: unknown };
    const changed: ChangedEntry[] = [];
    const errors: ErrorEntry[] = [];

    system.batch(() => {
      for (const [derivId, derivFn] of Object.entries(userDerivations)) {
        try {
          const newValue = derivFn(snapshot);
          const oldValue = derivedValues[derivId];

          // Change detection: === for primitives, shallow equality for objects
          const hasChanged = !shallowEqual(newValue, oldValue);

          derivedValues[derivId] = newValue;

          if (hasChanged) {
            changed.push({ derivId, newValue });
          }
        } catch (derivError) {
          errors.push({ derivId, derivError });
        }
      }

      // Inject derived values into coordinator facts AFTER computation so constraints see current-cycle values
      const coordFacts = getAgentFacts("__coord");
      if (coordFacts) {
        setBridgeFact(coordFacts, "__derived", { ...derivedValues });
      }
    });

    // Fire timeline records, hooks, and callbacks outside the batch
    for (const { derivId, newValue } of changed) {
      if (timeline) {
        timeline.record({
          type: "derivation_update",
          timestamp: Date.now(),
          snapshotId: null,
          derivationId: derivId,
          valueType: typeof newValue,
        });
      }

      fireHook("onDerivationUpdate", {
        derivationId: derivId,
        value: newValue,
        timestamp: Date.now(),
      });

      for (const cb of derivedChangeCallbacks) {
        try {
          cb(derivId, newValue);
        } catch {
          // callback error is non-fatal
        }
      }
    }

    for (const { derivId, derivError } of errors) {
      if (debug) {
        console.warn(
          `[Directive MultiAgent] Derivation "${derivId}" threw:`,
          derivError,
        );
      }
      fireHook("onDerivationError", {
        derivationId: derivId,
        error:
          derivError instanceof Error
            ? derivError
            : new Error(String(derivError)),
        timestamp: Date.now(),
      });
    }
  }

  // ---- Shared Scratchpad ----
  const scratchpadChangeCallbacks = new Set<
    (key: string, value: unknown) => void
  >();
  const scratchpadKeyCallbacks = new Map<
    string,
    Set<(key: string, value: unknown) => void>
  >();

  const scratchpadInstance: Scratchpad | null = scratchpadConfig
    ? {
        get(key: string): unknown {
          const coordFacts = getAgentFacts("__coord");
          const data = getBridgeFact<Record<string, unknown>>(
            coordFacts,
            SCRATCHPAD_KEY,
          );
          if (data == null || !Object.hasOwn(data, key)) {
            return undefined;
          }

          return data[key];
        },

        set(key: string, value: unknown): void {
          if (
            key === "__proto__" ||
            key === "constructor" ||
            key === "prototype"
          ) {
            return;
          }

          const coordFacts = getAgentFacts("__coord");
          const changedKeys = [key];
          system.batch(() => {
            const current =
              getBridgeFact<Record<string, unknown>>(
                coordFacts,
                SCRATCHPAD_KEY,
              ) ?? {};
            setBridgeFact(coordFacts, SCRATCHPAD_KEY, {
              ...current,
              [key]: value,
            });
          });

          notifyScratchpadChange(changedKeys, key, value);
          recomputeDerivations();
        },

        has(key: string): boolean {
          const coordFacts = getAgentFacts("__coord");
          const data = getBridgeFact<Record<string, unknown>>(
            coordFacts,
            SCRATCHPAD_KEY,
          );

          return data != null && Object.hasOwn(data, key);
        },

        delete(key: string): void {
          if (
            key === "__proto__" ||
            key === "constructor" ||
            key === "prototype"
          ) {
            return;
          }
          const coordFacts = getAgentFacts("__coord");
          system.batch(() => {
            const current =
              getBridgeFact<Record<string, unknown>>(
                coordFacts,
                SCRATCHPAD_KEY,
              ) ?? {};
            const { [key]: _, ...rest } = current;
            setBridgeFact(coordFacts, SCRATCHPAD_KEY, rest);
          });

          notifyScratchpadChange([key], key, undefined);
          recomputeDerivations();
        },

        update(values: Record<string, unknown>): void {
          // Filter out prototype pollution keys
          const safeValues: Record<string, unknown> = Object.create(null);
          for (const k of Object.keys(values)) {
            if (k === "__proto__" || k === "constructor" || k === "prototype") {
              continue;
            }
            safeValues[k] = values[k];
          }

          const coordFacts = getAgentFacts("__coord");
          const keys = Object.keys(safeValues);
          if (keys.length === 0) {
            return;
          }

          system.batch(() => {
            const current =
              getBridgeFact<Record<string, unknown>>(
                coordFacts,
                SCRATCHPAD_KEY,
              ) ?? {};
            setBridgeFact(coordFacts, SCRATCHPAD_KEY, {
              ...current,
              ...safeValues,
            });
          });

          for (const [k, v] of Object.entries(safeValues)) {
            notifyScratchpadChange(keys, k, v);
          }
          recomputeDerivations();
        },

        getAll(): Record<string, unknown> {
          const coordFacts = getAgentFacts("__coord");

          return {
            ...(getBridgeFact<Record<string, unknown>>(
              coordFacts,
              SCRATCHPAD_KEY,
            ) ?? {}),
          };
        },

        subscribe(
          keys: string[],
          callback: (key: string, value: unknown) => void,
        ): () => void {
          for (const key of keys) {
            if (!scratchpadKeyCallbacks.has(key)) {
              scratchpadKeyCallbacks.set(key, new Set());
            }
            scratchpadKeyCallbacks.get(key)!.add(callback);
          }

          return () => {
            for (const key of keys) {
              scratchpadKeyCallbacks.get(key)?.delete(callback);
            }
          };
        },

        onChange(callback: (key: string, value: unknown) => void): () => void {
          scratchpadChangeCallbacks.add(callback);

          return () => {
            scratchpadChangeCallbacks.delete(callback);
          };
        },

        reset(): void {
          if (!scratchpadConfig) {
            return;
          }
          const coordFacts = getAgentFacts("__coord");
          system.batch(() => {
            setBridgeFact(coordFacts, SCRATCHPAD_KEY, {
              ...scratchpadConfig.init,
            });
          });
        },
      }
    : null;

  function notifyScratchpadChange(
    allKeys: string[],
    key: string,
    value: unknown,
  ): void {
    // Fire key-specific callbacks
    const keyCbs = scratchpadKeyCallbacks.get(key);
    if (keyCbs) {
      for (const cb of keyCbs) {
        try {
          cb(key, value);
        } catch {
          /* non-fatal */
        }
      }
    }

    // Fire global change callbacks
    for (const cb of scratchpadChangeCallbacks) {
      try {
        cb(key, value);
      } catch {
        /* non-fatal */
      }
    }

    // Record timeline event (once per batch of keys, not per key)
    if (timeline && key === allKeys[allKeys.length - 1]) {
      timeline.record({
        type: "scratchpad_update",
        timestamp: Date.now(),
        snapshotId: null,
        keys: allKeys,
      });
    }

    // Fire lifecycle hook (once per batch of keys)
    if (key === allKeys[allKeys.length - 1]) {
      fireHook("onScratchpadUpdate", {
        keys: allKeys,
        timestamp: Date.now(),
      });
    }
  }

  // ---- Breakpoint Infrastructure ----
  const breakpointModifications = new Map<string, BreakpointModifications>();
  const breakpointCancelReasons = new Map<string, string>();

  /** Wait for a breakpoint to be resolved or cancelled */
  function waitForBreakpointResolution(
    agentId: string,
    breakpointId: string,
    signal?: AbortSignal,
  ): Promise<BreakpointModifications | null> {
    return new Promise((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      let onAbort: (() => void) | undefined;
      const agentFacts = getAgentFacts(agentId);

      const cleanupAll = () => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (onAbort && signal) {
          signal.removeEventListener("abort", onAbort);
        }
        unsubscribe();
      };

      const unsubscribe = system.subscribe(
        [`${agentId}.${BREAKPOINT_KEY}`],
        () => {
          const bpState = getBreakpointState(agentFacts);
          if (bpState.resolved.includes(breakpointId)) {
            cleanupAll();
            const mods = breakpointModifications.get(breakpointId) ?? null;
            breakpointModifications.delete(breakpointId);

            resolve(mods);
          } else if (bpState.cancelled.includes(breakpointId)) {
            cleanupAll();
            breakpointModifications.delete(breakpointId);
            const cancelReason = breakpointCancelReasons.get(breakpointId);
            breakpointCancelReasons.delete(breakpointId);
            reject(
              new Error(
                cancelReason
                  ? `[Directive MultiAgent] Breakpoint ${breakpointId} cancelled: ${cancelReason}`
                  : `[Directive MultiAgent] Breakpoint ${breakpointId} cancelled`,
              ),
            );
          }
        },
      );

      if (signal) {
        onAbort = () => {
          cleanupAll();
          reject(
            new Error(
              `[Directive MultiAgent] Breakpoint wait aborted for ${breakpointId}`,
            ),
          );
        };
        if (signal.aborted) {
          cleanupAll();
          reject(
            new Error(
              `[Directive MultiAgent] Breakpoint wait aborted for ${breakpointId}`,
            ),
          );

          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      timeoutId = setTimeout(() => {
        cleanupAll();
        breakpointModifications.delete(breakpointId);
        breakpointCancelReasons.delete(breakpointId);
        reject(
          new Error(
            `[Directive MultiAgent] Breakpoint timeout: ${breakpointId} not resolved within ${Math.round(breakpointTimeoutMs / 1000)}s`,
          ),
        );
      }, breakpointTimeoutMs);
    });
  }

  /** Check and handle a breakpoint at a given execution point */
  async function handleBreakpoint(
    type: MultiAgentBreakpointType,
    agentId: string,
    agentName: string,
    input: string,
    signal?: AbortSignal,
    extra?: {
      patternId?: string;
      handoff?: { fromAgent: string; toAgent: string };
    },
  ): Promise<{ input: string; skip: boolean }> {
    if (breakpointConfigs.length === 0) {
      return { input, skip: false };
    }

    const agentFacts = getAgentFacts(agentId);
    const context: BreakpointContext = {
      agentId,
      agentName,
      input,
      state: getOrchestratorState(agentFacts) as unknown as Record<
        string,
        unknown
      >,
      breakpointType: type,
      patternId: extra?.patternId,
      handoff: extra?.handoff,
    };

    const matched = matchBreakpoint(breakpointConfigs, type, context);
    if (!matched) {
      return { input, skip: false };
    }

    const bpId = createBreakpointId();
    const request: BreakpointRequest = {
      id: bpId,
      type,
      agentId,
      input,
      label: matched.label,
      requestedAt: Date.now(),
    };

    // Write to facts
    system.batch(() => {
      const currentBp = getBreakpointState(agentFacts);
      setBreakpointState(agentFacts, {
        ...currentBp,
        pending: [...currentBp.pending, request],
      });
    });

    // Fire callbacks
    try {
      onBreakpoint?.(request);
    } catch {
      /* callback error non-fatal */
    }
    try {
      (hooks as any).onBreakpoint?.(request);
    } catch {
      /* hook error non-fatal */
    }

    // Record timeline event
    if (timeline) {
      timeline.record({
        type: "breakpoint_hit",
        timestamp: Date.now(),
        agentId,
        snapshotId: null,
        breakpointId: bpId,
        breakpointType: type,
        label: matched.label,
      });
    }

    // Wait for resolution
    const modifications = await waitForBreakpointResolution(
      agentId,
      bpId,
      signal,
    );

    // Record resume event
    if (timeline) {
      timeline.record({
        type: "breakpoint_resumed",
        timestamp: Date.now(),
        agentId,
        snapshotId: null,
        breakpointId: bpId,
        modified: !!modifications?.input,
        skipped: !!modifications?.skip,
      });
    }

    return {
      input: modifications?.input ?? input,
      skip: modifications?.skip ?? false,
    };
  }

  // ---- Helper: Get per-agent facts from namespaced System ----
  // biome-ignore lint/suspicious/noExplicitAny: System facts vary
  function getAgentFacts(agentId: string): any {
    return (system.facts as any)[agentId];
  }

  // ---- Helper: Wait for approval ----
  function waitForApproval(
    agentId: string,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      let onAbort: (() => void) | undefined;
      const agentFacts = getAgentFacts(agentId);

      const cleanupAll = () => {
        if (settled) return;
        settled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (onAbort && signal) {
          signal.removeEventListener("abort", onAbort);
        }
        unsubscribe();
      };

      // Use system.subscribe with namespaced key
      const unsubscribe = system.subscribe(
        [`${agentId}.${APPROVAL_KEY}`],
        () => {
          const approval = getApprovalState(agentFacts);
          if (approval.approved.includes(requestId)) {
            cleanupAll();
            resolve();
          } else {
            const rejectedRequest = approval.rejected.find(
              (r: RejectedRequest) => r.id === requestId,
            );
            if (rejectedRequest) {
              cleanupAll();
              const errorMsg = rejectedRequest.reason
                ? `Request ${requestId} rejected: ${rejectedRequest.reason}`
                : `Request ${requestId} rejected`;
              reject(new Error(errorMsg));
            }
          }
        },
      );

      // Abort signal cleanup
      if (signal) {
        onAbort = () => {
          cleanupAll();
          reject(
            new Error(
              `[Directive MultiAgent] Approval wait aborted for request ${requestId}`,
            ),
          );
        };
        if (signal.aborted) {
          cleanupAll();
          reject(
            new Error(
              `[Directive MultiAgent] Approval wait aborted for request ${requestId}`,
            ),
          );

          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      // Timeout with solution guidance
      timeoutId = setTimeout(() => {
        cleanupAll();
        const timeoutSeconds = Math.round(approvalTimeoutMs / 1000);
        reject(
          new Error(
            `[Directive MultiAgent] Approval timeout: Request ${requestId} not resolved within ${timeoutSeconds}s.\n` +
              "Solutions:\n" +
              "  1. Handle via onApprovalRequest callback and call orchestrator.approve()/reject()\n" +
              "  2. Set autoApproveToolCalls: true to auto-approve\n" +
              `  3. Increase approvalTimeoutMs (current: ${approvalTimeoutMs}ms)\n` +
              "See: https://directive.run/docs/ai/multi-agent",
          ),
        );
      }, approvalTimeoutMs);
    });
  }

  // ---- Core: Run a task (imperative code) ----
  async function runTask<T>(
    taskId: string,
    taskReg: TaskRegistration,
    input: string,
    opts?: MultiAgentRunCallOptions,
  ): Promise<RunResult<T>> {
    const label = taskReg.label ?? taskId;
    const startTime = Date.now();
    const state =
      taskStates[taskId] ?? (taskStates[taskId] = { status: "idle" });
    state.status = "running";
    state.startTime = startTime;
    state.lastError = undefined;

    // Check breakpoints — tasks don't have system modules, so only check if
    // breakpoints are configured and handle the missing agent facts gracefully
    let effectiveInput = input;
    if (breakpointConfigs.length > 0) {
      try {
        const bpResult = await handleBreakpoint(
          "pre_agent_run",
          taskId,
          label,
          input,
          opts?.signal,
        );
        if (bpResult.skip) {
          state.status = "completed";

          return {
            output: undefined as T,
            messages: [],
            toolCalls: [],
            totalTokens: 0,
          };
        }
        effectiveInput = bpResult.input;
      } catch {
        // Tasks don't have system facts — breakpoint state access may fail.
        // Fall through with original input.
      }
    }

    // Emit timeline event
    if (timeline) {
      timeline.record({
        type: "task_start",
        timestamp: startTime,
        agentId: taskId,
        snapshotId: null,
        taskId,
        label,
        description: taskReg.description,
        inputLength: effectiveInput.length,
        input: effectiveInput.slice(0, MAX_VERBOSE_LENGTH),
      });
    }

    // Fire hook
    const effectivePatternId = opts?.patternId ?? "";
    fireHook("onTaskStart", {
      patternId: effectivePatternId,
      taskId,
      label,
      timestamp: startTime,
    });

    // Semaphore for maxConcurrent
    const sem = taskSemaphores.get(taskId);

    // Build TaskContext with deep-cloned memory and scratchpad
    const buildContext = (): TaskContext => ({
      taskId,
      memory: sharedMemory
        ? (structuredClone(
            sharedMemory.getContextMessages?.() ?? [],
          ) as ReadonlyArray<{ role: string; content: string }>)
        : [],
      scratchpad: scratchpadInstance
        ? Object.freeze(structuredClone(scratchpadInstance.getAll()))
        : Object.freeze({}),
      readAgentState: (nodeId: string) => {
        // Check agent states first, then task states
        const agentState = agentStates[nodeId];
        if (agentState) {
          return Object.freeze({
            status: agentState.status,
            lastOutput:
              agentState.lastOutput != null
                ? String(agentState.lastOutput)
                : undefined,
            lastError: agentState.lastError,
            totalTokens: agentState.totalTokens,
          });
        }
        const taskState = taskStates[nodeId];
        if (taskState) {
          return Object.freeze({
            status: taskState.status,
            lastOutput:
              taskState.lastOutput != null
                ? String(taskState.lastOutput)
                : undefined,
            lastError: taskState.lastError,
            totalTokens: 0,
          });
        }

        return undefined;
      },
      reportProgress: (percent: number, message?: string) => {
        const clampedPercent = Number.isFinite(percent)
          ? Math.max(0, Math.min(100, percent))
          : 0;
        if (timeline) {
          timeline.record({
            type: "task_progress",
            timestamp: Date.now(),
            agentId: taskId,
            snapshotId: null,
            taskId,
            label,
            percent: clampedPercent,
            message,
          });
        }
        fireHook("onTaskProgress", {
          patternId: effectivePatternId,
          taskId,
          label,
          percent: clampedPercent,
          message,
          timestamp: Date.now(),
        });
      },
    });

    const maxAttempts = taskReg.retry?.attempts ?? 1;
    const backoff = taskReg.retry?.backoff ?? "fixed";
    const baseDelay = taskReg.retry?.delayMs ?? 1000;
    let lastError: Error | undefined;

    const executeAttempt = async (signal: AbortSignal): Promise<unknown> => {
      const context = buildContext();

      return taskReg.run(effectiveInput, signal, context);
    };

    let releaseFn: (() => void) | null = null;

    try {
      if (sem) {
        releaseFn = await sem.acquire();
      }

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const abortController = new AbortController();
        let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

        // Chain with external signal — store handler for cleanup
        const abortHandler = () => abortController.abort();
        if (opts?.signal) {
          if (opts.signal.aborted) {
            throw new Error(
              `[Directive MultiAgent] Task "${taskId}" aborted before starting`,
            );
          }
          opts.signal.addEventListener("abort", abortHandler, { once: true });
        }

        // Timeout
        if (taskReg.timeout) {
          timeoutTimer = setTimeout(
            () => abortController.abort(),
            taskReg.timeout,
          );
        }

        try {
          const rawOutput = await executeAttempt(abortController.signal);
          if (timeoutTimer) {
            clearTimeout(timeoutTimer);
          }

          // Stringify non-string output
          const output =
            typeof rawOutput === "string"
              ? rawOutput
              : safeStringify(rawOutput);
          const durationMs = Date.now() - startTime;

          state.status = "completed";
          state.lastOutput = output;
          state.durationMs = durationMs;

          // Emit timeline event
          if (timeline) {
            timeline.record({
              type: "task_complete",
              timestamp: Date.now(),
              agentId: taskId,
              snapshotId: null,
              taskId,
              label,
              durationMs,
              output,
            });
          }

          // Fire hooks
          fireHook("onTaskComplete", {
            patternId: opts?.patternId ?? "",
            taskId,
            label,
            durationMs,
            timestamp: Date.now(),
          });

          // Update coordinator fact for constraint reactivity
          try {
            const coordFacts = system.read("__coord");
            setBridgeFact(coordFacts as any, "__lastTaskCompletion" as any, {
              taskId,
              timestamp: Date.now(),
            });
          } catch {
            // non-fatal: system might be disposed
          }

          return {
            output: output as T,
            messages: [],
            toolCalls: [],
            totalTokens: 0,
          };
        } catch (err) {
          if (timeoutTimer) {
            clearTimeout(timeoutTimer);
          }
          lastError = err instanceof Error ? err : new Error(String(err));

          // Emit per-attempt error if retrying
          if (attempt < maxAttempts) {
            if (timeline) {
              timeline.record({
                type: "task_error",
                timestamp: Date.now(),
                agentId: taskId,
                snapshotId: null,
                taskId,
                label,
                error: lastError.message,
                durationMs: Date.now() - startTime,
                attempt,
              });
            }

            // Backoff with cap and abort-awareness
            const MAX_BACKOFF_MS = 30_000;
            const rawDelay =
              backoff === "exponential"
                ? baseDelay * 2 ** (attempt - 1)
                : baseDelay;
            const delay = Math.min(rawDelay, MAX_BACKOFF_MS);
            await new Promise<void>((resolve, reject) => {
              let settled = false;
              const onAbort = () => {
                if (!settled) {
                  settled = true;
                  clearTimeout(timer);
                  reject(
                    new Error(
                      `[Directive MultiAgent] Task "${taskId}" aborted during retry backoff`,
                    ),
                  );
                }
              };
              const timer = setTimeout(() => {
                settled = true;
                opts?.signal?.removeEventListener("abort", onAbort);
                resolve();
              }, delay);
              if (opts?.signal) {
                opts.signal.addEventListener("abort", onAbort, { once: true });
              }
            });
          }
        } finally {
          // Clean up abort listener to prevent accumulation
          opts?.signal?.removeEventListener("abort", abortHandler);
        }
      }

      // All attempts exhausted
      const durationMs = Date.now() - startTime;
      state.status = "error";
      state.lastError = lastError?.message;
      state.durationMs = durationMs;

      // Emit final error event
      if (timeline) {
        timeline.record({
          type: "task_error",
          timestamp: Date.now(),
          agentId: taskId,
          snapshotId: null,
          taskId,
          label,
          error: lastError?.message ?? "Unknown error",
          durationMs,
        });
      }

      fireHook("onTaskError", {
        patternId: effectivePatternId,
        taskId,
        label,
        error: lastError!,
        durationMs,
        timestamp: Date.now(),
      });

      // Note: Tasks bypass the circuit breaker's execute() wrapper (tasks are imperative
      // code, not LLM calls). Task failure recovery is handled by the retry config on
      // TaskRegistration. The CB's execute() is only used for agent runs.

      throw lastError;
    } finally {
      releaseFn?.();
    }
  }

  // ---- Core: Run a single agent ----
  async function runSingleAgent<T>(
    agentId: string,
    input: string,
    opts?: MultiAgentRunCallOptions,
  ): Promise<RunResult<T>> {
    assertNotDisposed();

    if (opts?.signal?.aborted) {
      throw new Error(
        `[Directive MultiAgent] Handler "${agentId}" run aborted before starting`,
      );
    }

    if (globalStatus === "paused") {
      throw new Error(
        "[Directive MultiAgent] Orchestrator is paused (budget exceeded or manual pause)",
      );
    }

    // Increment synchronously before any await so waitForIdle knows a run is pending
    pendingRuns++;

    try {
      // Check if this is a task (imperative code), not an agent (LLM call)
      const taskReg = tasks[agentId];
      if (taskReg) {
        return await runTask<T>(agentId, taskReg, input, opts);
      }

      const registration = agents[agentId];
      if (!registration) {
        const available =
          [...Object.keys(agents), ...Object.keys(tasks)].join(", ") ||
          "(none)";

        throw new Error(
          `[Directive MultiAgent] Unknown handler "${agentId}". Registered handlers: ${available}`,
        );
      }

      const effectiveCircuitBreaker =
        registration.circuitBreaker ?? orchestratorCircuitBreaker;
      if (effectiveCircuitBreaker) {
        return await effectiveCircuitBreaker.execute(() =>
          runSingleAgentInner<T>(agentId, registration, input, opts),
        );
      }

      return await runSingleAgentInner<T>(agentId, registration, input, opts);
    } catch (error) {
      // Self-healing: attempt reroute if configured and this is a CB error or health threshold
      // Tasks are imperative code — self-healing reroute/degradation only applies to agents
      if (
        selfHealing &&
        !tasks[agentId] &&
        !(opts as { __isReroute?: boolean })?.__isReroute
      ) {
        const equivalents = findEquivalentAgents(agentId);
        const alternate = selectBestEquivalent(equivalents);
        if (alternate) {
          const rerouteEvent: RerouteEvent = {
            originalAgent: agentId,
            reroutedTo: alternate,
            reason: error instanceof Error ? error.message : String(error),
            timestamp: Date.now(),
          };

          try {
            selfHealing.onReroute?.(rerouteEvent);
          } catch {
            // callback error is non-fatal
          }
          fireHook("onReroute", rerouteEvent);

          if (timeline) {
            timeline.record({
              type: "reroute",
              timestamp: Date.now(),
              agentId,
              snapshotId: null,
              from: agentId,
              to: alternate,
              reason: error instanceof Error ? error.message : String(error),
            });
          }

          // Prevent circular reroute (max 1 hop)
          return runSingleAgent<T>(alternate, input, {
            ...opts,
            __isReroute: true,
          } as any);
        }

        // No equivalents — apply degradation policy
        if (
          selfHealing.degradation === "fallback-response" &&
          selfHealing.fallbackResponse !== undefined
        ) {
          return {
            output: selfHealing.fallbackResponse as T,
            messages: [],
            toolCalls: [],
            totalTokens: 0,
          };
        }
      }

      // Update state for errors that happen before semaphore acquisition
      const state = agentStates[agentId];
      if (state && state.status !== "error") {
        state.status = "error";
        state.lastError =
          error instanceof Error ? error.message : String(error);
      }

      throw error;
    } finally {
      pendingRuns--;
      notifyIdleWaiters();
    }
  }

  async function runSingleAgentInner<T>(
    agentId: string,
    registration: AgentRegistration,
    originalInput: string,
    opts?: MultiAgentRunCallOptions,
  ): Promise<RunResult<T>> {
    const startTime = Date.now();
    const agentFacts = getAgentFacts(agentId);
    const state = agentStates[agentId]!;
    let agent = registration.agent;
    let processedInput = originalInput;

    // Acquire semaphore slot
    const semaphore = semaphores.get(agentId);
    if (!semaphore) {
      const available = Object.keys(agents).join(", ") || "(none)";

      throw new Error(
        `[Directive MultiAgent] Unknown agent "${agentId}". Registered agents: ${available}`,
      );
    }
    const release = await semaphore.acquire(opts?.signal);

    // Create timeout if specified
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let abortHandler: (() => void) | undefined;

    try {
      if (registration.timeout) {
        timeoutId = setTimeout(() => controller.abort(), registration.timeout);
      }
      if (opts?.signal) {
        abortHandler = () => controller.abort();
        opts.signal.addEventListener("abort", abortHandler, { once: true });
      }

      // Inject memory context
      const effectiveMemory = registration.memory ?? sharedMemory;
      if (effectiveMemory) {
        const contextMessages = effectiveMemory.getContextMessages();
        if (contextMessages.length > 0) {
          const contextStr = contextMessages
            .map((m) => `${m.role}: ${m.content}`)
            .join("\n");
          agent = {
            ...agent,
            instructions:
              (agent.instructions ?? "") +
              "\n\nConversation context:\n" +
              contextStr,
          };
        }
      }

      // ---- Breakpoint: pre_input_guardrails ----
      {
        const bpResult = await handleBreakpoint(
          "pre_input_guardrails",
          agentId,
          agent.name,
          processedInput,
          opts?.signal,
        );
        if (bpResult.skip) {
          state.status = "completed";
          notifyIdleWaiters();

          return {
            output: undefined as T,
            messages: [],
            toolCalls: [],
            totalTokens: 0,
          };
        }
        processedInput = bpResult.input;
      }

      // ---- Input guardrails BEFORE agent_start so timeline shows correct order ----
      const allInputGuardrails = [
        ...(guardrails.input ?? []),
        ...(registration.guardrails?.input ?? []),
      ];
      const inputGuardrailsList = allInputGuardrails.map((g, i) =>
        normalizeGuardrail(g, i, "input"),
      );
      for (const guardrail of inputGuardrailsList) {
        const { name } = guardrail;
        const context = {
          agentName: agent.name,
          input: processedInput,
          facts: getOrchestratorState(agentFacts) as unknown as Record<
            string,
            unknown
          >,
        };
        const guardStartTime = Date.now();
        const result = await executeGuardrailWithRetry(
          guardrail,
          { input: processedInput, agentName: agent.name },
          context,
        );
        fireHook("onGuardrailCheck", {
          agentId,
          guardrailName: name,
          guardrailType: "input",
          passed: result.passed,
          reason: result.reason,
          durationMs: Date.now() - guardStartTime,
          timestamp: Date.now(),
        });
        if (!result.passed) {
          throw new GuardrailError({
            code: "INPUT_GUARDRAIL_FAILED",
            message: `Input guardrail "${name}" failed: ${result.reason}`,
            guardrailName: name,
            guardrailType: "input",
            userMessage: result.reason ?? "Input validation failed",
            agentName: agent.name,
            input: processedInput,
          });
        }
        if (result.transformed !== undefined) {
          processedInput = result.transformed as string;
        }
      }

      // Fire onAgentStart hook (after guardrails pass)
      fireHook("onAgentStart", {
        agentId,
        agentName: agent.name,
        input: processedInput,
        timestamp: startTime,
      });

      // Record timeline event
      if (timeline) {
        timeline.record({
          type: "agent_start",
          timestamp: Date.now(),
          agentId,
          snapshotId: null,
          inputLength: processedInput.length,
          ...("description" in agent && agent.description
            ? { description: String(agent.description) }
            : {}),
          ...(agent.instructions
            ? { instructions: agent.instructions.slice(0, MAX_VERBOSE_LENGTH) }
            : {}),
          input: processedInput.slice(0, MAX_VERBOSE_LENGTH),
        });
      }

      // Update per-agent facts
      system.batch(() => {
        const currentAgent = getAgentState(agentFacts);
        setAgentState(agentFacts, {
          ...currentAgent,
          status: "running",
          input: processedInput,
          startedAt: Date.now(),
        });
      });
      state.status = "running";
      state.lastInput = processedInput;

      // ---- Breakpoint: pre_agent_run ----
      {
        const bpResult = await handleBreakpoint(
          "pre_agent_run",
          agentId,
          agent.name,
          processedInput,
          opts?.signal,
        );
        if (bpResult.skip) {
          state.status = "completed";
          notifyIdleWaiters();

          return {
            output: undefined as T,
            messages: [],
            toolCalls: [],
            totalTokens: 0,
          };
        }
        processedInput = bpResult.input;
      }

      // ---- Per-agent structured output wrapping (per-call overrides per-agent) ----
      let effectiveRunner: AgentRunner = runner;
      const effectiveSchema =
        opts?.outputSchema !== undefined
          ? opts.outputSchema // null = opt-out, SafeParseable = override
          : registration.outputSchema; // per-agent default
      if (effectiveSchema) {
        effectiveRunner = withStructuredOutput(runner, {
          schema: effectiveSchema,
          maxRetries:
            opts?.maxSchemaRetries ?? registration.maxSchemaRetries ?? 2,
          extractJson: registration.extractJson,
          schemaDescription: registration.schemaDescription,
        });
      }

      // Effective retry config: per-agent overrides orchestrator default
      const effectiveRetry = registration.retry ?? defaultAgentRetry;

      // Run agent with retry support
      const result = await executeAgentWithRetry<T>(
        effectiveRunner,
        agent,
        processedInput,
        {
          ...registration.runOptions,
          ...opts,
          signal: controller.signal,
          onMessage: (message) => {
            const currentConversation = getConversation(agentFacts);
            const updated = [...currentConversation, message];
            setConversation(
              agentFacts,
              updated.length > MAX_CONVERSATION_MESSAGES
                ? updated.slice(-MAX_CONVERSATION_MESSAGES)
                : updated,
            );
            opts?.onMessage?.(message);
          },
          onToolCall: async (toolCall) => {
            // ---- Tool call guardrails: orchestrator-level, then per-agent ----
            const allToolCallGuardrails = [
              ...(guardrails.toolCall ?? []),
              ...(registration.guardrails?.toolCall ?? []),
            ];
            const toolCallGuardrailsList = allToolCallGuardrails.map((g, i) =>
              normalizeGuardrail(g, i, "toolCall"),
            );
            for (const guardrail of toolCallGuardrailsList) {
              const { name } = guardrail;
              const context = {
                agentName: agent.name,
                input: processedInput,
                facts: getOrchestratorState(agentFacts) as unknown as Record<
                  string,
                  unknown
                >,
              };
              const guardStartTime = Date.now();
              const guardResult = await executeGuardrailWithRetry(
                guardrail,
                { toolCall, agentName: agent.name, input: processedInput },
                context,
              );
              fireHook("onGuardrailCheck", {
                agentId,
                guardrailName: name,
                guardrailType: "toolCall",
                passed: guardResult.passed,
                reason: guardResult.reason,
                durationMs: Date.now() - guardStartTime,
                timestamp: Date.now(),
              });
              if (!guardResult.passed) {
                throw new GuardrailError({
                  code: "TOOL_CALL_GUARDRAIL_FAILED",
                  message: `Tool call guardrail "${name}" failed: ${guardResult.reason}`,
                  guardrailName: name,
                  guardrailType: "toolCall",
                  userMessage: guardResult.reason ?? "Tool call blocked",
                  data: { toolCall },
                  agentName: agent.name,
                  input: processedInput,
                });
              }
            }

            // Approval workflow
            if (!autoApproveToolCalls) {
              const approvalId = `tool-${agentId}-${toolCall.id}`;
              const approvalRequest: ApprovalRequest = {
                id: approvalId,
                type: "tool_call",
                agentName: agent.name,
                description: `Tool call: ${toolCall.name}`,
                data: toolCall,
                requestedAt: Date.now(),
              };

              approvalRequestIndex.set(approvalId, agentId);
              system.batch(() => {
                const currentApproval = getApprovalState(agentFacts);
                setApprovalState(agentFacts, {
                  ...currentApproval,
                  pending: [...currentApproval.pending, approvalRequest],
                });
              });

              onApprovalRequest?.(approvalRequest);
              await waitForApproval(agentId, approvalId, opts?.signal);
            }

            const currentToolCalls = getToolCalls(agentFacts);
            const updatedToolCalls = [...currentToolCalls, toolCall];
            setToolCalls(
              agentFacts,
              updatedToolCalls.length > MAX_TOOL_CALLS
                ? updatedToolCalls.slice(-MAX_TOOL_CALLS)
                : updatedToolCalls,
            );
            opts?.onToolCall?.(toolCall);
          },
        },
        effectiveRetry
          ? {
              ...effectiveRetry,
              onRetry: (attempt, error, delayMs) => {
                effectiveRetry.onRetry?.(attempt, error, delayMs);
                fireHook("onAgentRetry", {
                  agentId,
                  agentName: agent.name,
                  input: processedInput,
                  attempt,
                  error,
                  delayMs,
                  timestamp: Date.now(),
                });
              },
            }
          : undefined,
      );

      // ---- Breakpoint: pre_output_guardrails ----
      {
        const bpResult = await handleBreakpoint(
          "pre_output_guardrails",
          agentId,
          agent.name,
          processedInput,
          opts?.signal,
        );
        if (bpResult.skip) {
          // Skip output guardrails, return result directly
          state.status = "completed";
          notifyIdleWaiters();

          return result;
        }
      }

      // ---- Output guardrails: orchestrator-level, then per-agent ----
      const allOutputGuardrails = [
        ...(guardrails.output ?? []),
        ...(registration.guardrails?.output ?? []),
      ];
      const outputGuardrailsList = allOutputGuardrails.map((g, i) =>
        normalizeGuardrail(g, i, "output"),
      );
      for (const guardrail of outputGuardrailsList) {
        const { name } = guardrail;
        const context = {
          agentName: agent.name,
          input: processedInput,
          facts: getOrchestratorState(agentFacts) as unknown as Record<
            string,
            unknown
          >,
        };
        const guardStartTime = Date.now();
        const guardResult = await executeGuardrailWithRetry(
          guardrail,
          {
            output: result.output,
            agentName: agent.name,
            input: processedInput,
            messages: result.messages,
          },
          context,
        );
        fireHook("onGuardrailCheck", {
          agentId,
          guardrailName: name,
          guardrailType: "output",
          passed: guardResult.passed,
          reason: guardResult.reason,
          durationMs: Date.now() - guardStartTime,
          timestamp: Date.now(),
        });
        if (!guardResult.passed) {
          throw new GuardrailError({
            code: "OUTPUT_GUARDRAIL_FAILED",
            message: `Output guardrail "${name}" failed: ${guardResult.reason}`,
            guardrailName: name,
            guardrailType: "output",
            userMessage: guardResult.reason ?? "Output validation failed",
            agentName: agent.name,
            input: processedInput,
          });
        }
        if (guardResult.transformed !== undefined) {
          (result as { output: unknown }).output = guardResult.transformed;
        }
      }

      // Update per-agent facts
      system.batch(() => {
        const currentAgent = getAgentState(agentFacts);
        setAgentState(agentFacts, {
          ...currentAgent,
          status: "completed",
          output: result.output,
          tokenUsage: currentAgent.tokenUsage + result.totalTokens,
          turnCount: currentAgent.turnCount + result.messages.length,
          completedAt: Date.now(),
        });
      });

      // Update local state
      state.status = "completed";
      state.lastOutput = result.output;
      state.runCount++;
      state.totalTokens += result.totalTokens;
      notifyIdleWaiters();

      // Update global token count atomically via System facts
      // Use read-modify-write inside batch to prevent desync from concurrent runs
      const coordFacts = getAgentFacts("__coord");
      let shouldFireBudgetWarning = false;
      let budgetPercentage = 0;
      system.batch(() => {
        const currentTokens = getBridgeFact<number>(
          coordFacts,
          "__globalTokens",
        );
        const newTotal = currentTokens + result.totalTokens;
        globalTokenCount = newTotal;
        setBridgeFact(coordFacts, "__globalTokens", newTotal);

        // Check budget warning threshold
        if (maxTokenBudget && onBudgetWarning) {
          budgetPercentage = newTotal / maxTokenBudget;
          const warningFired = getBridgeFact<boolean>(
            coordFacts,
            "__budgetWarningFired",
          );
          if (budgetPercentage >= budgetWarningThreshold && !warningFired) {
            setBridgeFact(coordFacts, "__budgetWarningFired", true);
            shouldFireBudgetWarning = true;
          }
        }
      });

      // Fire budget warning callback outside of batch (callbacks shouldn't run inside batch)
      if (shouldFireBudgetWarning) {
        try {
          onBudgetWarning!({
            currentTokens: globalTokenCount,
            maxBudget: maxTokenBudget!,
            percentage: budgetPercentage,
          });
        } catch (callbackError) {
          if (debug) {
            console.debug(
              "[Directive MultiAgent] onBudgetWarning threw:",
              callbackError,
            );
          }
        }
      }

      // Store messages in memory (best-effort — don't fail the run on memory errors)
      // Only store the user message once — agent-utils includes it in every result,
      // but memory already has it from the first agent call in a conversation.
      if (effectiveMemory && result.messages.length > 0) {
        try {
          const existingMessages = effectiveMemory.getContextMessages();
          const hasUserMessage = existingMessages.some(
            (m) => m.role === "user" && m.content === processedInput,
          );
          const messagesToStore = hasUserMessage
            ? result.messages.filter(
                (m) => !(m.role === "user" && m.content === processedInput),
              )
            : result.messages;
          effectiveMemory.addMessages(messagesToStore);
        } catch (memoryError) {
          if (debug) {
            console.debug(
              "[Directive MultiAgent] Memory addMessages failed:",
              memoryError,
            );
          }
        }
      }

      // Fire onAgentComplete hook
      fireHook("onAgentComplete", {
        agentId,
        agentName: agent.name,
        input: processedInput,
        output: result.output,
        tokenUsage: result.totalTokens,
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
      });

      // Record timeline event
      if (timeline) {
        const outputStr =
          typeof result.output === "string"
            ? result.output
            : safeStringify(result.output);
        timeline.record({
          type: "agent_complete",
          timestamp: Date.now(),
          agentId,
          snapshotId: null,
          outputLength: outputStr.length,
          totalTokens: result.totalTokens,
          inputTokens: result.tokenUsage?.inputTokens ?? 0,
          outputTokens: result.tokenUsage?.outputTokens ?? 0,
          durationMs: Date.now() - startTime,
          modelId: registration.agent.model ?? undefined,
          output: outputStr.slice(0, MAX_VERBOSE_LENGTH),
        });
      }

      // Record health success
      if (healthMonitorInstance) {
        healthMonitorInstance.recordSuccess(agentId, Date.now() - startTime);
      }

      // Recompute cross-agent derivations
      recomputeDerivations();

      // ---- Breakpoint: post_run ----
      await handleBreakpoint(
        "post_run",
        agentId,
        agent.name,
        processedInput,
        opts?.signal,
      );

      return result;
    } catch (error) {
      state.status = "error";
      state.lastError = error instanceof Error ? error.message : String(error);
      notifyIdleWaiters();

      // Update per-agent facts with error
      system.batch(() => {
        const currentAgent = getAgentState(agentFacts);
        setAgentState(agentFacts, {
          ...currentAgent,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
          completedAt: Date.now(),
        });
      });

      // Fire onAgentError hook
      fireHook("onAgentError", {
        agentId,
        agentName: agent.name,
        input: processedInput,
        error: error instanceof Error ? error : new Error(String(error)),
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
      });

      // Record timeline event
      if (timeline) {
        const base: Record<string, unknown> = {
          type: "agent_error",
          timestamp: Date.now(),
          agentId,
          snapshotId: null,
          errorMessage: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        };
        if (isGuardrailError(error)) {
          base.guardrailName = error.guardrailName;
          base.guardrailType = error.guardrailType;
          base.errorCode = error.code;
        }
        timeline.record(base as any);
      }

      // Record health failure
      if (healthMonitorInstance) {
        healthMonitorInstance.recordFailure(
          agentId,
          Date.now() - startTime,
          error instanceof Error ? error : new Error(String(error)),
        );
      }

      // Recompute cross-agent derivations
      recomputeDerivations();

      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (abortHandler && opts?.signal) {
        opts.signal.removeEventListener("abort", abortHandler);
      }
      release();
    }
  }

  // ---- Streaming ----
  function runAgentStreamImpl<T>(
    agentId: string,
    input: string,
    options: { signal?: AbortSignal } = {},
  ): OrchestratorStreamResult<T> {
    assertNotDisposed();

    // Task streaming: run task, emit single chunk + done
    const taskReg = tasks[agentId];
    if (taskReg) {
      const taskChunks: OrchestratorStreamChunk[] = [];
      const taskWaiters: Array<
        (chunk: OrchestratorStreamChunk | null) => void
      > = [];
      let taskClosed = false;

      const pushTaskChunk = (chunk: OrchestratorStreamChunk) => {
        if (taskClosed) {
          return;
        }
        const waiter = taskWaiters.shift();
        if (waiter) {
          waiter(chunk);
        } else {
          taskChunks.push(chunk);
        }
      };

      const closeTaskStream = () => {
        taskClosed = true;
        for (const w of taskWaiters) {
          w(null);
        }
        taskWaiters.length = 0;
      };

      const taskAbortController = new AbortController();
      // Wire external signal into task-local controller
      let taskExternalAbortHandler: (() => void) | undefined;
      if (options.signal) {
        if (options.signal.aborted) {
          taskAbortController.abort();
        } else {
          taskExternalAbortHandler = () => taskAbortController.abort();
          options.signal.addEventListener("abort", taskExternalAbortHandler, {
            once: true,
          });
        }
      }

      const resultPromise = runSingleAgent<T>(agentId, input, {
        signal: taskAbortController.signal,
      })
        .then(
          (result) => {
            const output =
              typeof result.output === "string"
                ? result.output
                : safeStringify(result.output);
            pushTaskChunk({ type: "token", data: output, tokenCount: 0 });
            pushTaskChunk({
              type: "done",
              totalTokens: 0,
              duration: 0,
              droppedTokens: 0,
            });
            closeTaskStream();

            return result;
          },
          (err) => {
            pushTaskChunk({ type: "error", error: err });
            closeTaskStream();
            throw err;
          },
        )
        .finally(() => {
          if (taskExternalAbortHandler && options.signal) {
            options.signal.removeEventListener(
              "abort",
              taskExternalAbortHandler,
            );
          }
        });

      // Prevent unhandled rejection if no one awaits .result
      resultPromise.catch(() => {});

      return {
        stream: {
          async *[Symbol.asyncIterator]() {
            while (true) {
              const chunk = taskChunks.shift();
              if (chunk) {
                yield chunk;
                if (chunk.type === "done" || chunk.type === "error") {
                  return;
                }
              } else if (taskClosed) {
                return;
              } else {
                const next = await new Promise<OrchestratorStreamChunk | null>(
                  (resolve) => taskWaiters.push(resolve),
                );
                if (!next) {
                  return;
                }
                yield next;
                if (next.type === "done" || next.type === "error") {
                  return;
                }
              }
            }
          },
        },
        result: resultPromise,
        abort: () => {
          taskAbortController.abort();
        },
      } as OrchestratorStreamResult<T>;
    }

    const registration = agents[agentId];
    if (!registration) {
      const available =
        [...Object.keys(agents), ...Object.keys(tasks)].join(", ") || "(none)";

      throw new Error(
        `[Directive MultiAgent] Unknown handler "${agentId}". Registered handlers: ${available}`,
      );
    }

    const MAX_AGENT_STREAM_BUFFER = 10_000;
    const MAX_ACCUMULATED_OUTPUT = 100_000;
    const abortController = new AbortController();
    const chunks: OrchestratorStreamChunk[] = [];
    const waiters: Array<(chunk: OrchestratorStreamChunk | null) => void> = [];
    let closed = false;
    const startTime = Date.now();
    let tokenCount = 0;
    let accumulatedOutput = "";

    let abortHandler: (() => void) | undefined;
    if (options.signal) {
      abortHandler = () => abortController.abort();
      options.signal.addEventListener("abort", abortHandler, { once: true });
    }

    const cleanup = () => {
      if (abortHandler && options.signal) {
        options.signal.removeEventListener("abort", abortHandler);
      }
    };

    const pushChunk = (chunk: OrchestratorStreamChunk) => {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter) {
        waiter(chunk);
      } else {
        if (chunks.length >= MAX_AGENT_STREAM_BUFFER) {
          chunks.shift();
        }
        chunks.push(chunk);
      }
    };

    const closeStream = () => {
      closed = true;
      cleanup();
      for (const waiter of waiters) {
        waiter(null);
      }
      waiters.length = 0;
    };

    const resultPromise = (async (): Promise<RunResult<T>> => {
      pushChunk({
        type: "progress",
        phase: "starting",
        message: "Running input guardrails",
      });

      try {
        const result = await runSingleAgent<T>(agentId, input, {
          signal: abortController.signal,
          onMessage: (message) => {
            pushChunk({ type: "message", message });
            if (message.role === "assistant" && message.content) {
              const newTokens = Math.ceil(message.content.length / 4);
              tokenCount += newTokens;
              accumulatedOutput += message.content;
              if (accumulatedOutput.length > MAX_ACCUMULATED_OUTPUT) {
                accumulatedOutput = accumulatedOutput.slice(
                  -MAX_ACCUMULATED_OUTPUT,
                );
              }
              pushChunk({ type: "token", data: message.content, tokenCount });
            }
          },
          onToolCall: async (toolCall) => {
            pushChunk({
              type: "tool_start",
              tool: toolCall.name,
              toolCallId: toolCall.id,
              arguments: toolCall.arguments,
            });
            if (toolCall.result) {
              pushChunk({
                type: "tool_end",
                tool: toolCall.name,
                toolCallId: toolCall.id,
                result: toolCall.result,
              });
            }
          },
        });

        const duration = Date.now() - startTime;
        pushChunk({
          type: "done",
          totalTokens: result.totalTokens,
          duration,
          droppedTokens: 0,
        });
        closeStream();

        return result;
      } catch (error) {
        if (error instanceof GuardrailError) {
          pushChunk({
            type: "guardrail_triggered",
            guardrailName: error.guardrailName,
            reason: error.message,
            partialOutput: accumulatedOutput,
            stopped: true,
          });
        }
        pushChunk({
          type: "error",
          error: error instanceof Error ? error : new Error(String(error)),
        });
        closeStream();
        throw error;
      }
    })();

    const stream: AsyncIterable<OrchestratorStreamChunk> = {
      [Symbol.asyncIterator](): AsyncIterator<OrchestratorStreamChunk> {
        return {
          async next(): Promise<IteratorResult<OrchestratorStreamChunk>> {
            if (chunks.length > 0) {
              return { done: false, value: chunks.shift()! };
            }
            if (closed) {
              return { done: true, value: undefined };
            }

            return new Promise<IteratorResult<OrchestratorStreamChunk>>(
              (resolve) => {
                waiters.push((chunk) => {
                  if (chunk === null) {
                    resolve({ done: true, value: undefined });
                  } else {
                    resolve({ done: false, value: chunk });
                  }
                });
              },
            );
          },
        };
      },
    };

    // Prevent unhandled rejection if caller only consumes stream (not .result)
    resultPromise.catch(() => {});

    return {
      stream,
      result: resultPromise,
      abort: () => {
        abortController.abort();
        closeStream();
      },
    };
  }

  // ---- Pattern Runners ----
  async function runParallelPattern<T>(
    pattern: ParallelPattern<T>,
    input: string,
    patternId?: string,
  ): Promise<T> {
    const patternStartTime = Date.now();
    if (patternId) {
      fireHook("onPatternStart", {
        patternId,
        patternType: "parallel",
        input,
        timestamp: patternStartTime,
      });
    }

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (pattern.timeout) {
      timeoutId = setTimeout(() => controller.abort(), pattern.timeout);
    }

    let patternError: Error | undefined;
    try {
      const promises = pattern.handlers.map((agentId) =>
        runSingleAgent(agentId, input, {
          signal: controller.signal,
          patternId,
        }).catch((error) => {
          if (pattern.minSuccess === undefined) {
            throw error;
          }

          return null;
        }),
      );

      const results = await Promise.all(promises);
      const successResults = results.filter(
        (r): r is RunResult<unknown> => r !== null,
      );

      if (
        pattern.minSuccess !== undefined &&
        successResults.length < pattern.minSuccess
      ) {
        const failCount = results.length - successResults.length;

        throw new Error(
          `[Directive MultiAgent] Parallel pattern: Only ${successResults.length}/${pattern.handlers.length} agents succeeded ` +
            `(minimum required: ${pattern.minSuccess}, failed: ${failCount})`,
        );
      }

      return pattern.merge(successResults);
    } catch (error) {
      patternError = error instanceof Error ? error : new Error(String(error));
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (patternId) {
        fireHook("onPatternComplete", {
          patternId,
          patternType: "parallel",
          durationMs: Date.now() - patternStartTime,
          timestamp: Date.now(),
          error: patternError,
        });
      }
    }
  }

  // ---- Shared checkpoint helper ----

  /** Save a pattern checkpoint state to the configured store */
  async function savePatternCheckpoint(
    state: PatternCheckpointState,
    store: CheckpointStore,
    config?: PatternCheckpointConfig,
  ): Promise<string | null> {
    const step = getPatternStep(state);

    // Conditional: evaluate when() predicate
    if (config?.when) {
      try {
        const shouldSave = config.when({
          step,
          patternType: state.type,
          facts:
            state.type === "goal"
              ? (state as GoalCheckpointState).facts
              : undefined,
          satisfaction:
            state.type === "goal"
              ? (state as GoalCheckpointState).lastSatisfaction
              : undefined,
        });
        if (!shouldSave) {
          return null;
        }
      } catch {
        // If when() throws, skip this checkpoint
        return null;
      }
    }

    try {
      const checkpoint: Checkpoint = {
        version: 1,
        id: state.id,
        createdAt: state.createdAt,
        label: state.label,
        systemExport: JSON.stringify(state),
        timelineExport: null,
        localState: {
          type: "multi",
          globalTokenCount: 0,
          globalStatus: "idle",
          agentStates: {},
          handoffCounter: 0,
          pendingHandoffs: [],
          handoffResults: [],
          roundRobinCounters: null,
        },
        memoryExport: null,
        orchestratorType: "multi",
        metadata: { patternType: state.type },
      };
      await store.save(checkpoint);

      // Record timeline event
      if (timeline) {
        timeline.record({
          type: "checkpoint_save",
          timestamp: Date.now(),
          snapshotId: null,
          checkpointId: state.id,
          patternType: state.type,
          step,
        });
      }

      fireHook("onCheckpointSave", {
        checkpointId: state.id,
        patternType: state.type,
        step,
        timestamp: Date.now(),
      });

      return state.id;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(
        `[Directive MultiAgent] ${state.type}: checkpoint save failed:`,
        error,
      );

      fireHook("onCheckpointError", {
        patternType: state.type,
        step,
        error,
        timestamp: Date.now(),
      });

      return null;
    }
  }

  // ---- Pattern Runners ----

  async function runSequentialPattern<T>(
    pattern: SequentialPattern<T>,
    initialInput: string,
    patternId?: string,
    resumeFrom?: SequentialCheckpointState,
  ): Promise<T> {
    const patternStartTime = Date.now();
    const pId = patternId ?? "__inline_sequential";
    if (patternId) {
      fireHook("onPatternStart", {
        patternId,
        patternType: "sequential",
        input: initialInput,
        timestamp: patternStartTime,
      });
    }

    // Checkpoint config
    const ckptConfig = pattern.checkpoint;
    const ckptStore = ckptConfig?.store ?? checkpointStore;
    const ckptEveryN = ckptConfig?.everyN ?? 5;
    const ckptPrefix = ckptConfig?.labelPrefix ?? "sequential";

    // Resume state
    let currentInput = resumeFrom?.currentInput ?? initialInput;
    let lastResult: RunResult<unknown> | undefined;
    const collectedResults: Array<{
      agentId: string;
      output: unknown;
      totalTokens: number;
    }> = resumeFrom?.results ? [...resumeFrom.results] : [];
    const startIdx = resumeFrom?.step ?? 0;
    let patternError: Error | undefined;

    // Restore lastResult from checkpoint
    if (resumeFrom && collectedResults.length > 0) {
      const last = collectedResults[collectedResults.length - 1]!;
      lastResult = {
        output: last.output,
        totalTokens: last.totalTokens,
        messages: [],
        toolCalls: [],
      };
    }

    try {
      for (let i = startIdx; i < pattern.handlers.length; i++) {
        const agentId = pattern.handlers[i]!;

        // ---- Breakpoint: pre_pattern_step ----
        {
          const bpResult = await handleBreakpoint(
            "pre_pattern_step",
            agentId,
            agents[agentId]?.agent.name ?? agentId,
            currentInput,
            undefined,
            {
              patternId,
            },
          );
          if (bpResult.skip) {
            continue;
          }
          currentInput = bpResult.input;
        }

        try {
          lastResult = await runSingleAgent(agentId, currentInput, {
            patternId,
          });
          collectedResults.push({
            agentId,
            output: lastResult.output,
            totalTokens: lastResult.totalTokens,
          });

          if (i < pattern.handlers.length - 1) {
            if (pattern.transform) {
              currentInput = pattern.transform(lastResult.output, agentId, i);
            } else {
              currentInput =
                typeof lastResult.output === "string"
                  ? lastResult.output
                  : safeStringify(lastResult.output);
            }
          }

          // Save checkpoint after each agent
          if (
            ckptConfig &&
            ckptStore &&
            i > startIdx &&
            (i - startIdx) % ckptEveryN === 0
          ) {
            const nextInput =
              i < pattern.handlers.length - 1 ? currentInput : initialInput;
            await savePatternCheckpoint(
              {
                type: "sequential",
                version: 1,
                id: createCheckpointId(),
                createdAt: new Date().toISOString(),
                label: `${ckptPrefix}:step-${i + 1}`,
                patternId: pId,
                stepsTotal: pattern.handlers.length,
                step: i + 1,
                currentInput: nextInput,
                results: [...collectedResults],
              },
              ckptStore,
              ckptConfig,
            );
          }
        } catch (error) {
          if (!pattern.continueOnError) {
            throw error;
          }
        }
      }

      if (!lastResult) {
        throw new Error(
          "[Directive MultiAgent] No successful results in sequential pattern",
        );
      }

      return pattern.extract
        ? pattern.extract(lastResult.output)
        : (lastResult.output as T);
    } catch (error) {
      patternError = error instanceof Error ? error : new Error(String(error));
      throw error;
    } finally {
      if (patternId) {
        fireHook("onPatternComplete", {
          patternId,
          patternType: "sequential",
          durationMs: Date.now() - patternStartTime,
          timestamp: Date.now(),
          error: patternError,
        });
      }
    }
  }

  async function runSupervisorPattern<T>(
    pattern: SupervisorPattern<T>,
    input: string,
    patternId?: string,
    resumeFrom?: SupervisorCheckpointState,
  ): Promise<T> {
    const patternStartTime = Date.now();
    const pId = patternId ?? "__inline_supervisor";
    if (patternId) {
      fireHook("onPatternStart", {
        patternId,
        patternType: "supervisor",
        input,
        timestamp: patternStartTime,
      });
    }

    // Checkpoint config
    const ckptConfig = pattern.checkpoint;
    const ckptStore = ckptConfig?.store ?? checkpointStore;
    const ckptEveryN = ckptConfig?.everyN ?? 5;
    const ckptPrefix = ckptConfig?.labelPrefix ?? "supervisor";

    const workerResults: RunResult<unknown>[] = [];
    const serializedWorkerResults: Array<{
      output: unknown;
      totalTokens: number;
    }> = resumeFrom?.workerResults ? [...resumeFrom.workerResults] : [];
    const maxRounds = pattern.maxRounds ?? 5;
    if (maxRounds < 1 || !Number.isFinite(maxRounds)) {
      throw new Error(
        "[Directive MultiAgent] supervisor maxRounds must be >= 1",
      );
    }
    let patternError: Error | undefined;

    // Restore worker results from checkpoint
    if (resumeFrom) {
      for (const wr of resumeFrom.workerResults) {
        workerResults.push({
          output: wr.output,
          totalTokens: wr.totalTokens,
          messages: [],
          toolCalls: [],
        });
      }
    }

    const startRound = resumeFrom?.round ?? 0;

    try {
      let supervisorResult: RunResult<unknown>;
      if (resumeFrom) {
        supervisorResult = {
          output: resumeFrom.supervisorOutput,
          totalTokens: 0,
          messages: [],
          toolCalls: [],
        };
      } else {
        supervisorResult = await runSingleAgent<unknown>(
          pattern.supervisor,
          input,
        );
      }

      let currentInput = resumeFrom?.currentInput ?? input;

      for (let round = startRound; round < maxRounds; round++) {
        // Validate supervisor output shape
        const raw = supervisorResult.output;
        let action: {
          action: string;
          worker?: string;
          workerInput?: string;
          output?: unknown;
        };

        if (typeof raw === "string") {
          try {
            // Strip markdown code fences LLMs often wrap JSON in
            const cleaned = raw.replace(/```(?:json|JSON)?\s*\n?/g, "").trim();
            action = JSON.parse(cleaned);
          } catch {
            // LLMs sometimes wrap JSON in conversational text or XML tool-call markup
            try {
              // Strip markdown fences + XML tags (models sometimes emit <function_calls>/<invoke>/<parameter> wrappers)
              const stripped = raw
                .replace(/```(?:json|JSON)?\s*\n?/g, "")
                .replace(/<[^>]+>/g, " ");
              const extracted = extractJsonFromOutput(stripped);
              if (
                extracted &&
                typeof extracted === "object" &&
                "action" in (extracted as Record<string, unknown>)
              ) {
                action = extracted as typeof action;
              } else {
                throw new Error("extracted value missing 'action' property");
              }
            } catch {
              throw new Error(
                `[Directive MultiAgent] Supervisor "${pattern.supervisor}" returned unparseable output (round ${round + 1}). ` +
                  `Expected JSON with { action, worker?, workerInput? } but got: ${raw.slice(0, 200)}`,
              );
            }
          }
        } else if (raw && typeof raw === "object" && "action" in raw) {
          action = raw as typeof action;
        } else {
          throw new Error(
            `[Directive MultiAgent] Supervisor "${pattern.supervisor}" returned invalid output (round ${round + 1}). ` +
              `Expected { action: "delegate"|"complete", worker?, workerInput? }`,
          );
        }

        if (action.action === "complete" || !action.worker) {
          break;
        }

        if (!pattern.workers.includes(action.worker)) {
          const available = pattern.workers.join(", ");

          throw new Error(
            `[Directive MultiAgent] Supervisor delegated to unknown worker "${action.worker}". Available workers: ${available}`,
          );
        }

        const workerResult = await runSingleAgent(
          action.worker,
          action.workerInput ?? "",
          { patternId },
        );
        workerResults.push(workerResult);
        serializedWorkerResults.push({
          output: workerResult.output,
          totalTokens: workerResult.totalTokens,
        });

        currentInput = `Worker ${action.worker} completed with result: ${safeStringify(workerResult.output)}`;
        supervisorResult = await runSingleAgent(
          pattern.supervisor,
          currentInput,
          { patternId },
        );

        // Save checkpoint after each round
        if (
          ckptConfig &&
          ckptStore &&
          round > startRound &&
          (round - startRound) % ckptEveryN === 0
        ) {
          await savePatternCheckpoint(
            {
              type: "supervisor",
              version: 1,
              id: createCheckpointId(),
              createdAt: new Date().toISOString(),
              label: `${ckptPrefix}:round-${round + 1}`,
              patternId: pId,
              stepsTotal: pattern.maxRounds ?? 10,
              round: round + 1,
              supervisorOutput: supervisorResult.output,
              workerResults: [...serializedWorkerResults],
              currentInput,
            },
            ckptStore,
            ckptConfig,
          );
        }
      }

      return pattern.extract
        ? pattern.extract(supervisorResult.output, workerResults)
        : (supervisorResult.output as T);
    } catch (error) {
      patternError = error instanceof Error ? error : new Error(String(error));
      throw error;
    } finally {
      if (patternId) {
        fireHook("onPatternComplete", {
          patternId,
          patternType: "supervisor",
          durationMs: Date.now() - patternStartTime,
          timestamp: Date.now(),
          error: patternError,
        });
      }
    }
  }

  // ---- DAG Pattern Runner ----
  async function runDagPattern<T>(
    pattern: DagPattern<T>,
    input: string,
    patternId?: string,
    resumeFrom?: DagCheckpointState,
  ): Promise<T> {
    const patternStartTime = Date.now();
    const pId = patternId ?? "__inline_dag";

    if (patternId) {
      fireHook("onPatternStart", {
        patternId,
        patternType: "dag",
        input,
        timestamp: patternStartTime,
      });
    }

    // Checkpoint config
    const dagCkptConfig = pattern.checkpoint;
    const dagCkptStore = dagCkptConfig?.store ?? checkpointStore;
    const dagCkptEveryN = dagCkptConfig?.everyN ?? 5;
    const dagCkptPrefix = dagCkptConfig?.labelPrefix ?? "dag";
    let dagCompletedCount = resumeFrom?.completedCount ?? 0;
    let dagLastCheckpointCount = 0;
    // Serialize concurrent checkpoint saves to prevent race conditions
    let dagCheckpointChain: Promise<unknown> = Promise.resolve();
    const dagTotalNodes = Object.keys(pattern.nodes).length;

    const context: DagExecutionContext = {
      input: resumeFrom?.input ?? input,
      outputs: Object.create(null),
      statuses: Object.create(null),
      errors: Object.create(null),
      results: Object.create(null),
    };

    // Initialize all nodes as pending
    for (const nodeId of Object.keys(pattern.nodes)) {
      context.statuses[nodeId] = "pending";
    }

    // Restore from checkpoint
    if (resumeFrom) {
      for (const [nodeId, status] of Object.entries(resumeFrom.statuses)) {
        context.statuses[nodeId] = status;
      }
      for (const [nodeId, output] of Object.entries(resumeFrom.outputs)) {
        context.outputs[nodeId] = output;
      }
      for (const [nodeId, error] of Object.entries(resumeFrom.errors)) {
        context.errors[nodeId] = error;
      }
      for (const [nodeId, nr] of Object.entries(resumeFrom.nodeResults)) {
        context.results[nodeId] = {
          output: nr.output,
          totalTokens: nr.totalTokens,
          messages: [],
          toolCalls: [],
        };
      }
    }

    const onNodeError = pattern.onNodeError ?? "fail";
    const maxConcurrent = pattern.maxConcurrent ?? Number.POSITIVE_INFINITY;
    const controller = new AbortController();
    let graphTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let patternError: Error | undefined;

    if (pattern.timeout) {
      graphTimeoutId = setTimeout(() => controller.abort(), pattern.timeout);
    }

    try {
      // Mark root nodes as ready (skip if restoring from checkpoint)
      if (!resumeFrom) {
        for (const [nodeId, node] of Object.entries(pattern.nodes)) {
          if (!node.deps || node.deps.length === 0) {
            context.statuses[nodeId] = "ready";
          }
        }
      }

      const inflight = new Set<Promise<void>>();
      let running = 0;

      function evaluatePendingNodes(): void {
        for (const [nodeId, node] of Object.entries(pattern.nodes)) {
          if (context.statuses[nodeId] !== "pending") {
            continue;
          }

          // Check if all deps are terminal (completed, skipped, or error for non-fail modes)
          const terminalStatuses =
            onNodeError === "fail"
              ? new Set(["completed", "skipped"])
              : new Set(["completed", "skipped", "error"]);
          const depsResolved = (node.deps ?? []).every((depId) => {
            return terminalStatuses.has(context.statuses[depId]!);
          });

          if (!depsResolved) {
            continue;
          }

          // Check if any dep errored or was skipped (for skip-downstream propagation)
          if (onNodeError === "skip-downstream") {
            const anyDepFailed = (node.deps ?? []).some(
              (depId) =>
                context.statuses[depId] === "error" ||
                context.statuses[depId] === "skipped",
            );
            if (anyDepFailed) {
              context.statuses[nodeId] = "skipped";
              if (timeline) {
                timeline.record({
                  type: "dag_node_update",
                  timestamp: Date.now(),
                  snapshotId: null,
                  nodeId,
                  status: "skipped",
                  deps: node.deps ?? [],
                });
              }
              fireHook("onDagNodeSkipped", {
                patternId: pId,
                nodeId,
                agentId: node.handler,
                nodeType: tasks[node.handler]
                  ? ("task" as const)
                  : ("agent" as const),
                reason: "upstream dependency errored",
                timestamp: Date.now(),
              });

              continue;
            }
          }

          // Evaluate when condition
          if (node.when) {
            try {
              if (!node.when(context)) {
                context.statuses[nodeId] = "skipped";
                if (timeline) {
                  timeline.record({
                    type: "dag_node_update",
                    timestamp: Date.now(),
                    snapshotId: null,
                    nodeId,
                    status: "skipped",
                    deps: node.deps ?? [],
                  });
                }
                fireHook("onDagNodeSkipped", {
                  patternId: pId,
                  nodeId,
                  agentId: node.handler,
                  nodeType: tasks[node.handler]
                    ? ("task" as const)
                    : ("agent" as const),
                  reason: "when() returned false",
                  timestamp: Date.now(),
                });

                continue;
              }
            } catch {
              context.statuses[nodeId] = "skipped";

              continue;
            }
          }

          context.statuses[nodeId] = "ready";
        }
      }

      async function launchNode(nodeId: string, node: DagNode): Promise<void> {
        const nodeStartTime = Date.now();
        context.statuses[nodeId] = "running";

        if (timeline) {
          timeline.record({
            type: "dag_node_update",
            timestamp: nodeStartTime,
            snapshotId: null,
            nodeId,
            status: "running",
            deps: node.deps ?? [],
          });
        }
        fireHook("onDagNodeStart", {
          patternId: pId,
          nodeId,
          agentId: node.handler,
          nodeType: tasks[node.handler]
            ? ("task" as const)
            : ("agent" as const),
          timestamp: nodeStartTime,
        });

        // Build input
        let nodeInput: string;
        if (node.transform) {
          nodeInput = node.transform(context);
        } else if (node.deps && node.deps.length > 0) {
          const upstreamOutputs: Record<string, unknown> = Object.create(null);
          for (const depId of node.deps) {
            if (context.outputs[depId] !== undefined) {
              upstreamOutputs[depId] = context.outputs[depId];
            }
          }
          nodeInput = JSON.stringify(upstreamOutputs);
        } else {
          nodeInput = input;
        }

        // Per-node timeout
        const nodeController = new AbortController();
        let nodeTimeoutId: ReturnType<typeof setTimeout> | undefined;
        if (node.timeout) {
          nodeTimeoutId = setTimeout(
            () => nodeController.abort(),
            node.timeout,
          );
        }

        // Forward graph-level abort
        const abortHandler = () => nodeController.abort();
        controller.signal.addEventListener("abort", abortHandler, {
          once: true,
        });

        try {
          const result = await runSingleAgent(node.handler, nodeInput, {
            signal: nodeController.signal,
            patternId: pId,
          });

          context.outputs[nodeId] = result.output;
          context.results[nodeId] = result;
          context.statuses[nodeId] = "completed";

          if (timeline) {
            timeline.record({
              type: "dag_node_update",
              timestamp: Date.now(),
              snapshotId: null,
              nodeId,
              status: "completed",
              deps: node.deps ?? [],
            });
          }
          fireHook("onDagNodeComplete", {
            patternId: pId,
            nodeId,
            agentId: node.handler,
            nodeType: tasks[node.handler]
              ? ("task" as const)
              : ("agent" as const),
            durationMs: Date.now() - nodeStartTime,
            timestamp: Date.now(),
          });

          // Save checkpoint after node completion (serialized to prevent concurrent race)
          dagCompletedCount++;
          if (
            dagCkptConfig &&
            dagCkptStore &&
            dagCompletedCount > dagLastCheckpointCount &&
            dagCompletedCount - dagLastCheckpointCount >= dagCkptEveryN
          ) {
            dagLastCheckpointCount = dagCompletedCount;
            const nodeResults: Record<
              string,
              { output: unknown; totalTokens: number }
            > = Object.create(null);
            for (const [nid, r] of Object.entries(context.results)) {
              nodeResults[nid] = {
                output: r.output,
                totalTokens: r.totalTokens,
              };
            }
            const ckptState = {
              type: "dag" as const,
              version: 1 as const,
              id: createCheckpointId(),
              createdAt: new Date().toISOString(),
              label: `${dagCkptPrefix}:node-${dagCompletedCount}`,
              patternId: pId,
              stepsTotal: dagTotalNodes,
              statuses: { ...context.statuses },
              outputs: { ...context.outputs },
              errors: { ...context.errors },
              completedCount: dagCompletedCount,
              nodeResults,
              input: context.input,
            };
            dagCheckpointChain = dagCheckpointChain.then(() =>
              savePatternCheckpoint(ckptState, dagCkptStore!, dagCkptConfig),
            );
            await dagCheckpointChain;
          }
        } catch (error) {
          context.statuses[nodeId] = "error";
          context.errors[nodeId] =
            error instanceof Error ? error.message : String(error);

          if (timeline) {
            timeline.record({
              type: "dag_node_update",
              timestamp: Date.now(),
              snapshotId: null,
              nodeId,
              status: "error",
              deps: node.deps ?? [],
            });
          }
          fireHook("onDagNodeError", {
            patternId: pId,
            nodeId,
            agentId: node.handler,
            nodeType: tasks[node.handler]
              ? ("task" as const)
              : ("agent" as const),
            error: error instanceof Error ? error : new Error(String(error)),
            durationMs: Date.now() - nodeStartTime,
            timestamp: Date.now(),
          });

          if (onNodeError === "fail") {
            controller.abort();
            throw error;
          }
          // "continue" and "skip-downstream" just keep going
        } finally {
          if (nodeTimeoutId) {
            clearTimeout(nodeTimeoutId);
          }
          controller.signal.removeEventListener("abort", abortHandler);
          running--;
        }
      }

      // Main loop
      while (true) {
        if (controller.signal.aborted) {
          break;
        }

        evaluatePendingNodes();

        // Collect ready nodes sorted by priority (descending)
        const readyNodes = Object.entries(pattern.nodes)
          .filter(([nodeId]) => context.statuses[nodeId] === "ready")
          .sort(([, a], [, b]) => (b.priority ?? 0) - (a.priority ?? 0));

        // Launch ready nodes up to maxConcurrent
        for (const [nodeId, node] of readyNodes) {
          if (running >= maxConcurrent) {
            break;
          }
          running++;
          const promise = launchNode(nodeId, node).finally(() => {
            inflight.delete(promise);
          });
          inflight.add(promise);
        }

        // Check if we're done
        const hasPendingOrRunning = Object.values(context.statuses).some(
          (s) => s === "pending" || s === "running" || s === "ready",
        );
        if (!hasPendingOrRunning) {
          break;
        }

        // Wait for at least one inflight to complete
        if (inflight.size > 0) {
          await Promise.race(inflight);
        } else {
          // No inflight and still pending — must be stuck (unreachable deps)
          break;
        }
      }

      // Wait for remaining inflight
      if (inflight.size > 0) {
        await Promise.allSettled(inflight);
      }

      return await pattern.merge(context);
    } catch (error) {
      patternError = error instanceof Error ? error : new Error(String(error));
      throw error;
    } finally {
      if (graphTimeoutId) {
        clearTimeout(graphTimeoutId);
      }
      if (patternId) {
        fireHook("onPatternComplete", {
          patternId,
          patternType: "dag",
          durationMs: Date.now() - patternStartTime,
          timestamp: Date.now(),
          error: patternError,
        });
      }
    }
  }

  // ---- Reflect Pattern Runner ----
  async function runReflectPattern<T>(
    pattern: ReflectPattern<T>,
    input: string,
    patternId?: string,
    resumeFrom?: ReflectCheckpointState,
  ): Promise<T> {
    const patternStartTime = Date.now();
    const pId = patternId ?? "__inline_reflect";
    const maxIterations = pattern.maxIterations ?? 2;

    if (maxIterations < 1) {
      throw new Error(
        "[Directive MultiAgent] Reflect pattern maxIterations must be >= 1",
      );
    }
    if (debug && maxIterations > 3) {
      console.warn(
        "[Directive MultiAgent] Reflection loops > 3 iterations rarely improve quality. Consider reducing maxIterations.",
      );
    }

    // Merge timeout into signal if provided
    let effectiveSignal = pattern.signal;
    let reflectTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let reflectExternalOnAbort: (() => void) | undefined;
    if (pattern.timeout && !effectiveSignal) {
      const controller = new AbortController();
      reflectTimeoutId = setTimeout(() => controller.abort(), pattern.timeout);
      effectiveSignal = controller.signal;
    } else if (pattern.timeout && effectiveSignal) {
      // Both timeout and signal: combine them
      const controller = new AbortController();
      reflectTimeoutId = setTimeout(() => controller.abort(), pattern.timeout);
      reflectExternalOnAbort = () => controller.abort();
      effectiveSignal.addEventListener("abort", reflectExternalOnAbort, {
        once: true,
      });
      effectiveSignal = controller.signal;
    }

    const parseEvaluation =
      pattern.parseEvaluation ??
      ((output: unknown): ReflectionEvaluation => {
        if (typeof output === "string") {
          try {
            return JSON.parse(output);
          } catch {
            return {
              passed: false,
              feedback: `Evaluator returned unparseable output: ${output.slice(0, 200)}`,
            };
          }
        }
        if (output && typeof output === "object" && "passed" in output) {
          return output as ReflectionEvaluation;
        }

        return { passed: false, feedback: "Evaluator returned invalid format" };
      });
    const buildRetryInput =
      pattern.buildRetryInput ??
      ((inp: string, feedback: string, _iteration: number) =>
        `${inp}\n\nFeedback on your previous response:\n${feedback}\n\nPlease improve your response.`);

    if (patternId) {
      fireHook("onPatternStart", {
        patternId: pId,
        patternType: "reflect",
        input,
        timestamp: patternStartTime,
      });
    }

    // Checkpoint config
    const reflectCkptConfig = pattern.checkpoint;
    const reflectCkptStore = reflectCkptConfig?.store ?? checkpointStore;
    const reflectCkptEveryN = reflectCkptConfig?.everyN ?? 5;
    const reflectCkptPrefix = reflectCkptConfig?.labelPrefix ?? "reflect";

    let patternError: Error | undefined;
    let lastProducerResult: RunResult<unknown> | undefined;
    const history: ReflectIterationRecord[] = resumeFrom?.history
      ? [...resumeFrom.history]
      : [];
    // Track per-iteration producer outputs for accept-best
    const producerOutputs: Array<{ output: unknown; score?: number }> =
      resumeFrom?.producerOutputs ? [...resumeFrom.producerOutputs] : [];
    const startIteration = resumeFrom?.iteration ?? 0;

    // Restore last producer result from checkpoint
    if (resumeFrom?.lastProducerOutput != null) {
      lastProducerResult = {
        output: resumeFrom.lastProducerOutput,
        totalTokens: 0,
        messages: [],
        toolCalls: [],
      };
    }

    try {
      let effectiveInput = resumeFrom?.effectiveInput ?? input;

      for (
        let iteration = startIteration;
        iteration < maxIterations;
        iteration++
      ) {
        // Check abort signal at top of each iteration
        if (effectiveSignal?.aborted) {
          if (lastProducerResult) {
            lastReflectionHistory = history;

            return pattern.extract
              ? pattern.extract(lastProducerResult.output)
              : (lastProducerResult.output as T);
          }

          throw new DOMException("Reflect pattern aborted", "AbortError");
        }

        const iterStart = Date.now();

        // Run producer (pass signal through)
        const producerResult = await runSingleAgent(
          pattern.handler,
          effectiveInput,
          { signal: effectiveSignal, patternId },
        );
        lastProducerResult = producerResult;
        const producerOutput =
          typeof producerResult.output === "string"
            ? producerResult.output
            : safeStringify(producerResult.output);

        // Check abort after producer, before evaluator
        if (effectiveSignal?.aborted) {
          lastReflectionHistory = history;

          return pattern.extract
            ? pattern.extract(producerResult.output)
            : (producerResult.output as T);
        }

        // Run evaluator (pass signal through)
        const evaluatorResult = await runSingleAgent(
          pattern.evaluator,
          producerOutput,
          { signal: effectiveSignal, patternId },
        );
        let evaluation: ReflectionEvaluation;
        try {
          evaluation = parseEvaluation(evaluatorResult.output);
        } catch (parseError) {
          evaluation = {
            passed: false,
            feedback: `Evaluation parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
          };
        }

        // Apply threshold-based pass override
        if (
          !evaluation.passed &&
          pattern.threshold != null &&
          evaluation.score != null
        ) {
          const thresholdValue =
            typeof pattern.threshold === "function"
              ? pattern.threshold(iteration)
              : pattern.threshold;
          if (evaluation.score >= thresholdValue) {
            evaluation = { ...evaluation, passed: true };
          }
        }

        const iterDurationMs = Date.now() - iterStart;

        // Store producer output for accept-best
        producerOutputs.push({
          output: producerResult.output,
          score: evaluation.score,
        });

        // Build iteration record
        const record: ReflectIterationRecord = {
          iteration,
          passed: evaluation.passed,
          score: evaluation.score,
          feedback: evaluation.feedback,
          durationMs: iterDurationMs,
          producerTokens: producerResult.totalTokens ?? 0,
          evaluatorTokens: evaluatorResult.totalTokens ?? 0,
        };
        history.push(record);

        // Fire onIteration callback
        if (pattern.onIteration) {
          try {
            pattern.onIteration(record);
          } catch (cbError) {
            if (debug) {
              console.warn(
                "[Directive MultiAgent] onIteration callback threw:",
                cbError,
              );
            }
          }
        }

        // Record timeline event
        if (timeline) {
          timeline.record({
            type: "reflection_iteration",
            timestamp: Date.now(),
            snapshotId: null,
            iteration,
            passed: evaluation.passed,
            score: evaluation.score,
            durationMs: iterDurationMs,
            producerTokens: producerResult.totalTokens,
            evaluatorTokens: evaluatorResult.totalTokens,
          });
        }

        if (evaluation.passed) {
          lastReflectionHistory = history;

          return pattern.extract
            ? pattern.extract(producerResult.output)
            : (producerResult.output as T);
        }

        // Build retry input for next iteration
        if (iteration < maxIterations - 1 && evaluation.feedback) {
          try {
            effectiveInput = buildRetryInput(
              input,
              evaluation.feedback,
              iteration,
            );
          } catch (retryError) {
            if (debug) {
              console.warn(
                "[Directive MultiAgent] buildRetryInput threw, using default format:",
                retryError,
              );
            }
            effectiveInput = `${input}\n\nFeedback on your previous response:\n${evaluation.feedback}\n\nPlease improve your response.`;
          }
        }

        // Save checkpoint after each iteration
        if (
          reflectCkptConfig &&
          reflectCkptStore &&
          iteration >= startIteration &&
          (iteration - startIteration + 1) % reflectCkptEveryN === 0
        ) {
          await savePatternCheckpoint(
            {
              type: "reflect",
              version: 1,
              id: createCheckpointId(),
              createdAt: new Date().toISOString(),
              label: `${reflectCkptPrefix}:iter-${iteration + 1}`,
              patternId: pId,
              stepsTotal: maxIterations,
              iteration: iteration + 1,
              effectiveInput,
              history: [...history],
              producerOutputs: [...producerOutputs],
              lastProducerOutput: producerResult.output,
            },
            reflectCkptStore,
            reflectCkptConfig,
          );
        }
      }

      lastReflectionHistory = history;

      // Exhausted
      if (pattern.onExhausted === "throw") {
        throw new ReflectionExhaustedError({
          iterations: maxIterations,
          history: history.map((h) => ({
            passed: h.passed,
            feedback: h.feedback,
            score: h.score,
          })),
          lastResult: lastProducerResult!,
          totalTokens: lastProducerResult!.totalTokens ?? 0,
        });
      }

      // "accept-best" — pick iteration with highest score
      if (pattern.onExhausted === "accept-best" && producerOutputs.length > 0) {
        const hasAnyScore = producerOutputs.some((p) => p.score != null);
        if (!hasAnyScore && debug) {
          console.warn(
            "[Directive MultiAgent] accept-best exhaustion strategy used but no iterations returned scores. Falling back to last output.",
          );
        }
        let bestIdx = producerOutputs.length - 1;
        let bestScore = Number.NEGATIVE_INFINITY;
        for (let i = 0; i < producerOutputs.length; i++) {
          const s = producerOutputs[i]!.score;
          if (s != null && s > bestScore) {
            bestScore = s;
            bestIdx = i;
          }
        }

        const bestOutput = producerOutputs[bestIdx]!.output;

        return pattern.extract
          ? pattern.extract(bestOutput)
          : (bestOutput as T);
      }

      // "accept-last" (default)
      return pattern.extract
        ? pattern.extract(lastProducerResult!.output)
        : (lastProducerResult!.output as T);
    } catch (error) {
      lastReflectionHistory = history;
      patternError = error instanceof Error ? error : new Error(String(error));
      throw error;
    } finally {
      if (reflectTimeoutId) {
        clearTimeout(reflectTimeoutId);
      }
      if (reflectExternalOnAbort && pattern.signal) {
        pattern.signal.removeEventListener("abort", reflectExternalOnAbort);
      }
      if (patternId) {
        fireHook("onPatternComplete", {
          patternId: pId,
          patternType: "reflect",
          durationMs: Date.now() - patternStartTime,
          timestamp: Date.now(),
          error: patternError,
        });
      }
    }
  }

  // ---- Race Pattern Runner ----
  async function runRacePattern<T>(
    pattern: RacePattern<T>,
    input: string,
    patternId?: string,
  ): Promise<RaceResult<T>> {
    if (pattern.handlers.length === 0) {
      throw new Error(
        "[Directive MultiAgent] Race pattern requires at least one agent",
      );
    }

    const minSuccess = pattern.minSuccess ?? 1;

    if (!Number.isInteger(minSuccess) || minSuccess < 1) {
      throw new Error(
        "[Directive MultiAgent] Race pattern minSuccess must be a positive integer",
      );
    }
    if (minSuccess > pattern.handlers.length) {
      throw new Error(
        `[Directive MultiAgent] Race pattern minSuccess (${minSuccess}) exceeds agent count (${pattern.handlers.length})`,
      );
    }

    // Validate handler IDs (agents or tasks)
    for (const agentId of pattern.handlers) {
      if (!agents[agentId] && !tasks[agentId]) {
        throw new Error(
          `[Directive MultiAgent] Race: unknown handler "${agentId}"`,
        );
      }
    }

    const patternStartTime = Date.now();
    const pId = patternId ?? "__inline_race";
    const controller = new AbortController();
    let raceTimeoutId: ReturnType<typeof setTimeout> | undefined;

    // Wire external signal into internal controller
    let raceExternalOnAbort: (() => void) | undefined;
    if (pattern.signal) {
      if (pattern.signal.aborted) {
        controller.abort();
      } else {
        raceExternalOnAbort = () => controller.abort();
        pattern.signal.addEventListener("abort", raceExternalOnAbort, {
          once: true,
        });
      }
    }

    if (patternId) {
      fireHook("onPatternStart", {
        patternId: pId,
        patternType: "race",
        input,
        timestamp: patternStartTime,
      });
    }

    if (timeline) {
      timeline.record({
        type: "race_start",
        timestamp: patternStartTime,
        snapshotId: null,
        patternId: pId,
        agents: pattern.handlers,
      });
    }

    if (pattern.timeout) {
      raceTimeoutId = setTimeout(() => controller.abort(), pattern.timeout);
    }

    let patternError: Error | undefined;
    const agentErrors: Record<string, string> = Object.create(null);
    const startedAgents = [...pattern.handlers];

    try {
      // Start all agents, collecting promises
      type RaceEntry = {
        agentId: string;
        promise: Promise<{ agentId: string; result: RunResult<unknown> }>;
      };
      const entries: RaceEntry[] = pattern.handlers.map((agentId) => ({
        agentId,
        // Output guardrails are already checked inside runSingleAgent
        promise: runSingleAgent(agentId, input, {
          signal: controller.signal,
          patternId,
        }).then((result) => ({ agentId, result })),
      }));

      // Custom race: track settled count, await all promises for cleanup
      const allPromises = entries.map((e) => e.promise.catch(() => undefined));

      const collectedResults: Array<{
        agentId: string;
        result: RunResult<unknown>;
      }> = [];

      const result = await new Promise<
        Array<{ agentId: string; result: RunResult<unknown> }>
      >((resolve, reject) => {
        let settledCount = 0;
        let resolved = false;

        for (const entry of entries) {
          entry.promise
            .then((winner) => {
              settledCount++;
              if (resolved) {
                return;
              }
              collectedResults.push(winner);
              if (collectedResults.length >= minSuccess) {
                resolved = true;
                controller.abort();
                resolve([...collectedResults]);
              }
            })
            .catch((error) => {
              agentErrors[entry.agentId] =
                error instanceof Error ? error.message : String(error);
              settledCount++;

              if (resolved) {
                return;
              }

              const failedCount = Object.keys(agentErrors).length;
              const maxPossibleSuccesses =
                collectedResults.length + (entries.length - settledCount);

              // All agents failed
              if (
                settledCount === entries.length &&
                failedCount === entries.length
              ) {
                resolved = true;
                reject(
                  new Error(
                    `[Directive MultiAgent] Race: all ${entries.length} agents failed.\n` +
                      Object.entries(agentErrors)
                        .map(([id, msg]) => `  - ${id}: ${msg}`)
                        .join("\n"),
                  ),
                );
              } else if (maxPossibleSuccesses < minSuccess) {
                // Impossible to reach minSuccess — some succeeded but not enough can
                resolved = true;
                reject(
                  new Error(
                    `[Directive MultiAgent] Race: cannot reach minSuccess (${minSuccess}). ` +
                      `${failedCount} agent(s) failed.\n` +
                      Object.entries(agentErrors)
                        .map(([id, msg]) => `  - ${id}: ${msg}`)
                        .join("\n"),
                  ),
                );
              }
            });
        }
      });

      // Wait for all losing agents to settle so their side effects
      // (token counting, state mutations) complete before we return
      await Promise.all(allPromises).catch(() => {});

      // First result is the "winner" (fastest) — guaranteed to exist since minSuccess >= 1
      const first = result[0]!;
      const winnerId = first.agentId;
      const successIds = new Set(result.map((r) => r.agentId));
      const cancelledIds = startedAgents.filter(
        (id) => !successIds.has(id) && !(id in agentErrors),
      );

      if (timeline) {
        timeline.record({
          type: "race_winner",
          timestamp: Date.now(),
          snapshotId: null,
          patternId: pId,
          winnerId,
          durationMs: Date.now() - patternStartTime,
        });
        if (cancelledIds.length > 0) {
          timeline.record({
            type: "race_cancelled",
            timestamp: Date.now(),
            snapshotId: null,
            patternId: pId,
            cancelledIds,
            reason: "winner_found",
          });
        }
      }

      const extracted = pattern.extract
        ? pattern.extract(first.result)
        : (first.result.output as T);

      // Build allResults when minSuccess > 1
      const allResults =
        minSuccess > 1
          ? result.map((r) => ({
              agentId: r.agentId,
              result: pattern.extract
                ? pattern.extract(r.result)
                : (r.result.output as T),
            }))
          : undefined;

      return { winnerId, result: extracted, allResults };
    } catch (error) {
      patternError = error instanceof Error ? error : new Error(String(error));

      // Record cancellation due to all-failed or timeout
      if (timeline) {
        timeline.record({
          type: "race_cancelled",
          timestamp: Date.now(),
          snapshotId: null,
          patternId: pId,
          cancelledIds: startedAgents,
          reason: controller.signal.aborted ? "timeout" : "all_failed",
        });
      }

      throw error;
    } finally {
      if (raceTimeoutId) {
        clearTimeout(raceTimeoutId);
      }
      if (raceExternalOnAbort && pattern.signal) {
        pattern.signal.removeEventListener("abort", raceExternalOnAbort);
      }
      if (patternId) {
        fireHook("onPatternComplete", {
          patternId: pId,
          patternType: "race",
          durationMs: Date.now() - patternStartTime,
          timestamp: Date.now(),
          error: patternError,
        });
      }
    }
  }

  // ---- Debate Pattern Runner ----
  async function runDebateInternal<T>(
    pattern: DebatePattern<T>,
    input: string,
    patternId?: string,
    resumeFrom?: DebateCheckpointState,
  ): Promise<DebateResult<T>> {
    const {
      handlers: debateAgents,
      evaluator,
      maxRounds = 2,
      extract,
      parseJudgement,
    } = pattern;

    if (debateAgents.length < 2) {
      throw new Error(
        "[Directive MultiAgent] debate requires at least 2 handlers",
      );
    }
    if (maxRounds < 1 || !Number.isFinite(maxRounds)) {
      throw new Error("[Directive MultiAgent] debate maxRounds must be >= 1");
    }

    // Signal/timeout composition
    let effectiveSignal = pattern.signal;
    let debateTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let externalOnAbort: (() => void) | undefined;
    if (pattern.timeout && !effectiveSignal) {
      const ctrl = new AbortController();
      debateTimeoutId = setTimeout(() => ctrl.abort(), pattern.timeout);
      effectiveSignal = ctrl.signal;
    } else if (pattern.timeout && effectiveSignal) {
      const ctrl = new AbortController();
      debateTimeoutId = setTimeout(() => ctrl.abort(), pattern.timeout);
      externalOnAbort = () => ctrl.abort();
      effectiveSignal.addEventListener("abort", externalOnAbort, {
        once: true,
      });
      effectiveSignal = ctrl.signal;
    }

    const defaultParseJudgement = (
      output: unknown,
    ): { winnerId: string; feedback?: string; score?: number } => {
      if (typeof output === "string") {
        try {
          const parsed = JSON.parse(output);
          if (
            parsed &&
            typeof parsed === "object" &&
            typeof parsed.winnerId === "string"
          ) {
            return parsed;
          }

          if (debug) {
            console.warn(
              "[Directive MultiAgent] defaultParseJudgement: parsed JSON missing winnerId, falling back to first agent",
            );
          }

          return { winnerId: debateAgents[0]! };
        } catch {
          if (debug) {
            console.warn(
              "[Directive MultiAgent] defaultParseJudgement: output is not valid JSON, falling back to first agent",
            );
          }

          return { winnerId: debateAgents[0]! };
        }
      }
      if (
        output &&
        typeof output === "object" &&
        "winnerId" in output &&
        typeof (output as Record<string, unknown>).winnerId === "string"
      ) {
        return output as {
          winnerId: string;
          feedback?: string;
          score?: number;
        };
      }

      if (debug) {
        console.warn(
          "[Directive MultiAgent] defaultParseJudgement: unrecognized output format, falling back to first agent",
        );
      }

      return { winnerId: debateAgents[0]! };
    };

    const parseJudge = parseJudgement ?? defaultParseJudgement;
    const rounds: DebateResult<T>["rounds"] = resumeFrom?.rounds
      ? [...resumeFrom.rounds]
      : [];
    let currentInput = resumeFrom?.currentInput ?? input;
    let lastWinnerId = resumeFrom?.lastWinnerId ?? debateAgents[0]!;
    let lastWinnerOutput: unknown = resumeFrom?.lastWinnerOutput ?? undefined;
    const startRound = resumeFrom?.round ?? 0;

    // Checkpoint config
    const debateCkptConfig = pattern.checkpoint;
    const debateCkptStore = debateCkptConfig?.store ?? checkpointStore;
    const debateCkptEveryN = debateCkptConfig?.everyN ?? 5;
    const debateCkptPrefix = debateCkptConfig?.labelPrefix ?? "debate";

    const pId = patternId ?? "__inline_debate";
    const patternStartTime = Date.now();
    let debateTotalTokens = resumeFrom?.tokensConsumed ?? 0;

    if (patternId) {
      fireHook("onPatternStart", {
        patternId: pId,
        patternType: "debate",
        input,
        timestamp: patternStartTime,
      });
    }

    let patternError: Error | undefined;
    try {
      for (let round = startRound; round < maxRounds; round++) {
        if (effectiveSignal?.aborted) {
          break;
        }

        const proposalPromises = debateAgents.map(async (agentId) => {
          const result = await runSingleAgent(agentId, currentInput, {
            signal: effectiveSignal,
            patternId: pId,
          });
          debateTotalTokens += result.totalTokens;

          return { agentId, output: result.output };
        });
        const proposals = await Promise.all(proposalPromises);

        if (effectiveSignal?.aborted) {
          break;
        }

        const evalInput = JSON.stringify({
          round: round + 1,
          totalRounds: maxRounds,
          proposals: proposals.map((p) => ({
            agentId: p.agentId,
            proposal: p.output,
          })),
        });

        const evalResult = await runSingleAgent(evaluator, evalInput, {
          signal: effectiveSignal,
          patternId: pId,
        });
        debateTotalTokens += evalResult.totalTokens;
        const judgement = parseJudge(evalResult.output);

        // Validate winnerId
        if (!debateAgents.includes(judgement.winnerId)) {
          judgement.winnerId = debateAgents[0]!;
        }

        rounds.push({ proposals, judgement });

        // Record debate round timeline event
        if (timeline) {
          timeline.record({
            type: "debate_round",
            timestamp: Date.now(),
            snapshotId: null,
            patternId: pId,
            round: round + 1,
            totalRounds: maxRounds,
            winnerId: judgement.winnerId,
            score: judgement.score,
            agentCount: debateAgents.length,
          });
        }

        lastWinnerId = judgement.winnerId;
        const winnerProposal = proposals.find(
          (p) => p.agentId === judgement.winnerId,
        );
        lastWinnerOutput = winnerProposal?.output ?? proposals[0]!.output;

        // Save checkpoint at configured intervals
        if (
          debateCkptConfig &&
          debateCkptStore &&
          round > startRound &&
          (round - startRound) % debateCkptEveryN === 0
        ) {
          const ckptState: DebateCheckpointState = {
            type: "debate",
            version: 1,
            id: createCheckpointId(),
            createdAt: new Date().toISOString(),
            label: `${debateCkptPrefix}:round-${round + 1}`,
            patternId: pId,
            stepsTotal: maxRounds,
            round: round + 1,
            currentInput,
            rounds: [...rounds],
            lastWinnerId,
            lastWinnerOutput,
            tokensConsumed: debateTotalTokens,
          };
          await savePatternCheckpoint(
            ckptState,
            debateCkptStore,
            debateCkptConfig,
          );
        }

        if (round < maxRounds - 1 && judgement.feedback) {
          currentInput = `Previous round feedback: ${judgement.feedback}\n\nOriginal task: ${input}`;
        }
      }

      if (rounds.length === 0) {
        throw new Error(
          "[Directive MultiAgent] Debate aborted before any round completed",
        );
      }

      const result = extract
        ? extract(lastWinnerOutput)
        : (lastWinnerOutput as T);

      return { winnerId: lastWinnerId, result, rounds };
    } catch (error) {
      patternError = error instanceof Error ? error : new Error(String(error));
      throw error;
    } finally {
      if (debateTimeoutId) {
        clearTimeout(debateTimeoutId);
      }
      if (externalOnAbort && pattern.signal) {
        pattern.signal.removeEventListener("abort", externalOnAbort);
      }
      if (patternId) {
        fireHook("onPatternComplete", {
          patternId: pId,
          patternType: "debate",
          durationMs: Date.now() - patternStartTime,
          timestamp: Date.now(),
          error: patternError,
        });
      }
    }
  }

  // ---- Goal Pattern Implementation ----

  /** Keys that must never appear in goal facts (prototype pollution guard) */
  const GOAL_BLOCKED_KEYS = new Set([
    "__proto__",
    "constructor",
    "prototype",
    "toString",
    "valueOf",
    "hasOwnProperty",
  ]);

  function goalSafeMerge(
    target: Record<string, unknown>,
    source: Record<string, unknown>,
  ): void {
    for (const key of Object.keys(source)) {
      if (!GOAL_BLOCKED_KEYS.has(key)) {
        target[key] = source[key];
      }
    }
  }

  /**
   * Detect cycles in goal node dependency graph.
   * Builds an implicit DAG from produces/requires and applies Kahn's algorithm.
   */
  function validateGoalAcyclic(
    pId: string,
    nodes: Record<string, GoalNode>,
  ): void {
    // Build producer map: factKey → nodeId(s) that produce it
    const producerMap: Record<string, string[]> = Object.create(null);
    for (const [nodeId, node] of Object.entries(nodes)) {
      for (const key of node.produces) {
        if (!producerMap[key]) {
          producerMap[key] = [];
        }
        producerMap[key]!.push(nodeId);
      }
    }

    // Build adjacency from requires → produces edges
    const nodeIds = Object.keys(nodes);
    const inDegree: Record<string, number> = Object.create(null);
    const adjacency: Record<string, string[]> = Object.create(null);
    for (const id of nodeIds) {
      inDegree[id] = 0;
      adjacency[id] = [];
    }

    for (const [nodeId, node] of Object.entries(nodes)) {
      for (const reqKey of node.requires ?? []) {
        const producers = producerMap[reqKey];
        if (producers) {
          for (const producerId of producers) {
            if (producerId !== nodeId) {
              adjacency[producerId]!.push(nodeId);
              inDegree[nodeId] = (inDegree[nodeId] ?? 0) + 1;
            }
          }
        }
      }
    }

    // Kahn's algorithm
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
        `[Directive MultiAgent] goal pattern "${pId}": cycle detected in produces/requires graph. Visited ${visited}/${nodeIds.length} nodes.`,
      );
    }
  }

  /**
   * Validate that no two nodes produce the same fact key (M1: producer conflict detection).
   * Logs a dev-mode warning rather than throwing, since some use cases intentionally overlap.
   */
  function validateProducerConflicts(
    pId: string,
    nodes: Record<string, GoalNode>,
  ): void {
    const producerMap: Record<string, string[]> = Object.create(null);
    for (const [nodeId, node] of Object.entries(nodes)) {
      for (const key of node.produces) {
        if (!producerMap[key]) {
          producerMap[key] = [];
        }
        producerMap[key]!.push(nodeId);
      }
    }

    for (const [key, producers] of Object.entries(producerMap)) {
      if (producers.length > 1) {
        console.warn(
          `[Directive MultiAgent] goal pattern "${pId}": fact key "${key}" is produced by multiple nodes: ${producers.join(", ")}. Last writer wins.`,
        );
      }
    }
  }

  /** Safe wrapper for user-provided callbacks (C1). */
  function safeCall<A extends unknown[], R>(
    fn: ((...args: A) => R) | undefined,
    ...args: A
  ): R | undefined {
    if (!fn) {
      return undefined;
    }

    try {
      return fn(...args);
    } catch (err) {
      console.error("[Directive MultiAgent] goal: user callback threw:", err);

      return undefined;
    }
  }

  /** Safe wrapper for async user-provided callbacks (C1). */
  async function safeCallAsync<A extends unknown[], R>(
    fn: ((...args: A) => R | Promise<R>) | undefined,
    ...args: A
  ): Promise<R | undefined> {
    if (!fn) {
      return undefined;
    }

    try {
      return await fn(...args);
    } catch (err) {
      console.error("[Directive MultiAgent] goal: user callback threw:", err);

      return undefined;
    }
  }

  /** Compute estimatedStepsRemaining and decelerating from step history (M7). */
  function computeGoalMetrics(
    currentSatisfaction: number,
    stepMetrics: GoalStepMetrics[],
    _step: number,
  ): GoalMetrics {
    // Calculate recent progress rate (average delta over last 3 steps)
    const recentSteps = stepMetrics.slice(-3);
    const avgDelta =
      recentSteps.length > 0
        ? recentSteps.reduce((sum, s) => sum + s.satisfactionDelta, 0) /
          recentSteps.length
        : 0;

    let estimatedStepsRemaining: number | null = null;
    if (avgDelta > 0 && currentSatisfaction < 1.0) {
      estimatedStepsRemaining = Math.ceil(
        (1.0 - currentSatisfaction) / avgDelta,
      );
    }

    // Decelerating: compare last 3 deltas to prior 3 deltas
    let decelerating = false;
    if (stepMetrics.length >= 6) {
      const recent3 = stepMetrics.slice(-3);
      const prior3 = stepMetrics.slice(-6, -3);
      const recentAvg =
        recent3.reduce((s, m) => s + m.satisfactionDelta, 0) / 3;
      const priorAvg = prior3.reduce((s, m) => s + m.satisfactionDelta, 0) / 3;
      decelerating = recentAvg < priorAvg * 0.5;
    }

    return {
      satisfaction: currentSatisfaction,
      progressRate: avgDelta,
      estimatedStepsRemaining,
      decelerating,
    };
  }

  /** Clamp satisfaction to [0, 1] and guard against NaN/Infinity (M4). */
  function clampSatisfaction(value: number | undefined): number {
    if (value == null || !Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, Math.min(1, value));
  }

  async function runGoalInternal<T>(
    pattern: GoalPattern<T>,
    initialInput: string | Record<string, unknown>,
    patternId?: string,
    resumeFrom?: GoalCheckpointState,
  ): Promise<GoalResult<T>> {
    const {
      nodes: originalNodes,
      when: goalWhen,
      satisfaction: satisfactionFn,
      maxSteps = 50,
      extract,
      selectionStrategy,
      relaxation,
      onStep,
      onStall,
    } = pattern;

    // Shadow copy of nodes so relaxation mutations don't affect the original (M2)
    const nodes: Record<string, GoalNode> = Object.create(null);
    for (const [id, node] of Object.entries(originalNodes)) {
      nodes[id] = { ...node };
    }

    const nodeIds = Object.keys(nodes);
    if (nodeIds.length === 0) {
      throw new Error("[Directive MultiAgent] goal requires at least one node");
    }

    const pId = patternId ?? "__goal";

    // Validate all node handlers (agents or tasks) are registered
    for (const [nodeId, node] of Object.entries(nodes)) {
      if (!agents[node.handler] && !tasks[node.handler]) {
        throw new Error(
          `[Directive MultiAgent] goal node "${nodeId}" references unregistered handler "${node.handler}"`,
        );
      }
    }

    // Cycle detection
    validateGoalAcyclic(pId, nodes);

    // Producer conflict warnings
    validateProducerConflicts(pId, nodes);

    // Warn if extractOutput is missing (dev guidance)
    for (const [nodeId, node] of Object.entries(nodes)) {
      if (!node.extractOutput) {
        console.warn(
          `[Directive MultiAgent] goal node "${nodeId}": no extractOutput defined. Output will be auto-parsed from agent response. Define extractOutput for reliable fact extraction.`,
        );
      }
    }

    // Signal/timeout composition
    let effectiveSignal = pattern.signal;
    let goalTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let externalOnAbort: (() => void) | undefined;
    const timeoutMs = pattern.timeout ?? 300_000;
    if (timeoutMs && !effectiveSignal) {
      const ctrl = new AbortController();
      goalTimeoutId = setTimeout(() => ctrl.abort(), timeoutMs);
      effectiveSignal = ctrl.signal;
    } else if (timeoutMs && effectiveSignal) {
      const ctrl = new AbortController();
      goalTimeoutId = setTimeout(() => ctrl.abort(), timeoutMs);
      externalOnAbort = () => ctrl.abort();
      effectiveSignal.addEventListener("abort", externalOnAbort, {
        once: true,
      });
      effectiveSignal = ctrl.signal;
    }

    const patternStartTime = Date.now();

    if (timeline) {
      const goalHandlers = Object.values(nodes).map((n) => n.handler);

      timeline.record({
        type: "pattern_start",
        timestamp: patternStartTime,
        snapshotId: null,
        patternId: pId,
        patternType: "goal",
        handlers: goalHandlers,
        taskIds: goalHandlers.filter((h) => tasks[h] != null),
      });
    }
    fireHook("onPatternStart", {
      patternId: pId,
      patternType: "goal",
      input:
        typeof initialInput === "string"
          ? initialInput
          : JSON.stringify(initialInput),
      timestamp: patternStartTime,
    });

    // Initialize facts
    const facts: Record<string, unknown> = Object.create(null);
    if (resumeFrom) {
      goalSafeMerge(facts, resumeFrom.facts);
    } else if (typeof initialInput === "string") {
      facts.input = initialInput;
    } else {
      goalSafeMerge(facts, initialInput);
    }

    // Tracking state — restore from checkpoint or start fresh
    const executionOrder: string[] = resumeFrom
      ? [...resumeFrom.executionOrder]
      : [];
    const nodeResults: Record<string, RunResult<unknown>> = Object.create(null);
    if (resumeFrom) {
      for (const [id, out] of Object.entries(resumeFrom.nodeOutputs)) {
        nodeResults[id] = {
          output: out.output,
          totalTokens: out.totalTokens,
        } as RunResult<unknown>;
      }
    }
    const stepMetrics: GoalStepMetrics[] = resumeFrom
      ? [...resumeFrom.stepMetrics]
      : [];
    const relaxations: RelaxationRecord[] = resumeFrom
      ? [...resumeFrom.relaxations]
      : [];
    const completedNodes = new Set<string>(resumeFrom?.completedNodes ?? []);
    const failedNodes = new Map<string, number>(
      resumeFrom
        ? Object.entries(resumeFrom.failedNodes).map(([k, v]) => [k, v])
        : [],
    );
    const nodeInputHashes = new Map<string, string>(
      resumeFrom ? Object.entries(resumeFrom.nodeInputHashes) : [],
    );
    const agentMetrics: Record<
      string,
      {
        runs: number;
        avgSatisfactionDelta: number;
        tokens: number;
        totalDelta: number;
      }
    > = Object.create(null);
    if (resumeFrom) {
      for (const [id, m] of Object.entries(resumeFrom.agentMetrics)) {
        agentMetrics[id] = {
          runs: m.runs,
          avgSatisfactionDelta: m.runs > 0 ? m.totalDelta / m.runs : 0,
          tokens: m.tokens,
          totalDelta: m.totalDelta,
        };
      }
    }
    let stallSteps = resumeFrom?.stallSteps ?? 0;
    let appliedRelaxationTiers = resumeFrom?.appliedRelaxationTiers ?? 0;
    let lastSatisfaction = resumeFrom?.lastSatisfaction ?? 0;
    let patternError: Error | undefined;
    let goalAchieved = false;
    const startStep = resumeFrom?.step ?? 0;

    // Checkpoint config
    const checkpointConfig = pattern.checkpoint;
    const checkpointEveryN = checkpointConfig?.everyN ?? 5;
    const checkpointStoreRef = checkpointConfig?.store ?? checkpointStore;
    const checkpointLabelPrefix = checkpointConfig?.labelPrefix ?? "goal";
    let lastCheckpointId: string | undefined;
    void lastCheckpointId; // Used later in checkpoint save

    const MAX_CONSECUTIVE_FAILURES = 3;

    try {
      for (let step = startStep; step < maxSteps; step++) {
        // Check goal condition (C1: safe-wrap user callback)
        if (safeCall(goalWhen, facts) === true) {
          goalAchieved = true;
          const durationMs = Date.now() - patternStartTime;
          const totalTokens = Object.values(nodeResults).reduce(
            (sum, r) => sum + r.totalTokens,
            0,
          );

          return {
            achieved: true,
            result: safeCall(extract, facts) ?? (facts as unknown as T),
            facts: { ...facts },
            executionOrder,
            nodeResults,
            steps: step,
            totalTokens,
            durationMs,
            stepMetrics,
            relaxations,
          };
        }

        // Check abort
        if (effectiveSignal?.aborted) {
          const durationMs = Date.now() - patternStartTime;
          const totalTokens = Object.values(nodeResults).reduce(
            (sum, r) => sum + r.totalTokens,
            0,
          );

          return {
            achieved: false,
            result: safeCall(extract, facts) ?? (facts as unknown as T),
            facts: { ...facts },
            executionOrder,
            nodeResults,
            steps: step,
            totalTokens,
            durationMs,
            stepMetrics,
            relaxations,
            error: "Aborted or timed out",
          };
        }

        // Find ready nodes
        const readyNodes: string[] = [];
        for (const [nodeId, node] of Object.entries(nodes)) {
          // Skip permanently failed nodes
          if ((failedNodes.get(nodeId) ?? 0) >= MAX_CONSECUTIVE_FAILURES) {
            continue;
          }

          // Check requires satisfied
          const requires = node.requires ?? [];
          const requiresSatisfied = requires.every((key) => facts[key] != null);
          if (!requiresSatisfied) {
            continue;
          }

          // Check if already completed
          if (completedNodes.has(nodeId)) {
            if (!node.allowRerun) {
              continue;
            }

            // Check if inputs changed
            const inputHash = JSON.stringify(requires.map((key) => facts[key]));
            if (nodeInputHashes.get(nodeId) === inputHash) {
              continue;
            }
          }

          readyNodes.push(nodeId);
        }

        // Apply selection strategy
        let selectedNodes = readyNodes;
        if (selectionStrategy && readyNodes.length > 0) {
          const rawSatisfaction = satisfactionFn
            ? (safeCall(satisfactionFn, facts) ?? 0)
            : safeCall(goalWhen, facts) === true
              ? 1.0
              : 0.0;
          const currentSatisfaction = clampSatisfaction(rawSatisfaction);
          const goalProgressMetrics = computeGoalMetrics(
            currentSatisfaction,
            stepMetrics,
            step,
          );

          // Build per-agent metrics for the strategy
          const strategyMetrics: Record<
            string,
            { runs: number; avgSatisfactionDelta: number; tokens: number }
          > = Object.create(null);
          for (const [id, m] of Object.entries(agentMetrics)) {
            strategyMetrics[id] = {
              runs: m.runs,
              avgSatisfactionDelta: m.runs > 0 ? m.totalDelta / m.runs : 0,
              tokens: m.tokens,
            };
          }

          const strategyResult = selectionStrategy.select(
            readyNodes,
            strategyMetrics,
            goalProgressMetrics,
          );
          // Guard against empty selection strategy result — fall back to readyNodes
          selectedNodes =
            strategyResult && strategyResult.length > 0
              ? strategyResult
              : readyNodes;
        }

        // Sort by priority (higher first)
        selectedNodes.sort(
          (a, b) => (nodes[b]!.priority ?? 0) - (nodes[a]!.priority ?? 0),
        );

        // Fire onStep hook (C1: safe-wrap)
        safeCall(onStep, step, { ...facts }, selectedNodes);

        // Handle no ready nodes
        if (selectedNodes.length === 0) {
          // Check relaxation tiers
          stallSteps++;
          let relaxationApplied = false;

          if (relaxation) {
            for (
              let tierIdx = appliedRelaxationTiers;
              tierIdx < relaxation.length;
              tierIdx++
            ) {
              const tier = relaxation[tierIdx]!;
              const threshold = tier.afterStallSteps ?? 3;
              if (stallSteps >= threshold) {
                // Apply relaxation
                const strategy = tier.strategy;
                switch (strategy.type) {
                  case "allow_rerun":
                    for (const nid of strategy.nodes) {
                      completedNodes.delete(nid);
                      nodeInputHashes.delete(nid);
                    }
                    break;
                  case "alternative_nodes":
                    // Use shadow copy — don't mutate original pattern nodes
                    for (const altNode of strategy.nodes) {
                      const altId = `__relaxation_${tierIdx}_${altNode.handler}`;
                      nodes[altId] = { ...altNode };
                    }
                    break;
                  case "inject_facts":
                    goalSafeMerge(facts, strategy.facts);
                    break;
                  case "accept_partial": {
                    const durationMs = Date.now() - patternStartTime;
                    const totalTokens = Object.values(nodeResults).reduce(
                      (sum, r) => sum + r.totalTokens,
                      0,
                    );

                    return {
                      achieved: false,
                      result:
                        safeCall(extract, facts) ?? (facts as unknown as T),
                      facts: { ...facts },
                      executionOrder,
                      nodeResults,
                      steps: step,
                      totalTokens,
                      durationMs,
                      stepMetrics,
                      relaxations,
                      error: `Accepted partial result via relaxation tier "${tier.label}"`,
                    };
                  }
                  case "custom": {
                    const rawSat = safeCall(satisfactionFn, facts) ?? 0;
                    const ctx: RelaxationContext = {
                      step,
                      facts: { ...facts },
                      metrics: computeGoalMetrics(
                        clampSatisfaction(rawSat),
                        stepMetrics,
                        step,
                      ),
                      completedNodes: new Set(completedNodes),
                      failedNodes: new Map(failedNodes),
                    };
                    // safe-wrap custom strategy callback
                    await safeCallAsync(strategy.apply, ctx);
                    break;
                  }
                }

                relaxations.push({
                  step,
                  tierIndex: tierIdx,
                  label: tier.label,
                  strategy: strategy.type,
                });
                appliedRelaxationTiers = tierIdx + 1;
                stallSteps = 0;
                relaxationApplied = true;
                break;
              }
            }
          }

          if (!relaxationApplied) {
            // Fire onStall hook (C1: safe-wrap, M7: computed metrics)
            const rawSat = safeCall(satisfactionFn, facts) ?? 0;
            const stallMetrics = computeGoalMetrics(
              clampSatisfaction(rawSat),
              stepMetrics,
              step,
            );
            safeCall(onStall, step, stallMetrics);

            // If we've exhausted all relaxation tiers and still stalled, fail
            if (!relaxation || appliedRelaxationTiers >= relaxation.length) {
              const durationMs = Date.now() - patternStartTime;
              const totalTokens = Object.values(nodeResults).reduce(
                (sum, r) => sum + r.totalTokens,
                0,
              );

              return {
                achieved: false,
                result: safeCall(extract, facts) ?? (facts as unknown as T),
                facts: { ...facts },
                executionOrder,
                nodeResults,
                steps: step,
                totalTokens,
                durationMs,
                stepMetrics,
                relaxations,
                error:
                  "Goal stalled: no ready nodes and no remaining relaxation tiers",
              };
            }
          }

          continue;
        }

        // Reset stall counter since we have ready nodes
        stallSteps = 0;

        // Run selected nodes in parallel
        const stepStart = Date.now();
        const rawPreSat = satisfactionFn
          ? (safeCall(satisfactionFn, facts) ?? 0)
          : safeCall(goalWhen, facts) === true
            ? 1.0
            : 0.0;
        const preSatisfaction = clampSatisfaction(rawPreSat);
        let stepTokens = 0;
        const factsProduced: string[] = [];

        const nodePromises = selectedNodes.map(async (nodeId) => {
          const node = nodes[nodeId]!;

          // Record input hash for allowRerun detection
          const requires = node.requires ?? [];
          const inputHash = JSON.stringify(requires.map((key) => facts[key]));
          nodeInputHashes.set(nodeId, inputHash);

          // Build input (C1: safe-wrap buildInput)
          let nodeInput: string;
          const customInput = safeCall(node.buildInput, facts);
          if (customInput != null) {
            nodeInput = customInput;
          } else {
            const relevantFacts: Record<string, unknown> = Object.create(null);
            for (const key of requires) {
              if (facts[key] != null) {
                relevantFacts[key] = facts[key];
              }
            }
            if (Object.keys(relevantFacts).length > 0) {
              nodeInput = JSON.stringify(relevantFacts);
            } else if (facts.input != null) {
              nodeInput = String(facts.input);
            } else {
              nodeInput = JSON.stringify(facts);
            }
          }

          try {
            const result = await runSingleAgent(node.handler, nodeInput, {
              signal: effectiveSignal ?? undefined,
              patternId: pId,
            });
            nodeResults[nodeId] = result;
            executionOrder.push(nodeId);
            completedNodes.add(nodeId);
            failedNodes.delete(nodeId);

            // Extract output facts (C1: safe-wrap extractOutput)
            if (node.extractOutput) {
              const outputFacts = safeCall(node.extractOutput, result);
              if (outputFacts) {
                goalSafeMerge(facts, outputFacts);
                factsProduced.push(...Object.keys(outputFacts));
              }
            } else {
              // Default: try JSON parse of output
              const rawOutput = result.output;
              if (rawOutput && typeof rawOutput === "object") {
                goalSafeMerge(facts, rawOutput as Record<string, unknown>);
                factsProduced.push(
                  ...Object.keys(rawOutput as Record<string, unknown>),
                );
              } else if (typeof rawOutput === "string") {
                try {
                  const parsed = JSON.parse(rawOutput);
                  if (
                    parsed &&
                    typeof parsed === "object" &&
                    !Array.isArray(parsed)
                  ) {
                    goalSafeMerge(facts, parsed);
                    factsProduced.push(...Object.keys(parsed));
                  } else {
                    // Store under produce keys
                    for (const key of node.produces) {
                      facts[key] = rawOutput;
                      factsProduced.push(key);
                    }
                  }
                } catch {
                  for (const key of node.produces) {
                    facts[key] = rawOutput;
                    factsProduced.push(key);
                  }
                }
              }
            }

            stepTokens += result.totalTokens;

            return { nodeId, success: true };
          } catch (error) {
            const failures = (failedNodes.get(nodeId) ?? 0) + 1;
            failedNodes.set(nodeId, failures);

            return { nodeId, success: false, error };
          }
        });

        await Promise.allSettled(nodePromises);

        // Compute step metrics (M4: clamp satisfaction)
        const rawPostSat = satisfactionFn
          ? (safeCall(satisfactionFn, facts) ?? 0)
          : safeCall(goalWhen, facts) === true
            ? 1.0
            : 0.0;
        const postSatisfaction = clampSatisfaction(rawPostSat);
        const satisfactionDelta = postSatisfaction - preSatisfaction;

        stepMetrics.push({
          step,
          durationMs: Date.now() - stepStart,
          nodesRun: [...selectedNodes],
          factsProduced,
          satisfaction: postSatisfaction,
          satisfactionDelta,
          tokensConsumed: stepTokens,
        });

        // Record timeline events for each node run in this step
        if (timeline) {
          for (const nodeId of selectedNodes) {
            const node = nodes[nodeId]!;
            timeline.record({
              type: "goal_step",
              timestamp: Date.now(),
              snapshotId: null,
              agentId: node.handler,
              step,
              nodeId,
              satisfaction: postSatisfaction,
              satisfactionDelta,
            });
          }
        }

        // Update per-agent metrics
        for (const nodeId of selectedNodes) {
          const node = nodes[nodeId]!;
          if (!agentMetrics[node.handler]) {
            agentMetrics[node.handler] = {
              runs: 0,
              avgSatisfactionDelta: 0,
              tokens: 0,
              totalDelta: 0,
            };
          }
          const m = agentMetrics[node.handler]!;
          m.runs++;
          m.totalDelta += satisfactionDelta;
          m.tokens += nodeResults[nodeId]?.totalTokens ?? 0;
        }

        lastSatisfaction = postSatisfaction;

        // Track stall (no satisfaction change)
        if (satisfactionDelta <= 0) {
          stallSteps++;
        } else {
          stallSteps = 0;
        }

        // Save checkpoint at configured intervals
        if (
          checkpointConfig &&
          checkpointStoreRef &&
          step > startStep &&
          (step - startStep) % checkpointEveryN === 0
        ) {
          const ckptState: GoalCheckpointState = {
            type: "goal",
            version: 1,
            id: createCheckpointId(),
            createdAt: new Date().toISOString(),
            label: `${checkpointLabelPrefix}:step-${step}`,
            patternId: pId,
            stepsTotal: maxSteps,
            step: step + 1, // Next step to run
            facts: structuredClone(facts),
            completedNodes: [...completedNodes],
            failedNodes: Object.fromEntries(failedNodes),
            nodeInputHashes: Object.fromEntries(nodeInputHashes),
            nodeOutputs: Object.fromEntries(
              Object.entries(nodeResults).map(([id, r]) => [
                id,
                { output: r.output, totalTokens: r.totalTokens },
              ]),
            ),
            executionOrder: [...executionOrder],
            stepMetrics: [...stepMetrics],
            relaxations: [...relaxations],
            appliedRelaxationTiers,
            stallSteps,
            lastSatisfaction,
            agentMetrics: Object.fromEntries(
              Object.entries(agentMetrics).map(([id, m]) => [
                id,
                { runs: m.runs, totalDelta: m.totalDelta, tokens: m.tokens },
              ]),
            ),
          };
          const savedId = await savePatternCheckpoint(
            ckptState,
            checkpointStoreRef,
            checkpointConfig,
          );
          if (savedId) {
            lastCheckpointId = savedId;
          }
        }
      }

      // Max steps exhausted
      const durationMs = Date.now() - patternStartTime;
      const totalTokens = Object.values(nodeResults).reduce(
        (sum, r) => sum + r.totalTokens,
        0,
      );

      return {
        achieved: false,
        result: safeCall(extract, facts) ?? (facts as unknown as T),
        facts: { ...facts },
        executionOrder,
        nodeResults,
        steps: maxSteps,
        totalTokens,
        durationMs,
        stepMetrics,
        relaxations,
        error: `Max steps (${maxSteps}) exhausted without achieving goal`,
      };
    } catch (error) {
      patternError = error instanceof Error ? error : new Error(String(error));
      throw error;
    } finally {
      if (goalTimeoutId != null) {
        clearTimeout(goalTimeoutId);
      }
      if (externalOnAbort && pattern.signal) {
        pattern.signal.removeEventListener("abort", externalOnAbort);
      }
      if (timeline) {
        const totalTokens = Object.values(nodeResults).reduce(
          (sum, r) => sum + r.totalTokens,
          0,
        );
        timeline.record({
          type: "pattern_complete",
          timestamp: Date.now(),
          snapshotId: null,
          patternId: pId,
          patternType: "goal",
          durationMs: Date.now() - patternStartTime,
          achieved: goalAchieved,
          stepMetrics,
          relaxations,
          totalTokens,
          ...(patternError ? { error: patternError.message } : {}),
        });
      }
      fireHook("onPatternComplete", {
        patternId: pId,
        patternType: "goal",
        durationMs: Date.now() - patternStartTime,
        timestamp: Date.now(),
        error: patternError,
      });
    }
  }

  // ---- Self-Healing Helpers ----
  function findEquivalentAgents(agentId: string): string[] {
    if (!selfHealing) {
      return [];
    }

    const equivalents: string[] = [];
    const seen = new Set<string>();
    seen.add(agentId);

    // Check explicit groups first
    if (selfHealing.equivalencyGroups) {
      for (const group of Object.values(selfHealing.equivalencyGroups)) {
        if (group.includes(agentId)) {
          for (const id of group) {
            if (!seen.has(id) && agents[id]) {
              equivalents.push(id);
              seen.add(id);
            }
          }
        }
      }
    }

    // Then capability matching
    if (selfHealing.useCapabilities !== false) {
      const sourceReg = agents[agentId];
      if (sourceReg?.capabilities && sourceReg.capabilities.length > 0) {
        for (const [id, reg] of Object.entries(agents)) {
          if (seen.has(id)) {
            continue;
          }
          const caps = reg.capabilities ?? [];
          if (sourceReg.capabilities.every((c) => caps.includes(c))) {
            equivalents.push(id);
            seen.add(id);
          }
        }
      }
    }

    // Filter out unhealthy agents
    if (healthMonitorInstance) {
      const threshold = selfHealing.healthThreshold ?? 30;

      return equivalents.filter((id) => {
        const score = healthMonitorInstance!.getHealthScore(id);

        return score > threshold;
      });
    }

    return equivalents;
  }

  function selectBestEquivalent(equivalents: string[]): string | null {
    if (equivalents.length === 0) {
      return null;
    }

    if (!selfHealing || !healthMonitorInstance) {
      return equivalents[0] ?? null;
    }

    if (selfHealing.selectionStrategy === "round-robin" && roundRobinCounters) {
      // Round-robin across equivalents
      const key = [...equivalents].sort().join(",");
      const counter = roundRobinCounters.get(key) ?? 0;
      const selected = equivalents[counter % equivalents.length]!;
      roundRobinCounters.set(key, counter + 1);

      return selected;
    }

    // Default: healthiest
    let best = equivalents[0]!;
    let bestScore = healthMonitorInstance.getHealthScore(best);
    for (let i = 1; i < equivalents.length; i++) {
      const score = healthMonitorInstance.getHealthScore(equivalents[i]!);
      if (score > bestScore) {
        best = equivalents[i]!;
        bestScore = score;
      }
    }

    return best;
  }

  // ---- Pattern handler extraction (for debug events) ----
  function getPatternHandlers(pattern: ExecutionPattern): string[] {
    switch (pattern.type) {
      case "parallel":
        return pattern.handlers;
      case "sequential":
        return pattern.handlers;
      case "supervisor":
        return [pattern.supervisor, ...pattern.workers];
      case "dag":
        return Object.values(pattern.nodes).map((n) => n.handler);
      case "reflect":
        return [pattern.handler, pattern.evaluator];
      case "race":
        return pattern.handlers;
      case "debate":
        return [...pattern.handlers, pattern.evaluator];
      case "goal":
        return Object.values(pattern.nodes).map((n) => n.handler);
      default:
        return [];
    }
  }

  // ---- Build Orchestrator Object ----
  const orchestrator: MultiAgentOrchestrator = {
    system: system as unknown as System<any>,

    get facts() {
      // biome-ignore lint/suspicious/noExplicitAny: System facts vary
      return system.facts as any;
    },

    get timeline() {
      return timeline;
    },

    get healthMonitor() {
      return healthMonitorInstance;
    },

    get derived() {
      return Object.freeze({ ...derivedValues });
    },

    onDerivedChange(
      callback: (id: string, value: unknown) => void,
    ): () => void {
      derivedChangeCallbacks.add(callback);

      return () => {
        derivedChangeCallbacks.delete(callback);
      };
    },

    get scratchpad() {
      return scratchpadInstance;
    },

    runAgent: runSingleAgent,
    runAgentStream: runAgentStreamImpl,

    async runPattern<T>(patternId: string, input: string): Promise<T> {
      assertNotDisposed();

      const pattern = patterns[patternId];
      if (!pattern) {
        const available = Object.keys(patterns).join(", ") || "(none)";

        throw new Error(
          `[Directive MultiAgent] Unknown pattern "${patternId}". Available patterns: ${available}`,
        );
      }

      const patternStartTime = Date.now();
      if (timeline) {
        const handlerIds = getPatternHandlers(pattern);

        timeline.record({
          type: "pattern_start",
          timestamp: patternStartTime,
          snapshotId: null,
          patternId,
          patternType: pattern.type,
          handlers: handlerIds,
          taskIds: handlerIds.filter((h) => tasks[h] != null),
        });
      }

      let patternError: Error | undefined;
      try {
        switch (pattern.type) {
          case "parallel":
            return await runParallelPattern(
              pattern as ParallelPattern<T>,
              input,
              patternId,
            );
          case "sequential":
            return await runSequentialPattern(
              pattern as SequentialPattern<T>,
              input,
              patternId,
            );
          case "supervisor":
            return await runSupervisorPattern(
              pattern as SupervisorPattern<T>,
              input,
              patternId,
            );
          case "dag":
            return await runDagPattern(
              pattern as DagPattern<T>,
              input,
              patternId,
            );
          case "reflect":
            return await runReflectPattern(
              pattern as ReflectPattern<T>,
              input,
              patternId,
            );
          case "race": {
            const raceResult = await runRacePattern(
              pattern as RacePattern<T>,
              input,
              patternId,
            );

            return raceResult.result;
          }
          case "debate": {
            const debatePattern = pattern as DebatePattern<T>;
            const debateResult = await runDebateInternal<T>(
              debatePattern,
              input,
              patternId,
            );

            return debateResult.result;
          }
          case "goal": {
            const goalPattern = pattern as GoalPattern<T>;
            const goalResult = await runGoalInternal<T>(
              goalPattern,
              input,
              patternId,
            );

            return goalResult.result;
          }
          default:
            throw new Error(
              `[Directive MultiAgent] Unknown pattern type: ${(pattern as { type: string }).type}`,
            );
        }
      } catch (error) {
        patternError =
          error instanceof Error ? error : new Error(String(error));
        throw error;
      } finally {
        if (timeline) {
          timeline.record({
            type: "pattern_complete",
            timestamp: Date.now(),
            snapshotId: null,
            patternId,
            patternType: pattern.type,
            durationMs: Date.now() - patternStartTime,
            ...(patternError ? { error: patternError.message } : {}),
          });
        }
      }
    },

    async runParallel<T>(
      agentIds: string[],
      inputs: string | string[],
      merge: (results: RunResult<unknown>[]) => T | Promise<T>,
      options?: { minSuccess?: number; timeout?: number },
    ): Promise<T> {
      assertNotDisposed();
      const inputArray = Array.isArray(inputs)
        ? inputs
        : agentIds.map(() => inputs);

      if (inputArray.length !== agentIds.length) {
        throw new Error(
          `[Directive MultiAgent] Input count (${inputArray.length}) must match agent count (${agentIds.length})`,
        );
      }

      const controller = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      if (options?.timeout) {
        timeoutId = setTimeout(() => controller.abort(), options.timeout);
      }

      try {
        const promises = agentIds.map((agentId, i) =>
          runSingleAgent(agentId, inputArray[i]!, {
            signal: controller.signal,
          }).catch((error) => {
            if (options?.minSuccess !== undefined) {
              return null;
            }

            throw error;
          }),
        );

        const results = await Promise.all(promises);
        const successResults = results.filter(
          (r): r is RunResult<unknown> => r !== null,
        );

        if (
          options?.minSuccess !== undefined &&
          successResults.length < options.minSuccess
        ) {
          const failCount = results.length - successResults.length;

          throw new Error(
            `[Directive MultiAgent] runParallel: Only ${successResults.length}/${agentIds.length} agents succeeded ` +
              `(minimum required: ${options.minSuccess}, failed: ${failCount})`,
          );
        }

        return merge(successResults);
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    },

    async runSequential<T>(
      agentIds: string[],
      initialInput: string,
      opts?: {
        transform?: (output: unknown, agentId: string, index: number) => string;
      },
    ): Promise<RunResult<T>[]> {
      assertNotDisposed();
      const results: RunResult<unknown>[] = [];
      let currentInput = initialInput;

      for (let i = 0; i < agentIds.length; i++) {
        const agentId = agentIds[i]!;
        const result = await runSingleAgent(agentId, currentInput);
        results.push(result);

        if (i < agentIds.length - 1) {
          if (opts?.transform) {
            currentInput = opts.transform(result.output, agentId, i);
          } else {
            currentInput =
              typeof result.output === "string"
                ? result.output
                : safeStringify(result.output);
          }
        }
      }

      return results as RunResult<T>[];
    },

    async handoff(
      fromAgent: string,
      toAgent: string,
      input: string,
      context?: Record<string, unknown>,
    ): Promise<RunResult<unknown>> {
      assertNotDisposed();

      if (!agents[fromAgent]) {
        const available = Object.keys(agents).join(", ") || "(none)";

        throw new Error(
          `[Directive MultiAgent] Handoff source agent "${fromAgent}" not found. Registered: ${available}`,
        );
      }
      if (!agents[toAgent]) {
        const available = Object.keys(agents).join(", ") || "(none)";

        throw new Error(
          `[Directive MultiAgent] Handoff target agent "${toAgent}" not found. Registered: ${available}`,
        );
      }

      // ---- Breakpoint: pre_handoff ----
      {
        const bpResult = await handleBreakpoint(
          "pre_handoff",
          fromAgent,
          agents[fromAgent]!.agent.name,
          input,
          undefined,
          {
            handoff: { fromAgent, toAgent },
          },
        );
        if (bpResult.skip) {
          return {
            output: undefined as unknown,
            messages: [],
            toolCalls: [],
            totalTokens: 0,
          };
        }
        input = bpResult.input;
      }

      const request: HandoffRequest = {
        id: `handoff-${++handoffCounter}`,
        fromAgent,
        toAgent,
        input,
        context,
        requestedAt: Date.now(),
      };

      pendingHandoffs.push(request);
      try {
        onHandoff?.(request);
      } catch (e) {
        if (debug) {
          console.debug("[Directive MultiAgent] onHandoff threw:", e);
        }
      }
      fireHook("onHandoff", request);

      if (timeline) {
        timeline.record({
          type: "handoff_start",
          timestamp: Date.now(),
          snapshotId: null,
          fromAgent,
          toAgent,
        });
      }

      // Forward handoff context to receiving agent's memory (best-effort)
      const targetMemory = agents[toAgent]!.memory ?? sharedMemory;
      if (targetMemory && context) {
        try {
          const contextSummary = Object.entries(context)
            .map(([k, v]) => `${k}: ${safeStringify(v)}`)
            .join(", ");
          targetMemory.addMessages([
            {
              role: "system",
              content: `[Handoff from ${fromAgent}] Context: ${contextSummary}`,
            },
          ]);
        } catch (memoryError) {
          if (debug) {
            console.debug(
              "[Directive MultiAgent] Handoff addMessages failed:",
              memoryError,
            );
          }
        }
      }

      try {
        const result = await runSingleAgent(toAgent, input);

        const handoffResult: HandoffResult = {
          request,
          result,
          completedAt: Date.now(),
        };

        addHandoffResult(handoffResult);
        try {
          onHandoffComplete?.(handoffResult);
        } catch (e) {
          if (debug) {
            console.debug("[Directive MultiAgent] onHandoffComplete threw:", e);
          }
        }
        fireHook("onHandoffComplete", handoffResult);

        if (timeline) {
          timeline.record({
            type: "handoff_complete",
            timestamp: Date.now(),
            snapshotId: null,
            fromAgent,
            toAgent,
            durationMs: handoffResult.completedAt - request.requestedAt,
          });
        }

        const index = pendingHandoffs.indexOf(request);
        if (index >= 0) pendingHandoffs.splice(index, 1);

        return result;
      } catch (error) {
        const index = pendingHandoffs.indexOf(request);
        if (index >= 0) pendingHandoffs.splice(index, 1);
        throw error;
      }
    },

    approve(requestId: string): void {
      assertNotDisposed();

      // O(1) lookup via reverse index
      const agentId = approvalRequestIndex.get(requestId);
      if (agentId) {
        approvalRequestIndex.delete(requestId);
        const agentFacts = getAgentFacts(agentId);
        system.batch(() => {
          const currentApproval = getApprovalState(agentFacts);
          const MAX_APPROVAL_HISTORY = 200;
          const approved = [...currentApproval.approved, requestId];
          setApprovalState(agentFacts, {
            ...currentApproval,
            pending: currentApproval.pending.filter(
              (r: ApprovalRequest) => r.id !== requestId,
            ),
            approved:
              approved.length > MAX_APPROVAL_HISTORY
                ? approved.slice(-MAX_APPROVAL_HISTORY)
                : approved,
          });
        });

        return;
      }

      if (debug) {
        console.debug(
          `[Directive MultiAgent] approve() ignored: no pending request "${requestId}"`,
        );
      }
    },

    reject(requestId: string, reason?: string): void {
      assertNotDisposed();

      // O(1) lookup via reverse index
      const agentId = approvalRequestIndex.get(requestId);
      if (agentId) {
        approvalRequestIndex.delete(requestId);
        const agentFacts = getAgentFacts(agentId);
        system.batch(() => {
          const currentApproval = getApprovalState(agentFacts);
          if (reason && debug) {
            console.debug(
              `[Directive MultiAgent] Request ${requestId} rejected: ${reason}`,
            );
          }
          const rejectedRequest: RejectedRequest = {
            id: requestId,
            reason,
            rejectedAt: Date.now(),
          };
          const MAX_REJECTION_HISTORY = 200;
          const rejected = [...currentApproval.rejected, rejectedRequest];
          setApprovalState(agentFacts, {
            ...currentApproval,
            pending: currentApproval.pending.filter(
              (r: ApprovalRequest) => r.id !== requestId,
            ),
            rejected:
              rejected.length > MAX_REJECTION_HISTORY
                ? rejected.slice(-MAX_REJECTION_HISTORY)
                : rejected,
          });
        });

        return;
      }

      if (debug) {
        console.debug(
          `[Directive MultiAgent] reject() ignored: no pending request "${requestId}"`,
        );
      }
    },

    pause(): void {
      assertNotDisposed();
      globalStatus = "paused";
      if (debug) {
        console.debug("[Directive MultiAgent] Orchestrator paused");
      }
    },

    resume(): void {
      assertNotDisposed();
      if (globalStatus === "paused") {
        globalStatus = "idle";
        if (debug) {
          console.debug("[Directive MultiAgent] Orchestrator resumed");
        }
      }
    },

    getAgentState(agentId: string) {
      const state = agentStates[agentId];

      return state ? { ...state } : undefined;
    },

    getAllAgentStates() {
      return Object.fromEntries(
        Object.entries(agentStates).map(([k, v]) => [k, { ...v }]),
      );
    },

    getPendingHandoffs() {
      return [...pendingHandoffs];
    },

    /** Total tokens consumed across all agents */
    get totalTokens(): number {
      return globalTokenCount;
    },

    /** Wait until all agents are idle (no running agents) */
    waitForIdle(timeoutMs?: number): Promise<void> {
      const allIdle = () =>
        pendingRuns === 0 &&
        Object.values(agentStates).every(
          (s) =>
            s.status === "idle" ||
            s.status === "completed" ||
            s.status === "error",
        );
      if (allIdle()) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve, reject) => {
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
          idleWaiters.delete(check);
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
        };

        const check = () => {
          if (allIdle()) {
            cleanup();
            resolve();
          }
        };

        idleWaiters.add(check);

        if (timeoutMs !== undefined) {
          timeoutId = setTimeout(() => {
            cleanup();
            reject(
              new Error(
                `[Directive MultiAgent] waitForIdle timed out after ${timeoutMs}ms`,
              ),
            );
          }, timeoutMs);
        }
      });
    },

    /** Alias for runAgent */
    run<T>(
      agentId: string,
      input: string,
      options?: MultiAgentRunCallOptions,
    ): Promise<RunResult<T>> {
      return runSingleAgent<T>(agentId, input, options);
    },

    /** Alias for runAgentStream */
    runStream<T>(
      agentId: string,
      input: string,
      options?: { signal?: AbortSignal },
    ): OrchestratorStreamResult<T> {
      return runAgentStreamImpl<T>(agentId, input, options);
    },

    registerAgent(agentId: string, registration: AgentRegistration): void {
      assertNotDisposed();
      if (RESERVED_IDS.has(agentId)) {
        throw new Error(
          `[Directive MultiAgent] Agent ID "${agentId}" is reserved and cannot be used`,
        );
      }
      if (agents[agentId]) {
        throw new Error(
          `[Directive MultiAgent] Agent "${agentId}" is already registered. Unregister first.`,
        );
      }
      if (tasks[agentId]) {
        throw new Error(
          `[Directive MultiAgent] ID "${agentId}" is already registered as a task`,
        );
      }

      // Build per-agent constraints and resolvers (same as initial setup)
      // biome-ignore lint/suspicious/noExplicitAny: Constraint types complex
      const perAgentConstraints: Record<string, any> = registration.constraints
        ? convertOrchestratorConstraints(registration.constraints)
        : {};

      // biome-ignore lint/suspicious/noExplicitAny: Resolver types complex
      const perAgentResolvers: Record<string, any> = Object.create(null);
      if (registration.resolvers) {
        for (const [id, resolver] of Object.entries(registration.resolvers)) {
          perAgentResolvers[id] = {
            requirement: resolver.requirement,
            key: resolver.key,
            // biome-ignore lint/suspicious/noExplicitAny: Context type varies
            resolve: async (req: Requirement, context: any) => {
              const state = getOrchestratorState(context.facts);
              const combinedFacts = {
                ...context.facts,
                ...state,
              } as unknown as Record<string, unknown> & OrchestratorState;

              const resolverContext: OrchestratorResolverContext<
                Record<string, unknown>
              > = {
                facts: combinedFacts,
                runAgent: async <T>(
                  agent: AgentLike,
                  input: string,
                  opts?: RunOptions,
                ) => {
                  return runner<T>(agent, input, opts);
                },
                signal: context.signal,
              };

              return resolver.resolve(req, resolverContext);
            },
          };
        }
      }

      // Create Directive module and register with the System
      const agentModule = createModule(agentId, {
        schema: orchestratorBridgeSchema,
        init: (facts) => {
          setAgentState(facts, {
            status: "idle",
            currentAgent: registration.agent.name,
            input: null,
            output: null,
            error: null,
            tokenUsage: 0,
            turnCount: 0,
            startedAt: null,
            completedAt: null,
          });
          setApprovalState(facts, { pending: [], approved: [], rejected: [] });
          setConversation(facts, []);
          setToolCalls(facts, []);
          setBreakpointState(facts, createInitialBreakpointState());
        },
        constraints: perAgentConstraints,
        resolvers:
          Object.keys(perAgentResolvers).length > 0
            ? (perAgentResolvers as any)
            : undefined,
      });

      // biome-ignore lint/suspicious/noExplicitAny: System type narrowing loses namespaced overload
      (system as any).registerModule(agentId, agentModule);

      // Add to registry
      agents[agentId] = registration;

      // Create semaphore
      semaphores.set(agentId, new Semaphore(registration.maxConcurrent ?? 1));

      // Initialize agent state
      agentStates[agentId] = {
        status: "idle",
        runCount: 0,
        totalTokens: 0,
      };

      if (debug) {
        console.debug(
          `[Directive MultiAgent] Registered agent "${agentId}" (${registration.agent.name})`,
        );
      }

      recomputeDerivations();
    },

    unregisterAgent(agentId: string): void {
      assertNotDisposed();
      if (!agents[agentId]) {
        throw new Error(
          `[Directive MultiAgent] Agent "${agentId}" is not registered`,
        );
      }

      const state = agentStates[agentId];
      if (state?.status === "running") {
        throw new Error(
          `[Directive MultiAgent] Cannot unregister agent "${agentId}" while it is running`,
        );
      }

      // Warn about orphaned patterns referencing this agent
      for (const [patternId, pattern] of Object.entries(patterns)) {
        let referencedAgents: string[];
        switch (pattern.type) {
          case "supervisor":
            referencedAgents = [pattern.supervisor, ...pattern.workers];
            break;
          case "dag":
            referencedAgents = Object.values(pattern.nodes).map(
              (n) => n.handler,
            );
            break;
          case "reflect":
            referencedAgents = [pattern.handler, pattern.evaluator];
            break;
          case "parallel":
          case "sequential":
          case "race":
            referencedAgents = pattern.handlers;
            break;
          case "debate":
            referencedAgents = [
              ...(pattern as DebatePattern).handlers,
              (pattern as DebatePattern).evaluator,
            ];
            break;
          default:
            referencedAgents = [];
        }
        if (referencedAgents.includes(agentId)) {
          console.warn(
            `[Directive MultiAgent] Warning: Pattern "${patternId}" references unregistered agent "${agentId}"`,
          );
        }
      }

      // Drain semaphore
      const sem = semaphores.get(agentId);
      if (sem) {
        sem.drain();
        semaphores.delete(agentId);
      }

      // Reset per-agent System facts to idle state
      const agentFacts = getAgentFacts(agentId);
      if (agentFacts) {
        system.batch(() => {
          setAgentState(agentFacts, {
            status: "idle",
            currentAgent: null,
            input: null,
            output: null,
            error: null,
            tokenUsage: 0,
            turnCount: 0,
            startedAt: null,
            completedAt: null,
          });
          setApprovalState(agentFacts, {
            pending: [],
            approved: [],
            rejected: [],
          });
          setConversation(agentFacts, []);
          setToolCalls(agentFacts, []);
          setBreakpointState(agentFacts, createInitialBreakpointState());
        });
      }

      // Remove from local registries
      // Note: Directive System modules cannot be removed at runtime,
      // but the agent's facts are reset and it won't be accessible via orchestrator methods
      delete agents[agentId];
      delete agentStates[agentId];

      if (debug) {
        console.debug(`[Directive MultiAgent] Unregistered agent "${agentId}"`);
      }

      recomputeDerivations();
    },

    getAgentIds(): string[] {
      return Object.keys(agents);
    },

    registerTask(taskId: string, registration: TaskRegistration): void {
      assertNotDisposed();
      if (RESERVED_IDS.has(taskId)) {
        throw new Error(
          `[Directive MultiAgent] Task ID "${taskId}" is reserved and cannot be used`,
        );
      }
      if (
        !taskId ||
        typeof taskId !== "string" ||
        taskId.trim() !== taskId ||
        taskId.length === 0
      ) {
        throw new Error(
          "[Directive MultiAgent] Task ID must be a non-empty trimmed string",
        );
      }
      if (agents[taskId]) {
        throw new Error(
          `[Directive MultiAgent] ID "${taskId}" is already registered as an agent`,
        );
      }
      if (tasks[taskId]) {
        throw new Error(
          `[Directive MultiAgent] Task "${taskId}" is already registered`,
        );
      }
      // Validate timeout and maxConcurrent
      if (
        registration.timeout !== undefined &&
        (!Number.isFinite(registration.timeout) || registration.timeout <= 0)
      ) {
        throw new Error(
          `[Directive MultiAgent] Task "${taskId}" timeout must be a finite number > 0`,
        );
      }
      if (
        registration.maxConcurrent !== undefined &&
        (!Number.isFinite(registration.maxConcurrent) ||
          registration.maxConcurrent < 1 ||
          !Number.isInteger(registration.maxConcurrent))
      ) {
        throw new Error(
          `[Directive MultiAgent] Task "${taskId}" maxConcurrent must be a finite integer >= 1`,
        );
      }
      // Validate retry configuration
      if (registration.retry) {
        const { attempts, delayMs } = registration.retry;
        if (!Number.isFinite(attempts) || attempts < 1) {
          throw new Error(
            `[Directive MultiAgent] Task "${taskId}" retry attempts must be a finite number >= 1`,
          );
        }
        if (
          delayMs !== undefined &&
          (!Number.isFinite(delayMs) || delayMs < 0)
        ) {
          throw new Error(
            `[Directive MultiAgent] Task "${taskId}" retry delayMs must be a finite number >= 0`,
          );
        }
      }
      tasks[taskId] = registration;
      taskStates[taskId] = { status: "idle" };
      taskSemaphores.set(
        taskId,
        new Semaphore(registration.maxConcurrent ?? 1),
      );

      if (debug) {
        console.debug(
          `[Directive MultiAgent] Registered task "${taskId}" (${registration.label ?? taskId})`,
        );
      }
    },

    unregisterTask(taskId: string): void {
      assertNotDisposed();
      if (!tasks[taskId]) {
        throw new Error(
          `[Directive MultiAgent] Task "${taskId}" is not registered`,
        );
      }
      const state = taskStates[taskId];
      if (state?.status === "running") {
        throw new Error(
          `[Directive MultiAgent] Cannot unregister task "${taskId}" while it is running`,
        );
      }
      const sem = taskSemaphores.get(taskId);
      if (sem) {
        sem.drain();
        taskSemaphores.delete(taskId);
      }
      delete tasks[taskId];
      delete taskStates[taskId];

      if (debug) {
        console.debug(`[Directive MultiAgent] Unregistered task "${taskId}"`);
      }
    },

    getTaskIds(): string[] {
      return Object.keys(tasks);
    },

    getTaskRegistry(): Record<
      string,
      { label?: string; description?: string }
    > {
      const result: Record<string, { label?: string; description?: string }> =
        Object.create(null);
      for (const [id, reg] of Object.entries(tasks)) {
        result[id] = { label: reg.label, description: reg.description };
      }

      return result;
    },

    getTaskState(taskId: string) {
      const s = taskStates[taskId];

      return s ? Object.freeze(structuredClone(s)) : undefined;
    },

    getAllTaskStates() {
      const result: Record<
        string,
        {
          status: string;
          lastOutput?: unknown;
          lastError?: string;
          startTime?: number;
          durationMs?: number;
        }
      > = Object.create(null);
      for (const [id, s] of Object.entries(taskStates)) {
        result[id] = Object.freeze(structuredClone(s));
      }

      return result;
    },

    getNodeIds(): string[] {
      return [...Object.keys(agents), ...Object.keys(tasks)];
    },

    reset() {
      assertNotDisposed();
      for (const agentId of Object.keys(agents)) {
        const maxConcurrent = agents[agentId]?.maxConcurrent ?? 1;
        agentStates[agentId] = {
          status: "idle",
          runCount: 0,
          totalTokens: 0,
        };
        const existing = semaphores.get(agentId);
        if (existing) {
          existing.drain();
        }
        semaphores.set(agentId, new Semaphore(maxConcurrent));

        // Reset per-agent facts
        const agentFacts = getAgentFacts(agentId);
        system.batch(() => {
          setAgentState(agentFacts, {
            status: "idle",
            currentAgent: agents[agentId]!.agent.name,
            input: null,
            output: null,
            error: null,
            tokenUsage: 0,
            turnCount: 0,
            startedAt: null,
            completedAt: null,
          });
          setApprovalState(agentFacts, {
            pending: [],
            approved: [],
            rejected: [],
          });
          setConversation(agentFacts, []);
          setToolCalls(agentFacts, []);
          setBreakpointState(agentFacts, createInitialBreakpointState());
        });
      }
      // Reset task states
      for (const taskId of Object.keys(tasks)) {
        taskStates[taskId] = { status: "idle" };
        const tsem = taskSemaphores.get(taskId);
        if (tsem) {
          tsem.drain();
        }
        taskSemaphores.set(
          taskId,
          new Semaphore(tasks[taskId]!.maxConcurrent ?? 1),
        );
      }

      breakpointModifications.clear();
      breakpointCancelReasons.clear();
      approvalRequestIndex.clear();
      pendingHandoffs.length = 0;
      handoffResults.length = 0;
      handoffCounter = 0;
      globalTokenCount = 0;
      globalStatus = "idle";
      pendingRuns = 0;
      notifyIdleWaiters();

      // Reset coordinator facts
      const coordFacts = getAgentFacts("__coord");
      system.batch(() => {
        setBridgeFact(coordFacts, "__globalTokens", 0);
        setBridgeFact(coordFacts, "__status", "idle");
        setBridgeFact(coordFacts, "__handoffs", []);
        setBridgeFact(coordFacts, "__handoffResults", []);
        setBridgeFact(coordFacts, "__budgetWarningFired", false);
        if (scratchpadConfig) {
          setBridgeFact(coordFacts, SCRATCHPAD_KEY, {
            ...scratchpadConfig.init,
          });
        }
      });

      // Reset health monitor to clear stale metrics
      if (healthMonitorInstance) {
        healthMonitorInstance.reset();
      }

      lastReflectionHistory = null;

      // Reset derived values and recompute
      for (const key of Object.keys(derivedValues)) {
        delete derivedValues[key];
      }
      recomputeDerivations();
    },

    // ---- Checkpoint Methods ----

    async checkpoint(opts?: { label?: string }): Promise<Checkpoint> {
      assertNotDisposed();

      // Ensure no agents or tasks are running
      for (const [id, s] of Object.entries(agentStates)) {
        if (s.status === "running") {
          throw new Error(
            `[Directive MultiAgent] Cannot checkpoint while agent "${id}" is running`,
          );
        }
      }
      for (const [id, s] of Object.entries(taskStates)) {
        if (s.status === "running") {
          throw new Error(
            `[Directive MultiAgent] Cannot checkpoint while task "${id}" is running`,
          );
        }
      }
      if (!(system as any).debug?.export) {
        throw new Error(
          "[Directive MultiAgent] Checkpointing requires debug mode. Set `debug: true` in orchestrator options.",
        );
      }

      const checkpoint: Checkpoint = {
        version: 1,
        id: createCheckpointId(),
        createdAt: new Date().toISOString(),
        label: opts?.label,
        systemExport: (system as any).debug.export(),
        timelineExport: timeline?.export() ?? null,
        localState: {
          type: "multi",
          globalTokenCount,
          globalStatus,
          agentStates: Object.fromEntries(
            Object.entries(agentStates).map(([k, v]) => [
              k,
              structuredClone(v),
            ]),
          ),
          handoffCounter,
          pendingHandoffs: [...pendingHandoffs],
          handoffResults: [...handoffResults],
          roundRobinCounters: roundRobinCounters
            ? Object.fromEntries(roundRobinCounters)
            : null,
          taskStates: Object.fromEntries(
            Object.entries(taskStates).map(([k, v]) => [
              k,
              {
                lastOutput:
                  v.lastOutput != null ? String(v.lastOutput) : undefined,
                lastError: v.lastError,
              },
            ]),
          ),
        } satisfies MultiAgentCheckpointLocalState,
        memoryExport: sharedMemory
          ? ((sharedMemory as any).export?.() ?? null)
          : null,
        orchestratorType: "multi",
      };

      if (checkpointStore) {
        await checkpointStore.save(checkpoint);
      }

      return checkpoint;
    },

    restore(cp: Checkpoint, opts?: { restoreTimeline?: boolean }): void {
      assertNotDisposed();

      if (!validateCheckpoint(cp)) {
        throw new Error("[Directive MultiAgent] Invalid checkpoint data");
      }
      if (cp.orchestratorType !== "multi") {
        throw new Error(
          `[Directive MultiAgent] Expected multi-agent checkpoint, got "${cp.orchestratorType}"`,
        );
      }

      // Restore system state
      if (!(system as any).debug?.import) {
        throw new Error(
          "[Directive MultiAgent] Restoring a checkpoint requires debug mode. Set `debug: true` in orchestrator options.",
        );
      }
      (system as any).debug.import(cp.systemExport);

      // Restore timeline
      if (opts?.restoreTimeline !== false && cp.timelineExport && timeline) {
        timeline.import(cp.timelineExport);
      }

      // Restore memory
      if (cp.memoryExport && sharedMemory && (sharedMemory as any).import) {
        (sharedMemory as any).import(cp.memoryExport);
      }

      // Restore closure-local state
      const local = cp.localState as MultiAgentCheckpointLocalState;
      globalTokenCount = local.globalTokenCount;
      globalStatus = local.globalStatus;
      handoffCounter = local.handoffCounter;
      pendingHandoffs.length = 0;
      pendingHandoffs.push(...(local.pendingHandoffs as HandoffRequest[]));
      handoffResults.length = 0;
      handoffResults.push(...(local.handoffResults as HandoffResult[]));

      // Restore agent states
      for (const [id, s] of Object.entries(local.agentStates)) {
        if (agentStates[id]) {
          agentStates[id] = { ...s };
        }
      }

      // Restore round robin counters
      if (local.roundRobinCounters && roundRobinCounters) {
        roundRobinCounters.clear();
        for (const [k, v] of Object.entries(local.roundRobinCounters)) {
          roundRobinCounters.set(k, v);
        }
      }

      // Rebuild semaphores from registrations
      for (const [agentId, reg] of Object.entries(agents)) {
        const existing = semaphores.get(agentId);
        if (existing) {
          existing.drain();
        }
        semaphores.set(agentId, new Semaphore(reg.maxConcurrent ?? 1));
      }

      // Restore task states
      if (local.taskStates) {
        for (const [id, s] of Object.entries(local.taskStates)) {
          if (!tasks[id]) {
            throw new Error(
              `[Directive MultiAgent] Checkpoint references task "${id}" which is not registered. Task run functions cannot be serialized — re-provide the task registration.`,
            );
          }
          taskStates[id] = {
            status: "idle",
            lastOutput: s.lastOutput,
            lastError: s.lastError,
          };
        }
        // Rebuild task semaphores
        for (const [taskId, reg] of Object.entries(tasks)) {
          const existing = taskSemaphores.get(taskId);
          if (existing) {
            existing.drain();
          }
          taskSemaphores.set(taskId, new Semaphore(reg.maxConcurrent ?? 1));
        }
      }

      // Recompute derivations from restored state
      recomputeDerivations();
    },

    // ---- Parallel Streaming ----

    runParallelStream<T>(
      agentIds: string[],
      inputs: string | string[],
      merge: (results: RunResult<unknown>[]) => T | Promise<T>,
      opts?: { minSuccess?: number; timeout?: number; signal?: AbortSignal },
    ): MultiplexedStreamResult<T> {
      assertNotDisposed();

      const inputArray = Array.isArray(inputs)
        ? inputs
        : agentIds.map(() => inputs);

      if (inputArray.length !== agentIds.length) {
        throw new Error(
          `[Directive MultiAgent] Input count (${inputArray.length}) must match agent count (${agentIds.length})`,
        );
      }

      const controller = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      if (opts?.timeout) {
        timeoutId = setTimeout(() => controller.abort(), opts.timeout);
      }
      // External signal handling is done after mergeTaggedStreams setup

      // Launch per-agent streams
      const perAgentStreams = agentIds.map((agentId, i) => {
        const streamResult = runAgentStreamImpl(agentId, inputArray[i]!, {
          signal: controller.signal,
        });

        return {
          agentId,
          streamResult,
        };
      });

      // Merge tagged streams
      const taggedSources = perAgentStreams.map(
        ({ agentId, streamResult }) => ({
          agentId,
          stream: streamResult.stream,
        }),
      );

      const { stream: mergedStream, getDroppedCount } =
        mergeTaggedStreams(taggedSources);

      // Clean up external abort listener when done
      let externalOnAbort: (() => void) | undefined;
      if (opts?.signal) {
        externalOnAbort = () => controller.abort();
        opts.signal.addEventListener("abort", externalOnAbort, { once: true });
      }

      // Collect all results
      const resultsPromise = Promise.allSettled(
        perAgentStreams.map(({ streamResult }) => streamResult.result),
      ).then((settled) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        // Clean up external signal listener
        if (externalOnAbort && opts?.signal) {
          opts.signal.removeEventListener("abort", externalOnAbort);
        }

        const successes: RunResult<unknown>[] = [];
        for (const s of settled) {
          if (s.status === "fulfilled") {
            successes.push(s.value);
          }
        }

        if (
          opts?.minSuccess !== undefined &&
          successes.length < opts.minSuccess
        ) {
          throw new Error(
            `[Directive MultiAgent] runParallelStream: Only ${successes.length}/${agentIds.length} agents succeeded ` +
              `(minimum required: ${opts.minSuccess})`,
          );
        }

        return successes;
      });

      const mergePromise = resultsPromise.then((results) => merge(results));

      // Prevent unhandled rejections
      resultsPromise.catch(() => {});
      mergePromise.catch(() => {});

      return {
        stream: mergedStream,
        results: resultsPromise,
        merge: mergePromise,
        getDroppedCount,
        abort: () => {
          controller.abort();
          if (externalOnAbort && opts?.signal) {
            opts.signal.removeEventListener("abort", externalOnAbort);
          }
          for (const { streamResult } of perAgentStreams) {
            streamResult.abort();
          }
        },
      };
    },

    // ---- Race ----

    async runRace<T>(
      agentIds: string[],
      input: string,
      raceOpts?: {
        extract?: (result: RunResult<unknown>) => T;
        timeout?: number;
        minSuccess?: number;
        signal?: AbortSignal;
      },
    ): Promise<RaceResult<T>> {
      assertNotDisposed();

      const pattern: RacePattern<T> = {
        type: "race",
        handlers: agentIds,
        extract: raceOpts?.extract,
        timeout: raceOpts?.timeout,
        minSuccess: raceOpts?.minSuccess,
        signal: raceOpts?.signal,
      };

      return runRacePattern<T>(pattern, input, "__imperative_race");
    },

    // ---- Reflect (imperative) ----

    async runReflect<T>(
      producerId: string,
      evaluatorId: string,
      input: string,
      reflectOpts?: {
        maxIterations?: number;
        parseEvaluation?: (output: unknown) => ReflectionEvaluation;
        buildRetryInput?: (
          input: string,
          feedback: string,
          iteration: number,
        ) => string;
        extract?: (output: unknown) => T;
        onExhausted?: "accept-last" | "accept-best" | "throw";
        onIteration?: (record: ReflectIterationRecord) => void;
        signal?: AbortSignal;
        timeout?: number;
        threshold?: number | ((iteration: number) => number);
      },
    ): Promise<{
      result: T;
      iterations: number;
      history: ReflectIterationRecord[];
      exhausted: boolean;
    }> {
      assertNotDisposed();

      const pattern: ReflectPattern<T> = {
        type: "reflect",
        handler: producerId,
        evaluator: evaluatorId,
        maxIterations: reflectOpts?.maxIterations,
        parseEvaluation: reflectOpts?.parseEvaluation,
        buildRetryInput: reflectOpts?.buildRetryInput,
        extract: reflectOpts?.extract,
        onExhausted: reflectOpts?.onExhausted,
        onIteration: reflectOpts?.onIteration,
        signal: reflectOpts?.signal,
        timeout: reflectOpts?.timeout,
        threshold: reflectOpts?.threshold,
      };

      const result = await runReflectPattern<T>(
        pattern,
        input,
        "__imperative_reflect",
      );
      const history = lastReflectionHistory ? [...lastReflectionHistory] : [];
      const maxIterations = reflectOpts?.maxIterations ?? 2;
      const exhausted =
        history.length > 0 &&
        !history[history.length - 1]!.passed &&
        history.length >= maxIterations;

      return { result, iterations: history.length, history, exhausted };
    },

    // ---- Debate (imperative) ----

    async runDebate<T>(
      agentIds: string[],
      evaluatorId: string,
      input: string,
      debateOpts?: {
        maxRounds?: number;
        extract?: (output: unknown) => T;
        parseJudgement?: (output: unknown) => {
          winnerId: string;
          feedback?: string;
          score?: number;
        };
        signal?: AbortSignal;
        timeout?: number;
      },
    ): Promise<DebateResult<T>> {
      assertNotDisposed();

      return runDebateInternal<T>(
        {
          type: "debate",
          handlers: agentIds,
          evaluator: evaluatorId,
          maxRounds: debateOpts?.maxRounds,
          extract: debateOpts?.extract,
          parseJudgement: debateOpts?.parseJudgement,
          signal: debateOpts?.signal,
          timeout: debateOpts?.timeout,
        },
        input,
        "__imperative_debate",
      );
    },

    // ---- Goal Pattern ----

    async runGoal<T>(
      nodes: Record<string, GoalNode>,
      initialInput: string | Record<string, unknown>,
      when: (facts: Record<string, unknown>) => boolean,
      goalOpts?: {
        satisfaction?: (facts: Record<string, unknown>) => number;
        maxSteps?: number;
        extract?: (facts: Record<string, unknown>) => T;
        timeout?: number;
        signal?: AbortSignal;
        selectionStrategy?: AgentSelectionStrategy;
        relaxation?: RelaxationTier[];
        onStep?: GoalPattern["onStep"];
        onStall?: GoalPattern["onStall"];
        checkpoint?: PatternCheckpointConfig;
      },
    ): Promise<GoalResult<T>> {
      assertNotDisposed();

      return runGoalInternal<T>(
        {
          type: "goal",
          nodes,
          when,
          satisfaction: goalOpts?.satisfaction,
          maxSteps: goalOpts?.maxSteps,
          extract: goalOpts?.extract,
          timeout: goalOpts?.timeout,
          signal: goalOpts?.signal,
          selectionStrategy: goalOpts?.selectionStrategy,
          relaxation: goalOpts?.relaxation,
          onStep: goalOpts?.onStep,
          onStall: goalOpts?.onStall,
          checkpoint: goalOpts?.checkpoint,
        },
        initialInput,
        "__imperative_goal",
      );
    },

    async resumeGoal<T>(
      checkpointState: GoalCheckpointState,
      pattern: GoalPattern<T>,
    ): Promise<GoalResult<T>> {
      assertNotDisposed();

      if (
        !checkpointState ||
        checkpointState.version !== 1 ||
        (checkpointState.type !== "goal" &&
          (checkpointState as unknown as Record<string, unknown>).type !==
            "converge")
      ) {
        throw new Error("[Directive MultiAgent] Invalid goal checkpoint state");
      }
      // Migration shim: accept legacy "converge" checkpoint states (shallow copy to avoid mutating input)
      const normalizedState =
        (checkpointState as unknown as Record<string, unknown>).type ===
        "converge"
          ? { ...checkpointState, type: "goal" as const }
          : checkpointState;

      return runGoalInternal<T>(
        pattern,
        {}, // initialInput ignored when resumeFrom is provided
        normalizedState.patternId,
        normalizedState,
      );
    },

    async resumeSequential<T>(
      checkpointState: SequentialCheckpointState,
      pattern: SequentialPattern<T>,
    ): Promise<T> {
      assertNotDisposed();

      if (
        !checkpointState ||
        checkpointState.version !== 1 ||
        checkpointState.type !== "sequential"
      ) {
        throw new Error(
          "[Directive MultiAgent] Invalid sequential checkpoint state",
        );
      }

      return runSequentialPattern<T>(
        pattern,
        checkpointState.currentInput,
        checkpointState.patternId,
        checkpointState,
      );
    },

    async resumeSupervisor<T>(
      checkpointState: SupervisorCheckpointState,
      pattern: SupervisorPattern<T>,
      options?: { input?: string },
    ): Promise<T> {
      assertNotDisposed();

      if (
        !checkpointState ||
        checkpointState.version !== 1 ||
        checkpointState.type !== "supervisor"
      ) {
        throw new Error(
          "[Directive MultiAgent] Invalid supervisor checkpoint state",
        );
      }

      const input = options?.input ?? checkpointState.currentInput;

      return runSupervisorPattern<T>(
        pattern,
        input,
        checkpointState.patternId,
        checkpointState,
      );
    },

    async resumeReflect<T>(
      checkpointState: ReflectCheckpointState,
      pattern: ReflectPattern<T>,
      options?: { input?: string },
    ): Promise<T> {
      assertNotDisposed();

      if (
        !checkpointState ||
        checkpointState.version !== 1 ||
        checkpointState.type !== "reflect"
      ) {
        throw new Error(
          "[Directive MultiAgent] Invalid reflect checkpoint state",
        );
      }

      const input = options?.input ?? checkpointState.effectiveInput;

      return runReflectPattern<T>(
        pattern,
        input,
        checkpointState.patternId,
        checkpointState,
      );
    },

    async resumeDebate<T>(
      checkpointState: DebateCheckpointState,
      pattern: DebatePattern<T>,
    ): Promise<DebateResult<T>> {
      assertNotDisposed();

      if (
        !checkpointState ||
        checkpointState.version !== 1 ||
        checkpointState.type !== "debate"
      ) {
        throw new Error(
          "[Directive MultiAgent] Invalid debate checkpoint state",
        );
      }

      return runDebateInternal<T>(
        pattern,
        checkpointState.currentInput,
        checkpointState.patternId,
        checkpointState,
      );
    },

    async resumeDag<T>(
      checkpointState: DagCheckpointState,
      pattern: DagPattern<T>,
      options?: { input?: string },
    ): Promise<T> {
      assertNotDisposed();

      if (
        !checkpointState ||
        checkpointState.version !== 1 ||
        checkpointState.type !== "dag"
      ) {
        throw new Error("[Directive MultiAgent] Invalid DAG checkpoint state");
      }

      const input = options?.input ?? checkpointState.input;

      return runDagPattern<T>(
        pattern,
        input,
        checkpointState.patternId,
        checkpointState,
      );
    },

    async replay<T>(
      checkpointId: string,
      pattern: ExecutionPattern,
      options?: { input?: string },
    ): Promise<T> {
      assertNotDisposed();

      if (!checkpointStore) {
        throw new Error(
          "[Directive MultiAgent] No checkpoint store configured",
        );
      }

      const checkpoint = await checkpointStore.load(checkpointId);
      if (!checkpoint) {
        throw new Error(
          `[Directive MultiAgent] Checkpoint not found: ${checkpointId}`,
        );
      }

      // Validate parsed state — prototype pollution defense + structure check
      let state: PatternCheckpointState;
      try {
        const parsed = JSON.parse(checkpoint.systemExport);
        if (!parsed || typeof parsed !== "object") {
          throw new Error("Parsed checkpoint state is not an object");
        }

        const BLOCKED = new Set(["__proto__", "constructor", "prototype"]);
        for (const key of Object.keys(parsed)) {
          if (BLOCKED.has(key)) {
            throw new Error(`Checkpoint state contains blocked key: ${key}`);
          }
        }

        const validTypes = new Set([
          "sequential",
          "supervisor",
          "reflect",
          "debate",
          "dag",
          "goal",
          "converge",
        ]);
        if (!validTypes.has(parsed.type)) {
          throw new Error(`Unknown checkpoint pattern type: ${parsed.type}`);
        }
        if (parsed.version !== 1) {
          throw new Error(`Unsupported checkpoint version: ${parsed.version}`);
        }

        state = parsed as PatternCheckpointState;
      } catch (err) {
        throw new Error(
          `[Directive MultiAgent] Invalid checkpoint state: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const step = getPatternStep(state);
      const replayInput =
        options?.input ??
        ("currentInput" in state
          ? (state as { currentInput: string }).currentInput
          : "");

      // Record timeline event
      if (timeline) {
        timeline.record({
          type: "checkpoint_restore",
          timestamp: Date.now(),
          snapshotId: null,
          checkpointId,
          patternType: state.type,
          step,
        });
      }

      switch (state.type) {
        case "sequential":
          return runSequentialPattern<T>(
            pattern as SequentialPattern<T>,
            replayInput,
            state.patternId,
            state,
          );
        case "supervisor":
          return runSupervisorPattern<T>(
            pattern as SupervisorPattern<T>,
            replayInput,
            state.patternId,
            state,
          );
        case "reflect":
          return runReflectPattern<T>(
            pattern as ReflectPattern<T>,
            replayInput,
            state.patternId,
            state,
          );
        case "debate":
          return runDebateInternal(
            pattern as DebatePattern<T>,
            replayInput,
            state.patternId,
            state,
          ) as Promise<T>;
        case "dag":
          return runDagPattern<T>(
            pattern as DagPattern<T>,
            replayInput,
            state.patternId,
            state,
          );
        case "goal":
          return runGoalInternal(
            pattern as GoalPattern<T>,
            state.facts,
            state.patternId,
            state,
          ) as Promise<T>;
      }
    },

    // ---- Breakpoint Methods ----

    resumeBreakpoint(
      id: string,
      modifications?: BreakpointModifications,
    ): void {
      assertNotDisposed();

      if (modifications) {
        breakpointModifications.set(id, modifications);
      }

      // Find which agent has this breakpoint pending and resolve it
      for (const agentId of Object.keys(agents)) {
        const agentFacts = getAgentFacts(agentId);
        const bpState = getBreakpointState(agentFacts);
        if (bpState.pending.some((r: BreakpointRequest) => r.id === id)) {
          system.batch(() => {
            const currentBp = getBreakpointState(agentFacts);
            const resolved = [...currentBp.resolved, id];
            setBreakpointState(agentFacts, {
              ...currentBp,
              pending: currentBp.pending.filter(
                (r: BreakpointRequest) => r.id !== id,
              ),
              resolved:
                resolved.length > MAX_BREAKPOINT_HISTORY
                  ? resolved.slice(-MAX_BREAKPOINT_HISTORY)
                  : resolved,
            });
          });

          return;
        }
      }

      if (debug) {
        console.debug(
          `[Directive MultiAgent] resumeBreakpoint() ignored: no pending breakpoint "${id}"`,
        );
      }
    },

    cancelBreakpoint(id: string, reason?: string): void {
      assertNotDisposed();

      if (reason) {
        breakpointCancelReasons.set(id, reason);
      }

      for (const agentId of Object.keys(agents)) {
        const agentFacts = getAgentFacts(agentId);
        const bpState = getBreakpointState(agentFacts);
        if (bpState.pending.some((r: BreakpointRequest) => r.id === id)) {
          system.batch(() => {
            const currentBp = getBreakpointState(agentFacts);
            const cancelled = [...currentBp.cancelled, id];
            setBreakpointState(agentFacts, {
              ...currentBp,
              pending: currentBp.pending.filter(
                (r: BreakpointRequest) => r.id !== id,
              ),
              cancelled:
                cancelled.length > MAX_BREAKPOINT_HISTORY
                  ? cancelled.slice(-MAX_BREAKPOINT_HISTORY)
                  : cancelled,
            });
          });

          return;
        }
      }

      if (debug) {
        console.debug(
          `[Directive MultiAgent] cancelBreakpoint() ignored: no pending breakpoint "${id}"`,
        );
      }
    },

    getPendingBreakpoints(): BreakpointRequest[] {
      const pending: BreakpointRequest[] = [];
      for (const agentId of Object.keys(agents)) {
        const agentFacts = getAgentFacts(agentId);
        const bpState = getBreakpointState(agentFacts);
        pending.push(...bpState.pending);
      }

      return pending;
    },

    getLastReflectionHistory(): ReflectIterationRecord[] | null {
      return lastReflectionHistory ? [...lastReflectionHistory] : null;
    },

    dispose() {
      if (disposed) {
        return;
      }
      // Reset before marking as disposed (reset() calls assertNotDisposed())
      orchestrator.reset();
      // Clear callback references to allow garbage collection
      scratchpadChangeCallbacks.clear();
      scratchpadKeyCallbacks.clear();
      derivedChangeCallbacks.clear();
      idleWaiters.clear();
      disposed = true;
      system.destroy();
    },
  };

  // Compute initial derivation values so they're available immediately
  recomputeDerivations();

  return orchestrator;
}

// ============================================================================
// Pattern Helpers
// ============================================================================

/**
 * Create a parallel pattern configuration.
 *
 * @param handlers - Handler IDs (agents or tasks) to run concurrently
 * @param merge - Combine all handler results into a single output. Receives all successful RunResults (array may be shorter than handlers.length when minSuccess is set).
 * @param options - Optional `minSuccess` and `timeout` overrides
 *
 * @example
 * ```typescript
 * const researchPattern = parallel(
 *   ['researcher', 'researcher', 'researcher'],
 *   (results) => results.map(r => r.output).join('\n')
 * );
 * ```
 */
export function parallel<T>(
  handlers: string[],
  merge: (results: RunResult<unknown>[]) => T | Promise<T>,
  options?: { minSuccess?: number; timeout?: number },
): ParallelPattern<T> {
  return {
    type: "parallel",
    handlers,
    merge,
    ...options,
  };
}

/**
 * Create a sequential pattern configuration.
 *
 * @param handlers - Handler IDs (agents or tasks) to run in order (output of each feeds into the next)
 * @param options - Optional `transform`, `extract`, `continueOnError`
 *
 * @example
 * ```typescript
 * const writeReviewPattern = sequential(
 *   ['writer', 'reviewer'],
 *   { transform: (output) => `Review this: ${output}` }
 * );
 * ```
 */
export function sequential<T>(
  handlers: string[],
  options?: {
    transform?: (output: unknown, handlerId: string, index: number) => string;
    extract?: (output: unknown) => T;
    continueOnError?: boolean;
  },
): SequentialPattern<T> {
  return {
    type: "sequential",
    handlers,
    ...options,
  };
}

/**
 * Create a supervisor pattern configuration.
 *
 * @param supervisorAgent - Agent ID that coordinates the workers
 * @param workers - Agent IDs for the worker pool
 * @param options - Optional `maxRounds` and `extract`
 *
 * @example
 * ```typescript
 * const managedPattern = supervisor(
 *   'manager',
 *   ['worker1', 'worker2'],
 *   { maxRounds: 3 }
 * );
 * ```
 */
export function supervisor<T>(
  supervisorAgent: string,
  workers: string[],
  options?: {
    maxRounds?: number;
    extract?: (
      supervisorOutput: unknown,
      workerResults: RunResult<unknown>[],
    ) => T;
  },
): SupervisorPattern<T> {
  return {
    type: "supervisor",
    supervisor: supervisorAgent,
    workers,
    ...options,
  };
}

/**
 * Create a DAG execution pattern.
 *
 * @param nodes - Node definitions keyed by ID, each with `handler` and optional `deps`
 * @param merge - Combine DAG outputs into a single result (defaults to `context.outputs`)
 * @param options - Optional `timeout`, `maxConcurrent`, `onNodeError`
 *
 * @example
 * ```typescript
 * const researchPipeline = dag(
 *   {
 *     fetch: { handler: 'fetcher' },
 *     analyze: { handler: 'analyzer', deps: ['fetch'] },
 *     summarize: { handler: 'summarizer', deps: ['analyze'] },
 *   },
 *   (context) => context.outputs.summarize,
 * );
 * ```
 */
export function dag<T = Record<string, unknown>>(
  nodes: Record<string, DagNode>,
  merge?: (context: DagExecutionContext) => T | Promise<T>,
  options?: {
    /** Overall timeout in ms for the entire DAG. */
    timeout?: number;
    /** Max nodes running concurrently. Default: Infinity */
    maxConcurrent?: number;
    /**
     * Error handling strategy.
     * - `"fail"` — abort entire DAG on first node error (default)
     * - `"skip-downstream"` — mark downstream nodes as skipped, other branches continue
     * - `"continue"` — ignore errors, other branches continue
     */
    onNodeError?: "fail" | "skip-downstream" | "continue";
  },
): DagPattern<T> {
  return {
    type: "dag",
    nodes,
    merge: merge ?? ((context: DagExecutionContext) => context.outputs as T),
    ...options,
  };
}

/**
 * Create a reflect pattern configuration.
 *
 * @param handler - Producer handler ID (agent or task) that generates output
 * @param evaluator - Evaluator handler ID that judges quality
 * @param options - Optional iteration, parsing, signal, and threshold config
 *
 * @example
 * ```typescript
 * const reviewPattern = reflect('writer', 'reviewer', { maxIterations: 2 });
 * ```
 */
export function reflect<T>(
  handler: string,
  evaluator: string,
  options?: {
    maxIterations?: number;
    parseEvaluation?: (output: unknown) => ReflectionEvaluation;
    buildRetryInput?: (
      input: string,
      feedback: string,
      iteration: number,
    ) => string;
    extract?: (output: unknown) => T;
    onExhausted?: "accept-last" | "accept-best" | "throw";
    onIteration?: (record: ReflectIterationRecord) => void;
    signal?: AbortSignal;
    timeout?: number;
    threshold?: number | ((iteration: number) => number);
  },
): ReflectPattern<T> {
  return {
    type: "reflect",
    handler,
    evaluator,
    ...options,
  };
}

/**
 * Create a race pattern configuration.
 *
 * @param handlers - Handler IDs (agents or tasks) to race concurrently
 * @param options - Optional `extract`, `timeout`, `minSuccess`, `signal`
 *
 * @example
 * ```typescript
 * const fastest = race(['fast-model', 'smart-model'], { timeout: 5000 });
 * ```
 */
export function race<T>(
  handlers: string[],
  options?: {
    extract?: (result: RunResult<unknown>) => T;
    timeout?: number;
    minSuccess?: number;
    signal?: AbortSignal;
  },
): RacePattern<T> {
  return {
    type: "race",
    handlers,
    ...options,
  };
}

// ============================================================================
// Goal Pattern Factory & Selection Strategies
// ============================================================================

/**
 * Create a goal execution pattern.
 *
 * Declare what each agent produces and requires. The runtime automatically
 * infers the execution graph from dependency analysis and drives agents
 * to goal achievement.
 *
 * @example
 * ```typescript
 * const pipeline = goal(
 *   {
 *     researcher: {
 *       handler: "researcher",
 *       produces: ["research.findings"],
 *       requires: ["research.topic"],
 *       extractOutput: (r) => ({ "research.findings": r.output }),
 *     },
 *     writer: {
 *       handler: "writer",
 *       produces: ["article.draft"],
 *       requires: ["research.findings"],
 *       extractOutput: (r) => ({ "article.draft": r.output }),
 *     },
 *   },
 *   (facts) => facts["article.draft"] != null,
 *   { maxSteps: 10, extract: (facts) => facts["article.draft"] },
 * );
 * ```
 */
export function goal<T = Record<string, unknown>>(
  nodes: Record<string, GoalNode>,
  when: (facts: Record<string, unknown>) => boolean,
  options?: {
    satisfaction?: (facts: Record<string, unknown>) => number;
    maxSteps?: number;
    extract?: (facts: Record<string, unknown>) => T;
    timeout?: number;
    signal?: AbortSignal;
    selectionStrategy?: AgentSelectionStrategy;
    relaxation?: RelaxationTier[];
    onStep?: (
      step: number,
      facts: Record<string, unknown>,
      readyNodes: string[],
    ) => void;
    onStall?: (step: number, metrics: GoalMetrics) => void;
    checkpoint?: PatternCheckpointConfig;
  },
): GoalPattern<T> {
  return {
    type: "goal",
    nodes,
    when,
    ...options,
  };
}

/**
 * Selection strategy: run all ready agents (default).
 */
export function allReadyStrategy(): AgentSelectionStrategy {
  return {
    select: (readyAgents) => readyAgents,
  };
}

/**
 * Selection strategy: pick agents with the highest historical impact.
 *
 * Sorts by average satisfaction delta (descending) and picks the top N.
 */
export function highestImpactStrategy(opts?: {
  topN?: number;
}): AgentSelectionStrategy {
  const topN = opts?.topN ?? 3;

  return {
    select: (readyAgents, metrics) => {
      const sorted = [...readyAgents].sort((a, b) => {
        const aAvg = metrics[a]?.avgSatisfactionDelta ?? 0;
        const bAvg = metrics[b]?.avgSatisfactionDelta ?? 0;

        return bAvg - aAvg;
      });

      return sorted.slice(0, topN);
    },
  };
}

/**
 * Selection strategy: prefer agents that consume fewer tokens per satisfaction delta.
 */
export function costEfficientStrategy(): AgentSelectionStrategy {
  return {
    select: (readyAgents, metrics) => {
      const sorted = [...readyAgents].sort((a, b) => {
        const aM = metrics[a];
        const bM = metrics[b];

        // Agents without metrics go first (need data)
        if (!aM || aM.runs === 0) {
          return -1;
        }
        if (!bM || bM.runs === 0) {
          return 1;
        }

        // Cost per delta: lower is better
        const aCost =
          aM.avgSatisfactionDelta > 0
            ? aM.tokens / aM.runs / aM.avgSatisfactionDelta
            : Number.POSITIVE_INFINITY;
        const bCost =
          bM.avgSatisfactionDelta > 0
            ? bM.tokens / bM.runs / bM.avgSatisfactionDelta
            : Number.POSITIVE_INFINITY;

        return aCost - bCost;
      });

      return sorted;
    },
  };
}

/**
 * Validate that a DAG has no cycles using Kahn's algorithm.
 * Throws if a cycle is detected.
 */
function validateDagAcyclic(
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

// ============================================================================
// Agent Selection Helpers
// ============================================================================

/**
 * Create an agent selection constraint.
 *
 * @example
 * ```typescript
 * const constraints = {
 *   routeToExpert: selectAgent(
 *     (facts) => facts.complexity > 0.8,
 *     'expert',
 *     (facts) => facts.query
 *   ),
 * };
 * ```
 */
export function selectAgent(
  when: (facts: Record<string, unknown>) => boolean | Promise<boolean>,
  agent: string | ((facts: Record<string, unknown>) => string),
  input: string | ((facts: Record<string, unknown>) => string),
  priority?: number,
): OrchestratorConstraint<Record<string, unknown>> {
  return {
    when: when as (
      facts: Record<string, unknown> & OrchestratorState,
    ) => boolean | Promise<boolean>,
    require: (facts: Record<string, unknown> & OrchestratorState) => {
      const selectedAgent = typeof agent === "function" ? agent(facts) : agent;
      const selectedInput = typeof input === "function" ? input(facts) : input;

      return {
        type: "RUN_AGENT",
        agent: selectedAgent,
        input: selectedInput,
      } as RunAgentRequirement;
    },
    priority,
  };
}

/**
 * Create a RUN_AGENT requirement.
 *
 * @example
 * ```typescript
 * constraints: {
 *   needsResearch: {
 *     when: (facts) => facts.hasUnknowns,
 *     require: (facts) => runAgentRequirement('researcher', facts.query as string),
 *   },
 * }
 * ```
 */
export function runAgentRequirement(
  agent: string,
  input: string,
  context?: Record<string, unknown>,
): RunAgentRequirement {
  return {
    type: "RUN_AGENT",
    agent,
    input,
    context,
  };
}

// ============================================================================
// Result Merging Utilities
// ============================================================================

/**
 * Merge results by concatenating outputs.
 */
export function concatResults(
  results: RunResult<unknown>[],
  separator = "\n\n",
): string {
  return results
    .map((r) =>
      typeof r.output === "string" ? r.output : safeStringify(r.output),
    )
    .join(separator);
}

/**
 * Merge results by picking the best one based on a scoring function.
 */
export function pickBestResult<T>(
  results: RunResult<T>[],
  score: (result: RunResult<T>) => number,
): RunResult<T> {
  if (results.length === 0) {
    throw new Error("[Directive MultiAgent] No results to pick from");
  }

  return results.reduce((best, current) =>
    score(current) > score(best) ? current : best,
  );
}

/**
 * Merge results into an array of outputs.
 */
export function collectOutputs<T>(results: RunResult<T>[]): T[] {
  return results.map((r) => r.output);
}

/**
 * Aggregate token counts from results.
 */
export function aggregateTokens(results: RunResult<unknown>[]): number {
  return results.reduce((sum, r) => sum + r.totalTokens, 0);
}

// ============================================================================
// Pattern Composition
// ============================================================================

/**
 * Compose multiple patterns into a pipeline where each pattern's
 * output feeds as input to the next. Returns an async function
 * that runs the pipeline on a given orchestrator.
 *
 * Between patterns, output is converted to a string input:
 * - `string` output passes through directly
 * - Objects are JSON-stringified
 * - Optionally provide a `transform` to customize between steps
 *
 * @example
 * ```typescript
 * const workflow = composePatterns(
 *   parallel(['researcher', 'researcher'], concatResults),
 *   sequential(['writer', 'reviewer']),
 * );
 *
 * const result = await workflow(orchestrator, 'Research topic X');
 * ```
 */
export function composePatterns(
  ...patterns: ExecutionPattern[]
): (orchestrator: MultiAgentOrchestrator, input: string) => Promise<unknown> {
  if (patterns.length === 0) {
    throw new Error(
      "[Directive MultiAgent] composePatterns requires at least one pattern",
    );
  }

  return async (
    orchestrator: MultiAgentOrchestrator,
    input: string,
  ): Promise<unknown> => {
    let currentInput = input;
    let lastOutput: unknown = undefined;

    for (const pattern of patterns) {
      switch (pattern.type) {
        case "parallel": {
          const parallelPattern = pattern as ParallelPattern<unknown>;
          const inputsArr = parallelPattern.handlers.map(() => currentInput);
          lastOutput = await orchestrator.runParallel(
            parallelPattern.handlers,
            inputsArr,
            parallelPattern.merge,
            {
              minSuccess: parallelPattern.minSuccess,
              timeout: parallelPattern.timeout,
            },
          );
          break;
        }

        case "sequential": {
          const seqPattern = pattern as SequentialPattern<unknown>;
          const results = await orchestrator.runSequential(
            seqPattern.handlers,
            currentInput,
            { transform: seqPattern.transform },
          );

          const lastResult = results[results.length - 1];
          lastOutput = seqPattern.extract
            ? seqPattern.extract(lastResult?.output)
            : lastResult?.output;
          break;
        }

        case "supervisor": {
          const supPattern = pattern as SupervisorPattern<unknown>;
          const maxRounds = supPattern.maxRounds ?? 5;
          if (maxRounds < 1 || !Number.isFinite(maxRounds)) {
            throw new Error(
              "[Directive MultiAgent] supervisor maxRounds must be >= 1",
            );
          }
          const workerResults: RunResult<unknown>[] = [];
          let supervisorResult = await orchestrator.runAgent<unknown>(
            supPattern.supervisor,
            currentInput,
          );

          for (let round = 0; round < maxRounds; round++) {
            const raw = supervisorResult.output;
            let action: {
              action: string;
              worker?: string;
              workerInput?: string;
            };

            if (typeof raw === "string") {
              try {
                action = JSON.parse(raw);
              } catch {
                try {
                  const stripped = raw
                    .replace(/```(?:json|JSON)?\s*\n?/g, "")
                    .replace(/<[^>]+>/g, " ");
                  const extracted = extractJsonFromOutput(stripped);
                  if (
                    extracted &&
                    typeof extracted === "object" &&
                    "action" in (extracted as Record<string, unknown>)
                  ) {
                    action = extracted as typeof action;
                  } else {
                    break;
                  }
                } catch {
                  break;
                }
              }
            } else if (raw && typeof raw === "object" && "action" in raw) {
              action = raw as typeof action;
            } else {
              break;
            }

            if (action.action === "complete" || !action.worker) {
              break;
            }

            if (!supPattern.workers.includes(action.worker)) {
              break;
            }

            const workerResult = await orchestrator.runAgent(
              action.worker,
              action.workerInput ?? "",
            );
            workerResults.push(workerResult);

            supervisorResult = await orchestrator.runAgent(
              supPattern.supervisor,
              `Worker ${action.worker} completed with result: ${safeStringify(workerResult.output)}`,
            );
          }

          lastOutput = supPattern.extract
            ? supPattern.extract(supervisorResult.output, workerResults)
            : supervisorResult.output;
          break;
        }

        case "dag": {
          const dagPattern = pattern as DagPattern<unknown>;
          // DAG patterns must be run via runPattern to get full execution
          // We simulate by running agents individually following the DAG structure
          const dagContext: DagExecutionContext = {
            input: currentInput,
            outputs: Object.create(null),
            statuses: Object.create(null),
            errors: Object.create(null),
            results: Object.create(null),
          };

          // Simple sequential execution of DAG for composePatterns
          // (Full parallel DAG execution happens via runPattern/runDagPattern)
          if (
            typeof process !== "undefined" &&
            process.env?.NODE_ENV !== "production"
          ) {
            console.debug(
              "[Directive MultiAgent] composePatterns: DAG nodes executed sequentially — use runPattern() for full parallel DAG execution",
            );
          }
          const nodeIds = Object.keys(dagPattern.nodes);
          for (const nodeId of nodeIds) {
            const node = dagPattern.nodes[nodeId]!;
            dagContext.statuses[nodeId] = "running";
            try {
              let nodeInput = currentInput;
              if (node.transform) {
                nodeInput = node.transform(dagContext);
              } else if (node.deps && node.deps.length > 0) {
                const upstreamOutputs: Record<string, unknown> =
                  Object.create(null);
                for (const depId of node.deps) {
                  if (dagContext.outputs[depId] !== undefined) {
                    upstreamOutputs[depId] = dagContext.outputs[depId];
                  }
                }
                nodeInput = JSON.stringify(upstreamOutputs);
              }
              const result = await orchestrator.runAgent(
                node.handler,
                nodeInput,
              );
              dagContext.outputs[nodeId] = result.output;
              dagContext.results[nodeId] = result;
              dagContext.statuses[nodeId] = "completed";
            } catch (error) {
              dagContext.statuses[nodeId] = "error";
              dagContext.errors[nodeId] =
                error instanceof Error ? error.message : String(error);
              if (dagPattern.onNodeError === "fail") {
                throw error;
              }
            }
          }
          lastOutput = await dagPattern.merge(dagContext);
          break;
        }

        case "reflect": {
          const reflectPattern = pattern as ReflectPattern<unknown>;
          // Run producer→evaluator loop using runAgent
          const maxIter = reflectPattern.maxIterations ?? 2;
          const parseEval =
            reflectPattern.parseEvaluation ??
            ((output: unknown): ReflectionEvaluation => {
              if (typeof output === "string") {
                try {
                  return JSON.parse(output);
                } catch {
                  return { passed: false, feedback: output };
                }
              }
              if (output && typeof output === "object" && "passed" in output) {
                return output as ReflectionEvaluation;
              }

              return { passed: false, feedback: "Invalid evaluator output" };
            });
          const buildInput =
            reflectPattern.buildRetryInput ??
            ((inp: string, feedback: string) =>
              `${inp}\n\nFeedback on your previous response:\n${feedback}\n\nPlease improve your response.`);

          let effectiveInput = currentInput;
          let producerOutput: unknown;
          for (let i = 0; i < maxIter; i++) {
            const producerResult = await orchestrator.runAgent(
              reflectPattern.handler,
              effectiveInput,
            );
            producerOutput = producerResult.output;
            const producerStr =
              typeof producerOutput === "string"
                ? producerOutput
                : JSON.stringify(producerOutput);
            const evalResult = await orchestrator.runAgent(
              reflectPattern.evaluator,
              producerStr,
            );
            const evaluation = parseEval(evalResult.output);
            if (evaluation.passed) {
              break;
            }
            if (i < maxIter - 1 && evaluation.feedback) {
              effectiveInput = buildInput(currentInput, evaluation.feedback, i);
            }
          }
          lastOutput = reflectPattern.extract
            ? reflectPattern.extract(producerOutput)
            : producerOutput;
          break;
        }

        case "race": {
          const racePattern = pattern as RacePattern<unknown>;
          const raceResult = await orchestrator.runRace(
            racePattern.handlers,
            currentInput,
            { extract: racePattern.extract, timeout: racePattern.timeout },
          );
          lastOutput = raceResult.result;
          break;
        }

        case "debate": {
          const debatePattern = pattern as DebatePattern<unknown>;
          const debateResult = await orchestrator.runDebate(
            debatePattern.handlers,
            debatePattern.evaluator,
            currentInput,
            {
              maxRounds: debatePattern.maxRounds,
              extract: debatePattern.extract,
              parseJudgement: debatePattern.parseJudgement,
              signal: debatePattern.signal,
              timeout: debatePattern.timeout,
            },
          );
          lastOutput = debateResult.result;
          break;
        }

        case "goal": {
          const cp = pattern as GoalPattern<unknown>;
          const initialFacts =
            typeof currentInput === "string"
              ? { input: currentInput }
              : (() => {
                  try {
                    return JSON.parse(currentInput);
                  } catch {
                    return { input: currentInput };
                  }
                })();
          const goalResult = await orchestrator.runGoal(
            cp.nodes,
            initialFacts,
            cp.when,
            {
              satisfaction: cp.satisfaction,
              maxSteps: cp.maxSteps,
              extract: cp.extract,
              timeout: cp.timeout,
              signal: cp.signal,
              selectionStrategy: cp.selectionStrategy,
              relaxation: cp.relaxation,
              onStep: cp.onStep,
              onStall: cp.onStall,
            },
          );
          lastOutput = goalResult.result;
          break;
        }

        default:
          throw new Error(
            `[Directive MultiAgent] composePatterns: unknown pattern type "${(pattern as ExecutionPattern).type}"`,
          );
      }

      // Convert output to string for next pattern's input
      if (lastOutput !== undefined) {
        currentInput =
          typeof lastOutput === "string"
            ? lastOutput
            : safeStringify(lastOutput);
      }
    }

    return lastOutput;
  };
}

/**
 * Create a capability-based agent selector.
 *
 * Given a registry and required capabilities, returns the agent IDs
 * that match all required capabilities.
 *
 * @example
 * ```typescript
 * const agents = {
 *   researcher: { agent: researchAgent, capabilities: ['search', 'summarize'] },
 *   coder: { agent: coderAgent, capabilities: ['code', 'debug'] },
 *   writer: { agent: writerAgent, capabilities: ['write', 'edit'] },
 * };
 *
 * const matches = findAgentsByCapability(agents, ['search']);
 * // Returns ['researcher']
 *
 * const matches2 = findAgentsByCapability(agents, ['write', 'edit']);
 * // Returns ['writer']
 * ```
 */
export function findAgentsByCapability(
  registry: AgentRegistry,
  requiredCapabilities: string[],
): string[] {
  return Object.entries(registry)
    .filter(([, reg]) => {
      const caps = reg.capabilities ?? [];

      return requiredCapabilities.every((c) => caps.includes(c));
    })
    .map(([id]) => id);
}

/**
 * Create a constraint that auto-routes to an agent based on capabilities.
 *
 * @example
 * ```typescript
 * const routeByCapability = capabilityRoute(
 *   agents,
 *   (facts) => facts.requiredCapabilities as string[],
 *   (facts) => facts.query as string,
 * );
 * ```
 */
export function capabilityRoute(
  registry: AgentRegistry,
  getCapabilities: (facts: Record<string, unknown>) => string[],
  getInput: (facts: Record<string, unknown>) => string,
  options?: {
    priority?: number;
    select?: (matches: string[], registry: AgentRegistry) => string;
  },
): OrchestratorConstraint<Record<string, unknown>> {
  const { priority, select } = options ?? {};

  // Cache matches between when() and require() using a generation counter
  // to ensure require() only uses cache from the same evaluation cycle
  let cachedMatches: string[] = [];
  let cacheGeneration = 0;
  let requireGeneration = -1;

  return {
    when: (facts) => {
      const caps = getCapabilities(facts);
      cachedMatches = findAgentsByCapability(registry, caps);
      cacheGeneration++;

      return cachedMatches.length > 0;
    },
    require: (facts) => {
      // Use cached matches only if from the current when() call
      const matches =
        cacheGeneration !== requireGeneration && cachedMatches.length > 0
          ? ((requireGeneration = cacheGeneration), cachedMatches)
          : findAgentsByCapability(registry, getCapabilities(facts));

      if (matches.length === 0) {
        throw new Error(
          `[Directive MultiAgent] No agent matches capabilities: ${getCapabilities(facts).join(", ")}`,
        );
      }

      const chosen = select ? select(matches, registry) : matches[0]!;

      return {
        type: "RUN_AGENT",
        agent: chosen,
        input: getInput(facts),
      } as RunAgentRequirement;
    },
    priority,
  };
}

// ============================================================================
// Constraint-Driven Agent Spawning
// ============================================================================

let spawnOnConditionOptionsWarned = false;

/**
 * Options for spawnOnCondition.
 */
export interface SpawnOnConditionOptions {
  /** Priority for the constraint (higher = evaluated first) */
  priority?: number;
  /** Additional context passed to the agent */
  context?: Record<string, unknown>;
}

/**
 * Create a constraint that auto-runs an agent when a condition is met.
 *
 * The orchestrator's built-in RUN_AGENT resolver handles execution —
 * you only need to add this to your `constraints` config.
 *
 * @example
 * ```typescript
 * const orchestrator = createMultiAgentOrchestrator({
 *   agents: { reviewer: { agent: reviewerAgent } },
 *   constraints: {
 *     autoReview: spawnOnCondition({
 *       when: (facts) => (facts.confidence as number) < 0.7,
 *       agent: 'reviewer',
 *       input: (facts) => `Review this: ${facts.lastOutput}`,
 *     }),
 *   },
 * });
 * ```
 */
export function spawnOnCondition(config: {
  when: (facts: Record<string, unknown>) => boolean;
  agent: string;
  input: (facts: Record<string, unknown>) => string;
  /** Priority for the constraint (higher = evaluated first) */
  priority?: number;
  /** Additional context passed to the agent */
  context?: Record<string, unknown>;
  options?: SpawnOnConditionOptions;
}): OrchestratorConstraint<Record<string, unknown>> {
  const { when, agent, input, priority, context, options } = config;
  if (options && !spawnOnConditionOptionsWarned) {
    spawnOnConditionOptionsWarned = true;
    console.warn(
      "[Directive MultiAgent] spawnOnCondition `options` is deprecated. Use top-level `priority` and `context` instead.",
    );
  }
  const effectivePriority = priority ?? options?.priority;
  const effectiveContext = context ?? options?.context;

  return {
    when,
    require: (facts) =>
      ({
        type: "RUN_AGENT",
        agent,
        input: input(facts),
        context: effectiveContext,
      }) as RunAgentRequirement,
    priority: effectivePriority,
  };
}

// ============================================================================
// Debate Pattern
// ============================================================================

/** Configuration for the debate() factory and runDebate() imperative API. @see DebatePattern */
export type DebateConfig<T = unknown> = Omit<DebatePattern<T>, "type">;

/**
 * Create a debate pattern where agents compete and an evaluator picks the best.
 *
 * Flow:
 * 1. All agents produce proposals in parallel
 * 2. Evaluator receives all proposals and picks a winner
 * 3. Optionally repeat with evaluator feedback for refinement
 *
 * @param config - Debate configuration with `handlers`, `evaluator`, and optional settings
 * @see runDebate for the imperative API
 *
 * @example
 * ```typescript
 * const orchestrator = createMultiAgentOrchestrator({
 *   agents: {
 *     optimist: { agent: optimistAgent },
 *     pessimist: { agent: pessimistAgent },
 *     judge: { agent: judgeAgent },
 *   },
 *   patterns: {
 *     debate: debate({
 *       handlers: ['optimist', 'pessimist'],
 *       evaluator: 'judge',
 *       maxRounds: 2,
 *     }),
 *   },
 * });
 *
 * const result = await orchestrator.runPattern('debate', 'Should we invest in X?');
 * ```
 */
export function debate<T = unknown>(config: DebateConfig<T>): DebatePattern<T> {
  const {
    handlers,
    evaluator,
    maxRounds,
    extract,
    parseJudgement,
    signal,
    timeout,
  } = config;

  if (handlers.length < 2) {
    throw new Error(
      "[Directive MultiAgent] debate requires at least 2 handlers",
    );
  }
  if (maxRounds != null && (maxRounds < 1 || !Number.isFinite(maxRounds))) {
    throw new Error("[Directive MultiAgent] debate maxRounds must be >= 1");
  }

  return {
    type: "debate",
    handlers,
    evaluator,
    maxRounds,
    extract,
    parseJudgement,
    signal,
    timeout,
  };
}

/**
 * Run a debate imperatively on an orchestrator (no pattern registration needed).
 * Delegates to `orchestrator.runDebate()` so that lifecycle hooks, debug timeline,
 * and signal propagation all work correctly.
 *
 * @param orchestrator - The multi-agent orchestrator instance
 * @param config - Debate configuration with agents, evaluator, and optional settings
 * @param input - The initial input/prompt for the debate
 * @see debate for the declarative pattern API
 * @returns The winning agent's output, the winner ID, and all proposals from each round
 */
export async function runDebate<T>(
  orchestrator: MultiAgentOrchestrator,
  config: DebateConfig<T>,
  input: string,
): Promise<DebateResult<T>> {
  return orchestrator.runDebate<T>(config.handlers, config.evaluator, input, {
    maxRounds: config.maxRounds,
    extract: config.extract,
    parseJudgement: config.parseJudgement,
    signal: config.signal,
    timeout: config.timeout,
  });
}

// ============================================================================
// Derivation-Triggered Constraints
// ============================================================================

/**
 * Create a constraint that fires when a cross-agent derivation meets a condition.
 *
 * Wire this into the orchestrator's `derive` config and `constraints` config together.
 * The constraint's `when()` reads the derivation value from the orchestrator's derived snapshot.
 *
 * @example
 * ```typescript
 * const orchestrator = createMultiAgentOrchestrator({
 *   agents: { ... },
 *   derive: {
 *     totalCost: (snap) => snap.coordinator.globalTokens * 0.001,
 *   },
 *   constraints: {
 *     budgetAlert: derivedConstraint('totalCost', (cost) => cost > 5.0, {
 *       agent: 'budget-manager',
 *       input: (value) => `Budget exceeded: $${value}`,
 *     }),
 *   },
 * });
 * ```
 */
export function derivedConstraint(
  derivationId: string,
  condition: (value: unknown) => boolean,
  action: {
    agent: string;
    input: (value: unknown) => string;
    priority?: number;
    context?: Record<string, unknown>;
  },
): OrchestratorConstraint<Record<string, unknown>> {
  // Generation counter to guard against stale closure between when() and require()
  let lastValue: unknown = undefined;
  let whenGeneration = 0;
  let requireGeneration = -1;

  return {
    when: (facts) => {
      // Read derivation value from coordinator facts (injected by recomputeDerivations)
      const derived = facts.__derived as Record<string, unknown> | undefined;
      const value = derived?.[derivationId];
      lastValue = value;
      whenGeneration++;

      return condition(value);
    },
    require: (facts) => {
      // Re-read from facts if generation is stale (concurrent evaluation)
      const value =
        whenGeneration !== requireGeneration
          ? ((requireGeneration = whenGeneration), lastValue)
          : (facts.__derived as Record<string, unknown> | undefined)?.[
              derivationId
            ];

      return {
        type: "RUN_AGENT",
        agent: action.agent,
        input: action.input(value),
        context: action.context,
      } as RunAgentRequirement;
    },
    priority: action.priority,
  };
}

// ============================================================================
// Pool Auto-Scaling Constraint
// ============================================================================

/** Configuration for spawnPool constraint-driven auto-scaling */
export interface SpawnPoolConfig {
  /** Agent ID to spawn (must be registered in the orchestrator) */
  agent: string;
  /** Build the input for each spawned agent. Receives current facts and spawn index (0-based). */
  input: (facts: Record<string, unknown>, index: number) => string;
  /** How many agents to spawn. Number or function of facts for dynamic scaling. */
  count: number | ((facts: Record<string, unknown>) => number);
  /** Priority for the constraint. @default undefined */
  priority?: number;
  /** Additional context passed to each spawned agent */
  context?: Record<string, unknown>;
}

/**
 * Create a constraint that spawns a pool of agent instances when a condition is met.
 *
 * Unlike `spawnOnCondition` (which spawns one agent), `spawnPool` can target N agents.
 * However, only **one requirement is emitted per constraint evaluation cycle** — the constraint
 * re-fires on subsequent cycles as long as `when()` returns true, spawning one agent per cycle.
 *
 * @see spawnOnCondition — for spawning a single agent
 *
 * @example
 * ```typescript
 * const orchestrator = createMultiAgentOrchestrator({
 *   agents: { worker: { agent: workerAgent } },
 *   constraints: {
 *     scaleWorkers: spawnPool(
 *       (facts) => (facts.pendingTasks as number) > 0,
 *       {
 *         agent: 'worker',
 *         count: (facts) => Math.min(facts.pendingTasks as number, 5),
 *         input: (facts, i) => `Process task ${i + 1}`,
 *       },
 *     ),
 *   },
 * });
 * ```
 */
export function spawnPool(
  when: (facts: Record<string, unknown>) => boolean,
  config: SpawnPoolConfig,
): OrchestratorConstraint<Record<string, unknown>> {
  const { agent, input, priority, context } = config;

  return {
    when,
    require: (facts) => {
      // Only the first requirement is used per constraint cycle.
      // For count > 1, the constraint re-fires on subsequent cycles as long as `when` is true.
      return {
        type: "RUN_AGENT",
        agent,
        input: input(facts, 0),
        context,
      } as RunAgentRequirement;
    },
    priority,
  };
}

// ============================================================================
// Pattern Serialization
// ============================================================================

/** Serialized DAG node (functions stripped) */
export interface SerializedDagNode {
  handler: string;
  agent?: string;
  deps?: string[];
  timeout?: number;
  priority?: number;
}

/** JSON-safe representation of any execution pattern (all functions stripped) */
export type SerializedPattern =
  | {
      type: "parallel";
      handlers: string[];
      minSuccess?: number;
      timeout?: number;
    }
  | { type: "sequential"; handlers: string[]; continueOnError?: boolean }
  | {
      type: "supervisor";
      supervisor: string;
      workers: string[];
      maxRounds?: number;
    }
  | {
      type: "dag";
      nodes: Record<string, SerializedDagNode>;
      timeout?: number;
      maxConcurrent?: number;
      onNodeError?: "fail" | "skip-downstream" | "continue";
    }
  | {
      type: "reflect";
      handler: string;
      evaluator: string;
      maxIterations?: number;
      onExhausted?: "accept-last" | "accept-best" | "throw";
      timeout?: number;
      threshold?: number;
    }
  | { type: "race"; handlers: string[]; timeout?: number; minSuccess?: number }
  | {
      type: "debate";
      handlers: string[];
      evaluator: string;
      maxRounds?: number;
      timeout?: number;
    }
  | {
      type: "goal";
      nodes: Record<string, SerializedGoalNode>;
      maxSteps?: number;
      timeout?: number;
    };

/** Serialized goal node (functions stripped) */
export interface SerializedGoalNode {
  handler: string;
  agent?: string;
  produces: string[];
  requires?: string[];
  allowRerun?: boolean;
  priority?: number;
}

/**
 * Serialize an execution pattern to a JSON-safe object.
 *
 * Strips all function callbacks and runtime objects (AbortSignal) while
 * preserving the topology — which agents, in what structure, with what
 * numeric/string/boolean options.
 *
 * Use this for visual editors, LLM-generated plans, persistence, or
 * debugging. Restore with {@link patternFromJSON}.
 *
 * Note: Function-form `threshold` on reflect patterns is not serializable and will be dropped.
 * Re-supply it via `overrides` when calling {@link patternFromJSON}.
 *
 * @example
 * ```typescript
 * const p = parallel({ handlers: ["a", "b"], merge: (r) => r });
 * const json = patternToJSON(p);
 * // { type: "parallel", handlers: ["a", "b"] }
 * localStorage.setItem("plan", JSON.stringify(json));
 * ```
 */
export function patternToJSON(
  pattern: ExecutionPattern<unknown>,
): SerializedPattern {
  switch (pattern.type) {
    case "parallel":
      return {
        type: "parallel",
        handlers: pattern.handlers,
        minSuccess: pattern.minSuccess,
        timeout: pattern.timeout,
      };
    case "sequential":
      return {
        type: "sequential",
        handlers: pattern.handlers,
        continueOnError: pattern.continueOnError,
      };
    case "supervisor":
      return {
        type: "supervisor",
        supervisor: pattern.supervisor,
        workers: pattern.workers,
        maxRounds: pattern.maxRounds,
      };
    case "dag": {
      const nodes: Record<string, SerializedDagNode> = Object.create(null);
      for (const [id, node] of Object.entries(pattern.nodes)) {
        nodes[id] = {
          handler: node.handler,
          deps: node.deps,
          timeout: node.timeout,
          priority: node.priority,
        };
      }

      return {
        type: "dag",
        nodes,
        timeout: pattern.timeout,
        maxConcurrent: pattern.maxConcurrent,
        onNodeError: pattern.onNodeError,
      };
    }
    case "reflect":
      return {
        type: "reflect",
        handler: pattern.handler,
        evaluator: pattern.evaluator,
        maxIterations: pattern.maxIterations,
        onExhausted: pattern.onExhausted,
        timeout: pattern.timeout,
        threshold:
          typeof pattern.threshold === "number" ? pattern.threshold : undefined,
      };
    case "race":
      return {
        type: "race",
        handlers: pattern.handlers,
        timeout: pattern.timeout,
        minSuccess: pattern.minSuccess,
      };
    case "debate":
      return {
        type: "debate",
        handlers: pattern.handlers,
        evaluator: pattern.evaluator,
        maxRounds: pattern.maxRounds,
        timeout: pattern.timeout,
      };
    case "goal": {
      const cnodes: Record<string, SerializedGoalNode> = Object.create(null);
      for (const [id, node] of Object.entries(pattern.nodes)) {
        cnodes[id] = {
          handler: node.handler,
          produces: node.produces,
          requires: node.requires,
          allowRerun: node.allowRerun,
          priority: node.priority,
        };
      }

      return {
        type: "goal",
        nodes: cnodes,
        maxSteps: pattern.maxSteps,
        timeout: pattern.timeout,
      };
    }
  }
}

const ALLOWED_PATTERN_TYPES = new Set([
  "parallel",
  "sequential",
  "supervisor",
  "dag",
  "reflect",
  "race",
  "debate",
  "goal",
]);

/**
 * Restore an execution pattern from its serialized form.
 *
 * Returns the data structure with all function fields set to `undefined`.
 * Supply callbacks via the optional `overrides` parameter to re-attach
 * runtime behavior.
 *
 * @example
 * ```typescript
 * const json = JSON.parse(localStorage.getItem("plan")!);
 * const pattern = patternFromJSON<string[]>(json, {
 *   merge: (results) => results.map(r => r.output as string),
 * });
 * // Use the imperative API — runPattern takes a registered pattern ID, not an object
 * if (pattern.type === "parallel") {
 *   const result = await orchestrator.runParallel(pattern.handlers, input, pattern.merge);
 * }
 * ```
 */
export function patternFromJSON<T = unknown>(
  json: SerializedPattern,
  overrides?: Partial<ExecutionPattern<T>>,
): ExecutionPattern<T> {
  // Migration shim: accept legacy "converge" serialized patterns (shallow copy to avoid mutating input)
  const normalized =
    json &&
    typeof json === "object" &&
    (json as Record<string, unknown>).type === "converge"
      ? ({ ...json, type: "goal" as const } as SerializedPattern)
      : json;
  if (
    !normalized ||
    typeof normalized !== "object" ||
    !ALLOWED_PATTERN_TYPES.has((normalized as SerializedPattern).type)
  ) {
    throw new Error(
      `[Directive] patternFromJSON: invalid or unknown pattern type "${(json as Record<string, unknown>)?.type}"`,
    );
  }
  const safe: Record<string, unknown> = Object.create(null);
  for (const [k, v] of Object.entries(normalized)) {
    if (k !== "__proto__" && k !== "constructor" && k !== "prototype") {
      safe[k] = v;
    }
  }

  // Migration shim: accept legacy `agent`/`agents` fields from persisted patterns
  const raw = safe as Record<string, unknown>;
  if (!raw.handler && raw.agent && typeof raw.agent === "string") {
    raw.handler = raw.agent;
    delete raw.agent;
  }
  if (!raw.handlers && raw.agents && Array.isArray(raw.agents)) {
    raw.handlers = raw.agents;
    delete raw.agents;
  }
  // Migrate DAG/goal node `agent` → `handler`
  if (raw.nodes && typeof raw.nodes === "object") {
    for (const node of Object.values(
      raw.nodes as Record<string, Record<string, unknown>>,
    )) {
      if (!node.handler && node.agent && typeof node.agent === "string") {
        node.handler = node.agent;
        delete node.agent;
      }
    }
  }

  return { ...safe, ...overrides } as ExecutionPattern<T>;
}
