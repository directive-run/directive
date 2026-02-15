import Link from 'next/link'
import { type Node } from '@markdoc/markdoc'

import { Prose } from '@/components/Prose'
import { ArticleJsonLd } from '@/components/JsonLd'
import { calculateReadingTime, formatReadingTime } from '@/lib/readingTime'
import { resolveAuthor } from '@/lib/blog'

interface BlogFrontmatter {
  title?: string
  description?: string
  date?: string | Date
  dateModified?: string | Date
  slug?: string
  author?: string
  categories?: string[]
  layout?: string
}

function formatDate(dateStr: string | Date): string {
  const date =
    dateStr instanceof Date
      ? dateStr
      : new Date(
          typeof dateStr === 'string' && !dateStr.includes('T')
            ? dateStr + 'T00:00:00'
            : dateStr,
        )

  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function BlogPostLayout({
  children,
  frontmatter,
  nodes,
}: {
  children: React.ReactNode
  frontmatter: BlogFrontmatter
  nodes: Array<Node>
}) {
  const {
    title,
    description,
    date,
    dateModified,
    slug,
    author: authorId,
    categories = [],
  } = frontmatter
  const author = authorId ? resolveAuthor(authorId) : null
  const readingTime = formatReadingTime(calculateReadingTime(nodes))
  const canonicalUrl = slug ? `https://directive.run/blog/${slug}` : undefined
  const ogImageUrl = title
    ? `https://directive.run/api/og?title=${encodeURIComponent(title)}`
    : undefined

  return (
    <div className="w-full py-16">
      {title && <title>{`${title} | Directive Blog`}</title>}
      {description && <meta name="description" content={description} />}
      {canonicalUrl && <link rel="canonical" href={canonicalUrl} />}
      {title && <meta property="og:title" content={title} />}
      {description && <meta property="og:description" content={description} />}
      {canonicalUrl && <meta property="og:url" content={canonicalUrl} />}
      <meta property="og:type" content="article" />
      {ogImageUrl && <meta property="og:image" content={ogImageUrl} />}
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      {title && <meta name="twitter:title" content={title} />}
      {description && <meta name="twitter:description" content={description} />}
      {ogImageUrl && <meta name="twitter:image" content={ogImageUrl} />}
      {date && (
        <meta
          property="article:published_time"
          content={date instanceof Date ? date.toISOString() : date}
        />
      )}
      {dateModified && (
        <meta
          property="article:modified_time"
          content={dateModified instanceof Date ? dateModified.toISOString() : String(dateModified)}
        />
      )}

      {title && description && slug && (
        <ArticleJsonLd
          title={title}
          description={description}
          url={`https://directive.run/blog/${slug}`}
          datePublished={date}
          dateModified={dateModified || date}
        />
      )}
      <div className="mb-8">
        <Link
          href="/blog"
          className="group inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-300"
        >
          <svg
            className="h-4 w-4 transition-transform group-hover:-translate-x-0.5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
            />
          </svg>
          Back to blog
        </Link>
      </div>

      {date && (
        <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
          <time dateTime={date instanceof Date ? date.toISOString().slice(0, 10) : date}>{formatDate(date)}</time>
          <span className="text-slate-300 dark:text-slate-600">&middot;</span>
          <span>{readingTime}</span>
        </div>
      )}

      {title && (
        <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl dark:text-white">
          {title}
        </h1>
      )}

      <div className="mt-10 grid grid-cols-1 gap-12 lg:grid-cols-[15rem_1fr] xl:grid-cols-[15rem_1fr_15rem]">
        <aside className="hidden lg:block">
          {author && (
            <div className="mb-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Author
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900 dark:text-white">
                {author.name}
              </p>
              {author.role && (
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {author.role}
                </p>
              )}
            </div>
          )}
          {categories.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Categories
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {categories.map((cat) => (
                  <Link
                    key={cat}
                    href={`/blog?category=${encodeURIComponent(cat)}`}
                    className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    {cat}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </aside>

        <div className="min-w-0">
          {/* Mobile author/categories — visible below lg */}
          <div className="mb-8 flex flex-wrap items-center gap-3 text-sm lg:hidden">
            {author && (
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {author.name}
              </span>
            )}
            {categories.length > 0 && (
              <>
                <span className="text-slate-300 dark:text-slate-600">
                  &middot;
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {categories.map((cat) => (
                    <Link
                      key={cat}
                      href={`/blog?category=${encodeURIComponent(cat)}`}
                      className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                    >
                      {cat}
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>

          <Prose>{children}</Prose>
        </div>

        {/* Right spacer for xl symmetry */}
        <div className="hidden xl:block" />
      </div>

      <p className="mt-12 text-sm text-slate-400">
        Directive is free and open source. If this was useful, consider{' '}
        <Link
          href="/support"
          className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
        >
          supporting the project
        </Link>
        .
      </p>

      <div className="mt-16 border-t border-slate-200 pt-8 dark:border-slate-800">
        <Link
          href="/blog"
          className="group inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-300"
        >
          <svg
            className="h-4 w-4 transition-transform group-hover:-translate-x-0.5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
            />
          </svg>
          Back to blog
        </Link>
      </div>
    </div>
  )
}
