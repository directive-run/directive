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

/** Guardrails configuration */
export interface GuardrailsConfig {
  /** Validate/transform input before agent runs */
  input?: GuardrailFn<InputGuardrailData>[];
  /** Validate/transform output after agent runs */
  output?: GuardrailFn<OutputGuardrailData>[];
  /** Validate tool calls before execution */
  toolCall?: GuardrailFn<ToolCallGuardrailData>[];
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
}

/** Orchestrator instance */
export interface AgentOrchestrator<F extends Record<string, unknown>> {
  // biome-ignore lint/suspicious/noExplicitAny: System type varies
  system: System<any>;
  facts: F & OrchestratorState;
  /** Run an agent with guardrails */
  run<T>(agent: AgentLike, input: string): Promise<RunResult<T>>;
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
  } = options;

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
    for (const guardrail of guardrails.input ?? []) {
      const result = await guardrail(
        { input, agentName: agent.name },
        {
          agentName: agent.name,
          input,
          facts: system.facts.$store.toObject(),
        }
      );
      if (!result.passed) {
        throw new Error(`Input guardrail failed: ${result.reason}`);
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
        for (const guardrail of guardrails.toolCall ?? []) {
          const guardResult = await guardrail(
            { toolCall, agentName: agent.name, input },
            {
              agentName: agent.name,
              input,
              facts: system.facts.$store.toObject(),
            }
          );
          if (!guardResult.passed) {
            throw new Error(`Tool call guardrail failed: ${guardResult.reason}`);
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
    for (const guardrail of guardrails.output ?? []) {
      const guardResult = await guardrail(
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
        throw new Error(`Output guardrail failed: ${guardResult.reason}`);
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

  // Wait for approval
  function waitForApproval(requestId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const unsubscribe = system.facts.$store.subscribe([APPROVAL_KEY], () => {
        const approval = getApprovalState(system.facts);
        if (approval.approved.includes(requestId)) {
          unsubscribe();
          resolve();
        } else if (approval.rejected.includes(requestId)) {
          unsubscribe();
          reject(new Error("Request rejected"));
        }
      });
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

    reject(requestId: string, _reason?: string): void {
      system.batch(() => {
        const approval = getApprovalState(system.facts);
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

/**
 * Create a rate limit guardrail based on token usage.
 *
 * @example
 * ```typescript
 * const rateLimitGuardrail = createRateLimitGuardrail({
 *   maxTokensPerMinute: 10000,
 *   maxRequestsPerMinute: 60,
 * });
 * ```
 */
export function createRateLimitGuardrail(options: {
  maxTokensPerMinute?: number;
  maxRequestsPerMinute?: number;
}): GuardrailFn<InputGuardrailData> {
  const { maxTokensPerMinute = 100000, maxRequestsPerMinute = 60 } = options;

  const tokenHistory: number[] = [];
  const requestHistory: number[] = [];
  const windowMs = 60000;

  return (_data, context) => {
    const now = Date.now();

    // Clean old entries
    while (tokenHistory.length > 0 && (tokenHistory[0] ?? 0) < now - windowMs) {
      tokenHistory.shift();
    }
    while (requestHistory.length > 0 && (requestHistory[0] ?? 0) < now - windowMs) {
      requestHistory.shift();
    }

    // Check limits - safely extract token usage from context facts
    const factsObj = context.facts as Record<string, unknown>;
    const agentState = factsObj[AGENT_KEY] as AgentState | undefined;
    const tokenUsage = agentState?.tokenUsage ?? 0;
    const recentTokens = tokenHistory.length;
    const recentRequests = requestHistory.length;

    if (recentTokens + tokenUsage > maxTokensPerMinute) {
      return { passed: false, reason: "Token rate limit exceeded" };
    }

    if (recentRequests >= maxRequestsPerMinute) {
      return { passed: false, reason: "Request rate limit exceeded" };
    }

    // Record this request
    requestHistory.push(now);
    tokenHistory.push(now);

    return { passed: true };
  };
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
}): GuardrailFn<ToolCallGuardrailData> {
  const { allowlist, denylist } = options;

  return (data) => {
    const toolName = data.toolCall.name;

    if (allowlist && !allowlist.includes(toolName)) {
      return { passed: false, reason: `Tool "${toolName}" not in allowlist` };
    }

    if (denylist && denylist.includes(toolName)) {
      return { passed: false, reason: `Tool "${toolName}" is blocked` };
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
