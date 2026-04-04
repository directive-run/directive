// ============================================================================
// Multi-Agent Orchestrator Types
// ============================================================================
//
// Extracted from multi-agent-orchestrator.ts — all interfaces, type aliases,
// and type re-exports that define the orchestrator's public API surface.
// ============================================================================

import type {
  Plugin,
  Requirement,
  System,
} from "@directive-run/core";
import type { CircuitBreaker } from "@directive-run/core/plugins";
import type {
  OrchestratorStreamResult,
} from "./agent-orchestrator.js";
import type { DebugTimeline } from "./debug-timeline.js";
import type { HealthMonitor } from "./health-monitor.js";
import type { AgentMemory } from "./memory.js";
import type { ReflectionEvaluation } from "./reflection.js";
import type {
  AgentLike,
  AgentRetryConfig,
  AgentRunner,
  AgentSelectionStrategy,
  ApprovalRequest,
  CrossAgentDerivationFn,
  DagCheckpointState,
  DagPattern,
  DebateCheckpointState,
  GoalCheckpointState,
  GoalNode,
  GoalPattern,
  GoalResult,
  GuardrailFn,
  GuardrailsConfig,
  InputGuardrailData,
  MultiAgentLifecycleHooks,
  MultiAgentSelfHealingConfig,
  NamedGuardrail,
  OrchestratorConstraint,
  OrchestratorResolver,
  OutputGuardrailData,
  PatternCheckpointConfig,
  ReflectCheckpointState,
  RelaxationTier,
  RunOptions,
  RunResult,
  Scratchpad,
  SequentialCheckpointState,
  SupervisorCheckpointState,
  ToolCallGuardrailData,
} from "./types.js";
import type {
  BreakpointConfig,
  BreakpointModifications,
  BreakpointRequest,
  MultiAgentBreakpointType,
} from "./breakpoints.js";
import type {
  Checkpoint,
  CheckpointStore,
} from "./checkpoint.js";
import type {
  MultiplexedStreamResult,
} from "./streaming.js";
import type {
  SafeParseable,
} from "./structured-output.js";

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
  /**
   * Include system meta in agent instructions for structured LLM reasoning.
   * When true, constraint labels, resolver descriptions, fact annotations,
   * and module metadata are injected into each agent's system prompt.
   * @default false
   */
  metaContext?: boolean;
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
  /** Destroy the orchestrator, resetting all state and releasing resources. */
  destroy(): void;
}
