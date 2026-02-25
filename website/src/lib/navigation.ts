import type { DocsVersion } from '@/lib/versions'

export interface NavigationLink {
  title: string
  href: string
}

export interface NavigationSection {
  title: string
  links: NavigationLink[]
}

/**
 * Docs-only navigation (no AI/Security/Examples/Resources sections).
 * Used for the sidebar when browsing /docs/* pages.
 */
export const docsNavigation: NavigationSection[] = [
  {
    title: 'Getting Started',
    links: [
      { title: 'Quick Start', href: '/docs/quick-start' },
      { title: 'Installation', href: '/docs/installation' },
      { title: 'Core Concepts', href: '/docs/core-concepts' },
      { title: 'Why Directive', href: '/docs/why-directive' },
      { title: 'Comparison', href: '/docs/comparison' },
      { title: 'Choosing Primitives', href: '/docs/choosing-primitives' },
    ],
  },
  {
    title: 'Core API',
    links: [
      { title: 'Overview', href: '/docs/core-api' },
      { title: 'Module & System', href: '/docs/module-system' },
      { title: 'Facts', href: '/docs/facts' },
      { title: 'Derivations', href: '/docs/derivations' },
      { title: 'Constraints', href: '/docs/constraints' },
      { title: 'Resolvers', href: '/docs/resolvers' },
      { title: 'Effects', href: '/docs/effects' },
      { title: 'Events', href: '/docs/events' },
      { title: 'Builders', href: '/docs/builders' },
      { title: 'Schema & Types', href: '/docs/schema-overview' },
      { title: 'API Reference', href: '/docs/api/core' },
      { title: 'Type Reference', href: '/docs/api/types' },
    ],
  },
  {
    title: 'Framework Adapters',
    links: [
      { title: 'Overview', href: '/docs/adapters/overview' },
      { title: 'React', href: '/docs/adapters/react' },
      { title: 'React API', href: '/docs/api/react' },
      { title: 'Vue', href: '/docs/adapters/vue' },
      { title: 'Vue API', href: '/docs/api/vue' },
      { title: 'Svelte', href: '/docs/adapters/svelte' },
      { title: 'Svelte API', href: '/docs/api/svelte' },
      { title: 'Solid', href: '/docs/adapters/solid' },
      { title: 'Solid API', href: '/docs/api/solid' },
      { title: 'Lit', href: '/docs/adapters/lit' },
      { title: 'Lit API', href: '/docs/api/lit' },
    ],
  },
  {
    title: 'Plugins',
    links: [
      { title: 'Overview', href: '/docs/plugins/overview' },
      { title: 'Logging', href: '/docs/plugins/logging' },
      { title: 'DevTools', href: '/docs/plugins/devtools' },
      { title: 'DevTools Live', href: '/devtools' },
      { title: 'Persistence', href: '/docs/plugins/persistence' },
      { title: 'Performance', href: '/docs/plugins/performance' },
      { title: 'Custom Plugins', href: '/docs/plugins/custom' },
    ],
  },
  {
    title: 'Advanced',
    links: [
      { title: 'Overview', href: '/docs/advanced/overview' },
      { title: 'Multi-Module', href: '/docs/advanced/multi-module' },
      { title: 'Time-Travel & Snapshots', href: '/docs/advanced/time-travel' },
      { title: 'SSR & Hydration', href: '/docs/advanced/ssr' },
      { title: 'Error Boundaries', href: '/docs/advanced/errors' },
    ],
  },
  {
    title: 'Testing',
    links: [
      { title: 'Overview', href: '/docs/testing/overview' },
      { title: 'Mock Resolvers', href: '/docs/testing/mock-resolvers' },
      { title: 'Fake Timers', href: '/docs/testing/fake-timers' },
      { title: 'Assertions', href: '/docs/testing/assertions' },
      { title: 'Test Async Chains', href: '/docs/how-to/test-async-chains' },
    ],
  },
  {
    title: 'Integrations',
    links: [
      { title: 'Overview', href: '/docs/works-with/overview' },
      { title: 'Redux', href: '/docs/works-with/redux' },
      { title: 'Zustand', href: '/docs/works-with/zustand' },
      { title: 'XState', href: '/docs/works-with/xstate' },
      { title: 'React Query', href: '/docs/works-with/react-query' },
      { title: 'Web Worker', href: '/docs/works-with/worker' },
    ],
  },
  {
    title: 'Guides',
    links: [
      // Every-App Essentials
      { title: 'Global UI State', href: '/docs/how-to/global-ui-state' },
      { title: 'Loading & Error States', href: '/docs/how-to/loading-states' },
      { title: 'Authentication Flow', href: '/docs/how-to/auth-flow' },
      { title: 'Pagination & Infinite Scroll', href: '/docs/how-to/pagination' },
      { title: 'Sync State with URL', href: '/docs/how-to/url-sync' },
      { title: 'Optimistic Updates', href: '/docs/how-to/optimistic-updates' },
      { title: 'Notifications & Toasts', href: '/docs/how-to/notifications' },
      { title: 'Persist State', href: '/docs/how-to/persist-state' },
      // Multi-Module & Architecture
      { title: 'Async Chains Across Modules', href: '/docs/how-to/async-chains' },
      { title: 'Organize Modules', href: '/docs/how-to/organize-modules' },
      { title: 'Multi-Step Form Wizard', href: '/docs/how-to/form-wizard' },
      { title: 'Shopping Cart Rules', href: '/docs/how-to/shopping-cart' },
      { title: 'Role-Based Permissions', href: '/docs/how-to/permissions' },
      { title: 'Dynamic Modules', href: '/docs/how-to/dynamic-modules' },
      // Performance & Real-Time
      { title: 'Optimize Re-Renders', href: '/docs/how-to/optimize-rerenders' },
      { title: 'Batch Mutations', href: '/docs/how-to/batch-mutations' },
      { title: 'WebSocket Connections', href: '/docs/how-to/websockets' },
      { title: 'Debounce Constraints', href: '/docs/how-to/debounce-constraints' },
      // Testing & Debugging
      { title: 'Test Async Chains', href: '/docs/how-to/test-async-chains' },
      { title: 'Debug with Time-Travel', href: '/docs/how-to/debug-time-travel' },
    ],
  },
  {
    title: 'Examples',
    links: [
      // Beginner
      { title: 'Counter', href: '/docs/examples/counter' },
      { title: 'Data Fetching', href: '/docs/examples/data-fetching' },
      { title: 'Form Validation', href: '/docs/examples/form-validation' },
      { title: 'Contact Form', href: '/docs/examples/contact-form' },
      // Everyday patterns
      { title: 'Theme & Locale', href: '/docs/examples/theme-locale' },
      { title: 'Auth Flow', href: '/docs/examples/auth-flow' },
      { title: 'Pagination', href: '/docs/examples/pagination' },
      { title: 'URL Sync', href: '/docs/examples/url-sync' },
      { title: 'Notifications', href: '/docs/examples/notifications' },
      { title: 'Dashboard Loader', href: '/docs/examples/dashboard-loader' },
      { title: 'Optimistic Updates', href: '/docs/examples/optimistic-updates' },
      { title: 'WebSocket', href: '/docs/examples/websocket' },
      // Multi-module & advanced
      { title: 'Async Chains', href: '/docs/examples/async-chains' },
      { title: 'Form Wizard', href: '/docs/examples/form-wizard' },
      { title: 'Shopping Cart', href: '/docs/examples/shopping-cart' },
      { title: 'Permissions', href: '/docs/examples/permissions' },
      { title: 'Multi-Module', href: '/docs/examples/multi-module' },
      { title: 'Feature Flags', href: '/docs/examples/feature-flags' },
      { title: 'A/B Testing', href: '/docs/examples/ab-testing' },
      { title: 'Topic Guard', href: '/docs/examples/topic-guard' },
      { title: 'Debounce Constraints', href: '/docs/examples/debounce-constraints' },
      { title: 'Dynamic Modules', href: '/docs/examples/dynamic-modules' },
      // Showcases
      { title: 'Sudoku', href: '/docs/examples/sudoku' },
      { title: 'Checkers', href: '/docs/examples/checkers' },
      // Showcases (full-feature)
      { title: 'Fraud Analysis', href: '/docs/examples/fraud-analysis' },
      { title: 'Goal Heist', href: '/docs/examples/goal-heist' },
      // Specialized
      { title: 'Server-Side', href: '/docs/examples/server' },
      { title: 'AI Agent', href: '/docs/examples/ai-agent' },
    ],
  },
]

/**
 * AI-specific navigation. Used for the sidebar when browsing /ai/* pages.
 * Section titles drop redundant "AI" prefix since the /ai/ path provides context.
 */
export const aiNavigation: NavigationSection[] = [
  {
    title: 'Foundations',
    links: [
      { title: 'Overview', href: '/ai/overview' },
      { title: 'Running Agents', href: '/ai/running-agents' },
      { title: 'Resilience & Routing', href: '/ai/resilience-routing' },
      { title: 'Comparison', href: '/ai/comparison' },
      { title: 'Tutorial', href: '/ai/tutorial' },
    ],
  },
  {
    title: 'Agent Orchestrator',
    links: [
      { title: 'Overview', href: '/ai/orchestrator' },
      { title: 'Guardrails', href: '/ai/guardrails' },
      { title: 'Streaming', href: '/ai/streaming' },
      { title: 'Memory', href: '/ai/memory' },
    ],
  },
  {
    title: 'Multi-Agent Orchestrator',
    links: [
      { title: 'Overview', href: '/ai/multi-agent' },
      { title: 'Execution Patterns', href: '/ai/patterns' },
      { title: 'Communication', href: '/ai/communication' },
      { title: 'Cross-Agent State', href: '/ai/cross-agent-state' },
      { title: 'Self-Healing', href: '/ai/self-healing' },
    ],
  },
  {
    title: 'Infrastructure',
    links: [
      { title: 'MCP Integration', href: '/ai/mcp' },
      { title: 'RAG Enricher', href: '/ai/rag' },
      { title: 'SSE Transport', href: '/ai/sse-transport' },
      { title: 'Semantic Cache', href: '/ai/semantic-cache' },
    ],
  },
  {
    title: 'Observability',
    links: [
      { title: 'Debug Timeline', href: '/ai/debug-timeline' },
      { title: 'Pattern Checkpoints', href: '/ai/checkpoints' },
      { title: 'Breakpoints & Checkpoints', href: '/ai/breakpoints' },
      { title: 'DevTools', href: '/ai/devtools' },
      { title: 'DevTools Live', href: '/devtools' },
      { title: 'Evals', href: '/ai/evals' },
      { title: 'OpenTelemetry', href: '/ai/otel' },
      { title: 'Testing', href: '/ai/testing' },
    ],
  },
  {
    title: 'Security & Compliance',
    links: [
      { title: 'Overview', href: '/ai/security/overview' },
      { title: 'PII Detection', href: '/ai/security/pii' },
      { title: 'Prompt Injection', href: '/ai/security/prompt-injection' },
      { title: 'Audit Trail', href: '/ai/security/audit' },
      { title: 'GDPR/CCPA', href: '/ai/security/compliance' },
    ],
  },
  {
    title: 'Guides',
    links: [
      { title: 'Prevent Off-Topic Responses', href: '/ai/guides/prevent-off-topic-responses' },
      { title: 'Human Approval Workflows', href: '/ai/guides/human-approval-workflows' },
      { title: 'Control AI Costs', href: '/ai/guides/control-ai-costs' },
      { title: 'Customer Support Bot', href: '/ai/guides/customer-support-bot' },
      { title: 'Validate Structured Output', href: '/ai/guides/validate-structured-output' },
      { title: 'Add Chatbot Memory', href: '/ai/guides/chatbot-memory' },
      { title: 'Handle Agent Errors', href: '/ai/guides/handle-agent-errors' },
      { title: 'Stream Agent Responses', href: '/ai/guides/stream-agent-responses' },
      { title: 'Multi-Step Pipeline', href: '/ai/guides/multi-step-pipeline' },
      { title: 'Test Without LLM Calls', href: '/ai/guides/test-agents-without-llm' },
      { title: 'Smart Model Routing', href: '/ai/guides/smart-model-routing' },
      { title: 'DAG Pipeline', href: '/ai/guides/dag-pipeline' },
      { title: 'Self-Improving Agents', href: '/ai/guides/self-improving-agents' },
    ],
  },
]

/**
 * Combined navigation for backward compat (search, llms.txt).
 * Uses the new /ai/* hrefs for AI sections.
 */
export const navigation: NavigationSection[] = [
  ...docsNavigation,
  ...aiNavigation,
]

/**
 * Return the navigation tree with all hrefs prefixed for a given version.
 * For latest (pathPrefix: ""), this returns the original navigation unchanged.
 */
export function getNavigationForVersion(
  version: DocsVersion,
  nav: NavigationSection[] = docsNavigation,
): NavigationSection[] {
  if (!version.pathPrefix) {
    return nav
  }

  return nav.map((section) => ({
    ...section,
    links: section.links.map((link) => ({
      ...link,
      href: link.href.replace('/docs', `/docs${version.pathPrefix}`),
    })),
  }))
}

/** Determine which top-level site section a pathname belongs to. */
export type SiteSection = 'home' | 'docs' | 'ai' | 'blog' | 'other'

export function getSiteSection(pathname: string): SiteSection {
  if (pathname === '/') {
    return 'home'
  }
  if (pathname.startsWith('/docs')) {
    return 'docs'
  }
  if (pathname.startsWith('/ai')) {
    return 'ai'
  }
  if (pathname.startsWith('/blog')) {
    return 'blog'
  }

  return 'other'
}

/** Set of all valid doc hrefs derived from the docs navigation tree. */
export const validDocRoutes: Set<string> = new Set()

/** Set of all valid AI hrefs derived from the AI navigation tree. */
export const validAIRoutes: Set<string> = new Set()

// Populate the valid routes Sets
for (const section of docsNavigation) {
  for (const link of section.links) {
    validDocRoutes.add(link.href)
  }
}

for (const section of aiNavigation) {
  for (const link of section.links) {
    validAIRoutes.add(link.href)
  }
}
