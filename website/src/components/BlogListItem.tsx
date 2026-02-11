import Link from 'next/link'

import type { BlogPost } from '@/lib/blog'
import { resolveAuthor } from '@/lib/blog'

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function BlogListItem({ post }: { post: BlogPost }) {
  const author = resolveAuthor(post.author)

  return (
    <article className="grid grid-cols-1 border-b border-slate-200 py-10 last:border-b-0 sm:grid-cols-3 dark:border-slate-800">
      <div className="mb-2 sm:mb-0">
        <time
          dateTime={post.date}
          className="text-sm text-slate-500 dark:text-slate-400"
        >
          {formatDate(post.date)}
        </time>
        <p className="mt-1 text-sm font-medium text-slate-700 dark:text-slate-300">
          {author.name}
        </p>
      </div>
      <div className="sm:col-span-2">
        <Link href={`/blog/${post.slug}`} className="group">
          <h3 className="text-lg font-semibold text-slate-900 group-hover:text-brand-primary dark:text-white dark:group-hover:text-brand-primary-400">
            {post.title}
          </h3>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {post.description}
          </p>
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-primary dark:text-brand-primary-400">
            Read more
            <svg
              className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
              />
            </svg>
          </span>
        </Link>
      </div>
    </article>
  )
}
