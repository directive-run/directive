export interface Author {
  id: string
  name: string
  role: string
}

export const authors: Record<string, Author> = {
  'directive-labs': {
    id: 'directive-labs',
    name: 'Directive Labs',
    role: 'The Directive Team',
  },
  'jason-comes': {
    id: 'jason-comes',
    name: 'Jason Comes',
    role: 'Creator',
  },
}

export interface BlogPost {
  slug: string
  title: string
  description: string
  date: string
  author: string
  categories: string[]
  featured: boolean
}

export function resolveAuthor(authorId: string): Author {
  return authors[authorId] ?? { id: authorId, name: authorId, role: '' }
}

export const posts: BlogPost[] = [
  {
    slug: 'declarative-forms-with-directive',
    title: "Declarative Forms with Directive: Zero useState, Zero useEffect",
    description:
      'Build a production contact form using Directive\'s six primitives. Per-field validation, async submission, rate limiting, and auto-reset \u2013 without a single useState or useEffect.',
    date: '2026-02-16',
    author: 'jason-comes',
    categories: ['Tutorial', 'Architecture'],
    featured: true,
  },
  {
    slug: 'declarative-newsletter-with-directive',
    title: 'Declarative Newsletter Signup with Directive: The Simplest Module',
    description:
      'We said newsletter signup didn\u2019t need Directive. Here\u2019s why we were wrong.',
    date: '2026-02-17',
    author: 'jason-comes',
    categories: ['Tutorial', 'Architecture'],
    featured: false,
  },
  {
    slug: 'directive-on-the-server',
    title: 'Directive on the Server',
    description:
      'Distributable snapshots, signed verification, audit trails, and GDPR compliance \u2013 Directive runs on Node.js without React.',
    date: '2026-02-18',
    author: 'directive-labs',
    categories: ['Architecture', 'Tutorial'],
    featured: false,
  },
  {
    slug: 'introducing-directive',
    title: 'Introducing Directive',
    description:
      'Declare what must be true. Let the runtime resolve it. Directive is a constraint-driven runtime for TypeScript that replaces imperative state management with declarative rules.',
    date: '2026-02-15',
    author: 'jason-comes',
    categories: ['Architecture', 'State Management'],
    featured: true,
  },
  {
    slug: 'constraint-driven-architecture',
    title: 'Constraint-Driven Architecture',
    description:
      'Learn why declaring "what must be true" is more powerful than imperative state transitions. Explore the paradigm shift from event-driven to constraint-driven systems.',
    date: '2026-02-14',
    author: 'directive-labs',
    categories: ['Architecture', 'State Management'],
    featured: true,
  },
  {
    slug: 'data-fetching-with-directive',
    title: 'Data Fetching with Directive',
    description:
      'The complete guide to fetching, caching, invalidation, deduplication, cancellation, batching, optimistic updates, and polling – all with constraints and resolvers.',
    date: '2026-02-23',
    author: 'directive-labs',
    categories: ['Tutorial', 'Architecture'],
    featured: true,
  },
  {
    slug: 'stop-writing-if-else-chains',
    title: 'Stop Writing If-Else Chains for Business Logic',
    description:
      'Replace sprawling conditional logic with declarative constraints. See how constraint-driven architecture eliminates imperative rule spaghetti.',
    date: '2026-03-02',
    author: 'directive-labs',
    categories: ['Architecture', 'Tutorial'],
    featured: false,
  },
  {
    slug: 'why-ai-loves-directive',
    title: 'Why AI Loves Directive',
    description:
      'AI frameworks handle LLM calls. Production agents need budget enforcement, PII redaction, tool control, and approval workflows. Directive adds the orchestration layer without replacing your framework.',
    date: '2026-03-09',
    author: 'directive-labs',
    categories: ['AI', 'Architecture'],
    featured: false,
  },
  {
    slug: 'from-redux-to-directive',
    title: 'From Redux to Directive in 10 Minutes',
    description:
      'A step-by-step migration from Redux Toolkit to Directive. See how actions, reducers, selectors, and thunks map to facts, derivations, constraints, and resolvers.',
    date: '2026-03-16',
    author: 'directive-labs',
    categories: ['Migration', 'Tutorial'],
    featured: false,
  },
  {
    slug: 'why-state-machines-arent-enough',
    title: "Why State Machines Aren't Enough",
    description:
      'State machines are great for UI flows, but struggle with data-driven constraints. Discover when to use state machines vs. constraint-driven systems.',
    date: '2026-03-23',
    author: 'directive-labs',
    categories: ['Architecture', 'Comparison'],
    featured: false,
  },
  {
    slug: 'zustand-imperative-state-machine',
    title: 'Your Zustand Store Is Secretly an Imperative State Machine',
    description:
      'Zustand is great for simple state. But when stores grow complex with async logic, cross-store deps, and manual retries, you have built an ad-hoc state machine without the guarantees.',
    date: '2026-03-30',
    author: 'directive-labs',
    categories: ['Comparison', 'State Management'],
    featured: false,
  },
  {
    slug: 'declarative-ai-guardrails',
    title: 'Declarative AI Guardrails: Why Your Agent Framework Needs a Constraint Layer',
    description:
      'Budget enforcement, PII protection, tool denylists, and human-in-the-loop approval — declared as constraints, enforced by the runtime.',
    date: '2026-04-06',
    author: 'directive-labs',
    categories: ['AI', 'Architecture'],
    featured: false,
  },
  {
    slug: 'building-ai-agents',
    title: 'Building AI Agents with Directive',
    description:
      'A practical guide to orchestrating AI agents with approval flows, guardrails, and budget constraints using Directive.',
    date: '2026-04-13',
    author: 'directive-labs',
    categories: ['AI', 'Tutorial'],
    featured: false,
  },
  {
    slug: 'real-time-dashboard',
    title: 'Building a Real-Time Dashboard with Directive',
    description:
      'Orchestrate REST APIs, WebSockets, and polling with separate modules, cross-source derivations, and resilient reconnection constraints.',
    date: '2026-04-20',
    author: 'directive-labs',
    categories: ['Tutorial', 'Architecture'],
    featured: false,
  },
  {
    slug: 'feature-flags-without-a-service',
    title: 'Feature Flags Without a Feature Flag Service',
    description:
      'Boolean flags don\'t scale. Build a reactive, inspectable feature flag system using constraints, derivations, and effects.',
    date: '2026-04-27',
    author: 'directive-labs',
    categories: ['Architecture', 'Tutorial'],
    featured: false,
  },
  {
    slug: 'building-ai-docs-chatbot',
    title: 'Building an AI Docs Chatbot with Directive',
    description:
      'How the AI adapter and the core runtime work together to power a RAG-backed docs chatbot with streaming, guardrails, and reactive server-side state.',
    date: '2026-05-04',
    author: 'jason-comes',
    categories: ['AI', 'Tutorial'],
    featured: false,
  },
  {
    slug: 'inside-the-reconciliation-loop',
    title: "Inside Directive's Reconciliation Loop",
    description:
      'A deep dive into the 5-phase engine cycle: fact mutation, derivation invalidation, constraint evaluation, requirement deduplication, and resolver dispatch.',
    date: '2026-05-11',
    author: 'directive-labs',
    categories: ['Architecture', 'Engineering'],
    featured: false,
  },
  {
    slug: 'ab-testing-with-directive',
    title: 'A/B Testing with Directive',
    description:
      'Build a complete A/B testing engine using constraints, resolvers, and effects. Deterministic assignment, exposure tracking, and variant gating \u2013 no third-party service required.',
    date: '2026-05-18',
    author: 'directive-labs',
    categories: ['Tutorial', 'Architecture'],
    featured: false,
  },
]

function isPublished(post: BlogPost): boolean {
  const today = new Date().toISOString().slice(0, 10)

  return post.date <= today
}

export function getPublishedPosts(): BlogPost[] {
  return posts.filter(isPublished)
}

export function getPost(slug: string): BlogPost | undefined {
  const post = posts.find((p) => p.slug === slug)
  if (post && !isPublished(post)) {
    return undefined
  }

  return post
}

export function getFeaturedPosts(): BlogPost[] {
  return posts.filter((p) => p.featured && isPublished(p))
}

export function getAllCategories(): string[] {
  const cats = new Set<string>()
  for (const post of getPublishedPosts()) {
    for (const cat of post.categories) {
      cats.add(cat)
    }
  }

  return Array.from(cats).sort()
}

export function getRelatedPosts(slug: string, limit = 3): BlogPost[] {
  const current = posts.find((p) => p.slug === slug)
  if (!current) {
    return []
  }

  const published = getPublishedPosts().filter((p) => p.slug !== slug)

  const scored = published.map((post) => {
    const shared = post.categories.filter((c) => current.categories.includes(c)).length

    return { post, shared }
  })

  scored.sort((a, b) => {
    if (b.shared !== a.shared) {
      return b.shared - a.shared
    }

    return b.post.date.localeCompare(a.post.date)
  })

  return scored.slice(0, limit).map((s) => s.post)
}
