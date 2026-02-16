import Link from 'next/link'

import { type BlogPost, getRelatedPosts } from '@/lib/blog'

interface RelatedPostsProps {
  slug: string
}

export function RelatedPosts({ slug }: RelatedPostsProps) {
  const related = getRelatedPosts(slug)

  if (related.length === 0) {
    return null
  }

  return (
    <div className="mt-12 border-t border-slate-200 pt-8 dark:border-slate-800">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        Related Posts
      </h2>
      <ul className="mt-4 space-y-4">
        {related.map((post) => (
          <li key={post.slug}>
            <Link
              href={`/blog/${post.slug}`}
              className="group block"
            >
              <p className="font-semibold text-brand-primary group-hover:underline dark:text-brand-primary-400">
                {post.title}
              </p>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                {post.description}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
