/**
 * Shared types for AI adapter — used by orchestrator, guardrails, helpers, and stack.
 */

import type { Requirement, ModuleSchema, SchemaType } from "@directive-run/core";
import type { BreakpointState as BreakpointStateFromBreakpoints, BreakpointRequest } from "./breakpoints.js";
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
    agentId?: string;
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
  onBreakpoint?: (request: BreakpointRequest) => void;
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
    patternType: "parallel" | "sequential" | "supervisor" | "dag" | "reflect" | "race" | "debate" | "goal";
    input: string;
    timestamp: number;
  }) => void;
  onPatternComplete?: (event: {
    patternId: string;
    patternType: "parallel" | "sequential" | "supervisor" | "dag" | "reflect" | "race" | "debate" | "goal";
    durationMs: number;
    timestamp: number;
    error?: Error;
  }) => void;
  onDagNodeStart?: (event: {
    patternId: string;
    nodeId: string;
    agentId: string;
    nodeType: "agent" | "task";
    timestamp: number;
  }) => void;
  onDagNodeComplete?: (event: {
    patternId: string;
    nodeId: string;
    agentId: string;
    nodeType: "agent" | "task";
    durationMs: number;
    timestamp: number;
  }) => void;
  onDagNodeError?: (event: {
    patternId: string;
    nodeId: string;
    agentId: string;
    nodeType: "agent" | "task";
    error: Error;
    durationMs: number;
    timestamp: number;
  }) => void;
  onDagNodeSkipped?: (event: {
    patternId: string;
    nodeId: string;
    agentId: string;
    nodeType: "agent" | "task";
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
  onBreakpoint?: (request: BreakpointRequest) => void;
  /** Called when a cross-agent derivation value updates */
  onDerivationUpdate?: (event: { derivationId: string; value: unknown; timestamp: number }) => void;
  /** Called when a cross-agent derivation throws an error */
  onDerivationError?: (event: { derivationId: string; error: Error; timestamp: number }) => void;
  /** Called when scratchpad values are updated */
  onScratchpadUpdate?: (event: { keys: string[]; timestamp: number }) => void;
  /** Called when a task starts executing */
  onTaskStart?: (event: { patternId: string; taskId: string; label: string; timestamp: number }) => void;
  /** Called when a task completes successfully */
  onTaskComplete?: (event: { patternId: string; taskId: string; label: string; durationMs: number; timestamp: number }) => void;
  /** Called when a task fails */
  onTaskError?: (event: { patternId: string; taskId: string; label: string; error: Error; durationMs: number; timestamp: number }) => void;
  /** Called when a task reports progress */
  onTaskProgress?: (event: { patternId: string; taskId: string; label: string; percent: number; message?: string; timestamp: number }) => void;
  /** Called when a pattern checkpoint is saved */
  onCheckpointSave?: (event: {
    checkpointId: string;
    patternType: string;
    step: number;
    timestamp: number;
  }) => void;
  /** Called when a checkpoint save fails */
  onCheckpointError?: (event: {
    patternType: string;
    step: number;
    error: Error;
    timestamp: number;
  }) => void;
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
  /** Registered handler ID (agent or task) to run for this node */
  handler: string;
  /** Upstream node IDs this node depends on */
  deps?: string[];
  /** Conditional edge — evaluated when deps are met. @default unconditional */
  when?: (context: DagExecutionContext) => boolean;
  /** Build input string for this node's agent. @default JSON.stringify(upstream outputs) */
  transform?: (context: DagExecutionContext) => string;
  /** Per-node timeout (ms) */
  timeout?: number;
  /** Tiebreaker when multiple nodes are ready (higher = first). @default 0 */
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
  /** Error handling strategy. @default "fail" */
  onNodeError?: "fail" | "skip-downstream" | "continue";
  /** Checkpoint configuration for mid-execution fault tolerance */
  checkpoint?: PatternCheckpointConfig;
}

// ============================================================================
// Debug Configuration
// ============================================================================

/** Debug configuration for orchestrators */
export interface OrchestratorDebugConfig {
  /** Include truncated input/output in timeline events for prompt/completion viewing */
  verboseTimeline?: boolean;
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
  | "debate_round"
  | "reroute"
  | "checkpoint_save"
  | "checkpoint_restore"
  | "task_start"
  | "task_complete"
  | "task_error"
  | "task_progress";

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
  /** Truncated input text (only when verboseTimeline is enabled) */
  input?: string;
}

/** Agent complete event */
export interface AgentCompleteEvent extends DebugEventBase {
  type: "agent_complete";
  agentId: string;
  outputLength: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  modelId?: string;
  /** Truncated output text (only when verboseTimeline is enabled) */
  output?: string;
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
  patternType: "parallel" | "sequential" | "supervisor" | "dag" | "reflect" | "race" | "debate" | "goal";
}

/** Pattern complete event */
export interface PatternCompleteEvent extends DebugEventBase {
  type: "pattern_complete";
  patternId: string;
  patternType: "parallel" | "sequential" | "supervisor" | "dag" | "reflect" | "race" | "debate" | "goal";
  durationMs: number;
  error?: string;
}

/** DAG node update event */
export interface DagNodeUpdateEvent extends DebugEventBase {
  type: "dag_node_update";
  nodeId: string;
  status: DagNodeStatus;
  deps?: string[];
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

/** Reroute debug event recorded when self-healing reroutes to an alternate agent */
export interface RerouteDebugEvent extends DebugEventBase {
  type: "reroute";
  agentId: string;
  from: string;
  to: string;
  reason: string;
}

/** Checkpoint save event */
export interface CheckpointSaveEvent extends DebugEventBase {
  type: "checkpoint_save";
  checkpointId: string;
  patternType: string;
  step: number;
}

/** Checkpoint restore event */
export interface CheckpointRestoreEvent extends DebugEventBase {
  type: "checkpoint_restore";
  checkpointId: string;
  patternType: string;
  step: number;
}

/** Task start event */
export interface TaskStartEvent extends DebugEventBase {
  type: "task_start";
  taskId: string;
  label: string;
  description?: string;
  inputLength: number;
}

/** Task complete event */
export interface TaskCompleteEvent extends DebugEventBase {
  type: "task_complete";
  taskId: string;
  label: string;
  durationMs: number;
}

/** Task error event */
export interface TaskErrorEvent extends DebugEventBase {
  type: "task_error";
  taskId: string;
  label: string;
  error: string;
  durationMs: number;
  attempt?: number;
}

/** Task progress event */
export interface TaskProgressEvent extends DebugEventBase {
  type: "task_progress";
  taskId: string;
  label: string;
  percent: number;
  message?: string;
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
  | DebateRoundEvent
  | RerouteDebugEvent
  | CheckpointSaveEvent
  | CheckpointRestoreEvent
  | TaskStartEvent
  | TaskCompleteEvent
  | TaskErrorEvent
  | TaskProgressEvent;

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
  /** Rolling window for metrics (ms). @default 60000 */
  windowMs?: number;
  /** Weights for health score computation (must sum to ~1.0) */
  weights?: {
    /** Weight for success rate (0-1). @default 0.5 */
    successRate?: number;
    /** Weight for latency (0-1). @default 0.3 */
    latency?: number;
    /** Weight for circuit state (0-1). @default 0.2 */
    circuitState?: number;
  };
  /** Max latency considered "normal" (ms). @default 5000 */
  maxNormalLatencyMs?: number;
  /** Max events per agent before FIFO eviction. @default 1000 */
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
  /** Health score below which to trigger reroute. @default 30 */
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
  /** Health score below which to trigger reroute. @default 30 */
  healthThreshold?: number;
  /** Explicit equivalency groups (group name → agent IDs) */
  equivalencyGroups?: Record<string, string[]>;
  /** Use capability matching for implicit equivalency. @default true */
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

/** Breakpoint state stored in bridge schema — canonical definition in breakpoints.ts */
export type BreakpointState = BreakpointStateFromBreakpoints;

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

// ============================================================================
// Goal Pattern Types
// ============================================================================

/** A node in a goal execution pattern */
export interface GoalNode {
  /** Handler ID — agent or task registered on the orchestrator */
  handler: string;
  /** Fact keys this node can produce */
  produces: string[];
  /** Fact keys this node needs (must be satisfied before running) */
  requires?: string[];
  /** Allow re-run if input facts change after completion */
  allowRerun?: boolean;
  /** Priority for selection when multiple nodes are ready. Higher = first */
  priority?: number;
  /** Build the input string from current facts */
  buildInput?: (facts: Record<string, unknown>) => string;
  /** Extract output facts from the agent's result */
  extractOutput?: (result: RunResult<unknown>) => Record<string, unknown>;
}

/** Goal step metrics */
export interface GoalStepMetrics {
  step: number;
  durationMs: number;
  nodesRun: string[];
  factsProduced: string[];
  satisfaction: number;
  satisfactionDelta: number;
  tokensConsumed: number;
}

/** Goal progress metrics */
export interface GoalMetrics {
  satisfaction: number;
  progressRate: number;
  estimatedStepsRemaining: number | null;
  decelerating: boolean;
}

/** Agent selection strategy for goal pattern */
export interface AgentSelectionStrategy {
  /**
   * Select which ready agents to run this step.
   *
   * @param readyAgents - Agent IDs whose `requires` are satisfied
   * @param metrics - Per-agent performance metrics (runs, avgSatisfactionDelta, tokens)
   * @param goalMetrics - Global goal progress metrics. Built-in strategies use per-agent
   *   metrics only; this parameter enables custom strategies that account for overall goal
   *   progress (e.g., switching to cheaper agents as satisfaction approaches 1.0).
   */
  select: (
    readyAgents: string[],
    metrics: Record<string, { runs: number; avgSatisfactionDelta: number; tokens: number }>,
    goalMetrics: GoalMetrics,
  ) => string[];
}

/** Relaxation context passed to custom relaxation strategies */
export interface RelaxationContext {
  step: number;
  facts: Record<string, unknown>;
  metrics: GoalMetrics;
  completedNodes: Set<string>;
  failedNodes: Map<string, number>;
}

/** Relaxation strategy for when goal pursuit stalls */
export type RelaxationStrategy =
  | { type: "allow_rerun"; nodes: string[] }
  | { type: "alternative_nodes"; nodes: GoalNode[] }
  | { type: "inject_facts"; facts: Record<string, unknown> }
  | { type: "accept_partial" }
  | { type: "custom"; apply: (context: RelaxationContext) => void | Promise<void> };

/** Relaxation tier — progressively applied when goal pursuit stalls */
export interface RelaxationTier {
  label: string;
  /** Steps of no progress before applying. @default 3 */
  afterStallSteps?: number;
  strategy: RelaxationStrategy;
}

/** Record of a relaxation event */
export interface RelaxationRecord {
  step: number;
  tierIndex: number;
  label: string;
  strategy: RelaxationStrategy["type"];
}

/** Goal execution pattern — declare desired state, let the runtime resolve */
export interface GoalPattern<T = unknown> {
  type: "goal";
  /** Nodes with produces/requires declarations */
  nodes: Record<string, GoalNode>;
  /** Goal condition — when this returns true, the goal is achieved */
  when: (facts: Record<string, unknown>) => boolean;
  /** Quantitative satisfaction: 0.0 to 1.0. Enables progress tracking.
   *  If omitted, binary: 0.0 when when() is false, 1.0 when true. */
  satisfaction?: (facts: Record<string, unknown>) => number;
  /** Max goal steps. @default 50 */
  maxSteps?: number;
  /** Extract final result from achieved facts */
  extract?: (facts: Record<string, unknown>) => T;
  /** Timeout in ms. @default 300000 */
  timeout?: number;
  /** Abort signal */
  signal?: AbortSignal;
  /** Agent selection strategy. @default "all-ready" */
  selectionStrategy?: AgentSelectionStrategy;
  /** Relaxation tiers — progressively applied when goal pursuit stalls */
  relaxation?: RelaxationTier[];
  /** Lifecycle hooks */
  onStep?: (step: number, facts: Record<string, unknown>, readyAgents: string[]) => void;
  onStall?: (step: number, metrics: GoalMetrics) => void;
  /** Checkpoint configuration for mid-execution fault tolerance */
  checkpoint?: PatternCheckpointConfig;
}

/** Result of a goal pattern execution */
export interface GoalResult<T = unknown> {
  /** Whether the when() condition was satisfied */
  achieved: boolean;
  /** Final value (from extract, or raw facts) */
  result: T;
  /** Final facts state */
  facts: Record<string, unknown>;
  /** Nodes that ran, in execution order */
  executionOrder: string[];
  /** Per-node results */
  nodeResults: Record<string, RunResult<unknown>>;
  /** Total goal steps taken */
  steps: number;
  /** Total tokens consumed */
  totalTokens: number;
  /** Total duration (ms) */
  durationMs: number;
  /** Per-step metrics (satisfaction, nodes run, etc.) */
  stepMetrics: GoalStepMetrics[];
  /** Relaxation events applied */
  relaxations: RelaxationRecord[];
  /** Error message if goal was not achieved */
  error?: string;
}

// ============================================================================
// Pattern Checkpoint Types (Universal)
// ============================================================================

/** Universal checkpoint configuration for all execution patterns */
export interface PatternCheckpointConfig {
  /** Save a checkpoint every N steps/rounds/iterations. @default 5 */
  everyN?: number;
  /** Checkpoint store. Uses the orchestrator's store if not provided. */
  store?: import("./checkpoint.js").CheckpointStore;
  /** Label prefix for checkpoints. @default pattern type name */
  labelPrefix?: string;
  /** Conditional: only save when this returns true */
  when?: (context: CheckpointContext) => boolean;
}

/** Context passed to conditional checkpoint predicates */
export interface CheckpointContext {
  /** Current step/round/iteration number */
  step: number;
  /** Pattern type identifier */
  patternType: string;
  /** Pattern-specific facts (goal only) */
  facts?: Record<string, unknown>;
  /** Satisfaction score 0-1 (goal only) */
  satisfaction?: number;
}

/**
 * @deprecated Use `PatternCheckpointConfig` instead. Alias kept for backward compatibility.
 */
export type GoalCheckpointConfig = PatternCheckpointConfig;

// ---- Common checkpoint state fields ----

/** Common fields present on all pattern checkpoint states */
export interface PatternCheckpointBase {
  /** Checkpoint format version */
  version: 1;
  /** Unique ID */
  id: string;
  /** ISO timestamp */
  createdAt: string;
  /** User label */
  label?: string;
  /** Pattern ID */
  patternId: string;
  /** Total expected steps/rounds/iterations (null for unbounded) */
  stepsTotal?: number | null;
}

// ---- Per-pattern checkpoint states ----

/** Checkpoint state for sequential pattern */
export interface SequentialCheckpointState extends PatternCheckpointBase {
  type: "sequential";
  /** Next agent index to run */
  step: number;
  /** Current input for the next agent */
  currentInput: string;
  /** Results collected so far (output + tokens) */
  results: Array<{ agentId: string; output: unknown; totalTokens: number }>;
}

/** Checkpoint state for supervisor pattern */
export interface SupervisorCheckpointState extends PatternCheckpointBase {
  type: "supervisor";
  /** Next round number */
  round: number;
  /** Last supervisor output */
  supervisorOutput: unknown;
  /** Worker results so far */
  workerResults: Array<{ output: unknown; totalTokens: number }>;
  /** Current input to supervisor */
  currentInput: string;
}

/** Checkpoint state for reflect pattern */
export interface ReflectCheckpointState extends PatternCheckpointBase {
  type: "reflect";
  /** Next iteration number */
  iteration: number;
  /** Current effective input */
  effectiveInput: string;
  /** Iteration history */
  history: Array<{
    iteration: number;
    passed: boolean;
    score?: number;
    feedback?: string;
    durationMs: number;
    producerTokens: number;
    evaluatorTokens: number;
  }>;
  /** Producer outputs so far */
  producerOutputs: Array<{ output: unknown; score?: number }>;
  /** Last producer output */
  lastProducerOutput: unknown | null;
}

/** Checkpoint state for debate pattern */
export interface DebateCheckpointState extends PatternCheckpointBase {
  type: "debate";
  /** Next round number */
  round: number;
  /** Current input for the round */
  currentInput: string;
  /** Completed rounds */
  rounds: Array<{
    proposals: Array<{ agentId: string; output: unknown }>;
    judgement: { winnerId: string; feedback?: string; score?: number };
  }>;
  /** Last winning agent ID */
  lastWinnerId: string;
  /** Last winning output */
  lastWinnerOutput: unknown;
  /** Tokens consumed so far */
  tokensConsumed: number;
}

/** Checkpoint state for DAG pattern */
export interface DagCheckpointState extends PatternCheckpointBase {
  type: "dag";
  /** Per-node statuses */
  statuses: Record<string, DagNodeStatus>;
  /** Per-node outputs */
  outputs: Record<string, unknown>;
  /** Per-node errors */
  errors: Record<string, string>;
  /** Number of completed nodes */
  completedCount: number;
  /** Full results (output + tokens per node) */
  nodeResults: Record<string, { output: unknown; totalTokens: number }>;
  /** Original input */
  input: string;
}

/** Serializable mid-goal state for save/resume */
export interface GoalCheckpointState extends PatternCheckpointBase {
  /** Pattern type discriminator */
  type: "goal";
  /** Current step */
  step: number;
  /** Current facts snapshot */
  facts: Record<string, unknown>;
  /** Completed node IDs */
  completedNodes: string[];
  /** Failed node IDs with consecutive failure counts */
  failedNodes: Record<string, number>;
  /** Node input hashes (for allowRerun detection) */
  nodeInputHashes: Record<string, string>;
  /** Per-node results (serialized — output only, not the full RunResult) */
  nodeOutputs: Record<string, { output: unknown; totalTokens: number }>;
  /** Execution order so far */
  executionOrder: string[];
  /** Step metrics collected so far */
  stepMetrics: GoalStepMetrics[];
  /** Relaxations applied so far */
  relaxations: RelaxationRecord[];
  /** Applied relaxation tier index */
  appliedRelaxationTiers: number;
  /** Stall step counter */
  stallSteps: number;
  /** Last satisfaction value */
  lastSatisfaction: number;
  /** Per-agent metrics */
  agentMetrics: Record<string, { runs: number; totalDelta: number; tokens: number }>;
}

/** Discriminated union of all pattern checkpoint states */
export type PatternCheckpointState =
  | SequentialCheckpointState
  | SupervisorCheckpointState
  | ReflectCheckpointState
  | DebateCheckpointState
  | DagCheckpointState
  | GoalCheckpointState;

// ---- Checkpoint utilities ----

/** Progress computed from a checkpoint state */
export interface CheckpointProgress {
  /** 0-100 percentage complete */
  percentage: number;
  /** Steps/rounds/iterations completed */
  stepsCompleted: number;
  /** Total expected steps (null for unbounded patterns) */
  stepsTotal: number | null;
  /** Tokens consumed so far */
  tokensConsumed: number;
  /** Estimated tokens remaining (null when unknowable) */
  estimatedTokensRemaining: number | null;
  /** Estimated steps remaining (null when unknowable) */
  estimatedStepsRemaining: number | null;
}

/** Diff between two checkpoint states */
export interface CheckpointDiff {
  /** Pattern type */
  patternType: string;
  /** Step/round/iteration difference */
  stepDelta: number;
  /** Token difference */
  tokensDelta: number;
  /** Fact changes (goal only) */
  facts?: {
    added: string[];
    removed: string[];
    changed: Array<{ key: string; before: unknown; after: unknown }>;
  };
  /** Nodes completed between checkpoints (DAG/goal) */
  nodesCompleted?: string[];
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
