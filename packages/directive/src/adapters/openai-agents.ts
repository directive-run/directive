/**
 * AI Adapter - Constraint-driven agent orchestration with guardrails
 *
 * Philosophy: "Use Directive WITH any LLM agent framework"
 * - Your framework handles LLM tool execution
 * - Directive adds safety guardrails, approval workflows, state persistence
 *
 * @example
 * ```typescript
 * import { createAgentOrchestrator } from 'directive/ai'
 *
 * const orchestrator = createAgentOrchestrator({
 *   run: myRunFn,
 *   constraints: {
 *     needsExpertReview: {
 *       when: (facts) => facts.decision.confidence < 0.7,
 *       require: { type: 'EXPERT_AGENT', query: facts.userQuery }
 *     },
 *     budgetLimit: {
 *       when: (facts) => facts.tokenUsage > 10000,
 *       require: { type: 'PAUSE_AGENTS' }
 *     }
 *   },
 *   guardrails: {
 *     input: [(data) => validatePII(data.input)],
 *     output: [(data) => checkToxicity(data.output)]
 *   }
 * })
 * ```
 */

import type {
  Requirement,
  ModuleSchema,
  Plugin,
  SingleModuleSystem,
  System,
} from "../core/types.js";
import type { AgentMemory } from "./openai-agents-memory.js";
import type { CircuitBreaker } from "./plugins/circuit-breaker.js";
import {
  setBridgeFact,
  getBridgeFact,
  createCallbackPlugin,
  requirementGuard,
} from "../core/types/adapter-utils.js";
import { createModule } from "../core/module.js";
import { createSystem } from "../core/system.js";

// ============================================================================
// Re-export all types from dedicated module
// ============================================================================

export type {
  AgentLike,
  RunResult,
  Message,
  ToolCall,
  RunFn,
  RunOptions,
  GuardrailFn,
  GuardrailContext,
  GuardrailResult,
  InputGuardrailData,
  OutputGuardrailData,
  ToolCallGuardrailData,
  GuardrailRetryConfig,
  AgentRetryConfig,
  NamedGuardrail,
  GuardrailsConfig,
  AgentState,
  ApprovalState,
  RejectedRequest,
  ApprovalRequest,
  OrchestratorConstraint,
  OrchestratorResolverContext,
  OrchestratorResolver,
  OrchestratorState,
  OrchestratorLifecycleHooks,
  GuardrailErrorCode,
  SchemaValidationResult,
  SchemaValidator,
} from "./openai-agents-types.js";

export { GuardrailError, isGuardrailError } from "./openai-agents-types.js";

import type {
  AgentLike,
  RunResult,
  Message,
  ToolCall,
  RunFn,
  RunOptions,
  GuardrailFn,
  GuardrailContext,
  GuardrailResult,
  InputGuardrailData,
  OutputGuardrailData,
  ToolCallGuardrailData,
  GuardrailRetryConfig,
  AgentRetryConfig,
  NamedGuardrail,
  GuardrailsConfig,
  AgentState,
  ApprovalState,
  RejectedRequest,
  ApprovalRequest,
  OrchestratorConstraint,
  OrchestratorResolverContext,
  OrchestratorResolver,
  OrchestratorState,
  OrchestratorLifecycleHooks,
} from "./openai-agents-types.js";

import {
  GuardrailError,
  AGENT_KEY,
  APPROVAL_KEY,
  CONVERSATION_KEY,
  TOOL_CALLS_KEY,
  orchestratorBridgeSchema,
} from "./openai-agents-types.js";

// Re-export built-in guardrails
export {
  createPIIGuardrail,
  createModerationGuardrail,
  createRateLimitGuardrail,
  createToolGuardrail,
  createOutputSchemaGuardrail,
  createOutputTypeGuardrail,
  type RateLimitGuardrail,
} from "./openai-agents-builtin-guardrails.js";

// Re-export helpers
export {
  isAgentRunning,
  hasPendingApprovals,
  estimateCost,
  createRunFn,
  createOpenAIRunFn,
  createAnthropicRunFn,
  createOllamaRunFn,
  type CreateRunFnOptions,
  type OpenAIRunFnOptions,
  type AnthropicRunFnOptions,
  type OllamaRunFnOptions,
} from "./openai-agents-helpers.js";

// ============================================================================
// Bridge Accessors
// ============================================================================

// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
function getAgentState(facts: any): AgentState {
  return getBridgeFact<AgentState>(facts, AGENT_KEY);
}

// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
function setAgentState(facts: any, state: AgentState): void {
  setBridgeFact(facts, AGENT_KEY, state);
}

// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
function getApprovalState(facts: any): ApprovalState {
  return getBridgeFact<ApprovalState>(facts, APPROVAL_KEY);
}

// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
function setApprovalState(facts: any, state: ApprovalState): void {
  setBridgeFact(facts, APPROVAL_KEY, state);
}

// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
function getConversation(facts: any): Message[] {
  return getBridgeFact<Message[]>(facts, CONVERSATION_KEY);
}

// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
function setConversation(facts: any, messages: Message[]): void {
  setBridgeFact(facts, CONVERSATION_KEY, messages);
}

// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
function getToolCalls(facts: any): ToolCall[] {
  return getBridgeFact<ToolCall[]>(facts, TOOL_CALLS_KEY);
}

// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
function setToolCalls(facts: any, toolCalls: ToolCall[]): void {
  setBridgeFact(facts, TOOL_CALLS_KEY, toolCalls);
}

/** Get full orchestrator state from facts */
// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
function getOrchestratorState(facts: any): OrchestratorState {
  return {
    agent: getAgentState(facts),
    approval: getApprovalState(facts),
    conversation: getConversation(facts),
    toolCalls: getToolCalls(facts),
  };
}

// ============================================================================
// Constraint/Resolver Converters
// ============================================================================

// biome-ignore lint/suspicious/noExplicitAny: Constraint types are complex
function convertOrchestratorConstraints<F extends Record<string, unknown>>(
  constraints: Record<string, OrchestratorConstraint<F>>,
): Record<string, any> {
  // biome-ignore lint/suspicious/noExplicitAny: Result type is complex
  const result: Record<string, any> = {};

  for (const [id, constraint] of Object.entries(constraints)) {
    result[id] = {
      priority: constraint.priority ?? 0,
      // biome-ignore lint/suspicious/noExplicitAny: Facts type varies
      when: (facts: any) => {
        const state = getOrchestratorState(facts);
        const combinedFacts = { ...facts, ...state } as unknown as F & OrchestratorState;
        return constraint.when(combinedFacts);
      },
      // biome-ignore lint/suspicious/noExplicitAny: Facts type varies
      require: (facts: any) => {
        const state = getOrchestratorState(facts);
        const combinedFacts = { ...facts, ...state } as unknown as F & OrchestratorState;
        return typeof constraint.require === "function"
          ? constraint.require(combinedFacts)
          : constraint.require;
      },
    };
  }

  return result;
}

// biome-ignore lint/suspicious/noExplicitAny: Resolver types are complex
function convertOrchestratorResolvers<F extends Record<string, unknown>>(
  resolvers: Record<string, OrchestratorResolver<F, Requirement>>,
  runAgentWithGuardrails: <T>(
    agent: AgentLike,
    input: string,
    currentFacts: F & OrchestratorState,
    opts?: RunOptions
  ) => Promise<RunResult<T>>,
  // biome-ignore lint/suspicious/noExplicitAny: Facts getter type varies
  getSystemFacts: () => any,
): Record<string, any> {
  // biome-ignore lint/suspicious/noExplicitAny: Result type is complex
  const result: Record<string, any> = {};

  for (const [id, resolver] of Object.entries(resolvers)) {
    result[id] = {
      requirement: resolver.requirement,
      key: resolver.key,
      // biome-ignore lint/suspicious/noExplicitAny: Context type varies
      resolve: async (req: Requirement, ctx: any) => {
        const state = getOrchestratorState(ctx.facts);
        const combinedFacts = { ...ctx.facts, ...state } as unknown as F & OrchestratorState;

        const orchestratorCtx: OrchestratorResolverContext<F> = {
          facts: combinedFacts,
          runAgent: async <T>(agent: AgentLike, input: string, opts?: RunOptions) => {
            return runAgentWithGuardrails<T>(
              agent,
              input,
              getCombinedFactsFromSystem(getSystemFacts()) as unknown as F & OrchestratorState,
              opts
            );
          },
          signal: ctx.signal,
        };
        await resolver.resolve(req, orchestratorCtx);
      },
    };
  }

  return result;
}

/** Helper to get combined facts from system facts */
// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
function getCombinedFactsFromSystem(facts: any): OrchestratorState {
  return getOrchestratorState(facts);
}

/** Built-in pause requirement type */
interface PauseBudgetExceededReq extends Requirement {
  type: "__PAUSE_BUDGET_EXCEEDED";
}

/** Orchestrator options */
export interface OrchestratorOptions<F extends Record<string, unknown>> {
  /** Function to run an agent */
  run?: RunFn;
  /** @deprecated Use `run` instead */
  runAgent?: RunFn;
  /** Additional facts schema */
  factsSchema?: Record<string, { _type: unknown; _validators: [] }>;
  /** Initialize additional facts */
  init?: (facts: F & OrchestratorState) => void;
  /** Constraints for orchestration */
  constraints?: Record<string, OrchestratorConstraint<F>>;
  /** Resolvers for orchestration */
  resolvers?: Record<string, OrchestratorResolver<F, Requirement>>;
  /** Guardrails */
  guardrails?: GuardrailsConfig;
  /** Callback for approval requests */
  onApprovalRequest?: (request: ApprovalRequest) => void;
  /**
   * Auto-approve tool calls
   * @default true
   */
  autoApproveToolCalls?: boolean;
  /**
   * Maximum token budget across all agent runs.
   *
   * When exceeded, agents are automatically paused with status "paused".
   * Check `facts.agent.tokenUsage` to see current usage.
   *
   * For more sophisticated cost management (per-user budgets, tiered pricing,
   * cost alerts), see the Cost Management section in the documentation.
   *
   * @example
   * ```typescript
   * const orchestrator = createAgentOrchestrator({
   *   maxTokenBudget: 10000, // Pause after 10K tokens
   * });
   *
   * // Check if paused due to budget
   * if (orchestrator.facts.agent.status === 'paused') {
   *   console.log('Budget exceeded:', orchestrator.facts.agent.tokenUsage);
   * }
   * ```
   */
  maxTokenBudget?: number;
  /** Plugins */
  plugins?: Plugin[];
  /**
   * Enable debugging
   * @default false
   */
  debug?: boolean;
  /**
   * Approval timeout in milliseconds
   * @default 300000 (5 minutes)
   */
  approvalTimeoutMs?: number;
  /** Retry configuration for agent runs (no retries if not specified) */
  agentRetry?: AgentRetryConfig;
  /** Lifecycle hooks for observability */
  hooks?: OrchestratorLifecycleHooks;
  /**
   * Optional memory instance. When provided, context messages are auto-injected
   * into agent instructions before each run, and result messages are auto-stored.
   */
  memory?: AgentMemory;
  /**
   * Optional circuit breaker. Wraps every run() call.
   * When OPEN, throws CircuitBreakerOpenError instead of calling the agent.
   */
  circuitBreaker?: CircuitBreaker;
}

/** Streaming run result from orchestrator */
export interface OrchestratorStreamResult<T = unknown> {
  /** Async iterator for streaming chunks */
  stream: AsyncIterable<OrchestratorStreamChunk>;
  /** Promise that resolves to the final result */
  result: Promise<RunResult<T>>;
  /** Abort the stream */
  abort: () => void;
}

/** Stream chunk types for orchestrator */
export type OrchestratorStreamChunk =
  | { type: "token"; data: string; tokenCount: number }
  | { type: "tool_start"; tool: string; toolCallId: string }
  | { type: "tool_end"; tool: string; toolCallId: string; result: string }
  | { type: "message"; message: Message }
  | { type: "guardrail_triggered"; guardrailName: string; reason: string; stopped: boolean }
  | { type: "approval_required"; requestId: string; toolName: string }
  | { type: "approval_resolved"; requestId: string; approved: boolean }
  | { type: "progress"; phase: string; message?: string }
  | { type: "done"; totalTokens: number; duration: number }
  | { type: "error"; error: Error };

/** Per-call options for run() */
export interface RunCallOptions {
  /** Override output guardrails for this call only. Set to [] to skip. */
  outputGuardrails?: Array<GuardrailFn<OutputGuardrailData> | NamedGuardrail<OutputGuardrailData>>;
  /** Override input guardrails for this call only. Set to [] to skip. */
  inputGuardrails?: Array<GuardrailFn<InputGuardrailData> | NamedGuardrail<InputGuardrailData>>;
  /** Signal for abort */
  signal?: AbortSignal;
}

/** Orchestrator instance */
export interface AgentOrchestrator<F extends Record<string, unknown>> {
  // biome-ignore lint/suspicious/noExplicitAny: System type varies
  system: System<any>;
  facts: F & OrchestratorState;
  /** Run an agent with guardrails. Pass options to override guardrails per-call. */
  run<T>(agent: AgentLike, input: string, options?: RunCallOptions): Promise<RunResult<T>>;
  /**
   * Run an agent with streaming support.
   * Returns an async iterator for chunks and a promise for the final result.
   *
   * @example
   * ```typescript
   * const { stream, result, abort } = orchestrator.runStream(agent, input);
   *
   * for await (const chunk of stream) {
   *   if (chunk.type === 'token') process.stdout.write(chunk.data);
   *   if (chunk.type === 'approval_required') showApprovalDialog(chunk);
   *   if (chunk.type === 'guardrail_triggered') handleGuardrail(chunk);
   * }
   *
   * const finalResult = await result;
   * ```
   */
  runStream<T>(agent: AgentLike, input: string, options?: { signal?: AbortSignal }): OrchestratorStreamResult<T>;
  /** Approve a pending request */
  approve(requestId: string): void;
  /** Reject a pending request */
  reject(requestId: string, reason?: string): void;
  /** Pause all agents */
  pause(): void;
  /** Resume agents */
  resume(): void;
  /** Reset conversation state */
  reset(): void;
  /** Dispose of the orchestrator */
  dispose(): void;
}

// ============================================================================
// Implementation
// ============================================================================

// ============================================================================
// Helper: Normalize Guardrail (internal)
// ============================================================================

/** Normalize a guardrail to a named guardrail */
function normalizeGuardrail<T>(
  guardrail: GuardrailFn<T> | NamedGuardrail<T>,
  index: number,
  type: string
): NamedGuardrail<T> {
  if (typeof guardrail === "function") {
    return {
      name: `${type}-guardrail-${index}`,
      fn: guardrail,
      critical: true,
    };
  }
  return guardrail;
}

/** Calculate delay for retry with backoff */
function calculateRetryDelay(
  attempt: number,
  config: GuardrailRetryConfig
): number {
  const { backoff = "exponential", baseDelayMs = 100, maxDelayMs = 5000 } = config;
  let delay: number;
  switch (backoff) {
    case "exponential":
      delay = baseDelayMs * Math.pow(2, attempt - 1);
      break;
    case "linear":
      delay = baseDelayMs * attempt;
      break;
    case "fixed":
    default:
      delay = baseDelayMs;
  }
  return Math.min(delay, maxDelayMs);
}

/** Execute a guardrail with retry support */
async function executeGuardrailWithRetry<T>(
  guardrail: NamedGuardrail<T>,
  data: T,
  context: GuardrailContext
): Promise<GuardrailResult> {
  const { retry } = guardrail;
  const maxAttempts = retry?.attempts ?? 1;

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await guardrail.fn(data, context);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // Only retry if we have more attempts left
      if (attempt < maxAttempts) {
        const delay = calculateRetryDelay(attempt, retry ?? {});
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  // All retries exhausted, throw the last error
  throw lastError;
}

/** Calculate delay for agent retry with backoff */
function calculateAgentRetryDelay(
  attempt: number,
  config: AgentRetryConfig
): number {
  const { backoff = "exponential", baseDelayMs = 1000, maxDelayMs = 30000 } = config;
  let delay: number;
  switch (backoff) {
    case "exponential":
      delay = baseDelayMs * Math.pow(2, attempt - 1);
      break;
    case "linear":
      delay = baseDelayMs * attempt;
      break;
    case "fixed":
    default:
      delay = baseDelayMs;
  }
  return Math.min(delay, maxDelayMs);
}

/** Execute an agent run with retry support */
async function executeAgentWithRetry<T>(
  runAgent: RunFn,
  agent: AgentLike,
  input: string,
  options: RunOptions | undefined,
  retryConfig: AgentRetryConfig | undefined
): Promise<RunResult<T>> {
  const maxAttempts = retryConfig?.attempts ?? 1;
  const isRetryable = retryConfig?.isRetryable ?? (() => true);
  const onRetry = retryConfig?.onRetry;

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await runAgent<T>(agent, input, options);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable and we have more attempts
      if (attempt < maxAttempts && isRetryable(lastError)) {
        const delay = calculateAgentRetryDelay(attempt, retryConfig ?? {});
        onRetry?.(attempt, lastError, delay);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        // Either not retryable or out of attempts
        break;
      }
    }
  }
  // All retries exhausted, throw the last error
  throw lastError;
}

/**
 * Create an orchestrator for OpenAI agents with Directive constraints.
 *
 * @example
 * ```typescript
 * import { run } from '@openai/agents'
 *
 * const orchestrator = createAgentOrchestrator({
 *   runAgent: run,
 *   constraints: {
 *     escalateToExpert: {
 *       when: (facts) => facts.agent.output?.confidence < 0.7,
 *       require: (facts) => ({
 *         type: 'RUN_EXPERT_AGENT',
 *         query: facts.agent.input,
 *       }),
 *     },
 *     budgetExceeded: {
 *       when: (facts) => facts.agent.tokenUsage > 10000,
 *       require: { type: 'PAUSE_AGENTS' },
 *     },
 *   },
 *   guardrails: {
 *     input: [
 *       async (data) => {
 *         const hasPII = await detectPII(data.input);
 *         return { passed: !hasPII, reason: hasPII ? 'Contains PII' : undefined };
 *       },
 *     ],
 *     output: [
 *       async (data) => {
 *         const isToxic = await checkToxicity(data.output);
 *         return { passed: !isToxic, reason: isToxic ? 'Toxic content' : undefined };
 *       },
 *     ],
 *   },
 * });
 *
 * // Run with guardrails and constraint-driven orchestration
 * const result = await orchestrator.run(myAgent, 'Hello, can you help me?');
 * ```
 *
 * @throws {Error} If autoApproveToolCalls is false but no onApprovalRequest callback is provided
 */
export function createAgentOrchestrator<
  F extends Record<string, unknown> = Record<string, never>
>(options: OrchestratorOptions<F>): AgentOrchestrator<F> {
  const {
    run: runOption,
    runAgent: runAgentOption,
    factsSchema = {},
    init,
    constraints = {},
    resolvers = {},
    guardrails = {},
    onApprovalRequest,
    autoApproveToolCalls = true,
    maxTokenBudget,
    plugins = [],
    debug = false,
    approvalTimeoutMs = 300000,
    agentRetry,
    hooks = {},
    memory,
    circuitBreaker,
  } = options;

  const runAgentResolved = runOption ?? runAgentOption;
  if (!runAgentResolved) {
    throw new Error("[Directive] createAgentOrchestrator requires a 'run' function.");
  }
  const runAgent: RunFn = runAgentResolved;

  // Enforce approval workflow configuration - require either auto-approve or callback
  if (!autoApproveToolCalls && !onApprovalRequest) {
    throw new Error(
      "[Directive] Invalid approval configuration: autoApproveToolCalls is false but no onApprovalRequest callback provided. " +
      "Tool calls would wait for approval indefinitely. Either:\n" +
      "  - Set autoApproveToolCalls: true to auto-approve all tool calls\n" +
      "  - Provide an onApprovalRequest callback to handle approvals programmatically"
    );
  }

  // Build schema by combining bridge schema with user-provided schema
  const combinedSchema = {
    facts: {
      ...orchestratorBridgeSchema.facts,
      ...factsSchema,
    },
    derivations: {},
    events: {},
    requirements: {},
  } satisfies ModuleSchema;

  // Forward declaration for runAgentWithGuardrails (used in resolver converter)
  let runAgentWithGuardrailsFn: <T>(
    agent: AgentLike,
    input: string,
    currentFacts: F & OrchestratorState,
    opts?: RunOptions,
    callOptions?: RunCallOptions
  ) => Promise<RunResult<T>>;

  // Forward declaration for system (used in resolver converter)
  // biome-ignore lint/suspicious/noExplicitAny: System type varies
  let system: SingleModuleSystem<any>;

  // Convert user constraints
  // biome-ignore lint/suspicious/noExplicitAny: Constraint types are complex
  const directiveConstraints: Record<string, any> =
    convertOrchestratorConstraints<F>(constraints);

  // Add built-in budget limit constraint
  if (maxTokenBudget) {
    directiveConstraints["__budgetLimit"] = {
      priority: 100, // High priority
      // biome-ignore lint/suspicious/noExplicitAny: Facts type varies
      when: (facts: any) => getAgentState(facts).tokenUsage > maxTokenBudget,
      require: { type: "__PAUSE_BUDGET_EXCEEDED" } as PauseBudgetExceededReq,
    };
  }

  // Convert user resolvers
  // biome-ignore lint/suspicious/noExplicitAny: Resolver types are complex
  const directiveResolvers: Record<string, any> =
    convertOrchestratorResolvers<F>(
      resolvers,
      (agent, input, currentFacts, opts) => runAgentWithGuardrailsFn(agent, input, currentFacts, opts),
      () => system.facts,
    );

  // Add built-in pause resolver
  directiveResolvers["__pause"] = {
    requirement: requirementGuard<PauseBudgetExceededReq>("__PAUSE_BUDGET_EXCEEDED"),
    // biome-ignore lint/suspicious/noExplicitAny: Context type varies
    resolve: async (_req: Requirement, ctx: any) => {
      const currentAgent = getAgentState(ctx.facts);
      setAgentState(ctx.facts, {
        ...currentAgent,
        status: "paused",
      });
    },
  };

  // Create callback plugin for onApprovalRequest
  const callbackPlugin = createCallbackPlugin(
    "openai-agents-callbacks",
    {}, // No requirement callbacks needed, approval is handled separately
  );

  // Create module
  // biome-ignore lint/suspicious/noExplicitAny: Bridge module uses dynamic constraints/resolvers
  const orchestratorModule = createModule("openai-agents-orchestrator", {
    schema: combinedSchema,
    init: (facts) => {
      setAgentState(facts, {
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
      setApprovalState(facts, {
        pending: [],
        approved: [],
        rejected: [],
      });
      setConversation(facts, []);
      setToolCalls(facts, []);
      if (init) {
        const state = getOrchestratorState(facts);
        const combinedFacts = { ...facts, ...state } as unknown as F & OrchestratorState;
        init(combinedFacts);
      }
    },
    constraints: directiveConstraints,
    resolvers: directiveResolvers as any,
  });

  // Create system
  system = createSystem({
    module: orchestratorModule,
    plugins: [...plugins, callbackPlugin],
    debug: debug ? { timeTravel: true } : undefined,
  });

  system.start();

  // Helper to run agent with guardrails
  async function runAgentWithGuardrails<T>(
    agent: AgentLike,
    input: string,
    _currentFacts: F & OrchestratorState,
    opts?: RunOptions,
    callOptions?: RunCallOptions
  ): Promise<RunResult<T>> {
    // Wrap in circuit breaker if configured
    if (circuitBreaker) {
      return circuitBreaker.execute(() =>
        runAgentWithGuardrailsInner<T>(agent, input, _currentFacts, opts, callOptions)
      );
    }
    return runAgentWithGuardrailsInner<T>(agent, input, _currentFacts, opts, callOptions);
  }

  async function runAgentWithGuardrailsInner<T>(
    agent: AgentLike,
    input: string,
    _currentFacts: F & OrchestratorState,
    opts?: RunOptions,
    callOptions?: RunCallOptions
  ): Promise<RunResult<T>> {
    const startTime = Date.now();

    // Inject memory context into agent instructions if memory is configured
    if (memory) {
      const contextMessages = memory.getContextMessages();
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

    // Call onAgentStart hook
    hooks.onAgentStart?.({
      agentName: agent.name,
      input,
      timestamp: startTime,
    });

    // Resolve which guardrails to use: per-call override > orchestrator defaults
    const effectiveInputGuardrails = callOptions?.inputGuardrails !== undefined
      ? callOptions.inputGuardrails
      : (guardrails.input ?? []);
    const effectiveOutputGuardrails = callOptions?.outputGuardrails !== undefined
      ? callOptions.outputGuardrails
      : (guardrails.output ?? []);

    // Run input guardrails with retry support
    const inputGuardrailsList = effectiveInputGuardrails.map((g, i) =>
      normalizeGuardrail(g, i, "input")
    );
    for (const guardrail of inputGuardrailsList) {
      const { name } = guardrail;
      const context = {
        agentName: agent.name,
        input,
        facts: system.facts.$store.toObject(),
      };
      const guardStartTime = Date.now();
      const result = await executeGuardrailWithRetry(
        guardrail,
        { input, agentName: agent.name },
        context
      );
      // Call onGuardrailCheck hook
      hooks.onGuardrailCheck?.({
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
          input,
        });
      }
      if (result.transformed !== undefined) {
        input = result.transformed as string;
      }
    }

    // Update state
    system.batch(() => {
      const currentAgent = getAgentState(system.facts);
      setAgentState(system.facts, {
        ...currentAgent,
        status: "running",
        currentAgent: agent.name,
        input,
        startedAt: Date.now(),
      });
    });

    // Run the agent with retry support
    const result = await executeAgentWithRetry<T>(runAgent, agent, input, {
      ...opts,
      signal: opts?.signal,
      onMessage: (message) => {
        const currentConversation = getConversation(system.facts);
        setConversation(system.facts, [...currentConversation, message]);
        opts?.onMessage?.(message);
      },
      onToolCall: async (toolCall) => {
        // Run tool call guardrails with retry support
        const toolCallGuardrails = (guardrails.toolCall ?? []).map((g, i) =>
          normalizeGuardrail(g, i, "toolCall")
        );
        for (const guardrail of toolCallGuardrails) {
          const { name } = guardrail;
          const context = {
            agentName: agent.name,
            input,
            facts: system.facts.$store.toObject(),
          };
          const guardStartTime = Date.now();
          const guardResult = await executeGuardrailWithRetry(
            guardrail,
            { toolCall, agentName: agent.name, input },
            context
          );
          hooks.onGuardrailCheck?.({
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
              input,
            });
          }
        }

        // Check if approval is needed
        if (!autoApproveToolCalls) {
          const approvalId = `tool-${toolCall.id}`;
          const approvalRequest: ApprovalRequest = {
            id: approvalId,
            type: "tool_call",
            agentName: agent.name,
            description: `Tool call: ${toolCall.name}`,
            data: toolCall,
            requestedAt: Date.now(),
          };

          system.batch(() => {
            const currentApproval = getApprovalState(system.facts);
            setApprovalState(system.facts, {
              ...currentApproval,
              pending: [...currentApproval.pending, approvalRequest],
            });
          });

          onApprovalRequest?.(approvalRequest);

          // Wait for approval
          await waitForApproval(approvalId);
        }

        const currentToolCalls = getToolCalls(system.facts);
        setToolCalls(system.facts, [...currentToolCalls, toolCall]);
        opts?.onToolCall?.(toolCall);
      },
    }, agentRetry ? {
      ...agentRetry,
      onRetry: (attempt, error, delayMs) => {
        agentRetry.onRetry?.(attempt, error, delayMs);
        hooks.onAgentRetry?.({
          agentName: agent.name,
          input,
          attempt,
          error,
          delayMs,
          timestamp: Date.now(),
        });
      },
    } : undefined);

    // Run output guardrails with retry support
    const outputGuardrailsList = effectiveOutputGuardrails.map((g, i) =>
      normalizeGuardrail(g, i, "output")
    );
    for (const guardrail of outputGuardrailsList) {
      const { name } = guardrail;
      const context = {
        agentName: agent.name,
        input,
        facts: system.facts.$store.toObject(),
      };
      const guardStartTime = Date.now();
      const guardResult = await executeGuardrailWithRetry(
        guardrail,
        {
          output: result.finalOutput,
          agentName: agent.name,
          input,
          messages: result.messages,
        },
        context
      );
      hooks.onGuardrailCheck?.({
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
          input,
        });
      }
      if (guardResult.transformed !== undefined) {
        (result as { finalOutput: unknown }).finalOutput = guardResult.transformed;
      }
    }

    // Update state
    system.batch(() => {
      const currentAgent = getAgentState(system.facts);
      setAgentState(system.facts, {
        ...currentAgent,
        status: "completed",
        output: result.finalOutput,
        tokenUsage: currentAgent.tokenUsage + result.totalTokens,
        turnCount: currentAgent.turnCount + result.messages.length,
        completedAt: Date.now(),
      });
    });

    // Store messages in memory if configured
    if (memory && result.messages.length > 0) {
      memory.addMessages(result.messages);
    }

    // Call onAgentComplete hook
    hooks.onAgentComplete?.({
      agentName: agent.name,
      input,
      output: result.finalOutput,
      tokenUsage: result.totalTokens,
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
    });

    return result;
  }

  // Assign the function to the forward-declared variable
  runAgentWithGuardrailsFn = runAgentWithGuardrails;

  // Wait for approval with configurable timeout
  function waitForApproval(requestId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      const unsubscribe = system.facts.$store.subscribe([APPROVAL_KEY], () => {
        const approval = getApprovalState(system.facts);
        if (approval.approved.includes(requestId)) {
          cleanup();
          unsubscribe();
          resolve();
        } else {
          const rejectedRequest = approval.rejected.find((r) => r.id === requestId);
          if (rejectedRequest) {
            cleanup();
            unsubscribe();
            const errorMsg = rejectedRequest.reason
              ? `Request ${requestId} rejected: ${rejectedRequest.reason}`
              : `Request ${requestId} rejected`;
            reject(new Error(errorMsg));
          }
        }
      });

      // Set timeout to prevent indefinite hanging (uses configured approvalTimeoutMs)
      timeoutId = setTimeout(() => {
        unsubscribe();
        const timeoutSeconds = Math.round(approvalTimeoutMs / 1000);
        reject(new Error(
          `[Directive] Approval timeout: Request ${requestId} was not approved or rejected within ${timeoutSeconds}s (${approvalTimeoutMs}ms). ` +
          `Call orchestrator.approve("${requestId}") or orchestrator.reject("${requestId}") to resolve. ` +
          `Current timeout: ${approvalTimeoutMs}ms. Configure via 'approvalTimeoutMs' option.`
        ));
      }, approvalTimeoutMs);
    });
  }

  /** Get facts as the combined type for external access */
  function getCombinedFacts(): F & OrchestratorState {
    const state = getOrchestratorState(system.facts);
    return { ...state } as unknown as F & OrchestratorState;
  }

  const orchestrator: AgentOrchestrator<F> = {
    system: system as unknown as System<any>,
    get facts() {
      return getCombinedFacts();
    },

    async run<T>(agent: AgentLike, input: string, options?: RunCallOptions): Promise<RunResult<T>> {
      return runAgentWithGuardrails<T>(agent, input, getCombinedFacts(), undefined, options);
    },

    runStream<T>(
      agent: AgentLike,
      input: string,
      options: { signal?: AbortSignal } = {}
    ): OrchestratorStreamResult<T> {
      const abortController = new AbortController();
      const chunks: OrchestratorStreamChunk[] = [];
      const waiters: Array<(chunk: OrchestratorStreamChunk | null) => void> = [];
      let closed = false;
      const startTime = Date.now();
      let tokenCount = 0;

      // Combine external abort signal
      let abortHandler: (() => void) | undefined;
      if (options.signal) {
        abortHandler = () => abortController.abort();
        options.signal.addEventListener("abort", abortHandler);
      }

      const cleanup = () => {
        if (abortHandler && options.signal) {
          options.signal.removeEventListener("abort", abortHandler);
        }
      };

      // Push a chunk to the stream
      const pushChunk = (chunk: OrchestratorStreamChunk) => {
        if (closed) return;
        const waiter = waiters.shift();
        if (waiter) {
          waiter(chunk);
        } else {
          chunks.push(chunk);
        }
      };

      // Close the stream
      const closeStream = () => {
        closed = true;
        cleanup();
        for (const waiter of waiters) {
          waiter(null);
        }
        waiters.length = 0;
      };

      // Run the agent with streaming callbacks
      const resultPromise = (async (): Promise<RunResult<T>> => {
        pushChunk({ type: "progress", phase: "starting", message: "Running input guardrails" });

        try {
          // Run input guardrails first with retry support
          let processedInput = input;
          const inputGuardrails = (guardrails.input ?? []).map((g, i) =>
            normalizeGuardrail(g, i, "input")
          );
          for (const guardrail of inputGuardrails) {
            const { name } = guardrail;
            const context = {
              agentName: agent.name,
              input: processedInput,
              facts: system.facts.$store.toObject(),
            };
            const result = await executeGuardrailWithRetry(
              guardrail,
              { input: processedInput, agentName: agent.name },
              context
            );
            if (!result.passed) {
              pushChunk({
                type: "guardrail_triggered",
                guardrailName: name,
                reason: result.reason ?? "Input validation failed",
                stopped: true,
              });
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

          pushChunk({ type: "progress", phase: "generating", message: "Starting agent" });

          // Update state
          system.batch(() => {
            const currentAgent = getAgentState(system.facts);
            setAgentState(system.facts, {
              ...currentAgent,
              status: "running",
              currentAgent: agent.name,
              input: processedInput,
              startedAt: Date.now(),
            });
          });

          // Run agent with streaming callbacks and retry support
          const result = await executeAgentWithRetry<T>(runAgent, agent, processedInput, {
            signal: abortController.signal,
            onMessage: (message) => {
              const currentConversation = getConversation(system.facts);
              setConversation(system.facts, [...currentConversation, message]);
              pushChunk({ type: "message", message });

              // Approximate token counting from content
              if (message.role === "assistant" && message.content) {
                const newTokens = Math.ceil(message.content.length / 4);
                tokenCount += newTokens;
                pushChunk({ type: "token", data: message.content, tokenCount });
              }
            },
            onToolCall: async (toolCall) => {
              pushChunk({ type: "tool_start", tool: toolCall.name, toolCallId: toolCall.id });

              // Run tool call guardrails with retry support
              const toolCallGuardrails = (guardrails.toolCall ?? []).map((g, i) =>
                normalizeGuardrail(g, i, "toolCall")
              );
              for (const guardrail of toolCallGuardrails) {
                const { name } = guardrail;
                const context = {
                  agentName: agent.name,
                  input: processedInput,
                  facts: system.facts.$store.toObject(),
                };
                const guardResult = await executeGuardrailWithRetry(
                  guardrail,
                  { toolCall, agentName: agent.name, input: processedInput },
                  context
                );
                if (!guardResult.passed) {
                  pushChunk({
                    type: "guardrail_triggered",
                    guardrailName: name,
                    reason: guardResult.reason ?? "Tool call blocked",
                    stopped: true,
                  });
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

              // Check if approval is needed
              if (!autoApproveToolCalls) {
                const approvalId = `tool-${toolCall.id}`;
                pushChunk({ type: "approval_required", requestId: approvalId, toolName: toolCall.name });

                const approvalRequest: ApprovalRequest = {
                  id: approvalId,
                  type: "tool_call",
                  agentName: agent.name,
                  description: `Tool call: ${toolCall.name}`,
                  data: toolCall,
                  requestedAt: Date.now(),
                };

                system.batch(() => {
                  const currentApproval = getApprovalState(system.facts);
                  setApprovalState(system.facts, {
                    ...currentApproval,
                    pending: [...currentApproval.pending, approvalRequest],
                  });
                });

                onApprovalRequest?.(approvalRequest);
                await waitForApproval(approvalId);
                pushChunk({ type: "approval_resolved", requestId: approvalId, approved: true });
              }

              const currentToolCalls = getToolCalls(system.facts);
              setToolCalls(system.facts, [...currentToolCalls, toolCall]);

              if (toolCall.result) {
                pushChunk({ type: "tool_end", tool: toolCall.name, toolCallId: toolCall.id, result: toolCall.result });
              }
            },
          }, agentRetry);

          // Run output guardrails
          pushChunk({ type: "progress", phase: "finishing", message: "Running output guardrails" });

          const outputGuardrails = (guardrails.output ?? []).map((g, i) =>
            normalizeGuardrail(g, i, "output")
          );
          for (const guardrail of outputGuardrails) {
            const { name } = guardrail;
            const context = {
              agentName: agent.name,
              input: processedInput,
              facts: system.facts.$store.toObject(),
            };
            const guardResult = await executeGuardrailWithRetry(
              guardrail,
              {
                output: result.finalOutput,
                agentName: agent.name,
                input: processedInput,
                messages: result.messages,
              },
              context
            );
            if (!guardResult.passed) {
              pushChunk({
                type: "guardrail_triggered",
                guardrailName: name,
                reason: guardResult.reason ?? "Output validation failed",
                stopped: true,
              });
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
              (result as { finalOutput: unknown }).finalOutput = guardResult.transformed;
            }
          }

          // Update final state
          system.batch(() => {
            const currentAgent = getAgentState(system.facts);
            setAgentState(system.facts, {
              ...currentAgent,
              status: "completed",
              output: result.finalOutput,
              tokenUsage: currentAgent.tokenUsage + result.totalTokens,
              turnCount: currentAgent.turnCount + result.messages.length,
              completedAt: Date.now(),
            });
          });

          const duration = Date.now() - startTime;
          pushChunk({ type: "done", totalTokens: result.totalTokens, duration });
          closeStream();

          return result;
        } catch (error) {
          pushChunk({ type: "error", error: error instanceof Error ? error : new Error(String(error)) });
          closeStream();
          throw error;
        }
      })();

      // Create async iterator
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

      return {
        stream,
        result: resultPromise,
        abort: () => {
          abortController.abort();
          closeStream();
        },
      };
    },

    approve(requestId: string): void {
      system.batch(() => {
        const approval = getApprovalState(system.facts);
        if (!approval.pending.some((r) => r.id === requestId)) {
          if (debug) console.debug(`[Directive] approve() ignored: no pending request "${requestId}"`);
          return;
        }
        const MAX_APPROVAL_HISTORY = 200;
        const approved = [...approval.approved, requestId];
        setApprovalState(system.facts, {
          ...approval,
          pending: approval.pending.filter((r) => r.id !== requestId),
          approved: approved.length > MAX_APPROVAL_HISTORY ? approved.slice(-MAX_APPROVAL_HISTORY) : approved,
        });
      });
    },

    reject(requestId: string, reason?: string): void {
      system.batch(() => {
        const approval = getApprovalState(system.facts);
        if (!approval.pending.some((r) => r.id === requestId)) {
          if (debug) console.debug(`[Directive] reject() ignored: no pending request "${requestId}"`);
          return;
        }
        if (reason && debug) {
          console.debug(`[Directive] Request ${requestId} rejected: ${reason}`);
        }
        const rejectedRequest: RejectedRequest = {
          id: requestId,
          reason,
          rejectedAt: Date.now(),
        };
        const MAX_REJECTION_HISTORY = 200;
        const rejected = [...approval.rejected, rejectedRequest];
        setApprovalState(system.facts, {
          ...approval,
          pending: approval.pending.filter((r) => r.id !== requestId),
          rejected: rejected.length > MAX_REJECTION_HISTORY ? rejected.slice(-MAX_REJECTION_HISTORY) : rejected,
        });
      });
    },

    pause(): void {
      const currentAgent = getAgentState(system.facts);
      setAgentState(system.facts, {
        ...currentAgent,
        status: "paused",
      });
    },

    resume(): void {
      const agent = getAgentState(system.facts);
      if (agent.status === "paused") {
        setAgentState(system.facts, {
          ...agent,
          status: agent.currentAgent ? "running" : "idle",
        });
      }
    },

    reset(): void {
      system.batch(() => {
        setAgentState(system.facts, {
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
        setApprovalState(system.facts, {
          pending: [],
          approved: [],
          rejected: [],
        });
        setConversation(system.facts, []);
        setToolCalls(system.facts, []);
      });
    },

    dispose(): void {
      system.destroy();
    },
  };

  return orchestrator;
}

// (Built-in guardrails moved to openai-agents-builtin-guardrails.ts)

// (Helper functions moved to openai-agents-helpers.ts)

// (Cost helpers + errors moved to openai-agents-helpers.ts + openai-agents-types.ts)

// ============================================================================
// Builder Pattern
// ============================================================================

/** Builder for type-safe orchestrator configuration */
export interface OrchestratorBuilder<F extends Record<string, unknown>> {
  /** Add a constraint */
  withConstraint<K extends string>(
    id: K,
    constraint: OrchestratorConstraint<F>
  ): OrchestratorBuilder<F>;

  /** Add a resolver */
  withResolver<R extends Requirement>(
    id: string,
    resolver: OrchestratorResolver<F, R>
  ): OrchestratorBuilder<F>;

  /** Add an input guardrail */
  withInputGuardrail(
    nameOrGuardrail: string | NamedGuardrail<InputGuardrailData>,
    fn?: GuardrailFn<InputGuardrailData>
  ): OrchestratorBuilder<F>;

  /** Add an output guardrail */
  withOutputGuardrail(
    nameOrGuardrail: string | NamedGuardrail<OutputGuardrailData>,
    fn?: GuardrailFn<OutputGuardrailData>
  ): OrchestratorBuilder<F>;

  /** Add a tool call guardrail */
  withToolCallGuardrail(
    nameOrGuardrail: string | NamedGuardrail<ToolCallGuardrailData>,
    fn?: GuardrailFn<ToolCallGuardrailData>
  ): OrchestratorBuilder<F>;

  /** Add a plugin */
  withPlugin(plugin: Plugin): OrchestratorBuilder<F>;

  /** Set memory instance for auto context injection and message storage */
  withMemory(memory: AgentMemory): OrchestratorBuilder<F>;

  /** Set circuit breaker to wrap all run() calls */
  withCircuitBreaker(cb: CircuitBreaker): OrchestratorBuilder<F>;

  /** Set max token budget */
  withBudget(maxTokens: number): OrchestratorBuilder<F>;

  /** Enable debug mode */
  withDebug(enabled?: boolean): OrchestratorBuilder<F>;

  /** Build the orchestrator */
  build(options: {
    runAgent: RunFn;
    autoApproveToolCalls?: boolean;
    onApprovalRequest?: (request: ApprovalRequest) => void;
  }): AgentOrchestrator<F>;
}

/**
 * Create a type-safe orchestrator builder.
 *
 * @example
 * ```typescript
 * const orchestrator = createOrchestratorBuilder<MyFacts>()
 *   .withConstraint('budget', {
 *     when: (facts) => facts.cost > 100,
 *     require: { type: 'PAUSE' },
 *   })
 *   .withInputGuardrail('pii', createPIIGuardrail())
 *   .withOutputGuardrail('toxicity', createModerationGuardrail({ ... }))
 *   .withBudget(10000)
 *   .withDebug()
 *   .build({ runAgent: run });
 * ```
 */
export function createOrchestratorBuilder<
  F extends Record<string, unknown> = Record<string, never>
>(): OrchestratorBuilder<F> {
  const constraints: Record<string, OrchestratorConstraint<F>> = {};
  const resolvers: Record<string, OrchestratorResolver<F, Requirement>> = {};
  const inputGuardrails: NamedGuardrail<InputGuardrailData>[] = [];
  const outputGuardrails: NamedGuardrail<OutputGuardrailData>[] = [];
  const toolCallGuardrails: NamedGuardrail<ToolCallGuardrailData>[] = [];
  const plugins: Plugin[] = [];
  let maxTokenBudget: number | undefined;
  let debug = false;
  let memoryInstance: AgentMemory | undefined;
  let circuitBreakerInstance: CircuitBreaker | undefined;

  const builder: OrchestratorBuilder<F> = {
    withConstraint(id, constraint) {
      constraints[id] = constraint;
      return builder;
    },

    withResolver(id, resolver) {
      resolvers[id] = resolver as unknown as OrchestratorResolver<F, Requirement>;
      return builder;
    },

    withInputGuardrail(nameOrGuardrail, fn) {
      if (typeof nameOrGuardrail === "string" && fn) {
        inputGuardrails.push({ name: nameOrGuardrail, fn });
      } else if (typeof nameOrGuardrail === "object") {
        inputGuardrails.push(nameOrGuardrail);
      }
      return builder;
    },

    withOutputGuardrail(nameOrGuardrail, fn) {
      if (typeof nameOrGuardrail === "string" && fn) {
        outputGuardrails.push({ name: nameOrGuardrail, fn });
      } else if (typeof nameOrGuardrail === "object") {
        outputGuardrails.push(nameOrGuardrail);
      }
      return builder;
    },

    withToolCallGuardrail(nameOrGuardrail, fn) {
      if (typeof nameOrGuardrail === "string" && fn) {
        toolCallGuardrails.push({ name: nameOrGuardrail, fn });
      } else if (typeof nameOrGuardrail === "object") {
        toolCallGuardrails.push(nameOrGuardrail);
      }
      return builder;
    },

    withPlugin(plugin) {
      plugins.push(plugin);
      return builder;
    },

    withMemory(mem) {
      memoryInstance = mem;
      return builder;
    },

    withCircuitBreaker(cb) {
      circuitBreakerInstance = cb;
      return builder;
    },

    withBudget(maxTokens) {
      maxTokenBudget = maxTokens;
      return builder;
    },

    withDebug(enabled = true) {
      debug = enabled;
      return builder;
    },

    build(options) {
      return createAgentOrchestrator<F>({
        runAgent: options.runAgent,
        autoApproveToolCalls: options.autoApproveToolCalls,
        onApprovalRequest: options.onApprovalRequest,
        constraints,
        resolvers,
        guardrails: {
          input: inputGuardrails,
          output: outputGuardrails,
          toolCall: toolCallGuardrails,
        },
        plugins,
        maxTokenBudget,
        debug,
        memory: memoryInstance,
        circuitBreaker: circuitBreakerInstance,
      });
    },
  };

  return builder;
}

// (createRunFn moved to openai-agents-helpers.ts)

// ============================================================================
// Re-exports from Sub-modules
// ============================================================================

// Memory system
export {
  createAgentMemory,
  createSlidingWindowStrategy,
  createTokenBasedStrategy,
  createHybridStrategy,
  createTruncationSummarizer,
  createKeyPointsSummarizer,
  createLLMSummarizer,
  type AgentMemory,
  type AgentMemoryConfig,
  type MemoryState,
  type MemoryManageResult,
  type MemoryStrategy,
  type MemoryStrategyConfig,
  type MemoryStrategyResult,
  type MessageSummarizer,
} from "./openai-agents-memory.js";

// Streaming utilities
export {
  createStreamingRunner,
  createLengthStreamingGuardrail,
  createPatternStreamingGuardrail,
  createToxicityStreamingGuardrail,
  combineStreamingGuardrails,
  adaptOutputGuardrail,
  collectTokens,
  tapStream,
  filterStream,
  mapStream,
  type StreamChunk,
  type TokenChunk,
  type ToolStartChunk,
  type ToolEndChunk,
  type MessageChunk,
  type GuardrailTriggeredChunk,
  type ProgressChunk,
  type DoneChunk,
  type ErrorChunk,
  type StreamRunOptions,
  type StreamRunFn,
  type StreamingRunResult,
  type StreamingGuardrail,
  type StreamingGuardrailResult,
  type BackpressureStrategy,
} from "./openai-agents-streaming.js";

// Multi-agent orchestration
export {
  createMultiAgentOrchestrator,
  Semaphore,
  parallel,
  sequential,
  supervisor,
  selectAgent,
  runAgentRequirement,
  concatResults,
  pickBestResult,
  collectOutputs,
  aggregateTokens,
  type MultiAgentOrchestrator,
  type MultiAgentOrchestratorOptions,
  type MultiAgentState,
  type AgentRegistration,
  type AgentRegistry,
  type AgentRunState,
  type ExecutionPattern,
  type ParallelPattern,
  type SequentialPattern,
  type SupervisorPattern,
  type HandoffRequest,
  type HandoffResult,
  type AgentSelectionConstraint,
  type RunAgentRequirement,
} from "./openai-agents-multi.js";

// Agent communication
export {
  createMessageBus,
  createAgentNetwork,
  createResponder,
  createDelegator,
  createPubSub,
  type MessageBus,
  type MessageBusConfig,
  type AgentNetwork,
  type AgentNetworkConfig,
  type AgentInfo,
  type AgentMessage,
  type AgentMessageType,
  type TypedAgentMessage,
  type RequestMessage,
  type ResponseMessage,
  type DelegationMessage,
  type DelegationResultMessage,
  type QueryMessage,
  type InformMessage,
  type UpdateMessage,
  type MessageHandler,
  type Subscription,
  type MessageFilter,
} from "./openai-agents-communication.js";

// Observability
export {
  createObservability,
  createAgentMetrics,
  type ObservabilityInstance,
  type ObservabilityConfig,
  type MetricType,
  type MetricDataPoint,
  type AggregatedMetric,
  type TraceSpan,
  type AlertConfig,
  type AlertEvent,
  type DashboardData,
} from "./plugins/observability.js";

// OTLP Exporter
export {
  createOTLPExporter,
  type OTLPExporterConfig,
  type OTLPExporter,
} from "./plugins/otlp-exporter.js";

// Circuit Breaker
export {
  createCircuitBreaker,
  CircuitBreakerOpenError,
  type CircuitBreaker,
  type CircuitBreakerConfig,
  type CircuitBreakerStats,
  type CircuitState,
} from "./plugins/circuit-breaker.js";

// ANN Index
export {
  createBruteForceIndex,
  createVPTreeIndex,
  type ANNIndex,
  type ANNSearchResult,
  type VPTreeIndexConfig,
} from "./guardrails/ann-index.js";

export {
  createSemanticCache,
  createSemanticCacheGuardrail,
  createBatchedEmbedder,
  createTestEmbedder,
  createInMemoryStorage,
  type Embedding,
  type SemanticCache,
  type SemanticCacheConfig,
  type CacheEntry,
  type CacheLookupResult,
  type CacheStats,
  type SemanticCacheStorage,
  type BatchedEmbedder,
  type EmbedderFn,
} from "./guardrails/semantic-cache.js";

// Stream Channels
export {
  createStreamChannel,
  createBidirectionalStream,
  pipeThrough,
  mergeStreams,
  type StreamChannel,
  type StreamChannelConfig,
  type StreamChannelState,
  type BidirectionalStream,
} from "./openai-agents-stream-channel.js";

// Agent Stack — Composition API
export {
  createAgentStack,
  type AgentStack,
  type AgentStackConfig,
  type AgentStackState,
  type StackRunOptions,
  type StackStreamOptions,
  type StructuredRunOptions,
  type TokenStream,
  type StreamingCallbackRunFn,
} from "./openai-agents-stack.js";

// AI Bridge — Sync AgentStack state into Directive system
export { createAISyncer } from "./ai-bridge.js";
