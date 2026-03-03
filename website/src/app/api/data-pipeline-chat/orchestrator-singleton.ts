/**
 * Data pipeline orchestrator singleton — 3 agents + 2 tasks in a mixed DAG.
 *
 * Persisted on globalThis to survive HMR re-evaluations.
 *
 * Pipeline: [classify] → [transform] → [analyze] → [validate] → [report]
 *            agent        TASK          agent        TASK         agent
 *
 * Features:
 * - 2 input guardrails + 1 output guardrail       → Guardrails tab
 * - Sliding-window memory (20 messages)            → Memory tab
 * - Circuit breaker                                → Health tab
 * - 2 cross-agent derivations                      → State tab
 * - Scratchpad (3 keys)                            → State tab
 * - Audit trail                                    → Events tab
 * - Lifecycle hooks                                → Timeline tab
 * - Checkpoint store                               → State tab
 */
import {
  type CrossAgentSnapshot,
  type DagExecutionContext,
  InMemoryCheckpointStore,
  type InputGuardrailData,
  type MultiAgentOrchestrator,
  type NamedGuardrail,
  type OutputGuardrailData,
  type TaskRegistration,
  createAgentAuditHandlers,
  createAgentMemory,
  createAuditTrail,
  createLengthGuardrail,
  createMultiAgentOrchestrator,
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

interface DataPipelineInstance {
  orchestrator: MultiAgentOrchestrator;
  memory: ReturnType<typeof createAgentMemory>;
  audit: ReturnType<typeof createAuditTrail>;
}

// ---------------------------------------------------------------------------
// Singleton cache
// ---------------------------------------------------------------------------

const GLOBAL_KEY = "__directive_data_pipeline__";

function getCached(): DataPipelineInstance | undefined {
  return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as
    | DataPipelineInstance
    | undefined;
}

function setCached(instance: DataPipelineInstance) {
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = instance;
}

// ---------------------------------------------------------------------------
// Input guardrails (exported for route to run manually)
// ---------------------------------------------------------------------------

const inputGuardrails: NamedGuardrail<InputGuardrailData>[] = [
  { name: "prompt-injection", fn: createPromptInjectionGuardrail() },
  {
    name: "content-filter",
    fn: (data) => {
      const lower = data.input.toLowerCase();
      const blocked = ["hack", "exploit", "malware"];
      for (const word of blocked) {
        if (lower.includes(word)) {
          return { passed: false, reason: `Blocked content: "${word}"` };
        }
      }

      return { passed: true };
    },
  },
];

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/** DAG wraps upstream output as `{"depName": "<stringified>"}`. Unwrap to the raw value. */
function unwrapDagInput(input: string): string {
  try {
    const envelope = JSON.parse(input);
    if (envelope && typeof envelope === "object" && !Array.isArray(envelope)) {
      const values = Object.values(envelope);
      if (values.length === 1 && typeof values[0] === "string") {
        return values[0];
      }
    }
  } catch {
    // Not JSON — return as-is
  }

  return input;
}

/** Strip markdown code fences (```json ... ```) if present. */
function stripCodeFences(text: string): string {
  const fenced = text.match(/^```[\w]*\n([\s\S]*?)\n```$/m);

  return fenced ? fenced[1].trim() : text.trim();
}

/** Parse JSON from an agent response, handling DAG envelope + code fences. */
function parseAgentJson(
  input: string,
  fallbackKey: string,
): Record<string, unknown> {
  const raw = stripCodeFences(unwrapDagInput(input));
  try {
    return JSON.parse(raw);
  } catch {
    return { [fallbackKey]: raw };
  }
}

const transformTask: TaskRegistration = {
  run: async (input, _signal, context) => {
    context.reportProgress(10, "Parsing classification");

    const data = parseAgentJson(input, "classification");

    context.reportProgress(40, "Normalizing structure");

    // Normalize the classification into a structured format
    const normalized = {
      topic: data.topic ?? data.classification ?? "unknown",
      category: data.category ?? "general",
      keywords: Array.isArray(data.keywords) ? data.keywords : [],
      confidence: typeof data.confidence === "number" ? data.confidence : 0.8,
      timestamp: new Date().toISOString(),
      source: "classification-agent",
    };

    context.reportProgress(100, "Transform complete");

    return JSON.stringify(normalized);
  },
  label: "Data Transform",
  description:
    "Parses agent classification and normalizes data structure for downstream analysis",
};

const validateTask: TaskRegistration = {
  run: async (input, _signal, context) => {
    context.reportProgress(25, "Parsing analysis");

    const data = parseAgentJson(input, "analysis");

    context.reportProgress(50, "Validating fields");

    if (!data.analysis && !data.findings) {
      throw new Error("Missing analysis or findings field");
    }

    context.reportProgress(75, "Computing quality score");

    // Compute a simple quality score
    const contentLength = JSON.stringify(data).length;
    const score = Math.min(100, Math.round((contentLength / 500) * 100));

    context.reportProgress(100, "Validation complete");

    return JSON.stringify({
      ...data,
      validated: true,
      qualityScore: score,
      validatedAt: new Date().toISOString(),
    });
  },
  label: "Validate & Score",
  description:
    "Validates required fields and computes quality score for the analysis",
  retry: { attempts: 2, backoff: "fixed", delayMs: 500 },
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function getDataPipelineOrchestrator(): DataPipelineInstance | null {
  const cached = getCached();
  if (cached) {
    return cached;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return null;
  }

  // -------------------------------------------------------------------------
  // Runner
  // -------------------------------------------------------------------------

  const baseRunner = createAnthropicRunner({
    apiKey,
    model: "claude-haiku-4-5-20251001",
    maxTokens: 1500,
  });

  const haikuPricing = { inputPerMillion: 0.8, outputPerMillion: 4 };
  const runner = withBudget(
    withRetry(baseRunner, {
      maxRetries: 2,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
    }),
    {
      budgets: [
        { window: "hour" as const, maxCost: 5.0, pricing: haikuPricing },
      ],
    },
  );

  // -------------------------------------------------------------------------
  // Memory
  // -------------------------------------------------------------------------

  const memory = createAgentMemory({
    strategy: createSlidingWindowStrategy({
      maxMessages: 20,
      preserveRecentCount: 4,
    }),
  });

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  const audit = createAuditTrail();

  // -------------------------------------------------------------------------
  // Agents
  // -------------------------------------------------------------------------

  const agents = {
    classify: {
      agent: {
        name: "classify",
        model: "claude-haiku-4-5-20251001",
        instructions: `You are a data classification agent. Given a topic, classify it into a structured JSON format.

Return a JSON object with these fields:
- "topic": the main topic
- "category": one of "technology", "science", "business", "policy", "society"
- "keywords": array of 3-5 relevant keywords
- "confidence": number 0-1 indicating classification confidence

Return ONLY valid JSON, no markdown or explanation.`,
      },
      capabilities: ["classification", "categorization"],
    },
    analyze: {
      agent: {
        name: "analyze",
        model: "claude-haiku-4-5-20251001",
        instructions: `You are a data analysis agent. Given structured data about a topic, produce a deep analysis.

Return a JSON object with these fields:
- "analysis": 2-3 paragraph analysis of the topic
- "findings": array of 3-5 key findings
- "trends": array of 2-3 emerging trends
- "recommendations": array of 2-3 actionable recommendations

Return ONLY valid JSON, no markdown or explanation.`,
      },
      capabilities: ["analysis", "research"],
    },
    report: {
      agent: {
        name: "report",
        model: "claude-haiku-4-5-20251001",
        instructions: `You are a report writing agent. Given validated analysis data, write a polished, readable report.

Structure your report with:
1. Executive Summary (1 paragraph)
2. Key Findings (bullet points)
3. Analysis (2-3 paragraphs)
4. Recommendations
5. Quality Score note

Write in clear, professional prose. This is the final output the user will read.`,
      },
      capabilities: ["writing", "summarization"],
    },
  };

  // -------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------

  const tasks: Record<string, TaskRegistration> = {
    transform: transformTask,
    validate: validateTask,
  };

  // -------------------------------------------------------------------------
  // Patterns
  // -------------------------------------------------------------------------

  const patterns = {
    process: dag<string>(
      {
        classify: { handler: "classify" },
        transform: { handler: "transform", deps: ["classify"] },
        analyze: { handler: "analyze", deps: ["transform"] },
        validate: { handler: "validate", deps: ["analyze"] },
        report: { handler: "report", deps: ["validate"] },
      },
      (context: DagExecutionContext) => {
        return (context.outputs.report as string) ?? "No report generated.";
      },
      { timeout: 120_000, maxConcurrent: 3 },
    ),
  };

  // -------------------------------------------------------------------------
  // Output guardrails
  // -------------------------------------------------------------------------

  const outputGuardrails: NamedGuardrail<OutputGuardrailData>[] = [
    {
      name: "output-length",
      fn: createLengthGuardrail({ maxCharacters: 5000 }),
    },
  ];

  // -------------------------------------------------------------------------
  // Circuit breaker
  // -------------------------------------------------------------------------

  const circuitBreaker = createCircuitBreaker({
    failureThreshold: 5,
    recoveryTimeMs: 30_000,
  });

  // -------------------------------------------------------------------------
  // Checkpoint store
  // -------------------------------------------------------------------------

  const checkpointStore = new InMemoryCheckpointStore({ maxCheckpoints: 30 });

  // -------------------------------------------------------------------------
  // Lifecycle hooks
  // -------------------------------------------------------------------------

  const auditHandlers = createAgentAuditHandlers(audit);

  // -------------------------------------------------------------------------
  // Derivations
  // -------------------------------------------------------------------------

  const derivations = {
    pipelineComplete: (snapshot: CrossAgentSnapshot) => {
      const agents = snapshot.agents;
      const classify = agents.classify;
      const analyze = agents.analyze;
      const report = agents.report;
      if (!classify || !analyze || !report) {
        return false;
      }

      return (
        classify.status === "completed" &&
        analyze.status === "completed" &&
        report.status === "completed"
      );
    },
    totalCost: (snapshot: CrossAgentSnapshot) => {
      const tokens = snapshot.coordinator.globalTokens;
      const inputTokens = tokens * 0.6;
      const outputTokens = tokens * 0.4;

      return (inputTokens * 0.8 + outputTokens * 4) / 1_000_000;
    },
  };

  // -------------------------------------------------------------------------
  // Create orchestrator
  // -------------------------------------------------------------------------

  const orchestrator = createMultiAgentOrchestrator({
    runner,
    agents,
    tasks,
    patterns,
    memory,
    derive: derivations,
    scratchpad: {
      init: {
        topic: "",
        confidence: 0,
        lastError: null,
      },
    },
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
      onTaskStart: (event) => {
        audit.addEntry("agent.run.start", {
          taskId: event.taskId,
          label: event.label,
          patternId: event.patternId,
        });
      },
      onTaskComplete: (event) => {
        audit.addEntry("agent.run.complete", {
          taskId: event.taskId,
          label: event.label,
          patternId: event.patternId,
          durationMs: event.durationMs,
        });
      },
      onTaskError: (event) => {
        audit.addEntry("agent.run.error", {
          taskId: event.taskId,
          label: event.label,
          patternId: event.patternId,
          error: event.error.message,
        });
      },
    },
    guardrails: {
      output: outputGuardrails,
    },
    circuitBreaker,
    checkpointStore,
    debug: true,
    budgetWarningThreshold: 0.8,
  });

  const instance: DataPipelineInstance = { orchestrator, memory, audit };
  setCached(instance);

  return instance;
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

export function getDataPipelineTimeline() {
  return getCached()?.orchestrator.timeline ?? null;
}

export function getDataPipelineMemory() {
  return getCached()?.memory ?? null;
}

export function getDataPipelineAudit() {
  return getCached()?.audit ?? null;
}

export function getDataPipelineInputGuardrails() {
  return inputGuardrails;
}
