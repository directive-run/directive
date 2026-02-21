/**
 * AI Docs Chatbot API Route
 *
 * Architecture: RAG retrieval → Directive orchestrator + middleware → SSE streaming
 *
 * Server-side operational state (per-IP rate limiting, token usage, error
 * tracking) is managed by a Directive module. The AI adapter handles
 * agent-level safety (guardrails, circuit breaker, per-call rate limits).
 *
 * 1. Directive module tracks per-IP request counts, cumulative metrics
 * 2. Embeds the user query via OpenAI, finds relevant doc chunks (cosine similarity)
 * 3. Passes enriched input (RAG context + conversation history + question) to
 *    a Directive orchestrator with prompt-injection & PII guardrails + middleware
 * 4. Streams tokens back to the client as SSE `data:` frames
 */
import { NextRequest } from 'next/server'
import {
  chatbotSystem,
  getOrchestrator,
  getEnricher,
  transport,
  MAX_REQUESTS_PER_WINDOW,
  DAILY_CAP_PER_IP,
} from './orchestrator-singleton'
import { getFeatureFlagSystem } from '@/lib/feature-flags/config'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatRequestBody {
  message: string
  history?: ChatMessage[]
  pageUrl?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_MESSAGE_LENGTH = 2000
const MAX_HISTORY_MESSAGES = 20
const ENRICH_TIMEOUT_MS = 5_000

const ALLOWED_ORIGINS = new Set([
  'https://directive.run',
  'https://www.directive.run',
])

// ---------------------------------------------------------------------------
// Query-Intent Classification
// ---------------------------------------------------------------------------

type QueryIntent = 'api' | 'conceptual'

const API_SIGNAL_PATTERN = /\b(function|parameter|return|signature|api|method|createModule|createSystem|createEngine|t\.\w+|type\s+\w+|interface\s+\w+)\b/i

/**
 * Classify a user query as "api" (looking for specific function/type details)
 * or "conceptual" (asking about how things work, best practices, etc.).
 * Regex-based, zero-cost at runtime.
 */
function classifyIntent(msg: string): QueryIntent {
  if (API_SIGNAL_PATTERN.test(msg) || /`[^`]+`/.test(msg)) {
    return 'api'
  }

  return 'conceptual'
}

// ---------------------------------------------------------------------------
// Origin Validation
// ---------------------------------------------------------------------------

function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true
  try {
    const url = new URL(origin)
    return url.hostname === 'localhost'
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Page URL Sanitization
// ---------------------------------------------------------------------------

function sanitizePageUrl(url: string | undefined): string | undefined {
  if (!url || typeof url !== 'string') return undefined
  try {
    const parsed = new URL(url, 'https://directive.run')
    return parsed.pathname + parsed.hash
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Client IP
// ---------------------------------------------------------------------------

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

// ---------------------------------------------------------------------------
// History Validation
// ---------------------------------------------------------------------------

function validateHistory(history: unknown[]): ChatMessage[] {
  const valid: ChatMessage[] = []
  let dropped = 0
  for (const entry of history) {
    if (
      entry != null &&
      typeof entry === 'object' &&
      'role' in entry &&
      'content' in entry &&
      ((entry as ChatMessage).role === 'user' || (entry as ChatMessage).role === 'assistant') &&
      typeof (entry as ChatMessage).content === 'string' &&
      (entry as ChatMessage).content.length > 0 &&
      (entry as ChatMessage).content.length <= MAX_MESSAGE_LENGTH
    ) {
      valid.push({ role: (entry as ChatMessage).role, content: (entry as ChatMessage).content })
    } else {
      dropped++
    }
  }
  if (
    dropped > 0 &&
    typeof process !== 'undefined' &&
    process.env?.NODE_ENV === 'development'
  ) {
    console.warn(`[chat] Dropped ${dropped} invalid history entries`)
  }

  return valid.slice(-MAX_HISTORY_MESSAGES)
}

// ---------------------------------------------------------------------------
// Route Handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Feature flag check
  const ffSystem = getFeatureFlagSystem()
  if (!ffSystem || !ffSystem.derive.canUseChat) {
    return new Response(
      JSON.stringify({ error: 'Chat is currently disabled.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Origin validation (exact domain matching)
  const origin = request.headers.get('origin')
  if (origin && !isAllowedOrigin(origin)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Track request in Directive module
  const ip = getClientIp(request)
  chatbotSystem.events.incomingRequest({ ip })

  // Route-level rate limiting (read from module facts)
  const entry = chatbotSystem.facts.requestCounts[ip]
  if (entry && entry.count > MAX_REQUESTS_PER_WINDOW) {
    return new Response(
      JSON.stringify({ error: 'Too many requests. Please wait a moment.' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Daily cap check
  const capDisabled = process.env.DISABLE_DAILY_CAP === 'true'
  const dailyEntry = chatbotSystem.facts.dailyCounts[ip]
  const dailyCount = dailyEntry ? dailyEntry.count : 0

  // dailyRemaining reports full capacity when disabled so widget never shows "0 remaining"
  const dailyRemaining = capDisabled
    ? DAILY_CAP_PER_IP
    : Math.max(0, DAILY_CAP_PER_IP - dailyCount)

  // Skip enforcement when disabled
  if (!capDisabled && dailyCount > DAILY_CAP_PER_IP) {
    return new Response(
      JSON.stringify({ error: 'Daily question limit reached. Come back tomorrow!' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-Daily-Remaining': '0',
          'X-Daily-Limit': String(DAILY_CAP_PER_IP),
          'Access-Control-Expose-Headers': 'X-Daily-Remaining, X-Daily-Limit',
        },
      },
    )
  }

  // System health check
  if (!chatbotSystem.derive.isHealthy) {
    return new Response(
      JSON.stringify({ error: 'Service temporarily unavailable. Please try again later.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Parse body
  let body: ChatRequestBody
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { message: rawMessage, history: rawHistory = [], pageUrl } = body
  const message = typeof rawMessage === 'string' ? rawMessage.trim() : rawMessage

  if (!message || typeof message !== 'string' || message.length > MAX_MESSAGE_LENGTH) {
    return new Response(
      JSON.stringify({ error: `Message is required and must be under ${MAX_MESSAGE_LENGTH} characters.` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const instance = getOrchestrator()
  if (!instance) {
    return new Response(
      JSON.stringify({ error: 'Chat service is not configured.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Validate history entries
  const history = validateHistory(Array.isArray(rawHistory) ? rawHistory : [])

  // Sanitize pageUrl to prevent prompt injection via URL
  const safePath = sanitizePageUrl(pageUrl)

  // Build enriched input via RAG enricher (with timeout to prevent hanging)
  // Over-fetch top 7 chunks, re-rank with intent-aware boosting, slice to top 5
  const enricher = await getEnricher()
  let enrichedInput = message
  if (enricher) {
    const intent = classifyIntent(message)
    try {
      const matches = await Promise.race([
        enricher.retrieve(message, 7),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('RAG retrieval timed out')), ENRICH_TIMEOUT_MS),
        ),
      ])

      // Re-rank: apply source-type boost based on query intent
      const ranked = matches.map((chunk) => {
        const meta = chunk.metadata as {
          sourceType?: string
          symbolName?: string
          url?: string
        }
        const sourceType = meta.sourceType ?? 'guide'

        let boost = 0
        if (intent === 'api' && sourceType === 'api-reference') boost += 0.1
        if (intent === 'conceptual' && sourceType === 'guide') boost += 0.05
        if (safePath && meta.url?.startsWith(safePath)) boost += 0.05

        return { ...chunk, boostedScore: chunk.similarity + boost }
      })

      // Sort by boosted score
      ranked.sort((a, b) => b.boostedScore - a.boostedScore)

      // Diversity cap: max 2 chunks per symbolName
      const symbolCounts = new Map<string, number>()
      const diverse = ranked.filter((chunk) => {
        const sym = (chunk.metadata as { symbolName?: string }).symbolName
        if (!sym) return true
        const count = symbolCounts.get(sym) ?? 0
        if (count >= 2) return false
        symbolCounts.set(sym, count + 1)

        return true
      })

      // Take top 5
      const top5 = diverse.slice(0, 5)

      // Format into enriched input
      const contextParts = top5.map((chunk) => {
        const title = (chunk.metadata.title as string) ?? ''
        const section = (chunk.metadata.section as string) ?? ''
        const url = (chunk.metadata.url as string) ?? ''
        const header = title && section && url
          ? `[${title} — ${section}](${url})`
          : title || chunk.id

        return `${header}\n${chunk.content}`
      })

      const parts: string[] = []
      if (safePath) parts.push(`The user is currently viewing: ${safePath}`)
      if (contextParts.length > 0) {
        parts.push(`Relevant documentation context:\n\n${contextParts.join('\n\n')}`)
      }
      if (history.length > 0) {
        const historyBlock = history
          .map((m) => `${m.role.charAt(0).toUpperCase() + m.role.slice(1)}: ${m.content}`)
          .join('\n\n')
        parts.push(`Previous conversation:\n${historyBlock}`)
      }
      parts.push(message)
      enrichedInput = parts.join('\n\n---\n\n')
    } catch {
      // Enrichment failed or timed out — fall back to raw message
    }
  }

  // Stream via SSE transport (propagate request abort signal)
  const sseResponse = transport.toResponse(instance.streamable, 'docs-qa', enrichedInput, {
    signal: request.signal,
  })

  // Add usage + CORS headers
  sseResponse.headers.set('X-Daily-Remaining', String(dailyRemaining))
  sseResponse.headers.set('X-Daily-Limit', String(DAILY_CAP_PER_IP))
  sseResponse.headers.set('Access-Control-Expose-Headers', 'X-Daily-Remaining, X-Daily-Limit')

  if (origin) {
    sseResponse.headers.set('Access-Control-Allow-Origin', origin)
  }

  return sseResponse
}
