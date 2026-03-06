/**
 * Async trigger → debounce → LLM → validate → apply pipeline.
 *
 * Key properties:
 * - Never blocks the reconcile loop (triggers are sync <1ms enqueue)
 * - Debounce coalesces rapid triggers into single LLM calls
 * - Optimistic concurrency: stamps snapshots with store generation counter
 * - Cascade depth cap prevents AI → trigger → AI infinite loops
 */

import type { System } from "@directive-run/core";
import type { AgentRunner } from "@directive-run/ai";
import type {
  ActionReasoning,
  AIArchitectOptions,
  ApprovalLevel,
  ArchitectAction,
  ArchitectAnalysis,
  ArchitectCapabilities,
  ArchitectDefType,
  ArchitectEvent,
  ArchitectEventListener,
  ArchitectPolicy,
  PolicyContext,
  RollbackEntry,
} from "./types.js";
import { createAuditLog } from "./audit.js";
import { createGuards } from "./guards.js";
import {
  executeTool,
  getAvailableTools,
  buildSystemPrompt,
  type ToolExecutionContext,
} from "./tools.js";
import { killAll } from "./kill-switch.js";
import {
  evaluatePolicies,
  getBlockingViolation,
  requiresApprovalOverride,
} from "./policies.js";

// M1: StaleSnapshotError for retry at mutex level
class StaleSnapshotError extends Error {
  retryCount: number;
  constructor(retryCount: number) {
    super("Stale snapshot — system changed during analysis");
    this.name = "StaleSnapshotError";
    this.retryCount = retryCount;
  }
}

// ============================================================================
// Pipeline
// ============================================================================

export interface PipelineOptions {
  system: System;
  runner: AgentRunner;
  options: AIArchitectOptions;
}

// M2: sanitize IDs/code for toSource() safety
// Item 8: also strip newlines from justification text
function sanitizeId(id: string): string {
  return id.replace(/[\\"`${}]/g, "").replace(/[\r\n]/g, " ");
}

function escapeCodeString(code: string): string {
  return code.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

export function createPipeline(pipelineOpts: PipelineOptions) {
  const { system, runner, options } = pipelineOpts;
  const capabilities: ArchitectCapabilities = {
    constraints: true,
    resolvers: true,
    effects: false,
    derivations: false,
    facts: "read-only",
    ...options.capabilities,
  };

  // C8: action counter scoped to this pipeline instance
  let actionCounter = 0;

  // ---- Event emitter ----
  const listeners: Array<{
    type?: string;
    fn: ArchitectEventListener;
  }> = [];

  function emitEvent(event: ArchitectEvent): void {
    for (const l of listeners) {
      if (!l.type || l.type === event.type) {
        try {
          l.fn(event);
        } catch {
          // Don't let listener errors crash the pipeline
        }
      }
    }
  }

  function on(
    typeOrListener: string | ArchitectEventListener,
    listener?: ArchitectEventListener,
  ): () => void {
    if (typeof typeOrListener === "function") {
      const entry = { fn: typeOrListener };
      listeners.push(entry);

      return () => {
        const idx = listeners.indexOf(entry);
        if (idx >= 0) {
          listeners.splice(idx, 1);
        }
      };
    }

    // M5: validate listener arg before using
    if (typeof listener !== "function") {
      throw new Error("on(type, listener) requires a function as the second argument");
    }

    const entry = { type: typeOrListener, fn: listener };
    listeners.push(entry);

    return () => {
      const idx = listeners.indexOf(entry);
      if (idx >= 0) {
        listeners.splice(idx, 1);
      }
    };
  }

  // ---- Guards ----
  const guards = createGuards(
    {
      debounceMs: 3000,
      maxDefinitions: options.safety?.maxDefinitions ?? 50,
      maxPending: 10,
      maxPerHour: 20,
    },
    options.budget,
    emitEvent,
  );

  // ---- Audit log ----
  const auditLog = createAuditLog({ maxEntries: 1000 });

  // ---- State ----
  const dynamicIds = new Set<string>();
  // E15: cap actions Map at 1000 with FIFO eviction
  const actions = new Map<string, ArchitectAction>();
  const MAX_ACTIONS = 1000;
  const rollbackEntries = new Map<string, RollbackEntry>();
  const approvalTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let versionCounter = 0;
  let destroyed = false;

  // M16: analysis mutex — queue concurrent calls
  let analyzeInProgress = false;
  const analyzeQueue: Array<{
    resolve: (value: ArchitectAnalysis) => void;
    reject: (err: Error) => void;
    trigger: ArchitectAnalysis["trigger"];
    triggerContext?: string;
    prompt?: string;
  }> = [];

  // ---- Policy tracking (Item 33) ----
  const actionTimestamps: number[] = [];
  let lastAppliedAction: ArchitectAction | undefined;

  // ---- Min interval tracking ----
  let lastAnalysisTime = 0;
  const minInterval = options.triggers?.minInterval ?? 60_000;

  // ---- Cost estimation ----
  // C7: use costPerThousandTokens if provided
  const costPerThousandTokens = options.budget.costPerThousandTokens ?? 0.003;

  function estimateDollars(tokens: number): number {
    return (tokens / 1000) * costPerThousandTokens;
  }

  // ---- Available tools ----
  const availableTools = getAvailableTools(capabilities);
  const systemPrompt = buildSystemPrompt(
    availableTools,
    options.context?.description,
    options.context?.goals,
    options.context?.notes,
  );

  // ---- Tool execution context ----
  const toolContext: ToolExecutionContext = {
    system,
    sandboxOptions: {
      timeout: options.safety?.executionTimeout ?? 5000,
      allowedGlobals: options.safety?.allowedGlobals,
      blockedPatterns: options.safety?.blockedPatterns,
      factWriteAccess: capabilities.facts === "read-write",
    },
    dynamicIds,
    rollbackFn: rollbackAction,
    // M2: pass capabilities for capability-gated operations
    capabilities,
  };

  // ============================================================================
  // Core: Analyze
  // ============================================================================

  async function analyze(
    trigger: ArchitectAnalysis["trigger"],
    triggerContext?: string,
    prompt?: string,
    _retryCount = 0,
    mode: "single" | "plan" = "single",
  ): Promise<ArchitectAnalysis> {
    if (destroyed) {
      throw new Error("Architect has been destroyed");
    }

    // C5: cap retries at 3
    if (_retryCount >= 3) {
      throw new Error("System too volatile — analysis retried 3 times without stable state");
    }

    // M16: mutex — queue if analysis already in progress
    // Item 11: cap analyzeQueue at 5
    if (analyzeInProgress) {
      if (analyzeQueue.length >= 5) {
        throw new Error("Analysis queue full (5 pending). Try again later.");
      }

      return new Promise<ArchitectAnalysis>((resolve, reject) => {
        analyzeQueue.push({ resolve, reject, trigger, triggerContext, prompt });
      });
    }

    analyzeInProgress = true;

    try {
      // Item 26: plan mode — multi-step reasoning
      if (mode === "plan") {
        const result = await analyzePlan(trigger, triggerContext, prompt);

        return result;
      }

      const result = await analyzeInternal(trigger, triggerContext, prompt, _retryCount);

      return result;
    } catch (err) {
      // M1: catch StaleSnapshotError and retry at mutex level
      if (err instanceof StaleSnapshotError) {
        analyzeInProgress = false;
        const next = analyzeQueue.shift();
        if (next) {
          analyze(next.trigger, next.triggerContext, next.prompt)
            .then(next.resolve)
            .catch(next.reject);
        }

        return analyze(trigger, triggerContext, prompt, err.retryCount + 1, mode);
      }

      throw err;
    } finally {
      analyzeInProgress = false;

      // Process next queued analysis if any
      const next = analyzeQueue.shift();
      if (next) {
        analyze(next.trigger, next.triggerContext, next.prompt)
          .then(next.resolve)
          .catch(next.reject);
      }
    }
  }

  async function analyzeInternal(
    trigger: ArchitectAnalysis["trigger"],
    triggerContext?: string,
    prompt?: string,
    _retryCount = 0,
  ): Promise<ArchitectAnalysis> {
    // Check min interval
    const now = Date.now();
    if (now - lastAnalysisTime < minInterval && trigger !== "demand") {
      throw new Error(
        `Min interval not met: ${minInterval}ms between analyses`,
      );
    }

    // Run guard checks
    const guardCheck = guards.checkAll();
    if (!guardCheck.allowed) {
      throw new Error(`Guard blocked: ${guardCheck.reason}`);
    }

    // M17: wire cascade guards
    guards.incrementCascade();

    const startTime = Date.now();
    lastAnalysisTime = startTime;
    const snapshotVersion = ++versionCounter;

    emitEvent({ type: "analysis-start", timestamp: startTime });
    emitEvent({ type: "observing", timestamp: Date.now() });

    // M17: wire pending count
    guards.setPendingCount(getPendingApprovals().length);

    // Build the prompt
    const systemState = system.inspect();
    const userPrompt = buildAnalysisPrompt(
      trigger,
      triggerContext,
      prompt,
      systemState,
    );

    emitEvent({ type: "reasoning", timestamp: Date.now() });

    // Call LLM (Item 27: with streaming support if available)
    guards.recordCall();
    guards.markHalfOpenAttempted();

    let result;
    try {
      result = await runnerWithStreaming(userPrompt);
    } catch (err) {
      guards.recordFailure();
      guards.resetCascade();
      emitEvent({
        type: "error",
        timestamp: Date.now(),
        error: err instanceof Error ? err : new Error(String(err)),
      });

      throw err;
    }

    guards.recordSuccess();
    guards.recordTokens(result.totalTokens, estimateDollars(result.totalTokens));

    // M1: Check for stale state — throw StaleSnapshotError for retry at mutex level
    if (versionCounter > snapshotVersion + 10) {
      emitEvent({ type: "error", timestamp: Date.now(), error: new Error("Stale snapshot — system changed during analysis") });
      guards.resetCascade();

      throw new StaleSnapshotError(_retryCount);
    }

    emitEvent({ type: "generating", timestamp: Date.now() });

    // Parse tool calls from result
    const analysisActions = parseToolCalls(result, trigger);

    emitEvent({ type: "validating", timestamp: Date.now() });

    // Process each action
    for (const action of analysisActions) {
      // E15: FIFO eviction on actions Map
      if (actions.size >= MAX_ACTIONS) {
        const firstKey = actions.keys().next().value;
        if (firstKey) {
          actions.delete(firstKey);
        }
      }

      actions.set(action.id, action);

      emitEvent({ type: "action", timestamp: Date.now(), action });

      if (action.requiresApproval) {
        emitEvent({ type: "approval-required", timestamp: Date.now(), action });
        startApprovalTimeout(action.id);
      } else {
        await applyAction(action, trigger);
      }
    }

    // M17: reset cascade after analysis completes
    guards.resetCascade();

    const analysis: ArchitectAnalysis = {
      trigger,
      triggerContext,
      actions: analysisActions,
      tokensUsed: result.totalTokens,
      durationMs: Date.now() - startTime,
      timestamp: startTime,
    };

    emitEvent({
      type: "analysis-complete",
      timestamp: Date.now(),
      analysis,
    });

    return analysis;
  }

  // ============================================================================
  // Item 26: Plan Mode — Multi-Step Reasoning
  // ============================================================================

  const MAX_PLAN_STEPS = 5;

  async function analyzePlan(
    trigger: ArchitectAnalysis["trigger"],
    triggerContext?: string,
    prompt?: string,
  ): Promise<ArchitectAnalysis> {
    const startTime = Date.now();
    const allActions: ArchitectAction[] = [];
    let totalTokens = 0;

    // Step 1: Ask LLM for a plan (sequence of steps)
    const guardCheck = guards.checkAll();
    if (!guardCheck.allowed) {
      throw new Error(`Guard blocked: ${guardCheck.reason}`);
    }

    guards.incrementCascade();
    lastAnalysisTime = Date.now();

    emitEvent({ type: "analysis-start", timestamp: Date.now() });
    emitEvent({ type: "observing", timestamp: Date.now() });

    const systemState = system.inspect();
    const planPrompt = buildPlanPrompt(trigger, triggerContext, prompt, systemState);

    emitEvent({ type: "reasoning", timestamp: Date.now() });

    guards.recordCall();
    guards.markHalfOpenAttempted();

    let planResult;
    try {
      planResult = await runnerWithStreaming(planPrompt);
    } catch (err) {
      guards.recordFailure();
      guards.resetCascade();
      emitEvent({
        type: "error",
        timestamp: Date.now(),
        error: err instanceof Error ? err : new Error(String(err)),
      });

      throw err;
    }

    guards.recordSuccess();
    guards.recordTokens(planResult.totalTokens, estimateDollars(planResult.totalTokens));
    totalTokens += planResult.totalTokens;

    // Parse plan steps from the response
    const planSteps = parsePlanSteps(planResult.output);
    const stepsToExecute = planSteps.slice(0, MAX_PLAN_STEPS);

    // Step 2: Execute each step sequentially
    for (let i = 0; i < stepsToExecute.length; i++) {
      const step = stepsToExecute[i]!;

      emitEvent({
        type: "plan-step",
        timestamp: Date.now(),
        stepIndex: i,
        totalSteps: stepsToExecute.length,
      });

      // Budget check before each step
      const budgetCheck = guards.checkAll();
      if (!budgetCheck.allowed) {
        break;
      }

      // Re-observe system state after previous step's changes
      const currentState = system.inspect();
      const stepPrompt = buildStepPrompt(step, currentState, i, stepsToExecute.length);

      emitEvent({ type: "reasoning", timestamp: Date.now() });

      guards.recordCall();

      let stepResult;
      try {
        stepResult = await runnerWithStreaming(stepPrompt);
      } catch (err) {
        guards.recordFailure();
        emitEvent({
          type: "error",
          timestamp: Date.now(),
          error: err instanceof Error ? err : new Error(String(err)),
        });

        break;
      }

      guards.recordSuccess();
      guards.recordTokens(stepResult.totalTokens, estimateDollars(stepResult.totalTokens));
      totalTokens += stepResult.totalTokens;

      emitEvent({ type: "generating", timestamp: Date.now() });

      // Parse and process actions for this step
      const stepActions = parseToolCalls(stepResult, trigger);

      emitEvent({ type: "validating", timestamp: Date.now() });

      for (const action of stepActions) {
        if (actions.size >= MAX_ACTIONS) {
          const firstKey = actions.keys().next().value;
          if (firstKey) {
            actions.delete(firstKey);
          }
        }

        actions.set(action.id, action);

        emitEvent({ type: "action", timestamp: Date.now(), action });

        emitEvent({
          type: "plan-step",
          timestamp: Date.now(),
          stepIndex: i,
          totalSteps: stepsToExecute.length,
          action,
        });

        if (action.requiresApproval) {
          emitEvent({ type: "approval-required", timestamp: Date.now(), action });
          startApprovalTimeout(action.id);
        } else {
          await applyAction(action, trigger);
        }

        allActions.push(action);
      }
    }

    guards.resetCascade();

    const analysis: ArchitectAnalysis = {
      trigger,
      triggerContext,
      actions: allActions,
      tokensUsed: totalTokens,
      durationMs: Date.now() - startTime,
      timestamp: startTime,
    };

    emitEvent({
      type: "analysis-complete",
      timestamp: Date.now(),
      analysis,
    });

    return analysis;
  }

  function parsePlanSteps(output: unknown): string[] {
    const raw = typeof output === "string" ? output : JSON.stringify(output);

    // Try JSON array first
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(String).slice(0, MAX_PLAN_STEPS);
      }

      if (parsed && Array.isArray(parsed.steps)) {
        return parsed.steps.map(String).slice(0, MAX_PLAN_STEPS);
      }

      if (parsed && Array.isArray(parsed.plan)) {
        return parsed.plan.map(String).slice(0, MAX_PLAN_STEPS);
      }
    } catch {
      // Not JSON
    }

    // Fallback: split numbered lines (e.g., "1. Do X\n2. Do Y")
    const lines = raw.split("\n").filter((line) => /^\s*\d+[.)]\s/.test(line));
    if (lines.length > 0) {
      return lines.map((l) => l.replace(/^\s*\d+[.)]\s*/, "")).slice(0, MAX_PLAN_STEPS);
    }

    // Last resort: treat entire output as a single step
    return [raw.slice(0, 500)];
  }

  // Item 27: Runner wrapper that supports streaming if available
  async function runnerWithStreaming(
    userPrompt: string,
  ): Promise<{ toolCalls: Array<{ name: string; arguments: string; result?: string }>; output: unknown; totalTokens: number }> {
    const runnerConfig = {
      name: "directive-architect",
      instructions: systemPrompt,
      model: options.model,
      tools: availableTools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    };

    // Duck-type check for streaming support
    const runnerAny = runner as unknown as Record<string, unknown>;
    if (typeof runnerAny.stream === "function") {
      let accumulated = "";
      const streamFn = runnerAny.stream as (
        config: unknown,
        prompt: string,
      ) => AsyncIterable<{ type: string; chunk?: string; result?: { toolCalls: Array<{ name: string; arguments: string }>; output: unknown; totalTokens: number } }>;

      let finalResult: { toolCalls: Array<{ name: string; arguments: string }>; output: unknown; totalTokens: number } | undefined;

      for await (const event of streamFn(runnerConfig, userPrompt)) {
        if (event.type === "chunk" && event.chunk) {
          accumulated += event.chunk;
          emitEvent({
            type: "reasoning-chunk",
            timestamp: Date.now(),
            chunk: event.chunk,
            accumulated,
          });
        } else if (event.type === "done" && event.result) {
          finalResult = event.result;
        }
      }

      if (finalResult) {
        return finalResult;
      }
    }

    // Non-streaming fallback
    return runner(runnerConfig, userPrompt);
  }

  // ============================================================================
  // Action Processing
  // ============================================================================

  function parseToolCalls(
    result: { toolCalls: Array<{ name: string; arguments: string; result?: string }>; output: unknown },
    trigger: ArchitectAnalysis["trigger"],
  ): ArchitectAction[] {
    const parsedActions: ArchitectAction[] = [];

    for (const call of result.toolCalls) {
      let args: Record<string, unknown>;
      try {
        args =
          typeof call.arguments === "string"
            ? JSON.parse(call.arguments)
            : (call.arguments as Record<string, unknown>);
      } catch {
        args = {};
      }

      const tool = availableTools.find((t) => t.name === call.name);
      if (!tool) {
        continue;
      }

      const reasoning = parseReasoning(result.output, trigger);
      // M4: better confidence parsing
      const confidence = parseConfidence(result.output);
      // M5: better risk parsing
      const risk = parseRisk(result.output, tool.mutates);
      const requiresApproval = tool.mutates && needsApproval(call.name, args);

      const action: ArchitectAction = {
        id: `action-${++actionCounter}-${Date.now()}`,
        tool: call.name,
        arguments: args,
        reasoning,
        confidence,
        risk,
        // M13: preserve original trigger
        originalTrigger: trigger,
        requiresApproval,
        approvalStatus: requiresApproval ? "pending" : "auto-approved",
        timestamp: Date.now(),
      };

      // Add definition info for mutation tools
      if (call.name === "create_constraint" || call.name === "create_resolver" ||
          call.name === "create_effect" || call.name === "create_derivation") {
        const defTypeMap: Record<string, ArchitectDefType> = {
          create_constraint: "constraint",
          create_resolver: "resolver",
          create_effect: "effect",
          create_derivation: "derivation",
        };
        const defType = defTypeMap[call.name]!;
        action.definition = {
          type: defType,
          id: args.id as string,
          code: (args.whenCode ?? args.resolveCode ?? args.runCode ?? args.deriveCode) as string | undefined,
        };
      } else if (call.name === "remove_definition") {
        action.definition = {
          type: args.type as ArchitectDefType,
          id: args.id as string,
        };
      }

      parsedActions.push(action);
    }

    return parsedActions;
  }

  function parseReasoning(output: unknown, trigger: string): ActionReasoning {
    const raw = typeof output === "string" ? output : JSON.stringify(output);

    return {
      trigger,
      observation: extractSection(raw, "observation") ?? raw.slice(0, 200),
      justification: extractSection(raw, "justification") ?? "",
      expectedOutcome: extractSection(raw, "expectedOutcome") ?? "",
      raw,
    };
  }

  // E13: improved extraction — try JSON.parse first, regex fallback
  function extractSection(text: string, key: string): string | null {
    // Try JSON.parse first for proper handling
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && key in parsed) {
        return String(parsed[key]);
      }
    } catch {
      // Not valid JSON, fall through to regex
    }

    // Improved regex fallback — handle escaped quotes
    const regex = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "i");
    const match = regex.exec(text);

    if (match?.[1]) {
      return match[1];
    }

    return null;
  }

  // M4: parseConfidence — JSON.parse → regex → default 0.8
  function parseConfidence(output: unknown): number {
    const raw = typeof output === "string" ? output : JSON.stringify(output);

    // Try JSON.parse
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.confidence === "number") {
        return Math.max(0, Math.min(1, parsed.confidence));
      }
    } catch {
      // Not JSON
    }

    // Regex fallback
    const match = /["\s]confidence["\s]*:\s*([0-9]*\.?[0-9]+)/i.exec(raw);
    if (match?.[1]) {
      const val = Number.parseFloat(match[1]);
      if (!Number.isNaN(val)) {
        return Math.max(0, Math.min(1, val));
      }
    }

    return 0.8;
  }

  // M5: parseRisk — JSON.parse → regex → heuristic
  function parseRisk(output: unknown, mutates: boolean): "low" | "medium" | "high" {
    const raw = typeof output === "string" ? output : JSON.stringify(output);

    // Try JSON.parse
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.risk === "string") {
        const r = parsed.risk.toLowerCase();
        if (r === "low" || r === "medium" || r === "high") {
          return r;
        }
      }
    } catch {
      // Not JSON
    }

    // Regex fallback
    const match = /["\s]risk["\s]*:\s*["']?(low|medium|high)["']?/i.exec(raw);
    if (match?.[1]) {
      return match[1].toLowerCase() as "low" | "medium" | "high";
    }

    // Heuristic
    return mutates ? "medium" : "low";
  }

  function needsApproval(toolName: string, args: Record<string, unknown>): boolean {
    const safety = options.safety;
    const defaultLevel: ApprovalLevel = "always";

    if (toolName === "create_constraint") {
      const level = safety?.approval?.constraints ?? defaultLevel;

      return level === "always" || (level === "first-time" && !hasBeenApprovedBefore("constraint", args.id as string));
    }

    if (toolName === "create_resolver") {
      const level = safety?.approval?.resolvers ?? defaultLevel;

      return level === "always" || (level === "first-time" && !hasBeenApprovedBefore("resolver", args.id as string));
    }

    if (toolName === "create_effect") {
      const level = safety?.approval?.effects ?? defaultLevel;

      return level === "always" || (level === "first-time" && !hasBeenApprovedBefore("effect", args.id as string));
    }

    if (toolName === "create_derivation") {
      const level = safety?.approval?.derivations ?? defaultLevel;

      return level === "always" || (level === "first-time" && !hasBeenApprovedBefore("derivation", args.id as string));
    }

    if (toolName === "remove_definition") {
      const type = args.type as ArchitectDefType;
      const level = safety?.approval?.[`${type}s` as keyof typeof safety.approval] ?? defaultLevel;

      return level === "always";
    }

    return false;
  }

  // Item 33: Build policy context from pipeline state
  function buildPolicyContext(action: ArchitectAction): PolicyContext {
    const now = Date.now();
    const oneHourAgo = now - 3_600_000;

    // C3: prune stale timestamps (>1hr) to prevent unbounded growth
    while (actionTimestamps.length > 0 && actionTimestamps[0]! < oneHourAgo) {
      actionTimestamps.shift();
    }

    const actionsThisHour = actionTimestamps.length;

    // Count by type from dynamicIds
    let constraintsCreated = 0;
    let resolversCreated = 0;
    let effectsCreated = 0;
    let derivationsCreated = 0;
    for (const entry of dynamicIds) {
      if (entry.startsWith("constraint::")) {
        constraintsCreated++;
      } else if (entry.startsWith("resolver::")) {
        resolversCreated++;
      } else if (entry.startsWith("effect::")) {
        effectsCreated++;
      } else if (entry.startsWith("derivation::")) {
        derivationsCreated++;
      }
    }

    // C2: Extract fact keys from set_fact tool args (fixed tool name + key extraction)
    const factKeysModified: string[] = [];
    if (action.tool === "set_fact" && typeof action.arguments.key === "string") {
      factKeysModified.push(action.arguments.key);
    }

    const budgetUsage = guards.getBudgetUsage();
    const budgetUsedPercent = Math.max(budgetUsage.percent.tokens, budgetUsage.percent.dollars);

    return {
      actionsThisHour,
      constraintsCreated,
      resolversCreated,
      effectsCreated,
      derivationsCreated,
      factKeysModified,
      budgetUsedPercent,
      activeDefinitions: dynamicIds.size,
      lastAction: lastAppliedAction,
      currentAction: action,
    };
  }

  const approvedDefinitions = new Set<string>();

  function hasBeenApprovedBefore(type: string, id: string): boolean {
    return approvedDefinitions.has(`${type}::${id}`);
  }

  async function applyAction(
    action: ArchitectAction,
    trigger: ArchitectAnalysis["trigger"],
  ): Promise<void> {
    const tool = availableTools.find((t) => t.name === action.tool);
    if (!tool) {
      return;
    }

    // Item 33: Evaluate policies before applying
    if (options.policies && options.policies.length > 0) {
      const policyCtx = buildPolicyContext(action);
      const violations = evaluatePolicies(options.policies, policyCtx);

      if (violations.length > 0) {
        const blocking = getBlockingViolation(violations);
        if (blocking) {
          const reason = `Policy "${blocking.policy.id}" blocked: ${blocking.policy.description}`;

          auditLog.append({
            trigger,
            tool: action.tool,
            arguments: action.arguments,
            reasoning: action.reasoning,
            definitionType: action.definition?.type,
            definitionId: action.definition?.id,
            code: action.definition?.code,
            approvalRequired: action.requiresApproval,
            approved: true,
            applied: false,
            error: reason,
          });

          emitEvent({
            type: "error",
            timestamp: Date.now(),
            action,
            error: new Error(reason),
          });

          return;
        }

        // M4: Emit policy-warning events (not "error") for warn policies
        for (const v of violations) {
          if (v.action === "warn") {
            emitEvent({
              type: "policy-warning",
              timestamp: Date.now(),
              policy: v.policy,
              action,
            });
          }
        }

        // Override approval for require-approval policies
        if (requiresApprovalOverride(violations)) {
          if (action.approvalStatus === "auto-approved") {
            action.approvalStatus = "pending";
            action.requiresApproval = true;
            emitEvent({ type: "approval-required", timestamp: Date.now(), action });
            startApprovalTimeout(action.id);

            return;
          }
        }
      }
    }

    // Check definition count before mutating
    if (tool.mutates) {
      const defCheck = guards.checkDefinitionCount();
      if (!defCheck.allowed) {
        auditLog.append({
          trigger,
          tool: action.tool,
          arguments: action.arguments,
          reasoning: action.reasoning,
          definitionType: action.definition?.type,
          definitionId: action.definition?.id,
          code: action.definition?.code,
          approvalRequired: action.requiresApproval,
          approved: true,
          applied: false,
          error: defCheck.reason,
        });

        return;
      }
    }

    const result = executeTool(action.tool, action.arguments, toolContext);

    if (result.success && result.definition) {
      // Track for rollback
      rollbackEntries.set(action.id, {
        auditId: action.id,
        type: result.definition.type,
        id: result.definition.id,
        operation:
          action.tool === "remove_definition" ? "unregister" : "register",
        registered:
          action.tool !== "remove_definition"
            ? result.definition
            : undefined,
        rolledBack: false,
      });

      guards.setDefinitionCount(dynamicIds.size);
    }

    auditLog.append({
      trigger,
      tool: action.tool,
      arguments: action.arguments,
      reasoning: action.reasoning,
      definitionType: result.definition?.type ?? action.definition?.type,
      definitionId: result.definition?.id ?? action.definition?.id,
      code: result.definition?.code ?? action.definition?.code,
      approvalRequired: action.requiresApproval,
      approved: true,
      applied: result.success,
      error: result.error,
    });

    if (result.success) {
      emitEvent({ type: "applied", timestamp: Date.now(), action });

      // Item 33: track for policy context
      actionTimestamps.push(Date.now());
      lastAppliedAction = action;

      if (action.definition) {
        approvedDefinitions.add(
          `${action.definition.type}::${action.definition.id}`,
        );
      }
    } else {
      guards.recordFailure();

      // Auto-disable on throw
      emitEvent({
        type: "error",
        timestamp: Date.now(),
        action,
        error: new Error(result.error ?? "Tool execution failed"),
      });
    }
  }

  // ============================================================================
  // Approval
  // ============================================================================

  const approvalTimeout = options.safety?.approvalTimeout ?? 300_000;

  function startApprovalTimeout(actionId: string): void {
    const timer = setTimeout(() => {
      const action = actions.get(actionId);
      if (action && action.approvalStatus === "pending") {
        // M8: emit approval-timeout event before rejection
        emitEvent({
          type: "approval-timeout",
          timestamp: Date.now(),
          action,
        });

        action.approvalStatus = "rejected";
        emitEvent({
          type: "approval-response",
          timestamp: Date.now(),
          action,
        });
      }

      approvalTimers.delete(actionId);
    }, approvalTimeout);

    approvalTimers.set(actionId, timer);
  }

  // M13: preserve originalTrigger through approval
  async function approve(actionId: string): Promise<boolean> {
    // Item 12: guard against use after destroy
    if (destroyed) {
      return false;
    }

    const action = actions.get(actionId);
    if (!action || action.approvalStatus !== "pending") {
      return false;
    }

    const timer = approvalTimers.get(actionId);
    if (timer) {
      clearTimeout(timer);
      approvalTimers.delete(actionId);
    }

    action.approvalStatus = "approved";
    emitEvent({ type: "approval-response", timestamp: Date.now(), action });

    // Apply the action using the original trigger
    await applyAction(action, action.originalTrigger ?? "demand");

    return true;
  }

  function reject(actionId: string): boolean {
    // Item 12: guard against use after destroy
    if (destroyed) {
      return false;
    }

    const action = actions.get(actionId);
    if (!action || action.approvalStatus !== "pending") {
      return false;
    }

    const timer = approvalTimers.get(actionId);
    if (timer) {
      clearTimeout(timer);
      approvalTimers.delete(actionId);
    }

    action.approvalStatus = "rejected";
    emitEvent({ type: "approval-response", timestamp: Date.now(), action });

    auditLog.append({
      trigger: action.originalTrigger ?? "demand",
      tool: action.tool,
      arguments: action.arguments,
      reasoning: action.reasoning,
      definitionType: action.definition?.type,
      definitionId: action.definition?.id,
      code: action.definition?.code,
      approvalRequired: true,
      approved: false,
      applied: false,
    });

    return true;
  }

  // ============================================================================
  // Rollback
  // ============================================================================

  function rollbackAction(actionId: string): boolean {
    const entry = rollbackEntries.get(actionId);
    if (!entry || entry.rolledBack) {
      return false;
    }

    try {
      if (entry.operation === "register") {
        // Undo a register by unregistering
        switch (entry.type) {
          case "constraint":
            system.constraints.unregister(entry.id);
            break;
          case "resolver":
            system.resolvers.unregister(entry.id);
            break;
          case "effect":
            system.effects.unregister(entry.id);
            break;
        }

        dynamicIds.delete(`${entry.type}::${entry.id}`);
      }

      entry.rolledBack = true;
      auditLog.markRolledBack(entry.auditId);
      guards.setDefinitionCount(dynamicIds.size);

      emitEvent({ type: "rollback", timestamp: Date.now() });

      return true;
    } catch {
      return false;
    }
  }

  function rollbackBatch(actionIds: string[]) {
    const results: Array<{ actionId: string; success: boolean; error?: string }> = [];
    let succeeded = 0;
    let failed = 0;

    for (const id of actionIds) {
      try {
        const success = rollbackAction(id);
        results.push({ actionId: id, success });
        if (success) {
          succeeded++;
        } else {
          failed++;
        }
      } catch (err) {
        failed++;
        results.push({
          actionId: id,
          success: false,
          error: String(err),
        });
      }
    }

    return { succeeded, failed, results };
  }

  function previewRollback(actionId: string) {
    const entry = rollbackEntries.get(actionId);
    if (!entry || entry.rolledBack) {
      return null;
    }

    return {
      actionId,
      operations: [
        {
          type: entry.type,
          id: entry.id,
          action: (entry.operation === "register" ? "unregister" : "re-register") as
            | "unregister"
            | "re-register",
        },
      ],
    };
  }

  // ============================================================================
  // Kill Switch
  // ============================================================================

  function kill() {
    const result = killAll(system, dynamicIds);

    emitEvent({
      type: "killed",
      timestamp: Date.now(),
      killResult: result,
    });

    return result;
  }

  // ============================================================================
  // toSource — M2: sanitized output
  // ============================================================================

  function toSource(actionId: string): string | null {
    const action = actions.get(actionId);
    if (!action || !action.definition) {
      return null;
    }

    const def = action.definition;

    if (action.tool === "create_constraint") {
      const args = action.arguments;
      const safeId = sanitizeId(def.id);
      const safeCode = escapeCodeString(String(args.whenCode ?? ""));
      const lines = [
        `// AI-generated constraint: ${safeId}`,
        `// Reasoning: ${sanitizeId(action.reasoning.justification)}`,
        `system.constraints.register("${safeId}", {`,
      ];

      if (args.priority !== undefined) {
        lines.push(`  priority: ${Number(args.priority)},`);
      }

      lines.push(`  when: (facts) => {`);
      lines.push(`    ${safeCode}`);
      lines.push(`  },`);
      lines.push(`  require: () => (${JSON.stringify(args.require)}),`);
      lines.push(`});`);

      return lines.join("\n");
    }

    if (action.tool === "create_resolver") {
      const args = action.arguments;
      const safeId = sanitizeId(def.id);
      const safeReq = sanitizeId(String(args.requirement ?? ""));
      const safeCode = escapeCodeString(String(args.resolveCode ?? ""));
      const lines = [
        `// AI-generated resolver: ${safeId}`,
        `// Reasoning: ${sanitizeId(action.reasoning.justification)}`,
        `system.resolvers.register("${safeId}", {`,
        `  requirement: "${safeReq}",`,
        `  resolve: async (req, context) => {`,
        `    ${safeCode}`,
        `  },`,
        `});`,
      ];

      return lines.join("\n");
    }

    // Item 22: toSource for effects
    if (action.tool === "create_effect") {
      const args = action.arguments;
      const safeId = sanitizeId(def.id);
      const safeCode = escapeCodeString(String(args.runCode ?? ""));
      const lines = [
        `// AI-generated effect: ${safeId}`,
        `// Reasoning: ${sanitizeId(action.reasoning.justification)}`,
        `system.effects.register("${safeId}", {`,
        `  run: (facts) => {`,
        `    ${safeCode}`,
        `  },`,
        `});`,
      ];

      return lines.join("\n");
    }

    // Item 22: toSource for derivations
    if (action.tool === "create_derivation") {
      const args = action.arguments;
      const safeId = sanitizeId(def.id);
      const safeCode = escapeCodeString(String(args.deriveCode ?? ""));
      const lines = [
        `// AI-generated derivation: ${safeId}`,
        `// Reasoning: ${sanitizeId(action.reasoning.justification)}`,
        `system.derive.${safeId} = (facts) => ${safeCode};`,
      ];

      return lines.join("\n");
    }

    return null;
  }

  // ============================================================================
  // Getters
  // ============================================================================

  function getActiveDefinitions() {
    const active = [];
    for (const entry of dynamicIds) {
      const sepIndex = entry.indexOf("::");
      if (sepIndex === -1) {
        continue;
      }

      const type = entry.slice(0, sepIndex) as ArchitectDefType;
      const id = entry.slice(sepIndex + 2);

      // Find the audit entry that created it
      const auditEntries = auditLog.query({
        definitionType: type,
        applied: true,
      });
      const creating = auditEntries.find(
        (e) => e.definitionId === id && !e.rolledBack,
      );

      active.push({
        type,
        id,
        auditId: creating?.id ?? "",
        createdAt: creating?.timestamp ?? 0,
        code: creating?.code,
      });
    }

    return active;
  }

  function getPendingApprovals() {
    return [...actions.values()].filter(
      (a) => a.approvalStatus === "pending",
    );
  }

  function getRollbackEntries() {
    return [...rollbackEntries.values()];
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  function destroy() {
    destroyed = true;

    // Clear all approval timers
    for (const timer of approvalTimers.values()) {
      clearTimeout(timer);
    }

    approvalTimers.clear();
    guards.destroy();
  }

  return {
    analyze,
    approve,
    reject,
    rollback: rollbackAction,
    rollbackBatch,
    previewRollback,
    toSource,
    kill,
    getActiveDefinitions,
    getPendingApprovals,
    getRollbackEntries,
    getAuditLog: auditLog.query,
    getBudgetUsage: guards.getBudgetUsage,
    resetBudget: guards.resetBudget,
    guards,
    on,
    destroy,
    /** Exposed for testing. */
    _dynamicIds: dynamicIds,
    _versionCounter: () => versionCounter,
    _incrementVersion: () => { versionCounter++; },
  };
}

export type Pipeline = ReturnType<typeof createPipeline>;

// ============================================================================
// Helpers
// ============================================================================

function buildAnalysisPrompt(
  trigger: ArchitectAnalysis["trigger"],
  triggerContext: string | undefined,
  prompt: string | undefined,
  systemState: unknown,
): string {
  const parts: string[] = [];

  parts.push(`## Trigger: ${trigger}`);
  if (triggerContext) {
    parts.push(`Context: ${triggerContext}`);
  }

  if (prompt) {
    parts.push(`\n## User Prompt\n${prompt}`);
  }

  parts.push(`\n## Current System State\n${JSON.stringify(systemState, null, 2)}`);

  parts.push(
    "\n## Instructions",
    "Analyze the system state and determine if any constraints or resolvers should be created, modified, or removed.",
    "For each action, provide your structured reasoning.",
    "Use the available tools to implement your recommendations.",
  );

  return parts.join("\n");
}

/** Item 26: Build a prompt asking the LLM to propose a multi-step plan. */
function buildPlanPrompt(
  trigger: ArchitectAnalysis["trigger"],
  triggerContext: string | undefined,
  prompt: string | undefined,
  systemState: unknown,
): string {
  const parts: string[] = [];

  parts.push(`## Trigger: ${trigger}`);
  if (triggerContext) {
    parts.push(`Context: ${triggerContext}`);
  }

  if (prompt) {
    parts.push(`\n## User Prompt\n${prompt}`);
  }

  parts.push(`\n## Current System State\n${JSON.stringify(systemState, null, 2)}`);

  parts.push(
    "\n## Instructions — Plan Mode",
    "Analyze the system and produce a PLAN of sequential steps (max 5 steps).",
    "Each step should describe ONE action to take. Steps will be executed in order.",
    "After each step, the system state will be re-observed before the next step.",
    "",
    "Respond with a JSON object: { \"steps\": [\"step 1 description\", \"step 2 description\", ...] }",
    "Each step description should clearly describe the constraint, resolver, or other action to create.",
  );

  return parts.join("\n");
}

/** Item 26: Build a prompt for executing a single step of a plan. */
function buildStepPrompt(
  step: string,
  systemState: unknown,
  stepIndex: number,
  totalSteps: number,
): string {
  const parts: string[] = [];

  parts.push(`## Plan Step ${stepIndex + 1} of ${totalSteps}`);
  parts.push(`\n## Step Description\n${step}`);
  parts.push(`\n## Current System State\n${JSON.stringify(systemState, null, 2)}`);

  parts.push(
    "\n## Instructions",
    "Execute this specific step of the plan.",
    "Use the available tools to implement the described action.",
    "Provide your structured reasoning for the action taken.",
  );

  return parts.join("\n");
}
