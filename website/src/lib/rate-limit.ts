/**
 * Shared per-IP hourly rate limiter for AI example routes.
 *
 * 5 requests/hour per IP. Used by fraud-review, pitch-deck, and dag-chat routes.
 * The main /api/chat route uses the Directive module for rate limiting instead.
 */

const HOURLY_WINDOW = 60 * 60 * 1000 // 1 hour
const MAX_PER_HOUR = 5
const MAX_ENTRIES = 10_000

interface RateLimitEntry {
  count: number
  resetAt: number
}

const ipCounts = new Map<string, RateLimitEntry>()

function evictExpired() {
  if (ipCounts.size <= MAX_ENTRIES) {
    return
  }

  const now = Date.now()
  for (const [ip, entry] of ipCounts) {
    if (now > entry.resetAt) {
      ipCounts.delete(ip)
    }
  }
}

/**
 * Check rate limit for an IP. Returns remaining count or -1 if exceeded.
 * Increments the counter on each call.
 */
export function checkHourlyRateLimit(ip: string): { remaining: number; limit: number } {
  const now = Date.now()
  const entry = ipCounts.get(ip)

  if (!entry || now > entry.resetAt) {
    ipCounts.set(ip, { count: 1, resetAt: now + HOURLY_WINDOW })
    evictExpired()

    return { remaining: MAX_PER_HOUR - 1, limit: MAX_PER_HOUR }
  }

  entry.count += 1

  const remaining = Math.max(0, MAX_PER_HOUR - entry.count)

  return { remaining, limit: MAX_PER_HOUR }
}

/**
 * Whether the IP has exceeded the hourly rate limit.
 * Call after checkHourlyRateLimit().
 */
export function isRateLimited(ip: string): boolean {
  const entry = ipCounts.get(ip)
  if (!entry) {
    return false
  }

  const now = Date.now()
  if (now > entry.resetAt) {
    return false
  }

  return entry.count > MAX_PER_HOUR
}

/**
 * Get minutes until rate limit resets for an IP.
 */
export function getResetMinutes(ip: string): number {
  const entry = ipCounts.get(ip)
  if (!entry) {
    return 0
  }

  const now = Date.now()
  if (now > entry.resetAt) {
    return 0
  }

  return Math.ceil((entry.resetAt - now) / 60_000)
}

export function getRateLimitHeaders(remaining: number, limit: number): Record<string, string> {
  return {
    'X-Hourly-Remaining': String(remaining),
    'X-Hourly-Limit': String(limit),
    'Access-Control-Expose-Headers': 'X-Hourly-Remaining, X-Hourly-Limit',
  }
}

/**
 * Extract client IP from request headers.
 * On Vercel: x-real-ip is the trusted source (set by the platform, not spoofable).
 * Falls back to x-forwarded-for first entry, then 'unknown'.
 */
export function getClientIp(request: Request): string {
  const headers = request.headers
  return (
    headers.get('x-real-ip') ||
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  )
}
