/**
 * DAG orchestrator singleton — 6-agent research pipeline for DevTools 2 demo.
 *
 * Persisted on globalThis to survive HMR re-evaluations.
 *
 * Features wired for DevTools observability:
 * - 4 input guardrails + 2 output guardrails  → Guardrails tab
 * - Sliding-window memory (30 messages)        → Memory tab
 * - Circuit breaker                            → Health tab, Config tab
 * - Self-healing (news ↔ academic equivalency) → Health tab
 * - 4 cross-agent derivations                  → State tab
 * - Scratchpad (5 keys)                        → State tab
 * - Audit trail + agent handlers               → Events tab
 * - Lifecycle hooks (audit + scratchpad wiring) → Timeline tab, Events tab
 * - Budget warning threshold                   → Budget tab
 * - Constraints + resolvers (demo)             → State tab, Events tab
 * - Breakpoints (pre_agent_run on synthesizer) → Timeline tab, Events tab
 * - Checkpoint store (in-memory, max 50)       → State tab, Events tab
 */
import {
  type BreakpointConfig,
  type CheckpointStore,
  type CrossAgentSnapshot,
  type DagExecutionContext,
  InMemoryCheckpointStore,
  type InputGuardrailData,
  type MultiAgentBreakpointType,
  type MultiAgentOrchestrator,
  type NamedGuardrail,
  type OutputGuardrailData,
  createAgentAuditHandlers,
  createAgentMemory,
  createAuditTrail,
  createEnhancedPIIGuardrail,
  createLengthGuardrail,
  createMultiAgentOrchestrator,
  createOutputPIIGuardrail,
  createPromptInjectionGuardrail,
  createSlidingWindowStrategy,
  dag,
  withBudget,
  withRetry,
} from "@directive-run/ai";
import { createAnthropicRunner } from "@directive-run/ai/anthropic";
import { createCircuitBreaker } from "@directive-run/core/plugins";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DagOrchestratorInstance {
  orchestrator: MultiAgentOrchestrator;
  memory: ReturnType<typeof createAgentMemory>;
  audit: ReturnType<typeof createAuditTrail>;
  inputGuardrails: NamedGuardrail<InputGuardrailData>[];
  checkpointStore: CheckpointStore;
}

// ---------------------------------------------------------------------------
// Singleton on globalThis (survives HMR)
// ---------------------------------------------------------------------------

const GLOBAL_KEY = "__directive_dag_orchestrator" as const;
const g = globalThis as typeof globalThis & {
  [GLOBAL_KEY]?: DagOrchestratorInstance;
};

export function getDagOrchestrator(): DagOrchestratorInstance | null {
  if (g[GLOBAL_KEY]) {
    return g[GLOBAL_KEY];
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return null;
  }

  let runner = createAnthropicRunner({
    apiKey: anthropicKey,
    model: "claude-haiku-4-5-20251001",
    maxTokens: 300,
  });

  runner = withRetry(runner, {
    maxRetries: 2,
    baseDelayMs: 1_000,
    maxDelayMs: 10_000,
  });

  const haikuPricing = { inputPerMillion: 0.8, outputPerMillion: 4 };
  runner = withBudget(runner, {
    budgets: [{ window: "hour" as const, maxCost: 5.0, pricing: haikuPricing }],
  });

  // ---------------------------------------------------------------------------
  // Input Guardrails (4) → Guardrails tab
  // ---------------------------------------------------------------------------

  const rateLimitTimestamps: number[] = [];
  let rateLimitStartIdx = 0;
  const MAX_PER_MINUTE = 20;

  const inputGuardrails: NamedGuardrail<InputGuardrailData>[] = [
    {
      name: "rate-limit",
      fn: () => {
        const now = Date.now();
        const windowStart = now - 60_000;
        while (
          rateLimitStartIdx < rateLimitTimestamps.length &&
          rateLimitTimestamps[rateLimitStartIdx]! < windowStart
        ) {
          rateLimitStartIdx++;
        }
        if (
          rateLimitStartIdx > rateLimitTimestamps.length / 2 &&
          rateLimitStartIdx > 100
        ) {
          rateLimitTimestamps.splice(0, rateLimitStartIdx);
          rateLimitStartIdx = 0;
        }
        const active = rateLimitTimestamps.length - rateLimitStartIdx;
        if (active >= MAX_PER_MINUTE) {
          return {
            passed: false,
            reason: `Rate limit exceeded (${MAX_PER_MINUTE}/min)`,
          };
        }
        rateLimitTimestamps.push(now);

        return { passed: true };
      },
    },
    {
      name: "prompt-injection",
      fn: createPromptInjectionGuardrail({ strictMode: true }),
    },
    {
      name: "pii-detection",
      fn: createEnhancedPIIGuardrail({ redact: true }),
    },
    {
      name: "content-filter",
      fn: ({ input }) => {
        const patterns = [
          /\bpassword\b/i,
          /\bsecret\s*key\b/i,
          /\bapi[_\s]*key\b/i,
        ];
        for (const p of patterns) {
          if (p.test(input)) {
            return {
              passed: false,
              reason: `Content filter: blocked sensitive keyword`,
            };
          }
        }

        return { passed: true };
      },
    },
  ];

  // ---------------------------------------------------------------------------
  // Output Guardrails (2) → Guardrails tab
  // ---------------------------------------------------------------------------

  const outputGuardrails: NamedGuardrail<OutputGuardrailData>[] = [
    {
      name: "output-length",
      fn: createLengthGuardrail({ maxCharacters: 3000 }),
    },
    { name: "output-pii", fn: createOutputPIIGuardrail({ redact: true }) },
  ];

  // ---------------------------------------------------------------------------
  // Memory → Memory tab
  // ---------------------------------------------------------------------------

  const memory = createAgentMemory({
    strategy: createSlidingWindowStrategy(),
    strategyConfig: { maxMessages: 30, preserveRecentCount: 6 },
    autoManage: true,
  });

  // ---------------------------------------------------------------------------
  // Circuit Breaker → Health tab, Config tab
  // ---------------------------------------------------------------------------

  const cb = createCircuitBreaker({
    failureThreshold: 5,
    recoveryTimeMs: 30_000,
  });

  // ---------------------------------------------------------------------------
  // Audit Trail → Events tab
  // ---------------------------------------------------------------------------

  const audit = createAuditTrail({ maxEntries: 5000, sessionId: "dag-demo" });
  const auditHandlers = createAgentAuditHandlers(audit);

  // ---------------------------------------------------------------------------
  // Checkpoint Store → State tab, Events tab (replay/resume)
  // ---------------------------------------------------------------------------

  const checkpointStore = new InMemoryCheckpointStore({ maxCheckpoints: 50 });

  // ---------------------------------------------------------------------------
  // Breakpoints → Timeline tab, Events tab
  // ---------------------------------------------------------------------------

  const breakpoints: BreakpointConfig<MultiAgentBreakpointType>[] = [
    {
      type: "pre_agent_run",
      label: "Before synthesizer",
      when: (ctx) => ctx.agentId === "synthesizer",
    },
  ];

  // ---------------------------------------------------------------------------
  // Orchestrator
  // ---------------------------------------------------------------------------

  const orchestrator = createMultiAgentOrchestrator({
    runner,
    agents: {
      news: {
        agent: {
          name: "news-researcher",
          model: "claude-haiku-4-5-20251001",
          instructions:
            "You are a news research agent. Find and report recent news on the given topic. Use your knowledge to provide specific, concrete findings with dates and sources when possible. Never say you lack internet access — respond with your best knowledge. Respond in 1-2 sentences with a key finding.",
        },
        capabilities: ["research", "news"],
      },
      academic: {
        agent: {
          name: "academic-researcher",
          model: "claude-haiku-4-5-20251001",
          instructions:
            "You are an academic research agent. Find and cite relevant academic research on the given topic. Reference specific studies, authors, journals, and years when possible. Never say you lack internet access — respond with your best knowledge. Respond in 1-2 sentences citing a study.",
        },
        capabilities: ["research", "academic"],
      },
      sentiment: {
        agent: {
          name: "sentiment-analyzer",
          model: "claude-haiku-4-5-20251001",
          instructions:
            "You are a sentiment analysis agent. Analyze the sentiment and public opinion of the provided finding. Classify as positive, negative, neutral, or mixed with specific reasoning. Respond in 1-2 sentences.",
        },
        capabilities: ["analysis", "sentiment"],
      },
      "fact-checker": {
        agent: {
          name: "fact-checker",
          model: "claude-haiku-4-5-20251001",
          instructions:
            "You are a fact-checking agent. Verify the accuracy of the provided claim by cross-referencing with known facts. Rate accuracy and note any caveats. Respond in 1-2 sentences.",
        },
        capabilities: ["analysis", "verification"],
      },
      synthesizer: {
        agent: {
          name: "synthesizer",
          model: "claude-haiku-4-5-20251001",
          instructions:
            "You are a synthesis agent. Combine the sentiment analysis and fact-check into a coherent, well-structured summary. Highlight key themes and conclusions. Respond in 2-3 sentences.",
        },
        capabilities: ["synthesis"],
      },
      reviewer: {
        agent: {
          name: "reviewer",
          model: "claude-haiku-4-5-20251001",
          instructions:
            "You are a quality review agent. Review the synthesized research for accuracy, completeness, and balance. Provide a final polished research brief. Respond in 2-3 sentences.",
        },
        capabilities: ["review", "quality"],
      },
    },
    patterns: {
      research: dag<string>(
        {
          news: {
            handler: "news",
            transform: (context: DagExecutionContext) => context.input,
          },
          academic: {
            handler: "academic",
            transform: (context: DagExecutionContext) => context.input,
          },
          sentiment: {
            handler: "sentiment",
            deps: ["news"],
            transform: (context: DagExecutionContext) =>
              `News finding: ${context.outputs["news"] ?? ""}`,
          },
          "fact-checker": {
            handler: "fact-checker",
            deps: ["academic"],
            transform: (context: DagExecutionContext) =>
              `Academic claim: ${context.outputs["academic"] ?? ""}`,
          },
          synthesizer: {
            handler: "synthesizer",
            deps: ["sentiment", "fact-checker"],
            transform: (context: DagExecutionContext) =>
              `Sentiment: ${context.outputs["sentiment"] ?? ""}\nFact-check: ${context.outputs["fact-checker"] ?? ""}`,
          },
          reviewer: {
            handler: "reviewer",
            deps: ["synthesizer"],
            transform: (context: DagExecutionContext) =>
              `Synthesized report: ${context.outputs["synthesizer"] ?? ""}`,
          },
        },
        (context: DagExecutionContext) =>
          String(context.outputs["reviewer"] ?? ""),
      ),
    },

    // Guardrails → Guardrails tab
    guardrails: {
      input: inputGuardrails,
      output: outputGuardrails,
    },

    // Memory → Memory tab
    memory,

    // Circuit breaker → Health tab, Config tab
    circuitBreaker: cb,

    // Self-healing → Health tab
    selfHealing: {
      equivalencyGroups: { research: ["news", "academic"] },
      healthThreshold: 30,
      circuitBreakerDefaults: {
        failureThreshold: 3,
        resetTimeoutMs: 30_000,
        halfOpenSuccesses: 2,
      },
      selectionStrategy: "healthiest",
      degradation: "fallback-response",
      fallbackResponse:
        "Service temporarily degraded. Please try again shortly.",
    },

    // Cross-agent derivations (4) → State tab
    derive: {
      allComplete: (snap: CrossAgentSnapshot) => {
        const agents = Object.values(snap.agents);
        if (agents.length === 0) {
          return false;
        }

        return agents.every((a) => a.status === "completed");
      },
      totalCost: (snap: CrossAgentSnapshot) => {
        // Estimate cost using Haiku pricing
        const tokens = snap.coordinator.globalTokens;
        // Rough split: 60% input, 40% output
        const inputTokens = tokens * 0.6;
        const outputTokens = tokens * 0.4;

        return (inputTokens * 0.8 + outputTokens * 4) / 1_000_000;
      },
      researchQuality: (snap: CrossAgentSnapshot) => {
        const agents = Object.values(snap.agents);
        if (agents.length === 0) {
          return 0;
        }
        const completed = agents.filter((a) => a.status === "completed").length;

        return Math.round((completed / agents.length) * 100);
      },
      pipelineProgress: (snap: CrossAgentSnapshot) => {
        const agents = Object.values(snap.agents);
        const completed = agents.filter((a) => a.status === "completed").length;

        return `${completed}/${agents.length}`;
      },
    },

    // Scratchpad (5 keys) → State tab
    scratchpad: {
      init: {
        topic: "",
        confidence: 0,
        sources: [] as string[],
        lastError: null as string | null,
        requestCount: 0,
      },
    },

    // Breakpoints → Timeline tab, Events tab
    breakpoints,
    breakpointTimeoutMs: 60_000,
    onBreakpoint: (request) => {
      audit.addEntry("approval.requested", {
        source: "breakpoint",
        breakpointId: request.id,
        type: request.type,
        agentId: request.agentId,
        label: request.label,
      });
      // Auto-resume after 100ms for the demo (so pipeline doesn't block)
      setTimeout(() => {
        const orch = g[GLOBAL_KEY]?.orchestrator;
        orch?.resumeBreakpoint(request.id);
      }, 100);
    },

    // Checkpoint store → State tab, Events tab (replay/resume)
    checkpointStore,

    // Lifecycle hooks → Timeline tab, Events tab
    hooks: {
      onAgentStart: ({ agentId }) => {
        auditHandlers.onAgentStart(agentId, "");
      },
      onAgentComplete: ({ agentId, tokenUsage }) => {
        auditHandlers.onAgentComplete(agentId, "", tokenUsage ?? 0, 0);
      },
      onAgentError: ({ agentId, error }) => {
        auditHandlers.onAgentError(
          agentId,
          error instanceof Error ? error : new Error(String(error)),
        );
      },
      onDagNodeComplete: ({ agentId }) => {
        const orch = g[GLOBAL_KEY]?.orchestrator;
        if (orch?.scratchpad) {
          const current = orch.scratchpad.get("sources") as
            | string[]
            | undefined;

          orch.scratchpad.set("sources", [...(current ?? []), agentId]);
        }
      },
      onPatternStart: () => {
        const orch = g[GLOBAL_KEY]?.orchestrator;
        if (orch?.scratchpad) {
          const count = (orch.scratchpad.get("requestCount") as number) ?? 0;

          orch.scratchpad.set("requestCount", count + 1);
        }
      },
      onCheckpointSave: ({ checkpointId, patternType, step }) => {
        audit.addEntry("checkpoint.save", { checkpointId, patternType, step });
      },
      onCheckpointError: ({ error }) => {
        audit.addEntry("error.occurred", {
          source: "checkpoint",
          error: error instanceof Error ? error.message : String(error),
        });
      },
      onBreakpoint: (request) => {
        audit.addEntry("approval.requested", {
          source: "breakpoint",
          breakpointId: request.id,
          type: request.type,
          agentId: request.agentId,
        });
      },
    },

    // Budget → Budget tab
    // 50k allows ~25 pipeline runs before pausing (6 agents × ~300 tokens each)
    maxTokenBudget: 50_000,
    budgetWarningThreshold: 0.8,
    onBudgetWarning: ({ currentTokens, maxBudget, percentage }) => {
      console.warn(
        `[dag-orchestrator] Budget warning: ${currentTokens}/${maxBudget} tokens (${Math.round(percentage * 100)}%)`,
      );
    },

    // Constraints + resolvers (demo) → State tab, Events tab
    constraints: {
      tokenOverload: {
        when: (facts) =>
          (facts as Record<string, unknown> & { __globalTokens?: number })
            .__globalTokens! > 40_000,
        require: { type: "PAUSE_FOR_REVIEW" },
        priority: 80,
      },
      allAgentsErrored: {
        when: (facts) => {
          const agents = (
            facts as Record<string, unknown> & {
              __agents?: Record<string, { status: string }>;
            }
          ).__agents;
          if (!agents) {
            return false;
          }
          const statuses = Object.values(agents);
          if (statuses.length === 0) {
            return false;
          }

          return statuses.every((a) => a.status === "error");
        },
        require: { type: "RESET_PIPELINE" },
        priority: 100,
      },
    },
    resolvers: {
      pauseForReview: {
        requirement: (req): req is { type: "PAUSE_FOR_REVIEW" } =>
          req.type === "PAUSE_FOR_REVIEW",
        resolve: () => {
          console.log(
            "[dag-orchestrator] Token overload — pausing for review (demo no-op)",
          );
        },
      },
      resetPipeline: {
        requirement: (req): req is { type: "RESET_PIPELINE" } =>
          req.type === "RESET_PIPELINE",
        resolve: () => {
          console.log(
            "[dag-orchestrator] All agents errored — resetting pipeline (demo no-op)",
          );
        },
      },
    },

    // Plugins → audit plugin feeds Events tab
    plugins: [audit.createPlugin()],

    // Debug — verbose timeline includes prompt/completion text in events
    debug: { verboseTimeline: true },
  });

  g[GLOBAL_KEY] = {
    orchestrator,
    memory,
    audit,
    inputGuardrails,
    checkpointStore,
  };

  return g[GLOBAL_KEY];
}

// ---------------------------------------------------------------------------
// Accessors (used by route.ts and snapshot route)
// ---------------------------------------------------------------------------

export function getDagTimeline() {
  return g[GLOBAL_KEY]?.orchestrator.timeline ?? null;
}

export function getDagMemory() {
  return g[GLOBAL_KEY]?.memory ?? null;
}

export function getDagAudit() {
  return g[GLOBAL_KEY]?.audit ?? null;
}

export function getDagInputGuardrails() {
  return g[GLOBAL_KEY]?.inputGuardrails ?? [];
}

export function getDagCheckpointStore() {
  return g[GLOBAL_KEY]?.checkpointStore ?? null;
}
