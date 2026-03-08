import type {
  AgentSelectionStrategy,
  DagExecutionContext,
  DagNode,
  DagPattern,
  GoalMetrics,
  GoalNode,
  GoalPattern,
  PatternCheckpointConfig,
  RelaxationTier,
  RunResult,
} from "./types.js";
import type {
  ParallelPattern,
  SequentialPattern,
  SupervisorPattern,
  ReflectPattern,
  RacePattern,
  ReflectIterationRecord,
} from "./multi-agent-orchestrator.js";
import type { ReflectionEvaluation } from "./reflection.js";

// ============================================================================
// Pattern Helpers
// ============================================================================

/**
 * Create a parallel execution pattern that runs handlers concurrently and merges results.
 *
 * @param handlers - Handler IDs (agents or tasks) to run concurrently.
 * @param merge - Combine all handler results into a single output (array may be shorter than handlers when `minSuccess` is set).
 * @param options - Optional `minSuccess` and `timeout` overrides.
 * @returns A {@link ParallelPattern} configuration object.
 *
 * @example
 * ```typescript
 * const researchPattern = parallel(
 *   ['researcher', 'researcher', 'researcher'],
 *   (results) => results.map(r => r.output).join('\n'),
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
 * Create a sequential execution pattern that pipes output from one handler to the next.
 *
 * @param handlers - Handler IDs (agents or tasks) to run in order, where each handler's output feeds as input to the next.
 * @param options - Optional `transform`, `extract`, and `continueOnError` overrides.
 * @returns A {@link SequentialPattern} configuration object.
 *
 * @example
 * ```typescript
 * const writeReviewPattern = sequential(
 *   ['writer', 'reviewer'],
 *   { transform: (output) => `Review this: ${output}` },
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
 * Create a supervisor pattern where a coordinating agent delegates work to a pool of workers.
 *
 * The supervisor runs first, then dispatches tasks to workers based on its output.
 * This repeats for up to `maxRounds` until the supervisor signals completion.
 *
 * @param supervisorAgent - Agent ID that coordinates the workers.
 * @param workers - Agent IDs for the worker pool.
 * @param options - Optional `maxRounds` and `extract` overrides.
 * @returns A {@link SupervisorPattern} configuration object.
 *
 * @example
 * ```typescript
 * const managedPattern = supervisor(
 *   'manager',
 *   ['worker1', 'worker2'],
 *   { maxRounds: 3 },
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
 * Create a directed acyclic graph (DAG) execution pattern.
 *
 * Nodes run concurrently when their dependencies are satisfied. The runtime
 * validates the graph is acyclic and that all dependency references are valid.
 *
 * @param nodes - Node definitions keyed by ID, each with a `handler` and optional `deps` array.
 * @param merge - Combine DAG outputs into a single result (defaults to `context.outputs`).
 * @param options - Optional `timeout`, `maxConcurrent`, and `onNodeError` strategy.
 * @returns A {@link DagPattern} configuration object.
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
 * Create a reflect pattern that iterates between a producer and evaluator until quality is met.
 *
 * The producer generates output, then the evaluator scores it. If the score
 * is below the threshold, the producer retries with evaluator feedback,
 * up to `maxIterations` times.
 *
 * @param handler - Producer handler ID (agent or task) that generates output.
 * @param evaluator - Evaluator handler ID that judges quality and provides feedback.
 * @param options - Optional iteration, parsing, signal, and threshold configuration.
 * @returns A {@link ReflectPattern} configuration object.
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
 * Create a race pattern that runs handlers concurrently and returns the first successful result.
 *
 * All handlers start simultaneously. The first to complete successfully wins;
 * remaining handlers are aborted. Use `minSuccess` to wait for N results before picking.
 *
 * @param handlers - Handler IDs (agents or tasks) to race concurrently.
 * @param options - Optional `extract`, `timeout`, `minSuccess`, and `signal` overrides.
 * @returns A {@link RacePattern} configuration object.
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
 * Create a goal-driven execution pattern where agents are selected and run
 * until a goal condition is satisfied.
 *
 * Declare what each agent produces and requires. The runtime automatically
 * infers the execution graph from dependency analysis and drives agents
 * toward goal achievement, with optional satisfaction scoring and relaxation tiers.
 *
 * @param nodes - Goal node definitions keyed by ID, each declaring `produces`, `requires`, and a `handler`.
 * @param when - Predicate that returns `true` when the goal is achieved.
 * @param options - Optional `satisfaction`, `maxSteps`, `extract`, `timeout`, `selectionStrategy`, and `relaxation` config.
 * @returns A {@link GoalPattern} configuration object.
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
 * Create a selection strategy that runs all ready agents concurrently.
 *
 * This is the default strategy for {@link goal} patterns.
 *
 * @returns An {@link AgentSelectionStrategy} that selects every ready agent.
 */
export function allReadyStrategy(): AgentSelectionStrategy {
  return {
    select: (readyAgents) => readyAgents,
  };
}

/**
 * Create a selection strategy that picks agents with the highest historical impact.
 *
 * Sorts ready agents by average satisfaction delta (descending) and selects the top N.
 *
 * @param opts - Optional `topN` to limit how many agents are selected (default: 3).
 * @returns An {@link AgentSelectionStrategy} that prioritizes high-impact agents.
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
 * Create a selection strategy that prefers agents with lower token cost per satisfaction delta.
 *
 * Agents without historical metrics are prioritized first (to gather data).
 *
 * @returns An {@link AgentSelectionStrategy} that optimizes for cost efficiency.
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
