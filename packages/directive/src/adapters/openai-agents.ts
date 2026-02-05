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
  role: "user" | "assistant" | "tool";
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

/** Named guardrail for better debugging */
export interface NamedGuardrail<T = unknown> {
  /** Unique name for debugging and error messages */
  name: string;
  /** The guardrail function */
  fn: GuardrailFn<T>;
  /** Whether this guardrail is critical (default: true) */
  critical?: boolean;
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
  rejected: string[];
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
  /** Auto-approve tool calls (default: false) */
  autoApproveToolCalls?: boolean;
  /** Max token budget */
  maxTokenBudget?: number;
  /** Plugins */
  plugins?: Plugin[];
  /** Enable debugging */
  debug?: boolean;
  /** Approval timeout in milliseconds (default: 300000 = 5 minutes) */
  approvalTimeoutMs?: number;
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
  /** Destroy the orchestrator */
  destroy(): void;
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
  } = options;

  // Warn if approval workflow is configured but no callback is provided
  if (!autoApproveToolCalls && !onApprovalRequest) {
    console.warn(
      "[Directive] autoApproveToolCalls is false but no onApprovalRequest callback provided. " +
      "Tool calls will wait for approval indefinitely. Either:\n" +
      "  - Set autoApproveToolCalls: true to auto-approve all tool calls\n" +
      "  - Provide an onApprovalRequest callback to handle approvals\n" +
      "  - Call orchestrator.approve(requestId) or orchestrator.reject(requestId) manually"
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
    // Run input guardrails
    const inputGuardrails = (guardrails.input ?? []).map((g, i) =>
      normalizeGuardrail(g, i, "input")
    );
    for (const { name, fn } of inputGuardrails) {
      const result = await fn(
        { input, agentName: agent.name },
        {
          agentName: agent.name,
          input,
          facts: system.facts.$store.toObject(),
        }
      );
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

    // Run the agent
    const result = await runAgent<T>(agent, input, {
      ...opts,
      signal: opts?.signal,
      onMessage: (message) => {
        const currentConversation = getConversation(system.facts);
        setConversation(system.facts, [...currentConversation, message]);
        opts?.onMessage?.(message);
      },
      onToolCall: async (toolCall) => {
        // Run tool call guardrails
        const toolCallGuardrails = (guardrails.toolCall ?? []).map((g, i) =>
          normalizeGuardrail(g, i, "toolCall")
        );
        for (const { name, fn } of toolCallGuardrails) {
          const guardResult = await fn(
            { toolCall, agentName: agent.name, input },
            {
              agentName: agent.name,
              input,
              facts: system.facts.$store.toObject(),
            }
          );
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
    });

    // Run output guardrails
    const outputGuardrails = (guardrails.output ?? []).map((g, i) =>
      normalizeGuardrail(g, i, "output")
    );
    for (const { name, fn } of outputGuardrails) {
      const guardResult = await fn(
        {
          output: result.finalOutput,
          agentName: agent.name,
          input,
          messages: result.messages,
        },
        {
          agentName: agent.name,
          input,
          facts: system.facts.$store.toObject(),
        }
      );
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
        } else if (approval.rejected.includes(requestId)) {
          cleanup();
          unsubscribe();
          reject(new Error(`Request ${requestId} rejected`));
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
          // Run input guardrails first
          let processedInput = input;
          const inputGuardrails = (guardrails.input ?? []).map((g, i) =>
            normalizeGuardrail(g, i, "input")
          );
          for (const { name, fn } of inputGuardrails) {
            const result = await fn(
              { input: processedInput, agentName: agent.name },
              {
                agentName: agent.name,
                input: processedInput,
                facts: system.facts.$store.toObject(),
              }
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

          // Run agent with streaming callbacks
          const result = await runAgent<T>(agent, processedInput, {
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

              // Run tool call guardrails
              const toolCallGuardrails = (guardrails.toolCall ?? []).map((g, i) =>
                normalizeGuardrail(g, i, "toolCall")
              );
              for (const { name, fn } of toolCallGuardrails) {
                const guardResult = await fn(
                  { toolCall, agentName: agent.name, input: processedInput },
                  {
                    agentName: agent.name,
                    input: processedInput,
                    facts: system.facts.$store.toObject(),
                  }
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
          });

          // Run output guardrails
          pushChunk({ type: "progress", phase: "finishing", message: "Running output guardrails" });

          const outputGuardrails = (guardrails.output ?? []).map((g, i) =>
            normalizeGuardrail(g, i, "output")
          );
          for (const { name, fn } of outputGuardrails) {
            const guardResult = await fn(
              {
                output: result.finalOutput,
                agentName: agent.name,
                input: processedInput,
                messages: result.messages,
              },
              {
                agentName: agent.name,
                input: processedInput,
                facts: system.facts.$store.toObject(),
              }
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
        // Note: reason is available for logging/audit purposes
        if (reason && debug) {
          console.debug(`[Directive] Request ${requestId} rejected: ${reason}`);
        }
        setApprovalState(system.facts, {
          ...approval,
          pending: approval.pending.filter((r) => r.id !== requestId),
          rejected: [...approval.rejected, requestId],
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

    destroy(): void {
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
 * Create a tool whitelist/blacklist guardrail.
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
  /** Case-sensitive matching (default: false for more robust matching) */
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

/**
 * Get total cost estimate based on token usage.
 */
export function estimateCost(
  tokenUsage: number,
  ratePerMillionTokens: number = 3.0
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
  build(options: { runAgent: RunFn }): AgentOrchestrator<F>;
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

export { type Embedding } from "./guardrails/semantic-cache.js";

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
