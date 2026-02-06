/**
 * OpenAI Agents Adapter - Constraint-driven agent orchestration with guardrails
 *
 * Philosophy: "Use Directive WITH OpenAI Agents"
 * - OpenAI Agents handles LLM tool execution
 * - Directive adds safety guardrails, approval workflows, state persistence
 *
 * @example
 * ```typescript
 * import { Agent, run } from '@openai/agents'
 * import { createAgentOrchestrator } from 'directive/openai-agents'
 *
 * const orchestrator = createAgentOrchestrator({
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
import {
  setBridgeFact,
  getBridgeFact,
  createCallbackPlugin,
  requirementGuard,
} from "../core/types/adapter-utils.js";
import { createModule } from "../core/module.js";
import { createSystem } from "../core/system.js";
import { t } from "../core/facts.js";

// ============================================================================
// Types (OpenAI Agents compatible, without direct dependency)
// ============================================================================

/** Simplified Agent interface */
export interface AgentLike {
  name: string;
  instructions?: string;
  model?: string;
  tools?: unknown[];
}

/** Agent run result */
export interface RunResult<T = unknown> {
  finalOutput: T;
  messages: Message[];
  toolCalls: ToolCall[];
  totalTokens: number;
}

/** Message from agent run */
export interface Message {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolCallId?: string;
}

/** Tool call record */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  result?: string;
}

/** Run function type */
export type RunFn = <T = unknown>(
  agent: AgentLike,
  input: string,
  options?: RunOptions
) => Promise<RunResult<T>>;

/** Run options */
export interface RunOptions {
  maxTurns?: number;
  signal?: AbortSignal;
  onMessage?: (message: Message) => void;
  onToolCall?: (toolCall: ToolCall) => void;
}

// ============================================================================
// Orchestrator Types
// ============================================================================

/** Guardrail function */
export type GuardrailFn<T = unknown> = (
  data: T,
  context: GuardrailContext
) => GuardrailResult | Promise<GuardrailResult>;

/** Guardrail context */
export interface GuardrailContext {
  agentName: string;
  input: string;
  facts: Record<string, unknown>;
}

/** Guardrail result */
export interface GuardrailResult {
  passed: boolean;
  reason?: string;
  transformed?: unknown;
}

/** Input guardrail data */
export interface InputGuardrailData {
  input: string;
  agentName: string;
}

/** Output guardrail data */
export interface OutputGuardrailData {
  output: unknown;
  agentName: string;
  input: string;
  messages: Message[];
}

/** Tool call guardrail data */
export interface ToolCallGuardrailData {
  toolCall: ToolCall;
  agentName: string;
  input: string;
}

/** Retry configuration for guardrails */
export interface GuardrailRetryConfig {
  /**
   * Maximum number of attempts
   * @default 1
   */
  attempts?: number;
  /**
   * Backoff strategy
   * @default "exponential"
   */
  backoff?: "exponential" | "linear" | "fixed";
  /**
   * Base delay in ms
   * @default 100
   */
  baseDelayMs?: number;
  /**
   * Maximum delay in ms
   * @default 5000
   */
  maxDelayMs?: number;
}

/** Retry configuration for agent runs */
export interface AgentRetryConfig {
  /**
   * Maximum number of attempts
   * @default 1
   */
  attempts?: number;
  /**
   * Backoff strategy
   * @default "exponential"
   */
  backoff?: "exponential" | "linear" | "fixed";
  /**
   * Base delay in ms
   * @default 1000
   */
  baseDelayMs?: number;
  /**
   * Maximum delay in ms
   * @default 30000
   */
  maxDelayMs?: number;
  /**
   * Function to determine if an error is retryable
   * @default () => true (all errors are retryable)
   */
  isRetryable?: (error: Error) => boolean;
  /** Callback fired before each retry attempt */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

/** Named guardrail for better debugging */
export interface NamedGuardrail<T = unknown> {
  /** Unique name for debugging and error messages */
  name: string;
  /** The guardrail function */
  fn: GuardrailFn<T>;
  /**
   * Whether this guardrail is critical (blocking)
   * @default true
   */
  critical?: boolean;
  /** Retry configuration for transient failures */
  retry?: GuardrailRetryConfig;
}

/** Guardrails configuration */
export interface GuardrailsConfig {
  /** Validate/transform input before agent runs */
  input?: Array<GuardrailFn<InputGuardrailData> | NamedGuardrail<InputGuardrailData>>;
  /** Validate/transform output after agent runs */
  output?: Array<GuardrailFn<OutputGuardrailData> | NamedGuardrail<OutputGuardrailData>>;
  /** Validate tool calls before execution */
  toolCall?: Array<GuardrailFn<ToolCallGuardrailData> | NamedGuardrail<ToolCallGuardrailData>>;
}

/** Agent state in facts */
export interface AgentState {
  status: "idle" | "running" | "paused" | "completed" | "error";
  currentAgent: string | null;
  input: string | null;
  output: unknown | null;
  error: string | null;
  tokenUsage: number;
  turnCount: number;
  startedAt: number | null;
  completedAt: number | null;
}

/** Approval state */
export interface ApprovalState {
  pending: ApprovalRequest[];
  approved: string[];
  rejected: RejectedRequest[];
}

/** Rejected request with tracking information */
export interface RejectedRequest {
  /** The request ID that was rejected */
  id: string;
  /** Optional reason for rejection */
  reason?: string;
  /** Timestamp when the rejection occurred */
  rejectedAt: number;
}

/** Approval request */
export interface ApprovalRequest {
  id: string;
  type: "tool_call" | "output" | "handoff";
  agentName: string;
  description: string;
  data: unknown;
  requestedAt: number;
}

/** Constraint for orchestrator */
export interface OrchestratorConstraint<F extends Record<string, unknown>> {
  when: (facts: F & OrchestratorState) => boolean | Promise<boolean>;
  require: Requirement | ((facts: F & OrchestratorState) => Requirement);
  priority?: number;
}

/** Resolver context for orchestrator */
export interface OrchestratorResolverContext<F extends Record<string, unknown>> {
  facts: F & OrchestratorState;
  runAgent: <T>(agent: AgentLike, input: string, options?: RunOptions) => Promise<RunResult<T>>;
  signal: AbortSignal;
}

/** Resolver for orchestrator */
export interface OrchestratorResolver<
  F extends Record<string, unknown>,
  R extends Requirement = Requirement
> {
  requirement: (req: Requirement) => req is R;
  key?: (req: R) => string;
  resolve: (req: R, ctx: OrchestratorResolverContext<F>) => void | Promise<void>;
}

/** Combined orchestrator state */
export interface OrchestratorState {
  agent: AgentState;
  approval: ApprovalState;
  conversation: Message[];
  toolCalls: ToolCall[];
}

// ============================================================================
// Bridge Schema
// ============================================================================

/** Bridge schema keys for orchestrator state */
const AGENT_KEY = "__agent" as const;
const APPROVAL_KEY = "__approval" as const;
const CONVERSATION_KEY = "__conversation" as const;
const TOOL_CALLS_KEY = "__toolCalls" as const;

/** Bridge schema for orchestrator */
const orchestratorBridgeSchema = {
  facts: {
    [AGENT_KEY]: t.any<AgentState>(),
    [APPROVAL_KEY]: t.any<ApprovalState>(),
    [CONVERSATION_KEY]: t.any<Message[]>(),
    [TOOL_CALLS_KEY]: t.any<ToolCall[]>(),
  },
  derivations: {},
  events: {},
  requirements: {},
} satisfies ModuleSchema;

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

/** Lifecycle hooks for observability */
export interface OrchestratorLifecycleHooks {
  /** Called when an agent run starts */
  onAgentStart?: (event: {
    agentName: string;
    input: string;
    timestamp: number;
  }) => void;
  /** Called when an agent run completes successfully */
  onAgentComplete?: (event: {
    agentName: string;
    input: string;
    output: unknown;
    tokenUsage: number;
    durationMs: number;
    timestamp: number;
  }) => void;
  /** Called when an agent run fails */
  onAgentError?: (event: {
    agentName: string;
    input: string;
    error: Error;
    durationMs: number;
    timestamp: number;
  }) => void;
  /** Called when a guardrail check completes */
  onGuardrailCheck?: (event: {
    guardrailName: string;
    guardrailType: "input" | "output" | "toolCall";
    passed: boolean;
    reason?: string;
    durationMs: number;
    timestamp: number;
  }) => void;
  /** Called when an agent run is retried */
  onAgentRetry?: (event: {
    agentName: string;
    input: string;
    attempt: number;
    error: Error;
    delayMs: number;
    timestamp: number;
  }) => void;
}

/** Orchestrator options */
export interface OrchestratorOptions<F extends Record<string, unknown>> {
  /** Function to run an agent */
  runAgent: RunFn;
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
   * @default false
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

/** Orchestrator instance */
export interface AgentOrchestrator<F extends Record<string, unknown>> {
  // biome-ignore lint/suspicious/noExplicitAny: System type varies
  system: System<any>;
  facts: F & OrchestratorState;
  /** Run an agent with guardrails */
  run<T>(agent: AgentLike, input: string): Promise<RunResult<T>>;
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
    runAgent,
    factsSchema = {},
    init,
    constraints = {},
    resolvers = {},
    guardrails = {},
    onApprovalRequest,
    autoApproveToolCalls = false,
    maxTokenBudget,
    plugins = [],
    debug = false,
    approvalTimeoutMs = 300000,
    agentRetry,
    hooks = {},
  } = options;

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
    opts?: RunOptions
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
    opts?: RunOptions
  ): Promise<RunResult<T>> {
    const startTime = Date.now();

    // Call onAgentStart hook
    hooks.onAgentStart?.({
      agentName: agent.name,
      input,
      timestamp: startTime,
    });

    // Run input guardrails with retry support
    const inputGuardrails = (guardrails.input ?? []).map((g, i) =>
      normalizeGuardrail(g, i, "input")
    );
    for (const guardrail of inputGuardrails) {
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
    const outputGuardrails = (guardrails.output ?? []).map((g, i) =>
      normalizeGuardrail(g, i, "output")
    );
    for (const guardrail of outputGuardrails) {
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
    system,
    get facts() {
      return getCombinedFacts();
    },

    async run<T>(agent: AgentLike, input: string): Promise<RunResult<T>> {
      return runAgentWithGuardrails<T>(agent, input, getCombinedFacts());
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
        setApprovalState(system.facts, {
          ...approval,
          pending: approval.pending.filter((r) => r.id !== requestId),
          approved: [...approval.approved, requestId],
        });
      });
    },

    reject(requestId: string, reason?: string): void {
      system.batch(() => {
        const approval = getApprovalState(system.facts);
        if (reason && debug) {
          console.debug(`[Directive] Request ${requestId} rejected: ${reason}`);
        }
        const rejectedRequest: RejectedRequest = {
          id: requestId,
          reason,
          rejectedAt: Date.now(),
        };
        setApprovalState(system.facts, {
          ...approval,
          pending: approval.pending.filter((r) => r.id !== requestId),
          rejected: [...approval.rejected, rejectedRequest],
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

// ============================================================================
// Built-in Guardrails
// ============================================================================

/**
 * Create a PII detection guardrail.
 *
 * @example
 * ```typescript
 * const piiGuardrail = createPIIGuardrail({
 *   patterns: [
 *     /\b\d{3}-\d{2}-\d{4}\b/, // SSN
 *     /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, // Email
 *   ],
 *   redact: true,
 * });
 * ```
 */
export function createPIIGuardrail(options: {
  patterns?: RegExp[];
  redact?: boolean;
  redactReplacement?: string;
}): GuardrailFn<InputGuardrailData> {
  const {
    patterns = [
      /\b\d{3}-\d{2}-\d{4}\b/, // SSN
      /\b\d{16}\b/, // Credit card
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, // Email
    ],
    redact = false,
    redactReplacement = "[REDACTED]",
  } = options;

  return (data) => {
    let text = data.input;
    let hasPII = false;

    for (const pattern of patterns) {
      if (pattern.test(text)) {
        hasPII = true;
        if (redact) {
          text = text.replace(pattern, redactReplacement);
        }
      }
    }

    if (hasPII && !redact) {
      return { passed: false, reason: "Input contains PII" };
    }

    return { passed: true, transformed: redact && hasPII ? text : undefined };
  };
}

/**
 * Create a content moderation guardrail.
 *
 * @example
 * ```typescript
 * const moderationGuardrail = createModerationGuardrail({
 *   checkFn: async (text) => {
 *     const result = await openai.moderations.create({ input: text });
 *     return result.results[0].flagged;
 *   },
 * });
 * ```
 */
export function createModerationGuardrail(options: {
  checkFn: (text: string) => boolean | Promise<boolean>;
  message?: string;
}): GuardrailFn<InputGuardrailData | OutputGuardrailData> {
  const { checkFn, message = "Content flagged by moderation" } = options;

  return async (data) => {
    const text =
      "output" in data
        ? typeof data.output === "string"
          ? data.output
          : JSON.stringify(data.output)
        : data.input;

    const flagged = await checkFn(text);

    return { passed: !flagged, reason: flagged ? message : undefined };
  };
}

/** Rate limiter with reset capability for testing */
export interface RateLimitGuardrail extends GuardrailFn<InputGuardrailData> {
  /** Reset the rate limiter state (useful for testing) */
  reset(): void;
}

/**
 * Create a rate limit guardrail based on token usage.
 * Returns a guardrail function with an additional `reset()` method for testing.
 *
 * @example
 * ```typescript
 * const rateLimitGuardrail = createRateLimitGuardrail({
 *   maxTokensPerMinute: 10000,
 *   maxRequestsPerMinute: 60,
 * });
 *
 * // For testing, reset the state between tests
 * rateLimitGuardrail.reset();
 * ```
 */
export function createRateLimitGuardrail(options: {
  maxTokensPerMinute?: number;
  maxRequestsPerMinute?: number;
}): RateLimitGuardrail {
  const { maxTokensPerMinute = 100000, maxRequestsPerMinute = 60 } = options;

  // Use bounded arrays with binary search for O(log n) cleanup instead of O(n) shift()
  // Max entries = max requests per minute (bounded)
  const maxEntries = Math.max(maxRequestsPerMinute, 1000);
  let tokenTimestamps: number[] = [];
  let requestTimestamps: number[] = [];
  const windowMs = 60000;

  // Binary search to find cutoff index
  function findCutoffIndex(arr: number[], cutoffTime: number): number {
    let low = 0;
    let high = arr.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((arr[mid] ?? 0) < cutoffTime) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }

  const guardrail: RateLimitGuardrail = (_data, context) => {
    const now = Date.now();
    const cutoffTime = now - windowMs;

    // Clean old entries with binary search + splice (O(log n) + O(k) where k = removed entries)
    const tokenCutoff = findCutoffIndex(tokenTimestamps, cutoffTime);
    if (tokenCutoff > 0) {
      tokenTimestamps = tokenTimestamps.slice(tokenCutoff);
    }

    const requestCutoff = findCutoffIndex(requestTimestamps, cutoffTime);
    if (requestCutoff > 0) {
      requestTimestamps = requestTimestamps.slice(requestCutoff);
    }

    // Check limits - safely extract token usage from context facts
    const factsObj = context.facts as Record<string, unknown>;
    const agentState = factsObj[AGENT_KEY] as AgentState | undefined;
    const tokenUsage = agentState?.tokenUsage ?? 0;
    const recentTokens = tokenTimestamps.length;
    const recentRequests = requestTimestamps.length;

    if (recentTokens + tokenUsage > maxTokensPerMinute) {
      return { passed: false, reason: "Token rate limit exceeded" };
    }

    if (recentRequests >= maxRequestsPerMinute) {
      return { passed: false, reason: "Request rate limit exceeded" };
    }

    // Record this request (bounded to prevent unbounded growth)
    if (requestTimestamps.length < maxEntries) {
      requestTimestamps.push(now);
    }
    if (tokenTimestamps.length < maxEntries) {
      tokenTimestamps.push(now);
    }

    return { passed: true };
  };

  guardrail.reset = () => {
    tokenTimestamps = [];
    requestTimestamps = [];
  };

  return guardrail;
}

/**
 * Create a tool allowlist/denylist guardrail.
 *
 * @example
 * ```typescript
 * const toolGuardrail = createToolGuardrail({
 *   allowlist: ['search', 'calculator'],
 *   // or
 *   denylist: ['shell', 'filesystem'],
 * });
 * ```
 */
export function createToolGuardrail(options: {
  allowlist?: string[];
  denylist?: string[];
  /**
   * Case-sensitive matching
   * @default false
   */
  caseSensitive?: boolean;
}): GuardrailFn<ToolCallGuardrailData> {
  const { allowlist, denylist, caseSensitive = false } = options;

  // Normalize lists for case-insensitive matching
  const normalizedAllowlist = allowlist?.map((t) => caseSensitive ? t : t.toLowerCase());
  const normalizedDenylist = denylist?.map((t) => caseSensitive ? t : t.toLowerCase());

  return (data) => {
    const toolName = caseSensitive ? data.toolCall.name : data.toolCall.name.toLowerCase();

    if (normalizedAllowlist && !normalizedAllowlist.includes(toolName)) {
      return { passed: false, reason: `Tool "${data.toolCall.name}" not in allowlist` };
    }

    if (normalizedDenylist && normalizedDenylist.includes(toolName)) {
      return { passed: false, reason: `Tool "${data.toolCall.name}" is blocked` };
    }

    return { passed: true };
  };
}

/** Schema validation result */
export interface SchemaValidationResult {
  valid: boolean;
  errors?: string[];
}

/** Schema validator function type */
export type SchemaValidator<T = unknown> = (
  value: unknown
) => SchemaValidationResult | boolean;

/**
 * Create an output schema validation guardrail.
 *
 * Validates that agent outputs match a specified schema or validation function.
 * Useful for ensuring structured outputs from agents.
 *
 * @example
 * ```typescript
 * // With a custom validation function
 * const schemaGuardrail = createOutputSchemaGuardrail({
 *   validate: (output) => {
 *     if (typeof output !== 'object' || output === null) {
 *       return { valid: false, errors: ['Output must be an object'] };
 *     }
 *     if (!('answer' in output)) {
 *       return { valid: false, errors: ['Output must have an answer field'] };
 *     }
 *     return { valid: true };
 *   },
 * });
 *
 * // With Zod schema (if you have Zod installed)
 * import { z } from 'zod';
 * const OutputSchema = z.object({
 *   answer: z.string(),
 *   confidence: z.number().min(0).max(1),
 * });
 * const zodGuardrail = createOutputSchemaGuardrail({
 *   validate: (output) => {
 *     const result = OutputSchema.safeParse(output);
 *     if (result.success) return { valid: true };
 *     return {
 *       valid: false,
 *       errors: result.error.errors.map(e => e.message),
 *     };
 *   },
 * });
 * ```
 */
export function createOutputSchemaGuardrail<T = unknown>(options: {
  /** Validation function that checks if output matches expected schema */
  validate: SchemaValidator<T>;
  /** Custom error message prefix */
  errorPrefix?: string;
}): GuardrailFn<OutputGuardrailData> {
  const { validate, errorPrefix = "Output schema validation failed" } = options;

  return (data) => {
    const result = validate(data.output);

    // Handle boolean return (simple valid/invalid)
    if (typeof result === "boolean") {
      return {
        passed: result,
        reason: result ? undefined : errorPrefix,
      };
    }

    // Handle detailed validation result
    if (result.valid) {
      return { passed: true };
    }

    const errorMessage = result.errors?.length
      ? `${errorPrefix}: ${result.errors.join("; ")}`
      : errorPrefix;

    return { passed: false, reason: errorMessage };
  };
}

/**
 * Create a simple type check guardrail for common output types.
 *
 * @example
 * ```typescript
 * // Ensure output is a string
 * const stringGuardrail = createOutputTypeGuardrail({ type: 'string' });
 *
 * // Ensure output is an object with required fields
 * const objectGuardrail = createOutputTypeGuardrail({
 *   type: 'object',
 *   requiredFields: ['answer', 'sources'],
 * });
 *
 * // Ensure output is an array
 * const arrayGuardrail = createOutputTypeGuardrail({ type: 'array' });
 * ```
 */
export function createOutputTypeGuardrail(options: {
  /** Expected output type */
  type: "string" | "number" | "boolean" | "object" | "array";
  /** For objects, specify required fields */
  requiredFields?: string[];
  /** For arrays, minimum length */
  minLength?: number;
  /** For arrays, maximum length */
  maxLength?: number;
  /** For strings, minimum length */
  minStringLength?: number;
  /** For strings, maximum length */
  maxStringLength?: number;
}): GuardrailFn<OutputGuardrailData> {
  const {
    type,
    requiredFields = [],
    minLength,
    maxLength,
    minStringLength,
    maxStringLength,
  } = options;

  return (data) => {
    const output = data.output;

    // Type checks
    switch (type) {
      case "string":
        if (typeof output !== "string") {
          return { passed: false, reason: `Expected string, got ${typeof output}` };
        }
        if (minStringLength !== undefined && output.length < minStringLength) {
          return { passed: false, reason: `String too short: ${output.length} < ${minStringLength}` };
        }
        if (maxStringLength !== undefined && output.length > maxStringLength) {
          return { passed: false, reason: `String too long: ${output.length} > ${maxStringLength}` };
        }
        return { passed: true };

      case "number":
        if (typeof output !== "number" || Number.isNaN(output)) {
          return { passed: false, reason: `Expected number, got ${typeof output}` };
        }
        return { passed: true };

      case "boolean":
        if (typeof output !== "boolean") {
          return { passed: false, reason: `Expected boolean, got ${typeof output}` };
        }
        return { passed: true };

      case "object":
        if (typeof output !== "object" || output === null || Array.isArray(output)) {
          return { passed: false, reason: `Expected object, got ${Array.isArray(output) ? "array" : typeof output}` };
        }
        for (const field of requiredFields) {
          if (!(field in output)) {
            return { passed: false, reason: `Missing required field: ${field}` };
          }
        }
        return { passed: true };

      case "array":
        if (!Array.isArray(output)) {
          return { passed: false, reason: `Expected array, got ${typeof output}` };
        }
        if (minLength !== undefined && output.length < minLength) {
          return { passed: false, reason: `Array too short: ${output.length} < ${minLength}` };
        }
        if (maxLength !== undefined && output.length > maxLength) {
          return { passed: false, reason: `Array too long: ${output.length} > ${maxLength}` };
        }
        return { passed: true };

      default:
        return { passed: false, reason: `Unknown type: ${type}` };
    }
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if agent is currently running.
 */
export function isAgentRunning(state: AgentState): boolean {
  return state.status === "running";
}

/**
 * Check if there are pending approvals.
 */
export function hasPendingApprovals(state: ApprovalState): boolean {
  return state.pending.length > 0;
}

// ============================================================================
// Cost Management
// ============================================================================

/**
 * ## Cost-Aware Constraint Patterns
 *
 * Directive provides multiple strategies for managing AI costs:
 *
 * ### 1. Token Budget (Built-in)
 *
 * Set a hard token limit that automatically pauses agents:
 *
 * ```typescript
 * const orchestrator = createAgentOrchestrator({
 *   maxTokenBudget: 10000, // Pause when exceeded
 *   // ...
 * });
 * ```
 *
 * ### 2. Custom Cost Constraints
 *
 * Create constraints based on estimated costs:
 *
 * ```typescript
 * const RATE_GPT4 = 30; // $30 per million tokens
 *
 * const orchestrator = createAgentOrchestrator({
 *   constraints: {
 *     costWarning: {
 *       priority: 100, // High priority
 *       when: (facts) => {
 *         const cost = estimateCost(facts.agent.tokenUsage, RATE_GPT4);
 *         return cost > 1.00; // $1 warning threshold
 *       },
 *       require: { type: 'COST_WARNING', amount: 'threshold exceeded' }
 *     },
 *     costLimit: {
 *       priority: 200, // Higher priority = evaluated first
 *       when: (facts) => {
 *         const cost = estimateCost(facts.agent.tokenUsage, RATE_GPT4);
 *         return cost > 5.00; // $5 hard limit
 *       },
 *       require: { type: 'PAUSE_AGENTS' }
 *     }
 *   },
 *   resolvers: {
 *     costWarning: {
 *       requirement: (req) => req.type === 'COST_WARNING',
 *       resolve: async (req, ctx) => {
 *         console.warn('Cost warning:', req.amount);
 *         // Optionally notify via webhook, email, etc.
 *       }
 *     }
 *   }
 * });
 * ```
 *
 * ### 3. Per-User/Session Budgets
 *
 * Track costs across multiple orchestrator instances:
 *
 * ```typescript
 * // In-memory (use Redis/DB for production)
 * const userBudgets = new Map<string, number>();
 *
 * function createUserOrchestrator(userId: string) {
 *   return createAgentOrchestrator({
 *     constraints: {
 *       userBudget: {
 *         when: (facts) => {
 *           const currentUsage = userBudgets.get(userId) ?? 0;
 *           return currentUsage + facts.agent.tokenUsage > 50000;
 *         },
 *         require: { type: 'USER_BUDGET_EXCEEDED', userId }
 *       }
 *     },
 *     hooks: {
 *       onAgentComplete: ({ tokenUsage }) => {
 *         const current = userBudgets.get(userId) ?? 0;
 *         userBudgets.set(userId, current + tokenUsage);
 *       }
 *     }
 *   });
 * }
 * ```
 *
 * ### 4. Tiered Responses
 *
 * Use cheaper models for simple queries:
 *
 * ```typescript
 * const orchestrator = createAgentOrchestrator({
 *   constraints: {
 *     routeToBasic: {
 *       when: (facts) => facts.queryComplexity < 0.3,
 *       require: { type: 'RUN_AGENT', agent: 'gpt-3.5-turbo' }
 *     },
 *     routeToAdvanced: {
 *       when: (facts) => facts.queryComplexity >= 0.3,
 *       require: { type: 'RUN_AGENT', agent: 'gpt-4' }
 *     }
 *   }
 * });
 * ```
 *
 * ### 5. Rate-Based Budgeting
 *
 * Use the built-in rate limiting guardrail with cost tracking:
 *
 * ```typescript
 * const orchestrator = createAgentOrchestrator({
 *   guardrails: {
 *     input: [
 *       createRateLimitGuardrail({
 *         maxRequestsPerMinute: 10,
 *         maxTokensPerMinute: 5000,
 *       })
 *     ]
 *   }
 * });
 * ```
 */

/**
 * Get total cost estimate based on token usage.
 *
 * @param tokenUsage - Total token count
 * @param ratePerMillionTokens - Cost per million tokens (required, no default to avoid stale pricing)
 * @returns Estimated cost in dollars
 *
 * @example
 * ```typescript
 * // GPT-4 pricing (example - check current rates)
 * const RATE_GPT4_INPUT = 30;  // $30 per 1M input tokens
 * const RATE_GPT4_OUTPUT = 60; // $60 per 1M output tokens
 *
 * const inputCost = estimateCost(inputTokens, RATE_GPT4_INPUT);
 * const outputCost = estimateCost(outputTokens, RATE_GPT4_OUTPUT);
 * const totalCost = inputCost + outputCost;
 * ```
 */
export function estimateCost(
  tokenUsage: number,
  ratePerMillionTokens: number
): number {
  return (tokenUsage / 1_000_000) * ratePerMillionTokens;
}

// ============================================================================
// Structured Errors
// ============================================================================

/** Error codes for guardrail errors */
export type GuardrailErrorCode =
  | "INPUT_GUARDRAIL_FAILED"
  | "OUTPUT_GUARDRAIL_FAILED"
  | "TOOL_CALL_GUARDRAIL_FAILED"
  | "APPROVAL_REJECTED"
  | "BUDGET_EXCEEDED"
  | "RATE_LIMIT_EXCEEDED"
  | "AGENT_ERROR";

/**
 * Structured error for guardrail failures.
 * Provides detailed context for debugging and error handling.
 *
 * **Security:** The `input` and `data` properties are non-enumerable to prevent
 * accidental leakage of sensitive data via JSON.stringify or console.log on the error object.
 */
export class GuardrailError extends Error {
  /** Error code for programmatic handling */
  readonly code: GuardrailErrorCode;
  /** Name of the guardrail that failed (if named) */
  readonly guardrailName: string;
  /** Type of guardrail that failed */
  readonly guardrailType: "input" | "output" | "toolCall";
  /** User-friendly error message */
  readonly userMessage: string;
  /** Additional data from the guardrail (non-enumerable for security) */
  declare readonly data: unknown;
  /** Agent that was running when the error occurred */
  readonly agentName: string;
  /** Input that triggered the error (non-enumerable for security) */
  declare readonly input: string;

  constructor(options: {
    code: GuardrailErrorCode;
    message: string;
    guardrailName: string;
    guardrailType: "input" | "output" | "toolCall";
    userMessage?: string;
    data?: unknown;
    agentName: string;
    input: string;
    cause?: Error;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "GuardrailError";
    this.code = options.code;
    this.guardrailName = options.guardrailName;
    this.guardrailType = options.guardrailType;
    this.userMessage = options.userMessage ?? options.message;
    this.agentName = options.agentName;

    // Make sensitive fields non-enumerable to prevent accidental serialization/logging
    Object.defineProperty(this, "input", {
      value: options.input,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, "data", {
      value: options.data,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }

  /** Convert to a plain object for logging/serialization */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      guardrailName: this.guardrailName,
      guardrailType: this.guardrailType,
      userMessage: this.userMessage,
      agentName: this.agentName,
      // Intentionally exclude input and data for security
    };
  }
}

/**
 * Check if an error is a GuardrailError.
 */
export function isGuardrailError(error: unknown): error is GuardrailError {
  return error instanceof GuardrailError;
}

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
      });
    },
  };

  return builder;
}

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
