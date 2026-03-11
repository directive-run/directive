/**
 * Agent Orchestrator — constraint-driven agent execution with guardrails.
 *
 * Single-agent orchestrator backed by a Directive System with reactive state,
 * constraints, guardrails, streaming, approval workflow, and lifecycle hooks.
 */

import type {
  ModuleSchema,
  Plugin,
  Requirement,
  SingleModuleSystem,
  System,
} from "@directive-run/core";
import { createModule, t } from "@directive-run/core";
import { createSystem } from "@directive-run/core";
import {
  createCallbackPlugin,
  getBridgeFact,
  requirementGuard,
  setBridgeFact,
} from "@directive-run/core/adapter-utils";
import type { CircuitBreaker } from "@directive-run/core/plugins";
import type { AgentMemory } from "./memory.js";
import type { StreamChunk as StreamChunkBase } from "./streaming.js";

import type {
  AgentLike,
  AgentRetryConfig,
  AgentRunner,
  ApprovalRequest,
  GuardrailFn,
  GuardrailsConfig,
  InputGuardrailData,
  NamedGuardrail,
  OrchestratorConstraint,
  OrchestratorLifecycleHooks,
  OrchestratorResolver,
  OrchestratorState,
  OutputGuardrailData,
  RejectedRequest,
  RerouteEvent,
  RunOptions,
  RunResult,
  SelfHealingConfig,
} from "./types.js";

import {
  APPROVAL_KEY,
  BREAKPOINT_KEY,
  GuardrailError,
  orchestratorBridgeSchema,
} from "./types.js";

import {
  type DebugTimeline,
  createDebugTimeline,
  createDebugTimelinePlugin,
} from "./debug-timeline.js";

import {
  executeAgentWithRetry,
  executeGuardrailWithRetry,
  normalizeGuardrail,
} from "./guardrail-utils.js";

import {
  convertOrchestratorConstraints,
  convertOrchestratorResolvers,
  getAgentState,
  getApprovalState,
  getBreakpointState,
  getConversation,
  getOrchestratorState,
  getToolCalls,
  setAgentState,
  setApprovalState,
  setBreakpointState,
  setConversation,
  setToolCalls,
} from "./orchestrator-bridge.js";

import type {
  BreakpointConfig,
  BreakpointContext,
  BreakpointModifications,
  BreakpointRequest,
} from "./breakpoints.js";
import {
  MAX_BREAKPOINT_HISTORY,
  createBreakpointId,
  matchBreakpoint,
} from "./breakpoints.js";
import {
  type Checkpoint,
  type CheckpointStore,
  createCheckpointId,
  validateCheckpoint,
} from "./checkpoint.js";
import {
  type SafeParseable,
  withStructuredOutput,
} from "./structured-output.js";

// Bridge accessors and constraint/resolver converters imported from orchestrator-bridge.ts

/** Maximum conversation messages retained (FIFO eviction) */
const MAX_CONVERSATION_MESSAGES = 500;
/** Maximum tool calls retained (FIFO eviction) */
const MAX_TOOL_CALLS = 200;

/** Built-in pause requirement type */
interface PauseBudgetExceededReq extends Requirement {
  type: "__PAUSE_BUDGET_EXCEEDED";
}

// ============================================================================
// Exported Types
// ============================================================================

/** Orchestrator options */
export interface OrchestratorOptions<F extends Record<string, unknown>> {
  /** Function to run an agent */
  runner: AgentRunner;
  /**
   * Schema for custom facts tracked in the orchestrator's Directive System.
   * @example
   * ```typescript
   * import { t } from '@directive-run/core';
   * const orchestrator = createOrchestrator({
   *   factsSchema: { confidence: t.number(), category: t.string() },
   *   // ...
   * });
   * ```
   */
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
  /** Fires when token usage reaches this percentage of maxTokenBudget (0-1). @default 0.8 */
  budgetWarningThreshold?: number;
  /** Callback when budget warning threshold is reached */
  onBudgetWarning?: (event: {
    currentTokens: number;
    maxBudget: number;
    percentage: number;
  }) => void;
  /** Plugins */
  plugins?: Plugin[];
  /**
   * Enable debugging — `true` for default debug, or config object for advanced options
   * @default false
   */
  debug?: boolean | import("./types.js").OrchestratorDebugConfig;
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
  /** Self-healing configuration for automatic fallback */
  selfHealing?: SelfHealingConfig;
  /**
   * Default schema for structured output. When set, agent output is parsed and
   * validated against this schema with automatic retry on failure.
   * Any Zod-compatible schema (anything with `safeParse`) works.
   */
  outputSchema?: SafeParseable<unknown>;
  /**
   * Max retries for structured output parsing.
   * @default 2
   */
  maxSchemaRetries?: number;
  /** Optional checkpoint store for save/restore workflow state. */
  checkpointStore?: CheckpointStore;
  /**
   * Breakpoint configurations for human-in-the-loop pause points.
   * Zero overhead when empty — guard checks at each insertion point.
   */
  breakpoints?: BreakpointConfig[];
  /** Callback fired when a breakpoint is hit and waiting for resolution. */
  onBreakpoint?: (request: BreakpointRequest) => void;
  /**
   * Timeout for breakpoint resolution in milliseconds.
   * @default 300000 (5 minutes)
   */
  breakpointTimeoutMs?: number;
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

/** Stream chunk types for orchestrator — extends StreamChunk with approval events */
export type OrchestratorStreamChunk =
  | StreamChunkBase
  | { type: "approval_required"; requestId: string; toolName: string }
  | { type: "approval_resolved"; requestId: string; approved: boolean };

/** Per-call options for run() */
export interface RunCallOptions {
  /** Override output guardrails for this call only. Set to [] to skip. */
  outputGuardrails?: Array<
    GuardrailFn<OutputGuardrailData> | NamedGuardrail<OutputGuardrailData>
  >;
  /** Override input guardrails for this call only. Set to [] to skip. */
  inputGuardrails?: Array<
    GuardrailFn<InputGuardrailData> | NamedGuardrail<InputGuardrailData>
  >;
  /** Signal for abort */
  signal?: AbortSignal;
  /** Override structured output schema for this call. Set to `null` to opt out. */
  outputSchema?: SafeParseable<unknown> | null;
  /** Override max schema retries for this call. */
  maxSchemaRetries?: number;
}

/** Orchestrator instance */
export interface AgentOrchestrator<F extends Record<string, unknown>> {
  // biome-ignore lint/suspicious/noExplicitAny: System type varies
  system: System<any>;
  facts: F & OrchestratorState;
  /** Run an agent with guardrails. Pass options to override guardrails per-call. */
  run<T>(
    agent: AgentLike,
    input: string,
    options?: RunCallOptions,
  ): Promise<RunResult<T>>;
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
  runStream<T>(
    agent: AgentLike,
    input: string,
    options?: { signal?: AbortSignal },
  ): OrchestratorStreamResult<T>;
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
  /** Total tokens consumed across all agent runs */
  readonly totalTokens: number;
  /** Debug timeline (null when debug is false) */
  readonly timeline: DebugTimeline | null;
  /** Wait until agent is idle. Resolves immediately if already idle. */
  waitForIdle(timeoutMs?: number): Promise<void>;
  /** Create a checkpoint of the current orchestrator state. Only valid when agent is not running. */
  checkpoint(options?: { label?: string }): Promise<Checkpoint>;
  /** Restore orchestrator state from a checkpoint. */
  restore(
    checkpoint: Checkpoint,
    options?: { restoreTimeline?: boolean },
  ): void;
  /** Resume a pending breakpoint, optionally with input modifications. */
  resumeBreakpoint(id: string, modifications?: BreakpointModifications): void;
  /** Cancel a pending breakpoint with optional reason. */
  cancelBreakpoint(id: string, reason?: string): void;
  /** Get all currently pending breakpoint requests. */
  getPendingBreakpoints(): BreakpointRequest[];
  /** Dispose of the orchestrator */
  dispose(): void;
}

// ============================================================================
// Main Factory
// ============================================================================

/**
 * Create a constraint-driven agent orchestrator backed by a Directive System.
 *
 * Wraps a single agent runner with reactive state, guardrails, streaming,
 * approval workflows, breakpoints, structured output, and lifecycle hooks.
 * Constraints and resolvers let you declaratively control agent behavior
 * based on runtime facts.
 *
 * @param options - Orchestrator configuration including runner, guardrails, constraints, and plugins.
 * @returns An {@link AgentOrchestrator} instance with `run`, `runStream`, `approve`/`reject`, and checkpoint APIs.
 *
 * @example
 * ```typescript
 * import { run as runner } from '@openai/agents';
 *
 * const orchestrator = createAgentOrchestrator({
 *   runner,
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
 * @throws If autoApproveToolCalls is false but no onApprovalRequest callback is provided
 * @public
 */
export function createAgentOrchestrator<
  F extends Record<string, unknown> = Record<string, never>,
>(options: OrchestratorOptions<F>): AgentOrchestrator<F> {
  const {
    runner,
    factsSchema = {},
    init,
    constraints = {},
    resolvers = {},
    guardrails = {},
    onApprovalRequest,
    autoApproveToolCalls = true,
    maxTokenBudget,
    budgetWarningThreshold = 0.8,
    onBudgetWarning,
    plugins = [],
    debug: rawDebug = false,
    approvalTimeoutMs = 300000,
    agentRetry,
    hooks = {},
    memory,
    circuitBreaker,
    selfHealing,
    outputSchema,
    maxSchemaRetries,
    checkpointStore,
    breakpoints,
    onBreakpoint,
    breakpointTimeoutMs,
  } = options;

  // Normalize debug config
  const debug = typeof rawDebug === "object" ? true : !!rawDebug;
  const MAX_VERBOSE_LENGTH = 5000;

  // Warn if selfHealing is configured without circuitBreaker (selfHealing only triggers in CB error path)
  if (debug && selfHealing && !circuitBreaker) {
    console.warn(
      "[Directive] selfHealing config has no effect without a circuitBreaker — " +
        "fallback behavior requires the circuit breaker to detect failures.",
    );
  }

  // Validate budget warning threshold
  if (budgetWarningThreshold < 0 || budgetWarningThreshold > 1) {
    throw new Error(
      `[Directive Orchestrator] budgetWarningThreshold must be between 0 and 1, got ${budgetWarningThreshold}`,
    );
  }

  // Enforce approval workflow configuration - require either auto-approve or callback
  if (!autoApproveToolCalls && !onApprovalRequest) {
    throw new Error(
      "[Directive] Invalid approval configuration: autoApproveToolCalls is false but no onApprovalRequest callback provided. " +
        "Tool calls would wait for approval indefinitely. Either:\n" +
        "  - Set autoApproveToolCalls: true to auto-approve all tool calls\n" +
        "  - Provide an onApprovalRequest callback to handle approvals programmatically",
    );
  }

  /** Safe hook caller — user-provided hooks must never crash the orchestrator */
  function fireHook<K extends keyof OrchestratorLifecycleHooks>(
    name: K,
    event: Parameters<NonNullable<OrchestratorLifecycleHooks[K]>>[0],
  ): void {
    try {
      (hooks[name] as ((e: typeof event) => void) | undefined)?.(event);
    } catch (hookError) {
      if (debug) {
        console.debug(`[Directive] hooks.${name} threw:`, hookError);
      }
    }
  }

  // Dev-mode: validate that user-provided facts keys don't collide with bridge state keys
  const RESERVED_ORCHESTRATOR_KEYS = [
    "agent",
    "approval",
    "conversation",
    "toolCalls",
  ];
  for (const key of Object.keys(factsSchema)) {
    if (RESERVED_ORCHESTRATOR_KEYS.includes(key)) {
      throw new Error(
        `[Directive] Facts schema key "${key}" conflicts with orchestrator state. ` +
          `Reserved keys: ${RESERVED_ORCHESTRATOR_KEYS.join(", ")}. ` +
          "Rename your fact to avoid the collision.",
      );
    }
  }

  // Build schema by combining bridge schema with user-provided schema
  const combinedSchema = {
    facts: {
      ...orchestratorBridgeSchema.facts,
      ...factsSchema,
      __budgetWarningFired: t.boolean(),
    },
    derivations: {},
    events: {},
    requirements: {},
  } satisfies ModuleSchema;

  // Forward declaration for runAgentWithGuardrails (used in resolver converter)
  // biome-ignore lint/style/useConst: forward declaration, assigned later
  let runAgentWithGuardrailsFn: <T>(
    agent: AgentLike,
    input: string,
    currentFacts: F & OrchestratorState,
    opts?: RunOptions,
    callOptions?: RunCallOptions,
  ) => Promise<RunResult<T>>;

  // Forward declaration for system (used in resolver converter)
  // biome-ignore lint/style/useConst: forward declaration, assigned later
  // biome-ignore lint/suspicious/noExplicitAny: System type varies
  let system: SingleModuleSystem<any>;

  // Convert user constraints
  // biome-ignore lint/suspicious/noExplicitAny: Constraint types are complex
  const directiveConstraints: Record<string, any> =
    convertOrchestratorConstraints<F>(constraints);

  // Add built-in budget limit constraint
  if (maxTokenBudget) {
    directiveConstraints.__budgetLimit = {
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
      (agent, input, currentFacts, opts) =>
        runAgentWithGuardrailsFn(agent, input, currentFacts, opts),
      () => system.facts,
    );

  // Add built-in pause resolver
  directiveResolvers.__pause = {
    requirement: requirementGuard<PauseBudgetExceededReq>(
      "__PAUSE_BUDGET_EXCEEDED",
    ),
    // biome-ignore lint/suspicious/noExplicitAny: Context type varies
    resolve: async (_req: Requirement, context: any) => {
      const currentAgent = getAgentState(context.facts);
      setAgentState(context.facts, {
        ...currentAgent,
        status: "paused",
      });
    },
  };

  // ---- Debug Timeline setup ----
  let timeline: DebugTimeline | null = null;
  if (debug) {
    timeline = createDebugTimeline({
      getSnapshotId: () => {
        try {
          return (system as any).history?.currentIndex ?? null;
        } catch {
          return null;
        }
      },
      goToSnapshot: (snapshotId: number) => {
        try {
          (system as any).history?.goTo?.(snapshotId);
        } catch {
          // System may not support goTo
        }
      },
    });
  }

  // Create callback plugin for onApprovalRequest
  const callbackPlugin = createCallbackPlugin(
    "directive-ai-callbacks",
    {}, // No requirement callbacks needed, approval is handled separately
  );

  // Create module
  // biome-ignore lint/suspicious/noExplicitAny: Bridge module uses dynamic constraints/resolvers
  const orchestratorModule = createModule("directive-ai-orchestrator", {
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
      setBreakpointState(facts, { pending: [], resolved: [], cancelled: [] });
      setBridgeFact(facts, "__budgetWarningFired", false);
      if (init) {
        const state = getOrchestratorState(facts);
        const combinedFacts = { ...facts, ...state } as unknown as F &
          OrchestratorState;
        init(combinedFacts);
      }
    },
    constraints: directiveConstraints,
    resolvers: directiveResolvers as any,
  });

  // Build plugins array with optional timeline plugin
  const allPlugins = [...plugins, callbackPlugin];
  if (debug && timeline) {
    allPlugins.push(
      createDebugTimelinePlugin(timeline, () => {
        try {
          return (system as any).history?.currentIndex ?? null;
        } catch {
          return null;
        }
      }),
    );
  }

  // Create system
  system = createSystem({
    module: orchestratorModule,
    plugins: allPlugins,
    history: debug ? true : undefined,
  });

  system.start();

  // Helper to run agent with guardrails
  async function runAgentWithGuardrails<T>(
    agent: AgentLike,
    input: string,
    _currentFacts: F & OrchestratorState,
    opts?: RunOptions,
    callOptions?: RunCallOptions,
  ): Promise<RunResult<T>> {
    // Wrap in circuit breaker if configured
    if (circuitBreaker) {
      try {
        return await circuitBreaker.execute(() =>
          runAgentWithGuardrailsInner<T>(
            agent,
            input,
            _currentFacts,
            opts,
            callOptions,
          ),
        );
      } catch (error) {
        // Self-healing fallback
        if (selfHealing) {
          // Try fallback runners in order
          if (selfHealing.fallbackRunners) {
            for (const fallbackRunner of selfHealing.fallbackRunners) {
              try {
                const rerouteEvent: RerouteEvent = {
                  originalAgent: agent.name,
                  reroutedTo: "fallback-runner",
                  reason:
                    error instanceof Error ? error.message : String(error),
                  timestamp: Date.now(),
                };
                try {
                  selfHealing.onReroute?.(rerouteEvent);
                } catch {
                  /* non-fatal */
                }
                if (timeline) {
                  timeline.record({
                    type: "reroute",
                    timestamp: Date.now(),
                    agentId: agent.name,
                    snapshotId: null,
                    from: agent.name,
                    to: "fallback-runner",
                    reason:
                      error instanceof Error ? error.message : String(error),
                  });
                }

                return await fallbackRunner<T>(agent, input, opts);
              } catch {
                // Try next fallback
              }
            }
          }

          // Try fallback agent
          if (selfHealing.fallbackAgent) {
            try {
              const rerouteEvent: RerouteEvent = {
                originalAgent: agent.name,
                reroutedTo: selfHealing.fallbackAgent.name,
                reason: error instanceof Error ? error.message : String(error),
                timestamp: Date.now(),
              };
              try {
                selfHealing.onReroute?.(rerouteEvent);
              } catch {
                /* non-fatal */
              }
              if (timeline) {
                timeline.record({
                  type: "reroute",
                  timestamp: Date.now(),
                  agentId: agent.name,
                  snapshotId: null,
                  from: agent.name,
                  to: selfHealing.fallbackAgent.name,
                  reason:
                    error instanceof Error ? error.message : String(error),
                });
              }

              return await runner<T>(selfHealing.fallbackAgent, input, opts);
            } catch {
              // Fallback agent also failed
            }
          }

          // Apply degradation policy
          if (
            selfHealing.degradation === "fallback-response" &&
            selfHealing.fallbackResponse !== undefined
          ) {
            return {
              output: selfHealing.fallbackResponse as T,
              messages: [],
              toolCalls: [],
              totalTokens: 0,
            };
          }
        }
        throw error;
      }
    }

    return runAgentWithGuardrailsInner<T>(
      agent,
      input,
      _currentFacts,
      opts,
      callOptions,
    );
  }

  async function runAgentWithGuardrailsInner<T>(
    agent: AgentLike,
    input: string,
    _currentFacts: F & OrchestratorState,
    opts?: RunOptions,
    callOptions?: RunCallOptions,
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
          instructions:
            (agent.instructions ?? "") +
            "\n\nConversation context:\n" +
            contextStr,
        };
      }
    }

    // Breakpoint: pre_input_guardrails
    if (breakpoints && breakpoints.length > 0) {
      const bpContext: BreakpointContext = {
        agentId: agent.name,
        agentName: agent.name,
        input,
        state: system.facts.$store.toObject(),
        breakpointType: "pre_input_guardrails",
      };
      const mods = await handleBreakpoint(
        "pre_input_guardrails",
        bpContext,
        callOptions?.signal ?? opts?.signal,
      );
      if (mods?.skip) {
        return {
          output: undefined as T,
          messages: [],
          toolCalls: [],
          totalTokens: 0,
        };
      }
      if (mods?.input) {
        input = mods.input;
      }
    }

    // Resolve which guardrails to use: per-call override > orchestrator defaults
    const effectiveInputGuardrails =
      callOptions?.inputGuardrails !== undefined
        ? callOptions.inputGuardrails
        : (guardrails.input ?? []);
    const effectiveOutputGuardrails =
      callOptions?.outputGuardrails !== undefined
        ? callOptions.outputGuardrails
        : (guardrails.output ?? []);

    // Run input guardrails BEFORE agent_start so timeline shows correct order
    const inputGuardrailsList = effectiveInputGuardrails.map((g, i) =>
      normalizeGuardrail(g, i, "input"),
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
        context,
      );
      // Call onGuardrailCheck hook
      fireHook("onGuardrailCheck", {
        agentId: agent.name,
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

    // Call onAgentStart hook (after guardrails pass)
    fireHook("onAgentStart", {
      agentName: agent.name,
      input,
      timestamp: startTime,
    });

    if (timeline) {
      timeline.record({
        type: "agent_start",
        timestamp: Date.now(),
        agentId: agent.name,
        snapshotId: null,
        inputLength: input.length,
        modelId: agent.model ?? undefined,
        ...(agent.instructions
          ? { instructions: agent.instructions.slice(0, MAX_VERBOSE_LENGTH) }
          : {}),
        input: input.slice(0, MAX_VERBOSE_LENGTH),
      });
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

    // Breakpoint: pre_agent_run
    if (breakpoints && breakpoints.length > 0) {
      const bpContext: BreakpointContext = {
        agentId: agent.name,
        agentName: agent.name,
        input,
        state: system.facts.$store.toObject(),
        breakpointType: "pre_agent_run",
      };
      const mods = await handleBreakpoint(
        "pre_agent_run",
        bpContext,
        callOptions?.signal ?? opts?.signal,
      );
      if (mods?.skip) {
        return {
          output: undefined as T,
          messages: [],
          toolCalls: [],
          totalTokens: 0,
        };
      }
      if (mods?.input) {
        input = mods.input;
      }
    }

    // Structured output wrapping
    const effectiveSchema =
      callOptions?.outputSchema !== undefined
        ? callOptions.outputSchema
        : outputSchema;

    let effectiveRunner = runner;
    if (effectiveSchema) {
      effectiveRunner = withStructuredOutput(runner, {
        schema: effectiveSchema,
        maxRetries: callOptions?.maxSchemaRetries ?? maxSchemaRetries ?? 2,
      });
    }

    // Run the agent with retry support
    const result = await executeAgentWithRetry<T>(
      effectiveRunner,
      agent,
      input,
      {
        ...opts,
        signal: opts?.signal,
        onMessage: (message) => {
          const currentConversation = getConversation(system.facts);
          const updated = [...currentConversation, message];
          setConversation(
            system.facts,
            updated.length > MAX_CONVERSATION_MESSAGES
              ? updated.slice(-MAX_CONVERSATION_MESSAGES)
              : updated,
          );
          opts?.onMessage?.(message);
        },
        onToolCall: async (toolCall) => {
          // Run tool call guardrails with retry support
          const toolCallGuardrails = (guardrails.toolCall ?? []).map((g, i) =>
            normalizeGuardrail(g, i, "toolCall"),
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
              context,
            );
            fireHook("onGuardrailCheck", {
              agentId: agent.name,
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

            // Wait for approval (pass signal so abort cancels the wait)
            await waitForApproval(
              approvalId,
              callOptions?.signal ?? opts?.signal,
            );
          }

          const currentToolCalls = getToolCalls(system.facts);
          const updatedToolCalls = [...currentToolCalls, toolCall];
          setToolCalls(
            system.facts,
            updatedToolCalls.length > MAX_TOOL_CALLS
              ? updatedToolCalls.slice(-MAX_TOOL_CALLS)
              : updatedToolCalls,
          );
          opts?.onToolCall?.(toolCall);
        },
      },
      agentRetry
        ? {
            ...agentRetry,
            onRetry: (attempt, error, delayMs) => {
              agentRetry.onRetry?.(attempt, error, delayMs);
              fireHook("onAgentRetry", {
                agentName: agent.name,
                input,
                attempt,
                error,
                delayMs,
                timestamp: Date.now(),
              });
            },
          }
        : undefined,
    );

    // Breakpoint: pre_output_guardrails
    if (breakpoints && breakpoints.length > 0) {
      const bpContext: BreakpointContext = {
        agentId: agent.name,
        agentName: agent.name,
        input,
        state: system.facts.$store.toObject(),
        breakpointType: "pre_output_guardrails",
      };
      const mods = await handleBreakpoint(
        "pre_output_guardrails",
        bpContext,
        callOptions?.signal ?? opts?.signal,
      );
      if (mods?.skip) {
        return {
          output: undefined as T,
          messages: [],
          toolCalls: [],
          totalTokens: 0,
        };
      }
      if (mods?.input) {
        input = mods.input;
      }
    }

    // Run output guardrails with retry support
    const outputGuardrailsList = effectiveOutputGuardrails.map((g, i) =>
      normalizeGuardrail(g, i, "output"),
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
          output: result.output,
          agentName: agent.name,
          input,
          messages: result.messages,
        },
        context,
      );
      fireHook("onGuardrailCheck", {
        agentId: agent.name,
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
        (result as { output: unknown }).output = guardResult.transformed;
      }
    }

    // Update state
    let shouldFireBudgetWarning = false;
    let budgetPercentage = 0;
    system.batch(() => {
      const currentAgent = getAgentState(system.facts);
      const newTokenUsage = currentAgent.tokenUsage + result.totalTokens;
      setAgentState(system.facts, {
        ...currentAgent,
        status: "completed",
        output: result.output,
        tokenUsage: newTokenUsage,
        turnCount: currentAgent.turnCount + result.messages.length,
        completedAt: Date.now(),
      });

      // Check budget warning threshold
      if (maxTokenBudget && onBudgetWarning) {
        budgetPercentage = newTokenUsage / maxTokenBudget;
        const warningFired = getBridgeFact<boolean>(
          system.facts,
          "__budgetWarningFired",
        );
        if (budgetPercentage >= budgetWarningThreshold && !warningFired) {
          setBridgeFact(system.facts, "__budgetWarningFired", true);
          shouldFireBudgetWarning = true;
        }
      }
    });

    // Fire budget warning callback outside of batch (callbacks shouldn't run inside batch)
    if (shouldFireBudgetWarning) {
      try {
        onBudgetWarning!({
          currentTokens: getAgentState(system.facts).tokenUsage,
          maxBudget: maxTokenBudget!,
          percentage: budgetPercentage,
        });
      } catch (callbackError) {
        if (debug) {
          console.debug(
            "[Directive Orchestrator] onBudgetWarning threw:",
            callbackError,
          );
        }
      }
    }

    // Store messages in memory if configured (best-effort)
    if (memory && result.messages.length > 0) {
      try {
        memory.addMessages(result.messages);
      } catch (memoryError) {
        if (debug) {
          console.debug("[Directive] Memory addMessages failed:", memoryError);
        }
      }
    }

    // Call onAgentComplete hook
    fireHook("onAgentComplete", {
      agentName: agent.name,
      input,
      output: result.output,
      tokenUsage: result.totalTokens,
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
    });

    if (timeline) {
      const outputStr =
        typeof result.output === "string"
          ? result.output
          : JSON.stringify(result.output);
      timeline.record({
        type: "agent_complete",
        timestamp: Date.now(),
        agentId: agent.name,
        snapshotId: null,
        outputLength: outputStr?.length ?? 0,
        totalTokens: result.totalTokens,
        inputTokens: result.tokenUsage?.inputTokens ?? 0,
        outputTokens: result.tokenUsage?.outputTokens ?? 0,
        durationMs: Date.now() - startTime,
        modelId: agent.model ?? undefined,
        output: outputStr.slice(0, MAX_VERBOSE_LENGTH),
      });
    }

    // Breakpoint: post_run
    if (breakpoints && breakpoints.length > 0) {
      const bpContext: BreakpointContext = {
        agentId: agent.name,
        agentName: agent.name,
        input,
        state: system.facts.$store.toObject(),
        breakpointType: "post_run",
      };
      const mods = await handleBreakpoint(
        "post_run",
        bpContext,
        callOptions?.signal ?? opts?.signal,
      );
      if (mods?.skip) {
        return {
          output: undefined as T,
          messages: [],
          toolCalls: [],
          totalTokens: 0,
        };
      }
      if (mods?.input) {
        input = mods.input;
      }
    }

    return result;
  }

  // Assign the function to the forward-declared variable
  runAgentWithGuardrailsFn = runAgentWithGuardrails;

  // ---- Breakpoint infrastructure ----
  const breakpointModifications = new Map<string, BreakpointModifications>();
  const breakpointCancelReasons = new Map<string, string>();

  function waitForBreakpointResolution(
    bpId: string,
    signal?: AbortSignal,
  ): Promise<BreakpointModifications | null> {
    if (signal?.aborted) {
      return Promise.reject(
        signal.reason ?? new Error("Aborted while waiting for breakpoint"),
      );
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanupAll = () => {
        if (settled) {
          return;
        }

        settled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
        unsubscribe();
      };

      const onAbort = () => {
        cleanupAll();
        reject(
          signal!.reason ?? new Error(`Breakpoint wait for ${bpId} aborted`),
        );
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      const unsubscribe = system.facts.$store.subscribe(
        [BREAKPOINT_KEY],
        () => {
          if (settled) {
            return;
          }

          const bpState = getBreakpointState(system.facts);
          if (bpState.resolved.includes(bpId)) {
            cleanupAll();
            const mods = breakpointModifications.get(bpId) ?? null;
            breakpointModifications.delete(bpId);
            resolve(mods);
          } else if (bpState.cancelled.includes(bpId)) {
            cleanupAll();
            breakpointModifications.delete(bpId);
            const cancelReason = breakpointCancelReasons.get(bpId);
            breakpointCancelReasons.delete(bpId);
            reject(
              new Error(
                cancelReason
                  ? `Breakpoint ${bpId} was cancelled: ${cancelReason}`
                  : `Breakpoint ${bpId} was cancelled`,
              ),
            );
          }
        },
      );

      const bpTimeout = breakpointTimeoutMs ?? 300000;
      timeoutId = setTimeout(() => {
        if (settled) {
          return;
        }

        cleanupAll();
        breakpointModifications.delete(bpId);
        breakpointCancelReasons.delete(bpId);
        reject(
          new Error(
            `[Directive] Breakpoint timeout: ${bpId} not resolved within ${Math.round(bpTimeout / 1000)}s`,
          ),
        );
      }, bpTimeout);
    });
  }

  async function handleBreakpoint(
    type: string,
    context: BreakpointContext,
    signal?: AbortSignal,
  ): Promise<BreakpointModifications | null> {
    if (!breakpoints || breakpoints.length === 0) {
      return null;
    }

    const match = matchBreakpoint(
      breakpoints as BreakpointConfig<string>[],
      type,
      context,
    );
    if (!match) {
      return null;
    }

    const bpId = createBreakpointId();
    const request: BreakpointRequest = {
      id: bpId,
      type,
      agentId: context.agentId,
      input: context.input,
      label: match.label,
      requestedAt: Date.now(),
    };

    system.batch(() => {
      const bpState = getBreakpointState(system.facts);
      setBreakpointState(system.facts, {
        ...bpState,
        pending: [...bpState.pending, request],
      });
    });

    try {
      onBreakpoint?.(request);
    } catch {
      /* non-fatal */
    }
    try {
      hooks.onBreakpoint?.(request);
    } catch {
      /* non-fatal */
    }

    if (timeline) {
      timeline.record({
        type: "breakpoint_hit",
        timestamp: Date.now(),
        snapshotId: null,
        agentId: context.agentId,
        breakpointId: bpId,
        breakpointType: type,
        label: match.label,
      });
    }

    const mods = await waitForBreakpointResolution(bpId, signal);

    if (timeline) {
      timeline.record({
        type: "breakpoint_resumed",
        timestamp: Date.now(),
        snapshotId: null,
        agentId: context.agentId,
        breakpointId: bpId,
        modified: !!mods?.input,
        skipped: !!mods?.skip,
      });
    }

    return mods;
  }

  // Wait for approval with configurable timeout and abort signal support
  function waitForApproval(
    requestId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(
        signal.reason ?? new Error("Aborted while waiting for approval"),
      );
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanupAll = () => {
        if (settled) {
          return;
        }

        settled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
        unsubscribe();
      };

      const onAbort = () => {
        cleanupAll();
        reject(
          signal!.reason ?? new Error(`Approval wait for ${requestId} aborted`),
        );
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      const unsubscribe = system.facts.$store.subscribe([APPROVAL_KEY], () => {
        if (settled) {
          return;
        }

        const approval = getApprovalState(system.facts);
        if (approval.approved.includes(requestId)) {
          cleanupAll();
          resolve();
        } else {
          const rejectedRequest = approval.rejected.find(
            (r) => r.id === requestId,
          );
          if (rejectedRequest) {
            cleanupAll();
            const errorMsg = rejectedRequest.reason
              ? `Request ${requestId} rejected: ${rejectedRequest.reason}`
              : `Request ${requestId} rejected`;
            reject(new Error(errorMsg));
          }
        }
      });

      // Set timeout to prevent indefinite hanging (uses configured approvalTimeoutMs)
      timeoutId = setTimeout(() => {
        if (settled) {
          return;
        }

        cleanupAll();
        const timeoutSeconds = Math.round(approvalTimeoutMs / 1000);
        reject(
          new Error(
            `[Directive] Approval timeout: Request ${requestId} not resolved within ${timeoutSeconds}s.\n` +
              "Solutions:\n" +
              "  1. Handle via onApprovalRequest callback and call orchestrator.approve()/reject()\n" +
              "  2. Set autoApproveToolCalls: true to auto-approve\n" +
              `  3. Increase approvalTimeoutMs (current: ${approvalTimeoutMs}ms)\n` +
              "See: https://directive.run/docs/ai/running-agents",
          ),
        );
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
    get totalTokens() {
      return getAgentState(system.facts).tokenUsage;
    },
    get timeline() {
      return timeline;
    },

    async run<T>(
      agent: AgentLike,
      input: string,
      options?: RunCallOptions,
    ): Promise<RunResult<T>> {
      return runAgentWithGuardrails<T>(
        agent,
        input,
        getCombinedFacts(),
        undefined,
        options,
      );
    },

    runStream<T>(
      agent: AgentLike,
      input: string,
      options: { signal?: AbortSignal } = {},
    ): OrchestratorStreamResult<T> {
      const abortController = new AbortController();
      const MAX_STREAM_BUFFER = 10_000;
      const chunks: OrchestratorStreamChunk[] = [];
      const waiters: Array<(chunk: OrchestratorStreamChunk | null) => void> =
        [];
      let closed = false;
      const startTime = Date.now();
      let tokenCount = 0;
      const MAX_ACCUMULATED_OUTPUT = 100_000;
      let accumulatedOutput = "";

      // Combine external abort signal
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

      // Push a chunk to the stream
      const pushChunk = (chunk: OrchestratorStreamChunk) => {
        if (closed) return;
        const waiter = waiters.shift();
        if (waiter) {
          waiter(chunk);
        } else {
          chunks.push(chunk);
          // FIFO eviction when buffer exceeds max
          if (chunks.length > MAX_STREAM_BUFFER) {
            chunks.shift();
          }
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
        pushChunk({
          type: "progress",
          phase: "starting",
          message: "Running input guardrails",
        });

        try {
          // Run input guardrails first with retry support
          let processedInput = input;
          const inputGuardrails = (guardrails.input ?? []).map((g, i) =>
            normalizeGuardrail(g, i, "input"),
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
              context,
            );
            if (!result.passed) {
              pushChunk({
                type: "guardrail_triggered",
                guardrailName: name,
                reason: result.reason ?? "Input validation failed",
                partialOutput: accumulatedOutput,
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

          pushChunk({
            type: "progress",
            phase: "generating",
            message: "Starting agent",
          });

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
          const result = await executeAgentWithRetry<T>(
            runner,
            agent,
            processedInput,
            {
              signal: abortController.signal,
              onMessage: (message) => {
                const currentConversation = getConversation(system.facts);
                setConversation(system.facts, [
                  ...currentConversation,
                  message,
                ]);
                pushChunk({ type: "message", message });

                // Approximate token counting from content
                if (message.role === "assistant" && message.content) {
                  const newTokens = Math.ceil(message.content.length / 4);
                  tokenCount += newTokens;
                  accumulatedOutput += message.content;
                  if (accumulatedOutput.length > MAX_ACCUMULATED_OUTPUT) {
                    accumulatedOutput = accumulatedOutput.slice(
                      -MAX_ACCUMULATED_OUTPUT,
                    );
                  }
                  pushChunk({
                    type: "token",
                    data: message.content,
                    tokenCount,
                  });
                }
              },
              onToolCall: async (toolCall) => {
                pushChunk({
                  type: "tool_start",
                  tool: toolCall.name,
                  toolCallId: toolCall.id,
                  arguments: toolCall.arguments,
                });

                // Run tool call guardrails with retry support
                const toolCallGuardrails = (guardrails.toolCall ?? []).map(
                  (g, i) => normalizeGuardrail(g, i, "toolCall"),
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
                    context,
                  );
                  if (!guardResult.passed) {
                    pushChunk({
                      type: "guardrail_triggered",
                      guardrailName: name,
                      reason: guardResult.reason ?? "Tool call blocked",
                      partialOutput: accumulatedOutput,
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
                  pushChunk({
                    type: "approval_required",
                    requestId: approvalId,
                    toolName: toolCall.name,
                  });

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
                  await waitForApproval(approvalId, abortController.signal);
                  pushChunk({
                    type: "approval_resolved",
                    requestId: approvalId,
                    approved: true,
                  });
                }

                const currentToolCalls = getToolCalls(system.facts);
                setToolCalls(system.facts, [...currentToolCalls, toolCall]);

                if (toolCall.result) {
                  pushChunk({
                    type: "tool_end",
                    tool: toolCall.name,
                    toolCallId: toolCall.id,
                    result: toolCall.result,
                  });
                }
              },
            },
            agentRetry,
          );

          // Run output guardrails
          pushChunk({
            type: "progress",
            phase: "finishing",
            message: "Running output guardrails",
          });

          const outputGuardrails = (guardrails.output ?? []).map((g, i) =>
            normalizeGuardrail(g, i, "output"),
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
                output: result.output,
                agentName: agent.name,
                input: processedInput,
                messages: result.messages,
              },
              context,
            );
            if (!guardResult.passed) {
              pushChunk({
                type: "guardrail_triggered",
                guardrailName: name,
                reason: guardResult.reason ?? "Output validation failed",
                partialOutput:
                  typeof result.output === "string" ? result.output : "",
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
              (result as { output: unknown }).output = guardResult.transformed;
            }
          }

          // Update final state
          system.batch(() => {
            const currentAgent = getAgentState(system.facts);
            setAgentState(system.facts, {
              ...currentAgent,
              status: "completed",
              output: result.output,
              tokenUsage: currentAgent.tokenUsage + result.totalTokens,
              turnCount: currentAgent.turnCount + result.messages.length,
              completedAt: Date.now(),
            });
          });

          const duration = Date.now() - startTime;
          pushChunk({
            type: "done",
            totalTokens: result.totalTokens,
            duration,
            droppedTokens: 0,
          });
          closeStream();

          return result;
        } catch (error) {
          pushChunk({
            type: "error",
            error: error instanceof Error ? error : new Error(String(error)),
          });
          closeStream();
          throw error;
        }
      })();

      // Prevent unhandled rejection if caller only consumes stream (not .result)
      resultPromise.catch(() => {});

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

              return new Promise<IteratorResult<OrchestratorStreamChunk>>(
                (resolve) => {
                  waiters.push((chunk) => {
                    if (chunk === null) {
                      resolve({ done: true, value: undefined });
                    } else {
                      resolve({ done: false, value: chunk });
                    }
                  });
                },
              );
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

    async waitForIdle(timeoutMs?: number): Promise<void> {
      const isIdle = () => getAgentState(system.facts).status !== "running";
      if (isIdle()) {
        return;
      }

      const start = Date.now();
      while (!isIdle()) {
        if (timeoutMs !== undefined && Date.now() - start > timeoutMs) {
          throw new Error("[Directive Orchestrator] waitForIdle timed out");
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    },

    approve(requestId: string): void {
      system.batch(() => {
        const approval = getApprovalState(system.facts);
        if (!approval.pending.some((r) => r.id === requestId)) {
          if (debug)
            console.debug(
              `[Directive] approve() ignored: no pending request "${requestId}"`,
            );

          return;
        }
        const MAX_APPROVAL_HISTORY = 200;
        const approved = [...approval.approved, requestId];
        setApprovalState(system.facts, {
          ...approval,
          pending: approval.pending.filter((r) => r.id !== requestId),
          approved:
            approved.length > MAX_APPROVAL_HISTORY
              ? approved.slice(-MAX_APPROVAL_HISTORY)
              : approved,
        });
      });
    },

    reject(requestId: string, reason?: string): void {
      system.batch(() => {
        const approval = getApprovalState(system.facts);
        if (!approval.pending.some((r) => r.id === requestId)) {
          if (debug)
            console.debug(
              `[Directive] reject() ignored: no pending request "${requestId}"`,
            );

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
          rejected:
            rejected.length > MAX_REJECTION_HISTORY
              ? rejected.slice(-MAX_REJECTION_HISTORY)
              : rejected,
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
        setBreakpointState(system.facts, {
          pending: [],
          resolved: [],
          cancelled: [],
        });
        setBridgeFact(system.facts, "__budgetWarningFired", false);
      });
      breakpointModifications.clear();
      breakpointCancelReasons.clear();
    },

    async checkpoint(cpOptions?: { label?: string }): Promise<Checkpoint> {
      const agentState = getAgentState(system.facts);
      if (agentState.status === "running") {
        throw new Error("[Directive] Cannot checkpoint while agent is running");
      }
      if (!system.history?.export) {
        throw new Error(
          "[Directive] Checkpointing requires history. Set `debug: true` in orchestrator options.",
        );
      }

      const cp: Checkpoint = {
        version: 1,
        id: createCheckpointId(),
        createdAt: new Date().toISOString(),
        label: cpOptions?.label,
        systemExport: system.history.export(),
        timelineExport: timeline?.export() ?? null,
        localState: { type: "single" },
        memoryExport: memory ? ((memory as any).export?.() ?? null) : null,
        orchestratorType: "single",
      };

      if (checkpointStore) {
        await checkpointStore.save(cp);
      }

      return cp;
    },

    restore(cp: Checkpoint, restoreOpts?: { restoreTimeline?: boolean }): void {
      if (!validateCheckpoint(cp)) {
        throw new Error("[Directive] Invalid checkpoint data");
      }
      if (cp.orchestratorType !== "single") {
        throw new Error(
          "[Directive] Cannot restore multi-agent checkpoint in single-agent orchestrator",
        );
      }
      if (!system.history?.import) {
        throw new Error(
          "[Directive] Restoring a checkpoint requires history. Set `debug: true` in orchestrator options.",
        );
      }

      system.history.import(cp.systemExport);

      if (
        restoreOpts?.restoreTimeline !== false &&
        cp.timelineExport &&
        timeline
      ) {
        timeline.import(cp.timelineExport);
      }

      if (cp.memoryExport !== null && memory && (memory as any).import) {
        (memory as any).import(cp.memoryExport);
      }
    },

    resumeBreakpoint(
      id: string,
      modifications?: BreakpointModifications,
    ): void {
      if (modifications) {
        breakpointModifications.set(id, modifications);
      }
      system.batch(() => {
        const bpState = getBreakpointState(system.facts);
        const resolved = [...bpState.resolved, id];
        setBreakpointState(system.facts, {
          ...bpState,
          pending: bpState.pending.filter((r) => r.id !== id),
          resolved:
            resolved.length > MAX_BREAKPOINT_HISTORY
              ? resolved.slice(-MAX_BREAKPOINT_HISTORY)
              : resolved,
        });
      });
    },

    cancelBreakpoint(id: string, reason?: string): void {
      if (reason) {
        breakpointCancelReasons.set(id, reason);
      }
      system.batch(() => {
        const bpState = getBreakpointState(system.facts);
        const cancelled = [...bpState.cancelled, id];
        setBreakpointState(system.facts, {
          ...bpState,
          pending: bpState.pending.filter((r) => r.id !== id),
          cancelled:
            cancelled.length > MAX_BREAKPOINT_HISTORY
              ? cancelled.slice(-MAX_BREAKPOINT_HISTORY)
              : cancelled,
        });
      });
    },

    getPendingBreakpoints(): BreakpointRequest[] {
      const bpState = getBreakpointState(system.facts);

      return [...bpState.pending];
    },

    dispose(): void {
      system.destroy();
    },
  };

  return orchestrator;
}
