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
} from "./types.js";
import {
  GuardrailError,
  APPROVAL_KEY,
  orchestratorBridgeSchema,
} from "./types.js";
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
  getOrchestratorState,
  convertOrchestratorConstraints,
} from "./orchestrator-bridge.js";

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
  | SupervisorPattern<T>
  | DagPattern<T>;

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
  /** Maximum number of handoff results to retain (default: 1000) */
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
  /** Fires when token usage reaches this percentage of maxTokenBudget (0-1, default: 0.8) */
  budgetWarningThreshold?: number;
  /** Callback when budget warning threshold is reached */
  onBudgetWarning?: (event: { currentTokens: number; maxBudget: number; percentage: number }) => void;
  /** Plugins to attach to the underlying Directive System */
  plugins?: Plugin[];
  /** Callback for approval requests */
  onApprovalRequest?: (request: ApprovalRequest) => void;
  /** Auto-approve tool calls (default: true) */
  autoApproveToolCalls?: boolean;
  /** Approval timeout in milliseconds (default: 300000 = 5 min) */
  approvalTimeoutMs?: number;
  /** Orchestrator-level constraints */
  constraints?: Record<string, OrchestratorConstraint<Record<string, unknown>>>;
  /** Orchestrator-level resolvers */
  resolvers?: Record<string, OrchestratorResolver<Record<string, unknown>, Requirement>>;
  /** Orchestrator-level circuit breaker */
  circuitBreaker?: CircuitBreaker;
  /** Self-healing configuration for automatic agent rerouting */
  selfHealing?: MultiAgentSelfHealingConfig;
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
  /** The underlying Directive System */
  // biome-ignore lint/suspicious/noExplicitAny: System type varies per configuration
  system: System<any>;
  /** Combined facts from all agent modules + coordinator */
  facts: Record<string, unknown>;
  /** Run a single agent */
  runAgent<T>(agentId: string, input: string, options?: RunOptions): Promise<RunResult<T>>;
  /** Run an agent with streaming support */
  runAgentStream<T>(agentId: string, input: string, options?: { signal?: AbortSignal }): OrchestratorStreamResult<T>;
  /** Run an execution pattern */
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
  run<T>(agentId: string, input: string, options?: RunOptions): Promise<RunResult<T>>;
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
  const coordSchema = {
    facts: {
      __globalTokens: t.number(),
      __status: t.string(),
      __handoffs: t.array() as unknown as ReturnType<typeof t.array>,
      __handoffResults: t.array() as unknown as ReturnType<typeof t.array>,
      __budgetWarningFired: t.boolean(),
    },
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
  const coordResolvers: Record<string, any> = {};

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
    const perAgentResolvers: Record<string, any> = {};
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

  // Idle waiters — notified whenever any agent's status changes
  const idleWaiters = new Set<() => void>();
  function notifyIdleWaiters(): void {
    for (const waiter of idleWaiters) {
      waiter();
    }
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
    opts?: RunOptions
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
    opts?: RunOptions
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

      // Effective retry config: per-agent overrides orchestrator default
      const effectiveRetry = registration.retry ?? defaultAgentRetry;

      // Run agent with retry support
      const result = await executeAgentWithRetry<T>(runner, agent, processedInput, {
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

          // Check if any dep errored (for skip-downstream)
          if (onNodeError === "skip-downstream") {
            const anyDepErrored = (node.deps ?? []).some((depId) => context.statuses[depId] === "error");
            if (anyDepErrored) {
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

    runAgent: runSingleAgent,
    runAgentStream: runAgentStreamImpl,

    async runPattern<T>(patternId: string, input: string): Promise<T> {
      assertNotDisposed();

      const pattern = patterns[patternId];
      if (!pattern) {
        const available = Object.keys(patterns).join(", ") || "(none)";

        throw new Error(`[Directive MultiAgent] Unknown pattern "${patternId}". Available patterns: ${available}`);
      }

      switch (pattern.type) {
        case "parallel":
          return runParallelPattern(pattern as ParallelPattern<T>, input, patternId);
        case "sequential":
          return runSequentialPattern(pattern as SequentialPattern<T>, input, patternId);
        case "supervisor":
          return runSupervisorPattern(pattern as SupervisorPattern<T>, input, patternId);
        case "dag":
          return runDagPattern(pattern as DagPattern<T>, input, patternId);
        default:
          throw new Error(`[Directive MultiAgent] Unknown pattern type: ${(pattern as { type: string }).type}`);
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

      // Find which agent's approval state has this request
      for (const agentId of Object.keys(agents)) {
        const agentFacts = getAgentFacts(agentId);
        const approval = getApprovalState(agentFacts);
        if (approval.pending.some((r: ApprovalRequest) => r.id === requestId)) {
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
      }
      if (debug) {
        console.debug(`[Directive MultiAgent] approve() ignored: no pending request "${requestId}"`);
      }
    },

    reject(requestId: string, reason?: string): void {
      assertNotDisposed();

      for (const agentId of Object.keys(agents)) {
        const agentFacts = getAgentFacts(agentId);
        const approval = getApprovalState(agentFacts);
        if (approval.pending.some((r: ApprovalRequest) => r.id === requestId)) {
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
      return agentStates[agentId];
    },

    getAllAgentStates() {
      return { ...agentStates };
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
    run<T>(agentId: string, input: string, options?: RunOptions): Promise<RunResult<T>> {
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
      const perAgentResolvers: Record<string, any> = {};
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
      if (debug) {
        for (const [patternId, pattern] of Object.entries(patterns)) {
          const referencedAgents = pattern.type === "supervisor"
            ? [pattern.supervisor, ...pattern.workers]
            : pattern.type === "dag"
              ? Object.values(pattern.nodes).map((n) => n.agent)
              : pattern.agents;
          if (referencedAgents.includes(agentId)) {
            console.debug(
              `[Directive MultiAgent] Warning: Pattern "${patternId}" references unregistered agent "${agentId}"`
            );
          }
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
        });
      }
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
      });
    },

    dispose() {
      if (disposed) {
        return;
      }
      // Reset before marking as disposed (reset() calls assertNotDisposed())
      orchestrator.reset();
      disposed = true;
      system.destroy();
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

/**
 * Create a DAG execution pattern.
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
