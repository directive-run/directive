/**
 * Goal orchestrator singleton — 4-agent pitch deck evaluator for AI examples.
 *
 * Persisted on globalThis to survive HMR re-evaluations.
 *
 * Features wired for DevTools observability:
 * - 4 input guardrails + 2 output guardrails  → Guardrails tab
 * - Sliding-window memory (30 messages)        → Memory tab
 * - Circuit breaker                            → Health tab, Config tab
 * - Self-healing (analysis equivalency)        → Health tab
 * - 4 cross-agent derivations                  → State tab
 * - Scratchpad (5 keys)                        → State tab
 * - Audit trail + agent handlers               → Events tab
 * - Lifecycle hooks (audit + scratchpad wiring) → Timeline tab, Events tab
 * - Budget warning threshold                   → Budget tab
 * - Constraints + resolvers (demo)             → State tab, Events tab
 * - Checkpoint store (in-memory, max 50)       → State tab, Events tab
 */
import {
  type CheckpointStore,
  type CrossAgentSnapshot,
  InMemoryCheckpointStore,
  type InputGuardrailData,
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
  goal,
  withBudget,
  withRetry,
} from "@directive-run/ai";
import { createAnthropicRunner } from "@directive-run/ai/anthropic";
import { createCircuitBreaker } from "@directive-run/core/plugins";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PitchDeckOrchestratorInstance {
  orchestrator: MultiAgentOrchestrator;
  memory: ReturnType<typeof createAgentMemory>;
  audit: ReturnType<typeof createAuditTrail>;
  inputGuardrails: NamedGuardrail<InputGuardrailData>[];
  checkpointStore: CheckpointStore;
}

// ---------------------------------------------------------------------------
// Singleton on globalThis (survives HMR)
// ---------------------------------------------------------------------------

const GLOBAL_KEY = "__directive_pitch_deck_orchestrator" as const;
const g = globalThis as typeof globalThis & {
  [GLOBAL_KEY]?: PitchDeckOrchestratorInstance;
};

export function getPitchDeckOrchestrator(): PitchDeckOrchestratorInstance | null {
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
              reason: "Content filter: blocked sensitive keyword",
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

  const audit = createAuditTrail({
    maxEntries: 5000,
    sessionId: "pitch-deck-demo",
  });
  const auditHandlers = createAgentAuditHandlers(audit);

  // ---------------------------------------------------------------------------
  // Checkpoint Store → State tab, Events tab (replay/resume)
  // ---------------------------------------------------------------------------

  const checkpointStore = new InMemoryCheckpointStore({ maxCheckpoints: 50 });

  // ---------------------------------------------------------------------------
  // Orchestrator
  // ---------------------------------------------------------------------------

  const orchestrator = createMultiAgentOrchestrator({
    runner,
    agents: {
      "market-analyst": {
        agent: {
          name: "market-analyst",
          model: "claude-haiku-4-5-20251001",
          instructions:
            "You are a market research analyst. Evaluate the TAM/SAM/SOM, competitive landscape, and market trends for the given startup idea. Respond in 2-3 sentences with concrete numbers or comparisons when possible.",
        },
        capabilities: ["research", "market-analysis"],
      },
      "financial-modeler": {
        agent: {
          name: "financial-modeler",
          model: "claude-haiku-4-5-20251001",
          instructions:
            "You are a financial modeling expert. Estimate revenue potential, unit economics, and burn rate for the given startup idea. Respond in 2-3 sentences with specific financial projections.",
        },
        capabilities: ["analysis", "finance"],
      },
      storyteller: {
        agent: {
          name: "storyteller",
          model: "claude-haiku-4-5-20251001",
          instructions:
            "You are an expert pitch deck storyteller. Craft a compelling investor narrative covering the problem, solution, and why now — based on the market analysis and financial projections provided. Respond in 3-4 sentences.",
        },
        capabilities: ["synthesis", "narrative"],
      },
      scorer: {
        agent: {
          name: "scorer",
          model: "claude-haiku-4-5-20251001",
          instructions:
            "You are an experienced VC investor. Score the pitch narrative from 1-10 based on market opportunity, financial viability, and narrative clarity. Respond in exactly 2 sentences: the score and a brief justification.",
        },
        capabilities: ["evaluation", "scoring"],
      },
    },
    patterns: {
      pitchDeck: goal<string>(
        {
          "market-analyst": {
            handler: "market-analyst",
            produces: ["market_analysis"],
            buildInput: (facts) => String(facts.input ?? ""),
          },
          "financial-modeler": {
            handler: "financial-modeler",
            produces: ["financials"],
            buildInput: (facts) => String(facts.input ?? ""),
          },
          storyteller: {
            handler: "storyteller",
            produces: ["narrative"],
            requires: ["market_analysis", "financials"],
            buildInput: (facts) =>
              `Market: ${facts.market_analysis}\nFinancials: ${facts.financials}`,
          },
          scorer: {
            handler: "scorer",
            produces: ["pitch_score"],
            requires: ["narrative"],
            buildInput: (facts) => `Pitch narrative: ${facts.narrative}`,
          },
        },
        (facts) => !!facts.pitch_score,
        {
          satisfaction: (facts) => {
            let s = 0;
            if (facts.market_analysis) {
              s += 0.2;
            }
            if (facts.financials) {
              s += 0.2;
            }
            if (facts.narrative) {
              s += 0.35;
            }
            if (facts.pitch_score) {
              s += 0.25;
            }

            return s;
          },
          maxSteps: 10,
          relaxation: [
            {
              label: "Rerun storyteller",
              afterStallSteps: 3,
              strategy: { type: "allow_rerun", nodes: ["storyteller"] },
            },
            {
              label: "Inject simplified narrative",
              afterStallSteps: 5,
              strategy: {
                type: "inject_facts",
                facts: {
                  narrative:
                    "A promising startup with strong market potential and viable financials.",
                },
              },
            },
          ],
          extract: (facts) => String(facts.pitch_score ?? ""),
        },
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
      equivalencyGroups: { analysis: ["market-analyst", "financial-modeler"] },
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
        const tokens = snap.coordinator.globalTokens;
        const inputTokens = tokens * 0.6;
        const outputTokens = tokens * 0.4;

        return (inputTokens * 0.8 + outputTokens * 4) / 1_000_000;
      },
      pitchProgress: (snap: CrossAgentSnapshot) => {
        const agents = Object.values(snap.agents);
        const completed = agents.filter((a) => a.status === "completed").length;

        return `${completed}/${agents.length}`;
      },
      pitchQuality: (snap: CrossAgentSnapshot) => {
        const agents = Object.values(snap.agents);
        if (agents.length === 0) {
          return 0;
        }
        const completed = agents.filter((a) => a.status === "completed").length;

        return Math.round((completed / agents.length) * 100);
      },
    },

    // Scratchpad (5 keys) → State tab
    scratchpad: {
      init: {
        idea: "",
        confidence: 0,
        sources: [] as string[],
        lastError: null as string | null,
        requestCount: 0,
      },
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
    },

    // Budget → Budget tab
    maxTokenBudget: 50_000,
    budgetWarningThreshold: 0.8,
    onBudgetWarning: ({ currentTokens, maxBudget, percentage }) => {
      console.warn(
        `[pitch-deck-orchestrator] Budget warning: ${currentTokens}/${maxBudget} tokens (${Math.round(percentage * 100)}%)`,
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
            "[pitch-deck-orchestrator] Token overload — pausing for review (demo no-op)",
          );
        },
      },
      resetPipeline: {
        requirement: (req): req is { type: "RESET_PIPELINE" } =>
          req.type === "RESET_PIPELINE",
        resolve: () => {
          console.log(
            "[pitch-deck-orchestrator] All agents errored — resetting pipeline (demo no-op)",
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

export function getPitchDeckTimeline() {
  return g[GLOBAL_KEY]?.orchestrator.timeline ?? null;
}

export function getPitchDeckMemory() {
  return g[GLOBAL_KEY]?.memory ?? null;
}

export function getPitchDeckAudit() {
  return g[GLOBAL_KEY]?.audit ?? null;
}

export function getPitchDeckInputGuardrails() {
  return g[GLOBAL_KEY]?.inputGuardrails ?? [];
}

export function getPitchDeckCheckpointStore() {
  return g[GLOBAL_KEY]?.checkpointStore ?? null;
}
