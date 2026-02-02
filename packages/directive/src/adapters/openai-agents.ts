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
  Schema,
  Plugin,
  System,
  Facts,
} from "../core/types.js";
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
  facts: Facts<Schema> & F & OrchestratorState;
  runAgent: <T>(agent: AgentLike, input: string, options?: RunOptions) => Promise<RunResult<T>>;
  signal: AbortSignal;
}

/** Resolver for orchestrator */
export interface OrchestratorResolver<
  F extends Record<string, unknown>,
  R extends Requirement = Requirement
> {
  handles: (req: Requirement) => req is R;
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
  plugins?: Array<Plugin<Schema>>;
  /** Enable debugging */
  debug?: boolean;
}

/** Orchestrator instance */
export interface AgentOrchestrator<F extends Record<string, unknown>> {
  system: System<Schema>;
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

  // Build schema
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schema: any = {
    agent: t.object<Record<string, unknown>>(),
    approval: t.object<Record<string, unknown>>(),
    conversation: t.array<Record<string, unknown>>(),
    toolCalls: t.array<Record<string, unknown>>(),
    ...factsSchema,
  };

  // Convert constraints
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const directiveConstraints: Record<string, any> = {};
  for (const [id, constraint] of Object.entries(constraints)) {
    const requireFn = constraint.require;
    directiveConstraints[id] = {
      priority: constraint.priority ?? 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      when: (facts: any) => constraint.when(facts as F & OrchestratorState),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      require: typeof requireFn === "function"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? (facts: any) => requireFn(facts as F & OrchestratorState)
        : requireFn,
    };
  }

  // Add built-in constraints
  if (maxTokenBudget) {
    directiveConstraints["__budgetLimit"] = {
      priority: 100, // High priority
      when: (facts: { agent: AgentState }) => facts.agent.tokenUsage > maxTokenBudget,
      require: { type: "__PAUSE_BUDGET_EXCEEDED" },
    };
  }

  // Convert resolvers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const directiveResolvers: Record<string, any> = {};

  // Built-in pause resolver
  directiveResolvers["__pause"] = {
    handles: (req: Requirement): req is { type: "__PAUSE_BUDGET_EXCEEDED" } =>
      req.type === "__PAUSE_BUDGET_EXCEEDED",
    resolve: async (_req: Requirement, ctx: { facts: { agent: AgentState } }) => {
      ctx.facts.agent = {
        ...ctx.facts.agent,
        status: "paused",
      };
    },
  };

  // User resolvers
  for (const [id, resolver] of Object.entries(resolvers)) {
    directiveResolvers[id] = {
      handles: resolver.handles,
      key: resolver.key,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolve: async (req: Requirement, ctx: any) => {
        const orchestratorCtx: OrchestratorResolverContext<F> = {
          facts: ctx.facts as unknown as Facts<Schema> & F & OrchestratorState,
          runAgent: async <T>(
            agent: AgentLike,
            input: string,
            opts?: RunOptions
          ) => {
            return runAgentWithGuardrails<T>(
              agent,
              input,
              ctx.facts as unknown as F & OrchestratorState,
              opts
            );
          },
          signal: ctx.signal,
        };
        await resolver.resolve(req, orchestratorCtx);
      },
    };
  }

  // Create module
  const orchestratorModule = createModule("openai-agents-orchestrator", {
    schema,
    init: (facts) => {
      facts.agent = {
        status: "idle",
        currentAgent: null,
        input: null,
        output: null,
        error: null,
        tokenUsage: 0,
        turnCount: 0,
        startedAt: null,
        completedAt: null,
      };
      facts.approval = {
        pending: [],
        approved: [],
        rejected: [],
      };
      facts.conversation = [];
      facts.toolCalls = [];
      init?.(facts as unknown as F & OrchestratorState);
    },
    constraints: directiveConstraints as unknown as Parameters<typeof createModule>[1]["constraints"],
    resolvers: directiveResolvers as unknown as Parameters<typeof createModule>[1]["resolvers"],
  });

  // Create system
  // Use type assertion to work around Schema generic variance issues
  const system = createSystem({
    modules: [orchestratorModule as unknown as Parameters<typeof createSystem>[0]["modules"][0]],
    plugins: plugins as unknown as Array<Plugin<Schema>>,
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
    const facts = system.facts as unknown as F & OrchestratorState;

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
      facts.agent = {
        ...facts.agent,
        status: "running",
        currentAgent: agent.name,
        input,
        startedAt: Date.now(),
      };
    });

    // Run the agent
    const result = await runAgent<T>(agent, input, {
      ...opts,
      signal: opts?.signal,
      onMessage: (message) => {
        system.facts.conversation = [...facts.conversation, message];
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
            facts.approval = {
              ...facts.approval,
              pending: [...facts.approval.pending, approvalRequest],
            };
          });

          onApprovalRequest?.(approvalRequest);

          // Wait for approval
          await waitForApproval(approvalId);
        }

        system.facts.toolCalls = [...facts.toolCalls, toolCall];
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
      facts.agent = {
        ...facts.agent,
        status: "completed",
        output: result.finalOutput,
        tokenUsage: facts.agent.tokenUsage + result.totalTokens,
        turnCount: facts.agent.turnCount + result.messages.length,
        completedAt: Date.now(),
      };
    });

    return result;
  }

  // Wait for approval
  function waitForApproval(requestId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const unsubscribe = system.facts.$store.subscribe(["approval"], () => {
        const approval = system.facts.approval as ApprovalState;
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

  const orchestrator: AgentOrchestrator<F> = {
    system: system as System<Schema>,
    facts: system.facts as unknown as F & OrchestratorState,

    async run<T>(agent: AgentLike, input: string): Promise<RunResult<T>> {
      return runAgentWithGuardrails<T>(agent, input, system.facts as unknown as F & OrchestratorState) as Promise<RunResult<T>>;
    },

    approve(requestId: string): void {
      const approval = (system.facts as unknown as OrchestratorState).approval;
      system.batch(() => {
        (system.facts as unknown as OrchestratorState).approval = {
          ...approval,
          pending: approval.pending.filter((r) => r.id !== requestId),
          approved: [...approval.approved, requestId],
        };
      });
    },

    reject(requestId: string, _reason?: string): void {
      const approval = (system.facts as unknown as OrchestratorState).approval;
      system.batch(() => {
        (system.facts as unknown as OrchestratorState).approval = {
          ...approval,
          pending: approval.pending.filter((r) => r.id !== requestId),
          rejected: [...approval.rejected, requestId],
        };
      });
    },

    pause(): void {
      (system.facts as unknown as OrchestratorState).agent = {
        ...((system.facts as unknown as OrchestratorState).agent),
        status: "paused",
      };
    },

    resume(): void {
      const agent = (system.facts as unknown as OrchestratorState).agent;
      if (agent.status === "paused") {
        (system.facts as unknown as OrchestratorState).agent = {
          ...agent,
          status: agent.currentAgent ? "running" : "idle",
        };
      }
    },

    reset(): void {
      const facts = system.facts as unknown as OrchestratorState;
      system.batch(() => {
        facts.agent = {
          status: "idle",
          currentAgent: null,
          input: null,
          output: null,
          error: null,
          tokenUsage: 0,
          turnCount: 0,
          startedAt: null,
          completedAt: null,
        };
        facts.approval = {
          pending: [],
          approved: [],
          rejected: [],
        };
        facts.conversation = [];
        facts.toolCalls = [];
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

    // Check limits
    const orchestratorState = context.facts as unknown as OrchestratorState | undefined;
    const tokenUsage = orchestratorState?.agent?.tokenUsage ?? 0;
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
