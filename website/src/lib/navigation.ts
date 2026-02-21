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
 * Return the navigation tree with all hrefs prefixed for a given version.
 * For latest (pathPrefix: ""), this returns the original navigation unchanged.
 */
export function getNavigationForVersion(
  version: DocsVersion,
): NavigationSection[] {
  if (!version.pathPrefix) {
    return navigation
  }

  return navigation.map((section) => ({
    ...section,
    links: section.links.map((link) => ({
      ...link,
      href: link.href.replace('/docs', `/docs${version.pathPrefix}`),
    })),
  }))
}

/** Set of all valid doc hrefs derived from the navigation tree. */
export const validDocRoutes: Set<string> = new Set()

export const navigation: NavigationSection[] = [
  {
    title: 'Getting Started',
    links: [
      { title: 'Quick Start', href: '/docs/quick-start' },
      { title: 'Installation', href: '/docs/installation' },
      { title: 'Core Concepts', href: '/docs/core-concepts' },
      { title: 'Why Directive', href: '/docs/why-directive' },
      { title: 'Comparison', href: '/docs/comparison' },
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
      { title: 'Persistence', href: '/docs/plugins/persistence' },
      { title: 'Performance', href: '/docs/plugins/performance' },
      { title: 'Custom Plugins', href: '/docs/plugins/custom' },
    ],
  },
  {
    title: 'AI Foundations',
    links: [
      { title: 'Overview', href: '/docs/ai/overview' },
      { title: 'Running Agents', href: '/docs/ai/running-agents' },
      { title: 'Resilience & Routing', href: '/docs/ai/resilience-routing' },
      { title: 'Comparison', href: '/docs/ai/comparison' },
      { title: 'Tutorial', href: '/docs/ai/tutorial' },
    ],
  },
  {
    title: 'Agent Orchestrator',
    links: [
      { title: 'Overview', href: '/docs/ai/orchestrator' },
      { title: 'Guardrails', href: '/docs/ai/guardrails' },
      { title: 'Streaming', href: '/docs/ai/streaming' },
      { title: 'Memory', href: '/docs/ai/memory' },
    ],
  },
  {
    title: 'Multi-Agent Orchestrator',
    links: [
      { title: 'Overview', href: '/docs/ai/multi-agent' },
      { title: 'Execution Patterns', href: '/docs/ai/patterns' },
      { title: 'Communication', href: '/docs/ai/communication' },
      { title: 'Cross-Agent State', href: '/docs/ai/cross-agent-state' },
      { title: 'Self-Healing', href: '/docs/ai/self-healing' },
      { title: 'Goal Engine', href: '/docs/ai/goals' },
    ],
  },
  {
    title: 'AI Infrastructure',
    links: [
      { title: 'MCP Integration', href: '/docs/ai/mcp' },
      { title: 'RAG Enricher', href: '/docs/ai/rag' },
      { title: 'SSE Transport', href: '/docs/ai/sse-transport' },
      { title: 'Semantic Cache', href: '/docs/ai/semantic-cache' },
    ],
  },
  {
    title: 'AI Observability',
    links: [
      { title: 'Debug Timeline', href: '/docs/ai/debug-timeline' },
      { title: 'Breakpoints & Checkpoints', href: '/docs/ai/breakpoints' },
      { title: 'DevTools', href: '/docs/ai/devtools' },
      { title: 'Evals', href: '/docs/ai/evals' },
      { title: 'OpenTelemetry', href: '/docs/ai/otel' },
      { title: 'Testing', href: '/docs/ai/testing' },
      { title: 'DevTools Live', href: '/devtools' },
    ],
  },
  {
    title: 'Security & Compliance',
    links: [
      { title: 'Overview', href: '/docs/security/overview' },
      { title: 'PII Detection', href: '/docs/security/pii' },
      { title: 'Prompt Injection', href: '/docs/security/prompt-injection' },
      { title: 'Audit Trail', href: '/docs/security/audit' },
      { title: 'GDPR/CCPA', href: '/docs/security/compliance' },
    ],
  },
  {
    title: 'Advanced',
    links: [
      { title: 'Overview', href: '/docs/advanced/overview' },
      { title: 'Multi-Module', href: '/docs/advanced/multi-module' },
      { title: 'Time-Travel & Snapshots', href: '/docs/advanced/time-travel' },
      { title: 'Snapshots', href: '/docs/advanced/snapshots' },
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
    title: 'Examples',
    links: [
      { title: 'Overview', href: '/docs/examples/overview' },
      { title: 'Sudoku', href: '/docs/examples/sudoku' },
      // Individual examples hidden while verifying each one works.
      // Add back one at a time after confirming.
      // { title: 'Checkers', href: '/docs/examples/checkers' },
      // { title: 'Counter', href: '/docs/examples/counter' },
      // { title: 'Data Fetching', href: '/docs/examples/data-fetching' },
      // { title: 'Form Validation', href: '/docs/examples/form-validation' },
      // { title: 'Multi-Module App', href: '/docs/examples/multi-module' },
      // { title: 'AI Agent', href: '/docs/examples/ai-agent' },
      // { title: 'Feature Flags', href: '/docs/examples/feature-flags' },
      // { title: 'A/B Testing', href: '/docs/examples/ab-testing' },
      // { title: 'Contact Form', href: '/docs/examples/contact-form' },
      // { title: 'Server (Node.js)', href: '/docs/examples/server' },
    ],
  },
  {
    title: 'Guides',
    links: [
      { title: 'Loading & Error States', href: '/docs/how-to/loading-states' },
      { title: 'Authentication Flow', href: '/docs/how-to/auth-flow' },
      { title: 'WebSocket Connections', href: '/docs/how-to/websockets' },
      { title: 'Optimistic Updates', href: '/docs/how-to/optimistic-updates' },
      { title: 'Organize Modules', href: '/docs/how-to/organize-modules' },
      { title: 'Optimize Re-Renders', href: '/docs/how-to/optimize-rerenders' },
      { title: 'Debounce Constraints', href: '/docs/how-to/debounce-constraints' },
      { title: 'Dynamic Modules', href: '/docs/how-to/dynamic-modules' },
      { title: 'Persist State', href: '/docs/how-to/persist-state' },
      { title: 'Batch Mutations', href: '/docs/how-to/batch-mutations' },
      { title: 'Debug with Time-Travel', href: '/docs/how-to/debug-time-travel' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { title: 'Glossary', href: '/docs/glossary' },
      { title: 'FAQ', href: '/docs/faq' },
      { title: 'Troubleshooting', href: '/docs/troubleshooting' },
      { title: 'Brand Guide', href: '/docs/branding' },
      { title: 'Roadmap', href: '/docs/roadmap' },
    ],
  },
]

// Populate the valid routes Set from the navigation tree
for (const section of navigation) {
  for (const link of section.links) {
    validDocRoutes.add(link.href)
  }
}
