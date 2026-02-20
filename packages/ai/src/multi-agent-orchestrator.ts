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
 *       agents: ['researcher', 'researcher', 'researcher'],
 *       merge: (results) => combineResearch(results),
 *     },
 *   },
 * });
 * ```
 */

import type {
  Requirement,
  ModuleSchema,
  Plugin,
  System,
} from "@directive-run/core";
import {
  setBridgeFact,
  getBridgeFact,
  createCallbackPlugin,
  requirementGuard,
} from "@directive-run/core/adapter-utils";
import { createModule, createSystem, t } from "@directive-run/core";
import type { AgentMemory } from "./memory.js";
import type { CircuitBreaker } from "@directive-run/core/plugins";
import type {
  AgentLike,
  RunResult,
  RunOptions,
  AgentRunner,
  GuardrailFn,
  InputGuardrailData,
  OutputGuardrailData,
  ToolCallGuardrailData,
  AgentRetryConfig,
  NamedGuardrail,
  GuardrailsConfig,
  RejectedRequest,
  ApprovalRequest,
  OrchestratorConstraint,
  OrchestratorResolverContext,
  OrchestratorResolver,
  OrchestratorState,
  MultiAgentLifecycleHooks,
  DagNode,
  DagPattern,
  DagExecutionContext,
  MultiAgentSelfHealingConfig,
  RerouteEvent,
  CrossAgentSnapshot,
  CrossAgentDerivationFn,
  Scratchpad,
} from "./types.js";
import {
  GuardrailError,
  APPROVAL_KEY,
  BREAKPOINT_KEY,
  SCRATCHPAD_KEY,
  orchestratorBridgeSchema,
} from "./types.js";
import { ReflectionExhaustedError } from "./reflection.js";
import type { ReflectionEvaluation } from "./reflection.js";
import { createDebugTimeline, createDebugTimelinePlugin, type DebugTimeline } from "./debug-timeline.js";
import { createHealthMonitor, type HealthMonitor } from "./health-monitor.js";
import {
  normalizeGuardrail,
  executeGuardrailWithRetry,
  executeAgentWithRetry,
} from "./guardrail-utils.js";
import type { OrchestratorStreamResult, OrchestratorStreamChunk } from "./agent-orchestrator.js";
import {
  getAgentState,
  setAgentState,
  getApprovalState,
  setApprovalState,
  getConversation,
  setConversation,
  getToolCalls,
  setToolCalls,
  getBreakpointState,
  setBreakpointState,
  getOrchestratorState,
  convertOrchestratorConstraints,
} from "./orchestrator-bridge.js";

import { withStructuredOutput, type SafeParseable } from "./structured-output.js";
import { createCheckpointId, validateCheckpoint, type Checkpoint, type CheckpointStore, type MultiAgentCheckpointLocalState } from "./checkpoint.js";
import type { BreakpointConfig, BreakpointRequest, BreakpointModifications, BreakpointContext, MultiAgentBreakpointType } from "./breakpoints.js";
import { matchBreakpoint, createBreakpointId, createInitialBreakpointState, MAX_BREAKPOINT_HISTORY } from "./breakpoints.js";
import { mergeTaggedStreams, type MultiplexedStreamResult } from "./streaming.js";

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
  private readonly queue: Array<{ resolve: (release: () => void) => void; reject: (error: Error) => void }> = [];

  constructor(max: number) {
    if (max < 1 || !Number.isFinite(max)) {
      throw new Error(`[Directive Semaphore] Invalid max permits: ${max}. Must be a finite number >= 1.`);
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
            reject(new Error("[Directive Semaphore] Aborted while waiting for permit"));
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
    input?: Array<GuardrailFn<InputGuardrailData> | NamedGuardrail<InputGuardrailData>>;
    output?: Array<GuardrailFn<OutputGuardrailData> | NamedGuardrail<OutputGuardrailData>>;
    toolCall?: Array<GuardrailFn<ToolCallGuardrailData> | NamedGuardrail<ToolCallGuardrailData>>;
  };
  /** Per-agent retry config (overrides orchestrator-level agentRetry) */
  retry?: AgentRetryConfig;
  /** Per-agent constraints */
  constraints?: Record<string, OrchestratorConstraint<Record<string, unknown>>>;
  /** Per-agent resolvers */
  resolvers?: Record<string, OrchestratorResolver<Record<string, unknown>, Requirement>>;
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

/** Parallel execution pattern - run agents concurrently and merge results */
export interface ParallelPattern<T = unknown> {
  type: "parallel";
  /** Agent IDs to run in parallel (can repeat for multiple instances) */
  agents: string[];
  /** Function to merge results from all agents */
  merge: (results: RunResult<unknown>[]) => T | Promise<T>;
  /** Minimum successful results required. @default agents.length */
  minSuccess?: number;
  /** Overall timeout (ms) */
  timeout?: number;
}

/** Sequential execution pattern - pipeline of agents */
export interface SequentialPattern<T = unknown> {
  type: "sequential";
  /** Agent IDs in execution order */
  agents: string[];
  /** Transform output to next input. @default JSON.stringify */
  transform?: (output: unknown, agentId: string, index: number) => string;
  /** Final result extractor */
  extract?: (output: unknown) => T;
  /** Continue on error. @default false */
  continueOnError?: boolean;
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
  extract?: (supervisorOutput: unknown, workerResults: RunResult<unknown>[]) => T;
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
  /** Producer agent ID */
  agent: string;
  /** Evaluator agent ID (receives output as input) */
  evaluator: string;
  /** Maximum iterations. @default 2 */
  maxIterations?: number;
  /** Parse evaluator output into ReflectionEvaluation. @default JSON.parse */
  parseEvaluation?: (output: unknown) => ReflectionEvaluation;
  /** Build retry input from original input + feedback */
  buildRetryInput?: (input: string, feedback: string, iteration: number) => string;
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
}

/**
 * Race pattern - first successful agent wins, rest cancelled.
 * @see race — factory helper
 * @see RaceResult — return type
 */
export interface RacePattern<T = unknown> {
  type: "race";
  /** Agent IDs to race */
  agents: string[];
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
  /** Agent IDs that will generate competing proposals */
  agents: string[];
  /** Evaluator agent ID that judges proposals */
  evaluator: string;
  /** Maximum rounds of debate. @default 2 */
  maxRounds?: number;
  /** Extract final result from the winning proposal */
  extract?: (output: unknown) => T;
  /** Parse evaluator output. @default JSON.parse expecting `{ winnerId, feedback }` */
  parseJudgement?: (output: unknown) => { winnerId: string; feedback?: string; score?: number };
  /** AbortSignal for external cancellation */
  signal?: AbortSignal;
  /** Overall timeout (ms). Creates an internal AbortSignal. */
  timeout?: number;
}

/** Union of all patterns */
export type ExecutionPattern<T = unknown> =
  | ParallelPattern<T>
  | SequentialPattern<T>
  | SupervisorPattern<T>
  | DagPattern<T>
  | ReflectPattern<T>
  | RacePattern<T>
  | DebatePattern<T>;

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
  /** Maximum number of handoff results to retain. @default 1000 */
  maxHandoffHistory?: number;
  /** Debug mode */
  debug?: boolean;
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
  onBudgetWarning?: (event: { currentTokens: number; maxBudget: number; percentage: number }) => void;
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
  resolvers?: Record<string, OrchestratorResolver<Record<string, unknown>, Requirement>>;
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

/** Per-call options for multi-agent runAgent/run */
export interface MultiAgentRunCallOptions extends RunOptions {
  /** Override structured output schema for this call. Set to `null` to opt out of per-agent schema. */
  outputSchema?: SafeParseable<unknown> | null;
  /** Override max schema retries for this call. */
  maxSchemaRetries?: number;
}

/** Multi-agent orchestrator instance */
export interface MultiAgentOrchestrator {
  /** The underlying Directive System */
  // biome-ignore lint/suspicious/noExplicitAny: System type varies per configuration
  system: System<any>;
  /** Combined facts from all agent modules + coordinator */
  facts: Record<string, unknown>;
  /** Run a single agent */
  runAgent<T>(agentId: string, input: string, options?: MultiAgentRunCallOptions): Promise<RunResult<T>>;
  /** Run an agent with streaming support */
  runAgentStream<T>(agentId: string, input: string, options?: { signal?: AbortSignal }): OrchestratorStreamResult<T>;
  /**
   * Run an execution pattern by its registered pattern ID.
   *
   * Note: For race and debate patterns, `runPattern` returns only the extracted result value.
   * Use `runRace()` or `runDebate()` to access full results including `winnerId` and `allResults`.
   */
  runPattern<T>(patternId: string, input: string): Promise<T>;
  /** Run agents in parallel */
  runParallel<T>(
    agentIds: string[],
    inputs: string | string[],
    merge: (results: RunResult<unknown>[]) => T | Promise<T>,
    options?: { minSuccess?: number; timeout?: number }
  ): Promise<T>;
  /** Run agents sequentially */
  runSequential<T>(
    agentIds: string[],
    initialInput: string,
    options?: { transform?: (output: unknown, agentId: string, index: number) => string }
  ): Promise<RunResult<T>[]>;
  /** Request a handoff between agents */
  handoff(fromAgent: string, toAgent: string, input: string, context?: Record<string, unknown>): Promise<RunResult<unknown>>;
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
  run<T>(agentId: string, input: string, options?: MultiAgentRunCallOptions): Promise<RunResult<T>>;
  /** Alias for runAgentStream */
  runStream<T>(agentId: string, input: string, options?: { signal?: AbortSignal }): OrchestratorStreamResult<T>;
  /** Register a new agent dynamically */
  registerAgent(agentId: string, registration: AgentRegistration): void;
  /** Unregister an agent (must be idle) */
  unregisterAgent(agentId: string): void;
  /** Get registered agent IDs */
  getAgentIds(): string[];
  /** Get agent state */
  getAgentState(agentId: string): MultiAgentState["__agents"][string] | undefined;
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
  restore(checkpoint: Checkpoint, options?: { restoreTimeline?: boolean }): void;
  /** Run multiple agents with multiplexed streaming */
  runParallelStream<T>(
    agentIds: string[],
    inputs: string | string[],
    merge: (results: RunResult<unknown>[]) => T | Promise<T>,
    options?: { minSuccess?: number; timeout?: number; signal?: AbortSignal }
  ): MultiplexedStreamResult<T>;
  /** Resume a paused breakpoint */
  resumeBreakpoint(id: string, modifications?: BreakpointModifications): void;
  /** Cancel a paused breakpoint */
  cancelBreakpoint(id: string, reason?: string): void;
  /** Get pending breakpoints */
  getPendingBreakpoints(): BreakpointRequest[];
  /** Race multiple agents — first successful result wins, rest cancelled */
  runRace<T>(
    agentIds: string[],
    input: string,
    options?: { extract?: (result: RunResult<unknown>) => T; timeout?: number; minSuccess?: number; signal?: AbortSignal }
  ): Promise<RaceResult<T>>;
  /** Run a reflect pattern imperatively (no pre-registration needed) */
  runReflect<T>(
    producerId: string,
    evaluatorId: string,
    input: string,
    options?: {
      maxIterations?: number;
      parseEvaluation?: (output: unknown) => ReflectionEvaluation;
      buildRetryInput?: (input: string, feedback: string, iteration: number) => string;
      extract?: (output: unknown) => T;
      onExhausted?: "accept-last" | "accept-best" | "throw";
      onIteration?: (record: ReflectIterationRecord) => void;
      signal?: AbortSignal;
      timeout?: number;
      threshold?: number | ((iteration: number) => number);
    }
  ): Promise<{ result: T; iterations: number; history: ReflectIterationRecord[]; exhausted: boolean }>;
  /** Run a debate imperatively (no pre-registration needed) */
  runDebate<T>(
    agentIds: string[],
    evaluatorId: string,
    input: string,
    options?: {
      maxRounds?: number;
      extract?: (output: unknown) => T;
      parseJudgement?: (output: unknown) => { winnerId: string; feedback?: string; score?: number };
      signal?: AbortSignal;
      timeout?: number;
    }
  ): Promise<DebateResult<T>>;
  /**
   * Get reflection iteration history from last runReflectPattern call.
   * @deprecated Use the `history` field on the return value from `runReflect()` instead.
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
  options: MultiAgentOrchestratorOptions
): MultiAgentOrchestrator {
  const {
    runner,
    agents: inputAgents,
    patterns = {},
    onHandoff,
    onHandoffComplete,
    maxHandoffHistory = 1000,
    debug = false,
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
  } = options;

  // Shallow copy so registerAgent/unregisterAgent don't mutate the caller's object
  const agents: AgentRegistry = { ...inputAgents };

  // Enforce approval workflow configuration
  if (!autoApproveToolCalls && !onApprovalRequest) {
    throw new Error(
      "[Directive MultiAgent] Invalid approval configuration: autoApproveToolCalls is false but no onApprovalRequest callback provided. " +
      "Tool calls would wait for approval indefinitely. Either:\n" +
      "  - Set autoApproveToolCalls: true to auto-approve all tool calls\n" +
      "  - Provide an onApprovalRequest callback to handle approvals programmatically"
    );
  }

  // Validate budget warning threshold
  if (budgetWarningThreshold < 0 || budgetWarningThreshold > 1) {
    throw new Error(`[Directive MultiAgent] budgetWarningThreshold must be between 0 and 1, got ${budgetWarningThreshold}`);
  }

  // Validate reserved agent IDs
  const RESERVED_IDS = new Set(["__coord", "__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty"]);
  for (const agentId of Object.keys(agents)) {
    if (RESERVED_IDS.has(agentId)) {
      throw new Error(`[Directive MultiAgent] Agent ID "${agentId}" is reserved and cannot be used`);
    }
  }

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
      case "dag":
        for (const node of Object.values(pattern.nodes)) {
          agentsToCheck.push(node.agent);
        }
        break;
      case "reflect":
        agentsToCheck.push(pattern.agent, pattern.evaluator);
        break;
      case "race":
        agentsToCheck.push(...pattern.agents);
        break;
      case "debate":
        agentsToCheck.push(...(pattern as DebatePattern).agents, (pattern as DebatePattern).evaluator);
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

  // Validate DAG patterns for cycles
  for (const [patternId, pattern] of Object.entries(patterns)) {
    if (pattern.type === "dag") {
      validateDagAcyclic(patternId, pattern.nodes);
    }
  }

  // ---- Debug Timeline setup ----
  let timeline: DebugTimeline | null = null;
  let timelinePlugin: ReturnType<typeof createDebugTimelinePlugin> | null = null;
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
    event: Parameters<NonNullable<MultiAgentLifecycleHooks[K]>>[0]
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
    coordFacts["__derived"] = t.object() as unknown;
  }

  const coordSchema = {
    facts: coordFacts,
    derivations: {},
    events: {},
    requirements: {},
  } satisfies ModuleSchema;

  // Convert orchestrator-level constraints
  // biome-ignore lint/suspicious/noExplicitAny: Constraint types complex
  const coordConstraints: Record<string, any> = convertOrchestratorConstraints(userConstraints);

  // Add built-in budget constraint — reads coordinator fact reactively
  if (maxTokenBudget) {
    coordConstraints["__budgetLimit"] = {
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
        const combinedFacts = { ...context.facts, ...state } as unknown as Record<string, unknown> & OrchestratorState;

        const resolverCtx: OrchestratorResolverContext<Record<string, unknown>> = {
          facts: combinedFacts,
          runAgent: async <T>(agent: AgentLike, input: string, opts?: RunOptions) => {
            return runner<T>(agent, input, opts);
          },
          signal: context.signal,
        };

        return resolver.resolve(req, resolverCtx);
      },
    };
  }

  // Built-in pause resolver
  coordResolvers["__pause"] = {
    requirement: requirementGuard<PauseBudgetExceededReq>("__PAUSE_BUDGET_EXCEEDED"),
    // biome-ignore lint/suspicious/noExplicitAny: Context type varies
    resolve: async () => {
      globalStatus = "paused";
      if (debug) {
        console.debug("[Directive MultiAgent] Budget exceeded — all agents paused");
      }
    },
  };

  // Built-in RUN_AGENT resolver
  coordResolvers["__runAgent"] = {
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
  modulesMap["__coord"] = coordinatorModule;

  for (const [agentId, registration] of Object.entries(agents)) {
    // biome-ignore lint/suspicious/noExplicitAny: Constraint types complex
    const perAgentConstraints: Record<string, any> = registration.constraints
      ? convertOrchestratorConstraints(registration.constraints)
      : {};

    // Convert per-agent resolvers (C3 fix)
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
            const combinedFacts = { ...context.facts, ...state } as unknown as Record<string, unknown> & OrchestratorState;

            const resolverContext: OrchestratorResolverContext<Record<string, unknown>> = {
              facts: combinedFacts,
              runAgent: async <T>(agent: AgentLike, input: string, opts?: RunOptions) => {
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
      resolvers: Object.keys(perAgentResolvers).length > 0 ? (perAgentResolvers as any) : undefined,
    });
  }

  // ---- Create System ----
  const callbackPlugin = createCallbackPlugin("directive-multi-agent-callbacks", {});

  // Build plugins array with optional timeline plugin
  const allPlugins = [...plugins, callbackPlugin];
  if (debug && timeline) {
    // Create timeline plugin after system is available (uses lazy getSnapshotId)
    timelinePlugin = createDebugTimelinePlugin(
      timeline,
      () => {
        try {
          return (system as any).debug?.currentIndex ?? null;
        } catch {
          return null;
        }
      },
    );
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
  const agentStates: Record<string, MultiAgentState["__agents"][string]> = Object.create(null);
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
  const derivedChangeCallbacks = new Set<(id: string, value: unknown) => void>();

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
      snapshot.scratchpad = getBridgeFact<Record<string, unknown>>(coordFacts, SCRATCHPAD_KEY) ?? {};
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
        console.warn(`[Directive MultiAgent] Derivation "${derivId}" threw:`, derivError);
      }
      fireHook("onDerivationError", {
        derivationId: derivId,
        error: derivError instanceof Error ? derivError : new Error(String(derivError)),
        timestamp: Date.now(),
      });
    }
  }

  // ---- Shared Scratchpad ----
  const scratchpadChangeCallbacks = new Set<(key: string, value: unknown) => void>();
  const scratchpadKeyCallbacks = new Map<string, Set<(key: string, value: unknown) => void>>();

  const scratchpadInstance: Scratchpad | null = scratchpadConfig ? {
    get(key: string): unknown {
      const coordFacts = getAgentFacts("__coord");
      const data = getBridgeFact<Record<string, unknown>>(coordFacts, SCRATCHPAD_KEY);
      if (data == null || !Object.hasOwn(data, key)) {
        return undefined;
      }

      return data[key];
    },

    set(key: string, value: unknown): void {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        return;
      }

      const coordFacts = getAgentFacts("__coord");
      const changedKeys = [key];
      system.batch(() => {
        const current = getBridgeFact<Record<string, unknown>>(coordFacts, SCRATCHPAD_KEY) ?? {};
        setBridgeFact(coordFacts, SCRATCHPAD_KEY, { ...current, [key]: value });
      });

      notifyScratchpadChange(changedKeys, key, value);
      recomputeDerivations();
    },

    has(key: string): boolean {
      const coordFacts = getAgentFacts("__coord");
      const data = getBridgeFact<Record<string, unknown>>(coordFacts, SCRATCHPAD_KEY);

      return data != null && Object.hasOwn(data, key);
    },

    delete(key: string): void {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        return;
      }
      const coordFacts = getAgentFacts("__coord");
      system.batch(() => {
        const current = getBridgeFact<Record<string, unknown>>(coordFacts, SCRATCHPAD_KEY) ?? {};
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
        const current = getBridgeFact<Record<string, unknown>>(coordFacts, SCRATCHPAD_KEY) ?? {};
        setBridgeFact(coordFacts, SCRATCHPAD_KEY, { ...current, ...safeValues });
      });

      for (const [k, v] of Object.entries(safeValues)) {
        notifyScratchpadChange(keys, k, v);
      }
      recomputeDerivations();
    },

    getAll(): Record<string, unknown> {
      const coordFacts = getAgentFacts("__coord");

      return { ...(getBridgeFact<Record<string, unknown>>(coordFacts, SCRATCHPAD_KEY) ?? {}) };
    },

    subscribe(keys: string[], callback: (key: string, value: unknown) => void): () => void {
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
        setBridgeFact(coordFacts, SCRATCHPAD_KEY, { ...scratchpadConfig.init });
      });
    },
  } : null;

  function notifyScratchpadChange(allKeys: string[], key: string, value: unknown): void {
    // Fire key-specific callbacks
    const keyCbs = scratchpadKeyCallbacks.get(key);
    if (keyCbs) {
      for (const cb of keyCbs) {
        try { cb(key, value); } catch { /* non-fatal */ }
      }
    }

    // Fire global change callbacks
    for (const cb of scratchpadChangeCallbacks) {
      try { cb(key, value); } catch { /* non-fatal */ }
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
  function waitForBreakpointResolution(agentId: string, breakpointId: string, signal?: AbortSignal): Promise<BreakpointModifications | null> {
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

      const unsubscribe = system.subscribe([`${agentId}.${BREAKPOINT_KEY}`], () => {
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
          reject(new Error(cancelReason
            ? `[Directive MultiAgent] Breakpoint ${breakpointId} cancelled: ${cancelReason}`
            : `[Directive MultiAgent] Breakpoint ${breakpointId} cancelled`
          ));
        }
      });

      if (signal) {
        onAbort = () => {
          cleanupAll();
          reject(new Error(`[Directive MultiAgent] Breakpoint wait aborted for ${breakpointId}`));
        };
        if (signal.aborted) {
          cleanupAll();
          reject(new Error(`[Directive MultiAgent] Breakpoint wait aborted for ${breakpointId}`));

          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      timeoutId = setTimeout(() => {
        cleanupAll();
        breakpointModifications.delete(breakpointId);
        breakpointCancelReasons.delete(breakpointId);
        reject(new Error(
          `[Directive MultiAgent] Breakpoint timeout: ${breakpointId} not resolved within ${Math.round(breakpointTimeoutMs / 1000)}s`
        ));
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
    extra?: { patternId?: string; handoff?: { fromAgent: string; toAgent: string } }
  ): Promise<{ input: string; skip: boolean }> {
    if (breakpointConfigs.length === 0) {
      return { input, skip: false };
    }

    const agentFacts = getAgentFacts(agentId);
    const context: BreakpointContext = {
      agentId,
      agentName,
      input,
      state: getOrchestratorState(agentFacts) as unknown as Record<string, unknown>,
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
    try { onBreakpoint?.(request); } catch { /* callback error non-fatal */ }
    try { (hooks as any).onBreakpoint?.(request); } catch { /* hook error non-fatal */ }

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
    const modifications = await waitForBreakpointResolution(agentId, bpId, signal);

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
  function waitForApproval(agentId: string, requestId: string, signal?: AbortSignal): Promise<void> {
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

      // Use system.subscribe with namespaced key (C1 fix)
      const unsubscribe = system.subscribe([`${agentId}.${APPROVAL_KEY}`], () => {
        const approval = getApprovalState(agentFacts);
        if (approval.approved.includes(requestId)) {
          cleanupAll();
          resolve();
        } else {
          const rejectedRequest = approval.rejected.find((r: RejectedRequest) => r.id === requestId);
          if (rejectedRequest) {
            cleanupAll();
            const errorMsg = rejectedRequest.reason
              ? `Request ${requestId} rejected: ${rejectedRequest.reason}`
              : `Request ${requestId} rejected`;
            reject(new Error(errorMsg));
          }
        }
      });

      // Abort signal cleanup
      if (signal) {
        onAbort = () => {
          cleanupAll();
          reject(new Error(`[Directive MultiAgent] Approval wait aborted for request ${requestId}`));
        };
        if (signal.aborted) {
          cleanupAll();
          reject(new Error(`[Directive MultiAgent] Approval wait aborted for request ${requestId}`));

          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      // Timeout with solution guidance (M12 fix)
      timeoutId = setTimeout(() => {
        cleanupAll();
        const timeoutSeconds = Math.round(approvalTimeoutMs / 1000);
        reject(new Error(
          `[Directive MultiAgent] Approval timeout: Request ${requestId} not resolved within ${timeoutSeconds}s.\n` +
          `Solutions:\n` +
          `  1. Handle via onApprovalRequest callback and call orchestrator.approve()/reject()\n` +
          `  2. Set autoApproveToolCalls: true to auto-approve\n` +
          `  3. Increase approvalTimeoutMs (current: ${approvalTimeoutMs}ms)\n` +
          `See: https://directive.run/docs/ai/multi-agent`
        ));
      }, approvalTimeoutMs);
    });
  }

  // ---- Core: Run a single agent ----
  async function runSingleAgent<T>(
    agentId: string,
    input: string,
    opts?: MultiAgentRunCallOptions
  ): Promise<RunResult<T>> {
    assertNotDisposed();

    const registration = agents[agentId];
    if (!registration) {
      const available = Object.keys(agents).join(", ") || "(none)";

      throw new Error(`[Directive MultiAgent] Unknown agent "${agentId}". Registered agents: ${available}`);
    }

    if (opts?.signal?.aborted) {
      throw new Error(`[Directive MultiAgent] Agent "${agentId}" run aborted before starting`);
    }

    if (globalStatus === "paused") {
      throw new Error(`[Directive MultiAgent] Orchestrator is paused (budget exceeded or manual pause)`);
    }

    // Increment synchronously before any await so waitForIdle knows a run is pending
    pendingRuns++;

    try {
      const effectiveCircuitBreaker = registration.circuitBreaker ?? orchestratorCircuitBreaker;
      if (effectiveCircuitBreaker) {
        return await effectiveCircuitBreaker.execute(() =>
          runSingleAgentInner<T>(agentId, registration, input, opts)
        );
      }

      return await runSingleAgentInner<T>(agentId, registration, input, opts);
    } catch (error) {
      // Self-healing: attempt reroute if configured and this is a CB error or health threshold
      if (selfHealing && !(opts as { __isReroute?: boolean })?.__isReroute) {
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
              type: "agent_error",
              timestamp: Date.now(),
              agentId,
              snapshotId: null,
              errorMessage: `Rerouting to ${alternate}: ${error instanceof Error ? error.message : String(error)}`,
              durationMs: 0,
            });
          }

          // Prevent circular reroute (max 1 hop)
          return runSingleAgent<T>(alternate, input, {
            ...opts,
            __isReroute: true,
          } as any);
        }

        // No equivalents — apply degradation policy
        if (selfHealing.degradation === "fallback-response" && selfHealing.fallbackResponse !== undefined) {
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
        state.lastError = error instanceof Error ? error.message : String(error);
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
    opts?: MultiAgentRunCallOptions
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

      throw new Error(`[Directive MultiAgent] Unknown agent "${agentId}". Registered agents: ${available}`);
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
            instructions: (agent.instructions ?? "") + "\n\nConversation context:\n" + contextStr,
          };
        }
      }

      // Fire onAgentStart hook
      fireHook("onAgentStart",{
        agentId,
        agentName: agent.name,
        input: processedInput,
        timestamp: startTime,
      });

      // Record timeline event
      if (timeline) {
        timeline.record({
          type: "agent_start",
          timestamp: startTime,
          agentId,
          snapshotId: null,
          inputLength: processedInput.length,
        });
      }

      // ---- Breakpoint: pre_input_guardrails ----
      {
        const bpResult = await handleBreakpoint("pre_input_guardrails", agentId, agent.name, processedInput, opts?.signal);
        if (bpResult.skip) {
          state.status = "completed";
          notifyIdleWaiters();

          return { output: undefined as T, messages: [], toolCalls: [], totalTokens: 0 };
        }
        processedInput = bpResult.input;
      }

      // ---- Input guardrails: orchestrator-level, then per-agent ----
      const allInputGuardrails = [
        ...(guardrails.input ?? []),
        ...(registration.guardrails?.input ?? []),
      ];
      const inputGuardrailsList = allInputGuardrails.map((g, i) =>
        normalizeGuardrail(g, i, "input")
      );
      for (const guardrail of inputGuardrailsList) {
        const { name } = guardrail;
        const context = {
          agentName: agent.name,
          input: processedInput,
          facts: getOrchestratorState(agentFacts) as unknown as Record<string, unknown>,
        };
        const guardStartTime = Date.now();
        const result = await executeGuardrailWithRetry(
          guardrail,
          { input: processedInput, agentName: agent.name },
          context
        );
        fireHook("onGuardrailCheck",{
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
        const bpResult = await handleBreakpoint("pre_agent_run", agentId, agent.name, processedInput, opts?.signal);
        if (bpResult.skip) {
          state.status = "completed";
          notifyIdleWaiters();

          return { output: undefined as T, messages: [], toolCalls: [], totalTokens: 0 };
        }
        processedInput = bpResult.input;
      }

      // ---- Per-agent structured output wrapping (per-call overrides per-agent) ----
      let effectiveRunner: AgentRunner = runner;
      const effectiveSchema = opts?.outputSchema !== undefined
        ? opts.outputSchema              // null = opt-out, SafeParseable = override
        : registration.outputSchema;     // per-agent default
      if (effectiveSchema) {
        effectiveRunner = withStructuredOutput(runner, {
          schema: effectiveSchema,
          maxRetries: opts?.maxSchemaRetries ?? registration.maxSchemaRetries ?? 2,
          extractJson: registration.extractJson,
          schemaDescription: registration.schemaDescription,
        });
      }

      // Effective retry config: per-agent overrides orchestrator default
      const effectiveRetry = registration.retry ?? defaultAgentRetry;

      // Run agent with retry support
      const result = await executeAgentWithRetry<T>(effectiveRunner, agent, processedInput, {
        ...registration.runOptions,
        ...opts,
        signal: controller.signal,
        onMessage: (message) => {
          const currentConversation = getConversation(agentFacts);
          const updated = [...currentConversation, message];
          setConversation(agentFacts, updated.length > MAX_CONVERSATION_MESSAGES
            ? updated.slice(-MAX_CONVERSATION_MESSAGES)
            : updated);
          opts?.onMessage?.(message);
        },
        onToolCall: async (toolCall) => {
          // ---- Tool call guardrails: orchestrator-level, then per-agent ----
          const allToolCallGuardrails = [
            ...(guardrails.toolCall ?? []),
            ...(registration.guardrails?.toolCall ?? []),
          ];
          const toolCallGuardrailsList = allToolCallGuardrails.map((g, i) =>
            normalizeGuardrail(g, i, "toolCall")
          );
          for (const guardrail of toolCallGuardrailsList) {
            const { name } = guardrail;
            const context = {
              agentName: agent.name,
              input: processedInput,
              facts: getOrchestratorState(agentFacts) as unknown as Record<string, unknown>,
            };
            const guardStartTime = Date.now();
            const guardResult = await executeGuardrailWithRetry(
              guardrail,
              { toolCall, agentName: agent.name, input: processedInput },
              context
            );
            fireHook("onGuardrailCheck",{
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
          setToolCalls(agentFacts, updatedToolCalls.length > MAX_TOOL_CALLS
            ? updatedToolCalls.slice(-MAX_TOOL_CALLS)
            : updatedToolCalls);
          opts?.onToolCall?.(toolCall);
        },
      }, effectiveRetry ? {
        ...effectiveRetry,
        onRetry: (attempt, error, delayMs) => {
          effectiveRetry.onRetry?.(attempt, error, delayMs);
          fireHook("onAgentRetry",{
            agentId,
            agentName: agent.name,
            input: processedInput,
            attempt,
            error,
            delayMs,
            timestamp: Date.now(),
          });
        },
      } : undefined);

      // ---- Breakpoint: pre_output_guardrails ----
      {
        const bpResult = await handleBreakpoint("pre_output_guardrails", agentId, agent.name, processedInput, opts?.signal);
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
        normalizeGuardrail(g, i, "output")
      );
      for (const guardrail of outputGuardrailsList) {
        const { name } = guardrail;
        const context = {
          agentName: agent.name,
          input: processedInput,
          facts: getOrchestratorState(agentFacts) as unknown as Record<string, unknown>,
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
          context
        );
        fireHook("onGuardrailCheck",{
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
        const currentTokens = getBridgeFact<number>(coordFacts, "__globalTokens");
        const newTotal = currentTokens + result.totalTokens;
        globalTokenCount = newTotal;
        setBridgeFact(coordFacts, "__globalTokens", newTotal);

        // Check budget warning threshold
        if (maxTokenBudget && onBudgetWarning) {
          budgetPercentage = newTotal / maxTokenBudget;
          const warningFired = getBridgeFact<boolean>(coordFacts, "__budgetWarningFired");
          if (budgetPercentage >= budgetWarningThreshold && !warningFired) {
            setBridgeFact(coordFacts, "__budgetWarningFired", true);
            shouldFireBudgetWarning = true;
          }
        }
      });

      // Fire budget warning callback outside of batch (callbacks shouldn't run inside batch)
      if (shouldFireBudgetWarning) {
        try {
          onBudgetWarning!({ currentTokens: globalTokenCount, maxBudget: maxTokenBudget!, percentage: budgetPercentage });
        } catch (callbackError) {
          if (debug) {
            console.debug("[Directive MultiAgent] onBudgetWarning threw:", callbackError);
          }
        }
      }

      // Store messages in memory (best-effort — don't fail the run on memory errors)
      if (effectiveMemory && result.messages.length > 0) {
        try {
          effectiveMemory.addMessages(result.messages);
        } catch (memoryError) {
          if (debug) {
            console.debug("[Directive MultiAgent] Memory addMessages failed:", memoryError);
          }
        }
      }

      // Fire onAgentComplete hook
      fireHook("onAgentComplete",{
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
        const outputStr = typeof result.output === "string" ? result.output : safeStringify(result.output);
        timeline.record({
          type: "agent_complete",
          timestamp: Date.now(),
          agentId,
          snapshotId: null,
          outputLength: outputStr.length,
          totalTokens: result.totalTokens,
          durationMs: Date.now() - startTime,
        });
      }

      // Record health success
      if (healthMonitorInstance) {
        healthMonitorInstance.recordSuccess(agentId, Date.now() - startTime);
      }

      // Recompute cross-agent derivations
      recomputeDerivations();

      // ---- Breakpoint: post_run ----
      await handleBreakpoint("post_run", agentId, agent.name, processedInput, opts?.signal);

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
      fireHook("onAgentError",{
        agentId,
        agentName: agent.name,
        input: processedInput,
        error: error instanceof Error ? error : new Error(String(error)),
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
      });

      // Record timeline event
      if (timeline) {
        timeline.record({
          type: "agent_error",
          timestamp: Date.now(),
          agentId,
          snapshotId: null,
          errorMessage: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        });
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
    options: { signal?: AbortSignal } = {}
  ): OrchestratorStreamResult<T> {
    assertNotDisposed();

    const registration = agents[agentId];
    if (!registration) {
      const available = Object.keys(agents).join(", ") || "(none)";

      throw new Error(`[Directive MultiAgent] Unknown agent "${agentId}". Registered agents: ${available}`);
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
      pushChunk({ type: "progress", phase: "starting", message: "Running input guardrails" });

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
                accumulatedOutput = accumulatedOutput.slice(-MAX_ACCUMULATED_OUTPUT);
              }
              pushChunk({ type: "token", data: message.content, tokenCount });
            }
          },
          onToolCall: async (toolCall) => {
            pushChunk({ type: "tool_start", tool: toolCall.name, toolCallId: toolCall.id, arguments: toolCall.arguments });
            if (toolCall.result) {
              pushChunk({ type: "tool_end", tool: toolCall.name, toolCallId: toolCall.id, result: toolCall.result });
            }
          },
        });

        const duration = Date.now() - startTime;
        pushChunk({ type: "done", totalTokens: result.totalTokens, duration, droppedTokens: 0 });
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
        pushChunk({ type: "error", error: error instanceof Error ? error : new Error(String(error)) });
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

            return new Promise<IteratorResult<OrchestratorStreamChunk>>((resolve) => {
              waiters.push((chunk) => {
                if (chunk === null) {
                  resolve({ done: true, value: undefined });
                } else {
                  resolve({ done: false, value: chunk });
                }
              });
            });
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
    patternId?: string
  ): Promise<T> {
    const patternStartTime = Date.now();
    if (patternId) {
      fireHook("onPatternStart",{
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
      const promises = pattern.agents.map((agentId) =>
        runSingleAgent(agentId, input, { signal: controller.signal }).catch(
          (error) => {
            if (pattern.minSuccess === undefined) {
              throw error;
            }

            return null;
          }
        )
      );

      const results = await Promise.all(promises);
      const successResults = results.filter((r): r is RunResult<unknown> => r !== null);

      if (pattern.minSuccess !== undefined && successResults.length < pattern.minSuccess) {
        const failCount = results.length - successResults.length;

        throw new Error(
          `[Directive MultiAgent] Parallel pattern: Only ${successResults.length}/${pattern.agents.length} agents succeeded ` +
          `(minimum required: ${pattern.minSuccess}, failed: ${failCount})`
        );
      }

      return pattern.merge(successResults);
    } catch (error) {
      patternError = error instanceof Error ? error : new Error(String(error));
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (patternId) {
        fireHook("onPatternComplete",{
          patternId,
          patternType: "parallel",
          durationMs: Date.now() - patternStartTime,
          timestamp: Date.now(),
          error: patternError,
        });
      }
    }
  }

  async function runSequentialPattern<T>(
    pattern: SequentialPattern<T>,
    initialInput: string,
    patternId?: string
  ): Promise<T> {
    const patternStartTime = Date.now();
    if (patternId) {
      fireHook("onPatternStart",{
        patternId,
        patternType: "sequential",
        input: initialInput,
        timestamp: patternStartTime,
      });
    }

    let currentInput = initialInput;
    let lastResult: RunResult<unknown> | undefined;
    let patternError: Error | undefined;

    try {
      for (let i = 0; i < pattern.agents.length; i++) {
        const agentId = pattern.agents[i]!;

        // ---- Breakpoint: pre_pattern_step ----
        {
          const bpResult = await handleBreakpoint("pre_pattern_step", agentId, agents[agentId]?.agent.name ?? agentId, currentInput, undefined, {
            patternId,
          });
          if (bpResult.skip) {
            continue;
          }
          currentInput = bpResult.input;
        }

        try {
          lastResult = await runSingleAgent(agentId, currentInput);

          if (i < pattern.agents.length - 1) {
            if (pattern.transform) {
              currentInput = pattern.transform(lastResult.output, agentId, i);
            } else {
              currentInput =
                typeof lastResult.output === "string"
                  ? lastResult.output
                  : safeStringify(lastResult.output);
            }
          }
        } catch (error) {
          if (!pattern.continueOnError) {
            throw error;
          }
        }
      }

      if (!lastResult) {
        throw new Error("[Directive MultiAgent] No successful results in sequential pattern");
      }

      return pattern.extract
        ? pattern.extract(lastResult.output)
        : (lastResult.output as T);
    } catch (error) {
      patternError = error instanceof Error ? error : new Error(String(error));
      throw error;
    } finally {
      if (patternId) {
        fireHook("onPatternComplete",{
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
    patternId?: string
  ): Promise<T> {
    const patternStartTime = Date.now();
    if (patternId) {
      fireHook("onPatternStart",{
        patternId,
        patternType: "supervisor",
        input,
        timestamp: patternStartTime,
      });
    }

    const workerResults: RunResult<unknown>[] = [];
    const maxRounds = pattern.maxRounds ?? 5;
    if (maxRounds < 1 || !Number.isFinite(maxRounds)) {
      throw new Error("[Directive MultiAgent] supervisor maxRounds must be >= 1");
    }
    let patternError: Error | undefined;

    try {
      let supervisorResult = await runSingleAgent<unknown>(pattern.supervisor, input);

      for (let round = 0; round < maxRounds; round++) {
        // M9: Validate supervisor output shape
        const raw = supervisorResult.output;
        let action: { action: string; worker?: string; workerInput?: string; output?: unknown };

        if (typeof raw === "string") {
          try {
            action = JSON.parse(raw);
          } catch {
            throw new Error(
              `[Directive MultiAgent] Supervisor "${pattern.supervisor}" returned unparseable output (round ${round + 1}). ` +
              `Expected JSON with { action, worker?, workerInput? } but got: ${raw.slice(0, 200)}`
            );
          }
        } else if (raw && typeof raw === "object" && "action" in raw) {
          action = raw as typeof action;
        } else {
          throw new Error(
            `[Directive MultiAgent] Supervisor "${pattern.supervisor}" returned invalid output (round ${round + 1}). ` +
            `Expected { action: "delegate"|"complete", worker?, workerInput? }`
          );
        }

        if (action.action === "complete" || !action.worker) {
          break;
        }

        if (!pattern.workers.includes(action.worker)) {
          const available = pattern.workers.join(", ");

          throw new Error(
            `[Directive MultiAgent] Supervisor delegated to unknown worker "${action.worker}". Available workers: ${available}`
          );
        }

        const workerResult = await runSingleAgent(
          action.worker,
          action.workerInput ?? ""
        );
        workerResults.push(workerResult);

        supervisorResult = await runSingleAgent(
          pattern.supervisor,
          `Worker ${action.worker} completed with result: ${safeStringify(workerResult.output)}`
        );
      }

      return pattern.extract
        ? pattern.extract(supervisorResult.output, workerResults)
        : (supervisorResult.output as T);
    } catch (error) {
      patternError = error instanceof Error ? error : new Error(String(error));
      throw error;
    } finally {
      if (patternId) {
        fireHook("onPatternComplete",{
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
    patternId?: string
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

    const context: DagExecutionContext = {
      input,
      outputs: Object.create(null),
      statuses: Object.create(null),
      errors: Object.create(null),
      results: Object.create(null),
    };

    // Initialize all nodes as pending
    for (const nodeId of Object.keys(pattern.nodes)) {
      context.statuses[nodeId] = "pending";
    }

    const onNodeError = pattern.onNodeError ?? "fail";
    const maxConcurrent = pattern.maxConcurrent ?? Infinity;
    const controller = new AbortController();
    let graphTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let patternError: Error | undefined;

    if (pattern.timeout) {
      graphTimeoutId = setTimeout(() => controller.abort(), pattern.timeout);
    }

    try {
      // Mark root nodes as ready
      for (const [nodeId, node] of Object.entries(pattern.nodes)) {
        if (!node.deps || node.deps.length === 0) {
          context.statuses[nodeId] = "ready";
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
          const terminalStatuses = onNodeError === "fail"
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
              (depId) => context.statuses[depId] === "error" || context.statuses[depId] === "skipped",
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
                });
              }
              fireHook("onDagNodeSkipped", {
                patternId: pId,
                nodeId,
                agentId: node.agent,
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
                  });
                }
                fireHook("onDagNodeSkipped", {
                  patternId: pId,
                  nodeId,
                  agentId: node.agent,
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
          });
        }
        fireHook("onDagNodeStart", {
          patternId: pId,
          nodeId,
          agentId: node.agent,
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
          nodeTimeoutId = setTimeout(() => nodeController.abort(), node.timeout);
        }

        // Forward graph-level abort
        const abortHandler = () => nodeController.abort();
        controller.signal.addEventListener("abort", abortHandler, { once: true });

        try {
          const result = await runSingleAgent(node.agent, nodeInput, {
            signal: nodeController.signal,
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
            });
          }
          fireHook("onDagNodeComplete", {
            patternId: pId,
            nodeId,
            agentId: node.agent,
            durationMs: Date.now() - nodeStartTime,
            timestamp: Date.now(),
          });
        } catch (error) {
          context.statuses[nodeId] = "error";
          context.errors[nodeId] = error instanceof Error ? error.message : String(error);

          if (timeline) {
            timeline.record({
              type: "dag_node_update",
              timestamp: Date.now(),
              snapshotId: null,
              nodeId,
              status: "error",
            });
          }
          fireHook("onDagNodeError", {
            patternId: pId,
            nodeId,
            agentId: node.agent,
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
          (s) => s === "pending" || s === "running" || s === "ready"
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
    patternId?: string
  ): Promise<T> {
    const patternStartTime = Date.now();
    const pId = patternId ?? "__inline_reflect";
    const maxIterations = pattern.maxIterations ?? 2;

    if (maxIterations < 1) {
      throw new Error("[Directive MultiAgent] Reflect pattern maxIterations must be >= 1");
    }
    if (debug && maxIterations > 3) {
      console.warn("[Directive MultiAgent] Reflection loops > 3 iterations rarely improve quality. Consider reducing maxIterations.");
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
      effectiveSignal.addEventListener("abort", reflectExternalOnAbort, { once: true });
      effectiveSignal = controller.signal;
    }

    const parseEvaluation = pattern.parseEvaluation ?? ((output: unknown): ReflectionEvaluation => {
      if (typeof output === "string") {
        try {
          return JSON.parse(output);
        } catch {
          return { passed: false, feedback: `Evaluator returned unparseable output: ${output.slice(0, 200)}` };
        }
      }
      if (output && typeof output === "object" && "passed" in output) {
        return output as ReflectionEvaluation;
      }

      return { passed: false, feedback: "Evaluator returned invalid format" };
    });
    const buildRetryInput = pattern.buildRetryInput ?? (
      (inp: string, feedback: string, _iteration: number) =>
        `${inp}\n\nFeedback on your previous response:\n${feedback}\n\nPlease improve your response.`
    );

    if (patternId) {
      fireHook("onPatternStart", {
        patternId: pId,
        patternType: "reflect",
        input,
        timestamp: patternStartTime,
      });
    }

    let patternError: Error | undefined;
    let lastProducerResult: RunResult<unknown> | undefined;
    const history: ReflectIterationRecord[] = [];
    // Track per-iteration producer outputs for accept-best
    const producerOutputs: Array<{ output: unknown; score?: number }> = [];

    try {
      let effectiveInput = input;

      for (let iteration = 0; iteration < maxIterations; iteration++) {
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
        const producerResult = await runSingleAgent(pattern.agent, effectiveInput, { signal: effectiveSignal });
        lastProducerResult = producerResult;
        const producerOutput = typeof producerResult.output === "string"
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
        const evaluatorResult = await runSingleAgent(pattern.evaluator, producerOutput, { signal: effectiveSignal });
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
        if (!evaluation.passed && pattern.threshold != null && evaluation.score != null) {
          const thresholdValue = typeof pattern.threshold === "function"
            ? pattern.threshold(iteration)
            : pattern.threshold;
          if (evaluation.score >= thresholdValue) {
            evaluation = { ...evaluation, passed: true };
          }
        }

        const iterDurationMs = Date.now() - iterStart;

        // Store producer output for accept-best
        producerOutputs.push({ output: producerResult.output, score: evaluation.score });

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
              console.warn("[Directive MultiAgent] onIteration callback threw:", cbError);
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
            effectiveInput = buildRetryInput(input, evaluation.feedback, iteration);
          } catch (retryError) {
            if (debug) {
              console.warn("[Directive MultiAgent] buildRetryInput threw, using default format:", retryError);
            }
            effectiveInput = `${input}\n\nFeedback on your previous response:\n${evaluation.feedback}\n\nPlease improve your response.`;
          }
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
          console.warn("[Directive MultiAgent] accept-best exhaustion strategy used but no iterations returned scores. Falling back to last output.");
        }
        let bestIdx = producerOutputs.length - 1;
        let bestScore = -Infinity;
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
    patternId?: string
  ): Promise<RaceResult<T>> {
    if (pattern.agents.length === 0) {
      throw new Error("[Directive MultiAgent] Race pattern requires at least one agent");
    }

    const minSuccess = pattern.minSuccess ?? 1;

    if (!Number.isInteger(minSuccess) || minSuccess < 1) {
      throw new Error("[Directive MultiAgent] Race pattern minSuccess must be a positive integer");
    }
    if (minSuccess > pattern.agents.length) {
      throw new Error(
        `[Directive MultiAgent] Race pattern minSuccess (${minSuccess}) exceeds agent count (${pattern.agents.length})`
      );
    }

    // Validate agent IDs
    for (const agentId of pattern.agents) {
      if (!agents[agentId]) {
        throw new Error(`[Directive MultiAgent] Race: unknown agent "${agentId}"`);
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
        pattern.signal.addEventListener("abort", raceExternalOnAbort, { once: true });
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
        agents: pattern.agents,
      });
    }

    if (pattern.timeout) {
      raceTimeoutId = setTimeout(() => controller.abort(), pattern.timeout);
    }

    let patternError: Error | undefined;
    const agentErrors: Record<string, string> = Object.create(null);
    const startedAgents = [...pattern.agents];

    try {
      // Start all agents, collecting promises
      type RaceEntry = { agentId: string; promise: Promise<{ agentId: string; result: RunResult<unknown> }> };
      const entries: RaceEntry[] = pattern.agents.map((agentId) => ({
        agentId,
        // Output guardrails are already checked inside runSingleAgent
        promise: runSingleAgent(agentId, input, { signal: controller.signal })
          .then((result) => ({ agentId, result })),
      }));

      // Custom race: track settled count, await all promises for cleanup
      const allPromises = entries.map((e) => e.promise.catch(() => undefined));

      const collectedResults: Array<{ agentId: string; result: RunResult<unknown> }> = [];

      const result = await new Promise<Array<{ agentId: string; result: RunResult<unknown> }>>((resolve, reject) => {
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
              agentErrors[entry.agentId] = error instanceof Error ? error.message : String(error);
              settledCount++;

              if (resolved) {
                return;
              }

              const failedCount = Object.keys(agentErrors).length;
              const maxPossibleSuccesses = collectedResults.length + (entries.length - settledCount);

              // All agents failed
              if (settledCount === entries.length && failedCount === entries.length) {
                resolved = true;
                reject(new Error(
                  `[Directive MultiAgent] Race: all ${entries.length} agents failed.\n` +
                  Object.entries(agentErrors)
                    .map(([id, msg]) => `  - ${id}: ${msg}`)
                    .join("\n")
                ));
              } else if (maxPossibleSuccesses < minSuccess) {
                // Impossible to reach minSuccess — some succeeded but not enough can
                resolved = true;
                reject(new Error(
                  `[Directive MultiAgent] Race: cannot reach minSuccess (${minSuccess}). ` +
                  `${failedCount} agent(s) failed.\n` +
                  Object.entries(agentErrors)
                    .map(([id, msg]) => `  - ${id}: ${msg}`)
                    .join("\n")
                ));
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
      const cancelledIds = startedAgents.filter((id) => !successIds.has(id) && !(id in agentErrors));

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
      const allResults = minSuccess > 1
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
  ): Promise<DebateResult<T>> {
    const { agents: debateAgents, evaluator, maxRounds = 2, extract, parseJudgement } = pattern;

    if (debateAgents.length < 2) {
      throw new Error("[Directive MultiAgent] debate requires at least 2 agents");
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
      effectiveSignal.addEventListener("abort", externalOnAbort, { once: true });
      effectiveSignal = ctrl.signal;
    }

    const defaultParseJudgement = (output: unknown): { winnerId: string; feedback?: string; score?: number } => {
      if (typeof output === "string") {
        try {
          const parsed = JSON.parse(output);
          if (parsed && typeof parsed === "object" && typeof parsed.winnerId === "string") {
            return parsed;
          }

          if (debug) {
            console.warn("[Directive MultiAgent] defaultParseJudgement: parsed JSON missing winnerId, falling back to first agent");
          }

          return { winnerId: debateAgents[0]! };
        } catch {
          if (debug) {
            console.warn("[Directive MultiAgent] defaultParseJudgement: output is not valid JSON, falling back to first agent");
          }

          return { winnerId: debateAgents[0]! };
        }
      }
      if (output && typeof output === "object" && "winnerId" in output && typeof (output as Record<string, unknown>).winnerId === "string") {
        return output as { winnerId: string; feedback?: string; score?: number };
      }

      if (debug) {
        console.warn("[Directive MultiAgent] defaultParseJudgement: unrecognized output format, falling back to first agent");
      }

      return { winnerId: debateAgents[0]! };
    };

    const parseJudge = parseJudgement ?? defaultParseJudgement;
    const rounds: DebateResult<T>["rounds"] = [];
    let currentInput = input;
    let lastWinnerId = debateAgents[0]!;
    let lastWinnerOutput: unknown = undefined;

    const pId = patternId ?? "__inline_debate";
    const patternStartTime = Date.now();

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
      for (let round = 0; round < maxRounds; round++) {
        if (effectiveSignal?.aborted) {
          break;
        }

        const proposalPromises = debateAgents.map(async (agentId) => {
          const result = await runSingleAgent(agentId, currentInput, { signal: effectiveSignal });

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

        const evalResult = await runSingleAgent(evaluator, evalInput, { signal: effectiveSignal });
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
        const winnerProposal = proposals.find((p) => p.agentId === judgement.winnerId);
        lastWinnerOutput = winnerProposal?.output ?? proposals[0]!.output;

        if (round < maxRounds - 1 && judgement.feedback) {
          currentInput = `Previous round feedback: ${judgement.feedback}\n\nOriginal task: ${input}`;
        }
      }

      if (rounds.length === 0) {
        throw new Error("[Directive MultiAgent] Debate aborted before any round completed");
      }

      const result = extract ? extract(lastWinnerOutput) : lastWinnerOutput as T;

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

    onDerivedChange(callback: (id: string, value: unknown) => void): () => void {
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

        throw new Error(`[Directive MultiAgent] Unknown pattern "${patternId}". Available patterns: ${available}`);
      }

      const patternStartTime = Date.now();
      if (timeline) {
        timeline.record({
          type: "pattern_start",
          timestamp: patternStartTime,
          snapshotId: null,
          patternId,
          patternType: pattern.type,
        });
      }

      let patternError: Error | undefined;
      try {
        switch (pattern.type) {
          case "parallel":
            return await runParallelPattern(pattern as ParallelPattern<T>, input, patternId);
          case "sequential":
            return await runSequentialPattern(pattern as SequentialPattern<T>, input, patternId);
          case "supervisor":
            return await runSupervisorPattern(pattern as SupervisorPattern<T>, input, patternId);
          case "dag":
            return await runDagPattern(pattern as DagPattern<T>, input, patternId);
          case "reflect":
            return await runReflectPattern(pattern as ReflectPattern<T>, input, patternId);
          case "race": {
            const raceResult = await runRacePattern(pattern as RacePattern<T>, input, patternId);

            return raceResult.result;
          }
          case "debate": {
            const debatePattern = pattern as DebatePattern<T>;
            const debateResult = await runDebateInternal<T>(debatePattern, input, patternId);

            return debateResult.result;
          }
          default:
            throw new Error(`[Directive MultiAgent] Unknown pattern type: ${(pattern as { type: string }).type}`);
        }
      } catch (error) {
        patternError = error instanceof Error ? error : new Error(String(error));
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
      options?: { minSuccess?: number; timeout?: number }
    ): Promise<T> {
      assertNotDisposed();
      const inputArray = Array.isArray(inputs)
        ? inputs
        : agentIds.map(() => inputs);

      if (inputArray.length !== agentIds.length) {
        throw new Error(
          `[Directive MultiAgent] Input count (${inputArray.length}) must match agent count (${agentIds.length})`
        );
      }

      const controller = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      if (options?.timeout) {
        timeoutId = setTimeout(() => controller.abort(), options.timeout);
      }

      try {
        const promises = agentIds.map((agentId, i) =>
          runSingleAgent(agentId, inputArray[i]!, { signal: controller.signal }).catch((error) => {
            if (options?.minSuccess !== undefined) {
              return null;
            }

            throw error;
          })
        );

        const results = await Promise.all(promises);
        const successResults = results.filter((r): r is RunResult<unknown> => r !== null);

        if (options?.minSuccess !== undefined && successResults.length < options.minSuccess) {
          const failCount = results.length - successResults.length;

          throw new Error(
            `[Directive MultiAgent] runParallel: Only ${successResults.length}/${agentIds.length} agents succeeded ` +
            `(minimum required: ${options.minSuccess}, failed: ${failCount})`
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
      opts?: { transform?: (output: unknown, agentId: string, index: number) => string }
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
      context?: Record<string, unknown>
    ): Promise<RunResult<unknown>> {
      assertNotDisposed();

      if (!agents[fromAgent]) {
        const available = Object.keys(agents).join(", ") || "(none)";

        throw new Error(`[Directive MultiAgent] Handoff source agent "${fromAgent}" not found. Registered: ${available}`);
      }
      if (!agents[toAgent]) {
        const available = Object.keys(agents).join(", ") || "(none)";

        throw new Error(`[Directive MultiAgent] Handoff target agent "${toAgent}" not found. Registered: ${available}`);
      }

      // ---- Breakpoint: pre_handoff ----
      {
        const bpResult = await handleBreakpoint("pre_handoff", fromAgent, agents[fromAgent]!.agent.name, input, undefined, {
          handoff: { fromAgent, toAgent },
        });
        if (bpResult.skip) {
          return { output: undefined as unknown, messages: [], toolCalls: [], totalTokens: 0 };
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
      try { onHandoff?.(request); } catch (e) {
        if (debug) { console.debug("[Directive MultiAgent] onHandoff threw:", e); }
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
          targetMemory.addMessages([{
            role: "system",
            content: `[Handoff from ${fromAgent}] Context: ${contextSummary}`,
          }]);
        } catch (memoryError) {
          if (debug) { console.debug("[Directive MultiAgent] Handoff addMessages failed:", memoryError); }
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
        try { onHandoffComplete?.(handoffResult); } catch (e) {
          if (debug) { console.debug("[Directive MultiAgent] onHandoffComplete threw:", e); }
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
            pending: currentApproval.pending.filter((r: ApprovalRequest) => r.id !== requestId),
            approved: approved.length > MAX_APPROVAL_HISTORY ? approved.slice(-MAX_APPROVAL_HISTORY) : approved,
          });
        });

        return;
      }

      if (debug) {
        console.debug(`[Directive MultiAgent] approve() ignored: no pending request "${requestId}"`);
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
            console.debug(`[Directive MultiAgent] Request ${requestId} rejected: ${reason}`);
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
            pending: currentApproval.pending.filter((r: ApprovalRequest) => r.id !== requestId),
            rejected: rejected.length > MAX_REJECTION_HISTORY ? rejected.slice(-MAX_REJECTION_HISTORY) : rejected,
          });
        });

        return;
      }

      if (debug) {
        console.debug(`[Directive MultiAgent] reject() ignored: no pending request "${requestId}"`);
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
        Object.entries(agentStates).map(([k, v]) => [k, { ...v }])
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
      const allIdle = () => pendingRuns === 0 && Object.values(agentStates).every(
        (s) => s.status === "idle" || s.status === "completed" || s.status === "error"
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
            reject(new Error(`[Directive MultiAgent] waitForIdle timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }
      });
    },

    /** Alias for runAgent */
    run<T>(agentId: string, input: string, options?: MultiAgentRunCallOptions): Promise<RunResult<T>> {
      return runSingleAgent<T>(agentId, input, options);
    },

    /** Alias for runAgentStream */
    runStream<T>(agentId: string, input: string, options?: { signal?: AbortSignal }): OrchestratorStreamResult<T> {
      return runAgentStreamImpl<T>(agentId, input, options);
    },

    registerAgent(agentId: string, registration: AgentRegistration): void {
      assertNotDisposed();
      if (RESERVED_IDS.has(agentId)) {
        throw new Error(`[Directive MultiAgent] Agent ID "${agentId}" is reserved and cannot be used`);
      }
      if (agents[agentId]) {
        throw new Error(`[Directive MultiAgent] Agent "${agentId}" is already registered. Unregister first.`);
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
              const combinedFacts = { ...context.facts, ...state } as unknown as Record<string, unknown> & OrchestratorState;

              const resolverContext: OrchestratorResolverContext<Record<string, unknown>> = {
                facts: combinedFacts,
                runAgent: async <T>(agent: AgentLike, input: string, opts?: RunOptions) => {
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
        resolvers: Object.keys(perAgentResolvers).length > 0 ? (perAgentResolvers as any) : undefined,
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
        console.debug(`[Directive MultiAgent] Registered agent "${agentId}" (${registration.agent.name})`);
      }

      recomputeDerivations();
    },

    unregisterAgent(agentId: string): void {
      assertNotDisposed();
      if (!agents[agentId]) {
        throw new Error(`[Directive MultiAgent] Agent "${agentId}" is not registered`);
      }

      const state = agentStates[agentId];
      if (state?.status === "running") {
        throw new Error(`[Directive MultiAgent] Cannot unregister agent "${agentId}" while it is running`);
      }

      // Warn about orphaned patterns referencing this agent
      for (const [patternId, pattern] of Object.entries(patterns)) {
        let referencedAgents: string[];
        switch (pattern.type) {
          case "supervisor":
            referencedAgents = [pattern.supervisor, ...pattern.workers];
            break;
          case "dag":
            referencedAgents = Object.values(pattern.nodes).map((n) => n.agent);
            break;
          case "reflect":
            referencedAgents = [pattern.agent, pattern.evaluator];
            break;
          case "parallel":
          case "sequential":
          case "race":
            referencedAgents = pattern.agents;
            break;
          case "debate":
            referencedAgents = [...(pattern as DebatePattern).agents, (pattern as DebatePattern).evaluator];
            break;
          default:
            referencedAgents = [];
        }
        if (referencedAgents.includes(agentId)) {
          console.warn(
            `[Directive MultiAgent] Warning: Pattern "${patternId}" references unregistered agent "${agentId}"`
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
          setApprovalState(agentFacts, { pending: [], approved: [], rejected: [] });
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
          setApprovalState(agentFacts, { pending: [], approved: [], rejected: [] });
          setConversation(agentFacts, []);
          setToolCalls(agentFacts, []);
          setBreakpointState(agentFacts, createInitialBreakpointState());
        });
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
          setBridgeFact(coordFacts, SCRATCHPAD_KEY, { ...scratchpadConfig.init });
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

      // Ensure no agents are running
      for (const [id, s] of Object.entries(agentStates)) {
        if (s.status === "running") {
          throw new Error(`[Directive MultiAgent] Cannot checkpoint while agent "${id}" is running`);
        }
      }
      if (!(system as any).debug?.export) {
        throw new Error(
          "[Directive MultiAgent] Checkpointing requires debug mode. Set `debug: true` in orchestrator options."
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
            Object.entries(agentStates).map(([k, v]) => [k, structuredClone(v)])
          ),
          handoffCounter,
          pendingHandoffs: [...pendingHandoffs],
          handoffResults: [...handoffResults],
          roundRobinCounters: roundRobinCounters
            ? Object.fromEntries(roundRobinCounters)
            : null,
        } satisfies MultiAgentCheckpointLocalState,
        memoryExport: sharedMemory ? (sharedMemory as any).export?.() ?? null : null,
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
        throw new Error(`[Directive MultiAgent] Expected multi-agent checkpoint, got "${cp.orchestratorType}"`);
      }

      // Restore system state
      if (!(system as any).debug?.import) {
        throw new Error(
          "[Directive MultiAgent] Restoring a checkpoint requires debug mode. Set `debug: true` in orchestrator options."
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

      // Recompute derivations from restored state
      recomputeDerivations();
    },

    // ---- Parallel Streaming ----

    runParallelStream<T>(
      agentIds: string[],
      inputs: string | string[],
      merge: (results: RunResult<unknown>[]) => T | Promise<T>,
      opts?: { minSuccess?: number; timeout?: number; signal?: AbortSignal }
    ): MultiplexedStreamResult<T> {
      assertNotDisposed();

      const inputArray = Array.isArray(inputs)
        ? inputs
        : agentIds.map(() => inputs);

      if (inputArray.length !== agentIds.length) {
        throw new Error(
          `[Directive MultiAgent] Input count (${inputArray.length}) must match agent count (${agentIds.length})`
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
      const taggedSources = perAgentStreams.map(({ agentId, streamResult }) => ({
        agentId,
        stream: streamResult.stream,
      }));

      const { stream: mergedStream, getDroppedCount } = mergeTaggedStreams(taggedSources);

      // Clean up external abort listener when done
      let externalOnAbort: (() => void) | undefined;
      if (opts?.signal) {
        externalOnAbort = () => controller.abort();
        opts.signal.addEventListener("abort", externalOnAbort, { once: true });
      }

      // Collect all results
      const resultsPromise = Promise.allSettled(
        perAgentStreams.map(({ streamResult }) => streamResult.result)
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

        if (opts?.minSuccess !== undefined && successes.length < opts.minSuccess) {
          throw new Error(
            `[Directive MultiAgent] runParallelStream: Only ${successes.length}/${agentIds.length} agents succeeded ` +
            `(minimum required: ${opts.minSuccess})`
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
      raceOpts?: { extract?: (result: RunResult<unknown>) => T; timeout?: number; minSuccess?: number; signal?: AbortSignal }
    ): Promise<RaceResult<T>> {
      assertNotDisposed();

      const pattern: RacePattern<T> = {
        type: "race",
        agents: agentIds,
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
        buildRetryInput?: (input: string, feedback: string, iteration: number) => string;
        extract?: (output: unknown) => T;
        onExhausted?: "accept-last" | "accept-best" | "throw";
        onIteration?: (record: ReflectIterationRecord) => void;
        signal?: AbortSignal;
        timeout?: number;
        threshold?: number | ((iteration: number) => number);
      }
    ): Promise<{ result: T; iterations: number; history: ReflectIterationRecord[]; exhausted: boolean }> {
      assertNotDisposed();

      const pattern: ReflectPattern<T> = {
        type: "reflect",
        agent: producerId,
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

      const result = await runReflectPattern<T>(pattern, input, "__imperative_reflect");
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
        parseJudgement?: (output: unknown) => { winnerId: string; feedback?: string; score?: number };
        signal?: AbortSignal;
        timeout?: number;
      }
    ): Promise<DebateResult<T>> {
      assertNotDisposed();

      return runDebateInternal<T>(
        {
          type: "debate",
          agents: agentIds,
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

    // ---- Breakpoint Methods ----

    resumeBreakpoint(id: string, modifications?: BreakpointModifications): void {
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
              pending: currentBp.pending.filter((r: BreakpointRequest) => r.id !== id),
              resolved: resolved.length > MAX_BREAKPOINT_HISTORY ? resolved.slice(-MAX_BREAKPOINT_HISTORY) : resolved,
            });
          });

          return;
        }
      }

      if (debug) {
        console.debug(`[Directive MultiAgent] resumeBreakpoint() ignored: no pending breakpoint "${id}"`);
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
              pending: currentBp.pending.filter((r: BreakpointRequest) => r.id !== id),
              cancelled: cancelled.length > MAX_BREAKPOINT_HISTORY ? cancelled.slice(-MAX_BREAKPOINT_HISTORY) : cancelled,
            });
          });

          return;
        }
      }

      if (debug) {
        console.debug(`[Directive MultiAgent] cancelBreakpoint() ignored: no pending breakpoint "${id}"`);
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
 * @param agents - Agent IDs to run concurrently
 * @param merge - Combine all agent results into a single output
 * @param config.merge - Receives all successful RunResults (array may be shorter than agents.length when minSuccess is set). Returns the merged result.
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
 * @param agents - Agent IDs to run in order (output of each feeds into the next)
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

/**
 * Create a DAG execution pattern.
 *
 * @param nodes - Node definitions keyed by ID, each with `agent` and optional `deps`
 * @param merge - Combine DAG outputs into a single result (defaults to `context.outputs`)
 * @param options - Optional `timeout`, `maxConcurrent`, `onNodeError`
 *
 * @example
 * ```typescript
 * const researchPipeline = dag(
 *   {
 *     fetch: { agent: 'fetcher' },
 *     analyze: { agent: 'analyzer', deps: ['fetch'] },
 *     summarize: { agent: 'summarizer', deps: ['analyze'] },
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
  }
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
 * @param agent - Producer agent ID that generates output
 * @param evaluator - Evaluator agent ID that judges quality
 * @param options - Optional iteration, parsing, signal, and threshold config
 *
 * @example
 * ```typescript
 * const reviewPattern = reflect('writer', 'reviewer', { maxIterations: 2 });
 * ```
 */
export function reflect<T>(
  agent: string,
  evaluator: string,
  options?: {
    maxIterations?: number;
    parseEvaluation?: (output: unknown) => ReflectionEvaluation;
    buildRetryInput?: (input: string, feedback: string, iteration: number) => string;
    extract?: (output: unknown) => T;
    onExhausted?: "accept-last" | "accept-best" | "throw";
    onIteration?: (record: ReflectIterationRecord) => void;
    signal?: AbortSignal;
    timeout?: number;
    threshold?: number | ((iteration: number) => number);
  }
): ReflectPattern<T> {
  return {
    type: "reflect",
    agent,
    evaluator,
    ...options,
  };
}

/**
 * Create a race pattern configuration.
 *
 * @param agents - Agent IDs to race concurrently
 * @param options - Optional `extract`, `timeout`, `minSuccess`, `signal`
 *
 * @example
 * ```typescript
 * const fastest = race(['fast-model', 'smart-model'], { timeout: 5000 });
 * ```
 */
export function race<T>(
  agents: string[],
  options?: {
    extract?: (result: RunResult<unknown>) => T;
    timeout?: number;
    minSuccess?: number;
    signal?: AbortSignal;
  }
): RacePattern<T> {
  return {
    type: "race",
    agents,
    ...options,
  };
}

/**
 * Validate that a DAG has no cycles using Kahn's algorithm.
 * Throws if a cycle is detected.
 */
function validateDagAcyclic(patternId: string, nodes: Record<string, DagNode>): void {
  const nodeIds = Object.keys(nodes);

  // Validate deps reference valid node IDs
  for (const [nodeId, node] of Object.entries(nodes)) {
    for (const depId of node.deps ?? []) {
      if (!nodes[depId]) {
        throw new Error(
          `[Directive MultiAgent] DAG pattern "${patternId}": node "${nodeId}" depends on unknown node "${depId}"`
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
      `[Directive MultiAgent] DAG pattern "${patternId}": no root nodes (every node has dependencies)`
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
      `[Directive MultiAgent] DAG pattern "${patternId}": cycle detected. Visited ${visited}/${nodeIds.length} nodes.`
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
  priority?: number
): OrchestratorConstraint<Record<string, unknown>> {
  return {
    when: when as (facts: Record<string, unknown> & OrchestratorState) => boolean | Promise<boolean>,
    require: (facts: Record<string, unknown> & OrchestratorState) => {
      const selectedAgent = typeof agent === "function" ? agent(facts) : agent;
      const selectedInput = typeof input === "function" ? input(facts) : input;

      return { type: "RUN_AGENT", agent: selectedAgent, input: selectedInput } as RunAgentRequirement;
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
        : safeStringify(r.output)
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
    throw new Error("[Directive MultiAgent] No results to pick from");
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
    throw new Error("[Directive MultiAgent] composePatterns requires at least one pattern");
  }

  return async (orchestrator: MultiAgentOrchestrator, input: string): Promise<unknown> => {
    let currentInput = input;
    let lastOutput: unknown = undefined;

    for (const pattern of patterns) {
      switch (pattern.type) {
        case "parallel": {
          const parallelPattern = pattern as ParallelPattern<unknown>;
          const inputsArr = parallelPattern.agents.map(() => currentInput);
          lastOutput = await orchestrator.runParallel(
            parallelPattern.agents,
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
            seqPattern.agents,
            currentInput,
            { transform: seqPattern.transform }
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
            throw new Error("[Directive MultiAgent] supervisor maxRounds must be >= 1");
          }
          const workerResults: RunResult<unknown>[] = [];
          let supervisorResult = await orchestrator.runAgent<unknown>(
            supPattern.supervisor,
            currentInput
          );

          for (let round = 0; round < maxRounds; round++) {
            const raw = supervisorResult.output;
            let action: { action: string; worker?: string; workerInput?: string };

            if (typeof raw === "string") {
              try {
                action = JSON.parse(raw);
              } catch {
                break;
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
              action.workerInput ?? ""
            );
            workerResults.push(workerResult);

            supervisorResult = await orchestrator.runAgent(
              supPattern.supervisor,
              `Worker ${action.worker} completed with result: ${safeStringify(workerResult.output)}`
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
          if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
            console.debug("[Directive MultiAgent] composePatterns: DAG nodes executed sequentially — use runPattern() for full parallel DAG execution");
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
                const upstreamOutputs: Record<string, unknown> = Object.create(null);
                for (const depId of node.deps) {
                  if (dagContext.outputs[depId] !== undefined) {
                    upstreamOutputs[depId] = dagContext.outputs[depId];
                  }
                }
                nodeInput = JSON.stringify(upstreamOutputs);
              }
              const result = await orchestrator.runAgent(node.agent, nodeInput);
              dagContext.outputs[nodeId] = result.output;
              dagContext.results[nodeId] = result;
              dagContext.statuses[nodeId] = "completed";
            } catch (error) {
              dagContext.statuses[nodeId] = "error";
              dagContext.errors[nodeId] = error instanceof Error ? error.message : String(error);
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
          const parseEval = reflectPattern.parseEvaluation ?? ((output: unknown): ReflectionEvaluation => {
            if (typeof output === "string") {
              try { return JSON.parse(output); } catch { return { passed: false, feedback: output }; }
            }
            if (output && typeof output === "object" && "passed" in output) {
              return output as ReflectionEvaluation;
            }

            return { passed: false, feedback: "Invalid evaluator output" };
          });
          const buildInput = reflectPattern.buildRetryInput ?? (
            (inp: string, feedback: string) => `${inp}\n\nFeedback on your previous response:\n${feedback}\n\nPlease improve your response.`
          );

          let effectiveInput = currentInput;
          let producerOutput: unknown;
          for (let i = 0; i < maxIter; i++) {
            const producerResult = await orchestrator.runAgent(reflectPattern.agent, effectiveInput);
            producerOutput = producerResult.output;
            const producerStr = typeof producerOutput === "string"
              ? producerOutput
              : JSON.stringify(producerOutput);
            const evalResult = await orchestrator.runAgent(reflectPattern.evaluator, producerStr);
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
            racePattern.agents,
            currentInput,
            { extract: racePattern.extract, timeout: racePattern.timeout },
          );
          lastOutput = raceResult.result;
          break;
        }

        case "debate": {
          const debatePattern = pattern as DebatePattern<unknown>;
          const debateResult = await orchestrator.runDebate(
            debatePattern.agents,
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

        default:
          throw new Error(`[Directive MultiAgent] composePatterns: unknown pattern type "${(pattern as ExecutionPattern).type}"`);
      }

      // Convert output to string for next pattern's input
      if (lastOutput !== undefined) {
        currentInput = typeof lastOutput === "string"
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
  requiredCapabilities: string[]
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
  options?: { priority?: number; select?: (matches: string[], registry: AgentRegistry) => string }
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
      const matches = cacheGeneration !== requireGeneration && cachedMatches.length > 0
        ? (requireGeneration = cacheGeneration, cachedMatches)
        : findAgentsByCapability(registry, getCapabilities(facts));

      if (matches.length === 0) {
        throw new Error(`[Directive MultiAgent] No agent matches capabilities: ${getCapabilities(facts).join(", ")}`);
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
  /** @deprecated Use top-level `priority` and `context` instead */
  options?: SpawnOnConditionOptions;
}): OrchestratorConstraint<Record<string, unknown>> {
  const { when, agent, input, priority, context, options } = config;
  if (options && !spawnOnConditionOptionsWarned) {
    spawnOnConditionOptionsWarned = true;
    console.warn("[Directive MultiAgent] spawnOnCondition `options` is deprecated. Use top-level `priority` and `context` instead.");
  }
  const effectivePriority = priority ?? options?.priority;
  const effectiveContext = context ?? options?.context;

  return {
    when,
    require: (facts) => ({
      type: "RUN_AGENT",
      agent,
      input: input(facts),
      context: effectiveContext,
    } as RunAgentRequirement),
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
 * @param config - Debate configuration with `agents`, `evaluator`, and optional settings
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
 *       agents: ['optimist', 'pessimist'],
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
  const { agents, evaluator, maxRounds, extract, parseJudgement, signal, timeout } = config;

  if (agents.length < 2) {
    throw new Error("[Directive MultiAgent] debate requires at least 2 agents");
  }
  if (maxRounds != null && (maxRounds < 1 || !Number.isFinite(maxRounds))) {
    throw new Error("[Directive MultiAgent] debate maxRounds must be >= 1");
  }

  return {
    type: "debate",
    agents,
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
  return orchestrator.runDebate<T>(
    config.agents,
    config.evaluator,
    input,
    {
      maxRounds: config.maxRounds,
      extract: config.extract,
      parseJudgement: config.parseJudgement,
      signal: config.signal,
      timeout: config.timeout,
    },
  );
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
      const value = whenGeneration !== requireGeneration
        ? (requireGeneration = whenGeneration, lastValue)
        : ((facts.__derived as Record<string, unknown> | undefined)?.[derivationId]);

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
  agent: string;
  deps?: string[];
  timeout?: number;
  priority?: number;
}

/** JSON-safe representation of any execution pattern (all functions stripped) */
export type SerializedPattern =
  | { type: "parallel"; agents: string[]; minSuccess?: number; timeout?: number }
  | { type: "sequential"; agents: string[]; continueOnError?: boolean }
  | { type: "supervisor"; supervisor: string; workers: string[]; maxRounds?: number }
  | { type: "dag"; nodes: Record<string, SerializedDagNode>; timeout?: number; maxConcurrent?: number; onNodeError?: "fail" | "skip-downstream" | "continue" }
  | { type: "reflect"; agent: string; evaluator: string; maxIterations?: number; onExhausted?: "accept-last" | "accept-best" | "throw"; timeout?: number; threshold?: number }
  | { type: "race"; agents: string[]; timeout?: number; minSuccess?: number }
  | { type: "debate"; agents: string[]; evaluator: string; maxRounds?: number; timeout?: number };

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
 * const p = parallel({ agents: ["a", "b"], merge: (r) => r });
 * const json = patternToJSON(p);
 * // { type: "parallel", agents: ["a", "b"] }
 * localStorage.setItem("plan", JSON.stringify(json));
 * ```
 */
export function patternToJSON(pattern: ExecutionPattern<unknown>): SerializedPattern {
  switch (pattern.type) {
    case "parallel":
      return { type: "parallel", agents: pattern.agents, minSuccess: pattern.minSuccess, timeout: pattern.timeout };
    case "sequential":
      return { type: "sequential", agents: pattern.agents, continueOnError: pattern.continueOnError };
    case "supervisor":
      return { type: "supervisor", supervisor: pattern.supervisor, workers: pattern.workers, maxRounds: pattern.maxRounds };
    case "dag": {
      const nodes: Record<string, SerializedDagNode> = Object.create(null);
      for (const [id, node] of Object.entries(pattern.nodes)) {
        nodes[id] = { agent: node.agent, deps: node.deps, timeout: node.timeout, priority: node.priority };
      }

      return { type: "dag", nodes, timeout: pattern.timeout, maxConcurrent: pattern.maxConcurrent, onNodeError: pattern.onNodeError };
    }
    case "reflect":
      return {
        type: "reflect",
        agent: pattern.agent,
        evaluator: pattern.evaluator,
        maxIterations: pattern.maxIterations,
        onExhausted: pattern.onExhausted,
        timeout: pattern.timeout,
        threshold: typeof pattern.threshold === "number" ? pattern.threshold : undefined,
      };
    case "race":
      return { type: "race", agents: pattern.agents, timeout: pattern.timeout, minSuccess: pattern.minSuccess };
    case "debate":
      return { type: "debate", agents: pattern.agents, evaluator: pattern.evaluator, maxRounds: pattern.maxRounds, timeout: pattern.timeout };
  }
}

const ALLOWED_PATTERN_TYPES = new Set(["parallel", "sequential", "supervisor", "dag", "reflect", "race", "debate"]);

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
 *   const result = await orchestrator.runParallel(pattern.agents, input, pattern.merge);
 * }
 * ```
 */
export function patternFromJSON<T = unknown>(
  json: SerializedPattern,
  overrides?: Partial<ExecutionPattern<T>>,
): ExecutionPattern<T> {
  if (!json || typeof json !== "object" || !ALLOWED_PATTERN_TYPES.has((json as SerializedPattern).type)) {
    throw new Error(`[Directive] patternFromJSON: invalid or unknown pattern type "${(json as Record<string, unknown>)?.type}"`);
  }
  const safe: Record<string, unknown> = Object.create(null);
  for (const [k, v] of Object.entries(json)) {
    if (k !== "__proto__" && k !== "constructor" && k !== "prototype") {
      safe[k] = v;
    }
  }

  return { ...safe, ...overrides } as ExecutionPattern<T>;
}
