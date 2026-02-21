/**
 * JSON snapshot of the orchestrator's current state.
 *
 * Polled by the LiveDevTools State view on an interval.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { getTimeline, getOrchestrator, chatbotSystem } from '../../chat/orchestrator-singleton'

export async function GET() {
  const timeline = getTimeline()
  const instance = getOrchestrator()

  if (!timeline || !instance) {
    return Response.json(
      { error: 'No active orchestrator. Send a chat message first.' },
      { status: 503 },
    )
  }

  const events = timeline.getEvents()
  let totalTokens = 0
  for (const e of events) {
    if (e.type === 'agent_complete' && 'totalTokens' in e) {
      totalTokens += (e as { totalTokens: number }).totalTokens ?? 0
    }
  }

  return Response.json({
    timestamp: Date.now(),
    eventCount: events.length,
    totalTokens,
    chatbot: {
      totalRequests: chatbotSystem.facts.totalRequests,
      totalTokensUsed: chatbotSystem.facts.totalTokensUsed,
      consecutiveErrors: chatbotSystem.facts.consecutiveErrors,
      isHealthy: chatbotSystem.derive.isHealthy,
      activeIPs: chatbotSystem.derive.activeIPs,
    },
  })
}
