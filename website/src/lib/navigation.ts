import type { DocsVersion } from "@/lib/versions";

export interface NavigationLink {
  title: string;
  href: string;
}

export interface NavigationSection {
  title: string;
  links: NavigationLink[];
}

/**
 * Docs-only navigation (no AI/Security/Examples/Resources sections).
 * Used for the sidebar when browsing /docs/* pages.
 */
export const docsNavigation: NavigationSection[] = [
  {
    title: "Getting Started",
    links: [
      { title: "Quick Start", href: "/docs/quick-start" },
      { title: "Why Directive", href: "/docs/why-directive" },
      { title: "Installation", href: "/docs/installation" },
      { title: "Core Concepts", href: "/docs/core-concepts" },
      { title: "Comparison", href: "/docs/comparison" },
      { title: "Choosing Primitives", href: "/docs/choosing-primitives" },
    ],
  },
  {
    title: "Core API",
    links: [
      { title: "Overview", href: "/docs/core-api" },
      { title: "Module & System", href: "/docs/module-system" },
      { title: "Facts", href: "/docs/facts" },
      { title: "Derivations", href: "/docs/derivations" },
      { title: "Constraints", href: "/docs/constraints" },
      { title: "Resolvers", href: "/docs/resolvers" },
      { title: "Effects", href: "/docs/effects" },
      { title: "Events", href: "/docs/events" },
      { title: "Schema & Types", href: "/docs/schema-overview" },
      { title: "API Reference", href: "/docs/api/core" },
      { title: "Type Reference", href: "/docs/api/types" },
    ],
  },
  {
    title: "Framework Adapters",
    links: [
      { title: "Overview", href: "/docs/adapters/overview" },
      { title: "React", href: "/docs/adapters/react" },
      { title: "React API", href: "/docs/api/react" },
      { title: "Vue", href: "/docs/adapters/vue" },
      { title: "Vue API", href: "/docs/api/vue" },
      { title: "Svelte", href: "/docs/adapters/svelte" },
      { title: "Svelte API", href: "/docs/api/svelte" },
      { title: "Solid", href: "/docs/adapters/solid" },
      { title: "Solid API", href: "/docs/api/solid" },
      { title: "Lit", href: "/docs/adapters/lit" },
      { title: "Lit API", href: "/docs/api/lit" },
      { title: "Vanilla", href: "/docs/adapters/vanilla" },
      { title: "Vanilla API", href: "/docs/api/vanilla" },
    ],
  },
  {
    title: "Advanced",
    links: [
      { title: "Overview", href: "/docs/advanced/overview" },
      { title: "Multi-Module", href: "/docs/advanced/multi-module" },
      { title: "History & Snapshots", href: "/docs/advanced/history" },
      { title: "SSR & Hydration", href: "/docs/advanced/ssr" },
      { title: "Error Boundaries", href: "/docs/advanced/errors" },
    ],
  },
  {
    title: "Plugins",
    links: [
      { title: "Overview", href: "/docs/plugins/overview" },
      { title: "Logging", href: "/docs/plugins/logging" },
      { title: "DevTools", href: "/docs/plugins/devtools" },
      { title: "Persistence", href: "/docs/plugins/persistence" },
      { title: "Performance", href: "/docs/plugins/performance" },
      { title: "Circuit Breaker", href: "/docs/plugins/circuit-breaker" },
      { title: "Observability", href: "/docs/plugins/observability" },
      { title: "Custom Plugins", href: "/docs/plugins/custom" },
    ],
  },
  {
    title: "Testing",
    links: [
      { title: "Overview", href: "/docs/testing/overview" },
      { title: "Mock Resolvers", href: "/docs/testing/mock-resolvers" },
      { title: "Fake Timers", href: "/docs/testing/fake-timers" },
      { title: "Assertions", href: "/docs/testing/assertions" },
      { title: "Test Async Chains", href: "/docs/guides/test-async-chains" },
    ],
  },
  {
    title: "Examples",
    links: [
      { title: "Number Match", href: "/docs/examples/counter" },
      { title: "Auth Flow", href: "/docs/examples/auth-flow" },
      { title: "Shopping Cart", href: "/docs/examples/shopping-cart" },
      { title: "Async Chains", href: "/docs/examples/async-chains" },
      { title: "Form Wizard", href: "/docs/examples/form-wizard" },
      { title: "Sudoku", href: "/docs/examples/sudoku" },
      { title: "Checkers", href: "/docs/examples/checkers" },
      { title: "Time Machine", href: "/docs/examples/time-machine" },
      { title: "Error Boundaries", href: "/docs/examples/error-boundaries" },
      { title: "Fraud Analysis", href: "/docs/examples/fraud-analysis" },
      { title: "Dashboard Loader", href: "/docs/examples/dashboard-loader" },
    ],
  },
  {
    title: "Guides",
    links: [
      { title: "Overview", href: "/docs/guides/overview" },
      { title: "Loading & Error States", href: "/docs/guides/loading-states" },
      { title: "Authentication Flow", href: "/docs/guides/auth-flow" },
      { title: "Optimistic Updates", href: "/docs/guides/optimistic-updates" },
      { title: "Shopping Cart Rules", href: "/docs/guides/shopping-cart" },
      { title: "Multi-Step Form Wizard", href: "/docs/guides/form-wizard" },
      {
        title: "Async Chains Across Modules",
        href: "/docs/guides/async-chains",
      },
      { title: "Role-Based Permissions", href: "/docs/guides/permissions" },
      { title: "Batch Mutations", href: "/docs/guides/batch-mutations" },
      {
        title: "Debounce Constraints",
        href: "/docs/guides/debounce-constraints",
      },
      {
        title: "Debug with History",
        href: "/docs/guides/debug-history",
      },
    ],
  },
  {
    title: "Integration Guides",
    links: [
      { title: "Overview", href: "/docs/works-with/overview" },
      { title: "Redux", href: "/docs/works-with/redux" },
      { title: "Zustand", href: "/docs/works-with/zustand" },
      { title: "XState", href: "/docs/works-with/xstate" },
      { title: "React Query", href: "/docs/works-with/react-query" },
      { title: "Web Worker", href: "/docs/works-with/worker" },
    ],
  },
];

/**
 * AI-specific navigation. Used for the sidebar when browsing /ai/* pages.
 * Section titles drop redundant "AI" prefix since the /ai/ path provides context.
 */
export const aiNavigation: NavigationSection[] = [
  {
    title: "Foundations",
    links: [
      { title: "Overview", href: "/ai/overview" },
      { title: "Running Agents", href: "/ai/running-agents" },
      { title: "Resilience & Routing", href: "/ai/resilience-routing" },
      { title: "Comparison", href: "/ai/comparison" },
      { title: "Tutorial", href: "/ai/tutorial" },
      { title: "Troubleshooting", href: "/ai/troubleshooting" },
    ],
  },
  {
    title: "Agent Orchestrator",
    links: [
      { title: "Overview", href: "/ai/orchestrator" },
      { title: "Guardrails", href: "/ai/guardrails" },
      { title: "Streaming", href: "/ai/streaming" },
      { title: "Memory", href: "/ai/memory" },
    ],
  },
  {
    title: "Multi-Agent Orchestrator",
    links: [
      { title: "Overview", href: "/ai/multi-agent" },
      { title: "Execution Patterns", href: "/ai/patterns" },
      { title: "Communication", href: "/ai/communication" },
      { title: "Cross-Agent State", href: "/ai/cross-agent-state" },
      { title: "Tasks", href: "/ai/tasks" },
      { title: "Self-Healing", href: "/ai/self-healing" },
    ],
  },
  {
    title: "Infrastructure",
    links: [
      { title: "MCP Integration", href: "/ai/mcp" },
      { title: "RAG Enricher", href: "/ai/rag" },
      { title: "SSE Transport", href: "/ai/sse-transport" },
      { title: "Semantic Cache", href: "/ai/semantic-cache" },
    ],
  },
  {
    title: "Observability",
    links: [
      { title: "Debug Timeline", href: "/ai/debug-timeline" },
      { title: "Pattern Checkpoints", href: "/ai/checkpoints" },
      { title: "Breakpoints & Checkpoints", href: "/ai/breakpoints" },
      { title: "DevTools", href: "/ai/devtools" },
      // { title: 'Evals', href: '/ai/evals' },
      // { title: 'OpenTelemetry', href: '/ai/otel' },
      // { title: 'Testing', href: '/ai/testing' },
    ],
  },
  {
    title: "Security & Compliance",
    links: [
      { title: "Overview", href: "/ai/security/overview" },
      { title: "PII Detection", href: "/ai/security/pii" },
      { title: "Prompt Injection", href: "/ai/security/prompt-injection" },
      { title: "Audit Trail", href: "/ai/security/audit" },
      { title: "GDPR/CCPA", href: "/ai/security/compliance" },
    ],
  },
  {
    title: "Examples",
    links: [
      { title: "Chat", href: "/ai/examples/chat" },
      { title: "Research Pipeline", href: "/ai/examples/research-pipeline" },
      { title: "Safety Shield", href: "/ai/examples/safety-shield" },
      { title: "Checkpoint", href: "/ai/examples/checkpoint" },
      { title: "Fraud Analysis", href: "/ai/examples/fraud-analysis" },
      { title: "Pitch Deck", href: "/ai/examples/pitch-deck" },
      { title: "Data Pipeline", href: "/ai/examples/data-pipeline" },
      { title: "Code Review", href: "/ai/examples/code-review" },
    ],
  },
  {
    title: "Guides",
    links: [
      {
        title: "Prevent Off-Topic Responses",
        href: "/ai/guides/prevent-off-topic-responses",
      },
      {
        title: "Human Approval Workflows",
        href: "/ai/guides/human-approval-workflows",
      },
      { title: "Control AI Costs", href: "/ai/guides/control-ai-costs" },
      {
        title: "Customer Support Bot",
        href: "/ai/guides/customer-support-bot",
      },
      {
        title: "Validate Structured Output",
        href: "/ai/guides/validate-structured-output",
      },
      { title: "Handle Agent Errors", href: "/ai/guides/handle-agent-errors" },
      {
        title: "Stream Agent Responses",
        href: "/ai/guides/stream-agent-responses",
      },
      { title: "Multi-Step Pipeline", href: "/ai/guides/multi-step-pipeline" },
      {
        title: "Test Without LLM Calls",
        href: "/ai/guides/test-agents-without-llm",
      },
      { title: "DAG Pipeline", href: "/ai/guides/dag-pipeline" },
      { title: "Goal Pipeline", href: "/ai/guides/goal-pipeline" },
    ],
  },
];

/**
 * Combined navigation for backward compat (search, llms.txt).
 * Uses the new /ai/* hrefs for AI sections.
 */
export const navigation: NavigationSection[] = [
  ...docsNavigation,
  ...aiNavigation,
];

/**
 * Return the navigation tree with all hrefs prefixed for a given version.
 * For latest (pathPrefix: ""), this returns the original navigation unchanged.
 */
export function getNavigationForVersion(
  version: DocsVersion,
  nav: NavigationSection[] = docsNavigation,
): NavigationSection[] {
  if (!version.pathPrefix) {
    return nav;
  }

  return nav.map((section) => ({
    ...section,
    links: section.links.map((link) => ({
      ...link,
      href: link.href.replace("/docs", `/docs${version.pathPrefix}`),
    })),
  }));
}

/** Determine which top-level site section a pathname belongs to. */
export type SiteSection = "home" | "docs" | "ai" | "blog" | "other";

export function getSiteSection(pathname: string): SiteSection {
  if (pathname === "/") {
    return "home";
  }
  if (pathname.startsWith("/docs")) {
    return "docs";
  }
  if (pathname.startsWith("/ai")) {
    return "ai";
  }
  if (pathname.startsWith("/blog")) {
    return "blog";
  }

  return "other";
}

/** Set of all valid doc hrefs derived from the docs navigation tree. */
export const validDocRoutes: Set<string> = new Set();

/** Set of all valid AI hrefs derived from the AI navigation tree. */
export const validAIRoutes: Set<string> = new Set();

// Populate the valid routes Sets
for (const section of docsNavigation) {
  for (const link of section.links) {
    validDocRoutes.add(link.href);
  }
}

for (const section of aiNavigation) {
  for (const link of section.links) {
    validAIRoutes.add(link.href);
  }
}
