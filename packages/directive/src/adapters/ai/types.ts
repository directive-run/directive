/**
 * Shared types for AI adapter — used by orchestrator, guardrails, helpers, and stack.
 */

import type { Requirement, ModuleSchema } from "../../core/types.js";
import { t } from "../../core/facts.js";

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
  /** True when result was served from semantic cache */
  isCached?: boolean;
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

/** Run options */
export interface RunOptions {
  maxTurns?: number;
  signal?: AbortSignal;
  onMessage?: (message: Message) => void;
  onToolCall?: (toolCall: ToolCall) => void;
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
  /** @default 1 */
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
  resolve: (req: R, ctx: OrchestratorResolverContext<F>) => void | Promise<void>;
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

/** Bridge schema for orchestrator */
export const orchestratorBridgeSchema = {
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
