/**
 * Shared types for AI adapter — used by orchestrator, guardrails, helpers, and stack.
 */

import type { Requirement, ModuleSchema, SchemaType } from "@directive-run/core";
import { t } from "@directive-run/core";

// ============================================================================
// Agent Types (LLM-agnostic)
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
  output: T;
  messages: Message[];
  toolCalls: ToolCall[];
  totalTokens: number;
  /** Breakdown of input vs output tokens, when available from the provider */
  tokenUsage?: TokenUsage;
  /** True when result was served from semantic cache */
  isCached?: boolean;
}

/** Breakdown of token usage by input/output */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
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
export type AgentRunner = <T = unknown>(
  agent: AgentLike,
  input: string,
  options?: RunOptions
) => Promise<RunResult<T>>;

/** Callback-based streaming run function (e.g. for SSE-based LLM APIs) */
export type StreamingCallbackRunner = (
  agent: AgentLike,
  input: string,
  callbacks: {
    onToken?: (token: string) => void;
    onToolStart?: (tool: string, id: string, args: string) => void;
    onToolEnd?: (tool: string, id: string, result: string) => void;
    onMessage?: (message: Message) => void;
    signal?: AbortSignal;
  },
) => Promise<RunResult<unknown>>;

/** Run options */
export interface RunOptions {
  maxTurns?: number;
  signal?: AbortSignal;
  onMessage?: (message: Message) => void;
  onToolCall?: (toolCall: ToolCall) => void | Promise<void>;
}

// ============================================================================
// Adapter Lifecycle Hooks
// ============================================================================

/**
 * Lifecycle hooks for adapter-level observability.
 *
 * Attach to any adapter (runner or streaming runner) to trace, log,
 * or measure individual LLM calls without modifying application code.
 *
 * @example
 * ```typescript
 * const runner = createOpenAIRunner({
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   hooks: {
 *     onBeforeCall: ({ agent, input }) => console.log(`→ ${agent.name}`, input.slice(0, 50)),
 *     onAfterCall: ({ durationMs, tokenUsage }) => {
 *       metrics.track('llm_call', { durationMs, ...tokenUsage });
 *     },
 *     onError: ({ error }) => Sentry.captureException(error),
 *   },
 * });
 * ```
 */
export interface AdapterHooks {
  /** Fires before each LLM API call. */
  onBeforeCall?: (event: {
    agent: AgentLike;
    input: string;
    timestamp: number;
  }) => void;

  /** Fires after a successful LLM API call. */
  onAfterCall?: (event: {
    agent: AgentLike;
    input: string;
    output: string;
    totalTokens: number;
    tokenUsage: TokenUsage;
    durationMs: number;
    timestamp: number;
  }) => void;

  /** Fires when an LLM API call fails. */
  onError?: (event: {
    agent: AgentLike;
    input: string;
    error: Error;
    durationMs: number;
    timestamp: number;
  }) => void;
}

// ============================================================================
// Guardrail Types
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
  /** Total attempts (1 = no retries, 2 = one retry, etc.). @default 1 */
  attempts?: number;
  /** @default "exponential" */
  backoff?: "exponential" | "linear" | "fixed";
  /** @default 100 */
  baseDelayMs?: number;
  /** @default 5000 */
  maxDelayMs?: number;
}

/** Named guardrail for better debugging */
export interface NamedGuardrail<T = unknown> {
  name: string;
  fn: GuardrailFn<T>;
  /** @default true */
  critical?: boolean;
  retry?: GuardrailRetryConfig;
}

/** Guardrails configuration */
export interface GuardrailsConfig {
  input?: Array<GuardrailFn<InputGuardrailData> | NamedGuardrail<InputGuardrailData>>;
  output?: Array<GuardrailFn<OutputGuardrailData> | NamedGuardrail<OutputGuardrailData>>;
  toolCall?: Array<GuardrailFn<ToolCallGuardrailData> | NamedGuardrail<ToolCallGuardrailData>>;
}

// ============================================================================
// Retry Configuration
// ============================================================================

/** Retry configuration for agent runs */
export interface AgentRetryConfig {
  /** @default 1 */
  attempts?: number;
  /** @default "exponential" */
  backoff?: "exponential" | "linear" | "fixed";
  /** @default 1000 */
  baseDelayMs?: number;
  /** @default 30000 */
  maxDelayMs?: number;
  isRetryable?: (error: Error) => boolean;
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

// ============================================================================
// Orchestrator State Types
// ============================================================================

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
  id: string;
  reason?: string;
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

/** Combined orchestrator state */
export interface OrchestratorState {
  agent: AgentState;
  approval: ApprovalState;
  conversation: Message[];
  toolCalls: ToolCall[];
}

// ============================================================================
// Orchestrator Config Types
// ============================================================================

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
  resolve: (req: R, context: OrchestratorResolverContext<F>) => void | Promise<void>;
}

/** Lifecycle hooks for observability */
export interface OrchestratorLifecycleHooks {
  onAgentStart?: (event: {
    agentName: string;
    input: string;
    timestamp: number;
  }) => void;
  onAgentComplete?: (event: {
    agentName: string;
    input: string;
    output: unknown;
    tokenUsage: number;
    durationMs: number;
    timestamp: number;
  }) => void;
  onAgentError?: (event: {
    agentName: string;
    input: string;
    error: Error;
    durationMs: number;
    timestamp: number;
  }) => void;
  onGuardrailCheck?: (event: {
    guardrailName: string;
    guardrailType: "input" | "output" | "toolCall";
    passed: boolean;
    reason?: string;
    durationMs: number;
    timestamp: number;
  }) => void;
  onAgentRetry?: (event: {
    agentName: string;
    input: string;
    attempt: number;
    error: Error;
    delayMs: number;
    timestamp: number;
  }) => void;
  /** Called when a breakpoint is hit and waiting for resolution. */
  onBreakpoint?: (request: {
    id: string;
    type: string;
    agentId: string;
    input: string;
    label?: string;
    requestedAt: number;
  }) => void;
}

/** Lifecycle hooks for multi-agent orchestrator observability */
export interface MultiAgentLifecycleHooks {
  onAgentStart?: (event: {
    agentId: string;
    agentName: string;
    input: string;
    timestamp: number;
  }) => void;
  onAgentComplete?: (event: {
    agentId: string;
    agentName: string;
    input: string;
    output: unknown;
    tokenUsage: number;
    durationMs: number;
    timestamp: number;
  }) => void;
  onAgentError?: (event: {
    agentId: string;
    agentName: string;
    input: string;
    error: Error;
    durationMs: number;
    timestamp: number;
  }) => void;
  onGuardrailCheck?: (event: {
    agentId: string;
    guardrailName: string;
    guardrailType: "input" | "output" | "toolCall";
    passed: boolean;
    reason?: string;
    durationMs: number;
    timestamp: number;
  }) => void;
  onAgentRetry?: (event: {
    agentId: string;
    agentName: string;
    input: string;
    attempt: number;
    error: Error;
    delayMs: number;
    timestamp: number;
  }) => void;
  onHandoff?: (request: { id: string; fromAgent: string; toAgent: string; input: string; requestedAt: number }) => void;
  onHandoffComplete?: (result: { request: { id: string; fromAgent: string; toAgent: string }; completedAt: number }) => void;
  onPatternStart?: (event: {
    patternId: string;
    patternType: "parallel" | "sequential" | "supervisor" | "dag" | "reflect" | "race" | "debate";
    input: string;
    timestamp: number;
  }) => void;
  onPatternComplete?: (event: {
    patternId: string;
    patternType: "parallel" | "sequential" | "supervisor" | "dag" | "reflect" | "race" | "debate";
    durationMs: number;
    timestamp: number;
    error?: Error;
  }) => void;
  onDagNodeStart?: (event: {
    patternId: string;
    nodeId: string;
    agentId: string;
    timestamp: number;
  }) => void;
  onDagNodeComplete?: (event: {
    patternId: string;
    nodeId: string;
    agentId: string;
    durationMs: number;
    timestamp: number;
  }) => void;
  onDagNodeError?: (event: {
    patternId: string;
    nodeId: string;
    agentId: string;
    error: Error;
    durationMs: number;
    timestamp: number;
  }) => void;
  onDagNodeSkipped?: (event: {
    patternId: string;
    nodeId: string;
    agentId: string;
    reason: string;
    timestamp: number;
  }) => void;
  onHealthChange?: (event: {
    agentId: string;
    oldScore: number;
    newScore: number;
    timestamp: number;
  }) => void;
  onReroute?: (event: RerouteEvent) => void;
  /** Called when a breakpoint is hit and waiting for resolution. */
  onBreakpoint?: (request: {
    id: string;
    type: string;
    agentId: string;
    input: string;
    label?: string;
    requestedAt: number;
  }) => void;
  /** Called when a cross-agent derivation value updates */
  onDerivationUpdate?: (event: { derivationId: string; value: unknown; timestamp: number }) => void;
  /** Called when a cross-agent derivation throws an error */
  onDerivationError?: (event: { derivationId: string; error: Error; timestamp: number }) => void;
  /** Called when scratchpad values are updated */
  onScratchpadUpdate?: (event: { keys: string[]; timestamp: number }) => void;
}

// ============================================================================
// Error Types
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
 *
 * **Security:** The `input` and `data` properties are non-enumerable to prevent
 * accidental leakage of sensitive data via JSON.stringify or console.log.
 */
export class GuardrailError extends Error {
  readonly code: GuardrailErrorCode;
  readonly guardrailName: string;
  readonly guardrailType: "input" | "output" | "toolCall";
  readonly userMessage: string;
  declare readonly data: unknown;
  readonly agentName: string;
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

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      guardrailName: this.guardrailName,
      guardrailType: this.guardrailType,
      userMessage: this.userMessage,
      agentName: this.agentName,
    };
  }
}

/** Check if an error is a GuardrailError. */
export function isGuardrailError(error: unknown): error is GuardrailError {
  return error instanceof GuardrailError;
}

// ============================================================================
// Schema Validation Types (used by built-in guardrails)
// ============================================================================

/** Schema validation result */
export interface SchemaValidationResult {
  valid: boolean;
  errors?: string[];
}

/** Schema validator function type */
export type SchemaValidator<_T = unknown> = (
  value: unknown
) => SchemaValidationResult | boolean;

// ============================================================================
// Bridge Schema Constants
// ============================================================================

export const AGENT_KEY = "__agent" as const;
export const APPROVAL_KEY = "__approval" as const;
export const CONVERSATION_KEY = "__conversation" as const;
export const TOOL_CALLS_KEY = "__toolCalls" as const;
export const BREAKPOINT_KEY = "__breakpoints" as const;

// ============================================================================
// DAG Execution Types (Multi-Agent)
// ============================================================================

/** Status of a DAG node during execution */
export type DagNodeStatus = "pending" | "ready" | "running" | "completed" | "error" | "skipped";

/** Execution context available to DAG node callbacks */
export interface DagExecutionContext {
  /** Original input to the DAG */
  input: string;
  /** Outputs keyed by node ID (populated as nodes complete) */
  outputs: Record<string, unknown>;
  /** Statuses keyed by node ID */
  statuses: Record<string, DagNodeStatus>;
  /** Error messages keyed by node ID */
  errors: Record<string, string>;
  /** Full RunResult keyed by node ID */
  results: Record<string, RunResult<unknown>>;
}

/** A node in a DAG execution pattern */
export interface DagNode {
  /** Registered agent ID to run for this node */
  agent: string;
  /** Upstream node IDs this node depends on */
  deps?: string[];
  /** Conditional edge — evaluated when deps are met. Default: unconditional */
  when?: (context: DagExecutionContext) => boolean;
  /** Build input string for this node's agent. Default: JSON.stringify upstream outputs */
  transform?: (context: DagExecutionContext) => string;
  /** Per-node timeout (ms) */
  timeout?: number;
  /** Tiebreaker when multiple nodes are ready (higher = first). Default: 0 */
  priority?: number;
}

/** DAG execution pattern — nodes are agents, edges are reactive conditions */
export interface DagPattern<T = unknown> {
  type: "dag";
  /** Nodes keyed by node ID */
  nodes: Record<string, DagNode>;
  /** Merge all node outputs into the final result */
  merge: (context: DagExecutionContext) => T | Promise<T>;
  /** Overall DAG timeout (ms) */
  timeout?: number;
  /** Maximum nodes running concurrently. @default Infinity. Consider setting this to avoid API rate limits. */
  maxConcurrent?: number;
  /** Error handling strategy. Default: "fail" */
  onNodeError?: "fail" | "skip-downstream" | "continue";
}

// ============================================================================
// Debug Timeline Types
// ============================================================================

/** All debug event types */
export type DebugEventType =
  | "agent_start"
  | "agent_complete"
  | "agent_error"
  | "agent_retry"
  | "guardrail_check"
  | "constraint_evaluate"
  | "resolver_start"
  | "resolver_complete"
  | "resolver_error"
  | "approval_request"
  | "approval_response"
  | "handoff_start"
  | "handoff_complete"
  | "pattern_start"
  | "pattern_complete"
  | "dag_node_update"
  | "breakpoint_hit"
  | "breakpoint_resumed"
  | "derivation_update"
  | "scratchpad_update"
  | "reflection_iteration"
  | "race_start"
  | "race_winner"
  | "race_cancelled"
  | "debate_round";

/** Base debug event */
export interface DebugEventBase {
  id: number;
  type: DebugEventType;
  timestamp: number;
  agentId?: string;
  snapshotId: number | null;
}

/** Agent start event */
export interface AgentStartEvent extends DebugEventBase {
  type: "agent_start";
  agentId: string;
  inputLength: number;
}

/** Agent complete event */
export interface AgentCompleteEvent extends DebugEventBase {
  type: "agent_complete";
  agentId: string;
  outputLength: number;
  totalTokens: number;
  durationMs: number;
}

/** Agent error event */
export interface AgentErrorEvent extends DebugEventBase {
  type: "agent_error";
  agentId: string;
  errorMessage: string;
  durationMs: number;
}

/** Agent retry event */
export interface AgentRetryEvent extends DebugEventBase {
  type: "agent_retry";
  agentId: string;
  attempt: number;
  errorMessage: string;
  delayMs: number;
}

/** Guardrail check event */
export interface GuardrailCheckEvent extends DebugEventBase {
  type: "guardrail_check";
  guardrailName: string;
  guardrailType: "input" | "output" | "toolCall";
  passed: boolean;
  reason?: string;
  durationMs: number;
}

/** Constraint evaluate event */
export interface ConstraintEvaluateEvent extends DebugEventBase {
  type: "constraint_evaluate";
  constraintId: string;
  fired: boolean;
}

/** Resolver start event */
export interface ResolverStartEvent extends DebugEventBase {
  type: "resolver_start";
  resolverId: string;
  requirementType: string;
}

/** Resolver complete event */
export interface ResolverCompleteEvent extends DebugEventBase {
  type: "resolver_complete";
  resolverId: string;
  durationMs: number;
}

/** Resolver error event */
export interface ResolverErrorEvent extends DebugEventBase {
  type: "resolver_error";
  resolverId: string;
  errorMessage: string;
  durationMs: number;
}

/** Approval request event */
export interface ApprovalRequestEvent extends DebugEventBase {
  type: "approval_request";
  requestId: string;
  approvalType: "tool_call" | "output" | "handoff";
}

/** Approval response event */
export interface ApprovalResponseEvent extends DebugEventBase {
  type: "approval_response";
  requestId: string;
  approved: boolean;
  reason?: string;
}

/** Handoff start event */
export interface HandoffStartEvent extends DebugEventBase {
  type: "handoff_start";
  fromAgent: string;
  toAgent: string;
}

/** Handoff complete event */
export interface HandoffCompleteEvent extends DebugEventBase {
  type: "handoff_complete";
  fromAgent: string;
  toAgent: string;
  durationMs: number;
}

/** Pattern start event */
export interface PatternStartEvent extends DebugEventBase {
  type: "pattern_start";
  patternId: string;
  patternType: "parallel" | "sequential" | "supervisor" | "dag" | "reflect" | "race" | "debate";
}

/** Pattern complete event */
export interface PatternCompleteEvent extends DebugEventBase {
  type: "pattern_complete";
  patternId: string;
  patternType: "parallel" | "sequential" | "supervisor" | "dag" | "reflect" | "race" | "debate";
  durationMs: number;
  error?: string;
}

/** DAG node update event */
export interface DagNodeUpdateEvent extends DebugEventBase {
  type: "dag_node_update";
  nodeId: string;
  status: DagNodeStatus;
}

/** Breakpoint hit event */
export interface BreakpointHitEvent extends DebugEventBase {
  type: "breakpoint_hit";
  breakpointId: string;
  breakpointType: string;
  label?: string;
}

/** Breakpoint resumed event */
export interface BreakpointResumedEvent extends DebugEventBase {
  type: "breakpoint_resumed";
  breakpointId: string;
  modified: boolean;
  skipped: boolean;
}

/** Derivation update event */
export interface DerivationUpdateEvent extends DebugEventBase {
  type: "derivation_update";
  derivationId: string;
  valueType: string;
}

/** Scratchpad update event */
export interface ScratchpadUpdateEvent extends DebugEventBase {
  type: "scratchpad_update";
  keys: string[];
}

/** Reflection iteration event */
export interface ReflectionIterationEvent extends DebugEventBase {
  type: "reflection_iteration";
  iteration: number;
  passed: boolean;
  score?: number;
  durationMs: number;
  producerTokens: number;
  evaluatorTokens: number;
}

/** Race start event */
export interface RaceStartEvent extends DebugEventBase {
  type: "race_start";
  patternId: string;
  agents: string[];
}

/** Race winner event */
export interface RaceWinnerEvent extends DebugEventBase {
  type: "race_winner";
  patternId: string;
  winnerId: string;
  durationMs: number;
}

/** Race cancelled event */
export interface RaceCancelledEvent extends DebugEventBase {
  type: "race_cancelled";
  patternId: string;
  cancelledIds: string[];
  reason: "winner_found" | "timeout" | "all_failed";
}

/** Debate round event — emitted after each round's judgement */
export interface DebateRoundEvent extends DebugEventBase {
  type: "debate_round";
  patternId: string;
  round: number;
  totalRounds: number;
  winnerId: string;
  score?: number;
  agentCount: number;
}

/** Union of all debug event types */
export type DebugEvent =
  | AgentStartEvent
  | AgentCompleteEvent
  | AgentErrorEvent
  | AgentRetryEvent
  | GuardrailCheckEvent
  | ConstraintEvaluateEvent
  | ResolverStartEvent
  | ResolverCompleteEvent
  | ResolverErrorEvent
  | ApprovalRequestEvent
  | ApprovalResponseEvent
  | HandoffStartEvent
  | HandoffCompleteEvent
  | PatternStartEvent
  | PatternCompleteEvent
  | DagNodeUpdateEvent
  | BreakpointHitEvent
  | BreakpointResumedEvent
  | DerivationUpdateEvent
  | ScratchpadUpdateEvent
  | ReflectionIterationEvent
  | RaceStartEvent
  | RaceWinnerEvent
  | RaceCancelledEvent
  | DebateRoundEvent;

// ============================================================================
// Self-Healing Types
// ============================================================================

/** Health state for an agent stored in facts */
export interface AgentHealthState {
  circuitState: "CLOSED" | "OPEN" | "HALF_OPEN";
  healthScore: number;
  lastUpdated: number;
}

/** Reroute event fired when an agent is rerouted */
export interface RerouteEvent {
  originalAgent: string;
  reroutedTo: string;
  reason: string;
  timestamp: number;
}

/** Health monitor configuration */
export interface HealthMonitorConfig {
  /** Rolling window for metrics (ms). Default: 60000 */
  windowMs?: number;
  /** Weights for health score computation */
  weights?: {
    /** Weight for success rate (0-1). Default: 0.5 */
    successRate?: number;
    /** Weight for latency (0-1). Default: 0.3 */
    latency?: number;
    /** Weight for circuit state (0-1). Default: 0.2 */
    circuitState?: number;
  };
  /** Max latency considered "normal" (ms). Default: 5000 */
  maxNormalLatencyMs?: number;
  /** Max events per agent before FIFO eviction. Default: 1000 */
  maxEventsPerAgent?: number;
}

/** Self-healing configuration for single-agent orchestrator */
export interface SelfHealingConfig {
  /** Fallback runners to try in order when primary CB is open */
  fallbackRunners?: AgentRunner[];
  /** Fallback agent to try when all runners fail */
  fallbackAgent?: AgentLike;
  /** Circuit breaker config for primary runner */
  circuitBreaker?: AgentCircuitBreakerConfig;
  /** Health score below which to trigger reroute. Default: 30 */
  healthThreshold?: number;
  /** Behavior when all fallbacks exhausted */
  degradation?: "reject" | "fallback-response";
  /** Static response to return when degradation is "fallback-response" */
  fallbackResponse?: unknown;
  /** Callback when reroute occurs */
  onReroute?: (event: RerouteEvent) => void;
}

/** Self-healing configuration for multi-agent orchestrator */
export interface MultiAgentSelfHealingConfig {
  /** Default circuit breaker config for agents without their own */
  circuitBreakerDefaults?: AgentCircuitBreakerConfig;
  /** Health score below which to trigger reroute. Default: 30 */
  healthThreshold?: number;
  /** Explicit equivalency groups (group name → agent IDs) */
  equivalencyGroups?: Record<string, string[]>;
  /** Use capability matching for implicit equivalency. Default: true */
  useCapabilities?: boolean;
  /** Strategy for selecting equivalent agent */
  selectionStrategy?: "healthiest" | "round-robin";
  /** Behavior when all equivalents are down */
  degradation?: "reject" | "fallback-response";
  /** Static response for "fallback-response" degradation */
  fallbackResponse?: unknown;
  /** Callback when reroute occurs */
  onReroute?: (event: RerouteEvent) => void;
  /** Callback when agent health changes */
  onHealthChange?: (event: { agentId: string; oldScore: number; newScore: number }) => void;
  /** Health monitor configuration */
  healthMonitor?: HealthMonitorConfig;
}

/** Circuit breaker config for AI agent self-healing (simplified subset of core CircuitBreakerConfig) */
export interface AgentCircuitBreakerConfig {
  /** Number of failures before opening. @default 5 */
  failureThreshold?: number;
  /** Time before trying half-open (ms). @default 30000 */
  resetTimeoutMs?: number;
  /** Successes needed to close from half-open. @default 2 */
  halfOpenSuccesses?: number;
  /** State change callback */
  onStateChange?: (from: string, to: string) => void;
}

/** Internal key for health state in coordinator facts */
export const HEALTH_KEY = "__agentHealth" as const;

/** Breakpoint state stored in bridge schema */
export interface BreakpointState {
  pending: Array<{
    id: string;
    type: string;
    agentId: string;
    input: string;
    label?: string;
    requestedAt: number;
  }>;
  resolved: string[];
  cancelled: string[];
}

// ============================================================================
// Cross-Agent Derivation Types
// ============================================================================

/** Snapshot of all agent states for cross-agent derivations */
export interface CrossAgentSnapshot {
  agents: Record<string, {
    status: "idle" | "running" | "completed" | "error";
    lastInput?: string;
    lastOutput?: unknown;
    lastError?: string;
    runCount: number;
    totalTokens: number;
  }>;
  coordinator: { globalTokens: number; status: string };
  scratchpad?: Record<string, unknown>;
}

/** Function that computes a derived value from a cross-agent snapshot */
export type CrossAgentDerivationFn<T = unknown> = (snapshot: CrossAgentSnapshot) => T;

// ============================================================================
// Shared Scratchpad Types
// ============================================================================

/** Internal key for scratchpad fact on coordinator module */
export const SCRATCHPAD_KEY = "__scratchpad" as const;

/** Shared scratchpad interface for multi-agent collaboration */
export interface Scratchpad<T extends Record<string, unknown> = Record<string, unknown>> {
  get<K extends keyof T>(key: K): T[K];
  set<K extends keyof T>(key: K, value: T[K]): void;
  /** Check if a key exists in the scratchpad */
  has<K extends keyof T>(key: K): boolean;
  /** Delete a key from the scratchpad */
  delete<K extends keyof T>(key: K): void;
  update(values: Partial<T>): void;
  getAll(): T;
  subscribe(keys: (keyof T)[], callback: (key: keyof T, value: unknown) => void): () => void;
  onChange(callback: (key: string, value: unknown) => void): () => void;
  reset(): void;
}

/** Bridge schema for orchestrator (internal plumbing — types cast to bypass t.object constraint) */
export const orchestratorBridgeSchema = {
  facts: {
    [AGENT_KEY]: t.object() as unknown as SchemaType<AgentState>,
    [APPROVAL_KEY]: t.object() as unknown as SchemaType<ApprovalState>,
    [CONVERSATION_KEY]: t.array() as unknown as SchemaType<Message[]>,
    [TOOL_CALLS_KEY]: t.array() as unknown as SchemaType<ToolCall[]>,
    [BREAKPOINT_KEY]: t.object() as unknown as SchemaType<BreakpointState>,
  },
  derivations: {},
  events: {},
  requirements: {},
} satisfies ModuleSchema;
