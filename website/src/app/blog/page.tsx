import dynamic from 'next/dynamic'
import type { Metadata } from 'next'

import { BlogCard } from '@/components/BlogCard'
import { BlogListItem } from '@/components/BlogListItem'
import { getFeaturedPosts, posts } from '@/lib/blog'

function BlogPostListFallback() {
  return (
    <section>
      <div className="mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          All posts
        </h2>
      </div>
      <div>
        {posts.map((post) => (
          <BlogListItem key={post.slug} post={post} />
        ))}
      </div>
    </section>
  )
}

const BlogPostList = dynamic(
  () => import('@/components/BlogPostList').then((m) => m.BlogPostList),
  {
    loading: () => <BlogPostListFallback />,
  },
)

export const metadata: Metadata = {
  title: 'Blog - Directive',
  description:
    'Deep dives into constraint-driven architecture, state management patterns, and building AI agents with Directive.',
}

export default function BlogPage() {
  const featured = getFeaturedPosts()

  return (
    <div className="w-full py-16">
      <div className="mb-12">
        <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900 dark:text-white">
          Blog
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-slate-600 dark:text-slate-400">
          Deep dives into constraint-driven architecture, state management
          patterns, and building AI agents with Directive.
        </p>
      </div>

      {featured.length > 0 && (
        <section className="mb-16">
          <h2 className="mb-6 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Featured
          </h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((post) => (
              <BlogCard key={post.slug} post={post} />
            ))}
          </div>
        </section>
      )}

      <BlogPostList />
    </div>
  )
}
