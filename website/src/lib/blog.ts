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
    slug: 'constraint-driven-architecture',
    title: 'Constraint-Driven Architecture',
    description:
      'Learn why declaring "what must be true" is more powerful than imperative state transitions. Explore the paradigm shift from event-driven to constraint-driven systems.',
    date: '2026-02-01',
    author: 'directive-labs',
    categories: ['Architecture', 'State Management'],
    featured: true,
  },
  {
    slug: 'why-state-machines-arent-enough',
    title: "Why State Machines Aren't Enough",
    description:
      'State machines are great for UI flows, but struggle with data-driven constraints. Discover when to use state machines vs. constraint-driven systems.',
    date: '2026-01-25',
    author: 'directive-labs',
    categories: ['Architecture', 'Comparison'],
    featured: true,
  },
  {
    slug: 'building-ai-agents',
    title: 'Building AI Agents with Directive',
    description:
      'A practical guide to orchestrating AI agents with approval flows, guardrails, and budget constraints using Directive.',
    date: '2026-01-18',
    author: 'directive-labs',
    categories: ['AI', 'Tutorial'],
    featured: true,
  },
]

export function getPost(slug: string): BlogPost | undefined {
  return posts.find((p) => p.slug === slug)
}

export function getFeaturedPosts(): BlogPost[] {
  return posts.filter((p) => p.featured)
}

export function getAllCategories(): string[] {
  const cats = new Set<string>()
  for (const post of posts) {
    for (const cat of post.categories) {
      cats.add(cat)
    }
  }
  return Array.from(cats).sort()
}
