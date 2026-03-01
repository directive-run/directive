/**
 * JSON snapshot of the orchestrator's current state.
 *
 * Polled by the LiveDevTools State view on an interval.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { getTimeline, getOrchestrator, chatbotSystem } from '../../chat/orchestrator-singleton'

export async function GET(request: Request) {
  const tokenEnv = process.env.DEVTOOLS_TOKEN
  if (tokenEnv) {
    const provided = request.headers.get('X-DevTools-Token')
    if (provided !== tokenEnv) {
      return Response.json({ error: 'Unauthorized' }, { status: 403 })
    }
  }

  const timeline = getTimeline()
  const instance = getOrchestrator()

  if (!timeline || !instance) {
    return Response.json(
      { error: 'No active orchestrator. Send a chat message first.' },
      { status: 503 },
    )
  }

  const events = timeline.getEvents()

  // Aggregate stats from timeline events
  let totalTokens = 0
  let agentRuns = 0
  let guardrailChecks = 0
  let guardrailBlocks = 0
  let totalDurationMs = 0
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
      if ((e as { passed?: boolean }).passed === false) {
        guardrailBlocks++
      }
    }
  }

  // Orchestrator facts (agent state, conversation, etc.)
  const facts = instance.orchestrator.facts
  const agent = (facts as { agent?: { status: string; currentAgent: string | null; turnCount: number; tokenUsage: number } }).agent

  // Memory state
  const memoryState = instance.memory.export()
  const contextMessages = instance.memory.getContextMessages()

  return Response.json({
    timestamp: Date.now(),
    eventCount: events.length,
    totalTokens,
    orchestrator: {
      status: agent?.status ?? 'unknown',
      currentAgent: agent?.currentAgent ?? null,
      totalRuns: agentRuns,
      totalTurns: agent?.turnCount ?? 0,
      avgDurationMs: agentRuns > 0 ? Math.round(totalDurationMs / agentRuns) : 0,
      agentRunCounts: Object.fromEntries(agentRunCounts),
    },
    guardrails: {
      totalChecks: guardrailChecks,
      blocked: guardrailBlocks,
      passRate: guardrailChecks > 0
        ? `${Math.round(((guardrailChecks - guardrailBlocks) / guardrailChecks) * 100)}%`
        : 'N/A',
    },
    chatbot: {
      totalRequests: chatbotSystem.facts.totalRequests,
      totalTokensUsed: chatbotSystem.facts.totalTokensUsed,
      consecutiveErrors: chatbotSystem.facts.consecutiveErrors,
      isHealthy: chatbotSystem.derive.isHealthy,
      activeIPs: chatbotSystem.derive.activeIPs,
    },
    memory: {
      totalMessages: memoryState?.messages?.length ?? 0,
      contextMessages: contextMessages.length,
      summaries: memoryState?.summaries?.length ?? 0,
      messages: contextMessages.map((m: { role: string; content: string }) => ({
        role: m.role,
        contentLength: typeof m.content === 'string' ? m.content.length : 0,
        preview: typeof m.content === 'string' ? m.content.slice(0, 2000) + (m.content.length > 2000 ? '…' : '') : '',
      })),
    },
    config: {
      model: 'claude-haiku-4-5-20251001',
      maxTokenBudget: 2000,
      maxResponseChars: 3000,
      maxHistoryMessages: 20,
      preserveRecentCount: 6,
      memoryStrategy: 'sliding-window',
      retry: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 10000 },
      circuitBreaker: { failureThreshold: 3, recoveryTimeMs: 30000 },
      budgets: [
        { window: 'hour', maxCost: 5.00 },
        { window: 'day', maxCost: 50.00 },
      ],
      guardrails: {
        input: ['rate-limit', 'prompt-injection', 'pii-detection'],
        output: ['length'],
      },
      fallbackModel: process.env.OPENAI_API_KEY ? 'gpt-4o-mini' : null,
    },
  })
}
