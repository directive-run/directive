import { NextRequest, NextResponse } from 'next/server'
import { ALL_COLOR_IDS, ALL_TYPO_IDS } from '@/lib/brand-presets'

const MAX_VOTES = 10000
const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minute
const MAX_REQUESTS_PER_WINDOW = 5

// In-memory vote storage (resets on redeploy -- sufficient for MVP)
// For production: replace with Vercel KV or similar
const votes: Array<{ color: string; typo: number; timestamp: number; ip: string }> = []

// Simple IP rate limiting
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW })
    return false
  }

  entry.count++
  return entry.count > MAX_REQUESTS_PER_WINDOW
}

const VALID_COLOR_IDS = new Set(ALL_COLOR_IDS)
const VALID_TYPO_IDS = new Set(ALL_TYPO_IDS)

export const runtime = 'edge'

export async function POST(request: NextRequest) {
  // Origin validation
  const origin = request.headers.get('origin')
  if (origin && !origin.includes('directive.run') && !origin.includes('localhost')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const ip = getClientIp(request)
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: { color?: string; typo?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { color, typo } = body

  if (!color || !VALID_COLOR_IDS.has(color)) {
    return NextResponse.json({ error: 'Invalid color preset' }, { status: 400 })
  }

  const typoNum = typeof typo === 'number' ? typo : 0
  if (!VALID_TYPO_IDS.has(typoNum)) {
    return NextResponse.json({ error: 'Invalid typo preset' }, { status: 400 })
  }

  // Cap votes array to prevent unbounded memory growth
  if (votes.length >= MAX_VOTES) {
    votes.splice(0, votes.length - MAX_VOTES + 1000)
  }

  votes.push({
    color,
    typo: typoNum,
    timestamp: Date.now(),
    ip,
  })

  return new NextResponse(null, {
    status: 204,
    headers: { 'Cache-Control': 'no-store' },
  })
}
