const ALLOWED_HOSTNAMES = new Set(['localhost', 'directive.run'])

/** Check if a hostname (or any of its parent domains) is in the allow list. */
function hostnameAllowed(hostname: string): boolean {
  if (ALLOWED_HOSTNAMES.has(hostname)) {
    return true
  }

  // Allow subdomains (e.g. www.directive.run, preview.directive.run)
  for (const allowed of ALLOWED_HOSTNAMES) {
    if (hostname.endsWith(`.${allowed}`)) {
      return true
    }
  }

  return false
}

/**
 * Check whether a request's origin/referer is from an allowed hostname.
 * Returns `true` if the request is allowed, `false` if it should be blocked.
 *
 * Same-origin requests (no Origin header, no Referer) are allowed.
 */
export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')

  const headerToParse = origin ?? referer
  if (!headerToParse) {
    return true
  }

  try {
    const hostname = new URL(headerToParse).hostname

    return hostnameAllowed(hostname)
  } catch {
    return false
  }
}

/** Return a 403 Response with a descriptive error message. */
export function forbiddenResponse(request: Request): Response {
  const origin = request.headers.get('origin') ?? request.headers.get('referer') ?? 'unknown'

  return Response.json(
    { error: 'Forbidden', reason: `Origin "${origin}" is not allowed. Requests must originate from directive.run or localhost.` },
    { status: 403 },
  )
}
