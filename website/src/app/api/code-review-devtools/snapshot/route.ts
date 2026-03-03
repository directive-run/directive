/**
 * JSON snapshot of the code review orchestrator's current state.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { forbiddenResponse, isAllowedOrigin } from "@/lib/origin-check";
import {
  getCodeReviewCheckpointStore,
  getCodeReviewOrchestrator,
  getCodeReviewTimeline,
} from "../../code-review-chat/orchestrator-singleton";

export async function GET(request: Request) {
  if (!isAllowedOrigin(request)) {
    return forbiddenResponse(request);
  }

  const timeline = getCodeReviewTimeline();
  const instance = getCodeReviewOrchestrator();

  if (!timeline || !instance) {
    return Response.json(
      {
        error:
          "No active code review orchestrator. Submit code for review first.",
      },
      { status: 503 },
    );
  }

  const { orchestrator, memory, audit } = instance;
  const events = timeline.getEvents();

  // -------------------------------------------------------------------------
  // Aggregate timeline events
  // -------------------------------------------------------------------------

  let totalTokens = 0;
  let agentRuns = 0;
  let taskRuns = 0;
  let totalDurationMs = 0;
  let guardrailChecks = 0;
  let guardrailBlocked = 0;
  const runCounts = new Map<string, number>();

  for (const e of events) {
    if (e.type === "agent_complete") {
      const t = (e as { totalTokens?: number }).totalTokens ?? 0;
      const d = (e as { durationMs?: number }).durationMs ?? 0;
      const a = (e as { agentId?: string }).agentId ?? "unknown";
      totalTokens += t;
      totalDurationMs += d;
      agentRuns++;
      runCounts.set(a, (runCounts.get(a) ?? 0) + 1);
    }
    if (e.type === "task_complete") {
      const d = (e as { durationMs?: number }).durationMs ?? 0;
      const taskId = (e as { taskId?: string }).taskId ?? "unknown";
      totalDurationMs += d;
      taskRuns++;
      runCounts.set(taskId, (runCounts.get(taskId) ?? 0) + 1);
    }
    if (e.type === "guardrail_check") {
      guardrailChecks++;
      if (!(e as { passed?: boolean }).passed) {
        guardrailBlocked++;
      }
    }
  }

  const totalRuns = agentRuns + taskRuns;
  const guardrailPassRate =
    guardrailChecks > 0
      ? `${Math.round(((guardrailChecks - guardrailBlocked) / guardrailChecks) * 100)}%`
      : "N/A";

  // -------------------------------------------------------------------------
  // Orchestrator state
  // -------------------------------------------------------------------------

  let agentStates: Record<string, unknown> = {};
  try {
    agentStates = orchestrator.getAllAgentStates();
  } catch {
    // Not yet initialized
  }

  let taskStates: Record<string, unknown> = {};
  try {
    taskStates = orchestrator.getAllTaskStates();
  } catch {
    // Not yet initialized
  }

  const derived = orchestrator.derived ?? {};
  const scratchpad = orchestrator.scratchpad?.getAll() ?? {};

  // -------------------------------------------------------------------------
  // Memory
  // -------------------------------------------------------------------------

  let memoryMessages: Array<{
    role: string;
    contentLength: number;
    preview: string;
  }> = [];
  let totalMemoryMessages = 0;
  let contextMessageCount = 0;

  try {
    const memState = memory.export();
    totalMemoryMessages = memState.messages?.length ?? 0;

    const contextMsgs = memory.getContextMessages();
    contextMessageCount = contextMsgs.length;

    memoryMessages = contextMsgs.map((m) => ({
      role: m.role,
      contentLength: m.content.length,
      preview:
        m.content.slice(0, 2000) + (m.content.length > 2000 ? "\u2026" : ""),
    }));
  } catch {
    // Memory not yet populated
  }

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  const healthData: Record<string, unknown> = {};
  const healthMonitor = orchestrator.healthMonitor;
  if (healthMonitor) {
    for (const agentId of orchestrator.getAgentIds()) {
      try {
        healthData[agentId] = healthMonitor.getMetrics(agentId);
      } catch {
        // No metrics yet
      }
    }
  }

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  let auditStats: unknown = {};
  try {
    auditStats = audit.getStats();
  } catch {
    // Not yet populated
  }

  // -------------------------------------------------------------------------
  // Checkpoints
  // -------------------------------------------------------------------------

  const ckptStore = getCodeReviewCheckpointStore();
  let checkpointCount = 0;
  let latestCheckpointId: string | null = null;
  try {
    if (ckptStore) {
      const listed = await ckptStore.list();
      checkpointCount = listed.length;
      if (listed.length > 0) {
        latestCheckpointId = listed[listed.length - 1]!.id;
      }
    }
  } catch {
    // Not yet populated
  }

  // -------------------------------------------------------------------------
  // Build response
  // -------------------------------------------------------------------------

  return Response.json({
    timestamp: Date.now(),
    eventCount: events.length,
    totalTokens,
    orchestrator: {
      status: "active",
      currentAgent: null,
      totalRuns,
      totalTurns: 0,
      avgDurationMs:
        totalRuns > 0 ? Math.round(totalDurationMs / totalRuns) : 0,
      runCounts: Object.fromEntries(runCounts),
      agentStates,
      taskStates,
      derived,
      scratchpad,
    },
    guardrails: {
      totalChecks: guardrailChecks,
      blocked: guardrailBlocked,
      passRate: guardrailPassRate,
    },
    chatbot: {
      totalRequests: totalRuns,
      totalTokensUsed: totalTokens,
      consecutiveErrors: 0,
      isHealthy: true,
      activeIPs: 0,
    },
    health: healthData,
    audit: auditStats,
    checkpoints: {
      count: checkpointCount,
      latestId: latestCheckpointId,
      maxStored: 50,
    },
    memory: {
      totalMessages: totalMemoryMessages,
      contextMessages: contextMessageCount,
      summaries: 0,
      messages: memoryMessages,
    },
    supervisor: {
      supervisorAgent: "supervisor",
      workers: [
        "security-reviewer",
        "style-reviewer",
        "lint-check",
        "dependency-audit",
        "merge-decision",
      ],
      tasks: ["lint-check", "dependency-audit", "merge-decision"],
      maxRounds: 8,
      pattern: "codeReview",
    },
    config: {
      model: "claude-haiku-4-5-20251001",
      maxTokenBudget: 50000,
      maxResponseChars: 500,
      maxHistoryMessages: 20,
      preserveRecentCount: 4,
      memoryStrategy: "sliding-window",
      retry: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 10000 },
      circuitBreaker: { failureThreshold: 5, recoveryTimeMs: 30000 },
      budgets: [{ window: "hour", maxCost: 5.0 }],
      budgetWarningThreshold: 0.8,
      guardrails: {
        input: ["rate-limit", "prompt-injection", "content-filter"],
        output: ["output-length"],
      },
      derivations: ["allComplete", "totalCost", "reviewProgress"],
      scratchpadKeys: ["topic", "reviewType", "lastError", "requestCount"],
      tasks: ["lint-check", "dependency-audit", "merge-decision"],
    },
  });
}
