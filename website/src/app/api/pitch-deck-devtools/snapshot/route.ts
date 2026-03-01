/**
 * JSON snapshot of the pitch deck orchestrator's current state.
 *
 * Polled by the LiveDevTools component on an interval.
 * All tabs that use snapshot data read from this endpoint.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import {
  getPitchDeckTimeline,
  getPitchDeckOrchestrator,
  getPitchDeckMemory,
  getPitchDeckAudit,
  getPitchDeckCheckpointStore,
} from '../../pitch-deck-chat/orchestrator-singleton'

export async function GET() {
  const timeline = getPitchDeckTimeline()
  const instance = getPitchDeckOrchestrator()

  if (!timeline || !instance) {
    return Response.json(
      { error: 'No active pitch deck orchestrator. Send a startup idea first.' },
      { status: 503 },
    )
  }

  const { orchestrator, memory, audit } = instance
  const events = timeline.getEvents()

  // -------------------------------------------------------------------------
  // Aggregate timeline events
  // -------------------------------------------------------------------------

  let totalTokens = 0
  let agentRuns = 0
  let totalDurationMs = 0
  let guardrailChecks = 0
  let guardrailBlocked = 0
  const agentRunCounts = new Map<string, number>()

  for (const e of events) {
    if (e.type === 'agent_complete') {
      const t = (e as { totalTokens?: number }).totalTokens ?? 0
      const d = (e as { durationMs?: number }).durationMs ?? 0
      const a = (e as { agentId?: string }).agentId ?? 'unknown'
      totalTokens += t
      totalDurationMs += d
      agentRuns++
      agentRunCounts.set(a, (agentRunCounts.get(a) ?? 0) + 1)
    }
    if (e.type === 'guardrail_check') {
      guardrailChecks++
      if (!(e as { passed?: boolean }).passed) {
        guardrailBlocked++
      }
    }
  }

  const guardrailPassRate = guardrailChecks > 0
    ? `${Math.round(((guardrailChecks - guardrailBlocked) / guardrailChecks) * 100)}%`
    : 'N/A'

  // -------------------------------------------------------------------------
  // Orchestrator state → State tab
  // -------------------------------------------------------------------------

  let agentStates: Record<string, unknown> = {}
  try {
    agentStates = orchestrator.getAllAgentStates()
  } catch {
    // Not yet initialized
  }

  const derived = orchestrator.derived ?? {}
  const scratchpad = orchestrator.scratchpad?.getAll() ?? {}

  // -------------------------------------------------------------------------
  // Memory → Memory tab
  // -------------------------------------------------------------------------

  let memoryMessages: Array<{ role: string; contentLength: number; preview: string }> = []
  let totalMemoryMessages = 0
  let contextMessageCount = 0

  try {
    const memState = memory.export()
    totalMemoryMessages = memState.messages?.length ?? 0

    const contextMsgs = memory.getContextMessages()
    contextMessageCount = contextMsgs.length

    memoryMessages = contextMsgs.map((m) => ({
      role: m.role,
      contentLength: m.content.length,
      preview: m.content.slice(0, 2000) + (m.content.length > 2000 ? '…' : ''),
    }))
  } catch {
    // Memory not yet populated
  }

  // -------------------------------------------------------------------------
  // Health → Health tab
  // -------------------------------------------------------------------------

  const healthData: Record<string, unknown> = {}
  const healthMonitor = orchestrator.healthMonitor
  if (healthMonitor) {
    for (const agentId of orchestrator.getAgentIds()) {
      try {
        healthData[agentId] = healthMonitor.getMetrics(agentId)
      } catch {
        // No metrics yet for this agent
      }
    }
  }

  // -------------------------------------------------------------------------
  // Audit → Events tab
  // -------------------------------------------------------------------------

  let auditStats: unknown = {}
  try {
    auditStats = audit.getStats()
  } catch {
    // Audit not yet populated
  }

  // -------------------------------------------------------------------------
  // Checkpoints → State tab, Events tab
  // -------------------------------------------------------------------------

  const ckptStore = getPitchDeckCheckpointStore()
  let checkpointCount = 0
  let latestCheckpointId: string | null = null
  try {
    if (ckptStore) {
      const listed = await ckptStore.list()
      checkpointCount = listed.length
      if (listed.length > 0) {
        latestCheckpointId = listed[listed.length - 1]!.id
      }
    }
  } catch {
    // Checkpoint store not yet populated
  }

  // -------------------------------------------------------------------------
  // Build response
  // -------------------------------------------------------------------------

  return Response.json({
    timestamp: Date.now(),
    eventCount: events.length,
    totalTokens,
    orchestrator: {
      status: 'active',
      currentAgent: null,
      totalRuns: agentRuns,
      totalTurns: 0,
      avgDurationMs: agentRuns > 0 ? Math.round(totalDurationMs / agentRuns) : 0,
      agentRunCounts: Object.fromEntries(agentRunCounts),
      agentStates,
      derived,
      scratchpad,
    },
    guardrails: {
      totalChecks: guardrailChecks,
      blocked: guardrailBlocked,
      passRate: guardrailPassRate,
    },
    chatbot: {
      totalRequests: agentRuns,
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
    goal: {
      nodes: {
        'market-analyst': { agent: 'market-analyst', produces: ['market_analysis'], requires: [] },
        'financial-modeler': { agent: 'financial-modeler', produces: ['financials'], requires: [] },
        storyteller: { agent: 'storyteller', produces: ['narrative'], requires: ['market_analysis', 'financials'] },
        scorer: { agent: 'scorer', produces: ['pitch_score'], requires: ['narrative'] },
      },
      pattern: 'pitchDeck',
    },
    config: {
      model: 'claude-haiku-4-5-20251001',
      maxTokenBudget: 50000,
      maxResponseChars: 300,
      maxHistoryMessages: 30,
      preserveRecentCount: 6,
      memoryStrategy: 'sliding-window',
      retry: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 10000 },
      circuitBreaker: { failureThreshold: 5, recoveryTimeMs: 30000 },
      budgets: [
        { window: 'hour', maxCost: 5.00 },
      ],
      budgetWarningThreshold: 0.8,
      guardrails: {
        input: ['rate-limit', 'prompt-injection', 'pii-detection', 'content-filter'],
        output: ['output-length', 'output-pii'],
      },
      selfHealing: {
        equivalencyGroups: { analysis: ['market-analyst', 'financial-modeler'] },
        healthThreshold: 30,
        selectionStrategy: 'healthiest',
        degradation: 'fallback-response',
      },
      derivations: ['allComplete', 'totalCost', 'pitchProgress', 'pitchQuality'],
      scratchpadKeys: ['idea', 'confidence', 'sources', 'lastError', 'requestCount'],
      constraints: ['tokenOverload', 'allAgentsErrored'],
      resolvers: ['pauseForReview', 'resetPipeline'],
      checkpointStore: { type: 'in-memory', maxCheckpoints: 50 },
      fallbackModel: null,
    },
  })
}
