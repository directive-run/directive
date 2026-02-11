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
 * import { createMultiAgentOrchestrator } from 'directive/openai-agents-multi';
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
 *       agents: ['researcher', 'researcher', 'researcher'],
 *       merge: (results) => combineResearch(results),
 *     },
 *   },
 * });
 * ```
 */

import type {
  AgentLike,
  RunResult,
  RunOptions,
  AgentRunner,
  GuardrailFn,
  OutputGuardrailData,
  NamedGuardrail,
} from "./index.js";
import type { Requirement } from "../../core/types.js";

// ============================================================================
// Async Semaphore (for slot acquisition without polling)
// ============================================================================

/**
 * Async semaphore for controlling concurrent access.
 * Uses a queue-based approach instead of polling for efficiency.
 *
 * @example
 * ```typescript
 * import { Semaphore } from 'directive/openai-agents-multi';
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
  private readonly queue: Array<{ resolve: (release: () => void) => void; reject: (error: Error) => void }> = [];

  constructor(max: number) {
    this.maxPermits = max;
    this.count = max;
  }

  async acquire(): Promise<() => void> {
    if (this.count > 0) {
      this.count--;
      return () => this.release();
    }

    return new Promise<() => void>((resolve, reject) => {
      this.queue.push({
        resolve: (releaseFn: () => void) => resolve(releaseFn),
        reject,
      });
    });
  }

  private release(): void {
    this.count++;
    const next = this.queue.shift();
    if (next) {
      this.count--;
      next.resolve(() => this.release());
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
    const err = new Error("[Directive Semaphore] Semaphore drained - all pending acquisitions rejected");
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
  /** Maximum concurrent runs for this agent (default: 1) */
  maxConcurrent?: number;
  /** Timeout for agent runs (ms) */
  timeout?: number;
  /** Custom run options */
  runOptions?: Omit<RunOptions, "signal">;
  /** Description for constraint-based selection */
  description?: string;
  /** Capabilities this agent has */
  capabilities?: string[];
  /** Per-agent output guardrails (applied in addition to stack-level guardrails) */
  guardrails?: {
    output?: Array<GuardrailFn<OutputGuardrailData> | NamedGuardrail<OutputGuardrailData>>;
  };
}

/** Agent registry configuration */
export interface AgentRegistry {
  [agentId: string]: AgentRegistration;
}

/** State of a running agent */
export interface AgentRunState {
  agentId: string;
  runId: string;
  status: "pending" | "running" | "completed" | "error" | "cancelled";
  input: string;
  output?: unknown;
  error?: Error;
  startedAt?: number;
  completedAt?: number;
  tokens: number;
}

// ============================================================================
// Execution Pattern Types
// ============================================================================

/** Parallel execution pattern - run agents concurrently and merge results */
export interface ParallelPattern<T = unknown> {
  type: "parallel";
  /** Agent IDs to run in parallel (can repeat for multiple instances) */
  agents: string[];
  /** Function to merge results from all agents */
  merge: (results: RunResult<unknown>[]) => T | Promise<T>;
  /** Minimum successful results required (default: all) */
  minSuccess?: number;
  /** Overall timeout (ms) */
  timeout?: number;
}

/** Sequential execution pattern - pipeline of agents */
export interface SequentialPattern<T = unknown> {
  type: "sequential";
  /** Agent IDs in execution order */
  agents: string[];
  /** Transform output to next input (default: stringify) */
  transform?: (output: unknown, agentId: string, index: number) => string;
  /** Final result extractor */
  extract?: (output: unknown) => T;
  /** Continue on error (default: false) */
  continueOnError?: boolean;
}

/** Supervisor pattern - one agent directs others */
export interface SupervisorPattern<T = unknown> {
  type: "supervisor";
  /** Supervisor agent ID */
  supervisor: string;
  /** Worker agent IDs */
  workers: string[];
  /** Maximum delegation rounds */
  maxRounds?: number;
  /** Extract final result */
  extract?: (supervisorOutput: unknown, workerResults: RunResult<unknown>[]) => T;
}

/** Union of all patterns */
export type ExecutionPattern<T = unknown> =
  | ParallelPattern<T>
  | SequentialPattern<T>
  | SupervisorPattern<T>;

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

/** Constraint for agent selection */
export interface AgentSelectionConstraint {
  when: (facts: Record<string, unknown>) => boolean | Promise<boolean>;
  select: string | ((facts: Record<string, unknown>) => string);
  input: string | ((facts: Record<string, unknown>) => string);
  priority?: number;
}

/** Run agent requirement */
export interface RunAgentRequirement extends Requirement {
  type: "RUN_AGENT";
  agent: string;
  input: string;
  context?: Record<string, unknown>;
}

/** Multi-agent orchestrator options */
export interface MultiAgentOrchestratorOptions {
  /** Base run function */
  runner: AgentRunner;
  /** Registered agents */
  agents: AgentRegistry;
  /** Execution patterns */
  patterns?: Record<string, ExecutionPattern>;
  /** Handoff callbacks */
  onHandoff?: (request: HandoffRequest) => void;
  /** Handoff completion callbacks */
  onHandoffComplete?: (result: HandoffResult) => void;
  /** Maximum number of handoff results to retain (default: 1000) */
  maxHandoffHistory?: number;
  /** Debug mode */
  debug?: boolean;
}

/** Multi-agent state in facts */
export interface MultiAgentState {
  /** Namespace for each agent's state */
  __agents: Record<string, {
    status: "idle" | "running" | "completed" | "error";
    lastInput?: string;
    lastOutput?: unknown;
    lastError?: string;
    runCount: number;
    totalTokens: number;
  }>;
  /** Pending handoffs */
  __handoffs: HandoffRequest[];
  /** Completed handoffs */
  __handoffResults: HandoffResult[];
}

/** Multi-agent orchestrator instance */
export interface MultiAgentOrchestrator {
  /** Run a single agent */
  runAgent<T>(agentId: string, input: string, options?: RunOptions): Promise<RunResult<T>>;
  /** Run an execution pattern */
  runPattern<T>(patternId: string, input: string): Promise<T>;
  /** Run agents in parallel */
  runParallel<T>(
    agentIds: string[],
    inputs: string | string[],
    merge: (results: RunResult<unknown>[]) => T | Promise<T>
  ): Promise<T>;
  /** Run agents sequentially */
  runSequential<T>(
    agentIds: string[],
    initialInput: string,
    options?: { transform?: (output: unknown, agentId: string, index: number) => string }
  ): Promise<RunResult<T>[]>;
  /** Request a handoff between agents */
  handoff(fromAgent: string, toAgent: string, input: string, context?: Record<string, unknown>): Promise<RunResult<unknown>>;
  /** Get agent state */
  getAgentState(agentId: string): MultiAgentState["__agents"][string] | undefined;
  /** Get all agent states */
  getAllAgentStates(): Record<string, MultiAgentState["__agents"][string]>;
  /** Get pending handoffs */
  getPendingHandoffs(): HandoffRequest[];
  /** Reset all agent states */
  reset(): void;
  /** Dispose of the orchestrator, resetting all state */
  dispose(): void;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a multi-agent orchestrator.
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
 *   patterns: {
 *     research: {
 *       type: 'parallel',
 *       agents: ['researcher', 'researcher'],
 *       merge: (results) => results.map(r => r.output).join('\n\n'),
 *     },
 *     write: {
 *       type: 'sequential',
 *       agents: ['writer', 'reviewer'],
 *     },
 *   },
 * });
 *
 * // Run pattern
 * const research = await orchestrator.runPattern('research', 'What is AI?');
 *
 * // Run parallel
 * const results = await orchestrator.runParallel(
 *   ['researcher', 'researcher'],
 *   ['Question 1', 'Question 2'],
 *   (results) => results.map(r => r.output)
 * );
 *
 * // Handoff
 * const reviewed = await orchestrator.handoff('writer', 'reviewer', draft);
 * ```
 *
 * @throws {Error} If a pattern references an agent that is not in the registry
 */
export function createMultiAgentOrchestrator(
  options: MultiAgentOrchestratorOptions
): MultiAgentOrchestrator {
  const {
    runner,
    agents,
    patterns = {},
    onHandoff,
    onHandoffComplete,
    maxHandoffHistory = 1000,
  } = options;

  // Validate that all pattern agents exist in the registry
  const registeredAgentIds = new Set(Object.keys(agents));
  const missingAgents: Array<{ patternId: string; agentId: string }> = [];

  for (const [patternId, pattern] of Object.entries(patterns)) {
    const agentsToCheck: string[] = [];

    switch (pattern.type) {
      case "parallel":
        agentsToCheck.push(...pattern.agents);
        break;
      case "sequential":
        agentsToCheck.push(...pattern.agents);
        break;
      case "supervisor":
        agentsToCheck.push(pattern.supervisor, ...pattern.workers);
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
      .map(({ patternId, agentId }) => `  - Pattern "${patternId}" references unknown agent "${agentId}"`)
      .join("\n");
    throw new Error(
      `[Directive MultiAgent] Pattern validation failed. The following agents are not registered:\n${details}\n\nRegistered agents: ${[...registeredAgentIds].join(", ") || "(none)"}`
    );
  }

  // Semaphores for controlling concurrent access per agent (no polling)
  const semaphores = new Map<string, Semaphore>();

  // Agent states
  const agentStates: Record<string, MultiAgentState["__agents"][string]> = {};
  for (const agentId of Object.keys(agents)) {
    const maxConcurrent = agents[agentId]?.maxConcurrent ?? 1;
    agentStates[agentId] = {
      status: "idle",
      runCount: 0,
      totalTokens: 0,
    };
    semaphores.set(agentId, new Semaphore(maxConcurrent));
  }

  // Handoff tracking with bounded size (configurable)
  const MAX_HANDOFF_RESULTS = maxHandoffHistory;
  const pendingHandoffs: HandoffRequest[] = [];
  const handoffResults: HandoffResult[] = [];
  let handoffCounter = 0;

  // Helper to acquire run slot using semaphore (no polling)
  async function acquireSlot(agentId: string): Promise<() => void> {
    const semaphore = semaphores.get(agentId);
    if (!semaphore) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    return semaphore.acquire();
  }

  // Helper to add handoff result with bounded size
  function addHandoffResult(result: HandoffResult): void {
    handoffResults.push(result);
    // Evict oldest results if over limit
    while (handoffResults.length > MAX_HANDOFF_RESULTS) {
      handoffResults.shift();
    }
  }

  // Run a single agent
  async function runSingleAgent<T>(
    agentId: string,
    input: string,
    opts?: RunOptions
  ): Promise<RunResult<T>> {
    const registration = agents[agentId];
    if (!registration) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    const release = await acquireSlot(agentId);
    const state = agentStates[agentId]!;

    state.status = "running";
    state.lastInput = input;

    // Create timeout if specified
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let abortHandler: (() => void) | undefined;

    try {
      if (registration.timeout) {
        timeoutId = setTimeout(() => controller.abort(), registration.timeout);
      }

      // Combine signals with proper cleanup to prevent memory leaks
      if (opts?.signal) {
        abortHandler = () => controller.abort();
        opts.signal.addEventListener("abort", abortHandler);
      }

      const result = await runner<T>(registration.agent, input, {
        ...registration.runOptions,
        ...opts,
        signal: controller.signal,
      });

      state.status = "completed";
      state.lastOutput = result.output;
      state.runCount++;
      state.totalTokens += result.totalTokens;

      return result;
    } catch (error) {
      state.status = "error";
      state.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      // Clean up to prevent memory leaks
      if (timeoutId) clearTimeout(timeoutId);
      if (abortHandler && opts?.signal) {
        opts.signal.removeEventListener("abort", abortHandler);
      }
      release();
    }
  }

  // Run parallel pattern
  async function runParallelPattern<T>(
    pattern: ParallelPattern<T>,
    _input: string
  ): Promise<T> {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (pattern.timeout) {
      timeoutId = setTimeout(() => controller.abort(), pattern.timeout);
    }

    try {
      const promises = pattern.agents.map((agentId) =>
        runSingleAgent(agentId, _input, { signal: controller.signal }).catch(
          (error) => {
            if (pattern.minSuccess === undefined) throw error;
            return null;
          }
        )
      );

      const results = await Promise.all(promises);
      const successResults = results.filter((r): r is RunResult<unknown> => r !== null);

      if (pattern.minSuccess && successResults.length < pattern.minSuccess) {
        throw new Error(
          `Not enough successful results: ${successResults.length}/${pattern.minSuccess}`
        );
      }

      return pattern.merge(successResults);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  // Run sequential pattern
  async function runSequentialPattern<T>(
    pattern: SequentialPattern<T>,
    initialInput: string
  ): Promise<T> {
    let currentInput = initialInput;
    let lastResult: RunResult<unknown> | undefined;

    for (let i = 0; i < pattern.agents.length; i++) {
      const agentId = pattern.agents[i]!;

      try {
        lastResult = await runSingleAgent(agentId, currentInput);

        // Transform for next agent
        if (i < pattern.agents.length - 1) {
          if (pattern.transform) {
            currentInput = pattern.transform(lastResult.output, agentId, i);
          } else {
            currentInput =
              typeof lastResult.output === "string"
                ? lastResult.output
                : JSON.stringify(lastResult.output);
          }
        }
      } catch (error) {
        if (!pattern.continueOnError) throw error;
      }
    }

    if (!lastResult) {
      throw new Error("No successful results in sequential pattern");
    }

    return pattern.extract
      ? pattern.extract(lastResult.output)
      : (lastResult.output as T);
  }

  // Run supervisor pattern
  async function runSupervisorPattern<T>(
    pattern: SupervisorPattern<T>,
    input: string
  ): Promise<T> {
    const workerResults: RunResult<unknown>[] = [];
    const maxRounds = pattern.maxRounds ?? 5;

    // Initial supervisor run
    let supervisorResult = await runSingleAgent<{
      action: "delegate" | "complete";
      worker?: string;
      workerInput?: string;
      output?: unknown;
    }>(pattern.supervisor, input);

    for (let round = 0; round < maxRounds; round++) {
      const action = supervisorResult.output;

      if (action.action === "complete" || !action.worker) {
        break;
      }

      // Validate worker
      if (!pattern.workers.includes(action.worker)) {
        throw new Error(`Invalid worker: ${action.worker}`);
      }

      // Run worker
      const workerResult = await runSingleAgent(
        action.worker,
        action.workerInput ?? ""
      );
      workerResults.push(workerResult);

      // Report back to supervisor
      supervisorResult = await runSingleAgent(
        pattern.supervisor,
        `Worker ${action.worker} completed with result: ${JSON.stringify(workerResult.output)}`
      );
    }

    return pattern.extract
      ? pattern.extract(supervisorResult.output, workerResults)
      : (supervisorResult.output as T);
  }

  const orchestrator: MultiAgentOrchestrator = {
    runAgent: runSingleAgent,

    async runPattern<T>(patternId: string, input: string): Promise<T> {
      const pattern = patterns[patternId];
      if (!pattern) {
        throw new Error(`Unknown pattern: ${patternId}`);
      }

      switch (pattern.type) {
        case "parallel":
          return runParallelPattern(pattern as ParallelPattern<T>, input);
        case "sequential":
          return runSequentialPattern(pattern as SequentialPattern<T>, input);
        case "supervisor":
          return runSupervisorPattern(pattern as SupervisorPattern<T>, input);
        default:
          throw new Error(`Unknown pattern type: ${(pattern as { type: string }).type}`);
      }
    },

    async runParallel<T>(
      agentIds: string[],
      inputs: string | string[],
      merge: (results: RunResult<unknown>[]) => T | Promise<T>
    ): Promise<T> {
      const inputArray = Array.isArray(inputs)
        ? inputs
        : agentIds.map(() => inputs);

      if (inputArray.length !== agentIds.length) {
        throw new Error("Input count must match agent count");
      }

      const promises = agentIds.map((agentId, i) =>
        runSingleAgent(agentId, inputArray[i]!)
      );

      const results = await Promise.all(promises);
      return merge(results);
    },

    async runSequential<T>(
      agentIds: string[],
      initialInput: string,
      opts?: { transform?: (output: unknown, agentId: string, index: number) => string }
    ): Promise<RunResult<T>[]> {
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
                : JSON.stringify(result.output);
          }
        }
      }

      return results as RunResult<T>[];
    },

    async handoff(
      fromAgent: string,
      toAgent: string,
      input: string,
      context?: Record<string, unknown>
    ): Promise<RunResult<unknown>> {
      const request: HandoffRequest = {
        id: `handoff-${++handoffCounter}`,
        fromAgent,
        toAgent,
        input,
        context,
        requestedAt: Date.now(),
      };

      pendingHandoffs.push(request);
      onHandoff?.(request);

      try {
        const result = await runSingleAgent(toAgent, input);

        const handoffResult: HandoffResult = {
          request,
          result,
          completedAt: Date.now(),
        };

        addHandoffResult(handoffResult);
        onHandoffComplete?.(handoffResult);

        // Remove from pending
        const index = pendingHandoffs.indexOf(request);
        if (index >= 0) pendingHandoffs.splice(index, 1);

        return result;
      } catch (error) {
        // Remove from pending on error
        const index = pendingHandoffs.indexOf(request);
        if (index >= 0) pendingHandoffs.splice(index, 1);
        throw error;
      }
    },

    getAgentState(agentId: string) {
      return agentStates[agentId];
    },

    getAllAgentStates() {
      return { ...agentStates };
    },

    getPendingHandoffs() {
      return [...pendingHandoffs];
    },

    reset() {
      for (const agentId of Object.keys(agents)) {
        const maxConcurrent = agents[agentId]?.maxConcurrent ?? 1;
        agentStates[agentId] = {
          status: "idle",
          runCount: 0,
          totalTokens: 0,
        };
        // Drain existing semaphore to reject pending waiters, then recreate
        const existing = semaphores.get(agentId);
        if (existing) {
          existing.drain();
        }
        semaphores.set(agentId, new Semaphore(maxConcurrent));
      }
      pendingHandoffs.length = 0;
      handoffResults.length = 0;
    },

    dispose() {
      orchestrator.reset();
    },
  };

  return orchestrator;
}

// ============================================================================
// Pattern Helpers
// ============================================================================

/**
 * Create a parallel pattern configuration.
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
  agents: string[],
  merge: (results: RunResult<unknown>[]) => T | Promise<T>,
  options?: { minSuccess?: number; timeout?: number }
): ParallelPattern<T> {
  return {
    type: "parallel",
    agents,
    merge,
    ...options,
  };
}

/**
 * Create a sequential pattern configuration.
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
  agents: string[],
  options?: {
    transform?: (output: unknown, agentId: string, index: number) => string;
    extract?: (output: unknown) => T;
    continueOnError?: boolean;
  }
): SequentialPattern<T> {
  return {
    type: "sequential",
    agents,
    ...options,
  };
}

/**
 * Create a supervisor pattern configuration.
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
    extract?: (supervisorOutput: unknown, workerResults: RunResult<unknown>[]) => T;
  }
): SupervisorPattern<T> {
  return {
    type: "supervisor",
    supervisor: supervisorAgent,
    workers,
    ...options,
  };
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
  priority?: number
): AgentSelectionConstraint {
  return { when, select: agent, input, priority };
}

/**
 * Create a RUN_AGENT requirement.
 *
 * @example
 * ```typescript
 * constraints: {
 *   needsResearch: {
 *     when: (facts) => facts.hasUnknowns,
 *     require: runAgentRequirement('researcher', facts.query),
 *   },
 * }
 * ```
 */
export function runAgentRequirement(
  agent: string,
  input: string,
  context?: Record<string, unknown>
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
  separator = "\n\n"
): string {
  return results
    .map((r) =>
      typeof r.output === "string"
        ? r.output
        : JSON.stringify(r.output)
    )
    .join(separator);
}

/**
 * Merge results by picking the best one based on a scoring function.
 */
export function pickBestResult<T>(
  results: RunResult<T>[],
  score: (result: RunResult<T>) => number
): RunResult<T> {
  if (results.length === 0) {
    throw new Error("No results to pick from");
  }

  return results.reduce((best, current) =>
    score(current) > score(best) ? current : best
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
