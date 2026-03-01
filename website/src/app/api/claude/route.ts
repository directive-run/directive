/**
 * Proxy for the checkers example's Claude API calls.
 *
 * The built checkers JS posts to `/api/claude` with `x-api-key` in headers.
 * In the Vite dev server this is handled by a proxy plugin; in the Next.js
 * website we forward the request to Anthropic's messages endpoint here.
 *
 * Auth priority:
 *   1. `x-api-key` header from the client (user-entered key)
 *   2. `ANTHROPIC_API_KEY` env var (local dev fallback)
 */
import { NextRequest } from 'next/server'
import { isAllowedOrigin, forbiddenResponse } from '@/lib/origin-check'
import { checkHourlyRateLimit, isRateLimited, getClientIp, getRateLimitHeaders, getResetMinutes } from '@/lib/rate-limit'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MAX_BODY_BYTES = 64 * 1024 // 64 KB

export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return forbiddenResponse(request)
  }

  const clientKey = request.headers.get('x-api-key')
  const apiKey = clientKey || process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'No API key configured' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Rate limit only when using the server's API key (not the client's own key)
  if (!clientKey) {
    const ip = getClientIp(request)
    const rl = checkHourlyRateLimit(ip)
    if (isRateLimited(ip)) {
      const mins = getResetMinutes(ip)

      return new Response(
        JSON.stringify({ error: `You've used your 5 free tries this hour. Try again in ${mins} minutes.` }),
        { status: 429, headers: { 'Content-Type': 'application/json', ...getRateLimitHeaders(rl.remaining, rl.limit) } },
      )
    }
  }

  const body = await request.text()
  if (body.length > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({ error: 'Request body too large' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const upstream = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body,
  })

  // Stream the response back as-is
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    },
  })
}
