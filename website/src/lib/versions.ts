export interface DocsVersion {
  /** URL slug used in path prefix, e.g. "v0", "v1" */
  slug: string
  /** Human-readable label, e.g. "v0.x" */
  label: string
  /** Status determines banner and SEO behavior */
  status: 'latest' | 'current' | 'deprecated'
  /** Path prefix: "" for latest (canonical URLs), "/v0" for frozen */
  pathPrefix: string
  /**
   * Scope allows multiple independent version pickers.
   * Currently only "docs" exists. If AI packages diverge in a future
   * major version, add entries with scope "ai-docs" and render a
   * second picker in the AI section – no rewrite needed.
   */
  scope: string
}

/**
 * All known doc versions, newest first.
 * When v1.0 ships, snapshot current docs as v0 and add a new entry:
 *
 *   { slug: 'v0', label: 'v0.x', status: 'deprecated', pathPrefix: '/v0', scope: 'docs' }
 *
 * The unversioned entry (pathPrefix: "") always represents latest.
 */
export const DOCS_VERSIONS: DocsVersion[] = [
  {
    slug: 'v0',
    label: 'v0.x',
    status: 'latest',
    pathPrefix: '',
    scope: 'docs',
  },
]

/** The version whose pathPrefix is "" (i.e. the canonical, unversioned URLs). */
export const LATEST_VERSION: DocsVersion =
  DOCS_VERSIONS.find((v) => v.status === 'latest')!

// Match "/docs/v0/", "/docs/v1/", etc. at the start of a docs path
const VERSION_PREFIX_RE = /^\/docs\/(v\d+)(\/|$)/

/**
 * Determine which DocsVersion a pathname belongs to.
 * Falls back to LATEST_VERSION for unversioned paths like `/docs/quick-start`.
 */
export function getVersionFromPath(pathname: string): DocsVersion {
  const match = pathname.match(VERSION_PREFIX_RE)

  if (match) {
    const slug = match[1]
    const found = DOCS_VERSIONS.find((v) => v.slug === slug)

    if (found) {
      return found
    }
  }

  return LATEST_VERSION
}

/**
 * Get all versions for a given scope, newest first.
 * Currently only "docs" exists but this supports future AI-specific scopes.
 */
export function getVersionsForScope(scope: string): DocsVersion[] {
  return DOCS_VERSIONS.filter((v) => v.scope === scope)
}

/**
 * Rewrite a docs pathname from one version to another.
 *
 * Examples:
 *   switchVersionPath("/docs/quick-start", latestV0, frozenV0)
 *     → "/docs/v0/quick-start"
 *
 *   switchVersionPath("/docs/v0/quick-start", frozenV0, latestV1)
 *     → "/docs/quick-start"
 */
export function switchVersionPath(
  currentPath: string,
  from: DocsVersion,
  to: DocsVersion,
): string {
  // Strip the source version prefix to get the bare docs-relative path
  let barePath: string

  if (from.pathPrefix) {
    barePath = currentPath.replace(`/docs${from.pathPrefix}`, '/docs')
  } else {
    barePath = currentPath
  }

  // Apply the target version prefix
  if (to.pathPrefix) {
    return barePath.replace('/docs', `/docs${to.pathPrefix}`)
  }

  return barePath
}
