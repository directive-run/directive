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

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MAX_BODY_BYTES = 64 * 1024 // 64 KB

export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return forbiddenResponse(request)
  }

  const clientKey = request.headers.get('x-api-key')
  const apiKey = process.env.ANTHROPIC_API_KEY || clientKey

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'No API key configured' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
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
