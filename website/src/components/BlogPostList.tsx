'use client'

import { useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { BlogListItem } from '@/components/BlogListItem'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import { getAllCategories, getPublishedPosts } from '@/lib/blog'

const PAGE_SIZE = 10

export function BlogPostList() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeCategory = searchParams.get('category') ?? ''
  const categories = getAllCategories()

  const published = getPublishedPosts()
  const filteredPosts = useMemo(
    () =>
      activeCategory
        ? published.filter((p) => p.categories.includes(activeCategory))
        : published,
    [activeCategory, published],
  )

  const { visibleCount, sentinelRef } = useInfiniteScroll(
    filteredPosts.length,
    PAGE_SIZE,
    activeCategory,
  )

  const visiblePosts = filteredPosts.slice(0, visibleCount)

  function setCategory(cat: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (cat) {
      params.set('category', cat)
    } else {
      params.delete('category')
    }
    const query = params.toString()
    router.replace(query ? `/blog?${query}` : '/blog', { scroll: false })
  }

  return (
    <section>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          All posts
        </h2>
        <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:justify-end sm:overflow-x-visible sm:pb-0">
          <button
            onClick={() => setCategory('')}
            className={`shrink-0 cursor-pointer rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              !activeCategory
                ? 'bg-brand-primary text-white dark:bg-brand-primary-400 dark:text-slate-900'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-brand-surface-raised dark:text-slate-400 dark:hover:bg-slate-700'
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`shrink-0 cursor-pointer rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                activeCategory === cat
                  ? 'bg-brand-primary text-white dark:bg-brand-primary-400 dark:text-slate-900'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-brand-surface-raised dark:text-slate-400 dark:hover:bg-slate-700'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {visiblePosts.length > 0 ? (
        <div>
          {visiblePosts.map((post) => (
            <BlogListItem key={post.slug} post={post} />
          ))}
          {visibleCount < filteredPosts.length && (
            <div ref={sentinelRef} className="h-px" />
          )}
        </div>
      ) : (
        <div className="py-16 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No posts found in &ldquo;{activeCategory}&rdquo;.
          </p>
          <button
            onClick={() => setCategory('')}
            className="mt-3 text-sm font-medium text-brand-primary hover:text-brand-primary/80 dark:text-brand-primary-400 dark:hover:text-brand-primary-400/80"
          >
            View all posts
          </button>
        </div>
      )}
    </section>
  )
}
