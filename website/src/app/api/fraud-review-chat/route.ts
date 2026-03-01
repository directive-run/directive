/**
 * Fraud Review Board supervisor-pattern chat route.
 *
 * Runs input guardrails (with timeline recording), feeds memory,
 * updates scratchpad, then executes runPattern("fraudReview") → SSE stream.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { getFraudReviewOrchestrator, getFraudReviewInputGuardrails } from './orchestrator-singleton'
import { findScenario, buildCaseSummary } from './case-data'
import { createAnthropicRunner } from '@directive-run/ai/anthropic'
import { createOpenAIRunner } from '@directive-run/ai/openai'

interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

const MAX_MESSAGE_LENGTH = 2000
const MAX_HISTORY_MESSAGES = 20

function validateHistory(history: unknown[]): HistoryMessage[] {
  const valid: HistoryMessage[] = []
  for (const entry of history) {
    if (
      entry != null &&
      typeof entry === 'object' &&
      'role' in entry &&
      'content' in entry &&
      ((entry as HistoryMessage).role === 'user' || (entry as HistoryMessage).role === 'assistant') &&
      typeof (entry as HistoryMessage).content === 'string' &&
      (entry as HistoryMessage).content.length > 0 &&
      (entry as HistoryMessage).content.length <= MAX_MESSAGE_LENGTH
    ) {
      valid.push({ role: (entry as HistoryMessage).role, content: (entry as HistoryMessage).content })
    }
  }

  return valid.slice(-MAX_HISTORY_MESSAGES)
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const message = body?.message
  if (!message || typeof message !== 'string' || message.length > MAX_MESSAGE_LENGTH) {
    return Response.json({ error: 'Invalid message' }, { status: 400 })
  }

  const history = validateHistory(Array.isArray(body?.history) ? body.history : [])

  // -------------------------------------------------------------------------
  // Match scenario from user message → build case summary
  // -------------------------------------------------------------------------

  const scenarioKey = findScenario(message)
  const caseSummary = scenarioKey
    ? buildCaseSummary(scenarioKey)
    : `The user wants to discuss fraud analysis: "${message}". If they mention a specific fraud pattern, provide analysis. Available scenarios: card skimming, account takeover, bust-out fraud, deposit name mismatch, cash in/cash out, merchant credit abuse, rapid funds movement, and more.`

  // -------------------------------------------------------------------------
  // Dual-path: user-provided API key vs server env var
  // -------------------------------------------------------------------------

  const clientApiKey = (request.headers as Headers).get?.('x-api-key') ?? null
  const clientProvider = (request.headers as Headers).get?.('x-provider') || 'anthropic'

  if (clientApiKey) {
    const runner =
      clientProvider === 'openai'
        ? createOpenAIRunner({ apiKey: clientApiKey, model: 'gpt-4o-mini' })
        : createAnthropicRunner({
            apiKey: clientApiKey,
            model: 'claude-haiku-4-5-20251001',
            maxTokens: 2000,
          })

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
          } catch {
            // Stream closed
          }
        }

        try {
          const result = await runner({
            name: 'fraud-investigator',
            model: clientProvider === 'openai' ? 'gpt-4o-mini' : 'claude-haiku-4-5-20251001',
            instructions: `You are a senior fraud investigator. Analyze the fraud case provided and produce a structured report.

Your report must include:
1. Critical Findings - issues requiring immediate action
2. Major Findings - significant risk indicators
3. Minor Findings - low-risk observations
4. A verdict: CONFIRMED_FRAUD, LIKELY_FRAUD, INCONCLUSIVE, LIKELY_LEGITIMATE, or CLEARED
5. Confidence level: HIGH, MEDIUM, or LOW
6. A one-sentence recommendation

Format your response as a professional fraud investigation report.`,
          }, caseSummary)

          send({ type: 'text', text: String(result.output) })
          send({ type: 'done' })
        } catch (err) {
          send({
            type: 'error',
            message: err instanceof Error ? err.message : 'Fraud analysis failed',
          })
        } finally {
          try {
            controller.close()
          } catch {
            // Already closed
          }
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  }

  // No user key: require env var (dev fallback, 401 in prod)
  const instance = getFraudReviewOrchestrator()
  if (!instance) {
    if (process.env.NODE_ENV !== 'development') {
      return Response.json(
        { error: 'API key required. Enter your key in the provider config above.' },
        { status: 401 },
      )
    }

    return Response.json(
      { error: 'ANTHROPIC_API_KEY not configured' },
      { status: 503 },
    )
  }

  const { orchestrator, memory } = instance
  const timeline = orchestrator.timeline
  const inputGuardrails = getFraudReviewInputGuardrails()

  // -------------------------------------------------------------------------
  // Feed history into memory (first request with history seeds it)
  // -------------------------------------------------------------------------

  for (const msg of history) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      memory.addMessage({ role: msg.role, content: msg.content })
    }
  }

  // -------------------------------------------------------------------------
  // Run input guardrails manually (recorded to timeline for DevTools)
  // -------------------------------------------------------------------------

  for (const guardrail of inputGuardrails) {
    const gStart = Date.now()
    try {
      const resultOrPromise = guardrail.fn(
        { input: message, agentName: 'fraud-review-pipeline' },
        { agentName: 'fraud-review-pipeline', input: message, facts: {} },
      )

      const res = resultOrPromise && typeof resultOrPromise === 'object' && 'then' in resultOrPromise
        ? await resultOrPromise
        : resultOrPromise

      if (res && typeof res === 'object' && 'passed' in res) {
        if (timeline) {
          timeline.record({
            type: 'guardrail_check',
            timestamp: gStart,
            snapshotId: null,
            guardrailName: guardrail.name,
            guardrailType: 'input',
            passed: res.passed,
            reason: res.reason,
            durationMs: Date.now() - gStart,
          })
        }

        if (!res.passed) {
          const encoder = new TextEncoder()
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: 'error', message: res.reason || `Blocked by ${guardrail.name}` })}\n\n`,
                ),
              )
              controller.close()
            },
          })

          return new Response(stream, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache, no-transform',
              Connection: 'keep-alive',
              'X-Accel-Buffering': 'no',
            },
          })
        }
      }
    } catch {
      // Don't block pipeline on guardrail errors
    }
  }

  // -------------------------------------------------------------------------
  // Update scratchpad
  // -------------------------------------------------------------------------

  if (orchestrator.scratchpad) {
    orchestrator.scratchpad.update({
      scenario: scenarioKey ?? 'general',
      caseId: 'case-001',
      riskScore: 0,
    })
  }

  // -------------------------------------------------------------------------
  // Add user message to memory
  // -------------------------------------------------------------------------

  memory.addMessage({ role: 'user', content: message })

  // -------------------------------------------------------------------------
  // Run pipeline → stream result as SSE
  // -------------------------------------------------------------------------

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          // Stream closed
        }
      }

      try {
        const result = await orchestrator.runPattern<string>('fraudReview', caseSummary)
        send({ type: 'text', text: result })
        send({ type: 'done' })

        memory.addMessage({ role: 'assistant', content: result })
      } catch (err) {
        send({
          type: 'error',
          message: err instanceof Error ? err.message : 'Pipeline failed',
        })
      } finally {
        try {
          controller.close()
        } catch {
          // Already closed
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
