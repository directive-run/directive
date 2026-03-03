/**
 * Fraud Review Board orchestrator singleton — supervisor pattern with 3 specialist analysts.
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
  supervisor,
  withBudget,
  withRetry,
} from "@directive-run/ai";
import { createAnthropicRunner } from "@directive-run/ai/anthropic";
import { createCircuitBreaker } from "@directive-run/core/plugins";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FraudReviewOrchestratorInstance {
  orchestrator: MultiAgentOrchestrator;
  memory: ReturnType<typeof createAgentMemory>;
  audit: ReturnType<typeof createAuditTrail>;
  inputGuardrails: NamedGuardrail<InputGuardrailData>[];
  checkpointStore: CheckpointStore;
}

// ---------------------------------------------------------------------------
// Singleton on globalThis (survives HMR)
// ---------------------------------------------------------------------------

const GLOBAL_KEY = "__directive_fraud_review_orchestrator" as const;
const g = globalThis as typeof globalThis & {
  [GLOBAL_KEY]?: FraudReviewOrchestratorInstance;
};

export function getFraudReviewOrchestrator(): FraudReviewOrchestratorInstance | null {
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
    maxTokens: 500,
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

  const audit = createAuditTrail({
    maxEntries: 5000,
    sessionId: "fraud-review-demo",
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
      supervisor: {
        agent: {
          name: "supervisor",
          model: "claude-haiku-4-5-20251001",
          instructions: `You are a senior fraud investigator leading a review board. You receive a fraud case and must delegate analysis to your specialist team, then compile a final report.

IMPORTANT: You MUST respond with ONLY a single raw JSON object on each turn. No other text, no explanation, no markdown, no XML, no function calls, no tool use — just the JSON object. Your entire response must be parseable by JSON.parse().

Available specialists: transaction-analyst, geo-analyst, identity-analyst

To delegate to a specialist, respond with ONLY this JSON (no other text):
{ "action": "delegate", "worker": "<agent-id>", "workerInput": "<specific analysis task>" }

When you've gathered enough findings, compile a brief summary of the key findings from all specialists, then respond with ONLY this JSON:
{ "action": "complete", "report": "<your compiled findings summary>" }`,
        },
        capabilities: ["supervision", "investigation", "reporting"],
      },
      "transaction-analyst": {
        agent: {
          name: "transaction-analyst",
          model: "claude-haiku-4-5-20251001",
          instructions:
            "You are a transaction pattern analyst. Analyze timing, amounts, merchant categories, velocity patterns, and spending anomalies. Look for unusual clustering, escalation patterns, structuring, and merchant category shifts. Respond in 2-3 sentences with specific observations.",
        },
        capabilities: ["analysis", "pattern-detection"],
      },
      "geo-analyst": {
        agent: {
          name: "geo-analyst",
          model: "claude-haiku-4-5-20251001",
          instructions:
            "You are a geographic risk analyst. Analyze location patterns, impossible travel scenarios, high-risk jurisdictions, and geographic consistency. Evaluate whether the physical movement of transactions is plausible. Respond in 2-3 sentences with specific geographic findings.",
        },
        capabilities: ["analysis", "geographic-risk"],
      },
      "identity-analyst": {
        agent: {
          name: "identity-analyst",
          model: "claude-haiku-4-5-20251001",
          instructions:
            "You are an identity and PII analyst. Analyze PII exposure in transaction data, account verification signals, identity consistency across transactions, and name/account matching. Flag any personally identifiable information found in transaction memos. Respond in 2-3 sentences with specific identity findings.",
        },
        capabilities: ["analysis", "identity-verification"],
      },
    },
    patterns: {
      fraudReview: supervisor<string>(
        "supervisor",
        ["transaction-analyst", "geo-analyst", "identity-analyst"],
        {
          maxRounds: 5,
          extract: (supervisorOutput, workerResults) => {
            // Try to extract a report from the supervisor's completion
            let report = "";
            if (typeof supervisorOutput === "string") {
              try {
                const parsed = JSON.parse(supervisorOutput);
                if (parsed.report) {
                  report = parsed.report;
                }
              } catch {
                // Not JSON — use as-is if it's not just the action marker
                if (!supervisorOutput.includes('"action"')) {
                  report = supervisorOutput;
                }
              }
            }

            // If supervisor didn't include a report, compile from worker results
            if (!report && workerResults && workerResults.length > 0) {
              const sections = workerResults
                .map((r, i) => `**Finding ${i + 1}:**\n${String(r.output)}`)
                .join("\n\n");
              report = `## Fraud Analysis Report\n\n${sections}`;
            }

            return (
              report || "Analysis complete — no detailed findings available."
            );
          },
        },
      ),
    },

    // Guardrails → Guardrails tab
    // Input guardrails run at route level (route.ts) to avoid blocking internal
    // supervisor rounds where worker results naturally contain sensitive terms.
    guardrails: {
      output: outputGuardrails,
    },

    // Memory → Memory tab
    memory,

    // Circuit breaker → Health tab, Config tab
    circuitBreaker: cb,

    // Self-healing → Health tab
    selfHealing: {
      equivalencyGroups: { analysis: ["transaction-analyst", "geo-analyst"] },
      healthThreshold: 30,
      circuitBreakerDefaults: {
        failureThreshold: 3,
        resetTimeoutMs: 30_000,
        halfOpenSuccesses: 2,
      },
      selectionStrategy: "healthiest",
      degradation: "fallback-response",
      fallbackResponse:
        '{"action":"complete","report":"Service temporarily degraded. Please try again shortly."}',
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
      reviewProgress: (snap: CrossAgentSnapshot) => {
        const agents = Object.values(snap.agents);
        const completed = agents.filter((a) => a.status === "completed").length;

        return `${completed}/${agents.length}`;
      },
      findingsCount: (snap: CrossAgentSnapshot) => {
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
        scenario: "",
        caseId: "",
        riskScore: 0,
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
        `[fraud-review-orchestrator] Budget warning: ${currentTokens}/${maxBudget} tokens (${Math.round(percentage * 100)}%)`,
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
            "[fraud-review-orchestrator] Token overload — pausing for review (demo no-op)",
          );
        },
      },
      resetPipeline: {
        requirement: (req): req is { type: "RESET_PIPELINE" } =>
          req.type === "RESET_PIPELINE",
        resolve: () => {
          console.log(
            "[fraud-review-orchestrator] All agents errored — resetting pipeline (demo no-op)",
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

export function getFraudReviewTimeline() {
  return g[GLOBAL_KEY]?.orchestrator.timeline ?? null;
}

export function getFraudReviewMemory() {
  return g[GLOBAL_KEY]?.memory ?? null;
}

export function getFraudReviewAudit() {
  return g[GLOBAL_KEY]?.audit ?? null;
}

export function getFraudReviewInputGuardrails() {
  return g[GLOBAL_KEY]?.inputGuardrails ?? [];
}

export function getFraudReviewCheckpointStore() {
  return g[GLOBAL_KEY]?.checkpointStore ?? null;
}
